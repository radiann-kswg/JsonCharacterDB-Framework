/**
 * worker.js — 100BeautiesLab CreationsDB Cloudflare Workers エントリーポイント
 *
 * @description
 *   Cloudflare Workers 上で動作するサーバーサイド API。
 *   データは R2 バケット（静的 JSON ミラー）と D1 データベース
 *   （正規化メタ・FTS5 検索インデックス）から取得する。
 *
 *   エンドポイント一覧:
 *     GET /api/v1/meta                              — グローバルメタ (R2)
 *     GET /api/v1/works                             — 作品一覧 (D1)
 *     GET /api/v1/:work/meta                        — 作品別メタ (R2)
 *     GET /api/v1/:work/dbs                         — DB 一覧 (D1)
 *     GET /api/v1/:work/:db/records                 — レコード一覧 (D1)
 *     GET /api/v1/:work/:db/records/:idx            — レコード 1 件 (D1)
 *     GET /api/v1/:work/:db/records/:idx?idxKey=X   — インデックスキー指定 (D1)
 *     GET /api/v1/:work/:db/search?q=キーワード      — DB 内全文検索 (D1 FTS5)
 *     GET /api/v1/:work/search?q=キーワード          — 作品横断検索 (D1 FTS5)
 *
 *   バインディング（wrangler.toml）:
 *     BUCKET  — R2 バケット (creationsdb-data): data/** の JSON 静的ミラー
 *     DB      — D1 データベース (creationsdb-d1): メタ・FTS インデックス
 *
 *   注: _DBLink / _Jump 解決 (EnrichmentProcessor 移植) は次フェーズ実装予定。
 *       現在の /api/v1 は _Commons 適用・isPrivate 除外まで対応。
 *
 * @author 100BeautiesLab.
 * @version 2.0.0
 */

// ─────────────────────────────────────────────────────────────────────────────
// セキュリティユーティリティ
// ─────────────────────────────────────────────────────────────────────────────

const SAFE_TOKEN_RE      = /^[A-Za-z0-9_]+$/;
const VALID_JSON_FILE_RE = /^[A-Za-z0-9_.\-]+\.json$/;

/**
 * パストラバーサル防止: 英数字とアンダースコアのみ許可
 * @param {unknown} s
 * @returns {boolean}
 */
function isSafeToken(s) {
  return typeof s === "string" && SAFE_TOKEN_RE.test(s);
}

/**
 * JSON ファイル名として安全か検証
 * @param {unknown} s
 * @returns {boolean}
 */
