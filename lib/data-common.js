/**
 * データ処理共通ライブラリ
 *
 * データベースの参照解決、画像パス生成、エンリッチメント処理など
 * データ操作に関する共通機能を提供します。
 * Service WorkerとフロントエンドJavaScriptの両方で利用可能です。
 *
 * @fileoverview データ処理共通機能ライブラリ
 * @author 100BeautiesLab Creations Database Team
 * @version 1.0.0
 */

// 旧作品「Works_Proxies」直リンク・API直叩き互換: 統合先(Works_DestinyFoxRecords)へ読み替える
// (lib/sw-common.js 側にも同名関数があるが、SW環境では importScripts の読み込み順で本ファイルの定義が
//  最終的に有効になるため、ここにも同じエイリアスを持たせて整合させる)
// NOTE: sw-common.js のトップレベル `const LEGACY_WORK_DIR_ALIASES` と同一グローバルへ読み込まれるため、
//  同名 const の二重宣言（SyntaxError で SW 全体の評価が失敗する）を避けるべく別名で保持する。
//  function 宣言同士の重複は classic script では合法（後勝ち）なので resolveWorkDirName はそのまま。
const DATA_COMMON_LEGACY_WORK_DIR_ALIASES = { Proxies: 'Works_DestinyFoxRecords' };

function resolveWorkDirName(workId) {
	const dir = String(workId || '').replace('#Works_', 'Works_');
	const bare = dir.replace(/^Works_/, '');
	return DATA_COMMON_LEGACY_WORK_DIR_ALIASES[bare] || dir;
}

function isPublicRecord(record) {
	if (!record || typeof record !== 'object' || Array.isArray(record)) return true;
	return !(record.isPrivate === true || String(record.isPrivate || '').trim().toLowerCase() === 'true');
}

function filterPublicRecords(records) {
	if (!Array.isArray(records)) return [];
	return records.filter(isPublicRecord);
}

/**
 * 作品別 db_meta.json の `Databases` から、DB名に対応する `#DB_*`/`#Ref_*`/`#Loc_*` エントリを取得する。
 * pages/characters.js の findDbCatalogEntry() と同一ロジック（SW側での同等実装）。
 * @param {Object} workMeta - 作品別 db_meta.json
 * @param {string} dbName
 * @returns {Object|null}
 */
