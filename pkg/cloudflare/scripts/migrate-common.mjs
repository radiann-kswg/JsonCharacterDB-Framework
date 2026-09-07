/**
 * migrate-common.mjs — D1 マイグレーションスクリプト共通ユーティリティ
 *
 * @description
 *   `migrate.mjs`（R2 ミラー + records/works/dbs 投入）と、AIHints 拡張側の
 *   `migrate-aihints.mjs`（aihints テーブル投入）が共有する処理をまとめる。
 *
 *   両スクリプトは元々ヘルパーを丸ごとコピーして持っており、`d1Execute()` に
 *   後から入った修正（wrangler config の明示・Windows の shell 対応・SQL パスの
 *   相対化）が片側にしか入らず乖離していた。wrangler の起動条件は
 *   **このファイル 1 箇所** に置き、コピーが再発しないようにする。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// wrangler 起動条件（呼び出し側からは触らせない）
// ─────────────────────────────────────────────────────────────────────────────

/** wrangler 実行コマンド。
 *  Windows (Node v22+) では .cmd を execFileSync で直接起動できないため
 *  shell オプションを使用する（WRANGLER_CMD は "npx" のまま、shell: true で解決）。
 *  R2 アップロード（migrate.mjs 固有）からも使うため export する。 */
export const WRANGLER_CMD = "npx";
export const WRANGLER_BASE_ARGS = ["wrangler"];

/** Windows では shell: true が必要（.cmd 解決 + パスのスペース対応） */
export const SPAWN_OPTS_BASE = process.platform === "win32" ? { shell: true } : {};

/** D1 操作時に wrangler.toml の場所を明示するための相対パス（repoRoot 基準）。
 *  cwd を repoRoot に固定しているため wrangler が pkg/cloudflare/ を自動探索できず、
 *  database_id（UUID）を解決できない問題を防ぐ。 */
const WRANGLER_CONFIG_REL = "pkg/cloudflare/wrangler.toml";

/** D1 バッチ INSERT の既定行数。1 ファイル = 1 SQL 文にする単位。
 *  レコード JSON は大きいため SQLITE_TOOBIG 回避で 1 レコード 1 INSERT にしており、
 *  この値は SQL ファイル 1 本あたりの文数（= レコード数）の上限。 */
const DEFAULT_D1_BATCH_SIZE = 10;

// ─────────────────────────────────────────────────────────────────────────────
// 引数パース
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 両スクリプトが共通で解釈する CLI 引数をパースする。
 * 固有オプション（`--r2-only` / `--bucket` 等）は返却した `getArg` で呼び出し側が読む。
 *
 * @param {string[]} argv - `process.argv.slice(2)` 相当
 * @returns {{getArg: (name: string) => string|undefined, dryRun: boolean, clean: boolean, dbId: string, repoRoot: string}}
 */
export function parseCommonArgs(argv) {
  /** @param {string} name @returns {string|undefined} */
  const getArg = (name) => {
    const idx = argv.indexOf(name);
    return idx !== -1 ? argv[idx + 1] : undefined;
  };
  return {
    getArg,
    dryRun: argv.includes("--dry-run"),
    clean: argv.includes("--clean"),
    dbId: getArg("--db-id") ?? "creationsdb-d1",
    // リポジトリルート: --repo-root 引数 → scripts/ の 3 階層上
    repoRoot: resolve(getArg("--repo-root") ?? join(__dirname, "../../..")),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ファイル・値のユーティリティ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JSON ファイルを読み込んでパース。失敗時は null を返す。
 *
 * @param {string} filepath
 * @param {string} [tag] - 警告ログの接頭辞（"migrate" / "aihints"）
 * @returns {unknown}
 */
export function readJson(filepath, tag = "migrate") {
  try {
    return JSON.parse(readFileSync(filepath, "utf8"));
  } catch {
    console.warn(`[${tag}] ⚠️  JSON 読み込み失敗: ${filepath}`);
    return null;
  }
}

/**
 * ディレクトリを再帰的に探索して .json ファイルを列挙する。
 *
 * @param {string} dir
 * @param {string[]} result
 * @returns {string[]}
 */
export function findJsonFiles(dir, result = []) {
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      findJsonFiles(full, result);
    } else if (entry.endsWith(".json")) {
      result.push(full);
    }
  }
  return result;
}