function isValidJsonFile(s) {
  return typeof s === "string" && VALID_JSON_FILE_RE.test(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// パス / キー 正規化ユーティリティ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 先頭文字を大文字化
 * @param {string} s
 * @returns {string}
 */
function capitalize(s) {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

/**
 * 作品 ID を '#Works_<Name>' 形式に正規化
 * @param {string} workId
 * @returns {string|null}
 */
function toWorkKey(workId) {
  if (!workId) return null;
  const raw = workId.trim();
  let normalized;
  if (raw.startsWith("#Works_"))     normalized = raw;
  else if (raw.startsWith("Works_")) normalized = `#${raw}`;
  else                               normalized = `#Works_${raw}`;
  const m = normalized.match(/^#Works_([A-Za-z0-9_]+)$/);
  return m ? `#Works_${m[1]}` : null;
}

/**
 * '#Works_XXX' → 'Works_XXX'（ファイルシステムパス用、既定導出）
 * @param {string} workKey
 * @returns {string}
 */
function resolveWorkDir(workKey) {
  return (workKey || "").replace(/^#Works_/, "Works_");
}

/** CreationWorks.*.Works_Dir のオーバーライド表キャッシュ（TTL付き） */
let worksDirOverrideCache = null; // { t, map: Map<workKey, dirName> }
const WORKS_DIR_OVERRIDE_TTL_MS = 15 * 1000;

/**
 * CreationWorks.*.Works_Dir のオーバーライド表を取得する。
 * 物理ディレクトリ名が既定の `Works_<id>` と異なる作品（共通資料の疑似作品等）向け。
 * @param {object} env
 * @returns {Promise<Map<string, string>>}
 */
async function getWorksDirOverrides(env) {
  const now = Date.now();
  if (worksDirOverrideCache && (now - worksDirOverrideCache.t) < WORKS_DIR_OVERRIDE_TTL_MS) {
    return worksDirOverrideCache.map;
  }
  const map = new Map();
  try {
    const meta = await getGlobalMeta(env);
    for (const [key, info] of Object.entries(meta?.CreationWorks || {})) {
      const dir = (info && typeof info.Works_Dir === "string") ? info.Works_Dir.trim() : "";
      if (dir && isSafeToken(dir)) map.set(key, dir);
    }
  } catch {
    // 取得失敗時は空表を返し、全workが従来のresolveWorkDirへフォールバックする
  }
  worksDirOverrideCache = { t: now, map };
  return map;
}

/**
 * 作品IDから物理ディレクトリ名を解決（Works_Dir オーバーライド対応）
 * @param {object} env
 * @param {string} workKey
 * @returns {Promise<string>}
 */
async function resolveWorkDirWithOverride(env, workKey) {
  const overrides = await getWorksDirOverrides(env);
  return overrides.get(workKey) || resolveWorkDir(workKey);
}

/**
 * '#DB_Primary' / 'Primary' → 'Primary'
 * @param {string} dbName
 * @returns {string}
 */
function stripMetaDbPrefix(dbName) {
  return (dbName || "").replace(/^#?(DB|Ref)_/i, "").replace(/^#/, "");
}

/**
 * 'Primary' → '#DB_Primary'
 * @param {string} dbName
 * @returns {string}
 */
function normalizeDbKeyForMeta(dbName) {
  return `#DB_${capitalize(stripMetaDbPrefix(dbName))}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// R2 データアクセス
// ─────────────────────────────────────────────────────────────────────────────

/**
 * R2 パス変換: URL パス → R2 オブジェクトキー
 * 例: '/data/db_meta.json' → 'data/db_meta.json'
 * @param {string} path - '/data/...' 形式
 * @returns {string}
 */
function pathToR2Key(path) {
  return path.replace(/^\/+/, "");
}

/**
 * R2 から JSON を取得してパース。キャッシュを活用する。
 * @param {object} env - Workers env (env.BUCKET が R2 バインディング)
 * @param {string} path - '/data/...' 形式のパス
 * @returns {Promise<object|null>}
 */
async function fetchJsonFromR2(env, path) {
  const key = pathToR2Key(path);
  try {
    // Cloudflare Cache API でキャッシュ
    const cacheUrl = `https://r2-cache.internal/${key}`;
    const cacheKey = new Request(cacheUrl);
    let cache;
    try { cache = caches.default; } catch { /* ローカル開発時はスキップ */ }

    if (cache) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached.json();
    }

    const obj = await env.BUCKET.get(key);
    if (!obj) {
      // オブジェクト不在は「まだ同期されていない」正常系にもなり得るが、
      // R2 が丸ごと空の状態（migrate.mjs の --remote 欠落で実際に発生した）を
      // 黙って握り潰さないよう、必ずログに残す（wrangler tail / Workers Logs で追える）。
      console.warn(`[R2] object not found: ${key}`);
      return null;
    }

    const data = await obj.json();

    if (cache) {
      const cacheRes = new Response(JSON.stringify(data), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
        },
      });
      cache.put(cacheKey, cacheRes);
    }

    return data;
  } catch (err) {
    // 例外を無言で null に変換すると、呼び出し元（getGlobalMeta / getWorkMeta）が
    // 「データが無い」as-if で進み、_Commons 未適用のまま応答してしまう。原因を必ず残す。
    console.error(`[R2] fetch failed: ${key}: ${err?.message ?? err}`);
    return null;
  }
}

/**
 * R2 オブジェクトの存在確認
 * @param {object} env
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function existsInR2(env, path) {
  try {
    const obj = await env.BUCKET.head(pathToR2Key(path));
    return obj !== null;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// D1 データアクセス
// ─────────────────────────────────────────────────────────────────────────────

/**
 * D1 クエリを実行して結果を返す
 * @param {object} env
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<object[]>}
 */
async function d1Query(env, sql, params = []) {
  const stmt = env.DB.prepare(sql).bind(...params);
  const { results } = await stmt.all();
  return results ?? [];
}

/**
 * D1 クエリを実行して最初の行を返す
 * @param {object} env
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<object|null>}
 */
async function d1First(env, sql, params = []) {
  const stmt = env.DB.prepare(sql).bind(...params);
  return stmt.first();
}

// ─────────────────────────────────────────────────────────────────────────────
// メタ読み込み
// ─────────────────────────────────────────────────────────────────────────────

/**
 * グローバルメタ (data/db_meta.json) を R2 から取得
 * @param {object} env
 * @returns {Promise<object>}
 */
async function getGlobalMeta(env) {
  const meta = await fetchJsonFromR2(env, "/data/db_meta.json");
  if (!meta) throw new ApiError(503, "Global meta unavailable");
  return meta;
}

/**
 * 作品別メタ (data/Works_X/DataBases/db_meta.json) を R2 から取得。
 * `DataBases/` サブフォルダを持たない作品（`Works_Dir` オーバーライドを使う
 * 共通資料の疑似作品等）向けに、直下の db_meta.json へのフォールバックも試みる。
 * @param {object} env
 * @param {string} workKey - '#Works_XXX' 形式
 * @returns {Promise<object|null>}
 */
async function getWorkMeta(env, workKey) {
  const workDir = await resolveWorkDirWithOverride(env, workKey);
  const meta = await fetchJsonFromR2(env, `/data/${workDir}/DataBases/db_meta.json`);
  if (meta) return meta;
  return fetchJsonFromR2(env, `/data/${workDir}/db_meta.json`);
}

// ─────────────────────────────────────────────────────────────────────────────
// DB ファイル解決 (R2 ベース)
// ─────────────────────────────────────────────────────────────────────────────

/** DB 名 → 既定ファイル名の対応マップ */
const CONVENTIONAL_DB_FILES = {
  Primary:       "db_Primary.json",
  Secondary:     "db_Secondary.json",
  SemiPrimary:   "db_SemiPrimary.json",
  SelfSecondary: "db_SelfSecondary.json",
  Proxy:         "db_Proxy.json",
  Mobs:          "db_Mobs.json",
};

/**
 * R2 からレコード配列を取得する。
 * db_meta.json で DB_File が宣言されていれば優先し、なければ候補ファイル名を順番に試す。
 * @param {object} env
 * @param {string} workKey
 * @param {string} dbName
 * @param {object|null} workMeta
 * @returns {Promise<{records: object[], dbEntry: object}>}
 */
async function resolveAndFetchDbFromR2(env, workKey, dbName, workMeta) {
  const norm = stripMetaDbPrefix(dbName);
  if (!isSafeToken(norm)) throw new ApiError(400, "Invalid dbName");
  const key = capitalize(norm);

  const databases = workMeta?.Databases ?? {};
  const metaKey   = `#DB_${key}`;
  const refKey    = `#Ref_${key}`;
  const dbEntry   = databases[metaKey] ?? databases[refKey] ?? {};
  const isRef     = !!databases[refKey];

  const layerRaw     = (dbEntry.DB_Layer || "").trim();
  const layer        = isSafeToken(layerRaw) ? layerRaw : "DataBases";
  const fileRaw      = (dbEntry.DB_File  || "").trim();
  const configuredFile = isValidJsonFile(fileRaw) ? fileRaw : "";
  const defaultPrefix  = isRef ? "ref_" : "db_";
  const workDir        = await resolveWorkDirWithOverride(env, workKey);
  // layer が workDir 自身と一致する場合（Works_Dir オーバーライドで workDir と DB_Layer が
  // 同名になる共通資料の疑似作品等）はレイヤーセグメントを畳み込み、二重ディレクトリを避ける
  const basePath       = `/data/${workDir}${(layer && layer !== workDir) ? `/${layer}` : ""}`;

  const candidates = [
    configuredFile,
    CONVENTIONAL_DB_FILES[key],
    `${defaultPrefix}${key}.json`,
    key !== norm ? `${defaultPrefix}${norm}.json` : null,
    defaultPrefix !== "db_" ? `db_${key}.json` : null,
  ].filter(Boolean);

  for (const fname of candidates) {
    const path = `${basePath}/${fname}`;
    if (await existsInR2(env, path)) {
      const records = await fetchJsonFromR2(env, path);
      if (Array.isArray(records)) return { records, dbEntry };
    }
  }
  throw new ApiError(404, `DB not found: ${dbName}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// D1 経由のレコード取得
// ─────────────────────────────────────────────────────────────────────────────

/**
 * D1 からレコード一覧を取得（isPrivate=0 のみ）
 * @param {object} env
 * @param {string} workKey
 * @param {string} dbName
 * @returns {Promise<object[]>}
 */
async function getRecordsFromD1(env, workKey, dbName) {
  const rows = await d1Query(
    env,
    "SELECT data_json FROM records WHERE work_key = ? AND db_name = ? AND is_private = 0",
    [workKey, dbName]
  );
  return rows.map((r) => JSON.parse(r.data_json));
}

/**
 * D1 からインデックス値でレコード 1 件を取得
 * @param {object} env
 * @param {string} workKey
 * @param {string} dbName
 * @param {string} idxValue
 * @param {string} idxKey
 * @returns {Promise<object|null>}
 */
async function getRecordFromD1(env, workKey, dbName, idxValue, idxKey = "Num") {
  const row = await d1First(
    env,
    "SELECT data_json FROM records WHERE work_key = ? AND db_name = ? AND idx_key = ? AND idx_value = ? AND is_private = 0",
    [workKey, dbName, idxKey, String(idxValue)]
  );
  return row ? JSON.parse(row.data_json) : null;
}

/**
 * FTS5 検索クエリを正規化し、無効な構文を 400 として扱えるようにする。
 * ここでは FTS5 のワイルドカード構文（`*` / `?`）を明示的に拒否し、
 * 例外時は API エラーへ変換する。
 * @param {string} query
 * @returns {string|null}
 */
function normalizeSearchQuery(query) {
  const normalized = String(query ?? "").trim();
  if (!normalized) return null;
  if (/[\*\?]/.test(normalized)) {
    throw new ApiError(400, "Invalid search query");
  }
  return normalized;
}

/**
 * D1 FTS5 で DB 内キーワード検索
 * @param {object} env
 * @param {string} workKey
 * @param {string} dbName
 * @param {string} query
 * @returns {Promise<object[]>}
 */
async function searchRecordsInD1(env, workKey, dbName, query) {
  const normalizedQuery = normalizeSearchQuery(query);
  if (normalizedQuery === null) return [];

  try {
    const rows = await d1Query(
      env,
      `SELECT r.data_json FROM records r
       WHERE r.id IN (SELECT rowid FROM records_fts WHERE searchable_text MATCH ?)
         AND r.work_key = ? AND r.db_name = ? AND r.is_private = 0
       LIMIT 200`,
      [normalizedQuery, workKey, dbName]
    );
    return rows.map((r) => JSON.parse(r.data_json));
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, "Invalid search query");
  }
}

/**
 * D1 FTS5 で作品横断キーワード検索
 * @param {object} env
 * @param {string} workKey
 * @param {string} query
 * @returns {Promise<Array<{db: string, record: object}>>}
 */
async function searchAllRecordsInD1(env, workKey, query) {
  const normalizedQuery = normalizeSearchQuery(query);
  if (normalizedQuery === null) return [];

  try {
    const rows = await d1Query(
      env,
      `SELECT r.db_name, r.data_json FROM records r
       WHERE r.id IN (SELECT rowid FROM records_fts WHERE searchable_text MATCH ?)
         AND r.work_key = ? AND r.is_private = 0
       LIMIT 500`,
      [normalizedQuery, workKey]
    );
    return rows.map((r) => ({ db: r.db_name, record: JSON.parse(r.data_json) }));
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, "Invalid search query");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// _Commons 適用
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 値が _Commons 補完対象の「空」かどうか判定
 * @param {unknown} v
 * @returns {boolean}
 */
function isEmptyForCommons(v) {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return false; // `[]` は「該当なし」の明示宣言なので既定値で埋めない
  if (typeof v === "object") {
    if (v.hideText !== undefined) return false; // hideText は意図的マスク
    return Object.keys(v).length === 0;
  }
  return false;
}

/**
 * _Commons をレコード配列に適用する（非破壊）
 *
 * NOTE: `scripts/migrate.mjs` からも import される（D1 の `is_private` 列を
 * _Commons 適用後の値から算出するため）。ロジックの二重実装を避ける目的で named export している。
 *
 * @param {object[]} records
 * @param {object|null} workMeta
 * @param {string} dbName
 * @returns {object[]}
 */
export function applyCommons(records, workMeta, dbName) {
  if (!workMeta) return records;
  const dbKey    = normalizeDbKeyForMeta(dbName);
  const databases = workMeta?.Databases ?? {};
  const dbInfo   = databases[dbKey] ?? {};
  const commons  = dbInfo._Commons  ?? null;
  const secDefs  = dbInfo._Secondaries ?? dbInfo.Secondaries ?? null;
  if (!commons && !secDefs) return records;

  /** デフォルト値オブジェクトを構築 */
  function buildDefaults(cmn) {
    if (!cmn) return {};
    return Object.fromEntries(
      Object.entries(cmn).filter(([k]) => !k.startsWith("_") && !k.startsWith("#"))
    );
  }

  /** rec に合致する _Secondaries エントリの defaults を返す */
  function findSecDefaults(rec) {
    if (!secDefs) return {};
    let fallback = null;
    for (const def of secDefs) {
      const defCmn   = def._Commons;
      if (!defCmn) continue;
      const defTitle = def.sec_SeriesTitle ?? def.SecondarySeriesTitle;
      if (!defTitle) { fallback ??= buildDefaults(defCmn); continue; }
      const recTitle = rec.sec_SeriesTitle ?? rec.SecondarySeriesTitle;
      if (recTitle === defTitle) return buildDefaults(defCmn);
    }
    return fallback ?? {};
  }

  return records.map((rec) => {
    const defaults = { ...buildDefaults(commons), ...findSecDefaults(rec) };
    if (Object.keys(defaults).length === 0) return rec;
    const copy = { ...rec };
    for (const [k, v] of Object.entries(defaults)) {
      if (k.startsWith("#")) continue;
      if (isEmptyForCommons(copy[k])) copy[k] = v;
    }
    return copy;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// レコードフィルタリング
// ─────────────────────────────────────────────────────────────────────────────

/**
 * isPrivate フラグによる非公開レコード除外
 *
 * 呼び出しは必ず `applyCommons()` の「後」に行うこと。isPrivate は
 * `_Secondaries[]._Commons` 経由でシリーズ単位に注入されることがあり、
 * 適用前に判定するとレコード自身が isPrivate を宣言していない限り注入値が読まれない。
 *
 * NOTE: `scripts/migrate.mjs` からも import される（D1 の `is_private` 列の算出用）。
 *
 * @param {object} rec
 * @returns {boolean}
 */
export function isPublicRecord(rec) {
  const v = rec?.isPrivate;
  if (v === undefined || v === null) return true;
  if (typeof v === "boolean") return !v;
  if (typeof v === "string") return v.toLowerCase() !== "true";
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// エラークラス
// ─────────────────────────────────────────────────────────────────────────────

/** API エラー（ステータスコード付き） */
class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// レスポンス生成ユーティリティ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JSON レスポンスを生成
 * @param {unknown} data
 * @param {number} status
 * @returns {Response}
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}

/**
 * エラーレスポンスを生成
 * @param {number} status
 * @param {string} message
 * @returns {Response}
 */
function errorResponse(status, message) {
  return jsonResponse({ error: message, status }, status);
}

/**
 * HTML レスポンスを生成（ダッシュボード本体配信用）
 * @param {string} html
 * @param {number} status
 * @returns {Response}
 */
function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // ダッシュボード HTML は短時間キャッシュ（データは別エンドポイントで都度取得）
      "Cache-Control": "public, max-age=120",
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Today Action Board ダッシュボード
//   GET /dashboard       — セルフコンテインドな 1 枚もの HTML（モバイル幅・ライト基調）
//   GET /dashboard/data  — 記念日(D1) + GitHub(REST) を集約した JSON
//
//   端末非依存・サーバ側でデータ取得。HTML 内 JS は同一オリジンの
//   /dashboard/data を fetch してレンダリングする（window.cowork は不使用）。
//   scheduled-tasks / session_info は Worker からは到達不可のため非対応
//   （ダッシュボードには「Web版では非対応」と注記のみ）。
// ─────────────────────────────────────────────────────────────────────────────

/** GitHub 監視対象ユーザー */
const DASHBOARD_GITHUB_USER = "radiann-kswg";
/** 記念日の表示ウィンドウ（日数） */
const DASHBOARD_ANIV_WINDOW_DAYS = 14;
/** サーバ側 TZ（記念日 daysUntil 計算基準） */
const DASHBOARD_TZ = "Asia/Tokyo";
/** JST オフセット（ミリ秒） */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * JST 基準の「今日」(UTC エポック化された 0 時)を返す
 * @returns {{ todayUTC: number, year: number }}
 */
function jstTodayBase() {
  const now = new Date();
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const d = jst.getUTCDate();
  return { todayUTC: Date.UTC(y, m, d), year: y };
}

/**
 * 月/日（年なし記念日）から JST 今日までの残日数を算出。
 * 今年の該当日が過ぎていれば翌年の同日を採用する。
 * @param {number} month - 1-12
 * @param {number} day   - 1-31
 * @param {{ todayUTC: number, year: number }} base
 * @returns {number|null}
 */
function daysUntilAnniversary(month, day, base) {
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let target = Date.UTC(base.year, month - 1, day);
  if (target < base.todayUTC) target = Date.UTC(base.year + 1, month - 1, day);
  return Math.round((target - base.todayUTC) / 86400000);
}

/**
 * 記念日/誕生日アイテムの優先度を決定
 * @param {number} daysUntil
 * @returns {"urgent"|"today"|"reference"}
 */
function anniversaryPriority(daysUntil) {
  if (daysUntil === 0) return "urgent";   // 当日 → 緊急
  if (daysUntil <= 3)  return "today";    // 3 日以内 → 本日中
  return "reference";                     // それ以降 → 参考
}

/**
 * D1 から記念日/誕生日を集約する（is_private=0 のみ）。
 * AnivDay / BirthDay は配列 [{ Day:{Month,DayOfMonth}, DayAbout_JP }]。
 * hideText / _Jump 等の非配列ケースはスキップ（500 にしない）。
 * @param {object} env
 * @returns {Promise<object[]>}
 */
async function collectAnniversaries(env) {
  // 記念日フィールドを持つ可能性のあるレコードだけを LIKE で絞る（軽量化）
  const rows = await d1Query(
    env,
    `SELECT work_key, db_name, data_json FROM records
       WHERE is_private = 0
         AND (data_json LIKE '%"AnivDay"%' OR data_json LIKE '%"BirthDay"%')`,
    []
  );

  const base = jstTodayBase();
  const items = [];
  const seen = new Set(); // 同一(name|kind|月|日|about)の重複レコードを排除

  for (const row of rows) {
    let rec;
    try { rec = JSON.parse(row.data_json); } catch { continue; }
    if (!rec || typeof rec !== "object") continue;

    const name       = rec.Name_JP ?? rec.FormalName_JP ?? rec.Name_EN ?? "";
    const formalName = rec.FormalName_JP ?? "";

    for (const kind of ["AnivDay", "BirthDay"]) {
      const entries = rec[kind];
      if (!Array.isArray(entries)) continue; // hideText / _Jump 等は対象外
      for (const e of entries) {
        const day = e?.Day;
        if (!day || typeof day !== "object") continue;
        const month = Number(day.Month);
        const dom   = Number(day.DayOfMonth);
        const du    = daysUntilAnniversary(month, dom, base);
        if (du === null || du > DASHBOARD_ANIV_WINDOW_DAYS) continue;
        const dedupeKey = `${name}|${kind}|${month}|${dom}|${e?.DayAbout_JP ?? ""}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        items.push({
          source:      "anniversary",
          sourceLabel: kind === "BirthDay" ? "誕生日" : "記念日",
          kind,
          name,
          formalName,
          work:        row.work_key,
          month,
          day:         dom,
          about:       e?.DayAbout_JP ?? "",
          daysUntil:   du,
          priority:    anniversaryPriority(du),
        });
      }
    }
  }

  // 残日数昇順 → 同日は名前順
  items.sort((a, b) =>
    a.daysUntil - b.daysUntil || String(a.name).localeCompare(String(b.name), "ja")
  );
  return items;
}

