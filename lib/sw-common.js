/**
 * Service Worker 共通ライブラリ
 *
 * GitHub Pages上で動作する疑似API機能の共通実装を提供します。
 * 複数のService Workerファイル間で重複していた機能を統合し、
 * 参照解決、データフェッチ、検索機能などを共通化しています。
 *
 * @fileoverview Service Worker共通機能ライブラリ
 * @author 100BeautiesLab Creations Database Team
 * @version 1.0.0
 */

// グローバル設定
const CACHE_NAME = '100bl-api-v1';
const WORK_CTX_TTL_MS = 15 * 1000; // インメモリキャッシュのTTL
const WORK_CTX_CACHE = new Map(); // workId -> { t, mergedVars, defTypeMerged, indices }
let worksDirOverrideCache = null; // { t, map: Map<workKey, dirName> } — CreationWorks.*.Works_Dir のオーバーライド表

// 旧作品「Works_Proxies」直リンク・API直叩き互換: 統合先(Works_DestinyFoxRecords)へ読み替える
const LEGACY_WORK_DIR_ALIASES = { Proxies: 'Works_DestinyFoxRecords' };

function resolveWorkDirName(workId) {
	const dir = String(workId || '').replace('#Works_', 'Works_');
	const bare = dir.replace(/^Works_/, '');
	return LEGACY_WORK_DIR_ALIASES[bare] || dir;
}

function isPublicRecord(record) {
	if (!record || typeof record !== 'object' || Array.isArray(record)) return true;
	return !(record.isPrivate === true || String(record.isPrivate || '').trim().toLowerCase() === 'true');
}

function filterPublicRecords(records) {
	if (!Array.isArray(records)) return [];
	return records.filter(isPublicRecord);
}

function getCharacterValueWrapperRegistry() {
	return self?.CharacterValueWrapperRegistry || globalThis?.CharacterValueWrapperRegistry || null;
}

function buildDatabaseCatalogWrapperSummaries(dbMeta, typeSources = []) {
	const registry = getCharacterValueWrapperRegistry();
	if (!dbMeta || typeof dbMeta !== 'object') return {};
	if (!registry || typeof registry.formatWithRegisteredWrapper !== 'function') return {};

	const entries = registry?.helpers?.resolveTypeDefEntries?.(typeSources, '$Def_DatabaseCatalog');
	if (!Array.isArray(entries) || entries.length === 0) return {};

	const summaries = {};
	for (const entry of entries) {
		const key = typeof entry?.hashTag === 'string' ? entry.hashTag.trim() : '';
		if (!key || typeof dbMeta[key] === 'undefined') continue;

		const summary = registry.formatWithRegisteredWrapper(dbMeta[key], {
			schemaType: entry?.$type,
			fieldKey: key,
			typeSources
		});
		if (!summary) continue;

		summaries[`${key}Summary`] = String(summary).trim();
	}

	return summaries;
}

/**
 * Service Worker基本設定クラス
 * スコープパスやAPIプレフィックスの計算を担当
 */
class SWConfig {
	/**
	 * @param {string} scopePath - Service Workerのスコープパス
	 */
	constructor(scopePath) {
		this.SCOPE_PATH = scopePath;
		this.REPO_BASE = this.computeRepoBase(scopePath);
		this.API_PREFIX = `${scopePath}/v1`;
		this.ORIGIN = self.location.origin;
	}

	/**
	 * スコープの親ディレクトリを計算
	 * @param {string} scopePath - スコープパス
	 * @returns {string} リポジトリベースパス
	 */
	computeRepoBase(scopePath) {
		const idx = scopePath.lastIndexOf('/');
		if (idx <= 0) return '/';
		return scopePath.substring(0, idx) + '/';
	}

	/**
	 * パスにリポジトリベースを付加
	 * @param {string} path - 変換するパス
	 * @returns {string} リポジトリベース付きのパス
	 */
	withRepoBase(path) {
		if (!path) return path;
		if (path.startsWith('http://') || path.startsWith('https://')) return path;
		if (path.startsWith('/')) return `${this.REPO_BASE}${path.slice(1)}`;
		return `${this.REPO_BASE}${path}`;
	}
}

/**
 * HTTPレスポンス生成ユーティリティ
 */
class ResponseUtils {
	/**
	 * JSON レスポンスを生成
	 * @param {Object} obj - レスポンスオブジェクト
	 * @param {number} status - HTTPステータスコード
	 * @param {Object} headers - 追加ヘッダー
	 * @returns {Response} JSONレスポンス
	 */
	static jsonResponse(obj, status = 200, headers = {}) {
		return new Response(JSON.stringify(obj, null, 2), {
			status,
			headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
		});
	}

	/**
	 * 404エラーレスポンスを生成
	 * @param {string} message - エラーメッセージ
	 * @returns {Response} 404レスポンス
	 */
	static notFound(message = 'Not Found') {
		return ResponseUtils.jsonResponse({ error: message }, 404);
	}

	/**
	 * 400エラーレスポンスを生成
	 * @param {string} message - エラーメッセージ
	 * @returns {Response} 400レスポンス
	 */
	static badRequest(message = 'Bad Request') {
		return ResponseUtils.jsonResponse({ error: message }, 400);
	}
}

/**
 * データフェッチクラス
 * JSONファイルの読み込みとファイル存在確認を担当
 */
class DataFetcher {
	/**
	 * @param {SWConfig} config - Service Worker設定オブジェクト
	 */
	constructor(config) {
		this.config = config;
		// リクエストスコープのメモ化状態（beginRequestScope / endRequestScope で開閉）。
		// ネストと並行リクエストに耐えるよう参照カウントで管理し、カウントが 0 へ戻った時点で
		// キャッシュごと破棄する。TTL を持たないためリクエストをまたいで古い内容が残ることはない
		this._scopeDepth = 0;
		this._scopeCache = null;
	}

	/**
	 * リクエストスコープのメモ化を開始する
	 *
	 * @description
	 * 1 リクエストの処理中に同じメタ/型/辞書 JSON を何度も取り直すのを防ぐ。
	 * `bootstrap` のように「全作品 × 全DB」を総なめするエンドポイントでは、`readWorkMeta()` が
	 * `readDbMetaEntry()` / `readDB()` / enrich の各所から繰り返し呼ばれ、同一の `db_meta.json` を
	 * 数十回フェッチし直していた（実測: `Works_FLInvestigator78/DataBases/db_meta.json` が 39 回）。
	 *
	 * ネスト呼び出しと並行リクエストに備えて参照カウントで管理する。`endRequestScope()` で
	 * カウントが 0 へ戻ったらキャッシュを破棄するため、**リクエストをまたいだ鮮度の後退は起きない**
	 * （並行する複数リクエストが重なっている間だけキャッシュを共有する）。
	 * @returns {void}
	 */
	beginRequestScope() {
		this._scopeDepth += 1;
		if (!this._scopeCache) this._scopeCache = new Map();
	}

	/**
	 * リクエストスコープのメモ化を終了する
	 *
	 * @description 参照カウントを 1 減らし、0 になったらキャッシュを破棄する。
	 * `beginRequestScope()` と必ず `try/finally` で対にすること。
	 * @returns {void}
	 */
	endRequestScope() {
		if (this._scopeDepth > 0) this._scopeDepth -= 1;
		if (this._scopeDepth === 0) this._scopeCache = null;
	}

	/**
	 * スコープが有効なら Promise をメモ化して返す
	 *
	 * @description
	 * 解決値ではなく **Promise 自体**をキャッシュするため、逐次呼び出しだけでなく
	 * 並行呼び出しも 1 本のフェッチへ合流する。
	 * 失敗（404 等）も同一リクエスト内では再試行しない。`readRefMeta()` / `readLocMeta()` のように
	 * 「無ければ空を返す」分岐が多く、同一リクエスト内で再取得しても結果は変わらないため。
	 * @param {string} key - キャッシュキー
	 * @param {() => Promise<*>} factory - 実処理
	 * @returns {Promise<*>} メモ化された Promise（スコープ無効時は factory の結果をそのまま返す）
	 */
	_memoizeInScope(key, factory) {
		const cache = this._scopeCache;
		if (!cache) return factory();
		if (cache.has(key)) return cache.get(key);
		const promise = factory();
		// 保存した Promise が誰にも await されないまま reject すると
		// unhandled rejection になるため、保存時点で握り潰し用の catch を派生させておく
		// （元の Promise は reject のまま返るので、呼び出し側の try/catch は従来どおり働く）
		promise.catch(() => { });
		cache.set(key, promise);
		return promise;
	}

	/**
	 * JSON パスをリクエストスコープでメモ化してよいか判定する
	 *
	 * @description
	 * **メタ・型・辞書だけを対象とし、レコード本体（`db_*.json` / `ref_*.json` / `trans_*.json`）は
	 * 決してメモ化しない。** `CommonsProcessor.applyCommonsToRecords()` はレコードを in-place で
	 * 書き換える（`rec[k] = v`）ため、レコード配列をキャッシュすると 2 番目以降の利用者が
	 * `_Commons` 適用済みの配列を受け取り、別 DB 文脈の値が混ざる。
	 * 一方メタ・型・辞書は読み取り専用で扱われ、`mergeMetaWithDictionaryBundle()` も
	 * スプレッドで新しいオブジェクトを組み立てる非破壊実装のため共有して安全。
	 * @param {string} path - フェッチ対象のパス
	 * @returns {boolean} メモ化対象なら true
	 */
	_isMemoizableJsonPath(path) {
		const p = String(path || '');
		if (p.includes('/Dictionaries/')) return true;
		return /\/db_(meta|type)\.json$/.test(p);
	}

	/**
	 * DBメタ定義を取得
	 * @param {string} workId - 作品識別子
	 * @param {string} dbName - データベース名
	 * @returns {Promise<Object|null>} DBメタ定義
	 */
	async readDbMetaEntry(workId, dbName) {
		try {
			const meta = await this.readWorkMeta(workId);
			return DataUtils.findMetaDbEntry(meta?.Databases, dbName);
		} catch {
			return { metaKey: null, entry: null };
		}
	}

	/**
	 * DBレイヤー名を解決
	 * @param {Object|null} dbMeta - DBメタ定義
	 * @returns {string} レイヤーディレクトリ名
	 */
	resolveDbLayer(dbMeta) {
		const raw = typeof dbMeta?.DB_Layer === 'string' ? dbMeta.DB_Layer.trim() : '';
		return DataUtils.isSafeToken(raw) ? raw : 'DataBases';
	}

	/**
	 * DBファイル名の既定プレフィックスを解決
	 * @param {string|null} metaKey - DBメタキー
	 * @returns {string} 既定ファイル名プレフィックス
	 */
	resolveDbFilePrefix(metaKey) {
		const key = String(metaKey || '');
		if (key.startsWith('#Ref_')) return 'ref_';
		if (key.startsWith('#Loc_')) return 'trans_';
		return 'db_';
	}

	/**
	 * DBファイル名を解決
	 * @param {Object|null} dbMeta - DBメタ定義
	 * @returns {string} 正規化済みファイル名。未指定時は空文字
	 */
	resolveDbFile(dbMeta) {
		const raw = typeof dbMeta?.DB_File === 'string' ? dbMeta.DB_File.trim() : '';
		if (!raw) return '';
		return /^[A-Za-z0-9_.-]+\.json$/.test(raw) ? raw : '';
	}

	/**
	 * JSON ファイルをフェッチして解析
	 * @param {string} path - フェッチするパス
	 * @returns {Promise<Object>} 解析されたJSONオブジェクト
	 * @throws {Error} フェッチに失敗した場合
	 */
	async fetchJSON(path) {
		const run = async () => {
			const url = new URL(this.config.withRepoBase(path), this.config.ORIGIN).toString();
			const res = await fetch(url, { cache: 'no-store' });
			if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
			return res.json();
		};
		// レコード本体は共有すると _Commons の in-place 適用が混ざるためメモ化しない
		if (!this._isMemoizableJsonPath(path)) return run();
		return this._memoizeInScope(`json:${path}`, run);
	}

