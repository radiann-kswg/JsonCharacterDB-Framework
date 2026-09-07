/**
 * CreationsDB Node.js ライブラリ
 *
 * 100BeautiesLab_CreationsDB をサブモジュールとして導入した環境から
 * ファイルシステム経由で DB レコードを取得・検索するためのクライアントライブラリ。
 * Service Worker / ブラウザ API に依存せず、Node.js (ESM) で単独動作します。
 *
 * 対応する DB 機構（`lib/sw-common.js` / `lib/data-common.js` の移植）:
 * - `isPrivate` 除外 / `_Commons` / `_Secondaries` 補完
 * - `Works_Hidden` / `DB_Hidden` による非公開制御（一覧・直接アクセスの双方を遮断）
 * - `Works_Dir` / `Works_ImagesDir` / `Works_Shared` オーバーライド（共通資料の疑似作品）
 * - `$IndexDef` / `$IndexDef_<DbNorm>` によるインデックスキーのスキーマ駆動解決
 * - 旧作品名エイリアス（`Proxies` → `Works_DestinyFoxRecords`）
 *
 * 未対応（SW 専用。Cloudflare Workers 版と同じスコープ）:
 * - `_DBLink` / `_Jump` の参照解決 enrich
 *
 * @fileoverview Node.js 向け CreationsDB クライアント
 * @author 100BeautiesLab Creations Database Team
 * @version 1.1.0
 * @example
 * import { CreationsDBClient } from './pkg/nodejs/index.mjs';
 * const client = new CreationsDBClient();
 * const works = await client.listWorks();
 * const records = await client.getRecords('NumberTales', 'Primary');
 * // インデックスキーはスキーマから自動解決される（例: FLInvestigator78 → "Card.Suit"）
 * const card = await client.getRecord('FLInvestigator78', 'Primary', 'Wands');
 */

import { readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// 定数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * デフォルトのリポジトリルート。
 * このファイル (pkg/nodejs/index.mjs) の 2 階層上がリポジトリルートになる。
 * サブモジュールとして配置すれば `new CreationsDBClient()` だけで動作する。
 * @type {string}
 */
const _DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * 旧作品名 → 現行ディレクトリ名のエイリアス表。
 * `lib/sw-common.js` / `lib/data-common.js` の同名テーブルと同期させること。
 * @type {Record<string, string>}
 */
const LEGACY_WORK_DIR_ALIASES = { Proxies: 'Works_DestinyFoxRecords' };

// ─────────────────────────────────────────────────────────────────────────────
// エラー型
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 対象が存在しない・非公開のため参照できない場合に投げられるエラー。
 * Service Worker / Workers 版の 404 レスポンスに対応する。
 */
export class CreationsDBNotFoundError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'CreationsDBNotFoundError';
    this.code = 'NOT_FOUND';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部ユーティリティ（sw-common.js の DataUtils / SearchEngine を fs 向けに移植）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 安全なトークン（作品ID・DB名）かどうかを判定（英数字とアンダースコアのみ許可）
 * @param {any} s
 * @returns {boolean}
 */
function isSafeToken(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  return /^[A-Za-z0-9_]+$/.test(s);
}

/**
 * プレーンオブジェクト判定（配列・null を除く）
 * @param {any} v
 * @returns {boolean}
 */
function isObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 先頭文字を大文字化
 * @param {string} s
 * @returns {string}
 */
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * ドット記法でオブジェクトから値を取得（例: "Card.Num"）
 * @param {any} obj
 * @param {string} path
 * @returns {any}
 */
function getByPath(obj, path) {
  return String(path).split('.').reduce((cur, k) => (cur == null ? undefined : cur[k]), obj);
}

/**
 * 作品IDを `#Works_<Name>` 形式に正規化
 * @param {string} id - 入力ID（"NumberTales" / "Works_NumberTales" / "#Works_NumberTales" いずれも可）
 * @returns {string|null}
 */
function toWorkKey(id) {
  if (!id) return null;
  const raw = String(id).trim();
  const normalized = raw.startsWith('#Works_') ? raw
    : raw.startsWith('Works_') ? `#${raw}`
    : `#Works_${raw}`;
  const m = normalized.match(/^#Works_([A-Za-z0-9_]+)$/);
  return m ? `#Works_${m[1]}` : null;
}

/**
 * Works_XXX ディレクトリ名を解決（`#Works_XXX` → `Works_XXX`、旧作品名エイリアスを適用）
 * `Works_Dir` オーバーライドは含まない（そちらは resolveWorkDir() が担当）。
 * @param {string} workId
 * @returns {string}
 */
function resolveWorkDirName(workId) {
  const bare = String(workId || '').replace(/^#/, '').replace(/^Works_/, '');
  return LEGACY_WORK_DIR_ALIASES[bare] || `Works_${bare}`;
}

/**
 * DB メタキーから prefix を除いた DB 名を返す
 * @param {string} dbName
 * @returns {string}
 */
function stripMetaDbPrefix(dbName) {
  return String(dbName || '').trim().replace(/^#?(DB|Ref|Loc)_/i, '').replace(/^[#]/, '');
}

/**
 * `databases` オブジェクトから DB エントリを検索
 * @param {Object} databases
 * @param {string} dbName
 * @returns {{ metaKey: string|null, entry: Object|null }}
 */
function findMetaDbEntry(databases, dbName) {
  if (!isObject(databases)) return { metaKey: null, entry: null };
  const norm = capitalize(stripMetaDbPrefix(dbName));
  const candidates = [`#DB_${norm}`, `#Ref_${norm}`, `#Loc_${norm}`];
  for (const metaKey of candidates) {
    if (isObject(databases[metaKey])) return { metaKey, entry: databases[metaKey] };
  }
  return { metaKey: candidates[0], entry: null };
}

/**
 * DB エントリから物理レイヤー名を解決
 * @param {Object|null} dbEntry
 * @returns {string}
 */
function resolveDbLayer(dbEntry) {
  const raw = typeof dbEntry?.DB_Layer === 'string' ? dbEntry.DB_Layer.trim() : '';
  return isSafeToken(raw) ? raw : 'DataBases';
}

/**
 * DB エントリから明示ファイル名（`DB_File`）を解決
 * @param {Object|null} dbEntry
 * @returns {string} 不正・未指定なら空文字
 */
function resolveDbFile(dbEntry) {
  const raw = typeof dbEntry?.DB_File === 'string' ? dbEntry.DB_File.trim() : '';
  return /^[A-Za-z0-9_.-]+\.json$/.test(raw) ? raw : '';
}

/**
 * メタキーの種別からデフォルトのファイル名 prefix を決定
 * @param {string|null} metaKey
 * @returns {string}
 */
function resolveDbFilePrefix(metaKey) {
  const key = String(metaKey || '');
  if (key.startsWith('#Ref_')) return 'ref_';
  if (key.startsWith('#Loc_')) return 'trans_';
  return 'db_';
}

/**
 * DB ファイルのベースディレクトリを組み立てる。
 * layer が workDir 自身と一致する場合（`Works_Dir` オーバーライドにより workDir と
 * DB_Layer が同名になる共通資料の疑似作品等）はレイヤーセグメントを畳み込み、
 * `data/References/References/...` のような二重ディレクトリを避ける。
 * @param {string} workDir - 物理ディレクトリ名
 * @param {string} layer - DB_Layer
 * @returns {string} ルート相対のベースパス
 */
function buildDbBasePath(workDir, layer) {
  return `/data/${workDir}${(layer && layer !== workDir) ? `/${layer}` : ''}`;
}

/**
 * isPrivate フラグによる非公開レコードを除外
 * @param {Object} record
 * @returns {boolean} 公開対象なら true
 */
function isPublicRecord(record) {
  if (!isObject(record)) return true;
  return !(record.isPrivate === true || String(record.isPrivate || '').trim().toLowerCase() === 'true');
}

/**
 * `$IndexDef` からインデックスキーのドットパスを導出する。
 * `pkg/cloudflare/scripts/migrate.mjs` の resolveIdxKey() と同一規則。
 * ネスト型（`$type` が配列）の場合は `#IndexListKey` → `#Number` → 先頭要素 の
 * 優先順で主インデックスの子要素を選ぶ。
 * @param {Object|null} indexDef
 * @returns {string} 例: "Num" / "Card.Suit" / "BeastType.Beast"
 */
function resolveIdxKeyFromIndexDef(indexDef) {
  if (!isObject(indexDef)) return 'Num';
  const root = indexDef.hashTag ?? 'Num';
  const types = indexDef.$type;
  if (!Array.isArray(types)) return root;

  const findChild = (pred) => types.find((t) => typeof t?.$type === 'string' && pred(t.$type));
  const primary =
    findChild((t) => t.includes('#IndexListKey')) ??
    findChild((t) => t.includes('#Number')) ??
    types[0];

  return primary?.hashTag ? `${root}.${primary.hashTag}` : root;
}

/**
 * `_Commons` 適用時の空値判定。
 * undefined だけでなく null / 空文字 / 空オブジェクトも未設定扱いにする。
 * `{ hideText: '...' }` は意図的マスクなので空扱いしない。
 * `[]` は「該当なし」の明示宣言（例: `Belonging: []` = 無所属）なので空扱いしない。
 * @param {any} v
 * @returns {boolean}
 */
function isEmptyForCommons(v) {
  if (v === null || typeof v === 'undefined') return true;
  if (v === '') return true;
  if (Array.isArray(v)) return false;
  if (isObject(v)) {
    if (typeof v.hideText === 'string' && v.hideText) return false;
    return Object.keys(v).length === 0;
  }
  return false;
}

/**
 * `db_meta.json` の `_Commons` / `_Secondaries` をレコード配列へ非破壊適用。
 * `lib/sw-common.js` CommonsProcessor.applyCommonsToRecords() の移植版。
 * @param {Array} records
 * @param {Object} workMeta
 * @param {string} dbName
 * @returns {Array}
 */
function applyCommonsToRecords(records, workMeta, dbName) {
  try {
    if (!Array.isArray(records)) return records;
    const { entry: dbEntry } = findMetaDbEntry(workMeta?.Databases, dbName);
    const commons = dbEntry?._Commons;
    const secDefs = dbEntry?._Secondaries ?? dbEntry?.Secondaries;
    if (!commons && !Array.isArray(secDefs)) return records;

    const CONDITIONAL_PREFIX = '_ListLinkIf_';
    const normStr = (v) => (v === null || typeof v === 'undefined') ? '' : String(v);

    /** レコード内を深さ優先で探索し、最初に見つかったキーの値を返す */
    const deepFindFirstByKey = (obj, key) => {
      if (!isObject(obj)) return undefined;
      if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
      for (const v of Object.values(obj)) {
        if (isObject(v)) {
          const found = deepFindFirstByKey(v, key);
          if (typeof found !== 'undefined') return found;
        }
      }
      return undefined;
    };

    /** `_Commons` オブジェクトから、当該レコードへ適用する既定値を組み立てる */
    const buildDefaultsFromCommons = (cmn, rec) => {
      if (!isObject(cmn)) return {};
      const out = {};

      // 1) 単純な commons
      for (const [k, v] of Object.entries(cmn)) {
        if (k.startsWith('_') || k.startsWith('#')) continue;
        out[k] = v;
      }

      // 2) 条件付き commons（`_ListLinkIf_<Field>`）
      for (const [k, arr] of Object.entries(cmn)) {
        if (!k.startsWith(CONDITIONAL_PREFIX) || !Array.isArray(arr)) continue;
        const field = k.substring(CONDITIONAL_PREFIX.length);
        let curVal = typeof rec[field] !== 'undefined' ? rec[field] : undefined;
        if (typeof curVal === 'undefined' && isObject(rec.Card) && typeof rec.Card[field] !== 'undefined') curVal = rec.Card[field];
        if (typeof curVal === 'undefined' && isObject(rec.SpecType) && typeof rec.SpecType[field] !== 'undefined') curVal = rec.SpecType[field];
        if (typeof curVal === 'undefined') curVal = deepFindFirstByKey(rec, field);
        if (curVal === null || typeof curVal === 'undefined') continue;

        const match = arr.find((it) => isObject(it)
          && Object.prototype.hasOwnProperty.call(it, field)
          && String(it[field]) === String(curVal));
        if (!match) continue;
        for (const [ik, iv] of Object.entries(match)) {
          if (ik === field || ik.startsWith('_') || ik.startsWith('#')) continue;
          out[ik] = iv;
        }
      }
      return out;
    };

    // `_Secondaries` の条件軸。sec_SeriesTitle を主キー、他は追加条件として扱う。
    const criteriaDefs = [
      { primary: true, defKeys: ['sec_SeriesTitle', 'SecondarySeriesTitle', 'SecondarySeriesTitle_EN'], recPaths: ['sec_SeriesTitle', 'SecondarySeriesTitle'] },
      { primary: false, defKeys: ['sec_Category', 'SecondaryCategory'], recPaths: ['sec_Category', 'SecondaryCategory'] },
      { primary: false, defKeys: ['sec_DesignedBy', 'SecondaryDesignedBy'], recPaths: ['sec_DesignedBy', 'SecondaryDesignedBy'] }
    ];

    /**
     * レコードに適用すべき `_Secondaries` 定義を選ぶ。
     * `sec_**` を一切指定しない定義はデフォルト fallback、条件付き定義が一致すればそちらを優先する。
     */
    const findSecondaryCommons = (rec) => {
      if (!Array.isArray(secDefs)) return null;

      // defVal が文字列 → recVal（配列可）に含まれれば一致 / defVal が配列 → 全要素が含まれれば一致
      const matchesCriteria = (defVal, recVal) => {
        const toArr = (v) => (Array.isArray(v) ? v : [v]).map(normStr).filter((s) => s !== '');
        const defArr = toArr(defVal);
        const recArr = toArr(recVal);
        if (defArr.length === 0) return true;
        if (recArr.length === 0) return false;
        return defArr.every((d) => recArr.some((r) => r === d));
      };
      const getFirst = (obj, keys) => {
        for (const k of keys) {
          if (k && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
        }
        return undefined;
      };
      const getRec = (paths) => {
        for (const p of paths) {
          const v = getByPath(rec, p);
          if (v !== null && typeof v !== 'undefined') return v;
        }
        return undefined;
      };
      const isBlank = (v) => v === null || typeof v === 'undefined' || normStr(v).trim() === '';

      let defaultSecondaryDef = null;
      let bestSecondaryDef = null;
      let bestScore = -1;

      for (const def of secDefs) {
        if (!isObject(def) || !isObject(def._Commons)) continue;

        // sec_** を一つも指定しない定義はデフォルト fallback として退避
        const hasAnyCondition = criteriaDefs.some((c) => !isBlank(getFirst(def, c.defKeys)));
        if (!hasAnyCondition) {
          if (defaultSecondaryDef === null) defaultSecondaryDef = def;
          continue;
        }

        const primaryCriteria = criteriaDefs.find((x) => x.primary);
        const hasPrimaryCondition = !isBlank(getFirst(def, primaryCriteria.defKeys));

        let score = 0;
        let ok = true;

        for (const c of criteriaDefs) {
          const defVal = getFirst(def, c.defKeys);
          if (isBlank(defVal)) continue; // 条件なし（ワイルドカード）

          const recVal = getRec(c.recPaths);

          // 主キー（sec_SeriesTitle）は必須一致
          if (c.primary) {
            if (!matchesCriteria(defVal, recVal)) { ok = false; break; }
            score += 10;
            continue;
          }

          // primary がある場合、追加条件はレコード側に値がある場合のみ絞り込みに使う。
          // primary が無い場合、追加条件が実質 primary になるため必須一致とする。
          const recEmpty = isBlank(recVal);
          if (hasPrimaryCondition) {
            if (recEmpty) continue;
            if (!matchesCriteria(defVal, recVal)) { ok = false; break; }
            score += 1;
            continue;
          }
          if (recEmpty || !matchesCriteria(defVal, recVal)) { ok = false; break; }
          score += 1;
        }

        if (ok && score > bestScore) { bestScore = score; bestSecondaryDef = def; }
      }

      const chosen = bestSecondaryDef ?? defaultSecondaryDef;
      return chosen ? chosen._Commons : null;
    };

    return records.map((rec) => {
      if (!isObject(rec)) return rec;
      const dbDefaults = buildDefaultsFromCommons(commons, rec);
      const secCommons = findSecondaryCommons(rec);
      const secDefaults = secCommons ? buildDefaultsFromCommons(secCommons, rec) : {};
      const defaults = { ...dbDefaults, ...secDefaults };

      const out = { ...rec };
      for (const [k, v] of Object.entries(defaults)) {
        if (k.startsWith('#') || k.startsWith('_')) continue;
        if (isEmptyForCommons(out[k])) out[k] = v;
      }
      return out;
    });
  } catch {
    return records;
  }
}

/**
 * テキスト全文検索（searchableText または全フィールドを対象）
 * @param {Array} records
 * @param {string} query
 * @returns {Array}
 */
function searchText(records, query) {
  if (!query || !Array.isArray(records)) return records;
  const q = String(query).toLowerCase();
  return records.filter((rec) => {
    const text = (rec?._enrichment?.searchableText ?? JSON.stringify(rec)).toLowerCase();
    return text.includes(q);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ファイルシステム I/O
// ─────────────────────────────────────────────────────────────────────────────

/**
 * リポジトリルートを基準に絶対パスを解決（`/data/...` → `<repoRoot>/data/...`）
 * @param {string} repoRoot
 * @param {string} path - ルート相対パス（先頭 `/` は除去）
 * @returns {string}
 */
function resolvePath(repoRoot, path) {
  return join(repoRoot, path.replace(/^\//, ''));
}

/**
 * JSON ファイルを読み込んでパース
 * @param {string} repoRoot
 * @param {string} path - ルート相対パス
 * @returns {Promise<any>}
 * @throws ファイルが見つからない・パース失敗の場合
 */
async function fetchJSON(repoRoot, path) {
  const content = await readFile(resolvePath(repoRoot, path), 'utf-8');
  return JSON.parse(content);
}

/**
 * ファイル存在確認
 * @param {string} repoRoot
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function fileExists(repoRoot, path) {
  try {
    await access(resolvePath(repoRoot, path));
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// メタ / 型定義 読み込みヘルパー
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 辞書バンドル（`data/Dictionaries/` または作品別 Dictionaries/）を読み込み
 * @param {string} repoRoot
 * @param {string} basePath - ルート相対ディレクトリパス
 * @returns {Promise<{ meta: Object, vars: Object }>}
 */
async function readDictionaryBundle(repoRoot, basePath) {
  let meta = {};
  let typeVars = {};
  try { meta = await fetchJSON(repoRoot, `${basePath}/db_meta.json`); } catch { /* 無くても続行 */ }
  try {
    const t = await fetchJSON(repoRoot, `${basePath}/db_type.json`);
    if (isObject(t?.$VarsDef)) typeVars = t.$VarsDef;
  } catch { /* 無くても続行 */ }

  const catalogs = isObject(meta?.Dictionaries) ? meta.Dictionaries : {};
  const vars = { ...typeVars };

  for (const [rawKey, info] of Object.entries(catalogs)) {
    if (!isObject(info)) continue;
    const dictName = String(rawKey).replace(/^#Dict_/, '').trim();
    if (!dictName) continue;
    const dictKey = rawKey.startsWith('#Dict_') ? rawKey.trim() : `#Dict_${dictName}`;
    const compatKey = typeof info.compatListKey === 'string' && info.compatListKey.trim()
      ? info.compatListKey.trim() : `#List_${dictName}`;
    try {
      const rows = await fetchJSON(repoRoot, `${basePath}/dict_${dictName}.json`);
      if (!Array.isArray(rows)) continue;
      vars[dictKey] = rows.map((r) => (isObject(r) ? { ...r } : r));
      if (compatKey && !vars[compatKey]) {
        vars[compatKey] = vars[dictKey].map((r) => (isObject(r) ? { ...r } : r));
      }
    } catch { /* 辞書ファイルが未作成でも続行 */ }
  }
  return { meta, vars };
}

/**
 * vars / dictMeta をメタオブジェクトへ合流
 * @param {Object} meta
 * @param {Object} vars
 * @param {Object} dictMeta
 * @returns {Object}
 */
function mergeMetaWithVars(meta, vars = {}, dictMeta = {}) {
  const m = isObject(meta) ? meta : {};
  const v = isObject(vars) ? vars : {};
  const dm = isObject(dictMeta) ? dictMeta : {};

  const metaGeneral = isObject(m.General) ? m.General : {};
  const metaVars = isObject(metaGeneral.$VarsDef) ? metaGeneral.$VarsDef : {};
  const mergedVars = { ...metaVars, ...v };

  const baseDicts = isObject(m.Dictionaries) ? m.Dictionaries : {};
  const extraDicts = isObject(dm.Dictionaries) ? dm.Dictionaries : {};

  return {
    ...m,
    ...(Object.keys(extraDicts).length > 0 ? { Dictionaries: { ...baseDicts, ...extraDicts } } : {}),
    General: { ...metaGeneral, $VarsDef: mergedVars }
  };
}

/**
 * 作品ベースメタ（`<workDir>/DataBases/db_meta.json`）を読み込み、
 * 無ければ直下の `db_meta.json` へフォールバックする。
 * `Works_Dir` オーバーライドで `DataBases/` を持たない作品（共通資料の疑似作品等）向け。
 * @param {string} repoRoot
 * @param {string} workDir
 * @returns {Promise<Object>}
 */
async function fetchWorkBaseMeta(repoRoot, workDir) {
  try {
    return await fetchJSON(repoRoot, `/data/${workDir}/DataBases/db_meta.json`);
  } catch {
    return await fetchJSON(repoRoot, `/data/${workDir}/db_meta.json`);
  }
}

/**
 * 作品型定義（`<workDir>/DataBases/db_type.json`）を読み込み、
 * 無ければ直下の `db_type.json` へフォールバックする。
 * @param {string} repoRoot
 * @param {string} workDir
 * @returns {Promise<Object>}
 */
async function fetchWorkType(repoRoot, workDir) {
  try {
    return await fetchJSON(repoRoot, `/data/${workDir}/DataBases/db_type.json`);
  } catch {
    try {
      return await fetchJSON(repoRoot, `/data/${workDir}/db_type.json`);
    } catch {
      return {};
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 公開 API クラス
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CreationsDB Node.js クライアント
 *
 * サブモジュールとして導入した 100BeautiesLab_CreationsDB リポジトリの
 * データを Node.js 環境から直接取得します。
 *
 * @example
 * // サブモジュール構成ではパス指定なし（index.mjs から自動解決）
 * import { CreationsDBClient } from './submodules/100BeautiesLab_CreationsDB/pkg/nodejs/index.mjs';
 * const db = new CreationsDBClient();
 *
 * // 任意のパスを明示する場合
 * const db = new CreationsDBClient('/path/to/100BeautiesLab_CreationsDB');
 */
export class CreationsDBClient {
  /**
   * @param {string} [repoRoot] - サブモジュールのルートディレクトリ絶対パス。
   *   省略時は index.mjs の 2 階層上を自動的にリポジトリルートとして使用する。
   * @param {Object} [options]
   * @param {boolean} [options.includePrivate=false] - `isPrivate: true` のレコードを含めるか
   * @param {boolean} [options.includeHidden=false] - `Works_Hidden` / `DB_Hidden` の作品・DB を含めるか。
   *   既定では公開制御を尊重し、一覧からの除外に加えて直接アクセスも
   *   {@link CreationsDBNotFoundError} で遮断する（SW / Workers の 404 と同等）。
   *   リポジトリ所有者のローカルツール等、非公開データを意図的に扱う場合のみ true にする。
   */
  constructor(repoRoot = _DEFAULT_REPO_ROOT, options = {}) {
    this.repoRoot = resolve(repoRoot);
    this.includePrivate = Boolean(options.includePrivate ?? false);
    this.includeHidden = Boolean(options.includeHidden ?? false);
    /** @type {{ globalMetaRaw: Object|null, worksDir: Map<string,string>|null }} */
    this._cache = { globalMetaRaw: null, worksDir: null };
  }

  // ── 内部ヘルパー ────────────────────────────────────────────────────────

  /**
   * グローバルメタを辞書合流なしで軽量に読み込む（キャッシュ付き）
   * @returns {Promise<Object>}
   * @private
   */
  async _getGlobalMetaRaw() {
    if (!this._cache.globalMetaRaw) {
      this._cache.globalMetaRaw = await fetchJSON(this.repoRoot, '/data/db_meta.json');
    }
    return this._cache.globalMetaRaw;
  }

  /**
   * `CreationWorks.*.Works_Dir` のオーバーライド表を取得（キャッシュ付き）
   * @returns {Promise<Map<string,string>>} workId(#Works_*) → 物理ディレクトリ名
   * @private
   */
  async _getWorksDirOverrides() {
    if (this._cache.worksDir) return this._cache.worksDir;
    const map = new Map();
    try {
      const raw = await this._getGlobalMetaRaw();
      for (const [key, info] of Object.entries(raw?.CreationWorks || {})) {
        const dir = typeof info?.Works_Dir === 'string' ? info.Works_Dir.trim() : '';
        if (dir && isSafeToken(dir)) map.set(key, dir);
      }
    } catch {
      // 取得失敗時は空表を返し、全 work が resolveWorkDirName() へフォールバックする
    }
    this._cache.worksDir = map;
    return map;
  }

  /**
   * 作品IDから物理ディレクトリ名を解決（`Works_Dir` オーバーライド対応）
   * @param {string} workKey - `#Works_*` 形式の作品ID
   * @returns {Promise<string>}
   * @private
   */
  async _resolveWorkDir(workKey) {
    const overrides = await this._getWorksDirOverrides();
    return overrides.get(workKey) || resolveWorkDirName(workKey);
  }

  /**
   * 作品IDを正規化し、`Works_Hidden` による非公開チェックを行う
   * @param {string} workId
   * @returns {Promise<string>} `#Works_*` 形式の作品ID
   * @throws {TypeError} 作品IDが不正な場合
   * @throws {CreationsDBNotFoundError} `Works_Hidden: true` かつ includeHidden=false の場合
   * @private
   */
  async _requireVisibleWork(workId) {
    const key = toWorkKey(workId);
    if (!key) throw new TypeError(`Invalid workId: ${workId}`);
    if (this.includeHidden) return key;
    try {
      const raw = await this._getGlobalMetaRaw();
      if (raw?.CreationWorks?.[key]?.Works_Hidden === true) {
        throw new CreationsDBNotFoundError(`Work not found: ${workId}`);
      }
    } catch (e) {
      if (e instanceof CreationsDBNotFoundError) throw e;
      // グローバルメタが読めない場合は非公開判定をスキップして続行する
    }
    return key;
  }

  /**
   * 作品メタ（辞書合流済み）を読み込む。メタ欠損時は null を返す。
   * @param {string} workKey
   * @returns {Promise<Object|null>}
   * @private
   */
  async _readWorkMeta(workKey) {
    const workDir = await this._resolveWorkDir(workKey);
    let meta;
    try {
      meta = await fetchWorkBaseMeta(this.repoRoot, workDir);
    } catch {
      return null; // メタは追加価値レイヤー。欠損時も DB 取得は継続させる
    }
    const { vars, meta: dictMeta } = await readDictionaryBundle(this.repoRoot, `/data/${workDir}/Dictionaries`);
    return mergeMetaWithVars(meta, vars, dictMeta);
  }

  /**
   * DB ファイルを探索してレコード配列を読み込む（`DB_Hidden` チェック込み）
   * @param {string} workKey
   * @param {string} dbName
   * @returns {Promise<{ records: Array, workMeta: Object|null }>}
   * @private
   */
  async _readDBRecords(workKey, dbName) {
    const norm = stripMetaDbPrefix(dbName);
    if (!isSafeToken(norm)) throw new TypeError(`Invalid dbName: ${dbName}`);
    const key = capitalize(norm);

    const workMeta = await this._readWorkMeta(workKey);
    const { metaKey, entry: dbEntry } = findMetaDbEntry(workMeta?.Databases, key);

    // DB_Hidden: true の DB は一覧だけでなく直接アクセスからも遮断する
    if (!this.includeHidden && dbEntry?.DB_Hidden === true) {
      throw new CreationsDBNotFoundError(`DB not found: ${workKey}/${dbName}`);
    }

    const workDir = await this._resolveWorkDir(workKey);
    const layer = resolveDbLayer(dbEntry);
    const base = buildDbBasePath(workDir, layer);
    const configuredFile = resolveDbFile(dbEntry);
    const defaultPrefix = resolveDbFilePrefix(metaKey);

    const conventional = {
      Primary: 'db_Primary.json', Secondary: 'db_Secondary.json',
      SemiPrimary: 'db_SemiPrimary.json', SelfSecondary: 'db_SelfSecondary.json',
      Proxy: 'db_Proxy.json', Mobs: 'db_Mobs.json'
    };

    const candidates = [
      ...(configuredFile ? [configuredFile] : []),
      ...(conventional[key] ? [conventional[key]] : []),
      `${defaultPrefix}${key}.json`,
      ...(key.toLowerCase() !== norm.toLowerCase() ? [`${defaultPrefix}${norm}.json`] : []),
      ...(defaultPrefix !== 'db_' ? [`db_${key}.json`] : [])
    ];

    for (const fname of candidates) {
      if (await fileExists(this.repoRoot, `${base}/${fname}`)) {
        return { records: await fetchJSON(this.repoRoot, `${base}/${fname}`), workMeta };
      }
    }
    throw new CreationsDBNotFoundError(`DB file not found for workId=${workKey} dbName=${dbName}`);
  }

  // ── メタデータ系 ─────────────────────────────────────────────────────────

  /**
   * グローバルメタデータを取得（`data/db_meta.json` + Dictionaries 合流済み）
   * @returns {Promise<Object>}
   */
  async getMeta() {
    const meta = await fetchJSON(this.repoRoot, '/data/db_meta.json');
    const { vars, meta: dictMeta } = await readDictionaryBundle(this.repoRoot, '/data/Dictionaries');
    return mergeMetaWithVars(meta, vars, dictMeta);
  }

  /**
   * 作品一覧を取得（`Works_Hidden: true` の作品は除外）
   * @returns {Promise<Array<{ key: string, Title_JP: string, Title_EN: string, Works_Summary_JP: string, Works_Summary_EN: string, Works_Shared: boolean, OldTitles: Array, Works_OfficialLinks: Array }>>}
   */
  async listWorks() {
    const globalMeta = await this.getMeta();
    return Object.entries(globalMeta.CreationWorks ?? {})
      .filter(([, info]) => this.includeHidden || info?.Works_Hidden !== true)
      .map(([key, info]) => ({
        key,
        Title_JP: typeof info?.Title_JP === 'string' ? info.Title_JP : '',
        Title_EN: typeof info?.Title_EN === 'string' ? info.Title_EN : '',
        Works_Summary_JP: typeof info?.Works_Summary_JP === 'string' ? info.Works_Summary_JP : '',
        Works_Summary_EN: typeof info?.Works_Summary_EN === 'string' ? info.Works_Summary_EN : '',
        // 全作品共通の資料を束ねる疑似作品（例: 共通資料）は個別の創作タイトルと区別する
        Works_Shared: info?.Works_Shared === true,
        OldTitles: Array.isArray(info?.OldTitles) ? info.OldTitles : [],
        // 公式サイト等の外部リンク（各要素 { URL, Label_JP, Label_EN, LinkType }）
        Works_OfficialLinks: Array.isArray(info?.Works_OfficialLinks) ? info.Works_OfficialLinks : []
      }));
  }

  /**
   * 作品別メタデータを取得
   * @param {string} workId - 作品ID（例: "NumberTales" / "Works_NumberTales" / "#Works_NumberTales"）
   * @returns {Promise<Object>}
   * @throws {CreationsDBNotFoundError} `Works_Hidden` の作品、またはメタが存在しない場合
   */
  async getWorkMeta(workId) {
    const key = await this._requireVisibleWork(workId);
    const meta = await this._readWorkMeta(key);
    if (!meta) throw new CreationsDBNotFoundError(`Work meta not found: ${workId}`);
    return meta;
  }

  /**
   * 作品別の型定義（`db_type.json`）を取得
   * @param {string} workId
   * @returns {Promise<Object>} 未存在時は空オブジェクト
   */
  async getWorkType(workId) {
    const key = await this._requireVisibleWork(workId);
    const workDir = await this._resolveWorkDir(key);
    return fetchWorkType(this.repoRoot, workDir);
  }

  /**
   * 指定作品で利用可能な DB 一覧を取得（`DB_Hidden: true` は除外）
   * @param {string} workId
   * @returns {Promise<Array<{ key: string, file: string, layer: string, DB_Label: string, DB_Label_EN: string, DB_Image: string }>>}
   */
  async listDBs(workId) {
    const key = await this._requireVisibleWork(workId);
    const workDir = await this._resolveWorkDir(key);
    const workMeta = await this._readWorkMeta(key);
    const exist = [];

    if (isObject(workMeta?.Databases)) {
      for (const [dbKey, dbEntry] of Object.entries(workMeta.Databases)) {
        if (!this.includeHidden && dbEntry?.DB_Hidden === true) continue;
        // Localization (#Loc_*) は翻訳データ。閲覧対象の DB としては扱わない
        if (dbKey.startsWith('#Loc_')) continue;

        const norm = stripMetaDbPrefix(dbKey);
        const name = capitalize(norm);
        const layer = resolveDbLayer(dbEntry);
        const base = buildDbBasePath(workDir, layer);
        const configuredFile = resolveDbFile(dbEntry);
        const defaultPrefix = resolveDbFilePrefix(dbKey);

        const candidates = [
          ...(configuredFile ? [configuredFile] : []),
          `${defaultPrefix}${name}.json`,
          ...(name.toLowerCase() !== norm.toLowerCase() ? [`${defaultPrefix}${norm}.json`] : []),
          ...(defaultPrefix !== 'db_' ? [`db_${name}.json`] : [])
        ];

        for (const fname of candidates) {
          if (await fileExists(this.repoRoot, `${base}/${fname}`)) {
            exist.push({
              key: name,
              file: fname,
              layer,
              DB_Label: typeof dbEntry?.DB_Label === 'string' ? dbEntry.DB_Label : name,
              DB_Label_EN: typeof dbEntry?.DB_Label_EN === 'string' ? dbEntry.DB_Label_EN : name,
              // DB 全体の代表画像（特定レコードに紐づかない）
              DB_Image: typeof dbEntry?.DB_Image === 'string' ? dbEntry.DB_Image : ''
            });
            break;
          }
        }
      }
      if (exist.length > 0) return exist;
    }

    // メタ未整備の作品はデフォルトファイル名を探索
    const base = `/data/${workDir}/DataBases`;
    const defaults = [
      'Primary', 'Secondary', 'SemiPrimary', 'SelfSecondary', 'Proxy', 'Mobs',
      'PrimaryDealer', 'PrimaryMobs', 'UnprocessedSecondary'
    ];
    for (const name of defaults) {
      if (await fileExists(this.repoRoot, `${base}/db_${name}.json`)) {
        exist.push({ key: name, file: `db_${name}.json`, layer: 'DataBases', DB_Label: name, DB_Label_EN: name, DB_Image: '' });
      }
    }
    return exist;
  }

  /**
   * DB のインデックスキー（ドット記法）をスキーマから解決する。
   *
   * 解決順:
   * 1. 作品 typedef のサイドカー `$IndexDef_<DbNorm>`（DB 単位の上書き）
   * 2. 作品 typedef の `$IndexDef`（作品既定）
   * 3. グローバルメタの `$DefType_Index` / `$Def_Index`（後方互換）
   * 4. `"Num"`（最終フォールバック）
   *
   * @param {string} workId
   * @param {string} [dbName] - DB 名。省略時は作品既定のインデックスキーを返す
   * @returns {Promise<string>} 例: "Num" / "Card.Suit" / "Generation"
   * @example
   * await db.getIndexKey('FLInvestigator78', 'Primary');       // → "Card.Suit"
   * await db.getIndexKey('DestinyFoxRecords', 'Proxy');        // → "Generation"（サイドカー）
   * await db.getIndexKey('DestinyFoxRecords');                 // → "Unit"（作品既定）
   */
  async getIndexKey(workId, dbName) {
    const key = await this._requireVisibleWork(workId);
    const workType = await this.getWorkType(key);

    const dbNorm = dbName ? capitalize(stripMetaDbPrefix(dbName)) : '';
    const scoped = dbNorm ? workType?.[`$IndexDef_${dbNorm}`] : null;
    if (isObject(scoped)) return resolveIdxKeyFromIndexDef(scoped);
    if (isObject(workType?.$IndexDef)) return resolveIdxKeyFromIndexDef(workType.$IndexDef);

    // 後方互換: 旧グローバルメタ側の宣言
    try {
      const raw = await this._getGlobalMetaRaw();
      const workMeta = raw?.CreationWorks?.[key];
      const legacy = workMeta?.$DefType_Index ?? workMeta?.$Def_Index;
      if (isObject(legacy)) return resolveIdxKeyFromIndexDef(legacy);
    } catch { /* フォールバックへ */ }

    return 'Num';
  }

  /**
   * 出力パス（RoleplayPrompts 等）用に、インデックスの「フォルダキー」と「ファイルキー」を
   * `$IndexDef` から宣言的に解決する（実データ走査に依存しない）。
   * - `$type` が文字列（単一キー）: フォルダキー = ファイルキー = root（例: `Num` / `Generation`）
   * - `$type` が配列: フォルダキー = 先頭要素、ファイルキー = `$display.index.link:true` を持つ要素
   *   （link 指定が無ければフォルダキーと同一 = 先頭だけで完結）
   *
   * 例:
   * - NumberTales/Primary（`$type` 文字列）→ `{ folderKey:'Num', fileKey:'Num', splitFolder:false }`
   * - ShouArRiders/Primary（配列・link 無し）→ `{ folderKey:'BeastType.Beast', fileKey:'BeastType.Beast', splitFolder:false }`
   * - FLInvestigator78/PrimaryDealer（配列・Num に link）→ `{ folderKey:'Card.Suit', fileKey:'Card.Num', splitFolder:true }`
   *
   * @param {string} workId
   * @param {string} [dbName]
   * @returns {Promise<{folderKey: string, fileKey: string, splitFolder: boolean}>}
   *   folderKey/fileKey はドット記法。splitFolder=true でフォルダ分け、false で suffix 完結。
   */
  async resolveIndexPathRoles(workId, dbName) {
    const key = await this._requireVisibleWork(workId);
    const workType = await this.getWorkType(key);
    const dbNorm = dbName ? capitalize(stripMetaDbPrefix(dbName)) : '';
    const scoped = dbNorm ? workType?.[`$IndexDef_${dbNorm}`] : null;
    const indexDef = isObject(scoped) ? scoped : (isObject(workType?.$IndexDef) ? workType.$IndexDef : null);

    // $IndexDef 未定義: getIndexKey の単一キーにフォールバック
    if (!isObject(indexDef)) {
      const k = await this.getIndexKey(workId, dbName);
      return { folderKey: k, fileKey: k, splitFolder: false };
    }

    const root = indexDef.hashTag ?? 'Num';
    const types = indexDef.$type;

    // $type が文字列 → 単一キーで完結
    if (!Array.isArray(types)) {
      return { folderKey: root, fileKey: root, splitFolder: false };
    }

    // $type が配列 → 先頭要素をフォルダキー、link:true 要素をファイルキー
    const children = types.filter((t) => t && typeof t.hashTag === 'string');
    if (!children.length) {
      return { folderKey: root, fileKey: root, splitFolder: false };
    }
    const folderKey = `${root}.${children[0].hashTag}`;
    const linkChild = children.find((t) => t?.$display?.index?.link === true);
    const fileKey = linkChild ? `${root}.${linkChild.hashTag}` : folderKey;

    return { folderKey, fileKey, splitFolder: fileKey !== folderKey };
  }

  // ── レコード取得系 ──────────────────────────────────────────────────────

  /**
   * DB のレコード一覧を取得
   * @param {string} workId
   * @param {string} dbName - DB 名（例: "Primary" / "Secondary"）
   * @param {Object} [options]
   * @param {boolean} [options.applyCommons=true] - `_Commons` / `_Secondaries` 補完を適用するか
   * @returns {Promise<Array<Object>>}
   * @throws {CreationsDBNotFoundError} 非公開（`Works_Hidden` / `DB_Hidden`）または DB 未存在の場合
   */
  async getRecords(workId, dbName, options = {}) {
    const key = await this._requireVisibleWork(workId);
    const applyCommons = options.applyCommons !== false;

    const { records: raw, workMeta } = await this._readDBRecords(key, dbName);
    if (!Array.isArray(raw)) return [];

    // `_Commons` / `_Secondaries` は isPrivate を注入しうる（例: 特定の二次創作シリーズ全体を
    // `_Secondaries[].._Commons.isPrivate: true` で非公開にする）。
    // そのため isPrivate のフィルタは _Commons 適用「後」に行う。
    // 逆順にすると、レコード自身が isPrivate を宣言していない限り注入値が読まれず、
    // 非公開指定のレコードが公開されてしまう。
    let records = raw;
    if (applyCommons && workMeta) {
      records = applyCommonsToRecords(records, workMeta, dbName);
    }
    if (!this.includePrivate) {
      records = records.filter(isPublicRecord);
    }
    return records;
  }

  /**
   * インデックス値でレコードを 1 件取得
   * @param {string} workId
   * @param {string} dbName
   * @param {string|number} idxValue - インデックス値（例: "1", "Wands", "Wrath"）
   * @param {string} [idxKey] - インデックスフィールド名（ドット記法可）。
   *   省略時はスキーマ（`$IndexDef` / `$IndexDef_<DbNorm>`）から自動解決する。
   * @returns {Promise<Object|null>}
   */
  async getRecord(workId, dbName, idxValue, idxKey) {
    const resolvedKey = idxKey || await this.getIndexKey(workId, dbName);
    const records = await this.getRecords(workId, dbName);
    const target = String(idxValue);

    return records.find((rec) => {
      const v = getByPath(rec, resolvedKey);
      return v != null && String(v) === target;
    }) ?? null;
  }

  /**
   * 全文検索（`searchableText` または JSON 全体を対象）
   * @param {string} workId
   * @param {string} dbName
   * @param {string} query - 検索キーワード（部分一致、大小文字無視）
   * @returns {Promise<Array<Object>>}
   */
  async search(workId, dbName, query) {
    const records = await this.getRecords(workId, dbName);
    return searchText(records, query);
  }

  /**
   * 作品内の全 DB にわたる全文検索
   * @param {string} workId
   * @param {string} query
   * @returns {Promise<Array<{ db: string, record: Object }>>}
   */
  async searchAll(workId, query) {
    const dbs = await this.listDBs(workId);
    const results = [];
    for (const dbInfo of dbs) {
      // 非公開 DB は listDBs で除外済み。個別 DB の読み込み失敗は全体を止めない
      let hits = [];
      try {
        hits = await this.search(workId, dbInfo.key, query);
      } catch {
        continue;
      }
      for (const record of hits) {
        results.push({ db: dbInfo.key, record });
      }
    }
    return results;
  }
}

// デフォルトエクスポート（import creationsdb from '...' 形式にも対応）
export default CreationsDBClient;