/**
 * SQL 文字列エスケープ（シングルクォートを重ねる）
 *
 * @param {string|null|undefined} s
 * @returns {string}
 */
export function esc(s) {
  if (s == null) return "NULL";
  return `'${String(s).replace(/'/g, "''")}'`;
}

/**
 * $IndexDef から主インデックスキー（ドット記法）を解決する。
 * フラット型: hashTag そのもの
 * ネスト型（$type が配列）: #IndexListKey > #Number > 先頭要素 の優先順で子を選択
 *
 * @param {object|undefined} indexDef
 * @returns {string}
 */
export function resolveIdxKey(indexDef) {
  if (!indexDef) return "Num";
  const root  = indexDef.hashTag ?? "Num";
  const types = indexDef.$type;

  if (!Array.isArray(types)) return root;  // フラット型

  // ネスト型: 子要素から主インデックスを選ぶ
  const findChild = (pred) => types.find((t) => typeof t.$type === "string" && pred(t.$type));
  const primary =
    findChild((t) => t.includes("#IndexListKey")) ??
    findChild((t) => t.includes("#Number"))       ??
    types[0];

  return primary ? `${root}.${primary.hashTag}` : root;
}

/**
 * ドット記法でオブジェクトから値を取得する。
 *
 * @param {object} obj
 * @param {string} path - 例: "Card.Num", "Num"
 * @returns {unknown}
 */
export function getByPath(obj, path) {
  return path.split(".").reduce((cur, k) => cur?.[k], obj);
}

// ─────────────────────────────────────────────────────────────────────────────
// DB 名の解決
// ─────────────────────────────────────────────────────────────────────────────

/** DB ファイル名候補（worker.js の resolveAndFetchDb と同じ優先順） */
export const CONVENTIONAL_FILES = {
  Primary:       "db_Primary.json",
  Secondary:     "db_Secondary.json",
  SemiPrimary:   "db_SemiPrimary.json",
  SelfSecondary: "db_SelfSecondary.json",
  Proxy:         "db_Proxy.json",
  Mobs:          "db_Mobs.json",
};

/**
 * `#DB_Primary` / `#Ref_Society` 等のメタキーから DB 名部分だけを取り出す。
 *
 * @param {string|null|undefined} s
 * @returns {string}
 */