function findDbEntryInWorkMeta(workMeta, dbName) {
	const databases = (workMeta && typeof workMeta === 'object' && workMeta.Databases && typeof workMeta.Databases === 'object')
		? workMeta.Databases
		: null;
	if (!databases) return null;

	const rawName = String(dbName || '').replace(/^#?(DB|Ref|Loc)_/i, '').trim();
	if (!rawName) return null;
	const normalized = `${rawName.charAt(0).toUpperCase()}${rawName.slice(1)}`;
	return databases[`#DB_${normalized}`] || databases[`#Ref_${normalized}`] || databases[`#Loc_${normalized}`] || null;
}

/**
 * 画像の絶対パス構築（`resolveImagePath()` と `_DBCrossLinkPath` の共通実装）
 *
 * @description folderHint を**必ず一度だけ**含め、拡張子が無ければ `.png` を補う。
 *
 * かつては `ImageProcessor.resolveImagePath()` が別実装で、値にスラッシュを含む場合に
 * folderHint を落としていた（`conceptAlt/` のようなセグメントが欠落する）うえ拡張子も補わなかった。
 * この差により `_enrichment.images` / `_enrichment.primaryImage` が返す URL は
 * **PNG 系 613 件中 0 件しか実在しない**状態になっていた（`pages/characters.js` は自前の
 * `appendExtIfMissing()` で組み立てるため無傷だったが、`pages/relations.js` は enrich 出力を直接使う）。
 * 2026-08-02 に `resolveImagePath()` を本関数へ寄せて一本化した。
 *
 * @param {string} workPath - resolveWorkDirName() 済みの作品ディレクトリ名
 * @param {string} dbPath - ImageProcessor.mapDbNameToImageDir() 済みの画像DBディレクトリ名
 * @param {string|null} folderHint - typedef 由来のサブフォルダ名（`concept` / `conceptAlt` 等）
 * @param {string} rawValue - レコードの画像フィールド生値（相対パス/ファイル名）
 * @returns {string} '/data/...' 形式の絶対パス（拡張子未指定時は既定で .png を付与）
 */
function buildCrossLinkImageAbsolutePath(workPath, dbPath, folderHint, rawValue) {
	const normalized = String(rawValue || '').replace(/\\/g, '/').replace(/^\/+/, '');
	let rel = normalized;
	if (folderHint) {
		const prefixLower = `${String(folderHint).toLowerCase()}/`;
		if (rel.toLowerCase().startsWith(prefixLower)) rel = rel.slice(String(folderHint).length + 1);
	}
	if (!/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(rel)) rel = `${rel}.png`;
	const dir = folderHint ? `${folderHint}/` : '';
	return `/data/${workPath}/Images/${dbPath}/${dir}${rel}`;
}

/**
 * `{FieldName}_DBLink` suffix エンリッチメント用のネスト subset match。
 * idxRaw の全キーが recordVal に同値で含まれていれば true。
 * 例: recordVal={Suit:"Major",SuitNum:0,Num:22}, idxRaw={Suit:"Major",SuitNum:0} → true
 * クエリ側の null は「レコード側も null/undefined」の明示マッチとして扱う
 * （例: UnauthedLogica の Model: { LogicSeries: null, Num: null } のような型番未確定インデックス）。
 * null を含む照合は曖昧になりやすいため、呼び出し側で「1件一致のみ採用」を担保すること。
 * @param {*} recordVal @param {Object} idxRaw
 * @returns {boolean}
 */
function dbLinkSubsetMatch(recordVal, idxRaw) {
	if (!recordVal || !idxRaw || typeof recordVal !== 'object' || typeof idxRaw !== 'object') return false;
	return Object.keys(idxRaw).every(k => {
		const rv = recordVal[k], qv = idxRaw[k];
		if (qv === null) return rv === null || rv === undefined;
		if (typeof qv === 'object') return dbLinkSubsetMatch(rv, qv);
		return rv !== null && rv !== undefined && String(rv) === String(qv);
	});
}

/**
 * `$Def_DBLinkRef` エントリのインデックス値に null が含まれるか（ネスト対応）。
 * null 入りインデックスは複数レコードに一致し得るため、解決時の曖昧一致ガードに使う。
 * @param {*} idxRaw
 * @returns {boolean}
 */
function dbLinkIndexHasNull(idxRaw) {
	if (idxRaw === null) return true;
	if (!idxRaw || typeof idxRaw !== 'object' || Array.isArray(idxRaw)) return false;
	return Object.values(idxRaw).some(dbLinkIndexHasNull);
}

/**
 * DB名から二次創作系コンテキストかどうかを判定
 * - SemiPrimary / PrimaryDealer は一次創作寄りとして扱う
 * @param {string} dbName
 * @returns {boolean}
 */
function isSecondaryDbNameForEnrich(dbName) {
	const name = String(dbName || '').toLowerCase();
	if (!name) return false;
	if (name.includes('semiprimary')) return false;
	return name.includes('secondary');
}

function getCharacterValueWrapperRegistry() {
	return globalThis?.CharacterValueWrapperRegistry || null;
}

/**
 * 参照解決エンジンクラス
 * データベース間の参照を解決し、関連データを統合
 */
class ReferenceResolver {
	/**
	 * @param {Object} dataFetcher - データ取得インスタンス (fetchJSON メソッドを持つ)
	 * @param {Object} config - 設定オブジェクト (withRepoBase メソッドを持つ)
	 */
	constructor(dataFetcher, config) {
		this.dataFetcher = dataFetcher;
		this.config = config;
	}

	/**
	 * 任意のオブジェクト内の全ての参照を解決
	 * @param {any} obj - 処理対象オブジェクト
	 * @param {Map} resolveCache - 解決キャッシュ
	 * @returns {Promise<any>} 参照解決後のオブジェクト
	 */
	async resolveAllInAny(obj, resolveCache = new Map()) {
		if (!obj) return obj;

		if (Array.isArray(obj)) {
			const promises = obj.map(item => this.resolveAllInAny(item, resolveCache));
			return Promise.all(promises);
		}

		if (typeof obj === 'object') {
			const result = {};
			const entries = Object.entries(obj);

			for (const [key, value] of entries) {
				if (key.startsWith('#') && typeof value === 'string') {
					// 参照フィールドの解決
					try {
						const resolved = await this.resolveReference(key, value, resolveCache);
						result[key] = resolved;
					} catch (error) {
						console.warn(`参照解決失敗 ${key}=${value}:`, error.message);
						result[key] = value; // 失敗時は元の値を保持
					}
				} else {
					// 通常フィールドの再帰処理
					result[key] = await this.resolveAllInAny(value, resolveCache);
				}
			}
			return result;
		}

		return obj; // プリミティブ値はそのまま返す
	}

	/**
	 * 単一の参照を解決
	 * @param {string} key - 参照キー
	 * @param {string} value - 参照値
	 * @param {Map} resolveCache - 解決キャッシュ
	 * @returns {Promise<any>} 解決された値
	 */
	async resolveReference(key, value, resolveCache = new Map()) {
		const cacheKey = `${key}:${value}`;
		if (resolveCache.has(cacheKey)) {
			return resolveCache.get(cacheKey);
		}

		let resolved = value;

		try {
			if (key === '#Works') {
				resolved = await this.resolveWorksReference(value);
			} else if (key === '#DB') {
				resolved = await this.resolveDBReference(value);
			} else if (key.startsWith('#$image')) {
				resolved = await this.resolveImageReference(key, value);
			} else if (key.startsWith('#')) {
				// その他の参照タイプ（将来の拡張用）
				resolved = await this.resolveGenericReference(key, value);
			}
		} catch (error) {
			console.warn(`参照解決エラー ${cacheKey}:`, error);
			resolved = value; // エラー時は元の値を返す
		}

		resolveCache.set(cacheKey, resolved);
		return resolved;
	}

	/**
	 * Works参照の解決
	 * @param {string} workId - 作品ID
	 * @returns {Promise<Object>} 作品メタデータ
	 */
	async resolveWorksReference(workId) {
		const normalizedId = this.normalizeWorkId(workId);
		const metaPath = `/data/${resolveWorkDirName(normalizedId)}/DataBases/db_meta.json`;
		return this.dataFetcher.fetchJSON(metaPath);
	}

	/**
	 * DB参照の解決
	 * @param {string} dbRef - データベース参照 (format: "WorkId.DBName" or "WorkId.DBName.FieldName=Value")
	 * @returns {Promise<Array|Object>} データベース結果
	 */
	async resolveDBReference(dbRef) {
		const parts = dbRef.split('.');
		if (parts.length < 2) throw new Error(`Invalid DB reference format: ${dbRef}`);

		const workId = this.normalizeWorkId(parts[0]);
		const dbName = parts[1];

		// データベースファイルを読み込み
		const dbPath = `/data/${resolveWorkDirName(workId)}/DataBases/db_${dbName}.json`;
		const records = await this.dataFetcher.fetchJSON(dbPath);

		if (parts.length === 2) {
			// 全レコードを返す
			return records;
		}

		// フィールド条件がある場合はフィルタリング
		const filterPart = parts.slice(2).join('.');
		const [fieldName, fieldValue] = filterPart.split('=');

		if (fieldValue) {
			return records.filter(record => {
				const value = this.getNestedValue(record, fieldName);
				return String(value) === fieldValue;
			});
		}

		return records;
	}

	/**
	 * 画像参照の解決
	 * @param {string} key - 画像参照キー
	 * @param {string} value - 画像パス
	 * @returns {Promise<string>} 解決された画像URL
	 */
	async resolveImageReference(key, value) {
		// 既に完全なURLの場合はそのまま返す
		if (value.startsWith('http://') || value.startsWith('https://')) {
			return value;
		}

		// 相対パスを絶対パスに変換
		const fullPath = this.config.withRepoBase(value);
		return new URL(fullPath, this.config.ORIGIN || location.origin).toString();
	}

	/**
	 * 汎用参照の解決（将来の拡張用）
	 * @param {string} key - 参照キー
	 * @param {string} value - 参照値
	 * @returns {Promise<any>} 解決された値
	 */
	async resolveGenericReference(key, value) {
		// 現在は未実装、将来的に特殊な参照タイプを追加予定
		return value;
	}

	/**
	 * 作品IDを正規化
	 * @param {string} workId - 作品ID
	 * @returns {string} 正規化された作品ID
	 */
	normalizeWorkId(workId) {
		if (!workId) return '';
		if (workId.startsWith('#Works_')) return workId;
		if (workId.startsWith('Works_')) return '#' + workId;
		return `#Works_${workId}`;
	}

	/**
	 * ネストされたオブジェクトから値を取得
	 * @param {Object} obj - 取得元オブジェクト
	 * @param {string} path - パス（ドット区切り）
	 * @returns {any} 取得された値
	 */
	getNestedValue(obj, path) {
		return path.split('.').reduce((current, key) => {
			return current && current[key] !== undefined ? current[key] : undefined;
		}, obj);
	}
}

/**
 * エンリッチメント処理クラス
 * データベースの構造化とインデックス生成を担当
 */
class EnrichmentProcessor {
	/**
	 * @param {Object} dataFetcher - データ取得インスタンス
	 * @param {Object} config - 設定オブジェクト
	 */
	constructor(dataFetcher, config) {
		this.dataFetcher = dataFetcher;
		this.config = config;
		this.resolver = new ReferenceResolver(dataFetcher, config);

		// SW側で work ごとの typedef/varsdef をキャッシュし、enrich/search の挙動をスキーマ追従にする
		this._workCtxCache = new Map();
	}

	/**
	 * typedef / varsdef を work ごとにマージし、enrichment/search 用のコンテキストを構築
	 * @param {string} workId - 作品ID
	 * @returns {Promise<{ mergedVars: Object, defTypeMerged: Array, indices: Object }>} work context
	 */
	async getWorkContext(workId) {
		const now = Date.now();
		const cache = (typeof WORK_CTX_CACHE !== 'undefined' && WORK_CTX_CACHE && typeof WORK_CTX_CACHE.get === 'function')
			? WORK_CTX_CACHE
			: this._workCtxCache;

		const hit = cache.get(workId);
		if (hit && (now - hit.t) < (typeof WORK_CTX_TTL_MS === 'number' ? WORK_CTX_TTL_MS : 15 * 1000)) {
			return hit;
		}

		// VarsDef は db_meta.json だけでは完結せず、db_type.json($VarsDef) にも分散し得る。
		// そのため enrich/search では両方を合成した辞書を「現在の work context」として扱う。
		const [globalVarsMeta, workVarsMeta, globalType, workType, globalMeta] = await Promise.all([
			this.dataFetcher?.readGeneralVarsDefGlobal?.() ?? {},
			this.dataFetcher?.readGeneralVarsDefWork?.(workId) ?? {},
			this.dataFetcher?.readGlobalType?.() ?? {},
			this.dataFetcher?.readWorkType?.(workId) ?? {},
			this.dataFetcher?.readGlobalMeta?.() ?? {},
		]);

		let mergedVars = globalVarsMeta || {};
		mergedVars = (typeof DataUtils !== 'undefined' && DataUtils.deepMerge) ? DataUtils.deepMerge(mergedVars, workVarsMeta || {}) : { ...(mergedVars || {}), ...(workVarsMeta || {}) };
		mergedVars = (typeof DataUtils !== 'undefined' && DataUtils.deepMerge) ? DataUtils.deepMerge(mergedVars, globalType?.$VarsDef || {}) : { ...(mergedVars || {}), ...(globalType?.$VarsDef || {}) };
		mergedVars = (typeof DataUtils !== 'undefined' && DataUtils.deepMerge) ? DataUtils.deepMerge(mergedVars, workType?.$VarsDef || {}) : { ...(mergedVars || {}), ...(workType?.$VarsDef || {}) };

		// $DetailLayout は $DefType の $slotOrder（catch-all スロット内を subFields 順へ寄せる）解決に使う
		const detailLayout = globalMeta?.CreationWorks?.[workId]?.$DetailLayout ?? null;
		const defTypeMerged = TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout });
		const indices = this.buildEnrichmentIndices(mergedVars, defTypeMerged);

		// work の index 定義
		// - 既定: workType.$IndexDef（typedef 側へ集約）
		// - 後方互換: globalMeta.CreationWorks.<work>.$DefType_Index / $Def_Index（旧）
		const indexDef = (() => {
			if (workType && typeof workType === 'object' && workType.$IndexDef && typeof workType.$IndexDef === 'object') {
				return workType.$IndexDef;
			}
			const workMeta = globalMeta?.CreationWorks?.[workId] ?? null;
			return workMeta?.$DefType_Index ?? workMeta?.$Def_Index ?? null;
		})();

		const ctx = { t: now, mergedVars, defTypeMerged, indices, indexDef, globalType, workType, globalMeta };
		cache.set(workId, ctx);
		return ctx;
	}

	/**
	 * DB固有の $IndexDef（サイドカーキー $IndexDef_DbNorm）を解決する
	 * - migrate.mjs の $IndexDef_${dbNorm} 命名規則と揃えたもの
	 * - 未宣言の場合は work既定の ctx.indexDef にフォールバックする（既存作品は無変化）
	 * @param {Object} ctx - getWorkContext() が返す work context
	 * @param {string} dbName - データベース名
	 * @returns {Object|null} 解決済み IndexDef
	 */
	resolveIndexDefForDb(ctx, dbName) {
		// DataUtils が未ロードでも動くよう、prefix除去+先頭大文字化を自前でも行う
		// （本番の SW/UI では sw-common.js が先に読み込まれるため DataUtils を優先する）
		const stripPrefix = (typeof DataUtils !== 'undefined' && DataUtils.stripMetaDbPrefix)
			? DataUtils.stripMetaDbPrefix
			: (s) => String(s || '').trim().replace(/^#?(DB|Ref|Loc)_/i, '').replace(/^[#]/, '');
		const capitalize = (typeof DataUtils !== 'undefined' && DataUtils.capitalize)
			? DataUtils.capitalize
			: (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
		const dbNorm = dbName ? capitalize(stripPrefix(dbName)) : '';
		const scoped = dbNorm ? ctx?.workType?.[`$IndexDef_${dbNorm}`] : null;
		return (scoped && typeof scoped === 'object') ? scoped : (ctx?.indexDef ?? null);
	}

	/**
	 * エンリッチメントインデックスを構築
	 * @param {Object} mergedVars - マージされた変数定義
	 * @param {Object} defTypeMerged - マージされた型定義
	 * @returns {Object} インデックスオブジェクト
	 */
	buildEnrichmentIndices(mergedVars, defTypeMerged) {
		const indices = {
			imageFields: new Set(),
			enumFields: new Map(),
			refFields: new Set(),
			searchableFields: new Set(),
			displayFields: new Map(),
			listLinkLookups: new Map(),

			// $alt: primary が無い場合に代替キーを参照する宣言
			// - key -> [altKey...]
			altFallbackMap: new Map(),

			// typedef 駆動の表示分類（最優先）
			displaySections: new Map(), // fieldKey -> sectionId

			// typedef 駆動の画像抽出（優先度3）
			imagePathHints: [] // [{ path, key, type, folderHint }]
		};

		// 型定義から情報を抽出（$DefType 配列 / 互換オブジェクトの両対応）
		// - $Def_* 名前付き参照（例: "$Def_TailsUnit[]"）を辿れるよう、mergedVars を
		//   resolveTypeDefContainer 互換の形（$VarsDef / General.$VarsDef 両方の入口）に包んで渡す
		if (defTypeMerged) {
			const typeSources = (mergedVars && typeof mergedVars === 'object')
				? [{ $VarsDef: mergedVars, General: { $VarsDef: mergedVars } }]
				: [];
			this.extractFromTypeDefinition(defTypeMerged, indices, typeSources);
		}

		// 変数定義から情報を抽出
		if (mergedVars) {
			this.extractFromVarDefinition(mergedVars, indices);
		}

		return indices;
	}

	/**
	 * `_DBLink` 定義（単体/配列）を正規化
	 * @param {any} v
	 * @returns {Array<Object>}
	 */
	normalizeDbLinkDefs(v) {
		const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
		if (!v) return [];
		if (Array.isArray(v)) return v.filter(isObj);
		return isObj(v) ? [v] : [];
	}

	/**
	 * worksTitle（例: 'NumberTales'）を workKey（例: '#Works_NumberTales'）に正規化
	 * @param {string} worksTitle
	 * @returns {string}
	 */
	toWorkKeyFromWorksTitle(worksTitle) {
		if (!worksTitle) return '';
		const s = String(worksTitle).trim();
		if (!s) return '';
		if (s.startsWith('#Works_')) return s;
		if (s.startsWith('Works_')) return `#${s}`;
		return `#Works_${s}`;
	}

	/**
	 * 参照先DBを読み込み、`_Search` に一致するレコードを返す（キャッシュ付き）
	 * - `_Search` が空の場合は null（意図しない大量マージ防止）
	 * - 複数一致の場合も null（曖昧さ回避）
	 * @param {Object} dbLinkDef - `{worksTitle, dbName, _Search:[{hashTag,key}]}`
	 * @param {Map<string, Promise<Object|null>>} cache
	 * @returns {Promise<Object|null>} 一致した参照先レコード、または null
	 */
	async resolveDbLinkPrimaryRecord(dbLinkDef, cache) {
		if (!dbLinkDef || typeof dbLinkDef !== 'object') return null;
		const worksTitle = typeof dbLinkDef.worksTitle === 'string' ? dbLinkDef.worksTitle.trim() : '';
		const dbName = typeof dbLinkDef.dbName === 'string' ? dbLinkDef.dbName.trim() : '';
		const queries = Array.isArray(dbLinkDef._Search) ? dbLinkDef._Search : [];
		if (!worksTitle || !dbName) return null;
		if (!Array.isArray(queries) || queries.length === 0) return null;

		const key = `${worksTitle}|${dbName}|${JSON.stringify(queries)}`;
		if (cache && cache.has(key)) {
			return cache.get(key);
		}

		const p = (async () => {
			try {
				const workKey = this.toWorkKeyFromWorksTitle(worksTitle);

				// DataFetcher の readDB を優先（SW側）
				const readDB = this.dataFetcher?.readDB;
				const allRecords = typeof readDB === 'function'
					? await readDB.call(this.dataFetcher, workKey, dbName)
					: await this.dataFetcher?.fetchJSON?.(`/data/${resolveWorkDirName(workKey)}/DataBases/db_${dbName}.json`);

				const publicRecords = filterPublicRecords(allRecords);

				if (!Array.isArray(publicRecords) || publicRecords.length === 0) return null;

				// typedef駆動の検索比較（既存の比較器/正規化を再利用）
				const matched = await this.searchRecords(publicRecords, workKey, dbName, queries);
				if (!Array.isArray(matched) || matched.length !== 1) return null;
				const rec = matched[0];
				return (rec && typeof rec === 'object') ? rec : null;
			} catch (e) {
				console.warn('⚠️ _DBLink 解決に失敗:', e);
				return null;
			}
		})();

		if (cache) cache.set(key, p);
		return p;
	}

	/**
	 * `{FieldName}_DBLink` suffix エントリから参照先レコードを直接ルックアップ（`$enrich` 専用）。
	 * `_Search` に依存せず、エントリの非センチネルキーをインデックスとして直接比較する。
	 * - スカラー index: `String(r[idxKey]) === String(idxRaw)`
	 * - ネスト index: `dbLinkSubsetMatch(r[idxKey], idxRaw)`（subset match）
	 * @param {Object} entry - `$Def_DBLinkRef` エントリ（例: `{ Num: 67, _DB: "Primary" }`）
	 * @param {string} defaultWorkId - `_Work` 未指定時のデフォルト workId
	 * @param {string} defaultDB - `_DB` 未指定時のデフォルト DB 名
	 * @param {Map} cache - 呼び出し元が管理する Promise キャッシュ
	 * @returns {Promise<Object|null>}
	 */
	async resolveDbLinkSuffixRef(entry, defaultWorkId, defaultDB, cache) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

		const SENTINEL = new Set(['_DB', '_Work', 'label_JP', 'label_EN']);
		let idxKey = null, idxRaw;
		for (const k of Object.keys(entry)) {
			if (SENTINEL.has(k)) continue;
			idxKey = k; idxRaw = entry[k]; break;
		}
		if (!idxKey || idxRaw === null || idxRaw === undefined) return null;

		const targetWorkRaw = typeof entry._Work === 'string' ? entry._Work.trim() : '';
		const targetWorkId = targetWorkRaw ? this.toWorkKeyFromWorksTitle(targetWorkRaw) : defaultWorkId;
		const targetDB = typeof entry._DB === 'string' ? entry._DB.trim() : defaultDB;
		if (!targetDB) return null;

		const cacheKey = `sfx|${targetWorkId}|${targetDB}|${idxKey}|${JSON.stringify(idxRaw)}`;
		if (cache?.has(cacheKey)) return cache.get(cacheKey);

		const p = (async () => {
			try {
				const readDB = this.dataFetcher?.readDB;
				const allRecords = typeof readDB === 'function'
					? await readDB.call(this.dataFetcher, targetWorkId, targetDB)
					: await this.dataFetcher?.fetchJSON?.(`/data/${resolveWorkDirName(targetWorkId)}/DataBases/db_${targetDB}.json`);

				const publicRecords = filterPublicRecords(allRecords);
				if (!Array.isArray(publicRecords) || !publicRecords.length) return null;

				const isNested = typeof idxRaw === 'object' && idxRaw !== null && !Array.isArray(idxRaw);
				const matchRecord = (r) => {
					if (!r) return false;
					const rv = r[idxKey];
					if (isNested) return dbLinkSubsetMatch(rv, idxRaw);
					return rv !== null && rv !== undefined && String(rv) === String(idxRaw);
				};

				// null 入りインデックス（例: Model: { LogicSeries: null, Num: null }）は
				// 複数レコードに一致し得るため、曖昧一致防止として 1 件一致のみ採用する
				if (isNested && dbLinkIndexHasNull(idxRaw)) {
					const matched = publicRecords.filter(matchRecord);
					return matched.length === 1 ? matched[0] : null;
				}

				return publicRecords.find(matchRecord) || null;
			} catch (_) {
				return null;
			}
		})();

		if (cache) cache.set(cacheKey, p);
		return p;
	}

	/**
	 * 対象Work/DBが `Works_Hidden`/`DB_Hidden` で完全非公開に設定されていないかを確認する。
	 * `_DBCrossLinkPath` はレコードを介さない直接パス参照のため `isPrivate` のような
	 * レコード単位の制御は概念上適用できないが、SW全体で「完全404遮断」としている
	 * Work/DB単位の非公開制御（docs/api-sw-spec.md §5.3/§5.4）だけは同じ強度で尊重する。
	 * @param {string} targetWorkId - '#Works_XXX' 形式
	 * @param {string} targetDB - 参照先DB名
	 * @param {Map} cache - 対象Workの db_meta.json 取得結果を使い回すためのキャッシュ
	 * @returns {Promise<boolean>} true なら非公開（解決を拒否すべき）
	 */
	async isCrossLinkTargetHidden(targetWorkId, targetDB, cache) {
		const ctx = await this.getWorkContext(targetWorkId);
		if (ctx?.globalMeta?.CreationWorks?.[targetWorkId]?.Works_Hidden === true) return true;

		const cacheKey = `workMeta|${targetWorkId}`;
		let workMetaPromise = cache?.get(cacheKey);
		if (!workMetaPromise) {
			workMetaPromise = Promise.resolve()
				.then(() => this.dataFetcher?.fetchJSON?.(`/data/${resolveWorkDirName(targetWorkId)}/DataBases/db_meta.json`))
				.catch(() => null);
			if (cache) cache.set(cacheKey, workMetaPromise);
		}
		const workMeta = await workMetaPromise;
		const dbEntry = findDbEntryInWorkMeta(workMeta, targetDB);
		return dbEntry?.DB_Hidden === true;
	}

	/**
	 * `_DBCrossLinkPath` の単一エントリを解決し、対象レコードの画像値から絶対URLを構築する。
	 * `_DBLink`（resolveDbLinkSuffixRef）とは異なり対象レコードの検索を行わない、
	 * パス参照専用の軽量な解決。安全策として、targetField がターゲットWorkの schema で
	 * 画像型として宣言されていること（indices.imagePathHints に一致エントリがあること）を
	 * 要求し、未宣言なら解決しない。
	 * @param {Object} entry - `_DBCrossLinkPath` の中身
	 * @param {string} defaultWorkId - `_Work` 省略時の既定Work
	 * @param {string} defaultDB - （現状未使用。将来の既定DB拡張用に保持）
	 * @param {string} defaultField - `_Field` 省略時の既定フィールド名（wrapperが出現したフィールド名）
	 * @param {Map} cache - isCrossLinkTargetHidden 用のキャッシュ
	 * @param {ImageProcessor} imageProcessor - dbName → 画像ディレクトリ名マッピング用に再利用
	 * @returns {Promise<{url:string}|null>}
	 */
	async resolveDbCrossLinkPathEntry(entry, defaultWorkId, defaultDB, defaultField, cache, imageProcessor) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

		const targetDB = typeof entry._DB === 'string' ? entry._DB.trim() : '';
		if (!targetDB) return null;
		const isoPath = typeof entry._IsoPath === 'string' ? entry._IsoPath.trim() : '';
		if (!isoPath) return null;

		const targetWorkRaw = typeof entry._Work === 'string' ? entry._Work.trim() : '';
		const targetWorkId = targetWorkRaw ? this.toWorkKeyFromWorksTitle(targetWorkRaw) : defaultWorkId;
		const targetField = (typeof entry._Field === 'string' && entry._Field.trim()) ? entry._Field.trim() : defaultField;
		if (!targetWorkId || !targetField) return null;

		const hidden = await this.isCrossLinkTargetHidden(targetWorkId, targetDB, cache);
		if (hidden) return null;

		const targetCtx = await this.getWorkContext(targetWorkId);
		const hint = (targetCtx?.indices?.imagePathHints || []).find(h => h.key === targetField);
		if (!hint) return null;

		const workPath = resolveWorkDirName(targetWorkId);
		const dbPath = imageProcessor.mapDbNameToImageDir(targetDB);
		const url = buildCrossLinkImageAbsolutePath(workPath, dbPath, hint.folderHint, isoPath);
		return { url: this.config?.withRepoBase ? this.config.withRepoBase(url) : url };
	}

	/**
	 * レコードの `Images.*` を走査し、`_DBCrossLinkPath` wrapper エントリだけを
	 * `_enrichment.images` 追加分として解決する。`Images.*` 自体は書き換えない
	 * （ImageProcessor と同じ非破壊方針）。
	 * @param {Object} record @param {string} workId @param {string} dbName
	 * @param {Map} cache @param {ImageProcessor} imageProcessor
	 * @returns {Promise<Array<{url:string,type:string,field:string,path:string,original:Object}>>}
	 */
	async resolveDbCrossLinkPathImages(record, workId, dbName, cache, imageProcessor) {
		const isWrapper = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
			&& v._DBCrossLinkPath && typeof v._DBCrossLinkPath === 'object' && !Array.isArray(v._DBCrossLinkPath);
		const out = [];
		const imagesContainer = (record && typeof record === 'object')
			? (record.Images || record.images || record.Image || null)
			: null;
		if (!imagesContainer || typeof imagesContainer !== 'object') return out;

		for (const [key, value] of Object.entries(imagesContainer)) {
			const values = Array.isArray(value) ? value : [value];
			for (let i = 0; i < values.length; i++) {
				const v = values[i];
				if (!isWrapper(v)) continue;
				const resolved = await this.resolveDbCrossLinkPathEntry(v._DBCrossLinkPath, workId, dbName, key, cache, imageProcessor);
				if (!resolved) continue;
				out.push({
					url: resolved.url,
					type: imageProcessor.getImageFieldType(key),
					field: key,
					path: Array.isArray(value) ? `Images.${key}[${i}]` : `Images.${key}`,
					original: v
				});
			}
		}
		return out;
	}

	/**
	 * `_DBLink` の参照先レコードから、同名フィールドをレコードへマージ（空値のみ埋める）
	 * @param {Object} base - ベースレコード
	 * @param {Object} linked - 参照先レコード
	 * @returns {Object} マージ後レコード
	 */
	mergeFromLinkedRecord(base, linked) {
		if (!base || typeof base !== 'object') return base;
		if (!linked || typeof linked !== 'object') return base;

		const opt = arguments.length >= 3 && arguments[2] && typeof arguments[2] === 'object' ? arguments[2] : {};
		const allowImages = opt.allowImages !== false;
		const indices = opt.indices && typeof opt.indices === 'object' ? opt.indices : null;
		const declaredKeys = opt.declaredKeys instanceof Set ? opt.declaredKeys : null;
		const respectExplicitOwnProps = opt.respectExplicitOwnProps === true;
		const fieldEntriesByKey = opt.fieldEntriesByKey instanceof Map ? opt.fieldEntriesByKey : null;
		const isSecondaryContext = typeof opt.isSecondaryContext === 'boolean' ? opt.isSecondaryContext : null;
		// 現在作品の $DetailLayout.subFields — 指定があれば subFields に含まれるキーのみマージ
		const subFieldKeys = opt.subFieldKeys instanceof Set ? opt.subFieldKeys : null;
		// $alt フィールドが base に既存値を持つ場合のスキップ判定に使用
		const altFallbackMap = indices?.altFallbackMap instanceof Map ? indices.altFallbackMap : null;
		const explicitPrimaryKeys = respectExplicitOwnProps
			? new Set(Object.keys(base).filter(k => Object.prototype.hasOwnProperty.call(base, k)))
			: null;
		const altKeysBlockedByExplicitPrimary = (() => {
			if (!respectExplicitOwnProps || !(altFallbackMap instanceof Map) || !(explicitPrimaryKeys instanceof Set)) return null;
			const blocked = new Set();
			for (const [primaryKey, altKeys] of altFallbackMap.entries()) {
				if (!explicitPrimaryKeys.has(primaryKey)) continue;
				if (!Array.isArray(altKeys)) continue;
				for (const altKey of altKeys) {
					if (typeof altKey === 'string' && altKey.trim()) blocked.add(altKey);
				}
			}
			return blocked;
		})();

		const isImageLikeKey = (k) => {
			const key = String(k || '');
			if (indices?.imageFields && typeof indices.imageFields.has === 'function' && indices.imageFields.has(key)) return true;
			// typedef が不足していても安全側に倒す（既存の Image 判定ロジックと同系統）
			if (/PNG/i.test(key) || key.includes('Image')) return true;
			return false;
		};

		const out = { ...base };

		const isEmpty = (v) => {
			if (v === null || v === undefined || v === '') return true;
			if (Array.isArray(v) && v.length === 0) return true;
			return false;
		};

		const isJumpWrapper = (v) => {
			return !!v && typeof v === 'object' && !Array.isArray(v) && !!v._Jump;
		};

		for (const [k, v] of Object.entries(linked)) {
			// プライベート系はマージしない（循環/ノイズ防止）
			if (String(k).startsWith('_')) continue;
			if (k === '_enrichment') continue;

			// cross-work マージ時は、現在DB文脈に合わない isForSecondary フィールドを持ち込まない
			const fieldEntry = fieldEntriesByKey?.get(k);
			if (!TypeDefUtils.isFieldForSecondaryContext(fieldEntry, isSecondaryContext)) continue;

			// 別作品からの参照では、対象作品の schema に無いトップレベル項目を持ち込まない。
			// これにより、参照元作品で未宣言のフィールドが cross-work merge で増殖するのを防ぐ。
			if (declaredKeys && !declaredKeys.has(k)) continue;

			// db_meta.json の $DetailLayout.subFields が指定されている場合、subFields に含まれるキーのみマージ
			if (subFieldKeys && !subFieldKeys.has(k)) continue;

			// 画像は別DB（別JSON）からは参照しない
			if (!allowImages && isImageLikeKey(k)) continue;

			// 別作品からの参照で、現在レコードがそのキーを明示的に持つ場合は空値でも現DBを優先する
			if (respectExplicitOwnProps && Object.prototype.hasOwnProperty.call(base, k)) continue;
			// $alt の代替キーも、primary 側を明示しているなら cross-work から持ち込まない
			if (altKeysBlockedByExplicitPrimary?.has(k)) continue;

			const cur = out[k];
			if (typeof cur === 'undefined' || isEmpty(cur) || isJumpWrapper(cur)) {
				// hideText は意図的なマスクとして尊重（上書きしない）
				if (cur && typeof cur === 'object' && !Array.isArray(cur) && typeof cur.hideText === 'string') {
					continue;
				}
				// $alt フィールドに既に値がある場合は、参照先の primary フィールドをマージしない。
				// 例: base に ConceptAge: { hideText: "不定" } がある場合、linked の Age はスキップ。
				if (altFallbackMap && altFallbackMap.has(k)) {
					const altKeys = altFallbackMap.get(k);
					if (Array.isArray(altKeys) && altKeys.some(altK => typeof altK === 'string' && !isEmpty(out[altK]))) {
						continue;
					}
				}
				out[k] = v;
			}
		}

		return out;
	}

	/**
	 * `{ _Jump: { hashTag, _Search } }` を参照先レコードから解決して値に置換
	 * - hashTag は参照先レコードのフィールド名（ドットパスも可）
	 * - hashTag が `_JP` / `_EN` を持たない場合は言語別名へ展開して探す
	 *   （`TypeDefUtils.expandLangAliasCandidates()`）。参照元フィールドの suffix を優先言語にするため、
	 *   `LogicspecAbout_JP: { _Jump: { hashTag: 'NumerospecStats.NumerospecAbout' } }` は
	 *   参照先の `NumerospecStats.NumerospecAbout_JP` を引く
	 * - 完全一致が最優先なので、既存のドットパス参照・完全一致参照の挙動は変わらない
	 * - _Search がある場合、値（配列/オブジェクト）に対して AND 条件でフィルタする
	 * @param {any} node - 走査対象
	 * @param {Object} linked - 参照先レコード
	 * @param {{hostKey?: string}} [options] - hostKey: 参照元フィールド名（優先言語の判定に使う）
	 * @returns {any} 置換後ノード
	 */
	resolveJumpsInAny(node, linked, options = {}) {
		const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

		const getByPath = (obj, path) => {
			if (!obj || !path) return undefined;
			const getter = (typeof DataUtils !== 'undefined' && DataUtils.getByPath) ? DataUtils.getByPath : null;
			if (typeof getter === 'function') return getter(obj, path);
			return String(path).split('.').reduce((cur, part) => (cur && typeof cur === 'object' ? cur[part] : undefined), obj);
		};

		const matchQueries = (obj, queries) => {
			if (!isObj(obj)) return false;
			if (!Array.isArray(queries) || queries.length === 0) return true;
			return queries.every(q => {
				const hashTag = q?.hashTag;
				const key = q?.key;
				if (typeof hashTag !== 'string') return false;
				const val = getByPath(obj, hashTag);
				if (val == null) return false;
				// 既存 searchRecords と同等の柔軟性は不要なので、ここは最低限にする
				if (typeof val === 'object' && !Array.isArray(val) && Object.prototype.hasOwnProperty.call(val, 'value')) {
					return String(val.value) === String(key);
				}
				if (Array.isArray(val)) {
					return val.some(it => String(it) === String(key));
				}
				return String(val) === String(key);
			});
		};

		const resolveJumpWrapper = (wrapper, hostKey) => {
			if (!isObj(wrapper) || !isObj(wrapper._Jump) || !linked) return wrapper;
			const jump = wrapper._Jump;
			// 自前の `_DBLink`（$Def_DBLinkRef 形式）を持つ _Jump は resolveJumpsWithDbLinkRefs() 側で
			// 解決する契約のため、ルート _DBLink 由来のこのパスでは置換しない（誤った参照先での解決を防止）
			if (isObj(jump._DBLink)) return wrapper;
			const hashTag = typeof jump.hashTag === 'string' ? jump.hashTag.trim() : '';
			if (!hashTag) return wrapper;

			// 完全一致 → 言語別名の順で探す（先頭候補は hashTag そのもの＝従来挙動）
			const preferLang = TypeDefUtils.parseLangSuffix(hostKey)?.lang ?? null;
			let raw;
			let found = false;
			for (const candidate of TypeDefUtils.expandLangAliasCandidates(hashTag, preferLang)) {
				const v = getByPath(linked, candidate);
				if (typeof v === 'undefined') continue;
				raw = v;
				found = true;
				break;
			}
			if (!found) return wrapper;

			const q = Array.isArray(jump._Search) ? jump._Search : [];
			if (Array.isArray(raw)) {
				if (!q.length) return raw;
				const filtered = raw.filter(it => matchQueries(it, q));
				// 複数一致/曖昧一致はスキップ（置換しない）
				if (filtered.length === 1) return filtered[0];
				return wrapper;
			}

			if (isObj(raw)) {
				if (!q.length) return raw;
				return matchQueries(raw, q) ? raw : wrapper;
			}

			// プリミティブ
			return raw;
		};

		// hostKey は「その値が入るフィールド名」。配列要素は親フィールド名を引き継ぐ
		const walk = (v, hostKey) => {
			if (v == null) return v;
			if (Array.isArray(v)) return v.map((it) => walk(it, hostKey));
			if (!isObj(v)) return v;

			// _Jump ラッパーはここで置換
			if (Object.prototype.hasOwnProperty.call(v, '_Jump')) {
				const resolved = resolveJumpWrapper(v, hostKey);
				// 解決できた場合はその値に置換（解決失敗は元を返す）
				if (resolved !== v) return walk(resolved, hostKey);
			}

			const out = {};
			for (const [k, vv] of Object.entries(v)) {
				out[k] = walk(vv, k);
			}
			return out;
		};

		return walk(node, typeof options?.hostKey === 'string' ? options.hostKey : '');
	}

	/**
	 * 自前の `_DBLink`（$Def_DBLinkRef 形式）を持つ `_Jump` ラッパーを解決して値に置換
	 * - 形式: `{ _Jump: { hashTag, _DBLink: { _Work, _DB, <IndexKey>: <IndexValue> }, _Search? } }`
	 * - ルート `_DBLink`（旧形式・マージ用）が無いレコードでも、フィールド単位で参照先を明示できる
	 * - 参照先レコードの特定は `resolveDbLinkSuffixRef()`（$Def_DBLinkRef 解決）を再利用する
	 * - 解決失敗（リンク先が見つからない・値が取れない）時は元のラッパーを維持する
	 * @param {any} node - 走査対象（レコード全体）
	 * @param {string} workId - 現在の作品ID（`_Work` 未指定時のデフォルト）
	 * @param {string} defaultDB - 現在の DB 名（`_DB` 未指定時のデフォルト）
	 * @param {Map} cache - `_DBLink` 解決 Promise キャッシュ（enrichRecords が管理）
	 * @returns {Promise<any>} 置換後ノード
	 */
	async resolveJumpsWithDbLinkRefs(node, workId, defaultDB, cache) {
		const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

		// hostKey は「その値が入るフィールド名」。resolveJumpsInAny() の優先言語判定へ渡す
		const walk = async (v, hostKey) => {
			if (v == null) return v;
			if (Array.isArray(v)) return Promise.all(v.map((it) => walk(it, hostKey)));
			if (!isObj(v)) return v;

			const jump = v._Jump;
			if (isObj(jump) && isObj(jump._DBLink)) {
				const linked = await this.resolveDbLinkSuffixRef(jump._DBLink, workId, defaultDB, cache);
				if (linked) {
					// _DBLink を除いた通常の _Jump として、既存の解決ロジック（1件一致のみ採用）を再利用する
					const sanitized = {
						_Jump: {
							hashTag: jump.hashTag,
							...(Array.isArray(jump._Search) ? { _Search: jump._Search } : {})
						}
					};
					const resolved = this.resolveJumpsInAny(sanitized, linked, { hostKey });
					// 置換に成功した場合のみ採用（_Jump が残っていれば解決失敗として元を維持）
					if (!(isObj(resolved) && resolved._Jump)) return resolved;
				}
				return v;
			}

			const out = {};
			for (const [k, vv] of Object.entries(v)) {
				out[k] = await walk(vv, k);
			}
			return out;
		};

		return walk(node, '');
	}

	/**
	 * 型定義から情報を抽出
	 * @param {Object} typeDef - 型定義
	 * @param {Object} indices - インデックスオブジェクト
	 * @param {Array<Object>} [typeSources] - `$Def_*` 名前付き参照解決用の typeSources（CharacterValueWrapperRegistry.helpers.resolveTypeDefEntries 互換）
	 */
	extractFromTypeDefinition(typeDef, indices, typeSources = []) {
		const entries = TypeDefUtils.extractDefTypeEntries(typeDef);
		const imageHints = TypeDefUtils.buildImagePathHints(entries, typeSources);
		if (Array.isArray(imageHints) && imageHints.length > 0) {
			indices.imagePathHints = imageHints;
			for (const h of imageHints) {
				indices.imageFields.add(h.path);
			}
		}

		for (const entry of entries) {
			const key = entry?.hashTag;
			if (!key) continue;

			// $alt（フィールドが無い場合の代替参照キー）
			if (indices?.altFallbackMap && typeof indices.altFallbackMap.set === 'function') {
				const altRaw = entry?.$alt;
				const alts = (typeof altRaw === 'string')
					? [altRaw]
					: (Array.isArray(altRaw) ? altRaw.filter(x => typeof x === 'string') : []);
				if (alts.length && !indices.altFallbackMap.has(key)) {
					indices.altFallbackMap.set(key, alts);
				}
			}

			const typeSpec = entry?.$type;
			const label = TypeDefUtils.pickLabel(entry);

			// 表示名
			if (label) {
				indices.displayFields.set(key, label);
			}

			// 表示分類（typedef 駆動）
			const sectionId = TypeDefUtils.pickDisplaySection(entry);
			indices.displaySections.set(key, sectionId);

			// 参照フィールドの検出（typedef だけでは分かりにくいが、キー規則と型で最低限拾う）
			if (String(key).startsWith('#')) {
				indices.refFields.add(key);
			}

			// 検索可能フィールド（typedef 駆動）
			// NOTE: 本リポジトリの search は hashTag/key の構造検索が主なので、全文検索用 searchableText は控えめに
			const searchable = entry?.searchable;
			if (searchable === false) {
				// 明示的に除外
			} else {
				// 既定: #String / #Summary / #Enum 系を対象にする
				if (TypeDefUtils.looksSearchableType(typeSpec)) {
					indices.searchableFields.add(key);
				}
			}
		}
	}

	/**
	 * 変数定義から情報を抽出
	 * @param {Object} varDef - 変数定義
	 * @param {Object} indices - インデックスオブジェクト
	 */
	extractFromVarDefinition(varDef, indices) {
		const visit = (node) => {
			if (!node || typeof node !== 'object') return;

			Object.entries(node).forEach(([key, value]) => {
				if (key.includes('image') || key.includes('Image')) {
					indices.imageFields.add(key);
				}

				if (typeof key === 'string' && key.startsWith('#ListLink_') && Array.isArray(value)) {
					const fieldName = key.replace(/^#ListLink_/, '').trim();
					if (fieldName) {
						let byValue = indices.listLinkLookups.get(fieldName);
						if (!(byValue instanceof Map)) {
							byValue = new Map();
							indices.listLinkLookups.set(fieldName, byValue);
						}

						for (const item of value) {
							if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
							const raw = item[fieldName];
							if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue;
							const lookupKey = String(raw).trim();
							if (!lookupKey) continue;
							byValue.set(lookupKey, { ...item });
						}
					}
				}

				if (value && typeof value === 'object') {
					visit(value);
				}
			});
		};

		visit(varDef);
	}

	/**
	 * #ListLink_* 定義から取得できる補助情報（Rank など）を wrapper object へ補完
	 * @param {Object} value
	 * @param {Object|null} indices
	 * @returns {Object}
	 */
	supplementListLinkData(value, indices = null) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
		const lookups = indices?.listLinkLookups instanceof Map ? indices.listLinkLookups : null;
		if (!lookups || lookups.size === 0) return value;

		const isEmpty = (v) => {
			if (v === null || typeof v === 'undefined') return true;
			if (v === '') return true;
			if (Array.isArray(v)) return v.length === 0;
			if (typeof v === 'object') return Object.keys(v).length === 0;
			return false;
		};

		let out = value;

		for (const [fieldName, byValue] of lookups.entries()) {
			if (!Object.prototype.hasOwnProperty.call(value, fieldName)) continue;
			const raw = value[fieldName];
			if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue;

			const lookupKey = String(raw).trim();
			if (!lookupKey) continue;

			const matched = byValue.get(lookupKey);
			if (!matched || typeof matched !== 'object') continue;

			if (out === value) out = { ...value };
			for (const [k, v] of Object.entries(matched)) {
				if (String(k).startsWith('_')) continue;
				if (!Object.prototype.hasOwnProperty.call(out, k) || isEmpty(out[k])) {
					out[k] = v;
				}
			}
		}

		return out;
	}

	/**
	 * $IndexDef の #IndexListKey フィールドを基準に、$VarsDef の #List_* からサブフィールドを補完
	 *
	 * 処理内容:
	 * - $IndexDef.$type[] の中から #IndexListKey（後方互換: #ListIndex）を持つサブフィールドを主キーとして特定
	 * - レコードのインデックスオブジェクト（例: { Lunar: 'Mutsuki' }）からその主キー値を取得
	 * - 辞書リストを次の優先順で解決して一致エントリを検索
	 *   1) mergedVars.$Def_<rootKey>.#List_<keyField>（$Def_* コンテキスト配下の宣言）
	 *   2) mergedVars.#List_<keyField>（Dictionaries/ 由来の実行時合流先。compatListKey のルート合流）
	 *   3) mergedVars.#Dict_<keyField>（compatListKey 未宣言の辞書カタログ）
	 * - 主キー値が null の場合も、辞書側に null キー行（例: { ModelSeries: null, ... }）が
	 *   宣言されていれば一致として扱う（null をキーとして許容）
	 * - $IndexDef で宣言されたサブフィールド、および主キーフィールドの言語バリアント（_JP / _EN）を
	 *   空値の場合のみ埋める（既存値は維持）
	 *
	 * @param {Object} record - レコード
	 * @param {Object|null} indexDef - $IndexDef オブジェクト（エイリアスIndexの場合は hashTag がエイリアスfield名）
	 * @param {Object} mergedVars - マージ済み VarsDef
	 * @returns {Object} 補完済みレコード
	 */
	supplementIndexFieldFromVarsDef(record, indexDef, mergedVars) {
		if (!record || typeof record !== 'object') return record;

		const info = TypeDefUtils.getIndexDefInfo(indexDef);
		if (!info?.nested || !info.rootKey) return record;

		const rootKey = info.rootKey;
		const indexValue = record[rootKey];
		// インデックスフィールドが object でない場合はスキップ（スカラー Index は対象外）
		if (!indexValue || typeof indexValue !== 'object' || Array.isArray(indexValue)) return record;

		// #IndexListKey サブフィールドを主キーとして特定（後方互換: #ListIndex も可）
		const keySubDef = info.subDefs.find(d =>
			d?.typeSpec && typeof d.typeSpec === 'string' &&
			(/#IndexListKey/i.test(d.typeSpec) || /#ListIndex/i.test(d.typeSpec))
		);
		if (!keySubDef?.key) return record;

		const keyField = keySubDef.key;
		const keyValue = indexValue[keyField];
		// undefined / 空文字はスキップ。null は「辞書側に null キー行がある場合のみ」解決対象にする
		if (typeof keyValue === 'undefined' || keyValue === '') return record;

		// 辞書リストの解決（$Def_<rootKey> コンテキスト → ルート #List_* → ルート #Dict_* の順）
		const pickList = (v) => (Array.isArray(v) ? v : null);
		const list = pickList(mergedVars?.[`$Def_${rootKey}`]?.[`#List_${keyField}`])
			|| pickList(mergedVars?.[`#List_${keyField}`])
			|| pickList(mergedVars?.[`#Dict_${keyField}`]);
		if (!Array.isArray(list)) return record;

		// 主キー値に一致するリストエントリを検索（null は null キー行のみ、その他は文字列比較）
		const keyValueStr = keyValue === null ? '' : String(keyValue).trim();
		const matched = list.find(item => {
			if (!item || typeof item !== 'object') return false;
			if (!Object.prototype.hasOwnProperty.call(item, keyField)) return false;
			const raw = item[keyField];
			if (keyValue === null) return raw === null;
			return raw != null && String(raw).trim() === keyValueStr;
		});
		if (!matched) return record;

		// 補完対象:
		// 1) $IndexDef で宣言されたサブフィールド（主キーフィールド自体を除く）
		// 2) 主キーフィールドの言語バリアント（<keyField>_JP / <keyField>_EN）
		const declaredSubKeys = new Set(info.subDefs.map(d => d.key).filter(Boolean));
		const langVariants = new Set([`${keyField}_JP`, `${keyField}_EN`]);

		const isEmpty = (v) => v === null || typeof v === 'undefined' || v === '';

		const newIndexValue = { ...indexValue };
		let changed = false;

		for (const [k, v] of Object.entries(matched)) {
			if (k === keyField) continue; // 主キー自体はスキップ
			if (!declaredSubKeys.has(k) && !langVariants.has(k)) continue; // 宣言外はスキップ
			if (Object.prototype.hasOwnProperty.call(newIndexValue, k) && !isEmpty(newIndexValue[k])) continue; // 既存値は維持
			newIndexValue[k] = v;
			changed = true;
		}

		if (!changed) return record;
		return { ...record, [rootKey]: newIndexValue };
	}

	/**
	 * レコード内の #ListLink wrapper を再帰的に正規化し、表示補助情報を補完
	 * @param {any} value
	 * @param {Object|null} indices
	 * @returns {any}
	 */
	normalizeListLinkWrappers(value, indices = null) {
		if (Array.isArray(value)) {
			return value.map(item => this.normalizeListLinkWrappers(item, indices));
		}

		if (!value || typeof value !== 'object') {
			return value;
		}

		const out = { ...this.supplementListLinkData(value, indices) };
		for (const [k, v] of Object.entries(out)) {
			out[k] = this.normalizeListLinkWrappers(v, indices);
		}
		return out;
	}

	/**
	 * レコードの充実化処理（エンリッチメント）
	 * @param {Array} records - レコード配列
	 * @param {string} workId - 作品ID
	 * @param {string} dbName - データベース名
	 * @returns {Promise<Array>} 充実化されたレコード配列
	 */
	async enrichRecords(records, workId, dbName = '') {
		if (!Array.isArray(records) || records.length === 0) {
			return records;
		}

		try {
			// typedef/varsdef を読み込み、enrich 全体の判断を schema 駆動へ寄せる。
			// ここで作った ctx が、検索対象・画像候補・表示セクション・$alt の解釈元になる。
			const ctx = await this.getWorkContext(workId);

			const typeEntries = TypeDefUtils.extractDefTypeEntries(ctx?.defTypeMerged);
			const fieldEntriesByKey = new Map(
				typeEntries
					.filter(e => typeof e?.hashTag === 'string' && e.hashTag.trim())
					.map(e => [e.hashTag.trim(), e])
			);
			const typeByKey = new Map(typeEntries.map(e => [e?.hashTag, e?.$type]));
			const declaredTopLevelKeys = new Set(
				typeEntries
					.map(e => (typeof e?.hashTag === 'string' ? e.hashTag.trim() : ''))
					.filter(Boolean)
			);
			const isSecondaryContext = isSecondaryDbNameForEnrich(dbName);
			const altFallbackMap = (ctx?.indices?.altFallbackMap instanceof Map) ? ctx.indices.altFallbackMap : null;

			// db_meta.json $DetailLayout.subFields — subFields 未登録フィールドの参照解決・マージを制限するために使用
			// ベース名・_JP・_EN の三方向を全て登録し、宣言形式（ベース名 or 言語サフィックス付き）に依存しない照合を可能にする
			const rawSubFields = ctx?.globalMeta?.CreationWorks?.[workId]?.$DetailLayout?.subFields;
			const detailSubFieldSet = (() => {
				if (!Array.isArray(rawSubFields) || rawSubFields.length === 0) return null;
				const s = new Set();
				for (const k of rawSubFields.map(k => String(k).trim()).filter(Boolean)) {
					s.add(k);
					const m = k.match(/^(.+)_(JP|EN)$/);
					if (m) s.add(m[1]);
					else { s.add(`${k}_JP`); s.add(`${k}_EN`); }
				}
				return s;
			})();

			// _DBLink 解決キャッシュ（同一リンクを繰り返し読まない）
			const dbLinkPrimaryCache = new Map();

			// _DBCrossLinkPath 解決キャッシュ（対象Workの db_meta.json 取得結果を使い回す）
			const dbCrossLinkPathCache = new Map();

			// 画像プロセッサーを初期化
			const imageProcessor = new ImageProcessor(this.config);

			// DB固有 $IndexDef（サイドカーキー $IndexDef_<DbNorm>）を解決し、正規化・補完の双方で使い回す
			const resolvedIndexDef = this.resolveIndexDefForDb(ctx, dbName);

			// エイリアスIndex（$DefType 上の #Index 型 field のうち rootKey 以外。例: LogicAlt）を収集し、
			// 正規化（field ごとの IndexDef 解決）と辞書補完の両方で使い回す
			const aliasIndexDefs = TypeDefUtils.collectIndexAliasDefs(typeEntries, resolvedIndexDef, ctx?.workType);
			const indexDefByField = (() => {
				/** @type {Object<string, Object>} */
				const m = {};
				if (resolvedIndexDef?.hashTag) m[resolvedIndexDef.hashTag] = resolvedIndexDef;
				for (const d of aliasIndexDefs) {
					if (d?.hashTag) m[d.hashTag] = d;
				}
				return m;
			})();

			// 各レコードに対してエンリッチメント処理を実行
			const enrichedRecords = await Promise.all(records.map(async (record) => {
				if (!record || typeof record !== 'object') return record;

				// 1) typedef に基づく軽い正規化（#Index 値は field ごとに解決した IndexDef で正規化）
				const normalizedRecord = this.normalizeRecordByTypeDef(record, ctx?.defTypeMerged, { indexDef: resolvedIndexDef, indexDefByField });
				let enrichedRecord = { ...normalizedRecord };

				// 1.5) $IndexDef の #IndexListKey を基準に、$VarsDef の #List_* からサブフィールドを補完
				// - 例: { Chronos: { Lunar: 'Mutsuki' } } → { Chronos: { Lunar: 'Mutsuki', Num: 1, Generation: 2, Lunar_JP: '睦月' } }
				// - エイリアスIndex（例: LogicAlt）も同じ辞書解決を適用する
				if (resolvedIndexDef) {
					enrichedRecord = this.supplementIndexFieldFromVarsDef(enrichedRecord, resolvedIndexDef, ctx.mergedVars);
				}
				for (const aliasDef of aliasIndexDefs) {
					enrichedRecord = this.supplementIndexFieldFromVarsDef(enrichedRecord, aliasDef, ctx.mergedVars);
				}

				// 1.75) 自前の `_DBLink`（$Def_DBLinkRef 形式）を持つ _Jump をフィールド単位で解決
				//       ルート _DBLink（旧形式）が無いレコードでも、参照先を明示した _Jump を置換できる
				enrichedRecord = await this.resolveJumpsWithDbLinkRefs(enrichedRecord, workId, dbName, dbLinkPrimaryCache);

				// 2) _DBLink を解決し、参照先の値をマージ（空値のみ）
				//    さらに _Jump ラッパーを参照先の実値へ置換
				const dbLinks = this.normalizeDbLinkDefs(enrichedRecord._DBLink);
				if (dbLinks.length > 0) {
					// 互換: 先頭のみをマージ対象にする（複数リンクの合成は仕様未確定なため）
					const primaryDef = dbLinks[0];
					const primaryLinked = await this.resolveDbLinkPrimaryRecord(primaryDef, dbLinkPrimaryCache);
					if (primaryLinked) {
						const linkWorkKey = this.toWorkKeyFromWorksTitle(primaryDef?.worksTitle);
						const linkDbName = typeof primaryDef?.dbName === 'string' ? primaryDef.dbName.trim() : '';
						const isCrossWork = linkWorkKey && linkWorkKey !== workId;
						const allowImages = !isCrossWork && (linkDbName === dbName);
						const declaredKeys = (isCrossWork && declaredTopLevelKeys.size > 0) ? declaredTopLevelKeys : null;
						// クロスワーク _DBLink は subFields 登録済みキーのみマージ（基本フィールドの意図せぬ上書きを防止）
						const subFieldKeys = (isCrossWork && detailSubFieldSet) ? detailSubFieldSet : null;

						// _Jump 置換 → 同名フィールドの穴埋めマージ
						enrichedRecord = this.resolveJumpsInAny(enrichedRecord, primaryLinked);
						enrichedRecord = this.mergeFromLinkedRecord(enrichedRecord, primaryLinked, {
							allowImages,
							indices: ctx?.indices || null,
							declaredKeys,
							subFieldKeys
						});
					}
				}

				// 2.1) $enrich: true を持つ *_DBLink suffix フィールドを解決し、_Jump 置換 → 同名フィールドの穴埋めマージ
				//      typedef の $enrich: true でフィールド単位に制御。先頭の解決済みエントリのみ採用。
				// detailSubFieldSet が設定されている場合、subFields 未登録フィールドは $enrich をスキップ
				const enrichDbLinkTypes = typeEntries.filter(
					e => e?.$enrich === true
						&& typeof e?.hashTag === 'string'
						&& e.hashTag.endsWith('_DBLink')
						&& (!detailSubFieldSet || detailSubFieldSet.has(e.hashTag))
				);
				for (const ent of enrichDbLinkTypes) {
					const fieldVal = enrichedRecord[ent.hashTag];
					if (!fieldVal) continue;
					const refs = Array.isArray(fieldVal) ? fieldVal : [fieldVal];
					const defaultTargetDB = ent.$display?.dbLinkTargetDB || dbName;
					for (const ref of refs) {
						const resolved = await this.resolveDbLinkSuffixRef(ref, workId, defaultTargetDB, dbLinkPrimaryCache);
						if (resolved) {
							const refWorkId = typeof ref._Work === 'string'
								? this.toWorkKeyFromWorksTitle(ref._Work.trim()) : workId;
							// ルート _DBLink（2 節）と同様に、参照先が確定したら _Jump ラッパーも同じ参照先で解決する。
							// これにより「$enrich: true の *_DBLink に参照先を書いてあるレコード」は、
							// _Jump 側へ _DBLink を重複して書かなくても同じ相手を引ける。
							// 自前の _DBLink を持つ _Jump は 1.75 節が解決済み（resolveJumpsInAny 側でスキップされる）。
							enrichedRecord = this.resolveJumpsInAny(enrichedRecord, resolved);
							enrichedRecord = this.mergeFromLinkedRecord(enrichedRecord, resolved, {
								allowImages: false,
								indices: ctx?.indices || null,
								declaredKeys: refWorkId !== workId && declaredTopLevelKeys.size > 0 ? declaredTopLevelKeys : null,
								respectExplicitOwnProps: refWorkId !== workId,
								fieldEntriesByKey: refWorkId !== workId ? fieldEntriesByKey : null,
								isSecondaryContext: refWorkId !== workId ? isSecondaryContext : null
							});
							break;
						}
					}
				}

				// 2.5) $alt によるフォールバック穴埋め（primary が空値のときのみ）
				// - 互換目的。型が不一致（例: 単体 vs 配列）の場合は安全のためスキップ。
				if (altFallbackMap) {
					enrichedRecord = this.applyAltFallbacks(enrichedRecord, altFallbackMap, typeByKey);
				}

				// 2.75) #ListLink_* の wrapper object を varsdef から補完し、表示経路を統一
				enrichedRecord = this.normalizeListLinkWrappers(enrichedRecord, ctx?.indices || null);

				// 3) 画像情報を処理
				const imageInfo = imageProcessor.imageFromRecord(enrichedRecord, workId, dbName, ctx?.indices?.imagePathHints);
				// 3.5) `_DBCrossLinkPath` wrapper（画像フィールド専用のDB/Work横断パス参照）を解決し追記
				//      Images.* 自体は書き換えない（ImageProcessor と同じ非破壊方針）
				const crossLinkImages = await this.resolveDbCrossLinkPathImages(enrichedRecord, workId, dbName, dbCrossLinkPathCache, imageProcessor);
				const allImages = crossLinkImages.length > 0 ? [...imageInfo.images, ...crossLinkImages] : imageInfo.images;
				if (allImages.length > 0) {
					enrichedRecord._enrichment = enrichedRecord._enrichment || {};
					enrichedRecord._enrichment.images = allImages;
					// `selectPrimaryImage()` は `{url, type, field, path, original}` を返すので、
					// 消費側（相関図のノードサムネイル等）が期待する URL 文字列へ揃える
					enrichedRecord._enrichment.primaryImage = imageInfo.primaryImage?.url || allImages[0]?.url || null;
					enrichedRecord._enrichment.imageCount = allImages.length;
				}

				// 4) 検索可能フィールドのインデックス化
				// searchableText は API/UI の補助メタであり、公開表示そのものの source of truth ではない。
				enrichedRecord._enrichment = enrichedRecord._enrichment || {};
				enrichedRecord._enrichment.searchableText = this.buildSearchableText(enrichedRecord, ctx?.indices);

				// 5) 表示分類（typedef 駆動）
				// UI はこの displaySections を使って basic/profile/spec/images/other の土台を組める。
				const displaySections = this.buildDisplaySections(enrichedRecord, ctx?.defTypeMerged, ctx?.indices);
				if (displaySections) {
					enrichedRecord._enrichment.displaySections = displaySections;
				}
				const wrapperSummaries = this.buildWrapperSummaries(enrichedRecord, ctx);
				if (wrapperSummaries && Object.keys(wrapperSummaries).length > 0) {
					enrichedRecord._enrichment.wrapperSummaries = wrapperSummaries;
				}

				// 辞書行からの参照解決（typedef の `$dictRef` 宣言駆動）
				// - 例: Belonging[].Faction → #Dict_Faction の FactionsBaseArea
				const dictRefs = this.buildDictRefResolutions(enrichedRecord, ctx);
				if (dictRefs && Object.keys(dictRefs).length > 0) {
					enrichedRecord._enrichment.dictRefs = dictRefs;
				}

				// 6) bilingual wrapper フィールドのメタ情報（UI の表示制御用）
				// - $type が _JP/_EN ペア配列のフィールドについて、有効ベース型・langMode・主従キーを出力する
				// - ネスト済みフィールドも含む（例: StreamingActivity.StreamingGreeting）
				const defEntries = TypeDefUtils.extractDefTypeEntries(ctx?.defTypeMerged);
				const bwPaths = TypeDefUtils.collectBilingualWrapperPaths(defEntries);
				if (bwPaths.length > 0) {
					enrichedRecord._enrichment.bilingualWrapperFields = bwPaths.map(
						({ path, langMode, primaryChildKey, altChildKey, effectiveBaseType }) =>
						({ path, langMode, primaryChildKey, altChildKey, effectiveBaseType })
					);
				}

				enrichedRecord._enrichment.schemaDriven = true;
				enrichedRecord._enrichment.normalized = true;

				return enrichedRecord;
			}));

			return enrichedRecords;

		} catch (error) {
			console.error('❌ エンリッチメント処理中にエラーが発生:', error);
			return records; // エラー時は元のレコードをそのまま返す
		}
	}

	/**
	 * typedef の `$alt` 宣言に基づき、primary フィールドが空値の場合に alt フィールドから穴埋めする
	 * @param {Object} record
	 * @param {Map<string,string[]>} altFallbackMap
	 * @param {Map<string,any>} typeByKey
	 * @returns {Object}
	 */
	applyAltFallbacks(record, altFallbackMap, typeByKey) {
		if (!record || typeof record !== 'object') return record;
		if (!(altFallbackMap instanceof Map)) return record;

		const isEmpty = (v) => {
			if (v === null || typeof v === 'undefined') return true;
			if (v === '') return true;
			if (Array.isArray(v)) return v.length === 0;
			if (typeof v === 'object') {
				// { hideText } は意図的マスクなので空扱いしない
				if (typeof v.hideText === 'string' && v.hideText) return false;
				return Object.keys(v).length === 0;
			}
			return false;
		};

		const isArrayish = (typeSpec) => TypeDefUtils.isArrayType(typeSpec);

		for (const [primaryKey, alts] of altFallbackMap.entries()) {
			if (!primaryKey || !Array.isArray(alts) || alts.length === 0) continue;
			if (!Object.prototype.hasOwnProperty.call(record, primaryKey) || isEmpty(record[primaryKey])) {
				const primaryType = typeByKey?.get(primaryKey);
				for (const altKey of alts) {
					if (!altKey) continue;
					if (!Object.prototype.hasOwnProperty.call(record, altKey)) continue;
					const altVal = record[altKey];
					if (isEmpty(altVal)) continue;

					// 型が両方分かる場合、配列/非配列の互換が取れないならスキップ
					const altType = typeByKey?.get(altKey);
					if (typeof primaryType !== 'undefined' && typeof altType !== 'undefined') {
						if (isArrayish(primaryType) !== isArrayish(altType)) {
							continue;
						}
					}

					record[primaryKey] = altVal;

					// UI 側で「代替元キーのラベルを優先表示」できるように provenance を残す
					record._enrichment = record._enrichment || {};
					record._enrichment.altFallbacks = record._enrichment.altFallbacks || {};
					if (!record._enrichment.altFallbacks[primaryKey]) {
						record._enrichment.altFallbacks[primaryKey] = altKey;
					}
					break;
				}
			}
		}

		return record;
	}

	/**
	 * レコードから検索可能なテキストを構築
	 * @param {Object} record - レコードオブジェクト
	 * @param {Object|null} indices - enrichment indices（typedef 駆動の対象フィールド制御に使用）
	 * @returns {string} 検索可能テキスト
	 */
	buildSearchableText(record, indices = null) {
		const searchableValues = [];
		const allowedTopLevel = indices?.searchableFields instanceof Set ? indices.searchableFields : null;

		const extractText = (obj, path = '') => {
			if (!obj || typeof obj !== 'object') return;

			Object.entries(obj).forEach(([key, value]) => {
				// プライベートフィールドはスキップ
				if (key.startsWith('_')) return;

				// typedef 駆動: トップレベルで対象外なら走査しない
				if (!path && allowedTopLevel && !allowedTopLevel.has(key)) return;

				if (typeof value === 'string' && value.trim()) {
					searchableValues.push(value.trim());
				} else if (typeof value === 'number') {
					searchableValues.push(value.toString());
				} else if (typeof value === 'object' && !Array.isArray(value)) {
					extractText(value, path ? `${path}.${key}` : key);
				} else if (Array.isArray(value)) {
					value.forEach(item => {
						if (typeof item === 'string' && item.trim()) {
							searchableValues.push(item.trim());
						} else if (typeof item === 'object') {
							extractText(item, path ? `${path}.${key}` : key);
						}
					});
				}
			});
		};

		extractText(record);
		return searchableValues.join(' ').toLowerCase();
	}

	/**
	 * typedef($DefType) を元に、レコードのトップレベル値を軽く正規化
	 * - 既存のデータ構造を壊さない（オブジェクト/配列は原則そのまま）
	 * - 文字列/数値/配列の最低限の揺れを吸収
	 * - 第3引数 opt: { indexDef, indexDefByField } を受け取り、#Index 型 field は
	 *   indexDefByField[field名]（エイリアスIndex含む）→ indexDef の順で解決した定義で正規化する
	 * @param {Object} record - 元レコード
	 * @param {Array|Object} defTypeMerged - マージ済み $DefType
	 * @returns {Object} 正規化済みレコード
	 */
	normalizeRecordByTypeDef(record, defTypeMerged) {
		if (!record || typeof record !== 'object') return record;
		const opt = arguments.length >= 3 && arguments[2] && typeof arguments[2] === 'object' ? arguments[2] : {};
		const defaultIndexDef = opt?.indexDef && typeof opt.indexDef === 'object' ? opt.indexDef : null;
		const indexDefByField = (opt?.indexDefByField && typeof opt.indexDefByField === 'object') ? opt.indexDefByField : null;
		const out = { ...record };
		const entries = TypeDefUtils.extractDefTypeEntries(defTypeMerged);
		if (!Array.isArray(entries) || entries.length === 0) return out;

		const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

		const normalizeNested = (value, typeSpec, indexDef) => {
			const normalized = TypeDefUtils.normalizeValueByTypeSpec(value, typeSpec, { indexDef });
			if (normalized == null) return normalized;

			if (Array.isArray(typeSpec)) {
				if (Array.isArray(normalized)) {
					return normalized.map((item) => {
						if (!isPlainObject(item)) return item;
						const obj = { ...item };
						for (const child of typeSpec) {
							const childKey = child?.hashTag;
							if (!childKey || typeof childKey !== 'string') continue;
							if (typeof obj[childKey] === 'undefined') continue;
							obj[childKey] = normalizeNested(obj[childKey], child?.$type, indexDef);
						}
						return obj;
					});
				}

				if (isPlainObject(normalized)) {
					const obj = { ...normalized };
					for (const child of typeSpec) {
						const childKey = child?.hashTag;
						if (!childKey || typeof childKey !== 'string') continue;
						if (typeof obj[childKey] === 'undefined') continue;
						obj[childKey] = normalizeNested(obj[childKey], child?.$type, indexDef);
					}
					return obj;
				}
			}

			if (isPlainObject(typeSpec) && Object.prototype.hasOwnProperty.call(typeSpec, '$type')) {
				return normalizeNested(normalized, typeSpec.$type, indexDef);
			}

			return normalized;
		};

		for (const entry of entries) {
			const key = entry?.hashTag;
			if (!key || typeof out[key] === 'undefined') continue;

			const typeSpec = entry?.$type;
			// #Index 型は field ごとの IndexDef（エイリアス含む）で正規化する
			const fieldIndexDef = (indexDefByField && indexDefByField[key] && typeof indexDefByField[key] === 'object')
				? indexDefByField[key]
				: defaultIndexDef;
			out[key] = normalizeNested(out[key], typeSpec, fieldIndexDef);
		}
		return out;
	}

	/**
	 * 表示分類（typedef 駆動）を、レコードに対してセクション配列として生成
	 * @param {Object} record - レコード
	 * @param {Array|Object} defTypeMerged - $DefType
	 * @param {Object|null} indices - enrichment indices
	 * @returns {Object|null} { basic:[], profile:[], spec:[], images:[], other:[] }
	 */
	buildDisplaySections(record, defTypeMerged, indices = null) {
		if (!record || typeof record !== 'object') return null;
		const entries = TypeDefUtils.extractDefTypeEntries(defTypeMerged);
		if (!Array.isArray(entries) || entries.length === 0) return null;

		const sectionOrder = ['basic', 'profile', 'spec', 'images', 'other'];
		const sections = Object.fromEntries(sectionOrder.map(k => [k, []]));
		const byKey = indices?.displaySections instanceof Map ? indices.displaySections : null;

		// typedef 順で、レコードに存在するキーを分類
		for (const entry of entries) {
			const key = entry?.hashTag;
			if (!key) continue;
			if (key.startsWith('_')) continue;
			if (typeof record[key] === 'undefined') continue;

			const sectionId = byKey ? (byKey.get(key) || 'other') : TypeDefUtils.pickDisplaySection(entry);
			if (!sections[sectionId]) sections.other.push(key);
			else sections[sectionId].push(key);
		}

		// typedef 外のキーは other へ送る。
		// ただし UI 側では「typedef / meta で公開対象と判断した項目だけを見せる」運用を優先する。
		for (const k of Object.keys(record)) {
			if (k.startsWith('_')) continue;
			if (k === '_enrichment') continue;
			const isInSchema = entries.some(e => e?.hashTag === k);
			if (!isInSchema) sections.other.push(k);
		}

		return sections;
	}

	/**
	 * wrapper registry で整形できる top-level field の summary を集約
	 * @param {Object} record - レコード
	 * @param {Object|null} ctx - work context
	 * @returns {Object|null} { fieldKey: summary }
	 */
	buildWrapperSummaries(record, ctx = null) {
		if (!record || typeof record !== 'object') return null;
		const registry = getCharacterValueWrapperRegistry();
		if (!registry || typeof registry.formatWithRegisteredWrapper !== 'function') return null;

		const entries = TypeDefUtils.extractDefTypeEntries(ctx?.defTypeMerged);
		if (!Array.isArray(entries) || entries.length === 0) return null;

		const mergedVarsSource = (ctx?.mergedVars && typeof ctx.mergedVars === 'object')
			? {
				// wrapper-common の resolveTypeDefContainer が参照する双方の入口を満たす
				// （source.$VarsDef / source.General.$VarsDef）
				$VarsDef: ctx.mergedVars,
				General: { $VarsDef: ctx.mergedVars }
			}
			: null;
		const typeSources = [ctx?.globalType, ctx?.workType, ctx?.globalMeta, mergedVarsSource]
			.filter((source, index, list) => source && list.indexOf(source) === index);
		const summaries = {};

		for (const entry of entries) {
			const key = entry?.hashTag;
			if (!key || key.startsWith('_')) continue;
			if (typeof record[key] === 'undefined') continue;

			const summary = registry.formatWithRegisteredWrapper(record[key], {
				schemaType: entry?.$type,
				defName: TypeDefUtils.firstDefToken(entry?.$type),
				fieldKey: key,
				typeSources
			});
			if (typeof summary === 'string' && summary.trim()) {
				summaries[key] = summary.trim();
			}
		}

		return summaries;
	}

	/**
	 * typedef の `$dictRef` 宣言に従い、辞書行から参照解決した値を集約する
	 * @description
	 *   `$Def_*` コンテナの子要素が `$dictRef: { from, field }` を宣言している場合、
	 *   `from` で指した兄弟要素（辞書コード）から辞書行を引き、`field` の値をその子要素として補う。
	 *   レコード自身が実値を持つ場合は上書きしない（`_DBLink` の穴埋めと同じ方針）。
	 *
	 *   例: `Belonging: [{ Faction: '百花繚乱研究所' }]`
	 *   → `{ Belonging: [{ Faction: '百花繚乱研究所', FactionsBaseArea: { Area: '九蓮国' } }] }`
	 *
	 *   結果はレコード本体ではなく `_enrichment.dictRefs` へ載せる（公開データの形は変えない）。
	 * @param {Object} record - レコード
	 * @param {Object|null} ctx - work context
	 * @returns {Object|null} { fieldKey: 解決済み値 }
	 */
	buildDictRefResolutions(record, ctx = null) {
		if (!record || typeof record !== 'object') return null;
		const entries = TypeDefUtils.extractDefTypeEntries(ctx?.defTypeMerged);
		if (!Array.isArray(entries) || entries.length === 0) return null;
		const mergedVars = (ctx?.mergedVars && typeof ctx.mergedVars === 'object') ? ctx.mergedVars : null;
		if (!mergedVars) return null;

		const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
		const isEmptyValue = (v) => v === undefined || v === null || v === '';
		const out = {};

		for (const entry of entries) {
			const key = entry?.hashTag;
			if (!key || key.startsWith('_')) continue;
			const value = record[key];
			if (isEmptyValue(value)) continue;

			const defName = TypeDefUtils.firstDefToken(entry?.$type).replace(/\[\]$/, '');
			if (!defName) continue;
			const container = mergedVars[defName];
			if (!isPlainObject(container)) continue;

			const childEntries = Array.isArray(container.$DefType) ? container.$DefType : [];
			const refEntries = childEntries.filter((child) => isPlainObject(child?.$dictRef));
			if (!refEntries.length) continue;

			const shorthandKey = String(container.$shorthand || '').trim();

			/** 1 要素を「元の形 + 参照解決した子要素」へ正規化する（解決できなければ null） */
			const normalizeItem = (item) => {
				if (isPlainObject(item)) return { ...item };
				if (shorthandKey && !isEmptyValue(item) && typeof item !== 'object') return { [shorthandKey]: item };
				return null;
			};

			const resolveItem = (item) => {
				const base = normalizeItem(item);
				if (!base) return { base: null, resolved: false };

				let resolved = false;
				for (const child of refEntries) {
					const childKey = String(child.hashTag || '').trim();
					if (!childKey) continue;
					// レコード側に実値がある場合は尊重する（辞書側で上書きしない）
					if (!isEmptyValue(base[childKey])) continue;

					const ref = child.$dictRef;
					const fromKey = String(ref.from || '').trim();
					if (!fromKey) continue;
					const fromEntry = childEntries.find((c) => c?.hashTag === fromKey);
					const dictName = String(fromEntry?.$dict || fromKey).trim();
					const row = TypeDefUtils.findDictRow(mergedVars, dictName, base[fromKey]);
					if (!row) continue;

					const refValue = row[String(ref.field || childKey).trim()];
					if (isEmptyValue(refValue)) continue;
					base[childKey] = refValue;
					resolved = true;
				}
				return { base, resolved };
			};

			if (Array.isArray(value)) {
				const items = value.map(resolveItem);
				if (!items.some((r) => r.resolved)) continue;
				// index 対応を崩さないよう、解決できなかった要素も正規化した形のまま残す
				out[key] = items.map((r, i) => r.base ?? value[i]);
			} else {
				const { base, resolved } = resolveItem(value);
				if (resolved && base) out[key] = base;
			}
		}

		return Object.keys(out).length ? out : null;
	}

	/**
	 * typedef 駆動の検索（優先度4: 既存の構造検索を壊さず、型に応じた比較を行う）
	 * @param {Array} records - レコード配列
	 * @param {string} workId - 作品ID
	 * @param {string} dbName - DB名
	 * @param {Array<{hashTag: string, key: string}>} queries - クエリ配列
	 * @returns {Promise<Array>} マッチしたレコード配列
	 */
	async searchRecords(records, workId, dbName, queries) {
		const publicRecords = filterPublicRecords(records);
		if (!Array.isArray(publicRecords) || publicRecords.length === 0) return [];
		if (!Array.isArray(queries) || queries.length === 0) return [];

		const ctx = await this.getWorkContext(workId);
		const entries = TypeDefUtils.extractDefTypeEntries(ctx?.defTypeMerged);
		const typeByKey = new Map(entries.map(e => [e?.hashTag, e?.$type]));

		// work の $IndexDef（typedef）を、#Index の解釈に利用
		const resolvedIndexDefForSearch = this.resolveIndexDefForDb(ctx, dbName);
		const indexDef = resolvedIndexDefForSearch && typeof resolvedIndexDefForSearch === 'object' ? resolvedIndexDefForSearch : null;
		const indexInfo = TypeDefUtils.getIndexDefInfo(indexDef);

		// dot-path も含めて「型が分かるキー」を拡張（Index の子要素も型推定に利用）
		const typeByPath = new Map(typeByKey);
		if (indexInfo?.rootKey) {
			if (indexInfo.nested && Array.isArray(indexInfo.subDefs)) {
				for (const sub of indexInfo.subDefs) {
					if (!sub?.key) continue;
					typeByPath.set(`${indexInfo.rootKey}.${sub.key}`, sub.typeSpec ?? null);
				}
			}
			// root 自体にも type を付与（比較時のヒント）
			if (!typeByPath.has(indexInfo.rootKey)) {
				typeByPath.set(indexInfo.rootKey, indexDef?.$type ?? indexDef?.$valType ?? null);
			}
		}

		// エイリアスIndex（例: LogicAlt）の dot-path にも型ヒントを付与し、
		// `LogicAlt.Num` のような明示クエリでも型正規化（数値比較等）が効くようにする
		for (const aliasDef of TypeDefUtils.collectIndexAliasDefs(entries, indexDef, ctx?.workType)) {
			const aliasInfo = TypeDefUtils.getIndexDefInfo(aliasDef);
			if (!aliasInfo?.rootKey) continue;
			if (aliasInfo.nested && Array.isArray(aliasInfo.subDefs)) {
				for (const sub of aliasInfo.subDefs) {
					if (!sub?.key) continue;
					if (!typeByPath.has(`${aliasInfo.rootKey}.${sub.key}`)) {
						typeByPath.set(`${aliasInfo.rootKey}.${sub.key}`, sub.typeSpec ?? null);
					}
				}
			}
		}

		const expandIndexSearchQueries = (q) => {
			const h = typeof q?.hashTag === 'string' ? q.hashTag.trim() : '';
			if (h !== '#Index') return [q];
			if (!indexInfo?.rootKey) return [q];

			// スカラーIndex
			if (!indexInfo.nested) {
				return [{ hashTag: indexInfo.rootKey, key: q?.key }];
			}

			// ネストIndex: key が object の場合は AND 条件へ展開（例: {Suit:'Major',Num:0}）
			const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
			if (isObj(q?.key)) {
				const rootObj = isObj(q.key?.[indexInfo.rootKey]) ? q.key[indexInfo.rootKey] : q.key;
				const out = [];
				for (const sub of (indexInfo.subDefs || [])) {
					const sk = sub?.key;
					if (!sk) continue;
					if (!Object.prototype.hasOwnProperty.call(rootObj, sk)) continue;
					out.push({ hashTag: `${indexInfo.rootKey}.${sk}`, key: rootObj[sk] });
				}
				if (out.length > 0) return out;
			}

			// フォールバック: 主要サブフィールド（Num等）へ単発検索
			const primarySub = TypeDefUtils.pickPrimaryIndexSubDef(indexInfo.subDefs || []);
			const path = primarySub?.key ? `${indexInfo.rootKey}.${primarySub.key}` : indexInfo.rootKey;
			return [{ hashTag: path, key: q?.key }];
		};

		const expandedQueries = queries.flatMap(expandIndexSearchQueries);

		const normalizeQueryKey = (hashTag, rawKey) => {
			const typeSpec = typeByPath.get(hashTag);
			return TypeDefUtils.normalizeQueryValueByTypeSpec(rawKey, typeSpec);
		};

		const normalizedQueries = expandedQueries.map(q => ({
			hashTag: q.hashTag,
			key: normalizeQueryKey(q.hashTag, q.key)
		}));

		const getByPath = (typeof DataUtils !== 'undefined' && DataUtils.getByPath) ? DataUtils.getByPath : (obj, path) => {
			if (!path) return undefined;
			return String(path).split('.').reduce((cur, part) => (cur && typeof cur === 'object' ? cur[part] : undefined), obj);
		};

		const valueEquals = (val, qKey, typeSpec) => {
			// 明示的に null を検索する場合は、null 同士を一致扱いにする
			// - 例: index サブキーが '#String|#Null' の作品で { LogicSeries: null, Num: 62 } のように検索したい
			if (qKey === null) return val === null;
			if (val == null) return false;

			const equalsPrimitive = (a, b) => {
				if (a == null) return false;
				// b がオブジェクト型（非null）の場合はオブジェクト比較ブロックで処理（[object Object] 汚染防止）
				if (b !== null && typeof b === 'object') return false;
				// 数値比較（型が number を含む場合は数値優先）
				if (TypeDefUtils.looksNumberType(typeSpec)) {
					const na = TypeDefUtils.parseStrictNumber(a);
					const nb = TypeDefUtils.parseStrictNumber(b);
					if (na != null && nb != null) return na === nb;
				}
				return String(a) === String(b);
			};

			/**
			 * ネスト構造からプリミティブ（string/number/boolean）を抽出
			 * @param {any} v
			 * @param {string[]} out
			 * @param {number} depth
			 */
			const collectLeafPrimitives = (v, out, depth, includePrivateKeys = false) => {
				if (out.length >= 60) return;
				if (depth > 4) return;
				if (v == null) return;
				if (typeof v === 'string') {
					const t = v.trim();
					if (t) out.push(t);
					return;
				}
				if (typeof v === 'number' || typeof v === 'boolean') {
					out.push(String(v));
					return;
				}
				if (Array.isArray(v)) {
					for (const it of v) {
						collectLeafPrimitives(it, out, depth + 1, includePrivateKeys);
						if (out.length >= 60) return;
					}
					return;
				}
				if (typeof v !== 'object') return;

				const keys = Object.keys(v);
				const onlyPrivate = keys.length > 0 && keys.every(k => String(k).startsWith('_'));
				const nextIncludePrivate = includePrivateKeys || onlyPrivate;
				for (const [k, vv] of Object.entries(v)) {
					if (!nextIncludePrivate && String(k).startsWith('_')) continue;
					collectLeafPrimitives(vv, out, depth + 1, nextIncludePrivate);
					if (out.length >= 60) return;
				}
			};

			// {value, about_*} 系は value を優先
			if (val && typeof val === 'object' && !Array.isArray(val) && Object.prototype.hasOwnProperty.call(val, 'value')) {
				return valueEquals(val.value, qKey, typeSpec);
			}

			// {hideText} 系（非公開など）は hideText を比較対象に含める
			if (val && typeof val === 'object' && !Array.isArray(val) && typeof val.hideText === 'string') {
				if (equalsPrimitive(val.hideText, qKey)) return true;
			}

			// {about_JP/about_EN/about} 系（value が無い場合）
			if (val && typeof val === 'object' && !Array.isArray(val) && !Object.prototype.hasOwnProperty.call(val, 'value')) {
				const about = val.about_JP || val.about_EN || val.about;
				if (typeof about === 'string' && equalsPrimitive(about, qKey)) return true;
			}

			// qKey がオブジェクト型（非null・非配列）の場合: AND 条件でサブフィールドを比較
			// - 例: { hashTag: 'Card', key: { Suit: 'Major', SuitNum: 0 } } で
			//   Card.Suit と Card.SuitNum を両方チェックする
			if (qKey !== null && typeof qKey === 'object' && !Array.isArray(qKey)) {
				if (Array.isArray(val)) {
					return val.some(item => valueEquals(item, qKey, typeSpec));
				}
				if (val !== null && typeof val === 'object') {
					return Object.entries(qKey).every(([subKey, subQueryVal]) =>
						valueEquals(val[subKey], subQueryVal, null)
					);
				}
				return false;
			}

			// 配列は any-match
			if (Array.isArray(val)) {
				return val.some(it => valueEquals(it, qKey, typeSpec));
			}

			// Object は葉のプリミティブを抽出して比較（[object Object] 回避）
			if (val && typeof val === 'object') {
				const leaf = [];
				// Object 値の比較では private キー（_Jump/_Search 等）も含めて柔軟に探索
				collectLeafPrimitives(val, leaf, 0, true);
				if (leaf.some(x => equalsPrimitive(x, qKey))) return true;
			}

			return equalsPrimitive(val, qKey);
		};

		return publicRecords.filter(rec => {
			return normalizedQueries.every(q => {
				const typeSpec = typeByPath.get(q.hashTag);

				// *_JP/_EN 同義として候補キーを展開し、いずれかに一致すればOK
				const candidates = TypeDefUtils.expandLangAliasCandidates(q.hashTag);
				if (candidates.length === 0) return false;

				for (const c of candidates) {
					const val = getByPath(rec, c);
					if (typeof val === 'undefined') continue;
					if (valueEquals(val, q.key, typeSpec)) return true;
				}
				return false;
			});
		});
	}
}

