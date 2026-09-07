"""
draft_translate.py - キャラ文脈（GenderType・呼称）を踏まえた下書き英訳（Python 版）

`tools/deepl/draft-translate.mjs`（Node.js 版）の移植。`data/Works_*` 配下
`DataBases/db_*.json` の空 `*_EN` フィールド（**既存キーが空値の場合のみ対象。
スキーマに無いキーを新規に足すことはない**）を DeepL で下書き翻訳する。
同一レコード内の既存フィールド（`GenderType` / `ForMasterCalling_EN` 等）を踏まえ、
代名詞を `docs/localization-en-rules.md` §1 のルールへ確定的に正規化し、
一人称の混入・呼称の不一致は書き換えず警告として提示する（`pronoun_normalize.py` 参照）。

⚠️ 既定では **データを一切書き換えない**（`.cache/deepl/draft-report.md` へレポート出力のみ）。
`--apply` を付けた場合のみ、**警告が一つも無い候補だけ** を対象レコードの空 `_EN` へ書き戻す。
警告付き候補は `--apply` 指定時も常にレポート止まりとし、人間の最終確認に委ねる
（`localization-en-rules.md` §0「既存 _EN は上書きしない」/「最終採否は User」準拠）。

⚠️ **JSON に `field_EN` キー自体が存在しない**（＝まだ一度もスキーマに登録されていない）場合は
対象外。そのケースは Claude Code / Cowork のセッション内で Skill `localize-en-draft` を使い、
キー順序を保った新規挿入を人間の確認付きで行うこと（本ツールの守備範囲外）。

動作要件: Python 3.9+（外部ライブラリ依存なし）
依存: DEEPL_API_KEY, .cache/deepl/glossary-ids.json（Node 側 `npm run deepl:sync-glossary` で生成）
  （`DEEPL_DRAFT_DATA_DIR` 環境変数でテスト用に data/ 以外のディレクトリを指せる。既定はリポジトリの data/）

使い方:
  python tools/deepl_py/draft_translate.py --work Works_NumberTales [--db Primary] \\
    [--id 8] [--under ConversationPattern] [--field Summary] [--limit 30] [--apply]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepl_client import translate  # noqa: E402
from pronoun_normalize import (  # noqa: E402
    detect_calling_term_mismatch,
    detect_first_person_leakage,
    normalize_pronouns,
    pronoun_policy_for_gender_type,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
# テスト用に data/ 以外を指す場合のみ DEEPL_DRAFT_DATA_DIR で上書きする（既定はリポジトリの data/）。
_DATA_DIR = (
    Path(os.environ["DEEPL_DRAFT_DATA_DIR"]).resolve()
    if os.environ.get("DEEPL_DRAFT_DATA_DIR")
    else _REPO_ROOT / "data"
)
_CACHE = _REPO_ROOT / ".cache" / "deepl"

# GenderType ポリシーごとの DeepL context ヒント（ベストエフォート。指示としては機能しない点に注意）。
_CONTEXT_NOTE = {
    "she": "対象人物は女性として描写されている。",
    "he": "対象人物は男性として描写されている。",
    "ze": "対象人物は人間の性別区分に当てはまらない中性的な存在として描写されている。",
    "avoid": "",
}


def _resolve_under(obj: Any, dot_path: Optional[str]) -> Any:
    """ドット区切りパスでオブジェクトを辿る（`--under ConversationPattern` 等）。"""
    if not dot_path:
        return obj
    cur = obj
    for k in dot_path.split("."):
        if cur is None or not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def _collect_candidates(
    node: Any, path: list, out: list, *, field_filter: Optional[str]
) -> None:
    """
    レコード（サブツリー）を再帰的に走査し、`field_EN` が空で対応する JP 値
    （`field_JP` 優先、無ければ plain `field` — `evaluate-translations.mjs` と同じ解決順）が
    ある箇所を候補として収集する。スキーマに無いキーを新規に足すことはない（既存キーの空値のみ対象）。
    `field_filter` を指定した場合、`{field_filter}_EN` のみを対象にする（例: 'Summary'）。
    """
    if isinstance(node, list):
        for i, item in enumerate(node):
            _collect_candidates(item, path + [i], out, field_filter=field_filter)
        return
    if not isinstance(node, dict):
        return
    for key, val in list(node.items()):
        if key.endswith("_EN"):
            base = key[:-3]
            if field_filter is None or base == field_filter:
                jp = node.get(f"{base}_JP")
                if not isinstance(jp, str):
                    jp = node.get(base)
                is_empty = val is None or val == ""
                if is_empty and isinstance(jp, str) and jp.strip():
                    out.append({"path": path + [key], "jp": jp})
        if isinstance(val, (list, dict)):
            _collect_candidates(val, path + [key], out, field_filter=field_filter)


def _record_id(rec: dict, idx: int) -> str:
    """レコード識別子（`evaluate-translations.mjs` と同じ解決順）。"""
    card = rec.get("Card") if isinstance(rec.get("Card"), dict) else {}
    return str(
        rec.get("Num")
        if rec.get("Num") is not None
        else card.get("Num")
        if card.get("Num") is not None
        else rec.get("Name_JP")
        if rec.get("Name_JP") is not None
        else rec.get("FormalName_JP")
        if rec.get("FormalName_JP") is not None
        else f"#{idx}"
    )


def _apply_value_at_path(record: dict, path: list, value: str) -> None:
    node: Any = record
    for p in path[:-1]:
        node = node[p]
    node[path[-1]] = value


def main() -> None:
    parser = argparse.ArgumentParser(
        description="キャラ文脈（GenderType・呼称）を踏まえた下書き英訳（DeepL）",
    )
    parser.add_argument("--work", required=True, help="例: Works_NumberTales")
    parser.add_argument("--db", default=None, help="例: Primary（省略時は作品内の全 db_*.json）")
    parser.add_argument("--id", default=None, dest="id_filter", help="Num 等でレコードを 1 件に絞る")
    parser.add_argument("--under", default=None, help="例: ConversationPattern（サブツリー限定）")
    parser.add_argument("--field", default=None, help="例: Summary（トップレベルの field_EN 名で絞り込み）")
    parser.add_argument("--limit", type=int, default=30, help="既定 30 件")
    parser.add_argument("--apply", action="store_true", help="警告なし候補のみ空の _EN へ書き戻す")
    args = parser.parse_args()

    ids_path = _CACHE / "glossary-ids.json"
    if not ids_path.is_file():
        raise SystemExit("glossary-ids.json がありません。先に用語集を作成/同期してください。")
    ids = json.loads(ids_path.read_text(encoding="utf-8"))
    glossary_id = (ids.get("glossaries") or {}).get("ja-en", {}).get("glossary_id")
    if not glossary_id:
        raise SystemExit("ja-en の glossary_id が見つかりません。")

    db_dir = _DATA_DIR / args.work / "DataBases"
    if not db_dir.is_dir():
        print("対象 db_*.json が見つかりませんでした。--work / --db を確認してください。")
        return
    files = sorted(
        f.name
        for f in db_dir.iterdir()
        if f.name.startswith("db_")
        and f.name.endswith(".json")
        and (not args.db or f.name == f"db_{args.db}.json")
    )
    if not files:
        print("対象 db_*.json が見つかりませんでした。--work / --db を確認してください。")
        return

    report_groups = []
    total_candidates = 0
    total_applied = 0

    for file_name in files:
        file_path = db_dir / file_name
        records = json.loads(file_path.read_text(encoding="utf-8"))
        if not isinstance(records, list):
            records = []
        file_changed = False

        for idx, rec in enumerate(records):
            if not isinstance(rec, dict):
                continue
            rec_id = _record_id(rec, idx)
            if args.id_filter and str(rec_id) != str(args.id_filter):
                continue

            root = _resolve_under(rec, args.under)
            if root is None:
                continue
            seed_path = args.under.split(".") if args.under else []

            candidates: list = []
            _collect_candidates(root, seed_path, candidates, field_filter=args.field)
            if not candidates:
                continue
            if total_candidates >= args.limit:
                break
            batch = candidates[: args.limit - total_candidates]
            total_candidates += len(batch)

            policy = pronoun_policy_for_gender_type(rec.get("GenderType"))
            for_master = rec.get("ForMasterCalling_EN")
            context = _CONTEXT_NOTE.get(policy) or None

            raw = translate(
                [c["jp"] for c in batch],
                target_lang="EN-US",
                source_lang="JA",
                glossary_id=glossary_id,
                context=context,
            )

            rows = []
            for c, raw_text in zip(batch, raw):
                result = normalize_pronouns(raw_text, policy)
                warnings = []
                if result.they_subject_converted:
                    warnings.append(
                        "they/them(主語)からの変換あり: are→is 等の動詞一致が崩れていないか要確認"
                    )
                first_person = detect_first_person_leakage(result.text)
                if first_person:
                    warnings.append(f"一人称混入疑い: {', '.join(first_person)}")
                calling_mismatch = detect_calling_term_mismatch(result.text, for_master)
                if calling_mismatch:
                    warnings.append(
                        f"呼称不一致疑い: {', '.join(calling_mismatch)}"
                        f"（既存 ForMasterCalling_EN: {for_master}）"
                    )
                applied = False
                if args.apply and not warnings:
                    _apply_value_at_path(rec, c["path"], result.text)
                    file_changed = True
                    applied = True
                    total_applied += 1
                rows.append(
                    {
                        "field_path": ".".join(str(p) for p in c["path"]),
                        "jp": c["jp"],
                        "raw": raw_text,
                        "normalized": result.text,
                        "pronoun_fixed": result.changed,
                        "warnings": warnings,
                        "applied": applied,
                    }
                )

            report_groups.append(
                {
                    "work": args.work,
                    "file": file_name,
                    "id": rec_id,
                    "gender_type": rec.get("GenderType"),
                    "policy": policy,
                    "for_master": for_master,
                    "rows": rows,
                }
            )
        if file_changed:
            file_path.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"書き戻し: {file_path}")
        if total_candidates >= args.limit:
            break

    lines = [
        "# DeepL 下書き英訳レポート（キャラ文脈対応・Python 版）",
        "",
        f"生成: {datetime.now(timezone.utc).isoformat()}",
        (
            f"対象: {args.work}"
            f"{f'/db_{args.db}.json' if args.db else ''}"
            f"{f' / id={args.id_filter}' if args.id_filter else ''}"
            f"{f' / under={args.under}' if args.under else ''}"
            f"{f' / field={args.field}' if args.field else ''}"
        ),
        (
            f"候補件数: {total_candidates}"
            f"（{'自動反映 ' + str(total_applied) + ' 件・警告付き ' + str(total_candidates - total_applied) + ' 件' if args.apply else '--apply 未指定のため反映なし'}）"
        ),
        "",
        "> DeepL は NMT であり指示には従わない。代名詞は GenderType に基づき機械的に正規化済み。",
        "> ⚠️ 付きは自動書き換えせず、人間の確認が必要な項目。",
        "",
    ]
    for g in report_groups:
        lines.append(
            f"## [{g['work']}/{g['file']}] {g['id']}"
            f"（GenderType: {g['gender_type'] or '未設定'} → ポリシー: {g['policy']}）"
        )
        if g["for_master"]:
            lines.append(f"既存 ForMasterCalling_EN: {g['for_master']}")
        lines.append("")
        for r in g["rows"]:
            status = (
                "✅ 適用済み"
                if r["applied"]
                else "⚠️ 要確認（未適用）"
                if r["warnings"]
                else "⏳ レポートのみ（--apply で反映可）"
            )
            lines.append(f"### {r['field_path']} — {status}")
            lines.append(f"- **JP**: {r['jp'].replace(chr(10), ' / ')}")
            lines.append(f"- **DeepL 生訳**: {r['raw'].replace(chr(10), ' / ')}")
            lines.append(
                f"- **正規化後候補**: {r['normalized'].replace(chr(10), ' / ')}"
                f"{'（代名詞を補正）' if r['pronoun_fixed'] else ''}"
            )
            for w in r["warnings"]:
                lines.append(f"  - ⚠️ {w}")
            lines.append("")

    _CACHE.mkdir(parents=True, exist_ok=True)
    out_path = _CACHE / "draft-report.md"
    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"レポート出力: {out_path}")
    print(
        f"候補 {total_candidates} 件中、適用 {total_applied} 件"
        f"{'' if args.apply else '（--apply 未指定のため未反映）'}"
    )


if __name__ == "__main__":
    main()