	/**
	 * ファイルの存在を確認
	 * @param {string} path - 確認するファイルパス
	 * @returns {Promise<boolean>} ファイルが存在する場合はtrue
	 */
	async fileExists(path) {
		// 真偽値しか返さないため共有しても副作用が無い。
		// `listWorkDBs()` が DB ごとに候補ファイル名を総当たりするので重複が多い
		return this._memoizeInScope(`head:${path}`, async () => {
			try {
				const url = new URL(this.config.withRepoBase(path), this.config.ORIGIN).toString();
				const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
				return res.ok;
			} catch {
				return false;
			}
		});
	}

	/**
	 * CreationWorks.*.Works_Dir のオーバーライド表を取得（TTLキャッシュ付き）
	 * - `data/db_meta.json` を辞書合流なしで軽量に読み、物理ディレクトリ名が
	 *   既定の `Works_<id>` と異なる作品（例: 共通資料の疑似作品）だけを拾う
	 * @returns {Promise<Map<string, string>>} workId(#Works_*) -> 物理ディレクトリ名
	 */
	async getWorksDirOverrides() {
		const now = Date.now();
		if (worksDirOverrideCache && (now - worksDirOverrideCache.t) < WORK_CTX_TTL_MS) {
			return worksDirOverrideCache.map;
		}
		const map = new Map();
		try {
			const raw = await this.fetchJSON('/data/db_meta.json');
			for (const [key, info] of Object.entries(raw?.CreationWorks || {})) {
				const dir = (info && typeof info.Works_Dir === 'string') ? info.Works_Dir.trim() : '';
				if (dir && DataUtils.isSafeToken(dir)) map.set(key, dir);
			}
		} catch (_) {
			// 取得失敗時は空表を返し、全workが従来のresolveWorkDirNameへフォールバックする
		}
		worksDirOverrideCache = { t: now, map };
		return map;
	}

	/**
	 * 作品IDから物理ディレクトリ名を解決（Works_Dir オーバーライド対応）
	 * @param {string} workId - 作品識別子（例: '#Works_CommonReferences'）
	 * @returns {Promise<string>} 物理ディレクトリ名
	 */
	async resolveWorkDir(workId) {
		const overrides = await this.getWorksDirOverrides();
		return overrides.get(workId) || resolveWorkDirName(workId);
	}

	/**
	 * グローバルメタデータを読み込み
	 * @returns {Promise<Object>} グローバルメタデータ
	 */
	async readGlobalMeta() {
		const meta = await this.fetchJSON('/data/db_meta.json');
		const dictBundle = await this.readDictionaryBundle('/data/Dictionaries');
		return this.mergeMetaWithDictionaryBundle(meta, dictBundle.vars, dictBundle.meta);
	}

	/**
	 * グローバル型定義を読み込み
	 * @returns {Promise<Object>} グローバル型定義
	 */
	async readGlobalType() {
		try {
			return await this.fetchJSON('/data/db_type.json');
		} catch (_) {
			return {};
		}
	}

	/**
	 * 作品メタデータを読み込み
	 * @param {string} workId - 作品識別子
	 * @returns {Promise<Object>} 作品メタデータ
	 */
	async readWorkMeta(workId) {
		if (!workId) throw new Error('Invalid workId');
		const workDir = await this.resolveWorkDir(workId);
		const meta = await this.fetchWorkBaseMeta(workDir);
		const refMeta = await this.readRefMeta(workId);
		const locMeta = await this.readLocMeta(workId);
		const mergedWithRef = this.mergeRefDatabases(meta, refMeta);
		const mergedWithLoc = this.mergeLayerDatabases(mergedWithRef, locMeta, 'Localization');
		const dictBundle = await this.readDictionaryBundle(`/data/${workDir}/Dictionaries`);
		return this.mergeMetaWithDictionaryBundle(mergedWithLoc, dictBundle.vars, dictBundle.meta);
	}

	/**
	 * 作品ベースメタ (DataBases/db_meta.json) を読み込み、無ければ直下の db_meta.json を試す
	 * - `Works_Dir` オーバーライドで `DataBases/` サブフォルダを持たない作品（共通資料の疑似作品等）向け
	 * @param {string} workDir - 物理ディレクトリ名
	 * @returns {Promise<Object>} 作品ベースメタ
	 */
	async fetchWorkBaseMeta(workDir) {
		try {
			return await this.fetchJSON(`/data/${workDir}/DataBases/db_meta.json`);
		} catch (_) {
			return await this.fetchJSON(`/data/${workDir}/db_meta.json`);
		}
	}

	/**
	 * 作品型定義を読み込み
	 * @param {string} workId - 作品識別子
	 * @returns {Promise<Object>} 作品型定義
	 */
	async readWorkType(workId) {
		if (!workId) throw new Error('Invalid workId');
		const workDir = await this.resolveWorkDir(workId);
		try {
			return await this.fetchJSON(`/data/${workDir}/DataBases/db_type.json`);
		} catch (_) {
			try {
				return await this.fetchJSON(`/data/${workDir}/db_type.json`);
			} catch (_) {
				return {};
			}
		}
	}

	/**
	 * References レイヤーのメタデータを読み込み（未存在時は空オブジェクトを返す）
	 * @param {string} workId - 作品識別子
	 * @returns {Promise<Object>} References メタデータ
	 */
	async readRefMeta(workId) {
		try {
			const workDir = await this.resolveWorkDir(workId);
			return await this.fetchJSON(`/data/${workDir}/References/db_meta.json`);
		} catch (_) {
			return {};
		}
	}

	/**
	 * References/db_meta.json の Databases エントリを DataBases メタへマージ
	 * - refMeta 側のエントリは DB_Layer: "References" を補完する
	 * - 同一キーが DataBases 側にも存在する場合は DataBases 側を優先
	 * @param {Object} baseMeta - DataBases/db_meta.json から読んだメタ
	 * @param {Object} refMeta - References/db_meta.json から読んだメタ
	 * @returns {Object} マージ後メタデータ
	 */
	/**
	 * 任意レイヤーの Databases エントリを DataBases メタへマージ（汎用）
	 * - layerMeta 側のエントリに DB_Layer が未設定の場合は defaultLayer を補完する
	 * - 同一キーが DataBases 側にも存在する場合は DataBases 側を優先
	 * @param {Object} baseMeta - DataBases/db_meta.json から読んだメタ
	 * @param {Object} layerMeta - レイヤー側 db_meta.json から読んだメタ
	 * @param {string} defaultLayer - DB_Layer 未設定時の既定値
	 * @returns {Object} マージ後メタデータ
	 */
	mergeLayerDatabases(baseMeta, layerMeta, defaultLayer) {
		const layerDbs = layerMeta?.Databases;
		if (!layerDbs || typeof layerDbs !== 'object' || Array.isArray(layerDbs)) return baseMeta;

		const normalized = Object.fromEntries(
			Object.entries(layerDbs)
				.filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
				.map(([key, entry]) => [
					key,
					typeof entry.DB_Layer === 'string' && entry.DB_Layer.trim()
						? entry
						: { DB_Layer: defaultLayer, ...entry }
				])
		);

		const baseDbs = baseMeta?.Databases ?? {};
		const layerOnlyEntries = Object.fromEntries(
			Object.entries(normalized).filter(([key]) => !(key in baseDbs))
		);

		return {
			...baseMeta,
			Databases: { ...baseDbs, ...layerOnlyEntries }
		};
	}

	mergeRefDatabases(baseMeta, refMeta) {
		return this.mergeLayerDatabases(baseMeta, refMeta, 'References');
	}

	/**
	 * Localization レイヤーのメタデータを読み込み（未存在時は空オブジェクトを返す）
	 * @param {string} workId - 作品識別子
	 * @returns {Promise<Object>} Localization メタデータ
	 */
	async readLocMeta(workId) {
		try {
			const workDir = await this.resolveWorkDir(workId);
			return await this.fetchJSON(`/data/${workDir}/Localization/db_meta.json`);
		} catch (_) {
			return {};
		}
	}

	/**
	 * Dictionary 用メタデータを読み込み
	 * @param {string} basePath - Dictionaries ディレクトリのベースパス
	 * @returns {Promise<Object>} 辞書メタデータ
	 */
	async readDictionaryMeta(basePath) {
		try {
			return await this.fetchJSON(`${basePath}/db_meta.json`);
		} catch (_) {
			return {};
		}
	}

	/**
	 * Dictionary 用型定義を読み込み
	 * @param {string} basePath - Dictionaries ディレクトリのベースパス
	 * @returns {Promise<Object>} 辞書型定義
	 */
	async readDictionaryType(basePath) {
		try {
			return await this.fetchJSON(`${basePath}/db_type.json`);
		} catch (_) {
			return {};
		}
	}