/**
 * db_type.json の $DefType を扱うユーティリティ
 * - SW側で「表示分類 / 正規化 / 画像 / 検索」を typedef 駆動にするための最小実装
 */
class TypeDefUtils {
	/**
	 * typedef の isForSecondary を DB 文脈へ適用する。
	 * null/undefined は一次・二次の両方で使う共通フィールドを表す。
	 * @param {Object|null} fieldEntry
	 * @param {boolean|null} isSecondaryContext
	 * @returns {boolean}
	 */
	static isFieldForSecondaryContext(fieldEntry, isSecondaryContext) {
		if (isSecondaryContext === null || isSecondaryContext === undefined) return true;
		const scope = fieldEntry?.isForSecondary;
		if (scope === null || scope === undefined) return true;
		return typeof scope !== 'boolean' || scope === isSecondaryContext;
	}

	/**
	 * $DefType の配列を抽出
	 * @param {any} typeDef - type json / $DefType 配列 / 互換マップ
	 * @returns {Array<Object>} $DefType entries
	 */
	static extractDefTypeEntries(typeDef) {
		if (!typeDef) return [];
		if (Array.isArray(typeDef)) return typeDef.filter(it => it && typeof it === 'object');
		if (Array.isArray(typeDef?.$DefType)) return typeDef.$DefType.filter(it => it && typeof it === 'object');

		// 互換: { Field: {..} } 形式
		if (typeDef && typeof typeDef === 'object') {
			return Object.entries(typeDef)
				.map(([k, v]) => {
					if (!v || typeof v !== 'object') return null;
					return { hashTag: k, ...v };
				})
				.filter(Boolean);
		}
		return [];
	}

