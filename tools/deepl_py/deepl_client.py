"""
deepl_client.py - DeepL REST API 薄いクライアント（Python 版）

`tools/deepl/deepl-client.mjs`（Node.js 版）の移植。draft_translate.py から共有する
最小限の DeepL API ラッパー。`DEEPL_API_KEY` 環境変数（無料キーは末尾 ':fx'）から
エンドポイントを自動判定する。Cowork の DeepL コネクタとは別経路（ローカル CLI 実行用）。

外部ライブラリ依存なし（標準ライブラリの urllib のみ）。
動作要件: Python 3.9+
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional, Sequence

# このファイル (tools/deepl_py/deepl_client.py) の 2 階層上がリポジトリルート:
#   deepl_client.py → deepl_py/ → tools/ → <repo root>
_REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv() -> None:
    """
    リポジトリルートの `.env` を最小パースして os.environ に流し込む。
    Node 版 `deepl-client.mjs` の loadDotEnv() と同じ挙動（既存の環境変数は上書きしない）。
    """
    env_path = _REPO_ROOT / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, raw_val = stripped.partition("=")
        key = key.strip()
        val = raw_val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            val = val[1:-1]
        if key and key not in os.environ and val != "":
            os.environ[key] = val


_load_dotenv()


def _api_key() -> str:
    key = os.environ.get("DEEPL_API_KEY")
    if not key:
        raise RuntimeError(
            "DEEPL_API_KEY が未設定です。`.env` を作成して DEEPL_API_KEY を設定してください（.env.example 参照）。"
        )
    return key


def _api_base() -> str:
    """無料版キー（':fx' 終端）かどうかでホストを切り替える。"""
    return "https://api-free.deepl.com" if _api_key().endswith(":fx") else "https://api.deepl.com"


def _request(
    path: str,
    *,
    method: str = "GET",
    form: Optional[dict] = None,
) -> Any:
    """
    共通リクエスト。`form` はキー=値の辞書（値がリストなら同名キーで複数回送信）。
    失敗時は本文付きで例外を投げる。DELETE は本文なし（204）。
    """
    url = f"{_api_base()}{path}"
    data: Optional[bytes] = None
    headers = {"Authorization": f"DeepL-Auth-Key {_api_key()}"}
    if form is not None:
        pairs: list[tuple[str, str]] = []
        for k, v in form.items():
            if isinstance(v, (list, tuple)):
                pairs.extend((k, str(item)) for item in v)
            elif v is not None:
                pairs.append((k, str(v)))
        data = urllib.parse.urlencode(pairs).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status == 204:
                return None
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"DeepL API {method} {path} -> {e.code} {e.reason}\n{text}") from e


def translate(
    texts: Sequence[str],
    *,
    target_lang: str,
    source_lang: Optional[str] = None,
    glossary_id: Optional[str] = None,
    formality: Optional[str] = None,
    context: Optional[str] = None,
) -> list[str]:
    """
    テキストを翻訳する。

    Parameters
    ----------
    texts : Sequence[str]
        翻訳対象（最大 50 件目安）。
    target_lang, source_lang, glossary_id, formality : str, optional
        DeepL API v2 の同名パラメータをそのまま中継する。
    context : str, optional
        DeepL API v2 の `context` パラメータ（1 リクエスト = 1 文脈文字列、texts 全件に共通適用）。
        翻訳結果には含まれず、語義の曖昧さ解消のヒントとしてのみ使われる。
        **注意**: DeepL は LLM ではなく NMT なので、`context` は「指示」としては機能しない
        （例:「she で訳して」と書いても代名詞選択を強制できるとは限らない）。代名詞の確実な統一が
        必要な場合は呼び出し側で後処理（正規化）を行うこと（`pronoun_normalize.py` 参照）。

    Returns
    -------
    list[str]
        訳文配列（texts と同じ順序・件数）。
    """
    if not texts:
        return []
    form = {"text": list(texts), "target_lang": target_lang}
    if source_lang:
        form["source_lang"] = source_lang
    if glossary_id:
        form["glossary_id"] = glossary_id
    if formality:
        form["formality"] = formality
    if context:
        form["context"] = context
    result = _request("/v2/translate", method="POST", form=form)
    return [t["text"] for t in (result or {}).get("translations", [])]


def list_glossaries() -> list[dict]:
    """登録済み用語集の一覧を返す。"""
    result = _request("/v2/glossaries")
    return (result or {}).get("glossaries", [])