	/**
	 * 辞書DB群を `$VarsDef` 互換の形へ展開
	 * @param {string} basePath - Dictionaries ディレクトリのベースパス
	 * @returns {Promise<{ meta: Object, vars: Object }>} 辞書メタと辞書VarsDef
	 */
	async readDictionaryBundle(basePath) {
		const [meta, type] = await Promise.all([
			this.readDictionaryMeta(basePath),
			this.readDictionaryType(basePath)
		]);

		const typeVars = (type?.$VarsDef && typeof type.$VarsDef === 'object' && !Array.isArray(type.$VarsDef))
			? type.$VarsDef
			: {};
		const catalogs = (meta?.Dictionaries && typeof meta.Dictionaries === 'object' && !Array.isArray(meta.Dictionaries))
			? meta.Dictionaries
			: {};
		const vars = { ...typeVars };

		for (const [rawDictKey, info] of Object.entries(catalogs)) {
			if (!info || typeof info !== 'object' || Array.isArray(info)) continue;

			const dictName = String(rawDictKey || '').replace(/^#Dict_/, '').trim();
			const keyField = typeof info.keyField === 'string' ? info.keyField.trim() : '';
			const derivedName = dictName || keyField;
			if (!derivedName) continue;

			const dictKey = String(rawDictKey || '').startsWith('#Dict_')
				? String(rawDictKey).trim()
				: `#Dict_${derivedName}`;
			const compatListKey = typeof info.compatListKey === 'string' && info.compatListKey.trim()
				? info.compatListKey.trim()
				: `#List_${derivedName}`;
			const fileName = typeof info.dictFile === 'string' && info.dictFile.trim()
				? info.dictFile.trim()
				: `dict_${derivedName}.json`;

			// scopeField（例: { "Belonging": "シンフォニー.XVI(ゼクズィン)" }）は辞書ファイル1本まるごとに
			// 適用される条件のため、行ごとに手書きせず読み込み時に全行へ合成する（行側の値があれば行を優先）
			const scopeCondition = (info.scopeField && typeof info.scopeField === 'object' && !Array.isArray(info.scopeField))
				? info.scopeField
				: null;

			try {
				const rows = await this.fetchJSON(`${basePath}/${fileName}`);
				if (!Array.isArray(rows)) continue;
				const applyScope = (row) => (row && typeof row === 'object')
					? (scopeCondition ? { ...scopeCondition, ...row } : { ...row })
					: row;
				const clonedRows = rows.map(applyScope);
				vars[dictKey] = clonedRows;
				if (compatListKey) {
					// 同じ compatListKey（例: #List_Class）を持つ辞書が複数ある場合は上書きせず連結する
					// （例: #Dict_SymphonyXVI と #Dict_Mikhail が同じ #List_Class を持つケース）
					if (!vars[compatListKey]) vars[compatListKey] = [];
					if (Array.isArray(vars[compatListKey])) vars[compatListKey].push(...rows.map(applyScope));
				}
			} catch (_) {
				// 辞書ファイルが未作成でも他の辞書・メタ処理は継続する
			}
		}

		return { meta, vars };
	}

	/**
	 * 読み込んだ追加辞書を meta.General.$VarsDef と top-level Dictionaries へ合流
	 * @param {Object} metaSource - 元メタデータ
	 * @param {Object} extraVars - 追加する VarsDef
	 * @param {Object} extraMeta - 追加する辞書メタ
	 * @returns {Object} 合流後メタデータ
	 */
	mergeMetaWithDictionaryBundle(metaSource, extraVars = {}, extraMeta = {}) {
		const meta = (metaSource && typeof metaSource === 'object' && !Array.isArray(metaSource)) ? metaSource : {};
		const vars = (extraVars && typeof extraVars === 'object' && !Array.isArray(extraVars)) ? extraVars : {};
		const dictMeta = (extraMeta && typeof extraMeta === 'object' && !Array.isArray(extraMeta)) ? extraMeta : {};

		const metaGeneral = (meta.General && typeof meta.General === 'object' && !Array.isArray(meta.General)) ? meta.General : {};
		const metaVars = (metaGeneral.$VarsDef && typeof metaGeneral.$VarsDef === 'object' && !Array.isArray(metaGeneral.$VarsDef))
			? metaGeneral.$VarsDef
			: {};
		const mergedVars = Object.keys(vars).length > 0 ? DataUtils.deepMerge(metaVars, vars) : metaVars;

		const baseDictionaries = (meta.Dictionaries && typeof meta.Dictionaries === 'object' && !Array.isArray(meta.Dictionaries))
			? meta.Dictionaries
			: {};
		const extraDictionaries = (dictMeta.Dictionaries && typeof dictMeta.Dictionaries === 'object' && !Array.isArray(dictMeta.Dictionaries))
			? dictMeta.Dictionaries
			: {};
		const mergedDictionaries = Object.keys(extraDictionaries).length > 0
			? DataUtils.deepMerge(baseDictionaries, extraDictionaries)
			: baseDictionaries;

		return {
			...meta,
			...(Object.keys(mergedDictionaries).length > 0 ? { Dictionaries: mergedDictionaries } : {}),
			General: {
				...metaGeneral,
				$VarsDef: mergedVars
			}
		};
	}

	/**
	 * General.$VarsDefをグローバルレベルで読み込み
	 * @returns {Promise<Object>} グローバル変数定義
	 */
	async readGeneralVarsDefGlobal() {
		try {
			const g = await this.readGlobalMeta();
			return g?.General?.$VarsDef ?? {};
		} catch (_) {
			return {};
		}
	}

	/**
	 * General.$VarsDefを作品レベルで読み込み
	 * @param {string} workId - 作品識別子
	 * @returns {Promise<Object>} 作品変数定義
	 */
	async readGeneralVarsDefWork(workId) {
		try {
			const meta = await this.readWorkMeta(workId);
			return meta?.General?.$VarsDef ?? {};
		} catch (_) {
			return {};
		}
	}

	/**
	 * データベースを読み込み
	 * @param {string} workId - 作品識別子
	 * @param {string} dbName - データベース名
	 * @returns {Promise<Array>} データベースレコード配列
	 * @throws {Error} 不明なデータベース名の場合
	 */
	async readDB(workId, dbName) {
		if (!workId) throw new Error('Invalid workId');
		const norm = (dbName || '').replace(/^#?DB_/i, '').replace(/^[#]/, '');
		if (!DataUtils.isSafeToken(norm)) throw new Error('Invalid dbName');
		const key = DataUtils.capitalize(norm);
		const dbMetaInfo = await this.readDbMetaEntry(workId, key);
		const dbMeta = dbMetaInfo?.entry ?? null;
		const workDir = await this.resolveWorkDir(workId);
		const layer = this.resolveDbLayer(dbMeta);
		// layer が workDir 自身と一致する場合（Works_Dir オーバーライドで workDir と DB_Layer が
		// 同名になる共通資料の疑似作品等）はレイヤーセグメントを畳み込み、二重ディレクトリを避ける
		const base = `/data/${workDir}${(layer && layer !== workDir) ? `/${layer}` : ''}`;
		const configuredFile = this.resolveDbFile(dbMeta);
		const defaultPrefix = this.resolveDbFilePrefix(dbMetaInfo?.metaKey);

		// 従来のファイル名マッピング
		const conventional = {
			Primary: 'db_Primary.json',
			Secondary: 'db_Secondary.json',
			SemiPrimary: 'db_SemiPrimary.json',
			SelfSecondary: 'db_SelfSecondary.json',
			Proxy: 'db_Proxy.json',
			Mobs: 'db_Mobs.json'
		};

		const candidates = [];
		if (configuredFile) candidates.push(configuredFile);
		if (conventional[key]) candidates.push(conventional[key]);
		if (conventional[norm]) candidates.push(conventional[norm]);

		// 柔軟なフォールバック: prefix_<Key>.json / prefix_<norm>.json
		candidates.push(`${defaultPrefix}${key}.json`);
		if (key.toLowerCase() !== norm.toLowerCase()) candidates.push(`${defaultPrefix}${norm}.json`);
		if (defaultPrefix !== 'db_') {
			candidates.push(`db_${key}.json`);
			if (key.toLowerCase() !== norm.toLowerCase()) candidates.push(`db_${norm}.json`);
		}

		// 最初に存在するファイルを選択
		for (const fname of candidates) {
			if (await this.fileExists(`${base}/${fname}`)) {
				return this.fetchJSON(`${base}/${fname}`);
			}
		}
		throw new Error(`Unknown dbName or missing file for ${dbName}`);
	}

	/**
	 * 作品の利用可能なデータベースをリストアップ
	 * @param {string} workId - 作品識別子
	 * @returns {Promise<Array>} データベース情報の配列
	 */
	async listWorkDBs(workId) {
		if (!workId) throw new Error('Invalid workId');
		const exist = [];
		const workDir = await this.resolveWorkDir(workId);

		// メタデータからデータベースキーを取得
		try {
			const meta = await this.readWorkMeta(workId);
			const dbs = Object.keys(meta?.Databases || {});
			for (const dbKey of dbs) {
				const norm = DataUtils.stripMetaDbPrefix(dbKey);
				const name = DataUtils.capitalize(norm);
				const dbMeta = meta?.Databases?.[dbKey] ?? null;
				// DB_Hidden: true のDBはリストから除外する
				if (dbMeta?.DB_Hidden === true) continue;
				// Localization (#Loc_*) エントリは辞書・翻訳データとして扱い、キャラシートの閲覧対象DBに表示しない
				if (dbKey.startsWith('#Loc_')) continue;
				const layer = this.resolveDbLayer(dbMeta);
				const configuredFile = this.resolveDbFile(dbMeta);
				const defaultPrefix = this.resolveDbFilePrefix(dbKey);
				// layer が workDir 自身と一致する場合はレイヤーセグメントを畳み込む（readDBと同じ規則）
				const base = `/data/${workDir}${(layer && layer !== workDir) ? `/${layer}` : ''}`;
				const candidates = [
					...(configuredFile ? [configuredFile] : []),
					`${defaultPrefix}${name}.json`,
					...(name.toLowerCase() !== norm.toLowerCase() ? [`${defaultPrefix}${norm}.json`] : []),
					...(defaultPrefix !== 'db_' ? [
						`db_${name}.json`,
						...(name.toLowerCase() !== norm.toLowerCase() ? [`db_${norm}.json`] : [])
					] : [])
				];
				for (const fname of candidates) {
					if (await this.fileExists(`${base}/${fname}`)) {
						exist.push({ key: name, file: fname, layer });
						break;
					}
				}
			}
		} catch { }

		// メタデータから何も得られない場合は従来の探査を実行
		if (exist.length === 0) {
			const base = `/data/${workDir}/DataBases`;
			const conventional = [
				{ name: 'Primary', file: 'db_Primary.json' },
				{ name: 'Secondary', file: 'db_Secondary.json' },
				{ name: 'SemiPrimary', file: 'db_SemiPrimary.json' },
				{ name: 'SelfSecondary', file: 'db_SelfSecondary.json' },
				// 追加のDB種別（メタが欠損/不完全でも列挙できるようにする）
				{ name: 'UnprocessedSecondary', file: 'db_UnprocessedSecondary.json' },
				{ name: 'PrimaryDealer', file: 'db_PrimaryDealer.json' },
				{ name: 'PrimaryMobs', file: 'db_PrimaryMobs.json' },
				{ name: 'Proxy', file: 'db_Proxy.json' },
				{ name: 'Mobs', file: 'db_Mobs.json' }
			];
			for (const c of conventional) {
				if (await this.fileExists(`${base}/${c.file}`)) exist.push({ key: c.name, file: c.file, layer: 'DataBases' });
			}
		}
		return exist;
	}
}

/**
 * データ処理ユーティリティクラス
 * 文字列操作、正規化、検証などを担当
 */
class DataUtils {
	/**
	 * URL パラメータ等の外部入力を、パスセグメントとして安全に扱えるか判定
	 * - 作品IDやDB名は "Works_NumberTales" / "PrimaryDealer" のような英数字+アンダースコアのみ許可する
	 * @param {any} s
	 * @returns {boolean}
	 */
	static isSafeToken(s) {
		if (typeof s !== 'string') return false;
		if (s.length === 0) return false;
		return /^[A-Za-z0-9_]+$/.test(s);
	}

	/**
	 * 文字列の最初の文字を大文字にする
	 * @param {string} s - 処理する文字列
	 * @returns {string} 最初の文字が大文字の文字列
	 */
	static capitalize(s) {
		return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
	}

	/**
	 * 作品IDを正規化して#Works_プレフィックス付きの形式に変換
	 * @param {string} id - 入力ID（様々な形式をサポート）
	 * @returns {string|null} 正規化された作品キー
	 */
	static toWorkKey(id) {
		if (!id) return null;
		const raw = String(id).trim();
		if (!raw) return null;

		let normalized;
		if (raw.startsWith('#Works_')) normalized = raw;
		else if (raw.startsWith('Works_')) normalized = '#' + raw;
		else normalized = `#Works_${raw}`;

		const m = normalized.match(/^#Works_([A-Za-z0-9_]+)$/);
		if (!m) return null;
		return `#Works_${m[1]}`;
	}

	/**
	 * DB名（Primary / Secondary / PrimaryDealer など）が安全なトークンかを判定
	 * @param {any} dbName
	 * @returns {boolean}
	 */
	static isValidDbName(dbName) {
		if (!dbName) return false;
		const norm = DataUtils.stripMetaDbPrefix(dbName);
		return DataUtils.isSafeToken(norm);
	}

	/**
	 * DBメタキーの prefix を取り除いた名前を返す
	 * @param {string} dbName
	 * @returns {string}
	 */
	static stripMetaDbPrefix(dbName) {
		return String(dbName || '').trim().replace(/^#?(DB|Ref|Loc)_/i, '').replace(/^[#]/, '');
	}

	/**
	 * DB名をmeta内のキー形式に正規化
	 * @param {string} dbName - データベース名
	 * @returns {string} 正規化されたDBキー（例: '#DB_Primary'）
	 */
	static normalizeDBKeyForMeta(dbName) {
		const norm = DataUtils.stripMetaDbPrefix(dbName);
		return `#DB_${DataUtils.capitalize(norm)}`;
	}

	/**
	 * 作品別 Databases カタログから DB 定義を取得
	 * @param {Object} databases - Databases オブジェクト
	 * @param {string} dbName - DB名
	 * @returns {{ metaKey: string|null, entry: Object|null }}
	 */
	static findMetaDbEntry(databases, dbName) {
		if (!DataUtils.isObject(databases)) return { metaKey: null, entry: null };
		const norm = DataUtils.capitalize(DataUtils.stripMetaDbPrefix(dbName));
		const candidates = [`#DB_${norm}`, `#Ref_${norm}`, `#Loc_${norm}`];
		for (const metaKey of candidates) {
			if (DataUtils.isObject(databases[metaKey])) {
				return { metaKey, entry: databases[metaKey] };
			}
		}
		return { metaKey: candidates[0], entry: null };
	}

	/**
	 * 真偽値文字列をboolean値に変換
	 * @param {any} v - 変換する値
	 * @returns {boolean} 変換されたboolean値
	 */
	static truthy(v) {
		if (!v) return false;
		const s = String(v).toLowerCase();
		return s === '1' || s === 'true' || s === 'yes' || s === 'on';
	}

	/**
	 * オブジェクトかどうかを判定（配列は除く）
	 * @param {any} x - 判定する値
	 * @returns {boolean} オブジェクトの場合はtrue
	 */
	static isObject(x) {
		return x && typeof x === 'object' && !Array.isArray(x);
	}

	/**
	 * ランク値を正規化（空白を除去、記号は保持）
	 * @param {any} v - 正規化するランク値
	 * @returns {string|null} 正規化されたランク値
	 */
	static normRank(v) {
		if (v == null) return null;
		return String(v).trim();
	}

	/**
	 * 値を配列に変換（既に配列の場合はそのまま）
	 * @param {any} v - 変換する値
	 * @returns {Array} 配列形式の値
	 */
	static toArray(v) {
		return Array.isArray(v) ? v : (v == null ? [] : [v]);
	}

	/**
	 * オブジェクトのパスから値を取得
	 * @param {Object} obj - 取得元オブジェクト
	 * @param {string} path - パス（ドット区切り）
	 * @returns {any} 取得された値
	 */
	static getByPath(obj, path) {
		if (!path) return undefined;
		const parts = String(path).split('.');
		let cur = obj;
		for (const p of parts) {
			if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
			else return undefined;
		}
		return cur;
	}

	/**
	 * 深いマージ処理（再帰的にオブジェクトをマージ）
	 * @param {any} a - マージ対象A
	 * @param {any} b - マージ対象B
	 * @returns {any} マージ結果
	 */
	static deepMerge(a, b) {
		if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
		if (DataUtils.isObject(a) && DataUtils.isObject(b)) {
			const out = { ...a };
			for (const [k, v] of Object.entries(b)) {
				if (k in out) out[k] = DataUtils.deepMerge(out[k], v);
				else out[k] = v;
			}
			return out;
		}
		return b ?? a;
	}
}

/**
 * 検索・フィルタリングクラス
 * レコード検索とクエリ処理を担当
 */
class SearchEngine {
	/**
	 * 単純なクエリ（フィールド=値）のAND条件でレコードを抽出
	 * @param {Array} records - 検索対象レコード配列
	 * @param {Array} queries - クエリ配列 [{ hashTag, key }]
	 * @returns {Array} 条件に一致するレコード配列
	 */
	static searchRecords(records, queries) {
		return records.filter(rec => {
			return queries.every(q => {
				const val = DataUtils.getByPath(rec, q.hashTag);
				if (val == null) return false;

				// 配列の場合はany match
				if (Array.isArray(val)) {
					return val.some(it => {
						if (it == null) return false;
						if (typeof it === 'string' || typeof it === 'number' || typeof it === 'boolean') {
							return String(it) === String(q.key);
						}
						if (typeof it === 'object') {
							const inner = it[q.hashTag];
							if (inner != null) return String(inner) === String(q.key);
							return String(it) === String(q.key);
						}
						return false;
					});
				}

				// オブジェクトの場合は同名フィールドを優先
				if (typeof val === 'object') {
					const inner = val[q.hashTag];
					if (inner != null) return String(inner) === String(q.key);
				}
				return String(val) === String(q.key);
			});
		});
	}
}

/**
 * Commons適用処理クラス
 * DB-levelとSecondaries-levelの_Commonsをレコードに適用
 */
class CommonsProcessor {
	/**
	 * DBレベルおよびSecondariesレベルの_Commonsをレコードへ非破壊適用
	 * @param {Array} records - 処理対象レコード配列
	 * @param {Object} workMeta - 作品メタデータ
	 * @param {string} dbName - データベース名
	 * @returns {Array} Commons適用後のレコード配列
	 */
	static applyCommonsToRecords(records, workMeta, dbName) {
		try {
			const dbKey = DataUtils.normalizeDBKeyForMeta(dbName);
			const commons = workMeta?.Databases?.[dbKey]?._Commons;
			// 作品別メタの「二次創作定義」配列
			// - 現行: `_Secondaries`
			// - 旧/別名: `Secondaries`
			const secDefs =
				workMeta?.Databases?.[dbKey]?._Secondaries ??
				workMeta?.Databases?.[dbKey]?.Secondaries;

			if ((!commons && !Array.isArray(secDefs)) || !Array.isArray(records)) return records;

			const CONDITIONAL_PREFIX = '_ListLinkIf_';
			const isConditionalKey = (k) => k.startsWith(CONDITIONAL_PREFIX);
			const getFieldNameFromConditional = (k) => k.substring(CONDITIONAL_PREFIX.length);

			const deepFindFirstByKey = (obj, key) => {
				if (!DataUtils.isObject(obj)) return undefined;
				if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
				for (const v of Object.values(obj)) {
					if (DataUtils.isObject(v)) {
						const found = deepFindFirstByKey(v, key);
						if (typeof found !== 'undefined') return found;
					}
				}
				return undefined;
			};

			const buildDefaultsFromCommons = (cmn, rec) => {
				if (!cmn || !DataUtils.isObject(cmn)) return {};
				const out = {};

				// 1) 単純なcommons
				for (const [k, v] of Object.entries(cmn)) {
					if (k.startsWith('_') || k.startsWith('#')) continue;
					out[k] = v;
				}

				// 2) 条件付きcommons
				for (const [k, arr] of Object.entries(cmn)) {
					if (!isConditionalKey(k) || !Array.isArray(arr)) continue;
					const field = getFieldNameFromConditional(k);
					let curVal = typeof rec[field] !== 'undefined' ? rec[field] : undefined;
					if (typeof curVal === 'undefined' && DataUtils.isObject(rec.Card) && typeof rec.Card[field] !== 'undefined') curVal = rec.Card[field];
					if (typeof curVal === 'undefined' && DataUtils.isObject(rec.SpecType) && typeof rec.SpecType[field] !== 'undefined') curVal = rec.SpecType[field];
					if (typeof curVal === 'undefined') curVal = deepFindFirstByKey(rec, field);
					if (typeof curVal === 'undefined' || curVal === null) continue;
					const match = arr.find(it => DataUtils.isObject(it) && Object.prototype.hasOwnProperty.call(it, field) && String(it[field]) === String(curVal));
					if (!match) continue;
					for (const [ik, iv] of Object.entries(match)) {
						if (ik === field || ik.startsWith('_') || ik.startsWith('#')) continue;
						out[ik] = iv;
					}
				}
				return out;
			};

			// _Commons の既定値を適用する際の「空値」判定
			// - undefined だけでなく null/空文字/空オブジェクトも未設定扱いにする
			// - { hideText: '...' } は意図的マスクなので空扱いしない
			// - `[]` は「該当なし」の明示宣言（例: Belonging: [] = 無所属）なので空扱いしない。
			//   既定値が欲しいレコードはキー自体を書かない（undefined）ことで表現する
			const isEmptyForCommons = (v) => {
				if (v === null || typeof v === 'undefined') return true;
				if (v === '') return true;
				if (Array.isArray(v)) return false;
				if (DataUtils.isObject(v)) {
					if (typeof v.hideText === 'string' && v.hideText) return false;
					return Object.keys(v).length === 0;
				}
				return false;
			};

			const findSecondaryCommons = (rec) => {
				if (!Array.isArray(secDefs)) return null;

				const normStr = (v) => (v === null || typeof v === 'undefined') ? '' : String(v);
				// 条件値（defVal）とレコード値（recVal）の一致判定。
				// recVal / defVal のどちらかが配列の場合も対応:
				//   defVal が文字列 → recVal（配列）に含まれていれば一致
				//   defVal が配列  → すべての要素が recVal（配列）に含まれていれば一致
				const matchesCriteria = (defVal, recVal) => {
					const toArr = (v) => (Array.isArray(v) ? v : [v]).map(normStr).filter(s => s !== '');
					const defArr = toArr(defVal);
					const recArr = toArr(recVal);
					if (defArr.length === 0) return true;
					if (recArr.length === 0) return false;
					return defArr.every(d => recArr.some(r => r === d));
				};
				const getFirst = (obj, keys) => {
					for (const k of keys) {
						if (!k) continue;
						if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
					}
					return undefined;
				};
				const getRec = (paths) => {
					for (const p of paths) {
						const v = DataUtils.getByPath(rec, p);
						if (v !== null && typeof v !== 'undefined') return v;
					}
					return undefined;
				};

				// sec_SeriesTitle を主キーとして扱い、追加条件（Category/DesignedBy）があれば優先
				const criteriaDefs = [
					{
						primary: true,
						defKeys: ['sec_SeriesTitle', 'SecondarySeriesTitle', 'SecondarySeriesTitle_EN'],
						recPaths: ['sec_SeriesTitle', 'SecondarySeriesTitle']
					},
					{
						primary: false,
						defKeys: ['sec_Category', 'SecondaryCategory'],
						recPaths: ['sec_Category', 'SecondaryCategory']
					},
					{
						primary: false,
						defKeys: ['sec_DesignedBy', 'SecondaryDesignedBy'],
						recPaths: ['sec_DesignedBy', 'SecondaryDesignedBy']
					}
				];

				const hasSpecifiedSecondaryCondition = (def) => criteriaDefs.some((c) => {
					const defVal = getFirst(def, c.defKeys);
					return !(defVal === null || typeof defVal === 'undefined' || normStr(defVal).trim() === '');
				});

				let defaultSecondaryDef = null;
				let bestSecondaryDef = null;
				let bestScore = -1;

				for (const def of secDefs) {
					if (!DataUtils.isObject(def) || !DataUtils.isObject(def._Commons)) continue;

					if (!hasSpecifiedSecondaryCondition(def)) {
						if (defaultSecondaryDef === null) defaultSecondaryDef = def;
						continue;
					}

					// primary（sec_SeriesTitle）を指定していない定義は、
					// sec_Category/sec_DesignedBy 等の指定がある場合に「必須条件」として扱う。
					// これにより、レコード側に sec_Category が無いのに
					// `sec_Category:'リクエストナンバー'` のような定義が誤適用されるのを防ぐ。
					const hasPrimaryCondition = (() => {
						const c = criteriaDefs.find(x => x.primary);
						if (!c) return false;
						const defVal = getFirst(def, c.defKeys);
						if (defVal === null || typeof defVal === 'undefined') return false;
						return normStr(defVal).trim() !== '';
					})();

					let score = 0;
					let ok = true;

					for (const c of criteriaDefs) {
						const defVal = getFirst(def, c.defKeys);
						// null/undefined/空文字は「条件なし」とみなす（ワイルドカード）
						if (defVal === null || typeof defVal === 'undefined' || normStr(defVal).trim() === '') continue;

						const recVal = getRec(c.recPaths);

						// 主キー（sec_SeriesTitle）は必須一致。
						// 追加条件（Category/DesignedBy）は「レコード側に値がある場合のみ」一致判定を行い、
						// 値がない場合は絞り込みに使わない（=シリーズだけで適用できる）。
						if (c.primary) {
							if (!matchesCriteria(defVal, recVal)) {
								ok = false;
								break;
							}
							score += 10;
							continue;
						}

						// primary がある場合は「レコード側に値がある場合のみ」追加条件として絞り込む。
						// primary が無い場合は、追加条件が実質 primary になるため必須一致。
						const recEmpty = recVal === null || typeof recVal === 'undefined' || normStr(recVal).trim() === '';
						if (hasPrimaryCondition) {
							if (recEmpty) continue;
							if (!matchesCriteria(defVal, recVal)) {
								ok = false;
								break;
							}
							score += 1;
							continue;
						}

						if (recEmpty) {
							ok = false;
							break;
						}
						if (!matchesCriteria(defVal, recVal)) {
							ok = false;
							break;
						}
						score += 1;
					}

					if (!ok) continue;
					if (score > bestScore) {
						bestScore = score;
						bestSecondaryDef = def;
					}
				}

				return bestSecondaryDef || defaultSecondaryDef;
			};

			return records.map(rec => {
				if (!DataUtils.isObject(rec)) return rec;
				const dbDefaults = buildDefaultsFromCommons(commons, rec);
				const matchedSecondaryDef = findSecondaryCommons(rec);
				const secDefaults = buildDefaultsFromCommons(matchedSecondaryDef?._Commons || null, rec);
				const defaults = { ...dbDefaults, ...secDefaults }; // sec > db
				for (const [k, v] of Object.entries(defaults)) {
					if (k.startsWith('#')) continue;
					if (typeof rec[k] === 'undefined' || isEmptyForCommons(rec[k])) rec[k] = v; // レコード入力が最優先
				}

				// sec_SeriesTitle で選ばれた meta 定義から、二次創作補助メタを空欄時のみ補完する。
				// これにより Secondary DB 側で sec_SeriesTitle だけを持つレコードでも、
				// sec_Category / sec_DesignedBy を UI/API で一貫して扱える。
				['sec_Category', 'sec_DesignedBy'].forEach((key) => {
					const metaValue = matchedSecondaryDef?.[key];
					if (typeof metaValue === 'undefined' || metaValue === null || String(metaValue).trim() === '') return;
					if (typeof rec[key] === 'undefined' || isEmptyForCommons(rec[key])) {
						rec[key] = metaValue;
					}
				});
				return rec;
			});
		} catch (_) {
			return records;
		}
	}
}

/**
 * Service Worker基本クラス
 * 基本的なService Worker機能とイベントハンドリングを提供
 */
class ServiceWorkerBase {
	/**
	 * @param {Array<string>} apiPrefixes - インターセプトするAPIプレフィックス配列
	 */
	constructor(apiPrefixes) {
		this.apiPrefixes = apiPrefixes;
		this.setupEventListeners();
	}

	/**
	 * Service Workerイベントリスナーを設定
	 */
	setupEventListeners() {
		self.addEventListener('install', (e) => {
			e.waitUntil(Promise.all([
				self.skipWaiting(),
				this.precache()
			]));
		});

		self.addEventListener('activate', (e) => {
			e.waitUntil(self.clients.claim());
		});

		// ページ側で controller が付かない場合の救済
		// - ready は解決している（SWはactive）ものの controller が null のまま、というケースが稀に起きる
		// - ページ側からメッセージを送り、clients.claim() を再実行して制御を試みる
		self.addEventListener('message', (event) => {
			try {
				const data = event?.data;
				const type = data && typeof data === 'object' ? data.type : null;
				if (type !== '100bl.claimClients') return;
				event.waitUntil((async () => {
					await self.clients.claim();
				})());
			} catch {
				// no-op
			}
		});

		self.addEventListener('fetch', (event) => {
			const url = new URL(event.request.url);
			// 同一オリジンのみ処理
			if (url.origin !== self.location.origin) return;

			const matchedPrefix = this.apiPrefixes.find(p => url.pathname.startsWith(p));
			if (matchedPrefix) {
				console.log('🔄 SW がリクエストをインターセプト:', url.pathname, 'プレフィックス:', matchedPrefix);
				event.respondWith(this.handleApiRequestInScope(url, matchedPrefix).catch(err => {
					console.error('❌ SW API リクエストが失敗:', url.pathname, err);
					return this.createErrorResponse(err, url.pathname, event.request.method);
				}));
				return;
			}

			// API以外でも、画像リソースはケースセンシティブ問題の救済を試みる
			if (this.shouldHandleImageFallback(event.request, url)) {
				event.respondWith(this.handleImageRequestWithFallback(event.request, url));
			}
		});
	}

	/**
	 * 画像フォールバック処理の対象かどうかを判定
	 * @param {Request} request - Fetch リクエスト
	 * @param {URL} url - リクエストURL
	 * @returns {boolean} 対象の場合は true
	 */
	shouldHandleImageFallback(request, url) {
		try {
			if (!request || request.method !== 'GET') return false;
			// data 配下の Images 参照に限定
			if (!url.pathname.includes('/data/') || !url.pathname.includes('/Images/')) return false;
			// 画像リクエストらしさ（destination が取れない環境もあるため拡張子でも判定）
			if (request.destination === 'image') return true;
			return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(url.pathname);
		} catch {
			return false;
		}
	}

	/**
	 * 画像リクエストを通常取得し、失敗時に代替パスでリトライ
	 * @param {Request} request - 元のリクエスト
	 * @param {URL} url - 元のURL
	 * @returns {Promise<Response>} 画像レスポンス
	 */
	async handleImageRequestWithFallback(request, url) {
		// まずは通常通り
		let res;
		try {
			res = await fetch(request);
			if (res && res.ok) return res;
		} catch {
			// 続けてフォールバック候補を試す
		}

		const candidates = this.buildImageFallbackUrls(url);
		for (const candidateUrl of candidates) {
			try {
				const nextReq = new Request(candidateUrl.toString(), request);
				const nextRes = await fetch(nextReq);
				if (nextRes && nextRes.ok) return nextRes;
			} catch {
				// 次の候補へ
			}
		}

		// すべて失敗したら、最初のレスポンス（404等）を返す
		return res || fetch(request);
	}

	/**
	 * 画像の代替URL候補を生成
	 * - 既知ディレクトリの大小文字揺れ補正
	 * - 拡張子の大小文字(.png/.PNG など)補正
	 * @param {URL} url - 元のURL
	 * @returns {URL[]} 代替URL配列（重複除去済み）
	 */
	buildImageFallbackUrls(url) {
		const out = [];
		const seen = new Set();
		const push = (u) => {
			const s = u.toString();
			if (seen.has(s)) return;
			seen.add(s);
			out.push(u);
		};

		const pathname = url.pathname;

		// 1) 拡張子の大小文字リトライ
		const extMatch = pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i);
		if (extMatch) {
			const ext = extMatch[0];
			const base = pathname.slice(0, -ext.length);
			const variants = [ext.toLowerCase(), ext.toUpperCase()];
			for (const v of variants) {
				if (v !== ext) {
					const u = new URL(url.toString());
					u.pathname = `${base}${v}`;
					push(u);
				}
			}
		}

		// 2) 既知ディレクトリのケース正規化（ファイル名は変更しない）
		const CANON_DIR_SEGMENTS = [
			'arts', 'concept', 'conceptAlt', 'design', 'designAlt', 'cardDesign', 'catalog', 'corefolder',
			'General',
			// よく使うサブディレクトリ
			'autumnMoon', 'corefolders', 'humanoids', 'newYear', 'chattingArt',
			// 作品によってはここが存在
			'cardDesign', 'conceptAlt', 'concept-figure', 'conceptAlt', 'designAlt', 'concept', 'design'
		];

		const parts = pathname.split('/').filter(Boolean);
		const imagesIdx = parts.findIndex(p => p === 'Images');
		if (imagesIdx >= 0) {
			const outParts = parts.map((seg, idx) => {
				// Images 以降の「ディレクトリ部分」だけを正規化する（末尾はファイル名扱い）
				if (idx <= imagesIdx) return seg;
				if (idx === parts.length - 1) return seg;

				const segLower = seg.toLowerCase();
				const canon = CANON_DIR_SEGMENTS.find(c => c.toLowerCase() === segLower);
				return canon || seg;
			});

			const normalizedPath = '/' + outParts.join('/');
			if (normalizedPath !== pathname) {
				const u = new URL(url.toString());
				u.pathname = normalizedPath;
				push(u);

				// 併せて拡張子大小文字も試す
				const m2 = normalizedPath.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i);
				if (m2) {
					const ext = m2[0];
					const base = normalizedPath.slice(0, -ext.length);
					const variants = [ext.toLowerCase(), ext.toUpperCase()];
					for (const v of variants) {
						if (v !== ext) {
							const u2 = new URL(url.toString());
							u2.pathname = `${base}${v}`;
							push(u2);
						}
					}
				}
			}
		}

		return out;
	}

	/**
	 * エラーレスポンスを生成
	 * @param {Error} err - エラーオブジェクト
	 * @param {string} pathname - リクエストパス
	 * @param {string} method - HTTPメソッド
	 * @returns {Response} エラーレスポンス
	 */
	createErrorResponse(err, pathname, method) {
		const errorResponse = {
			error: String(err),
			message: err.message || 'Unknown error',
			timestamp: new Date().toISOString(),
			path: pathname,
			method: method,
			requestId: Math.random().toString(36).substring(7)
		};

		// 特定のエラータイプに対するガイダンス
		if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
			errorResponse.type = 'NETWORK_ERROR';
			errorResponse.suggestion = 'Check if the requested file exists in the repository';
		} else if (err.message.includes('404')) {
			errorResponse.type = 'NOT_FOUND';
			errorResponse.suggestion = 'Verify the file path and database structure';
		} else if (err.message.includes('JSON')) {
			errorResponse.type = 'PARSE_ERROR';
			errorResponse.suggestion = 'Check JSON syntax in the requested file';
		} else {
			errorResponse.type = 'UNKNOWN_ERROR';
		}

		return ResponseUtils.jsonResponse(errorResponse, 500);
	}

	/**
	 * 事前キャッシュ処理（サブクラスでオーバーライド）
	 * @returns {Promise<void>}
	 */
	async precache() {
		// 基本実装は空
	}

	/**
	 * `handleApiRequest()` を DataFetcher のリクエストスコープで包んで実行する
	 *
	 * @description
	 * 1 リクエストの処理中に同じメタ/型/辞書 JSON を取り直さないようにする唯一の開閉点。
	 * ここで包むことで各エンドポイントハンドラ側の改修は不要になる。
	 * `dataFetcher` はサブクラスのコンストラクタが `super()` の**後**に代入するが、
	 * この経路が走るのは fetch イベント発火時なので確実に解決できる。
	 * 未設定・旧実装でも動くよう任意呼び出し（`?.`）にしている。
	 * @param {URL} url - リクエストURL
	 * @param {string} apiPrefix - マッチしたAPIプレフィックス
	 * @returns {Promise<Response>} APIレスポンス
	 */
	async handleApiRequestInScope(url, apiPrefix) {
		const fetcher = this.dataFetcher;
		fetcher?.beginRequestScope?.();
		try {
			return await this.handleApiRequest(url, apiPrefix);
		} finally {
			fetcher?.endRequestScope?.();
		}
	}

	/**
	 * APIリクエスト処理（サブクラスで実装）
	 * @param {URL} url - リクエストURL
	 * @param {string} apiPrefix - マッチしたAPIプレフィックス
	 * @returns {Promise<Response>} APIレスポンス
	 */
	async handleApiRequest(url, apiPrefix) {
		throw new Error('handleApiRequest must be implemented by subclass');
	}
}

/**
 * APIエンドポイントハンドラークラス
 * 共通のAPIエンドポイント実装を提供
 */
class ApiEndpointHandlers {
	constructor(dataFetcher) {
		this.dataFetcher = dataFetcher;
	}