	/**
	 * 言語サフィックス（_JP / _JPReading / _EN）を落とした base 名を返す
	 * - typedef は派生キーごとに宣言される（ChronoholderName_JP / _JPReading / _EN）のに対し、
	 *   $DetailLayout は base 名（ChronoholderName）で書かれる。両者の突き合わせに使う
	 * @param {any} key - hashTag
	 * @returns {string} base 名（key が文字列でなければ空文字）
	 */
	static baseHashTag(key) {
		return typeof key === 'string' ? key.replace(/_(JP|JPReading|EN)$/, '') : '';
	}

	/**
	 * `*_JP` / `*_EN` の言語サフィックスを解析する
	 * @param {string} key - hashTag（末尾セグメント想定）
	 * @returns {{ base: string, lang: 'JP'|'EN' }|null} サフィックスが無ければ null
	 */
	static parseLangSuffix(key) {
		const m = String(key || '').match(/^(.*)_(JP|EN)$/);
		if (!m || !m[1] || !m[2]) return null;
		return { base: m[1], lang: m[2] === 'JP' ? 'JP' : 'EN' };
	}

	/**
	 * hashTag（ドットパス可）を `*_JP` / `*_EN` 同義として候補展開する
	 *
	 * コンテナのパス（プレフィックス）は保ち、末尾セグメントだけを展開する。
	 * 「和英で分離したフィールドを suffix 無しで指せる」ようにするための共通部品で、
	 * `_Search` の照合（searchRecords）と `_Jump` の参照解決（resolveJumpsInAny）が共用する。
	 *
	 * - 'FormalName_JP' → ['FormalName_JP', 'FormalName', 'FormalName_EN']
	 * - 'NumerospecStats.NumerospecAbout'
	 *     → ['NumerospecStats.NumerospecAbout', 'NumerospecStats.NumerospecAbout_JP', 'NumerospecStats.NumerospecAbout_EN']
	 *
	 * @param {string} hashTag - 参照するフィールド名（ドットパス可）
	 * @param {'JP'|'EN'|null} [preferLang] - 優先言語（参照元フィールドの suffix）。未指定なら JP 優先
	 * @returns {string[]} 優先順の候補（raw が常に先頭。重複は除去）
	 */
	static expandLangAliasCandidates(hashTag, preferLang = null) {
		const raw = String(hashTag || '').trim();
		if (!raw) return [];

		const parts = raw.split('.');
		const tail = parts.pop() || '';
		const info = TypeDefUtils.parseLangSuffix(tail);

		const baseTail = info ? info.base : tail;
		const prefix = parts.length ? parts.join('.') + '.' : '';

		const base = prefix + baseTail;
		const jp = prefix + baseTail + '_JP';
		const en = prefix + baseTail + '_EN';

		// 参照元が EN のフィールドなら _EN を先に試す（既定は JP 優先＝従来の並び）
		const langOrder = String(preferLang || '').toUpperCase() === 'EN' ? [en, jp] : [jp, en];

		// raw を最優先にしつつ、同義候補を重複排除
		const ordered = info ? [raw, base, ...langOrder] : [raw, ...langOrder];

		const out = [];
		const seen = new Set();
		for (const k of ordered) {
			if (!k || typeof k !== 'string') continue;
			if (seen.has(k)) continue;
			seen.add(k);
			out.push(k);
		}
		return out;
	}

