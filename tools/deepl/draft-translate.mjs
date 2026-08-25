/**
 * draft-translate.mjs - キャラ文脈（GenderType・呼称）を踏まえた下書き英訳
 * @description `data/Works_*` 配下 `DataBases/db_*.json` の空 `*_EN` フィールドを DeepL で下書き翻訳する。
 *   同一レコード内の既存フィールド（`GenderType` / `ForMasterCalling_EN` 等）を踏まえ、
 *   代名詞を `docs/localization-en-rules.md` §1 のルールへ確定的に正規化し、
 *   一人称の混入・呼称の不一致は書き換えず警告として提示する（`pronoun-normalize.mjs` 参照）。
 *
 *   ⚠️ 既定では **データを一切書き換えない**（`.cache/deepl/draft-report.md` へレポート出力のみ）。
 *   `--apply` を付けた場合のみ、**警告が一つも無い候補だけ** を対象レコードの空 `_EN` へ書き戻す。
 *   警告付き候補は `--apply` 指定時も常にレポート止まりとし、人間の最終確認に委ねる
 *   （`localization-en-rules.md` §0「既存 _EN は上書きしない」/「最終採否は User」準拠）。
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies Node.js >= 18, DEEPL_API_KEY, .cache/deepl/glossary-ids.json
 *   （`DEEPL_DRAFT_DATA_DIR` 環境変数でテスト用に data/ 以外のディレクトリを指せる。既定はリポジトリの data/）
 *
 * 使い方:
 *   node tools/deepl/draft-translate.mjs --work Works_NumberTales [--db Primary] \
 *     [--id 8] [--under ConversationPattern] [--field Summary] [--limit 30] [--apply]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { translate } from "./deepl-client.mjs";
import {
  pronounPolicyForGenderType,
  normalizePronouns,
  detectFirstPersonLeakage,
  detectCallingTermMismatch,
} from "./pronoun-normalize.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
// テスト用に data/ 以外を指す場合のみ DEEPL_DRAFT_DATA_DIR で上書きする（既定はリポジトリの data/）。
const DATA_DIR = process.env.DEEPL_DRAFT_DATA_DIR
  ? resolve(process.env.DEEPL_DRAFT_DATA_DIR)
  : join(REPO_ROOT, "data");
const CACHE = join(REPO_ROOT, ".cache", "deepl");

/** 簡易 CLI パーサ（--key value 形式、値なしフラグは boolean）。 */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const WORK = arg("work", null);
const DB_FILTER = arg("db", null);
const ID_FILTER = arg("id", null);
const UNDER = arg("under", null);
const FIELD_FILTER = arg("field", null);
const LIMIT = parseInt(arg("limit", "30"), 10);
const APPLY = flag("apply");

/** GenderType ポリシーごとの DeepL context ヒント（ベストエフォート。指示としては機能しない点に注意）。 */
const CONTEXT_NOTE = {
  she: "対象人物は女性として描写されている。",
  he: "対象人物は男性として描写されている。",
  ze: "対象人物は人間の性別区分に当てはまらない中性的な存在として描写されている。",
  avoid: "",
};

/** ドット区切りパスでオブジェクトを辿る（`--under ConversationPattern` 等）。 */
function resolveUnder(obj, dotPath) {
  if (!dotPath) return obj;
  return dotPath.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * レコード（サブツリー）を再帰的に走査し、`field_EN` が空で対応する JP 値
 * （`field_JP` 優先、無ければ plain `field` — `evaluate-translations.mjs` と同じ解決順）が
 * ある箇所を候補として収集する。スキーマに無いキーを新規に足すことはない（既存キーの空値のみ対象）。
 * `FIELD_FILTER`（`--field`）を指定した場合、`{FIELD_FILTER}_EN` のみを対象にする（例: 'Summary'）。
 */
function collectCandidates(node, path, out) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectCandidates(item, [...path, i], out));
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (key.endsWith("_EN")) {
      const base = key.slice(0, -3);
      if (!FIELD_FILTER || base === FIELD_FILTER) {
        let jp = node[`${base}_JP`];
        if (typeof jp !== "string") jp = node[base];
        const isEmpty = val === undefined || val === null || val === "";
        if (isEmpty && typeof jp === "string" && jp.trim()) {
          out.push({ path: [...path, key], jp });
        }
      }
    }
    if (Array.isArray(val) || (val && typeof val === "object")) {
      collectCandidates(val, [...path, key], out);
    }
  }
}

/** レコード識別子（`evaluate-translations.mjs` と同じ解決順）。 */
function recordId(rec, idx) {
  return rec.Num ?? rec.Card?.Num ?? rec.Name_JP ?? rec.FormalName_JP ?? `#${idx}`;
}

function applyValueAtPath(record, path, value) {
  let node = record;
  for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
  node[path[path.length - 1]] = value;
}