	/**
	 * db_meta.json と db_type.json の `$VarsDef` を、表示辞書として扱いやすい形にマージ
	 * - 既存の meta 構造は維持しつつ、type 側の `$EnumDef_*` / `#List_*` を General.$VarsDef へ合流する
	 * - Decave のように db_type.json にだけ存在する enum 辞書も API から参照可能にする
	 * @param {Object|null} metaSource
	 * @param {Object|null} typeSource
	 * @returns {Object}
	 */
	mergeMetaAndTypeVars(metaSource, typeSource) {
		const meta = (metaSource && typeof metaSource === 'object' && !Array.isArray(metaSource)) ? metaSource : {};
		const type = (typeSource && typeof typeSource === 'object' && !Array.isArray(typeSource)) ? typeSource : {};

		const metaGeneral = (meta.General && typeof meta.General === 'object' && !Array.isArray(meta.General)) ? meta.General : {};
		const metaVars = (metaGeneral.$VarsDef && typeof metaGeneral.$VarsDef === 'object' && !Array.isArray(metaGeneral.$VarsDef))
			? metaGeneral.$VarsDef
			: {};
		const typeVars = (type.$VarsDef && typeof type.$VarsDef === 'object' && !Array.isArray(type.$VarsDef))
			? type.$VarsDef
			: {};

		const typeMetaType = (type.$MetaType && typeof type.$MetaType === 'object' && !Array.isArray(type.$MetaType)) ? type.$MetaType : null;
		const typeDefType = Array.isArray(type.$DefType) ? type.$DefType : null;

		if (Object.keys(typeVars).length === 0 && !typeMetaType && !typeDefType) return meta;

		const result = {
			...meta,
			General: {
				...metaGeneral,
				$VarsDef: DataUtils.deepMerge(metaVars, typeVars)
			}
		};
		if (typeMetaType) result.$MetaType = typeMetaType;
		// $DefType（hashTag / $dict 宣言）も併せて返す。フィールド名と辞書名が異なる場合
		// （例: Belonging フィールド → Faction 辞書）、UI側の findDictNameInSchema() が
		// $DefType を必要とするため、これが欠けると辞書名解決に失敗し未翻訳のまま表示される。
		if (typeDefType) result.$DefType = typeDefType;
		return result;
	}