	/**
	 * $slot マーカーの $slotMatch 述語を評価する
	 * - 語彙は 5 種のみ: $type（完全一致）/ $typeIncludes（部分一致）/ $display（浅い部分集合一致）
	 *   / $inLayout（$DetailLayout の宣言配列に載っているか）/ "*"（catch-all）
	 * - 述語を増やすと「位置を schema で宣言する」意図が崩れて field 名依存の分岐に逆戻りするため、
	 *   表現力は意図的に低く保つ。拾えない例外は作品側エントリの `$slot` 明示で逃がす
	 * - 述語が 1 つも指定されていない object は false（`{}` が全件に一致する事故を防ぐ）
	 * @param {any} match - マーカーの $slotMatch
	 * @param {Object} entry - 作品側 $DefType エントリ
	 * @param {Object} [options]
	 * @param {Object} [options.detailLayout] - $inLayout の解決に使う（未指定なら $inLayout は一致しない）
	 * @returns {boolean} 一致したか
	 */
	static matchesSlot(match, entry, options = {}) {
		if (match === '*') return true;
		if (!match || typeof match !== 'object') return false;
		if (!entry || typeof entry !== 'object') return false;

		let specified = false;
		if (typeof match.$type === 'string') {
			if (entry.$type !== match.$type) return false;
			specified = true;
		}
		if (typeof match.$typeIncludes === 'string') {
			// $type は "$Def_DBLinkRef[]|#Null" のようなユニオン文字列。
			// 配列（インライン構造体宣言）は部分一致の対象外とする
			if (typeof entry.$type !== 'string' || !entry.$type.includes(match.$typeIncludes)) return false;
			specified = true;
		}
		if (match.$display && typeof match.$display === 'object') {
			const display = entry.$display;
			if (!display || typeof display !== 'object') return false;
			for (const [k, v] of Object.entries(match.$display)) {
				if (display[k] !== v) return false;
			}
			specified = true;
		}
		if (typeof match.$inLayout === 'string') {
			// $DetailLayout 欠損時は一致させない（作品固有フィールドは catch-all へ落ちる）
			const declared = this.resolveDottedPath(options?.detailLayout, match.$inLayout);
			if (!Array.isArray(declared)) return false;
			if (!declared.includes(entry.hashTag) && !declared.includes(this.baseHashTag(entry.hashTag))) return false;
			specified = true;
		}
		return specified;
	}