export function stripDbPrefix(s) {
  return (s || "").replace(/^#?(DB|Ref)_/i, "").replace(/^#/, "");
}

/**
 * 先頭 1 文字を大文字化する（DB 名の正規化用）。
 *
 * @param {string} s
 * @returns {string}
 */
export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// ─────────────────────────────────────────────────────────────────────────────
// 作品ディレクトリの解決
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 作品IDから物理ディレクトリ名を解決する（`Works_Dir` オーバーライド対応）。
 * 物理ディレクトリ名が既定の `Works_<id>` と異なる作品（共通資料の疑似作品等）向け。
 *
 * @param {string} workKey - '#Works_XXX' 形式
 * @param {object} creationWorksMap - グローバル CreationWorks
 * @returns {string}
 */
export function resolveWorkDirForMigrate(workKey, creationWorksMap) {
  const info = creationWorksMap?.[workKey];
  const override = (info && typeof info.Works_Dir === "string") ? info.Works_Dir.trim() : "";
  if (override) return override;
  return workKey.replace(/^#Works_/, "Works_");
}

/**
 * 作品ベースファイル（db_meta.json / db_type.json）を読み込む。
 * `DataBases/` サブフォルダが無ければ直下の同名ファイルを試す
 * （`Works_Dir` オーバーライドで `DataBases/` を持たない作品向け。未検出は想定内のため警告を出さない）。
 *
 * @param {string} dataDir - `data/` の絶対パス
 * @param {string} workDir - 物理ディレクトリ名
 * @param {string} filename - "db_meta.json" | "db_type.json"
 * @param {string} [tag] - 警告ログの接頭辞
 * @returns {object|null}
 */
export function readWorkBaseFile(dataDir, workDir, filename, tag = "migrate") {
  const nestedPath = join(dataDir, workDir, "DataBases", filename);
  if (existsSync(nestedPath)) return readJson(nestedPath, tag);
  return readJson(join(dataDir, workDir, filename), tag);
}

/**
 * DB ファイルを探す基準ディレクトリを解決する。
 * `layer` が `workDir` 自身と一致する場合（`Works_Dir` オーバーライドで workDir と
 * DB_Layer が同名になる共通資料の疑似作品等）はレイヤーセグメントを畳み込み、
 * 二重ディレクトリ（`data/X/X/`）を避ける。
 *
 * @param {string} dataDir - `data/` の絶対パス
 * @param {string} workDir - 物理ディレクトリ名
 * @param {string} layer - `DB_Layer`（既定 "DataBases"）
 * @returns {string}
 */
export function resolveDbBasePath(dataDir, workDir, layer) {
  return (layer && layer !== workDir)
    ? join(dataDir, workDir, layer)
    : join(dataDir, workDir);
}

// ─────────────────────────────────────────────────────────────────────────────
// D1 投入ユーティリティ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * D1 への SQL 実行関数を生成する。
 * `dryRun` / `dbId` / 一時 SQL の出力先はスクリプトごとに異なるため、
 * モジュールスコープの定数ではなくここで束ねる。
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - リポジトリルート（wrangler の cwd になる）
 * @param {string} opts.dbId - D1 データベース名
 * @param {boolean} [opts.dryRun] - true なら SQL を実行せず内容だけ出力
 * @param {string} [opts.tmpDirName] - `.cache/<name>/` に一時 SQL を書き出す
 * @param {number} [opts.batchSize] - d1BatchInsert の 1 ファイルあたり文数
 * @returns {{d1Execute: (label: string, sql: string) => void, d1BatchInsert: (table: string, columns: string, valueParts: string[], labelPrefix: string) => void}}
 */
export function createD1Runner({
  repoRoot,
  dbId,
  dryRun = false,
  tmpDirName = "migrate",
  batchSize = DEFAULT_D1_BATCH_SIZE,
}) {
  /** 一時 SQL ファイルの出力先 */
  const tmpSqlDir = join(repoRoot, ".cache", tmpDirName);

  /**
   * SQL ファイルを wrangler d1 execute で実行する。
   * @param {string} label - ログ表示用ラベル
   * @param {string} sql
   */
  function d1Execute(label, sql) {
    if (!sql.trim()) return;
    if (dryRun) {
      console.log(`[D1 dry-run] ${label}\n${sql.slice(0, 200)}...`);
      return;
    }
    mkdirSync(tmpSqlDir, { recursive: true });
    const tmpFile = join(tmpSqlDir, `${label.replace(/\W+/g, "_")}.sql`);
    writeFileSync(tmpFile, sql, "utf8");
    try {
      execFileSync(
        WRANGLER_CMD,
        [...WRANGLER_BASE_ARGS, "--config", WRANGLER_CONFIG_REL, "d1", "execute", dbId, "--file", relative(repoRoot, tmpFile).replace(/\\/g, "/"), "--remote", "--yes"],
        { stdio: "inherit", cwd: repoRoot, ...SPAWN_OPTS_BASE }
      );
      console.log(`[D1] ✓ ${label}`);
    } catch (err) {
      console.error(`[D1] ✗ ${label}: ${err.message}`);
      throw err;
    }
  }

  /**
   * INSERT 文を batchSize 行ごとに分割して実行する。
   * レコード JSON は大きいため SQLITE_TOOBIG 回避で 1 レコード 1 INSERT 文にする。
   * @param {string} table
   * @param {string} columns
   * @param {string[]} valueParts - 各行の VALUES(...) 部分
   * @param {string} labelPrefix
   */
  function d1BatchInsert(table, columns, valueParts, labelPrefix) {
    for (let i = 0; i < valueParts.length; i += batchSize) {
      const chunk = valueParts.slice(i, i + batchSize);
      const sql = chunk
        .map((v) => `INSERT OR REPLACE INTO ${table} (${columns}) VALUES\n${v};`)
        .join("\n");
      d1Execute(`${labelPrefix} [${i + 1}-${i + chunk.length}]`, sql);
    }
  }

  return { d1Execute, d1BatchInsert };
}