	/**
	 * v1/meta エンドポイント - グローバルメタデータ
	 * @returns {Promise<Response>}
	 */
	async handleMetaEndpoint() {
		const globalMeta = await this.dataFetcher.readGlobalMeta();
		return ResponseUtils.jsonResponse({
			name: 'meta',
			time: new Date().toISOString(),
			meta: globalMeta
		});
	}

	/**
	 * v1/typedef/global エンドポイント - グローバルタイプ定義
	 * @returns {Promise<Response>}
	 */
	async handleTypedefGlobalEndpoint() {
		const globalType = await this.dataFetcher.readGlobalType();
		return ResponseUtils.jsonResponse(globalType || {});
	}

	/**
	 * v1/deftype/global エンドポイント - グローバル定義タイプ
	 * @returns {Promise<Response>}
	 */
	async handleDeftypeGlobalEndpoint() {
		// NOTE: 「deftype」は db_meta.json 単体ではなく、
		// db_type.json 側の `$VarsDef` も併合した「表示辞書」として返す。
		// これにより、Decave のように type 側だけへ追加された enum 定義も
		// UI/API の両方で同じ経路から解決できる。
		const [globalMeta, globalType] = await Promise.all([
			this.dataFetcher.readGlobalMeta(),
			this.dataFetcher.readGlobalType()
		]);
		const merged = this.mergeMetaAndTypeVars(globalMeta, globalType);
		return ResponseUtils.jsonResponse(merged || {});
	}