	/**
	 * ドット区切りパスで入れ子の値を取り出す
	 * @param {Object} root - 探索の起点
	 * @param {any} path - "a.b.c" 形式のパス
	 * @returns {any} 解決した値（辿れなければ undefined）
	 */
	static resolveDottedPath(root, path) {
		if (!root || typeof path !== 'string' || !path) return undefined;
		let node = root;
		for (const seg of path.split('.')) {
			if (!node || typeof node !== 'object') return undefined;
			node = node[seg];
		}
		return node;
	}

	/**
	 * $slotExpand（ドット区切りパス）が指す定義の $DefType を取り出す
	 * - 例: "$MetaType.$Def_SecondaryMeta" → globalType.$MetaType.$Def_SecondaryMeta.$DefType
	 * - $DefType 配列を明示的に持つ定義だけを受け入れる（互換マップ解釈へ落ちると誤展開するため）
	 * @param {Object} root - グローバル type json
	 * @param {any} path - $slotExpand の値
	 * @returns {Array<Object>} 展開する $DefType エントリ（解決できなければ空配列）
	 */
	static resolveSlotExpand(root, path) {
		const node = this.resolveDottedPath(root, path);
		return Array.isArray(node?.$DefType) ? node.$DefType.filter(it => it && typeof it === 'object') : [];
	}

	/**
	 * 宣言済みの順序配列（例: $DetailLayout.subFields）に合わせて $DefType エントリを並べ替える
	 * - 順序配列は base 名（例: "NumerospecAbout"）で書かれ、実フィールドは `_JP` / `_EN` 付きのことがある。
	 *   base へフォールバックして同じ順位に束ね、`_JP` → `_EN` の相対順は元の宣言順で保つ
	 * - 順序配列に無いエントリは末尾へ、元の相対順を保ったまま送る（安定ソート）
	 * @param {Array<Object>} entries - $DefType エントリ
	 * @param {Array<string>} order - 宣言済みの順序（hashTag / base 名）
	 * @returns {Array<Object>} 並べ替え済みエントリ
	 */
	static sortEntriesByDeclaredOrder(entries, order) {
		if (!Array.isArray(order) || order.length === 0) return entries;
		const rank = new Map();
		order.forEach((k, i) => {
			if (typeof k === 'string' && k && !rank.has(k)) rank.set(k, i);
		});
		const rankOf = (entry) => {
			const key = entry?.hashTag;
			if (!key) return Number.POSITIVE_INFINITY;
			if (rank.has(key)) return rank.get(key);
			const base = this.baseHashTag(key);
			return rank.has(base) ? rank.get(base) : Number.POSITIVE_INFINITY;
		};
		return entries
			.map((entry, i) => ({ entry, i, r: rankOf(entry) }))
			.sort((a, b) => {
				// Infinity 同士の減算は NaN になるため、大小比較で分岐する
				if (a.r !== b.r) return a.r < b.r ? -1 : 1;
				return a.i - b.i;
			})
			.map(x => x.entry);
	}

	/**
	 * $slotAnchor: スロットのメンバーを、宣言配列（例: $DetailLayout.basicFields）上の
	 * 「直前の隣人」の位置へ散らす
	 *
	 * `$slotOrder` が「マーカー位置にまとめて並べる」のに対し、`$slotAnchor` は
	 * 「宣言配列が示す本来の隣へ配る」。basicFields のように作品固有フィールドが
	 * グローバル項目の間へ点在する宣言（TailsUnit は BustSize の直後、ForMasterCalling は
	 * ThirdPersonCalling の直後…）を、マーカー 1 個で表現するための規則。
	 * ツール側の「未宣言キーは直前の宣言済みキーへアンカーする」規則（tools/normalize-field-order.mjs）
	 * と同じ考え方を typedef 側へ持ち込んだもの。
	 *
	 * 挿入位置の解決順（先に見つかったものを採る）:
	 *   1. 既に移設済みの同 base 兄弟（ChronoholderName_JP → _JPReading → _EN を束ねる）
	 *   2. 宣言配列を遡り、最初に out 上で見つかったキーの直後
	 *   3. sentinel（マーカー自身の位置）
	 *
	 * @param {Array<Object>} out - マージ結果（sentinel を 1 個含む。破壊的に変更する）
	 * @param {Object} sentinel - マーカー位置を示す番兵（アンカーを解決できないメンバーの落とし先）
	 * @param {Array<Object>} members - 移設するエントリ（out には未挿入）
	 * @param {Array<string>} declared - 宣言配列（basicFields 等）
	 * @returns {void}
	 */
	static applySlotAnchor(out, sentinel, members, declared) {
		const rank = new Map();
		declared.forEach((k, i) => {
			if (typeof k === 'string' && k && !rank.has(k)) rank.set(k, i);
		});
		const rankOf = (entry) => {
			const key = entry?.hashTag;
			if (rank.has(key)) return rank.get(key);
			const base = this.baseHashTag(key);
			return rank.has(base) ? rank.get(base) : Number.POSITIVE_INFINITY;
		};
		// base 一致の「最後」を採るのは、_JP/_JPReading/_EN が並ぶ群の直後へ挿すため
		const lastIndexOfBase = (base) => {
			if (!base) return -1;
			for (let i = out.length - 1; i >= 0; i--) {
				if (out[i]?.hashTag && this.baseHashTag(out[i].hashTag) === base) return i;
			}
			return -1;
		};

		// 宣言順に処理する。同じアンカーを共有するメンバー（For79th → For80th）は、
		// 先に移設した側が次のメンバーのアンカーとして見つかるため相対順が保たれる
		const ordered = members
			.map((entry, i) => ({ entry, i, r: rankOf(entry) }))
			.sort((a, b) => {
				if (a.r !== b.r) return a.r < b.r ? -1 : 1;
				return a.i - b.i;
			})
			.map(x => x.entry);

		for (const member of ordered) {
			const di = rankOf(member);
			let pos = -1;
			if (Number.isFinite(di)) {
				pos = lastIndexOfBase(this.baseHashTag(member.hashTag));
				for (let j = di - 1; pos < 0 && j >= 0; j--) {
					pos = lastIndexOfBase(this.baseHashTag(declared[j]));
				}
			}
			if (pos < 0) pos = out.indexOf(sentinel);
			out.splice(pos + 1, 0, member);
		}
	}

	/**
	 * $slot マーカー未宣言時のマージ（従来仕様）
	 * - グローバルの並び順を土台にし、同名 hashTag は作品側で置換、作品固有は末尾追加
	 * @param {Array<Object>} g - グローバル $DefType エントリ
	 * @param {Array<Object>} w - 作品別 $DefType エントリ
	 * @returns {Array<Object>} merged $DefType
	 */
	static mergeDefTypesLegacy(g, w) {
		const wByKey = new Map(w.filter(e => e?.hashTag).map(e => [e.hashTag, e]));
		const used = new Set();
		const out = [];

		for (const ge of g) {
			const key = ge?.hashTag;
			if (!key) continue;
			out.push(wByKey.get(key) ?? ge);
			used.add(key);
		}
		for (const we of w) {
			const key = we?.hashTag;
			if (!key || used.has(key)) continue;
			out.push(we);
		}
		return out;
	}

	/**
	 * グローバル/作品の $DefType をマージ（作品側が上書き、順序は global を優先）
	 *
	 * グローバル $DefType には `hashTag` を持たない「$slot マーカー」を置ける。マーカーは
	 * 作品固有フィールドの挿入位置を宣言するためのもので、マージ結果には含まれない
	 * （既存の $DefType 走査はいずれも hashTag falsy を continue するため、下流からは不可視）。
	 *
	 * 作品固有フィールドのスロット解決順:
	 *   1. 作品側エントリの `$slot` 明示（逃がし弁）
	 *   2. マーカーの `$slotMatch` 述語（宣言順に先勝ち）
	 *   3. catch-all マーカー（`$slotMatch: "*"`）
	 *
	 * マーカーが `$slotOrder`（`options.detailLayout` からのドット区切りパス）を持つ場合、
	 * そのスロットに入った作品固有フィールドを宣言済みの順序（例: `$DetailLayout.subFields`）へ
	 * 並べ替える。詳細画面のセクション順とデータのキー順を揃えるための宣言。
	 *
	 * マーカーが `$slotAnchor` を持つ場合、メンバーはマーカー位置へまとめず、宣言配列
	 * （例: `$DetailLayout.basicFields`）上の直前の隣人の位置へ散らす（applySlotAnchor 参照）。
	 * マーカー位置はアンカーを解決できなかったメンバーの落とし先として使う。
	 *
	 * マーカーが 1 つも無ければ従来仕様（mergeDefTypesLegacy）へフォールバックする。
	 * @param {Object} globalType
	 * @param {Object} workType
	 * @param {Object} [options]
	 * @param {Object} [options.detailLayout] - 作品の $DetailLayout（`$slotOrder` / `$slotAnchor` / `$inLayout` の解決に使う）
	 * @returns {Array<Object>} merged $DefType（マーカー・番兵は含まない）
	 */
	static mergeDefTypes(globalType, workType, options = {}) {
		const g = this.extractDefTypeEntries(globalType);
		const w = this.extractDefTypeEntries(workType);

		const markers = g.filter(e => e && !e.hashTag && typeof e.$slot === 'string');
		if (markers.length === 0) return this.mergeDefTypesLegacy(g, w);

		const globalKeys = new Set(g.map(e => e?.hashTag).filter(Boolean));
		const wByKey = new Map(w.filter(e => e?.hashTag).map(e => [e.hashTag, e]));
		const fallbackSlot = markers.find(m => m.$slotMatch === '*')?.$slot ?? null;

		// 作品固有フィールド（グローバルに同名が無いもの）を、宣言順を保ったままスロットへ配る
		const bySlot = new Map(markers.map(m => [m.$slot, []]));
		for (const we of w) {
			const key = we?.hashTag;
			if (!key || globalKeys.has(key)) continue; // グローバル同名は下の置換で処理する
			const slot = (typeof we.$slot === 'string' && bySlot.has(we.$slot))
				? we.$slot
				: (markers.find(m => m.$slotMatch !== '*' && this.matchesSlot(m.$slotMatch, we, options))?.$slot ?? fallbackSlot);
			if (slot && bySlot.has(slot)) bySlot.get(slot).push(we);
		}

		const out = [];
		const emitted = new Set();
		const anchorJobs = [];
		const push = (entry) => {
			const key = entry?.hashTag;
			if (!key || emitted.has(key)) return;
			out.push(entry);
			emitted.add(key);
		};

		for (const ge of g) {
			if (!ge.hashTag) {
				if (typeof ge.$slot !== 'string') continue;
				// $slotExpand: 別定義の $DefType をこの位置へ展開（作品側に同名があれば作品側を採る）
				for (const ee of this.resolveSlotExpand(globalType, ge.$slotExpand)) {
					push(wByKey.get(ee.hashTag) ?? ee);
				}
				let slotted = bySlot.get(ge.$slot) ?? [];
				// $slotOrder: スロット内の並びを $DetailLayout の宣言順（subFields 等）へ寄せる
				if (typeof ge.$slotOrder === 'string' && options?.detailLayout) {
					const declared = this.resolveDottedPath(options.detailLayout, ge.$slotOrder);
					if (Array.isArray(declared)) slotted = this.sortEntriesByDeclaredOrder(slotted, declared);
				}
				// $slotAnchor: メンバーはここへ並べず、宣言配列上の隣へ散らす。番兵だけ置いて後段で処理する
				// （out の組み立てが終わるまで、アンカー先のグローバル項目が揃わないため）
				const anchorPath = typeof ge.$slotAnchor === 'string' ? ge.$slotAnchor : null;
				const anchorDeclared = anchorPath && options?.detailLayout
					? this.resolveDottedPath(options.detailLayout, anchorPath)
					: null;
				if (Array.isArray(anchorDeclared)) {
					const sentinel = { $slotSentinel: ge.$slot };
					out.push(sentinel);
					// 末尾の保険ループが重複 push しないよう、移設予定のメンバーも emitted 済みにする
					const members = slotted.filter(we => we?.hashTag && !emitted.has(we.hashTag));
					for (const we of members) emitted.add(we.hashTag);
					anchorJobs.push({ sentinel, members, declared: anchorDeclared });
					continue;
				}
				for (const we of slotted) push(we);
				continue;
			}
			push(wByKey.get(ge.hashTag) ?? ge);
		}
		// catch-all マーカーを置き忘れた場合でもフィールドを落とさないための保険
		for (const we of w) push(we);
		for (const job of anchorJobs) this.applySlotAnchor(out, job.sentinel, job.members, job.declared);
		return out.filter(e => !e.$slotSentinel);
	}

	/**
	 * ラベル（日本語）を抽出
	 * @param {Object} entry
	 * @returns {string|null}
	 */
	static pickLabel(entry) {
		if (!entry || typeof entry !== 'object') return null;
		return entry.hashTag_JP || entry.hashtag_JP || entry.hashTag_EN || entry.hashtag_EN || entry.label || entry.displayName || null;
	}