async function main() {
  if (!WORK) throw new Error("--work は必須です（例: --work Works_NumberTales）");

  const idsPath = join(CACHE, "glossary-ids.json");
  if (!existsSync(idsPath)) {
    throw new Error("glossary-ids.json がありません。先に用語集を作成/同期してください。");
  }
  const ids = JSON.parse(readFileSync(idsPath, "utf8"));
  const glossaryId = ids.glossaries?.["ja-en"]?.glossary_id;
  if (!glossaryId) throw new Error("ja-en の glossary_id が見つかりません。");

  const dbDir = join(DATA_DIR, WORK, "DataBases");
  const files = readdirSync(dbDir).filter(
    (f) =>
      f.startsWith("db_") &&
      f.endsWith(".json") &&
      (!DB_FILTER || f === `db_${DB_FILTER}.json`),
  );
  if (!files.length) {
    console.log("対象 db_*.json が見つかりませんでした。--work / --db を確認してください。");
    return;
  }

  const reportGroups = [];
  let totalCandidates = 0;
  let totalApplied = 0;

  for (const file of files) {
    const filePath = join(dbDir, file);
    const json = JSON.parse(readFileSync(filePath, "utf8"));
    const records = Array.isArray(json) ? json : [];
    let fileChanged = false;

    for (let idx = 0; idx < records.length; idx++) {
      const rec = records[idx];
      if (!rec || typeof rec !== "object") continue;
      const id = recordId(rec, idx);
      if (ID_FILTER && String(id) !== String(ID_FILTER)) continue;

      const root = resolveUnder(rec, UNDER);
      if (root === undefined) continue;
      const seedPath = UNDER ? UNDER.split(".") : [];

      const candidates = [];
      collectCandidates(root, seedPath, candidates);
      if (!candidates.length) continue;
      if (totalCandidates >= LIMIT) break;
      const batch = candidates.slice(0, LIMIT - totalCandidates);
      totalCandidates += batch.length;

      const policy = pronounPolicyForGenderType(rec.GenderType);
      const forMaster = rec.ForMasterCalling_EN;
      const context = CONTEXT_NOTE[policy] || undefined;

      const raw = await translate(
        batch.map((c) => c.jp),
        { target_lang: "EN-US", source_lang: "JA", glossary_id: glossaryId, context },
      );

      const rows = batch.map((c, i) => {
        const { text: normalized, changed: pronounFixed, theySubjectConverted } = normalizePronouns(raw[i], policy);
        const warnings = [];
        if (theySubjectConverted) {
          warnings.push("they/them(主語)からの変換あり: are→is 等の動詞一致が崩れていないか要確認");
        }
        const firstPerson = detectFirstPersonLeakage(normalized);
        if (firstPerson.length) {
          warnings.push(`一人称混入疑い: ${firstPerson.join(", ")}`);
        }
        const callingMismatch = detectCallingTermMismatch(normalized, forMaster);
        if (callingMismatch.length) {
          warnings.push(`呼称不一致疑い: ${callingMismatch.join(", ")}（既存 ForMasterCalling_EN: ${forMaster}）`);
        }
        let applied = false;
        if (APPLY && !warnings.length) {
          applyValueAtPath(rec, c.path, normalized);
          fileChanged = true;
          applied = true;
          totalApplied++;
        }
        return {
          fieldPath: c.path.join("."),
          jp: c.jp,
          raw: raw[i],
          normalized,
          pronounFixed,
          warnings,
          applied,
        };
      });

      reportGroups.push({ work: WORK, file, id, genderType: rec.GenderType, policy, forMaster, rows });
    }
    if (fileChanged) {
      writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
      console.log(`書き戻し: ${filePath}`);
    }
    if (totalCandidates >= LIMIT) break;
  }

  const lines = [
    "# DeepL 下書き英訳レポート（キャラ文脈対応）",
    "",
    `生成: ${new Date().toISOString()}`,
    `対象: ${WORK}${DB_FILTER ? `/db_${DB_FILTER}.json` : ""}${ID_FILTER ? ` / id=${ID_FILTER}` : ""}${UNDER ? ` / under=${UNDER}` : ""}${FIELD_FILTER ? ` / field=${FIELD_FILTER}` : ""}`,
    `候補件数: ${totalCandidates}（${APPLY ? `自動反映 ${totalApplied} 件・警告付き ${totalCandidates - totalApplied} 件` : "--apply 未指定のため反映なし"}）`,
    "",
    "> DeepL は NMT であり指示には従わない。代名詞は GenderType に基づき機械的に正規化済み。",
    "> ⚠️ 付きは自動書き換えせず、人間の確認が必要な項目。",
    "",
  ];
  for (const g of reportGroups) {
    lines.push(`## [${g.work}/${g.file}] ${g.id}（GenderType: ${g.genderType ?? "未設定"} → ポリシー: ${g.policy}）`);
    if (g.forMaster) lines.push(`既存 ForMasterCalling_EN: ${g.forMaster}`);
    lines.push("");
    for (const r of g.rows) {
      const status = r.applied ? "✅ 適用済み" : r.warnings.length ? "⚠️ 要確認（未適用）" : "⏳ レポートのみ（--apply で反映可）";
      lines.push(`### ${r.fieldPath} — ${status}`);
      lines.push(`- **JP**: ${r.jp.replace(/\n/g, " / ")}`);
      lines.push(`- **DeepL 生訳**: ${r.raw.replace(/\n/g, " / ")}`);
      lines.push(`- **正規化後候補**: ${r.normalized.replace(/\n/g, " / ")}${r.pronounFixed ? "（代名詞を補正）" : ""}`);
      for (const w of r.warnings) lines.push(`  - ⚠️ ${w}`);
      lines.push("");
    }
  }

  const outPath = join(CACHE, "draft-report.md");
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`レポート出力: ${outPath}`);
  console.log(`候補 ${totalCandidates} 件中、適用 ${totalApplied} 件${APPLY ? "" : "（--apply 未指定のため未反映）"}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