	/**
	 * v1/works/{work}/meta エンドポイント - 作品メタデータ
	 * @param {string} workIdParam - 作品ID
	 * @returns {Promise<Response>}
	 */
	async handleWorkMetaEndpoint(workIdParam) {
		const workId = DataUtils.toWorkKey(workIdParam);
		if (!workId) return ResponseUtils.badRequest('Invalid works parameter');
		const [workMeta, workType] = await Promise.all([
			this.dataFetcher.readWorkMeta(workId),
			this.dataFetcher.readWorkType(workId)
		]);
		const mergedMeta = this.mergeMetaAndTypeVars(workMeta, workType);
		return ResponseUtils.jsonResponse({
			work: workId,
			meta: mergedMeta
		});
	}

	/**
	 * v1/works/{work}/typedef エンドポイント - 作品タイプ定義
	 * @param {string} workIdParam - 作品ID
	 * @returns {Promise<Response>}
	 */
	async handleWorkTypedefEndpoint(workIdParam) {
		const workId = DataUtils.toWorkKey(workIdParam);
		if (!workId) return ResponseUtils.badRequest('Invalid works parameter');
		const workType = await this.dataFetcher.readWorkType(workId);
		return ResponseUtils.jsonResponse({
			work: workId,
			typedef: workType
		});
	}

	/**
	 * 共通エンドポイントルーティング
	 * @param {Array<string>} seg - パスセグメント
	 * @param {URL} url - リクエストURL
	 * @returns {Promise<Response|null>} レスポンスまたはnull（未処理の場合）
	 */
	async routeCommonEndpoints(seg, url) {
		// v1/meta - グローバルメタデータ
		if (seg.length === 1 && seg[0] === 'meta') {
			return this.handleMetaEndpoint();
		}

		// v1/typedef/global - グローバルタイプ定義
		if (seg.length === 2 && seg[0] === 'typedef' && seg[1] === 'global') {
			return this.handleTypedefGlobalEndpoint();
		}

		// v1/deftype/global - グローバル定義タイプ
		if (seg.length === 2 && seg[0] === 'deftype' && seg[1] === 'global') {
			return this.handleDeftypeGlobalEndpoint();
		}

		// v1/works/{work}/meta - 作品メタデータ
		if (seg.length === 3 && seg[0] === 'works' && seg[2] === 'meta') {
			return this.handleWorkMetaEndpoint(seg[1]);
		}

		// v1/works/{work}/typedef - 作品タイプ定義
		if (seg.length === 3 && seg[0] === 'works' && seg[2] === 'typedef') {
			return this.handleWorkTypedefEndpoint(seg[1]);
		}

		return null; // 未処理
	}
}

/**
 * 標準エンドポイントハンドラークラス
 * 各Service Worker間で重複している標準的なエンドポイント処理を提供
 */
class StandardEndpointHandlers {
	constructor(dataFetcher, enrichmentProcessor, referenceResolver, scope = '') {
		this.dataFetcher = dataFetcher;
		this.enrichmentProcessor = enrichmentProcessor;
		this.referenceResolver = referenceResolver;
		this.scope = scope;
	}

	/**
	 * DB キーから既定の表示名を生成
	 * - db_meta.json に DB_Label が無い旧データでも UI が破綻しないようにする
	 * @param {string} dbKey
	 * @returns {{ DB_Label: string, DB_Label_EN: string }}
	 */
	buildDefaultDatabaseCatalogLabels(dbKey) {
		const normalized = String(dbKey || '').trim();
		const preset = {
			Primary: { DB_Label: '一次創作', DB_Label_EN: 'Primary' },
			SemiPrimary: { DB_Label: '準一次創作', DB_Label_EN: 'Semi-Primary' },
			Secondary: { DB_Label: '二次創作', DB_Label_EN: 'Secondary' },
			SelfSecondary: { DB_Label: 'セルフ二次創作', DB_Label_EN: 'Self-Secondary' },
			UnprocessedSecondary: { DB_Label: '未着工の二次創作', DB_Label_EN: 'Unprocessed Secondary' },
			PrimaryDealer: { DB_Label: '一次創作(アルカナ保有者)', DB_Label_EN: 'Primary(ArcanaHolders)' },
			PrimaryMobs: { DB_Label: '一次創作(モブ種族)', DB_Label_EN: 'Primary(Mobs)' },
			Proxy: { DB_Label: '代理', DB_Label_EN: 'Proxies' }
		};

		if (preset[normalized]) return preset[normalized];

		const spaced = normalized.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
		return {
			DB_Label: spaced || normalized,
			DB_Label_EN: spaced || normalized
		};
	}

	/**
	 * global db_meta.json の CreationWorks から、作品カタログ向け情報を抽出
	 * @param {string} workId
	 * @param {Object} globalMeta
	 * @returns {Object}
	 */
	buildWorkCatalogEntry(workId, globalMeta) {
		const info = globalMeta?.CreationWorks?.[workId] ?? {};
		return {
			key: workId,
			Title_JP: typeof info?.Title_JP === 'string' ? info.Title_JP : (typeof info?.Title === 'string' ? info.Title : ''),
			Title_EN: typeof info?.Title_EN === 'string' ? info.Title_EN : '',
			Works_Summary_JP: typeof info?.Works_Summary_JP === 'string' ? info.Works_Summary_JP : (typeof info?.Works_Summary === 'string' ? info.Works_Summary : ''),
			Works_Summary_EN: typeof info?.Works_Summary_EN === 'string' ? info.Works_Summary_EN : '',
			OldTitles: Array.isArray(info?.OldTitles) ? info.OldTitles : [],
			Works_OfficialLinks: Array.isArray(info?.Works_OfficialLinks) ? info.Works_OfficialLinks : [],
			Works_Shared: info?.Works_Shared === true
		};
	}

	/**
	 * 作品別 db_meta.json の Databases から、DB カタログ向け情報を付与
	 * @param {Array} databases
	 * @param {Object|null} workMeta
	 * @returns {Array}
	 */
	decorateDatabaseCatalogEntries(databases, workMeta, typeSources = []) {
		const items = Array.isArray(databases) ? databases : [];
		return items.map((db) => {
			const metaInfo = DataUtils.findMetaDbEntry(workMeta?.Databases, db?.key);
			const dbKey = metaInfo?.metaKey ?? DataUtils.normalizeDBKeyForMeta(db?.key);
			const dbMeta = metaInfo?.entry ?? null;
			const fallbackLabels = this.buildDefaultDatabaseCatalogLabels(db?.key);
			const layer = typeof dbMeta?.DB_Layer === 'string' && dbMeta.DB_Layer.trim()
				? dbMeta.DB_Layer
				: (typeof db?.layer === 'string' && db.layer.trim() ? db.layer : 'DataBases');
			const wrapperSummaries = buildDatabaseCatalogWrapperSummaries(dbMeta, typeSources);
			return {
				...db,
				metaKey: dbKey,
				DB_Label_JP: typeof dbMeta?.DB_Label_JP === 'string' && dbMeta.DB_Label_JP.trim()
					? dbMeta.DB_Label_JP
					: (typeof dbMeta?.DB_Label === 'string' && dbMeta.DB_Label.trim()
						? dbMeta.DB_Label
						: fallbackLabels.DB_Label),
				DB_Label_EN: typeof dbMeta?.DB_Label_EN === 'string' && dbMeta.DB_Label_EN.trim()
					? dbMeta.DB_Label_EN
					: fallbackLabels.DB_Label_EN,
				DB_Summary: typeof dbMeta?.DB_Summary === 'string' ? dbMeta.DB_Summary : '',
				DB_Summary_EN: typeof dbMeta?.DB_Summary_EN === 'string' ? dbMeta.DB_Summary_EN : '',
				DB_Layer: layer,
				StoryEra: dbMeta?.StoryEra ?? null,
				SecondarySummary_JP: typeof dbMeta?.SecondarySummary_JP === 'string' ? dbMeta.SecondarySummary_JP
					: (typeof dbMeta?.SecondarySummary === 'string' ? dbMeta.SecondarySummary : ''),
				SecondarySummary_EN: typeof dbMeta?.SecondarySummary_EN === 'string' ? dbMeta.SecondarySummary_EN : '',
				DB_Image: typeof dbMeta?.DB_Image === 'string' ? dbMeta.DB_Image : ''
				, ...wrapperSummaries
			};
		});
	}