	/**
	 * 表示セクションを typedef から決定
	 * - db_type.json 側に displaySection / $display.section を追加すれば明示指定可能
	 * - 未指定時は $type と hashTag から推定
	 * @param {Object} entry
	 * @returns {'basic'|'profile'|'spec'|'images'|'other'}
	 */
	static pickDisplaySection(entry) {
		if (!entry || typeof entry !== 'object') return 'other';
		const explicit = entry.displaySection || entry.$display?.section || entry._display?.section;
		if (explicit && typeof explicit === 'string') {
			const s = explicit.toLowerCase();
			if (s === 'basic' || s === 'profile' || s === 'spec' || s === 'images' || s === 'other') return s;
		}

		const key = String(entry.hashTag || '');
		const typeSpec = entry.$type;
		let typeStr = typeof typeSpec === 'string' ? typeSpec : '';

		// bilingual wrapper（$type が _JP/_EN ペアの配列）の場合、有効ベース型を typeStr として使用
		if (!typeStr && Array.isArray(typeSpec)) {
			const bwInfo = this.detectBilingualWrapper(typeSpec, entry.$display ?? null);
			if (bwInfo?.effectiveBaseType) {
				typeStr = bwInfo.effectiveBaseType;
			}
		}

		if (key === 'Images' || this.looksImageType(typeSpec) || key.includes('Image') || key.includes('PNG')) return 'images';
		if (typeStr.includes('#Summary') || typeStr.includes('#Dialogue') || /(Calling|Character|Hobby|SpecialSkill|Favor|Unlike|About|Comment|Summary|Dialogue)/i.test(key)) return 'profile';
		if (/(Spec|Stats|Arcanum|Numero|Beast|Safety|Rank|Level|Effect|Material|ActionType|Dualize)/i.test(key)) return 'spec';
		return 'basic';
	}

	/**
	 * 画像型っぽいか
	 * @param {any} typeSpec
	 * @returns {boolean}
	 */
	static looksImageType(typeSpec) {
		if (!typeSpec) return false;
		if (typeof typeSpec === 'string') {
			return /(PNGFileName|PNGFilePath|JPG|JPEG|WEBP|SVG|BMP)/i.test(typeSpec);
		}
		if (Array.isArray(typeSpec)) {
			return typeSpec.some(e => this.looksImageType(e?.$type));
		}
		return false;
	}