/**
 * GitHub Search API を 1 クエリ実行して issue/PR 配列を返す。
 * トークンはヘッダーにのみ使用し、レスポンスには一切含めない。
 * @param {string} token
 * @param {string} q - 検索クエリ
 * @returns {Promise<object[]>}
 */
async function githubSearch(token, q) {
  const url = `https://api.github.com/search/issues?per_page=20&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "100BeautiesLab-CreationsDB-Dashboard",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new ApiError(res.status, `GitHub API ${res.status}`);
  }
  const json = await res.json();
  const list = Array.isArray(json.items) ? json.items : [];
  // 必要最小限のフィールドのみ抽出（トークン・機微情報は載せない）
  return list.map((it) => ({
    title:      it.title ?? "",
    number:     it.number ?? null,
    url:        it.html_url ?? "",
    repo:       (it.repository_url ?? "").replace("https://api.github.com/repos/", ""),
    isPr:       !!it.pull_request,
    state:      it.state ?? "open",
    updatedAt:  it.updated_at ?? "",
  }));
}

/**
 * GitHub パネル用データを集約。GITHUB_TOKEN 未設定なら configured:false を返す。
 * @param {object} env
 * @returns {Promise<object>}
 */
async function collectGithub(env) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    // 未設定はエラーにせず空配列＋フラグで返す
    return {
      configured: false,
      error: null,
      groups: { reviewRequested: [], assigned: [], authoredIssues: [], authoredPrs: [] },
    };
  }

  const user = DASHBOARD_GITHUB_USER;
  try {
    const [reviewRequested, assigned, authoredIssues, authoredPrs] = await Promise.all([
      githubSearch(token, `is:open is:pr review-requested:${user}`),
      githubSearch(token, `is:open assignee:${user}`),
      githubSearch(token, `is:open is:issue author:${user}`),
      githubSearch(token, `is:open is:pr author:${user}`),
    ]);
    return {
      configured: true,
      error: null,
      groups: { reviewRequested, assigned, authoredIssues, authoredPrs },
    };
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : "GitHub fetch failed";
    return {
      configured: true,
      error: msg,
      groups: { reviewRequested: [], assigned: [], authoredIssues: [], authoredPrs: [] },
    };
  }
}

/**
 * /dashboard/data の集約本体。
 * @param {object} env
 * @returns {Promise<object>}
 */
async function buildDashboardData(env) {
  const [anniversaries, github] = await Promise.all([
    collectAnniversaries(env),
    collectGithub(env),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    tz: DASHBOARD_TZ,
    anniversaries: { windowDays: DASHBOARD_ANIV_WINDOW_DAYS, items: anniversaries },
    github,
    // Cloudflare Workers 稼働状況: 別途 API トークンが必要なため今回はスキップ
    workersStatus: { available: false, note: "Cloudflare API トークン未設定のため非対応" },
    // 端末ローカル情報（scheduled-tasks / session_info）は Web 版では非対応
    localOnly: { available: false, note: "この端末ローカル情報のため Web 版では非対応" },
  };
}

/** Today Action Board 本体 HTML（セルフコンテインド・モバイル幅・ライト基調） */
const DASHBOARD_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Today Action Board — 100BeautiesLab. CreationsDB</title>
<style>
  :root {
    --bg: #f6f7fb; --card: #ffffff; --ink: #1f2430; --muted: #6b7280;
    --line: #e6e8ef; --accent: #4f46e5;
    --urgent: #e11d48; --urgent-bg: #fff1f3;
    --today: #d97706;  --today-bg: #fff7ed;
    --ref: #2563eb;    --ref-bg: #eff6ff;
    --aniv: #7c3aed;   --gh: #111827;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif;
    -webkit-font-smoothing: antialiased; padding: env(safe-area-inset-top) 0 24px;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 16px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
  h1 { font-size: 1.15rem; margin: 0; letter-spacing: .02em; }
  .sub { color: var(--muted); font-size: .72rem; }
  .bar { display: flex; align-items: center; gap: 8px; margin: 12px 0 18px; flex-wrap: wrap; }
  button#refresh {
    border: 1px solid var(--line); background: var(--card); color: var(--ink);
    padding: 8px 14px; border-radius: 999px; font-size: .82rem; cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px;
  }
  button#refresh:active { transform: scale(.98); }
  .status { font-size: .72rem; color: var(--muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; display: inline-block; }
  .dot.live { background: #22c55e; }
  section.col { margin-bottom: 22px; }
  .col-head { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; }
  .col-head h2 { font-size: .92rem; margin: 0; }
  .pill { font-size: .68rem; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
  .pill.urgent { color: var(--urgent); background: var(--urgent-bg); }
  .pill.today  { color: var(--today);  background: var(--today-bg); }
  .pill.reference { color: var(--ref); background: var(--ref-bg); }
  .count { color: var(--muted); font-size: .72rem; }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    padding: 12px 14px; margin-bottom: 10px; box-shadow: 0 1px 2px rgba(20,25,40,.04);
  }
  .card.urgent { border-left: 4px solid var(--urgent); }
  .card.today  { border-left: 4px solid var(--today); }
  .card.reference { border-left: 4px solid var(--ref); }
  .card .row1 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
  .badge { font-size: .66rem; padding: 2px 8px; border-radius: 6px; font-weight: 600; color: #fff; }
  .badge.aniv { background: var(--aniv); }
  .badge.gh   { background: var(--gh); }
  .when { margin-left: auto; font-size: .74rem; color: var(--muted); white-space: nowrap; }
  .when.d0 { color: var(--urgent); font-weight: 700; }
  .title { font-size: .92rem; font-weight: 600; line-height: 1.35; }
  .title a { color: inherit; text-decoration: none; }
  .title a:hover { text-decoration: underline; }
  .meta { font-size: .74rem; color: var(--muted); margin-top: 2px; }
  .empty { color: var(--muted); font-size: .82rem; padding: 10px 2px; }
  .ghpanel { background: var(--card); border: 1px dashed var(--line); border-radius: 14px; padding: 14px; }
  .ghpanel.unset { color: var(--muted); font-size: .84rem; }
  .note { font-size: .7rem; color: var(--muted); margin-top: 4px; }
  footer { margin-top: 26px; font-size: .68rem; color: var(--muted); line-height: 1.6; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Today Action Board</h1>
    <span class="sub">100BeautiesLab. CreationsDB</span>
  </header>
  <div class="bar">
    <button id="refresh" type="button"><span aria-hidden="true">&#x21bb;</span> 更新</button>
    <span class="status"><span class="dot" id="livedot"></span> <span id="statustext">読み込み中…</span></span>
  </div>

  <section class="col" id="col-urgent">
    <div class="col-head"><h2>緊急</h2><span class="pill urgent">今日 / 要対応</span><span class="count" id="cnt-urgent"></span></div>
    <div id="list-urgent"></div>
  </section>

  <section class="col" id="col-today">
    <div class="col-head"><h2>本日中</h2><span class="pill today">まもなく</span><span class="count" id="cnt-today"></span></div>
    <div id="list-today"></div>
  </section>

  <section class="col" id="col-reference">
    <div class="col-head"><h2>参考</h2><span class="pill reference">今後 14 日</span><span class="count" id="cnt-reference"></span></div>
    <div id="list-reference"></div>
  </section>

  <footer id="foot"></footer>
</div>

<script>
(function () {
  "use strict";
  var DATA_URL = "/dashboard/data";
  var timer = null;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function whenLabel(d) {
    if (d === 0) return "今日";
    if (d === 1) return "明日";
    return "あと " + d + " 日";
  }
  function workLabel(w) {
    return esc(String(w || "").replace(/^#?Works_/, ""));
  }

  function anivCard(it) {
    var d0 = it.daysUntil === 0 ? " d0" : "";
    var mmdd = it.month + "/" + it.day;
    var sub = it.formalName && it.formalName !== it.name ? " ・ " + esc(it.formalName) : "";
    return '<div class="card ' + it.priority + '">' +
      '<div class="row1">' +
        '<span class="badge aniv">' + esc(it.sourceLabel) + '</span>' +
        '<span class="when' + d0 + '">' + whenLabel(it.daysUntil) + '</span>' +
      '</div>' +
      '<div class="title">' + esc(it.name) + sub + '</div>' +
      '<div class="meta">' + mmdd + (it.about ? ' ・ ' + esc(it.about) : '') + ' ・ ' + workLabel(it.work) + '</div>' +
    '</div>';
  }

  function ghCard(it, priority) {
    var kind = it.isPr ? "PR" : "Issue";
    return '<div class="card ' + priority + '">' +
      '<div class="row1">' +
        '<span class="badge gh">GitHub</span>' +
        '<span class="when">' + esc(kind) + (it.number ? " #" + it.number : "") + '</span>' +
      '</div>' +
      '<div class="title"><a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a></div>' +
      '<div class="meta">' + esc(it.repo) + '</div>' +
    '</div>';
  }

  function render(data) {
    var buckets = { urgent: [], today: [], reference: [] };

    (data.anniversaries && data.anniversaries.items || []).forEach(function (it) {
      buckets[it.priority] = buckets[it.priority] || [];
      buckets[it.priority].push(anivCard(it));
    });

    var gh = data.github || { configured: false, groups: {} };
    var g = gh.groups || {};
    if (gh.configured && !gh.error) {
      (g.reviewRequested || []).forEach(function (it) { buckets.urgent.push(ghCard(it, "urgent")); });
      (g.assigned || []).forEach(function (it) { buckets.today.push(ghCard(it, "today")); });
      (g.authoredPrs || []).forEach(function (it) { buckets.reference.push(ghCard(it, "reference")); });
      (g.authoredIssues || []).forEach(function (it) { buckets.reference.push(ghCard(it, "reference")); });
    }

    ["urgent", "today", "reference"].forEach(function (k) {
      var html = (buckets[k] || []).join("");
      el("list-" + k).innerHTML = html || '<div class="empty">項目はありません</div>';
      el("cnt-" + k).textContent = (buckets[k] || []).length ? "(" + buckets[k].length + ")" : "";
    });

    // GitHub 未設定 / エラー時の注記を参考列の末尾に追加
    if (!gh.configured) {
      el("list-reference").insertAdjacentHTML("beforeend",
        '<div class="ghpanel unset">GitHub: トークン未設定（<code>wrangler secret put GITHUB_TOKEN</code> 設定後に表示）</div>');
    } else if (gh.error) {
      el("list-reference").insertAdjacentHTML("beforeend",
        '<div class="ghpanel unset">GitHub: 取得エラー（' + esc(gh.error) + '）</div>');
    }

    var hasNow = (buckets.urgent.length + buckets.today.length) > 0;
    el("livedot").className = "dot" + (hasNow ? " live" : "");
    var t = new Date(data.generatedAt);
    el("statustext").textContent = "更新 " + t.toLocaleTimeString("ja-JP") + " ・ TZ " + (data.tz || "Asia/Tokyo");

    var foot = "記念日は " + (data.anniversaries ? data.anniversaries.windowDays : 14) +
      " 日以内を表示（is_private=0）。";
    if (data.workersStatus && !data.workersStatus.available) foot += " Workers稼働: " + esc(data.workersStatus.note) + "。";
    if (data.localOnly && !data.localOnly.available) foot += " スケジュール/セッション情報: " + esc(data.localOnly.note) + "。";
    el("foot").innerHTML = foot;

    return hasNow;
  }

  function scheduleNext(hasNow) {
    if (timer) clearTimeout(timer);
    // 当日/緊急があるときのみ短間隔(12s)、無ければ低頻度(90s)
    timer = setTimeout(load, hasNow ? 12000 : 90000);
  }

  function load() {
    el("statustext").textContent = "更新中…";
    fetch(DATA_URL, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) { var hasNow = render(data); scheduleNext(hasNow); })
      .catch(function (e) {
        el("statustext").textContent = "取得失敗: " + e.message;
        el("livedot").className = "dot";
        scheduleNext(false);
      });
  }

  el("refresh").addEventListener("click", load);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
  load();
})();
</script>
</body>
</html>`;

// ─────────────────────────────────────────────────────────────────────────────
// ルーティング
// ─────────────────────────────────────────────────────────────────────────────

/**
 * リクエストをルーティングして Response を返す
 * @param {Request} request
 * @param {object} env - Workers バインディング (BUCKET, DB)
 * @returns {Promise<Response>}
 */
async function handleRequest(request, env) {
  const url      = new URL(request.url);
  const pathname = url.pathname;

  // CORS プリフライト
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (request.method !== "GET") {
    return errorResponse(405, "Method not allowed");
  }

  // ── Today Action Board ────────────────────────────────────────────────────
  // GET /dashboard       — HTML 本体（セルフコンテインド）
  // GET /dashboard/data  — 記念日(D1)+GitHub(REST) 集約 JSON（読み取り専用）
  if (pathname === "/dashboard" || pathname === "/dashboard/") {
    return htmlResponse(DASHBOARD_HTML);
  }
  if (pathname === "/dashboard/data") {
    try {
      const data = await buildDashboardData(env);
      return jsonResponse(data);
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err.status, err.message);
      console.error("[Dashboard]", err);
      return errorResponse(500, "Dashboard data error");
    }
  }

  // パス解析: /api/v1/...
  const match = pathname.match(/^\/api\/v1(\/.*)?$/);
  if (!match) return errorResponse(404, "Not found");
  const sub      = (match[1] || "/").replace(/\/$/, "") || "/";
  const segments = sub.split("/").filter(Boolean);

  try {
    // ── GET /api/v1/meta ────────────────────────────────────────────────────
    if (segments.length === 1 && segments[0] === "meta") {
      const meta = await getGlobalMeta(env);
      return jsonResponse(meta);
    }

    // ── GET /api/v1/works ───────────────────────────────────────────────────
    if (segments.length === 1 && segments[0] === "works") {
      const rows = await d1Query(
        env,
        "SELECT key, title, title_en, summary, meta_json FROM works WHERE is_hidden = 0"
      );
      const works = rows.map((r) => {
        const info = r.meta_json ? JSON.parse(r.meta_json) : {};
        return {
          key:           r.key,
          Title:         r.title         ?? "",
          Title_EN:      r.title_en       ?? "",
          Works_Summary: r.summary        ?? "",
          OldTitles:     info.OldTitles   ?? [],
          Works_OfficialLinks: info.Works_OfficialLinks ?? [],
        };
      });
      return jsonResponse(works);
    }

    // :work が必要なルート
    if (segments.length >= 2) {
      const rawWork = segments[0];
      const workKey = toWorkKey(rawWork);
      if (!workKey) return errorResponse(400, "Invalid work ID");

      // Works_Hidden チェック (D1)
      const workRow = await d1First(
        env,
        "SELECT is_hidden FROM works WHERE key = ?",
        [workKey]
      );
      if (workRow?.is_hidden) return errorResponse(404, "Work not found");

      // ── GET /api/v1/:work/meta ───────────────────────────────────────────
      if (segments[1] === "meta" && segments.length === 2) {
        const workMeta = await getWorkMeta(env, workKey);
        return jsonResponse(workMeta ?? { key: workKey });
      }

      // ── GET /api/v1/:work/dbs ────────────────────────────────────────────
      if (segments[1] === "dbs" && segments.length === 2) {
        const rows = await d1Query(
          env,
          "SELECT db_key, db_label, db_label_en, db_layer FROM dbs WHERE work_key = ? AND is_hidden = 0",
          [workKey]
        );
        const dbs = rows.map((r) => ({
          key:     r.db_key.replace(/^#?(DB|Ref)_/i, ""),
          label:   r.db_label    ?? r.db_key,
          labelEN: r.db_label_en ?? r.db_key,
          layer:   r.db_layer    ?? "DataBases",
        }));
        return jsonResponse(dbs);
      }

      // ── GET /api/v1/:work/search?q=... ──────────────────────────────────
      if (segments[1] === "search" && segments.length === 2) {
        const q = (url.searchParams.get("q") ?? "").trim();
        if (!q) return jsonResponse([]);
        const results = await searchAllRecordsInD1(env, workKey, q);
        const workMeta = await getWorkMeta(env, workKey);
        // 横断検索は DB ごとに _Commons が異なるため、レコード単位で適用してから非公開判定する
        // （FTS のヒット順を保つため、DB でグルーピングせず元の並びのまま処理する）
        const visible = [];
        for (const { db, record } of results) {
          const [enriched] = applyCommons([record], workMeta, db);
          if (isPublicRecord(enriched)) visible.push({ db, record: enriched });
        }
        return jsonResponse(visible);
      }

      // :db が必要なルート
      if (segments.length >= 3) {
        const rawDb  = segments[1];
        const dbNorm = stripMetaDbPrefix(rawDb);
        if (!isSafeToken(dbNorm)) return errorResponse(400, "Invalid DB name");

        // DB_Hidden チェック (D1)
        const dbRow = await d1First(
          env,
          "SELECT is_hidden FROM dbs WHERE work_key = ? AND (db_key = ? OR db_key = ?)",
          [workKey, `#DB_${capitalize(dbNorm)}`, `#Ref_${capitalize(dbNorm)}`]
        );
        if (dbRow?.is_hidden) return errorResponse(404, "DB not found");

        // ── GET /api/v1/:work/:db/records ──────────────────────────────────
        if (segments[2] === "records" && segments.length === 3) {
          const records = await getRecordsFromD1(env, workKey, capitalize(dbNorm));
          const workMeta = await getWorkMeta(env, workKey);
          // D1 の is_private フィルタに加え、_Commons 適用後にも非公開判定を行う（多層防御）。
          // migrate.mjs を再実行していない古い D1 が残っていても非公開レコードを返さない。
          const enriched = applyCommons(records, workMeta, dbNorm).filter(isPublicRecord);
          return jsonResponse(enriched);
        }

        // ── GET /api/v1/:work/:db/records/:idx?idxKey=... ─────────────────
        if (segments[2] === "records" && segments.length === 4) {
          const idxValue = decodeURIComponent(segments[3]);
          const idxKey   = url.searchParams.get("idxKey") ?? "Num";
          // num 後方互換: Num インデックス前提の旧パラメータ
          const resolvedIdxKey = (url.searchParams.get("num") && !url.searchParams.get("idxKey"))
            ? "Num" : idxKey;
          if (!isSafeToken(resolvedIdxKey.replace(/\./g, "")))
            return errorResponse(400, "Invalid idxKey");

          const rec = await getRecordFromD1(
            env, workKey, capitalize(dbNorm), idxValue, resolvedIdxKey
          );
          if (!rec) return errorResponse(404, "Record not found");

          const workMeta = await getWorkMeta(env, workKey);
          const [enriched] = applyCommons([rec], workMeta, dbNorm);
          // _Commons 経由で isPrivate が注入されるレコードは 404 とする（多層防御）
          if (!isPublicRecord(enriched)) return errorResponse(404, "Record not found");
          return jsonResponse(enriched);
        }

        // ── GET /api/v1/:work/:db/search?q=... ────────────────────────────
        if (segments[2] === "search" && segments.length === 3) {
          const q = (url.searchParams.get("q") ?? "").trim();
          if (!q) return jsonResponse([]);
          const hits = await searchRecordsInD1(env, workKey, capitalize(dbNorm), q);
          const workMeta = await getWorkMeta(env, workKey);
          // 検索結果にも records エンドポイントと同じ _Commons 適用 + 非公開除外を通す
          // （従来は生レコードを返しており、_Commons 経由の isPrivate を取りこぼしていた）
          const visible = applyCommons(hits, workMeta, dbNorm).filter(isPublicRecord);
          return jsonResponse(visible);
        }
      }
    }
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err.status, err.message);
    console.error("[CreationsDB Worker]", err);
    return errorResponse(500, "Internal server error");
  }

  return errorResponse(404, "Not found");
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Workers エクスポート
// ─────────────────────────────────────────────────────────────────────────────

export default {
  /**
   * Cloudflare Workers fetch ハンドラー
   * @param {Request} request
   * @param {object} env - wrangler.toml で定義したバインディング (BUCKET, DB)
   * @param {ExecutionContext} ctx
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
};