	/**
	 * index エンドポイント - API インデックス情報
	 * @returns {Promise<Response>}
	 */
	async handleIndexEndpoint() {
		const globalMeta = await this.dataFetcher.readGlobalMeta();
		const response = {
			name: `100BeautiesLab Creations DB ${this.scope ? this.scope + ' ' : ''}API`,
			version: 1,
			time: new Date().toISOString(),
			works: Object.keys(globalMeta.CreationWorks || {})
				.filter((workId) => globalMeta.CreationWorks[workId]?.Works_Hidden !== true)
				.map((workId) => this.buildWorkCatalogEntry(workId, globalMeta))
		};

		if (this.scope) {
			response.scope = this.scope.toLowerCase();
		}

		return ResponseUtils.jsonResponse(response);
	}

	/**
	 * works エンドポイント - 作品一覧
	 * @returns {Promise<Response>}
	 */
	async handleWorksListEndpoint() {
		const globalMeta = await this.dataFetcher.readGlobalMeta();
		const works = Object.keys(globalMeta.CreationWorks || {})
			.filter((workId) => globalMeta.CreationWorks[workId]?.Works_Hidden !== true)
			.map((workId) => this.buildWorkCatalogEntry(workId, globalMeta));
		return ResponseUtils.jsonResponse(works);
	}

	/**
	 * bootstrap エンドポイント - ブートストラップ情報
	 * @param {URL} url - リクエストURL
	 * @param {boolean} defaultIncludeRecords - デフォルトでレコードを含めるか
	 * @param {boolean} defaultEnrich - デフォルトで充実化を行うか
	 * @returns {Promise<Response>}
	 */
	async handleBootstrapEndpoint(url, defaultIncludeRecords = false, defaultEnrich = false) {
		const includeRecordsParam = url.searchParams.get('includeRecords');
		const includeRecords = includeRecordsParam == null ? defaultIncludeRecords : DataUtils.truthy(includeRecordsParam);
		const enrichParam = url.searchParams.get('enrich');
		const enrich = enrichParam == null ? defaultEnrich : DataUtils.truthy(enrichParam);

		const globalMeta = await this.dataFetcher.readGlobalMeta();
		const works = Object.keys(globalMeta.CreationWorks || {})
			.filter((workId) => globalMeta.CreationWorks[workId]?.Works_Hidden !== true);
		const out = [];

		for (const workId of works) {
			let databases = await this.dataFetcher.listWorkDBs(workId);
			const item = {
				work: workId,
				workInfo: this.buildWorkCatalogEntry(workId, globalMeta),
				databases
			};

			// 作品別 db_meta.json は未整備の作品もあるため、bootstrap では
			// 「メタが無くても DB 一覧とレコード収集は継続する」方針を取る。
			// ここで workMeta を null 許容にしておくことで、_Commons 適用だけを安全にスキップできる。
			let workMeta = null;
			try {
				workMeta = await this.dataFetcher.readWorkMeta(workId);
			} catch {
				workMeta = null;
			}

			if (workMeta) {
				const globalType = await this.dataFetcher?.readGlobalType?.().catch(() => ({}));
				databases = this.decorateDatabaseCatalogEntries(databases, workMeta, [globalType, globalMeta]);
				item.databases = databases;
			}

			if (includeRecords) {
				item.data = {};
				for (const db of databases) {
					try {
						let records = await this.dataFetcher.readDB(workId, db.key);
						if (workMeta) {
							records = CommonsProcessor.applyCommonsToRecords(records, workMeta, db.key);
						}

						// 非公開レコードの除外は _Commons 適用「後」に行う。
						// isPrivate は _Secondaries[]._Commons 経由でシリーズ単位に注入されることがあり、
						// 適用前に除外するとレコード自身が isPrivate を宣言していない限り注入値が読まれない。
						records = filterPublicRecords(records);

						if (enrich && this.enrichmentProcessor && this.referenceResolver) {
							const resolveCache = new Map();
							records = await this.referenceResolver.resolveAllInAny(records, resolveCache);
							records = await this.enrichmentProcessor.enrichRecords(records, workId, db.key);
						}

						item.data[db.key] = records;
					} catch (e) {
						item.data[db.key] = { error: String(e) };
					}
				}
			}
			out.push(item);
		}

		const response = {
			name: 'bootstrap',
			time: new Date().toISOString(),
			works: out
		};

		if (this.scope) {
			response.scope = this.scope.toLowerCase();
		}

		if (enrich) {
			response.enriched = enrich;
		}

		return ResponseUtils.jsonResponse(response);
	}

	/**
	 * works/{work} エンドポイント - 作品情報
	 * @param {string} workIdParam - 作品ID
	 * @returns {Promise<Response>}
	 */
	async handleWorkEndpoint(workIdParam) {
		const workId = DataUtils.toWorkKey(workIdParam);
		if (!workId) return ResponseUtils.badRequest('Invalid works parameter');
		try {
			const [globalMeta, workMeta] = await Promise.all([
				this.dataFetcher.readGlobalMeta(),
				this.dataFetcher.readWorkMeta(workId)
			]);
			// Works_Hidden: true の作品は直接アクセスも 404 で遮断
			if (globalMeta?.CreationWorks?.[workId]?.Works_Hidden === true) {
				return ResponseUtils.notFound('Work not found');
			}
			return ResponseUtils.jsonResponse({
				work: workId,
				workInfo: this.buildWorkCatalogEntry(workId, globalMeta),
				meta: workMeta
			});
		} catch {
			// 作品メタが欠損していても、DB自体は存在しうる（フェーズ2: DB種別多様化への耐性）
			return ResponseUtils.notFound('Work metadata not found');
		}
	}

	/**
	 * works/{work}/db エンドポイント - 作品のデータベース一覧
	 * @param {string} workIdParam - 作品ID
	 * @returns {Promise<Response>}
	 */
	async handleWorkDbListEndpoint(workIdParam) {
		const workId = DataUtils.toWorkKey(workIdParam);
		if (!workId) return ResponseUtils.badRequest('Invalid works parameter');
		// Works_Hidden: true の作品はDBリストも 404 で遮断
		try {
			const globalMeta = await this.dataFetcher.readGlobalMeta();
			if (globalMeta?.CreationWorks?.[workId]?.Works_Hidden === true) {
				return ResponseUtils.notFound('Work not found');
			}
		} catch {
			// グローバルメタ欠損時はチェックをスキップ
		}
		let databases = await this.dataFetcher.listWorkDBs(workId);
		try {
			const [workMeta, globalType, globalMeta] = await Promise.all([
				this.dataFetcher.readWorkMeta(workId),
				this.dataFetcher?.readGlobalType?.().catch(() => ({})),
				this.dataFetcher?.readGlobalMeta?.().catch(() => ({}))
			]);
			databases = this.decorateDatabaseCatalogEntries(databases, workMeta, [globalType, globalMeta]);
		} catch {
			// 作品別 meta が無い場合は bare な DB 一覧だけ返す
		}
		return ResponseUtils.jsonResponse({ work: workId, databases });
	}

	/**
	 * works/{work}/db/{dbName} エンドポイント - データベース取得
	 * @param {string} workIdParam - 作品ID
	 * @param {string} dbName - データベース名
	 * @param {boolean} resolve - 参照解決フラグ
	 * @param {boolean} debug - デバッグフラグ
	 * @param {boolean} enrich - 充実化フラグ
	 * @returns {Promise<Response>}
	 */
	async handleDbEndpoint(workIdParam, dbName, resolve, debug, enrich = false) {
		const workId = DataUtils.toWorkKey(workIdParam);
		if (!workId) return ResponseUtils.badRequest('Invalid works parameter');
		if (!DataUtils.isValidDbName(dbName)) return ResponseUtils.badRequest('Invalid db parameter');

		// Works_Hidden: true の作品は配下のDBへのアクセスも 404 で遮断
		try {
			const globalMeta = await this.dataFetcher.readGlobalMeta();
			if (globalMeta?.CreationWorks?.[workId]?.Works_Hidden === true) {
				return ResponseUtils.notFound('Work not found');
			}
		} catch {
			// グローバルメタ欠損時はチェックをスキップ
		}

		// DB_Hidden: true のDBは直接アクセスも 404 で返す
		try {
			const workMeta = await this.dataFetcher.readWorkMeta(workId);
			const { entry: dbEntry } = DataUtils.findMetaDbEntry(workMeta?.Databases, dbName);
			if (dbEntry?.DB_Hidden === true) return ResponseUtils.notFound('Database not found');
		} catch {
			// メタ欠損時はフラグチェックをスキップ
		}

		let records;
		try {
			records = await this.dataFetcher.readDB(workId, dbName);
		} catch (e) {
			const msg = String(e && e.message ? e.message : e);
			if (msg.includes('Invalid')) return ResponseUtils.badRequest('Invalid works/db parameter');
			return ResponseUtils.notFound('Database not found');
		}

		// 作品別 db_meta.json は追加価値レイヤーとして扱い、欠損しても 500 にしない。
		// その場合は _Commons / _Secondaries だけをスキップして、DB 本体の取得は継続する。
		try {
			const workMeta = await this.dataFetcher.readWorkMeta(workId);
			records = CommonsProcessor.applyCommonsToRecords(records, workMeta, dbName);
		} catch {
			// メタ欠損時は _Commons 適用をスキップ
		}

		// 非公開レコードの除外は _Commons 適用「後」に行う。
		// isPrivate は _Secondaries[]._Commons 経由でシリーズ単位に注入されることがあり、
		// 適用前に除外するとレコード自身が isPrivate を宣言していない限り注入値が読まれない。
		// （メタ欠損で _Commons をスキップした場合も、レコード自身の宣言は必ず尊重する）
		records = filterPublicRecords(records);

		// 参照解決
		let resolveCache = new Map();
		if (resolve && this.referenceResolver) {
			records = await this.referenceResolver.resolveAllInAny(records, resolveCache);
		}

		// 充実化処理
		if (enrich && this.enrichmentProcessor) {
			records = await this.enrichmentProcessor.enrichRecords(records, workId, dbName);
		}

		const response = {
			work: workId,
			db: dbName,
			records: records,
			resolved: resolve
		};

		if (enrich) {
			response.enriched = true;
		}

		if (debug) {
			response.debug = {
				recordCount: records.length,
				commonsApplied: true,
				resolveCache: resolve ? resolveCache.size : 0
			};
		}

		return ResponseUtils.jsonResponse(response);
	}

	/**
	 * search エンドポイント - 検索
	 * @param {URL} url - リクエストURL
	 * @param {boolean} resolve - 参照解決フラグ
	 * @param {boolean} debug - デバッグフラグ
	 * @param {boolean} enrich - 充実化フラグ
	 * @returns {Promise<Response>}
	 */
	async handleSearchEndpoint(url, resolve, debug, enrich = false) {
		const params = url.searchParams;
		const workId = DataUtils.toWorkKey(params.get('works'));
		const dbName = params.get('db');
		const hashTag = params.getAll('hashTag');
		const key = params.getAll('key');

		if (!workId || !dbName || hashTag.length === 0 || key.length === 0 || hashTag.length !== key.length) {
			return ResponseUtils.badRequest('Query must include works, db, and pairs of hashTag & key');
		}

		// Works_Hidden: true の作品は検索も 404 で遮断
		try {
			const globalMeta = await this.dataFetcher.readGlobalMeta();
			if (globalMeta?.CreationWorks?.[workId]?.Works_Hidden === true) {
				return ResponseUtils.notFound('Work not found');
			}
		} catch {
			// グローバルメタ欠損時はチェックをスキップ
		}

		let records = await this.dataFetcher.readDB(workId, dbName);
		let workMeta = null;
		try {
			workMeta = await this.dataFetcher.readWorkMeta(workId);
			// DB_Hidden: true のDBは検索も 404 で遮断
			const { entry: dbEntry } = DataUtils.findMetaDbEntry(workMeta?.Databases, dbName);
			if (dbEntry?.DB_Hidden === true) return ResponseUtils.notFound('Database not found');
			records = CommonsProcessor.applyCommonsToRecords(records, workMeta, dbName);
		} catch {
			// メタ欠損時は _Commons 適用をスキップ
		}

		// 非公開レコードの除外は _Commons 適用「後」に行う。
		// isPrivate は _Secondaries[]._Commons 経由でシリーズ単位に注入されることがあり、
		// 適用前に除外すると、非公開指定されたレコードが検索結果に現れてしまう。
		records = filterPublicRecords(records);

		// 検索は hashTag/key の AND 条件を基本とし、比較ロジック自体は
		// EnrichmentProcessor.searchRecords() 側へ寄せて typedef 駆動にしている。
		const queries = hashTag.map((h, i) => ({ hashTag: h, key: key[i] }));
		let matched;
		if (this.enrichmentProcessor && typeof this.enrichmentProcessor.searchRecords === 'function') {
			matched = await this.enrichmentProcessor.searchRecords(records, workId, dbName, queries);
		} else {
			matched = SearchEngine.searchRecords(records, queries);
		}

		let resolveCache = new Map();
		if (resolve && this.referenceResolver) {
			matched = await this.referenceResolver.resolveAllInAny(matched, resolveCache);
		}

		// 充実化処理
		if (enrich && this.enrichmentProcessor) {
			matched = await this.enrichmentProcessor.enrichRecords(matched, workId, dbName);
		}

		const response = {
			work: workId,
			db: dbName,
			queries: queries,
			count: matched.length,
			records: matched,
			resolved: resolve
		};

		if (enrich) {
			response.enriched = true;
		}

		if (debug) {
			response.debug = {
				originalRecordCount: records.length,
				matchedCount: matched.length
			};
		}

		return ResponseUtils.jsonResponse(response);
	}

