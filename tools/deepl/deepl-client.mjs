/**
 * deepl-client.mjs - DeepL REST API 薄いクライアント
 * @description sync-glossary / evaluate-translations / draft-translate から共有する最小限の DeepL API ラッパ。
 *   `DEEPL_API_KEY` 環境変数（無料キーは末尾 ':fx'）からエンドポイントを自動判定する。
 *   Cowork の DeepL コネクタとは別経路（ローカル CLI 実行用）。
 * @author 100BeautiesLab.
 * @version 1.1.0
 * @dependencies Node.js >= 18（グローバル fetch を使用）
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

/**
 * リポジトリルートの `.env` を最小パースして process.env に流し込む。
 * Node 18 系（`--env-file` 非対応）でも動くようにするための簡易ローダ。
 * 既に環境変数が設定済みの場合は上書きしない（CI/シェル指定を優先）。
 */
function loadDotEnv() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined && val !== "") process.env[key] = val;
  }
}

loadDotEnv();
const API_KEY = process.env.DEEPL_API_KEY;

/** 無料版キー（':fx' 終端）かどうかでホストを切り替える。 */
function apiBase() {
  if (!API_KEY) {
    throw new Error(
      "DEEPL_API_KEY が未設定です。`.env` を作成して DEEPL_API_KEY を設定してください（.env.example 参照）。",
    );
  }
  return API_KEY.endsWith(":fx")
    ? "https://api-free.deepl.com"
    : "https://api.deepl.com";
}

/** 共通 fetch。失敗時は本文付きで例外を投げる。 */
async function request(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      Authorization: `DeepL-Auth-Key ${API_KEY}`,
      ...headers,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DeepL API ${method} ${path} -> ${res.status} ${res.statusText}\n${text}`);
  }
  // DELETE は本文を持たない（204）
  if (res.status === 204) return null;
  return res.json();
}

/**
 * テキストを翻訳する。
 * @param {string[]} texts - 翻訳対象（最大 50 件目安）
 * @param {{target_lang:string, source_lang?:string, glossary_id?:string, formality?:string, context?:string}} opts
 *   `context` は DeepL API v2 の同名パラメータをそのまま中継する（1 リクエスト = 1 文脈文字列。
 *   texts 全件に共通適用される）。翻訳結果には含まれず、語義の曖昧さ解消のヒントとしてのみ使われる。
 *   **注意**: DeepL は LLM ではなく NMT なので、`context` は「指示」としては機能しない
 *   （例:「she で訳して」と書いても代名詞選択を強制できるとは限らない）。代名詞の確実な統一が
 *   必要な場合は呼び出し側で後処理（正規化）を行うこと（`tools/deepl/draft-translate.mjs` 参照）。
 * @returns {Promise<string[]>} 訳文配列
 */
export async function translate(texts, opts) {
  const params = new URLSearchParams();
  for (const t of texts) params.append("text", t);
  params.set("target_lang", opts.target_lang);
  if (opts.source_lang) params.set("source_lang", opts.source_lang);
  if (opts.glossary_id) params.set("glossary_id", opts.glossary_id);
  if (opts.formality) params.set("formality", opts.formality);
  if (opts.context) params.set("context", opts.context);
  const json = await request("/v2/translate", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  return (json.translations || []).map((t) => t.text);
}

/** 登録済み用語集の一覧を返す。 */
export async function listGlossaries() {
  const json = await request("/v2/glossaries");
  return json.glossaries || [];
}

/**
 * 用語集を新規作成する（DeepL は部分更新不可のため delete→create で運用）。
 * @param {{name:string, source_lang:string, target_lang:string, tsv:string}} g
 */
export async function createGlossary({ name, source_lang, target_lang, tsv }) {
  const params = new URLSearchParams();
  params.set("name", name);
  params.set("source_lang", source_lang);
  params.set("target_lang", target_lang);
  params.set("entries", tsv);
  params.set("entries_format", "tsv");
  return request("/v2/glossaries", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
}

/** 用語集を削除する。 */
export async function deleteGlossary(id) {
  return request(`/v2/glossaries/${id}`, { method: "DELETE" });
}

export { API_KEY };