	/**
	 * searchableText の対象にしやすい型か
	 * @param {any} typeSpec
	 * @returns {boolean}
	 */
	static looksSearchableType(typeSpec) {
		if (!typeSpec) return false;
		if (typeof typeSpec === 'string') {
			// Day / Era / Area 系を typedef 駆動で検索対象へ含める。
			// - #DictIndex: Area など辞書参照フィールド
			// - $Def_Day / $Def_StoryEra* / $Def_BaseArea: Day / Era / Area の構造型
			// - $Def_Faction: 辞書コード（Faction）を子要素に持つ所属の構造型
			return /(#String|#Summary|#Dialogue|#Enum|\$EnumDef|#DictIndex|\$Def_Day|\$Def_StoryEra|\$Def_BaseArea|\$Def_Faction)/i.test(typeSpec);
		}
		if (Array.isArray(typeSpec)) return true;
		return false;
	}

	/**
	 * number 型っぽいか
	 * @param {any} typeSpec
	 * @returns {boolean}
	 */
	static looksNumberType(typeSpec) {
		if (!typeSpec) return false;
		if (typeof typeSpec === 'string') {
			// '#Number|#String' のような union は「文字列ID（000 等）」の可能性があるため
			// 数値化/数値比較を避けて厳密一致（文字列比較）に倒す
			if (!/#Number/i.test(typeSpec)) return false;
			if (/#String/i.test(typeSpec)) return false;
			return true;
		}
		return false;
	}

	/**
	 * 文字列を「完全な数値」として解釈できる場合のみ number を返す
	 * - parseFloat のように '0-alt' を 0 扱いしない（曖昧一致の原因になる）
	 * @param {any} v
	 * @returns {number|null}
	 */
	static parseStrictNumber(v) {
		if (typeof v === 'number') return Number.isFinite(v) ? v : null;
		if (typeof v !== 'string') return null;
		const s = v.trim();
		if (!s) return null;
		if (!/^[+-]?\d+(?:\.\d+)?$/.test(s)) return null;
		const n = Number(s);
		return Number.isFinite(n) ? n : null;
	}

	/**
	 * Index 型っぽいか（#Index）
	 * @param {any} typeSpec
	 * @returns {boolean}
	 */
	static looksIndexType(typeSpec) {
		if (!typeSpec) return false;
		if (typeof typeSpec !== 'string') return false;
		return /(^|\||,)\s*#Index\s*($|\||,)/i.test(typeSpec) || /\b#Index\b/i.test(typeSpec);
	}

	/**
	* work typedef の $IndexDef（または旧メタ互換）を解析して扱いやすい形にする
	 * @param {any} indexDef
	 * @returns {{rootKey:string,nested:boolean,subDefs:Array<{key:string,typeSpec:any}>}|null}
	 */
	static getIndexDefInfo(indexDef) {
		if (!indexDef || typeof indexDef !== 'object') return null;
		const rootKey = typeof indexDef.hashTag === 'string' ? indexDef.hashTag.trim() : '';
		if (!rootKey) return null;

		const rawType = indexDef.$type ?? indexDef.$valType ?? null;
		if (Array.isArray(rawType)) {
			const subDefs = rawType
				.filter(it => it && typeof it === 'object')
				.map(it => ({
					key: typeof it.hashTag === 'string' ? it.hashTag.trim() : '',
					typeSpec: it.$type ?? it.$valType ?? null
				}))
				.filter(it => it.key);
			return { rootKey, nested: true, subDefs };
		}

		return { rootKey, nested: false, subDefs: [] };
	}

	/**
	 * ネストIndex の主要サブフィールドを推定（#Number / #IndexListKey / #ListIndex（互換）を優先）
	 * - #Number: 数値識別子として最優先（旧来の挙動を維持）
	 * - #IndexListKey: $IndexDef 専用の主キーフィールド型（推奨）
	 * - #ListIndex: 後方互換として #IndexListKey と同等扱い
	 * @param {Array<{key:string,typeSpec:any}>} subDefs
	 * @returns {{key:string,typeSpec:any}|null}
	 */
	static pickPrimaryIndexSubDef(subDefs) {
		if (!Array.isArray(subDefs) || subDefs.length === 0) return null;
		const score = (t) => {
			if (!t || typeof t !== 'string') return 99;
			if (/#Number/i.test(t)) return 0;
			if (/#IndexListKey/i.test(t)) return 1;
			if (/#ListIndex/i.test(t)) return 1; // 後方互換
			return 50;
		};
		const sorted = [...subDefs].sort((a, b) => score(a?.typeSpec) - score(b?.typeSpec));
		return sorted[0] || null;
	}

	/**
	 * $DefType のトップレベル宣言から「エイリアスIndex」定義を収集する
	 *
	 * エイリアスIndexとは:
	 * - `$type` に `#Index` を持つトップレベル field のうち、現在の DB で解決された
	 *   `$IndexDef`（resolvedIndexDef）の rootKey とは別名の field（例: UnauthedLogica の `LogicAlt`）。
	 * - レコードが主Indexに加えて互換番号・別体系の識別子を持つケースを、schema 駆動で
	 *   「もう1つのIndex」として扱えるようにする汎用機構。
	 *
	 * 形状（サブフィールド構造）の解決順:
	 * 1. workType の `$IndexDef` / `$IndexDef_*` のうち hashTag がエイリアス名と一致する宣言
	 *    （例: PrimaryMobs DB における `Model` → `$IndexDef` の Model 定義）
	 * 2. 無ければ現在の resolvedIndexDef の形状を流用（例: `LogicAlt` は `Logic` と同構造とみなす）
	 *
	 * 表示ラベルはエイリアス field 側の $DefType エントリ（hashTag_JP/EN）を優先する。
	 * `$display.index` が false / 'none' / 'off' / 'hidden' のエントリは除外（opt-out）。
	 *
	 * @param {Array<Object>} defTypeEntries - extractDefTypeEntries() 済みの $DefType エントリ配列
	 * @param {Object|null} resolvedIndexDef - 現在のDBで解決済みの $IndexDef
	 * @param {Object|null} workType - 作品別 typedef（$IndexDef_* サイドカー参照用）
	 * @returns {Array<Object>} エイリアスIndex定義（$IndexDef 互換 + `$indexAlias: true` マーカー）
	 */
	static collectIndexAliasDefs(defTypeEntries, resolvedIndexDef, workType = null) {
		const rootKey = typeof resolvedIndexDef?.hashTag === 'string' ? resolvedIndexDef.hashTag.trim() : '';
		if (!Array.isArray(defTypeEntries) || defTypeEntries.length === 0) return [];

		// opt-out 判定（$display.index: false | 'none' | 'off' | 'hidden'）
		const isIndexDisplayDisabled = (entry) => {
			const raw = entry?.$display?.index;
			if (raw === false) return true;
			if (typeof raw === 'string') {
				const t = raw.trim().toLowerCase();
				return t === 'none' || t === 'off' || t === 'hidden';
			}
			return false;
		};

		// workType の $IndexDef / $IndexDef_* から「hashTag が一致する形状定義」を探す
		const findShapeDefFor = (aliasKey) => {
			if (!workType || typeof workType !== 'object') return null;
			for (const [k, v] of Object.entries(workType)) {
				if (!/^\$IndexDef(?:_|$)/.test(k)) continue;
				if (v && typeof v === 'object' && typeof v.hashTag === 'string' && v.hashTag.trim() === aliasKey) return v;
			}
			return null;
		};

		const out = [];
		for (const entry of defTypeEntries) {
			const key = typeof entry?.hashTag === 'string' ? entry.hashTag.trim() : '';
			if (!key || key === rootKey) continue;
			if (!this.looksIndexType(entry?.$type)) continue;
			if (isIndexDisplayDisabled(entry)) continue;

			const shape = findShapeDefFor(key)
				|| ((resolvedIndexDef && typeof resolvedIndexDef === 'object') ? resolvedIndexDef : null);
			if (!shape) continue;

			out.push({
				...shape,
				hashTag: key,
				// 表示ラベルはエイリアス field 側（$DefType エントリ）の宣言を優先する
				hashTag_JP: entry.hashTag_JP ?? entry.hashtag_JP ?? shape.hashTag_JP ?? null,
				hashTag_EN: entry.hashTag_EN ?? entry.hashtag_EN ?? shape.hashTag_EN ?? null,
				$indexAlias: true,
			});
		}
		return out;
	}

	/**
	 * `$type` 文字列に含まれる名前付き型参照（例: "$Def_TailsUnit[]|#Null" -> "$Def_TailsUnit"）を抽出
	 * @param {any} typeSpec
	 * @returns {string|null}
	 */
	static extractNamedDefTypeRef(typeSpec) {
		if (typeof typeSpec !== 'string') return null;
		const m = typeSpec.match(/\$Def_[A-Za-z0-9_]+/);
		return m ? m[0] : null;
	}

	/**
	 * 画像パス（dot path）ヒントを $DefType から抽出
	 * - インラインの入れ子配列（`$type`が配列）だけでなく、`"$Def_TailsUnit[]"` のような
	 *   名前付き型参照文字列も `typeSources`（CharacterValueWrapperRegistry.helpers.resolveTypeDefEntries 互換）
	 *   経由で解決し、内部の画像フィールド（例: `img_PNGName`）まで辿る
	 * - フォルダヒントは `$subfolder`（明示宣言）を最優先し、無ければ従来通りキー名から推定する
	 * @param {Array<Object>} defTypeEntries
	 * @param {Array<Object>} [typeSources] - 名前付き型参照解決用の typeSources
	 * @returns {Array<{path: string, key: string, type: string|null, folderHint: string|null}>}
	 */
	static buildImagePathHints(defTypeEntries, typeSources = []) {
		const out = [];
		const registry = getCharacterValueWrapperRegistry();
		const resolveNamedEntries = typeof registry?.helpers?.resolveTypeDefEntries === 'function'
			? registry.helpers.resolveTypeDefEntries
			: null;
		const visitedDefNames = new Set();

		const walk = (entries, prefix = '') => {
			if (!Array.isArray(entries)) return;
			for (const e of entries) {
				const k = e?.hashTag;
				if (!k) continue;
				const path = prefix ? `${prefix}.${k}` : k;
				const t = e?.$type;
				if (this.looksImageType(t) || /PNG/i.test(k)) {
					const explicitSubfolder = typeof e?.$subfolder === 'string' && e.$subfolder.trim()
						? e.$subfolder.trim()
						: null;
					const folderHint = explicitSubfolder || this.inferFolderHintFromKey(k);
					out.push({ path, key: k, type: typeof t === 'string' ? t : null, folderHint });
				}
				if (Array.isArray(t)) {
					walk(t, path);
				} else if (resolveNamedEntries) {
					const defName = this.extractNamedDefTypeRef(t);
					if (defName && !visitedDefNames.has(defName)) {
						visitedDefNames.add(defName);
						const resolved = resolveNamedEntries(typeSources, defName);
						if (Array.isArray(resolved) && resolved.length) {
							walk(resolved, path);
						}
					}
				}
			}
		};
		walk(defTypeEntries);
		return out;
	}

	/**
	 * キーから画像フォルダ名を推定（concept_PNGName -> concept など）
	 * @param {string} key
	 * @returns {string|null}
	 */
	static inferFolderHintFromKey(key) {
		const s = String(key || '');
		const m = s.match(/^([A-Za-z0-9-]+)_PNG/i);
		if (m) return m[1];
		return null;
	}

	/**
	 * 型文字列から配列型かを判定
	 * @param {any} typeSpec
	 * @returns {boolean}
	 */
	static isArrayType(typeSpec) {
		return typeof typeSpec === 'string' && /\[\]/.test(typeSpec);
	}

	/**
	 * type 文字列から _JP / _EN の言語サフィックスを除去してベース型に変換
	 * - '#String_JP_withAbout[]' → '#String_withAbout[]'
	 * - '#String_JP'           → '#String'
	 * - '#String_withAbout[]'  → '#String_withAbout[]' （変化なし）
	 * - union 型（'|'区切り）の各トークンに対して個別に適用する
	 * @param {string} typeStr
	 * @returns {string}
	 */
	static stripLangSuffixFromTypeStr(typeStr) {
		if (typeof typeStr !== 'string') return typeStr;
		return typeStr
			.split('|')
			.map(token => token.trim().replace(
				/^(#[A-Za-z]+)_(JP|EN)((?:_[A-Za-z]+)*)(\[\])?$/,
				(_, base, _lang, rest, arr) => `${base}${rest}${arr || ''}`
			))
			.join('|');
	}

	/**
	 * $type 配列が和英ペア（bilingual wrapper）かどうかを検出し、有効なベース型情報を返す
	 *
	 * 「bilingual wrapper」の条件:
	 * - $type が配列で、全子要素の hashTag が _JP または _EN で終わる
	 * - _JP / _EN の base 名が一致するペアが最低1組存在する
	 * - 言語サフィックス以外の要素が混在していない
	 *
	 * @param {Array} typeArray - $type 配列
	 * @param {Object|null} display - $display オブジェクト（langMode を参照）
	 * @returns {{
	 *   detected: true,
	 *   langMode: string,
	 *   primaryChildKey: string,
	 *   altChildKey: string,
	 *   effectiveBaseType: string
	 * }|null}
	 */
	static detectBilingualWrapper(typeArray, display) {
		if (!Array.isArray(typeArray) || typeArray.length < 2) return null;

		const jpItems = [];
		const enItems = [];
		for (const entry of typeArray) {
			const ht = typeof entry?.hashTag === 'string' ? entry.hashTag : '';
			if (!ht) return null;
			if (ht.endsWith('_JP')) jpItems.push(entry);
			else if (ht.endsWith('_EN')) enItems.push(entry);
			else return null; // 言語サフィックス以外の子要素が存在 → bilingual wrapper ではない
		}
		if (jpItems.length === 0 || enItems.length === 0) return null;

		// _JP / _EN で base 名が一致するペアを収集
		const pairs = [];
		for (const jp of jpItems) {
			const base = jp.hashTag.slice(0, -3); // '_JP' (3文字) を除去
			const en = enItems.find(e => e.hashTag === base + '_EN');
			if (en) pairs.push({ base, jpEntry: jp, enEntry: en });
		}
		if (pairs.length === 0) return null;

		// $display.langMode から表示言語優先度を取得（省略時は 'jp' を既定）
		const langMode = (display && typeof display === 'object' && typeof display.langMode === 'string')
			? display.langMode.trim().toLowerCase()
			: 'jp';

		// 代表ペアの JP 型から言語サフィックスを除去して有効ベース型を導出
		const repr = pairs[0];
		const jpTypeStr = typeof repr.jpEntry.$type === 'string' ? repr.jpEntry.$type : '#String';
		const effectiveBaseType = this.stripLangSuffixFromTypeStr(jpTypeStr);

		return {
			detected: true,
			langMode,
			primaryChildKey: langMode === 'en' ? repr.enEntry.hashTag : repr.jpEntry.hashTag,
			altChildKey: langMode === 'en' ? repr.jpEntry.hashTag : repr.enEntry.hashTag,
			effectiveBaseType
		};
	}

	/**
	 * $DefType エントリを再帰的に走査して bilingual wrapper field のパス情報を収集
	 * - トップレベル・ネスト済みの両方を対象にする（例: StreamingActivity.StreamingGreeting）
	 * - bilingual wrapper でないが子を持つ配列型の場合は再帰して内部を探索する
	 * @param {Array} entries - $DefType entries（抽出済み）
	 * @param {string} [prefix] - 親フィールドの dot-path プレフィックス
	 * @returns {Array<{
	 *   path: string,
	 *   langMode: string,
	 *   primaryChildKey: string,
	 *   altChildKey: string,
	 *   effectiveBaseType: string
	 * }>}
	 */
	static collectBilingualWrapperPaths(entries, prefix = '') {
		if (!Array.isArray(entries)) return [];
		const result = [];
		for (const entry of entries) {
			const key = typeof entry?.hashTag === 'string' ? entry.hashTag : '';
			if (!key) continue;
			const path = prefix ? `${prefix}.${key}` : key;
			const typeSpec = entry?.$type;
			const display = entry?.$display ?? null;

			if (Array.isArray(typeSpec)) {
				const info = this.detectBilingualWrapper(typeSpec, display);
				if (info?.detected) {
					result.push({ path, ...info });
				} else {
					// bilingual wrapper ではないが子を持つ配列型 → 再帰探索
					result.push(...this.collectBilingualWrapperPaths(typeSpec, path));
				}
			}
		}
		return result;
	}

	/**
	 * typeSpec から最初の `$Def_*` トークンを取得
	 * @param {any} typeSpec
	 * @returns {string}
	 */
	static firstDefToken(typeSpec) {
		if (Array.isArray(typeSpec)) return '';
		return String(typeSpec || '')
			.split('|')
			.map((token) => token.trim())
			.find((token) => token.startsWith('$Def_')) || '';
	}

	/**
	 * 合成済み `$VarsDef` から辞書行（`#Dict_*` / `#List_*` の 1 行）を引く
	 * @description
	 *   `$dictRef` 解決のように「ラベルだけでなく行の付随情報」が要るケースで使う。
	 *   `lib/basic-renders/type-common.js` の `TypeResolver.resolveDictRow()` と同じ突き合わせ規則
	 *   （ベースキー / `_JP` / `_EN` のいずれかが一致）を、SW 側の依存なしで再現する。
	 * @param {Object|null} mergedVars - 合成済み $VarsDef
	 * @param {string} dictName - 辞書名（`$dict` 宣言の値）
	 * @param {any} code - 突き合わせるコード値
	 * @returns {Object|null} 一致した辞書行（無ければ null）
	 */
	static findDictRow(mergedVars, dictName, code) {
		const name = String(dictName || '').trim();
		const rv = (code === null || code === undefined) ? '' : String(code).trim();
		if (!name || !rv) return null;
		if (!mergedVars || typeof mergedVars !== 'object') return null;

		const keyCandidates = [name, `${name}_JP`, `${name}_EN`];
		for (const listKey of [`#Dict_${name}`, `#List_${name}`]) {
			const rows = Array.isArray(mergedVars[listKey]) ? mergedVars[listKey] : null;
			if (!rows) continue;
			const hit = rows.find((row) => row && typeof row === 'object' && !Array.isArray(row)
				&& keyCandidates.some((k) => typeof row[k] === 'string' && row[k].trim() === rv));
			if (hit) return hit;
		}
		return null;
	}

	/**
	 * 型指定に基づき値を正規化
	 * @param {any} value
	 * @param {any} typeSpec
	 * @returns {any}
	 */
	static normalizeValueByTypeSpec(value, typeSpec) {
		const opt = arguments.length >= 3 && arguments[2] && typeof arguments[2] === 'object' ? arguments[2] : {};
		const indexDef = opt?.indexDef && typeof opt.indexDef === 'object' ? opt.indexDef : null;
		if (value == null) return value;

		// array 型は単発 -> 配列に寄せる
		if (this.isArrayType(typeSpec) && !Array.isArray(value)) {
			return [value];
		}

		// #String/#Summary/#Dialogue 系はプリミティブを string に寄せる
		if (typeof typeSpec === 'string' && /(#String|#Summary|#Dialogue)/i.test(typeSpec)) {
			if (typeof value === 'string') return value;
			if (typeof value === 'number' || typeof value === 'boolean') return String(value);
			return value;
		}

		// #Number 系は string 数値だけ number に寄せる（オブジェクト構造は維持）
		if (this.looksNumberType(typeSpec)) {
			if (typeof value === 'string') {
				const n = this.parseStrictNumber(value);
				return n == null ? value : n;
			}
			return value;
		}

		// #Index は、作品の $IndexDef がネスト型の場合のみ、最低限の形を補正
		// - フィールド値は「サブフィールドを直接持つオブジェクト」（例: Card: {Suit, Num}）を正とする。
		//   rootKey で二重に包む形（例: Card: {Card:{...}}）にすると、UI の collectIndexEntries や
		//   supplementIndexFieldFromVarsDef が record[rootKey][subKey] を辿れず Index 解決が破綻する。
		if (this.looksIndexType(typeSpec) && indexDef) {
			const info = this.getIndexDefInfo(indexDef);
			if (info?.nested && info.rootKey && Array.isArray(info.subDefs) && info.subDefs.length > 0) {
				const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
				const primarySub = this.pickPrimaryIndexSubDef(info.subDefs) || info.subDefs[0];
				const subKey = primarySub?.key;
				if (!subKey) return value;

				// プリミティブは primary sub へ寄せる（例: Card: 0 → Card: {Num: 0}）
				if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
					return { [subKey]: value };
				}

				// rootKey で包まれた旧形（{Card:{Suit,...}}）は unwrap して {Suit,...} に寄せる
				if (isObj(value) && isObj(value[info.rootKey])) {
					return value[info.rootKey];
				}
			}
		}

		return value;
	}

	/**
	 * 検索クエリ側の key を型に寄せる
	 * @param {any} rawKey
	 * @param {any} typeSpec
	 * @returns {any}
	 */
	static normalizeQueryValueByTypeSpec(rawKey, typeSpec) {
		if (rawKey == null) return rawKey;
		const s = typeof rawKey === 'string' ? rawKey.trim() : rawKey;
		if (this.looksNumberType(typeSpec)) {
			const n = this.parseStrictNumber(s);
			return n == null ? s : n;
		}
		return s;
	}
}

/**
 * 画像処理ユーティリティクラス
 * 画像パスの解決と画像ギャラリーの生成を担当
 */
class ImageProcessor {
	/**
	 * @param {Object} config - 設定オブジェクト
	 */
	constructor(config) {
		this.config = config;
	}

	/**
	 * レコードから画像情報を抽出して処理
	 * @param {Object} record - レコードオブジェクト
	 * @param {string} workId - 作品ID
	 * @param {string} dbName - データベース名
	 * @returns {Object} 画像処理結果
	 */
	imageFromRecord(record, workId, dbName, imagePathHints = null) {
		if (!record || typeof record !== 'object') {
			return { images: [], primaryImage: null };
		}

		const images = [];
		const imageFields = this.findImageFields(record, imagePathHints);

		// 各画像フィールドを処理
		imageFields.forEach(field => {
			const value = this.getNestedValue(record, field.path);
			if (value) {
				const processedImages = this.processImageValue(value, field, workId, dbName);
				images.push(...processedImages);
			}
		});

		// 重複を除去
		const uniqueImages = this.deduplicateImages(images);

		// プライマリ画像を決定
		const primaryImage = this.selectPrimaryImage(uniqueImages, record);

		return {
			images: uniqueImages,
			primaryImage: primaryImage,
			count: uniqueImages.length
		};
	}

	/**
	 * レコード内の画像フィールドを発見
	 * @param {Object} record - レコードオブジェクト
	 * @returns {Array} 画像フィールド情報の配列
	 */
	findImageFields(record, imagePathHints = null) {
		const imageFields = [];

		const findInObject = (obj, path = '') => {
			if (!obj || typeof obj !== 'object') return;

			Object.entries(obj).forEach(([key, value]) => {
				const currentPath = path ? `${path}.${key}` : key;

				// 画像フィールドの判定
				if (this.isImageField(key, value)) {
					imageFields.push({
						path: currentPath,
						key: key,
						type: this.getImageFieldType(key)
					});
				}

				// 再帰的に探索
				if (typeof value === 'object' && !Array.isArray(value)) {
					findInObject(value, currentPath);
				}
			});
		};

		findInObject(record);

		// typedef 駆動のパス指定があれば追加（重複は dedupe 側で落ちる）
		if (Array.isArray(imagePathHints)) {
			for (const h of imagePathHints) {
				if (!h?.path) continue;
				imageFields.push({
					path: h.path,
					key: h.key || String(h.path).split('.').slice(-1)[0],
					type: this.getImageFieldType(h.key || ''),
					folderHint: h.folderHint || null,
				});
			}
		}

		return imageFields;
	}

	/**
	 * 画像フィールドかどうかを判定
	 * @param {string} key - フィールドキー
	 * @param {any} value - フィールド値
	 * @returns {boolean} 画像フィールドの場合はtrue
	 */
	isImageField(key, value) {
		const imageKeywords = [
			'image', 'Image', 'img', 'Img',
			'picture', 'Picture', 'pic', 'Pic',
			'photo', 'Photo', 'avatar', 'Avatar',
			'icon', 'Icon', 'thumbnail', 'Thumbnail'
		];

		const hasImageKeyword = imageKeywords.some(keyword => key.includes(keyword));
		const hasImageValue = typeof value === 'string' && this.looksLikeImagePath(value);

		return hasImageKeyword || hasImageValue;
	}

	/**
	 * 文字列が画像パスに見えるかチェック
	 * @param {string} value - チェック対象の値
	 * @returns {boolean} 画像パスらしい場合はtrue
	 */
	looksLikeImagePath(value) {
		if (typeof value !== 'string') return false;

		const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
		const lowerValue = value.toLowerCase();

		return imageExtensions.some(ext => lowerValue.endsWith(ext)) ||
			lowerValue.includes('/images/') ||
			lowerValue.includes('\\images\\');
	}

	/**
	 * 画像フィールドのタイプを取得
	 * @param {string} key - フィールドキー
	 * @returns {string} 画像タイプ
	 */
	getImageFieldType(key) {
		const lowerKey = key.toLowerCase();

		if (lowerKey.includes('avatar') || lowerKey.includes('profile')) return 'avatar';
		if (lowerKey.includes('icon')) return 'icon';
		if (lowerKey.includes('thumbnail') || lowerKey.includes('thumb')) return 'thumbnail';
		if (lowerKey.includes('concept')) return 'concept';
		if (lowerKey.includes('design')) return 'design';
		if (lowerKey.includes('art')) return 'artwork';

		return 'general';
	}

	/**
	 * 画像値を処理してURL配列に変換
	 * @param {any} value - 画像値
	 * @param {Object} field - フィールド情報
	 * @param {string} workId - 作品ID
	 * @param {string} dbName - データベース名
	 * @returns {Array} 処理された画像情報の配列
	 */
	processImageValue(value, field, workId, dbName) {
		const images = [];

		if (typeof value === 'string') {
			const url = this.resolveImagePath(value, workId, dbName, field);
			if (url) {
				images.push({
					url: url,
					type: field.type,
					field: field.key,
					path: field.path,
					original: value
				});
			}
		} else if (Array.isArray(value)) {
			value.forEach((item, index) => {
				if (typeof item === 'string') {
					const url = this.resolveImagePath(item, workId, dbName, field);
					if (url) {
						images.push({
							url: url,
							type: field.type,
							field: field.key,
							path: `${field.path}[${index}]`,
							original: item
						});
					}
				}
			});
		}

		return images;
	}

	/**
	 * 画像パスを絶対URLに解決
	 *
	 * @description typedef 由来の folderHint（`concept` / `conceptAlt` 等）を一度だけ挟み、
	 * 拡張子が無ければ `.png` を補う。構築は `buildCrossLinkImageAbsolutePath()` に一本化してあり、
	 * `_DBCrossLinkPath` 経由と同じ規則で解決される（かつては別実装で、
	 * 値にスラッシュを含むと folderHint が落ち拡張子も付かなかった）。
	 * @param {string} imagePath - 画像パス（相対パス/ファイル名。拡張子は任意）
	 * @param {string} workId - 作品ID
	 * @param {string} dbName - データベース名
	 * @param {Object|null} [field] - typedef 由来のフィールド情報（`folderHint` を持つ）
	 * @returns {string|null} 解決されたURL
	 */
	resolveImagePath(imagePath, workId, dbName, field = null) {
		if (!imagePath || typeof imagePath !== 'string') return null;

		// 既に完全なURLの場合
		if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
			return imagePath;
		}

		// 絶対パスの場合
		if (imagePath.startsWith('/')) {
			return this.config.withRepoBase(imagePath);
		}

		// 相対パスの場合、作品とDBに基づいて解決
		const workPath = resolveWorkDirName(workId);
		const dbPath = this.mapDbNameToImageDir(dbName);
		const folderHint = field?.folderHint || null;

		return this.config.withRepoBase(
			buildCrossLinkImageAbsolutePath(workPath, dbPath, folderHint, imagePath)
		);
	}

	/**
	 * データベース名を画像ディレクトリにマップ
	 * @param {string} dbName - データベース名
	 * @returns {string} 画像ディレクトリ名
	 */
	mapDbNameToImageDir(dbName) {
		const rawName = String(dbName || '').trim();
		if (!rawName) return 'General';
		if (rawName === 'General') return 'General';
		if (rawName.startsWith('DB_') || rawName.startsWith('Ref_')) return rawName;

		const refMapping = {
			Glossary: 'Ref_Glossary',
			Reference: 'Ref_Reference'
		};
		if (refMapping[rawName]) return refMapping[rawName];

		const dbMapping = {
			Primary: 'DB_Primary',
			Secondary: 'DB_Secondary',
			SemiPrimary: 'DB_SemiPrimary',
			SelfSecondary: 'DB_SelfSecondary',
			UnprocessedSecondary: 'DB_UnprocessedSecondary',
			PrimaryDealer: 'DB_PrimaryDealer',
			PrimaryMobs: 'DB_PrimaryMobs',
			Proxy: 'DB_Proxy',
			Mobs: 'DB_Mobs'
		};
		if (dbMapping[rawName]) return dbMapping[rawName];

		return `DB_${rawName}`;
	}

	/**
	 * 重複する画像を除去
	 * @param {Array} images - 画像配列
	 * @returns {Array} 重複除去後の画像配列
	 */
	deduplicateImages(images) {
		const seen = new Set();
		return images.filter(image => {
			if (seen.has(image.url)) return false;
			seen.add(image.url);
			return true;
		});
	}

	/**
	 * プライマリ画像を選択
	 * @param {Array} images - 画像配列
	 * @param {Object} record - レコードオブジェクト
	 * @returns {Object|null} プライマリ画像
	 */
	selectPrimaryImage(images, record) {
		if (images.length === 0) return null;

		// 優先順位: avatar > icon > concept > design > artwork > thumbnail > general
		const typePriority = ['avatar', 'icon', 'concept', 'design', 'artwork', 'thumbnail', 'general'];

		for (const type of typePriority) {
			const found = images.find(img => img.type === type);
			if (found) return found;
		}

		return images[0]; // フォールバック
	}

	/**
	 * ネストされたオブジェクトから値を取得
	 * @param {Object} obj - 取得元オブジェクト
	 * @param {string} path - パス（ドット区切り）
	 * @returns {any} 取得された値
	 */
	getNestedValue(obj, path) {
		return path.split('.').reduce((current, key) => {
			return current && current[key] !== undefined ? current[key] : undefined;
		}, obj);
	}
}

/**
 * データ正規化ユーティリティクラス
 * データの型変換、検証、正規化を担当
 */
class DataNormalizer {
	/**
	 * レコードデータを正規化
	 * @param {Array} records - 正規化対象レコード配列
	 * @param {Object} typeDefinition - 型定義
	 * @returns {Array} 正規化後のレコード配列
	 */
	static normalizeRecords(records, typeDefinition) {
		if (!Array.isArray(records)) return [];

		return records.map(record => this.normalizeRecord(record, typeDefinition));
	}

	/**
	 * 単一レコードを正規化
	 * @param {Object} record - 正規化対象レコード
	 * @param {Object} typeDefinition - 型定義
	 * @returns {Object} 正規化後のレコード
	 */
	static normalizeRecord(record, typeDefinition) {
		if (!record || typeof record !== 'object') return record;

		const normalized = { ...record };

		if (typeDefinition) {
			Object.entries(typeDefinition).forEach(([field, fieldDef]) => {
				if (normalized[field] !== undefined) {
					normalized[field] = this.normalizeField(normalized[field], fieldDef);
				}
			});
		}

		return normalized;
	}

	/**
	 * フィールド値を正規化
	 * @param {any} value - 正規化対象値
	 * @param {Object} fieldDef - フィールド定義
	 * @returns {any} 正規化後の値
	 */
	static normalizeField(value, fieldDef) {
		if (value == null) return value;

		const type = fieldDef?.type || 'string';

		switch (type) {
			case 'number':
				return this.toNumber(value);
			case 'boolean':
				return this.toBoolean(value);
			case 'array':
				return this.toArray(value);
			case 'string':
				return this.toString(value);
			case 'date':
				return this.toDate(value);
			default:
				return value;
		}
	}

	/**
	 * 数値に変換
	 * @param {any} value - 変換対象値
	 * @returns {number|null} 数値またはnull
	 */
	static toNumber(value) {
		if (typeof value === 'number') return value;
		if (typeof value === 'string') {
			const num = parseFloat(value);
			return isNaN(num) ? null : num;
		}
		return null;
	}

	/**
	 * 真偽値に変換
	 * @param {any} value - 変換対象値
	 * @returns {boolean} 真偽値
	 */
	static toBoolean(value) {
		if (typeof value === 'boolean') return value;
		if (typeof value === 'string') {
			const lower = value.toLowerCase();
			return lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on';
		}
		if (typeof value === 'number') return value !== 0;
		return Boolean(value);
	}

	/**
	 * 配列に変換
	 * @param {any} value - 変換対象値
	 * @returns {Array} 配列
	 */
	static toArray(value) {
		if (Array.isArray(value)) return value;
		if (value == null) return [];
		return [value];
	}

	/**
	 * 文字列に変換
	 * @param {any} value - 変換対象値
	 * @returns {string} 文字列
	 */
	static toString(value) {
		if (typeof value === 'string') return value;
		if (value == null) return '';
		return String(value);
	}

	/**
	 * 日付に変換
	 * @param {any} value - 変換対象値
	 * @returns {Date|null} 日付オブジェクトまたはnull
	 */
	static toDate(value) {
		if (value instanceof Date) return value;
		if (typeof value === 'string' || typeof value === 'number') {
			const date = new Date(value);
			return isNaN(date.getTime()) ? null : date;
		}
		return null;
	}
}

// 環境に応じたエクスポート
if (typeof self !== 'undefined') {
	// Service Worker環境
	self.ReferenceResolver = ReferenceResolver;
	self.EnrichmentProcessor = EnrichmentProcessor;
	self.ImageProcessor = ImageProcessor;
	self.DataNormalizer = DataNormalizer;
	self.TypeDefUtils = TypeDefUtils;
} else if (typeof window !== 'undefined') {
	// ブラウザ環境
	window.ReferenceResolver = ReferenceResolver;
	window.EnrichmentProcessor = EnrichmentProcessor;
	window.ImageProcessor = ImageProcessor;
	window.DataNormalizer = DataNormalizer;
	window.TypeDefUtils = TypeDefUtils;
} else if (typeof globalThis !== 'undefined') {
	// Node/Vitest 等（テスト用）
	globalThis.ReferenceResolver = ReferenceResolver;
	globalThis.EnrichmentProcessor = EnrichmentProcessor;
	globalThis.ImageProcessor = ImageProcessor;
	globalThis.DataNormalizer = DataNormalizer;
	globalThis.TypeDefUtils = TypeDefUtils;
}

console.log('💾 データ処理共通ライブラリがロードされました');