	/**
	 * works/{work}/varsdef エンドポイント - 作品変数定義取得
	 * @param {string} workIdParam - 作品ID
	 * @returns {Promise<Response>}
	 */
	async handleWorkVarsdefEndpoint(workIdParam) {
		const workId = DataUtils.toWorkKey(workIdParam);
		// 不正な works は 400 で明示的に弾く（従来 pages/sw.js のオーバーライド側にだけあった検証を共通化）
		if (!workId) return ResponseUtils.badRequest('Invalid works parameter');
		const workVars = await this.dataFetcher.readGeneralVarsDefWork(workId);
		const globalVars = await this.dataFetcher.readGeneralVarsDefGlobal();

		const response = {
			work: workId,
			varsdef: {
				global: globalVars,
				work: workVars
			},
			time: new Date().toISOString()
		};

		if (this.scope) {
			response.scope = this.scope.toLowerCase();
		}

		return ResponseUtils.jsonResponse(response);
	}

	/**
	 * 高度なエンドポイント（グローバルvarsdef など）のハンドリング
	 * @param {Array<string>} seg - パスセグメント
	 * @param {URL} url - リクエストURL
	 * @returns {Promise<Response|null>} レスポンスまたはnull（未処理の場合）
	 */
	async handleAdvancedEndpoints(seg, url) {
		// グローバルvarsdef エンドポイント
		if (seg.length === 1 && seg[0] === 'varsdef') {
			// varsdef は辞書の俯瞰用エンドポイント。
			// typedef 全体ではなく General.$VarsDef 中心の軽量な参照面を返す。
			const globalVars = await this.dataFetcher.readGeneralVarsDefGlobal();
			const response = {
				name: 'varsdef-overview',
				time: new Date().toISOString(),
				global: globalVars
			};

			if (this.scope) {
				response.scope = this.scope.toLowerCase();
			}

			return ResponseUtils.jsonResponse(response);
		}

		return null; // 未処理
	}
}

/**
 * 標準 API ルート表を備えた Service Worker 基底クラス
 *
 * @description
 * `api/sw.js` / `svc/sw.js` / `pages/sw.js` の 3 入口は、ルート表・依存の組み立て・
 * 事前キャッシュがすべて同一で、実際に異なるのは次の 3 点だけだった。
 * そのため差分をコンストラクタ引数へ追い出し、本クラスへ実装を集約している。
 *
 * 1. インターセプトするプレフィックス（pages のみ 3 本のエイリアスを持つ）
 * 2. `enrich` の既定値（pages は常時 true、api/svc は `?enrich=1` で opt-in）
 * 3. 固有エンドポイント（pages のみ `/enrich` を持つ）
 *
 * 3 について、サブクラスは `routeExtraEndpoints()` を実装して固有ルートを足す。
 *
 * `EnrichmentProcessor` / `ReferenceResolver` は `lib/data-common.js` 側の定義であり、
 * importScripts の順序では本ファイルより後に読み込まれる。コンストラクタが走るのは
 * 全 importScripts 完了後（入口ファイルの `new` 実行時）なので参照して問題ない。
 */
class StandardServiceWorker extends ServiceWorkerBase {
	/**
	 * @param {Object} options
	 * @param {string} options.scope - スコープ表示名（'API' / 'SVC' / 'Pages'）
	 * @param {(config: SWConfig) => string[]} [options.resolvePrefixes] - プレフィックス解決関数。既定は `[API_PREFIX]`
	 * @param {boolean} [options.enrichDefault=false] - `enrich` クエリ未指定時の既定値
	 */
	constructor({ scope, resolvePrefixes = null, enrichDefault = false } = {}) {
		// self.registration.scope はスコープ末尾に `/` を含むため、比較しやすい形へ落とす
		const scopePath = new URL('./', self.registration?.scope || self.location.href).pathname.replace(/\/$/, '');
		const swConfig = new SWConfig(scopePath);
		const prefixes = typeof resolvePrefixes === 'function'
			? resolvePrefixes(swConfig)
			: [swConfig.API_PREFIX];

		super(prefixes);

		this.scope = scope;
		this.swConfig = swConfig;
		this.enrichDefault = enrichDefault === true;
		this.dataFetcher = new DataFetcher(swConfig);
		this.enrichmentProcessor = new EnrichmentProcessor(this.dataFetcher, swConfig);
		this.referenceResolver = new ReferenceResolver(this.dataFetcher, swConfig);
		this.apiHandlers = new ApiEndpointHandlers(this.dataFetcher);
		this.standardHandlers = new StandardEndpointHandlers(
			this.dataFetcher,
			this.enrichmentProcessor,
			this.referenceResolver,
			scope
		);
	}

	/**
	 * 事前キャッシュ処理（全スコープ共通で db_meta.json のみ）
	 * @returns {Promise<void>}
	 */
	async precache() {
		try {
			const cache = await caches.open(CACHE_NAME);
			await cache.addAll([this.swConfig.withRepoBase('data/db_meta.json')]);
			console.log(`✅ ${this.scope} SW 事前キャッシュ完了: db_meta.json`);
		} catch (error) {
			console.warn(`⚠️ ${this.scope} SW 事前キャッシュ失敗:`, error);
		}
	}

	/**
	 * APIリクエスト処理のメインハンドラー
	 * @param {URL} url - リクエストURL
	 * @param {string} apiPrefix - マッチしたAPIプレフィックス
	 * @returns {Promise<Response>} APIレスポンス
	 */
	async handleApiRequest(url, apiPrefix) {
		const seg = url.pathname.substring(apiPrefix.length).split('/').filter(Boolean);

		// 解決フラグ（デフォルトで有効、?resolve=0で無効化）
		const resolveParam = url.searchParams.get('resolve');
		const resolve = resolveParam == null ? true : DataUtils.truthy(resolveParam);

		// デバッグフラグ
		const debug = DataUtils.truthy(url.searchParams.get('debug'));

		// エンリッチフラグ（pages は常時有効、api/svc は ?enrich=1 で opt-in）
		const enrich = this.enrichDefault || DataUtils.truthy(url.searchParams.get('enrich'));

		return this.routeApiRequest(seg, url, resolve, debug, enrich);
	}

	/**
	 * APIエンドポイントのルーティング処理
	 * @param {Array<string>} seg - パスセグメント配列
	 * @param {URL} url - リクエストURL
	 * @param {boolean} resolve - 参照解決フラグ
	 * @param {boolean} debug - デバッグフラグ
	 * @param {boolean} enrich - エンリッチメントフラグ
	 * @returns {Promise<Response>} APIレスポンス
	 */
	async routeApiRequest(seg, url, resolve, debug, enrich) {
		// 共通エンドポイント（index/health 等）を先にチェック
		const commonResponse = await this.apiHandlers.routeCommonEndpoints(seg, url);
		if (commonResponse) return commonResponse;

		const h = this.standardHandlers;

		// /{prefix}/index - API インデックス情報
		if (seg.length === 1 && seg[0] === 'index') return h.handleIndexEndpoint();

		// /{prefix}/works - 作品一覧
		if (seg.length === 1 && seg[0] === 'works') return h.handleWorksListEndpoint();

		// /{prefix}/bootstrap - ブートストラップ情報
		if (seg.length === 1 && seg[0] === 'bootstrap') {
			return h.handleBootstrapEndpoint(url, this.enrichDefault, this.enrichDefault);
		}

		// /{prefix}/search - 検索エンドポイント
		if (seg.length === 1 && seg[0] === 'search') {
			return h.handleSearchEndpoint(url, resolve, debug, enrich);
		}

		// /{prefix}/works/{work} - 作品情報
		if (seg.length === 2 && seg[0] === 'works') return h.handleWorkEndpoint(seg[1]);

		// /{prefix}/works/{work}/db - 作品のデータベース一覧
		if (seg.length === 3 && seg[0] === 'works' && seg[2] === 'db') {
			return h.handleWorkDbListEndpoint(seg[1]);
		}

		// /{prefix}/works/{work}/varsdef - 作品変数定義取得
		if (seg.length === 3 && seg[0] === 'works' && seg[2] === 'varsdef') {
			return h.handleWorkVarsdefEndpoint(seg[1]);
		}

		// /{prefix}/works/{work}/db/{dbName} - データベース取得
		if (seg.length === 4 && seg[0] === 'works' && seg[2] === 'db') {
			return h.handleDbEndpoint(seg[1], seg[3], resolve, debug, enrich);
		}

		// スコープ固有のエンドポイント（例: pages の /enrich）
		const extraResponse = await this.routeExtraEndpoints(seg, url, resolve, debug, enrich);
		if (extraResponse) return extraResponse;

		// 高度なエンドポイント（グローバル varsdef など）
		const advancedResponse = await h.handleAdvancedEndpoints(seg, url);
		if (advancedResponse) return advancedResponse;

		// 未知パスは必ず Response を返す。
		// handleAdvancedEndpoints() は未処理時に null を返すため、そのまま return すると
		// ServiceWorkerBase の event.respondWith(null) となり 404 ではなくネットワークエラーになる。
		return ResponseUtils.notFound('Unknown API path');
	}

	/**
	 * スコープ固有エンドポイントのルーティング（サブクラスで任意に実装）
	 * @returns {Promise<Response|null>} レスポンスまたは null（未処理）
	 */
	async routeExtraEndpoints() {
		return null;
	}
}

// エクスポート（Service Worker環境ではグローバルに公開）
if (typeof self !== 'undefined') {
	// Service Worker環境
	self.SWConfig = SWConfig;
	self.StandardServiceWorker = StandardServiceWorker;
	self.ResponseUtils = ResponseUtils;
	self.DataFetcher = DataFetcher;
	self.DataUtils = DataUtils;
	self.SearchEngine = SearchEngine;
	self.CommonsProcessor = CommonsProcessor;
	self.ServiceWorkerBase = ServiceWorkerBase;
	self.ApiEndpointHandlers = ApiEndpointHandlers;
	self.StandardEndpointHandlers = StandardEndpointHandlers;
	self.CACHE_NAME = CACHE_NAME;
	self.WORK_CTX_TTL_MS = WORK_CTX_TTL_MS;
	self.WORK_CTX_CACHE = WORK_CTX_CACHE;
}

console.log('📚 Service Worker 共通ライブラリがロードされました');
