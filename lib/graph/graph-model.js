/**
 * graph-model.js - キャラクター相関図のグラフモデル構築
 *
 * @description
 * `/pages/v1/bootstrap` の応答（全作品 × 全公開DB のレコード）と typedef から、
 * 相関図の描画に必要なノード・エッジを組み立てる **DOM 非依存の純関数群**。
 *
 * ## 設計の背骨
 *
 * **「どのフィールドが関係を表すか」を field 名のハードコードではなく `db_type.json($DefType)` の
 * 宣言から導く。** 新しい作品が `Relation` を宣言したり、新しい `*_DBLink` を足したら、
 * このファイルを触らずに相関図へ出る状態を保つ。
 *
 * | 検出方法（宣言述語） | エッジ種別 |
 * | --- | --- |
 * | `$display.sectionWrapper === "relationSection"` ＋ `RelationTo_` 接頭辞 | `related` / `commented` |
 * | `$type` に `$Def_DBLinkRef` を含み `$enrich === true` | `sameBeing`（同一存在） |
 * | 同上で `$enrich !== true` | `variant`（別版・派生） |
 * | 配列要素が `_DBLink`（`$Def_DBLinkRef` 形）を持つ構造（`ThisMasters[]` 等） | `master`（主従） |
 *
 * `$enrich` による同一人物／別人物の切り分けは `tools/build-calendar-ics.mjs` の先例に合わせている
 * （`AnotherRegions` / `SameModels` / `ThisArcanaHolder` は同一人物、
 * `AnotherVersions` / `SameMPSeries` / `ArcanaHolding` / `ThisPerformer` は別人物）。
 *
 * ## ノード同一性（実測に基づく重要な決定）
 *
 * ノードキーは **DBスコープ済み `$IndexDef` の全サブキーを、キー名昇順ソートして連結**する。
 *
 * ```
 * nodeKey = `${workId}|${dbName}|` + 全ペアを [キー名昇順] で `k=v` 連結
 *   NumberTales/Primary      → "#Works_NumberTales|Primary|Num=57"
 *   FLInvestigator78/Primary → "#Works_FLInvestigator78|Primary|Num=16,Suit=Major,SuitNum=16"
 * ```
 *
 * 「最初の非空サブキー 1 個」で識別する従来方式（`lib/section-renders/relation.js`）を実データへ
 * 適用すると、UnibyteLive/Primary 35 件のうち 26 件が `AlphaGen=1` に、FLInvestigator78/Primary が
 * `SuitNum` で多重衝突し、**計 5 作品 / 8 DB で破綻する**。全サブキーを使うと公開 1312 件で 100% 一意。
 * ソートが必須なのは `_DBLink` ペイロードのキー順が揺れているため（`Card{Suit,SuitNum}` と
 * `Card{Suit,Num}` が混在）。`JSON.stringify` はキー順が入力順依存なので使わない。
 *
 * ## 参照解決は「部分集合一致」
 *
 * `_DBLink` のペイロードは対象レコードより**少ないキーしか持たないことがある**
 * （例: レコードは `Card{Suit,SuitNum,Num}` だがリンクは `Card{Suit,SuitNum}` のみ）。
 * そのため完全一致ではなく「ペイロードのペアがノードのペアの部分集合か」で照合し、
 * **一意に定まったときだけ**エッジを張る。曖昧・未解決は `diagnostics` へ記録して描画しない。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 */

/**
 * エッジ種別
 * @readonly
 * @enum {string}
 */
export const EDGE_KINDS = Object.freeze({
	/** 親密な関係（`Relation.Related` / `RelationTo_*.Related`）。`RelationLabel` を持つ */
	RELATED: 'related',
	/** 言及・コメント（`Relation.Commented` / `RelationTo_*.Commented`）。UI ではラベルを出さない */
	COMMENTED: 'commented',
	/** 同一存在（`$enrich: true` の `*_DBLink`）。Union-Find で 1 人物に束ねる */
	SAME_BEING: 'sameBeing',
	/** 別版・派生（`$enrich !== true` の `*_DBLink`）。別人物として扱う */
	VARIANT: 'variant',
	/** 主従（`ThisMasters[]._DBLink` など、配列要素に埋まった参照） */
	MASTER: 'master'
});

/** エッジ種別の既定表示名（UI 側で上書き可能） */
export const EDGE_KIND_LABELS = Object.freeze({
	[EDGE_KINDS.RELATED]: { jp: '関係', en: 'Relation' },
	[EDGE_KINDS.COMMENTED]: { jp: '言及・コメント', en: 'Mention' },
	[EDGE_KINDS.SAME_BEING]: { jp: '同一存在', en: 'Same Being' },
	[EDGE_KINDS.VARIANT]: { jp: '別版・派生', en: 'Variant' },
	[EDGE_KINDS.MASTER]: { jp: '主従', en: 'Master' }
});

/** `$Def_DBLinkRef` のセンチネルキー（インデックスキーの判定から除外する） */
const DBLINK_SENTINEL_KEYS = new Set(['_DB', '_Work', 'label_JP', 'label_EN']);

/** ノードキーのセグメント区切り */
const NODE_KEY_SEP = '|';

/** インデックスペアの区切り */
const PAIR_SEP = ',';

/* ========================================================================
   小さなユーティリティ
   ======================================================================== */

/** @param {*} v @returns {boolean} */
function isPlainObject(v) {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * レコードが公開対象か（`isPrivate` でないか）
 *
 * @description `lib/sw-common.js` の `isPublicRecord()` と同じ判定。
 * `/pages/v1/bootstrap` は既に非公開を除外して返すが、**本モジュールはそれに依存しない**。
 * `data/` を直接読む呼び出し元やテストから使われても非公開が漏れないようにするための多重防御。
 * `isPrivate` はレコード自身の宣言だけでなく `_Secondaries[]._Commons.isPrivate` から
 * シリーズ単位で注入されることもある（実データで 1 件該当）。
 * @param {Object} record
 * @returns {boolean}
 */
function isPublicRecord(record) {
	if (!isPlainObject(record)) return true;
	return !(record.isPrivate === true || String(record.isPrivate || '').trim().toLowerCase() === 'true');
}

/**
 * DB カタログエントリが公開対象か（`DB_Hidden` でないか）
 * @param {Object} dbEntry
 * @returns {boolean}
 */
function isPublicDb(dbEntry) {
	return dbEntry?.DB_Hidden !== true;
}

/**
 * 作品が公開対象か（`Works_Hidden` でないか）
 * @param {Object} workEntry - bootstrap の works 要素
 * @returns {boolean}
 */
function isPublicWork(workEntry) {
	return workEntry?.workInfo?.Works_Hidden !== true && workEntry?.Works_Hidden !== true;
}

/**
 * 値が「空」かどうか（インデックス値として使えないか）
 * @param {*} v
 * @returns {boolean}
 */
function isEmptyValue(v) {
	return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/**
 * 作品IDを `#Works_X` 形式へ正規化する
 * @param {string} raw - 'NumberTales' / 'Works_NumberTales' / '#Works_NumberTales'
 * @returns {string} '#Works_NumberTales'（空入力は空文字）
 */
export function normalizeWorkId(raw) {
	const s = String(raw || '').trim();
	if (!s) return '';
	if (s.startsWith('#Works_')) return s;
	if (s.startsWith('Works_')) return `#${s}`;
	return `#Works_${s}`;
}

/**
 * DB名を `$IndexDef_<DbNorm>` 用の表記へ正規化する
 * - メタキーの `#DB_` / `#Ref_` / `#Loc_` 接頭辞を除き、先頭を大文字にする
 * @param {string} dbName
 * @returns {string}
 */
export function normalizeDbSuffix(dbName) {
	const s = String(dbName || '').replace(/^#(DB|Ref|Loc)_/, '').trim();
	if (!s) return '';
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ========================================================================
   $IndexDef の解決とノード同一性
   ======================================================================== */

/**
 * 作品 typedef から、対象DBに適用する `$IndexDef` を解決する
 *
 * @description DB 単位の上書き `$IndexDef_<DbNorm>` があればそれを優先し、無ければ `$IndexDef`。
 * @param {Object} workTypeDef - 作品別 `db_type.json` の全体
 * @param {string} dbName - DB名（'Primary' / 'PrimaryMobs' 等）
 * @returns {Object|null} `$IndexDef` エントリ（`{hashTag, $type}`）
 */
export function resolveIndexDef(workTypeDef, dbName) {
	if (!isPlainObject(workTypeDef)) return null;
	const suffix = normalizeDbSuffix(dbName);
	const scoped = suffix ? workTypeDef[`$IndexDef_${suffix}`] : null;
	const def = isPlainObject(scoped) ? scoped : workTypeDef.$IndexDef;
	return isPlainObject(def) && def.hashTag ? def : null;
}

/**
 * `$IndexDef` が複合（オブジェクト型）ならサブキー名の配列を返す
 * @param {Object|null} indexDef
 * @returns {string[]|null} 複合ならサブキー名の配列、スカラーなら null
 */
export function getIndexSubKeys(indexDef) {
	const t = indexDef?.$type;
	if (!Array.isArray(t)) return null;
	const keys = t.map(e => e?.hashTag).filter(k => typeof k === 'string' && k);
	return keys.length > 0 ? keys : null;
}

/**
 * インデックスのペア集合を正規形の文字列へ落とす
 *
 * @description **キー名昇順ソート**が本体。`_DBLink` ペイロードのキー順が揺れているため、
 * 入力順に依存する `JSON.stringify` では同じレコードが別キーになってしまう。
 * @param {Object} pairs - `{ Suit: 'Major', SuitNum: 16 }`
 * @returns {string} `'Suit=Major,SuitNum=16'`
 */
export function serializeIndexPairs(pairs) {
	if (!isPlainObject(pairs)) return '';
	return Object.keys(pairs)
		.sort()
		.map(k => `${k}=${String(pairs[k])}`)
		.join(PAIR_SEP);
}

/**
 * ノードキーを組み立てる
 * @param {string} workId - '#Works_NumberTales'
 * @param {string} dbName - 'Primary'
 * @param {Object} pairs - インデックスのペア集合
 * @returns {string}
 */
export function buildNodeKey(workId, dbName, pairs) {
	return [normalizeWorkId(workId), String(dbName || ''), serializeIndexPairs(pairs)].join(NODE_KEY_SEP);
}

/**
 * レコード（またはリンクペイロード）からインデックスのペア集合を取り出す
 *
 * @description
 * - スカラー Index（`Num`）: `{ Num: 値 }`
 * - 複合 Index（`Card{Suit,SuitNum,Num}`）: root 配下のサブキーを展開して `{ Suit, SuitNum, Num }`
 * - root を省いた形（`{ Suit: 'Major', SuitNum: 16 }`）も受理する。
 *   `_DBLink` ペイロードや Relation エントリは root 付きだが、
 *   将来 root 省略形が来ても壊れないようフォールバックを持つ
 * - 空値（null / undefined / 空文字）のサブキーは**含めない**。
 *   リンクペイロードが一部キーしか持たないケースを部分集合一致で扱うため
 *
 * @param {Object} source - レコード or `_DBLink` ペイロード or Relation エントリ
 * @param {Object|null} indexDef - 対象DBの `$IndexDef`
 * @returns {Object|null} ペア集合（取り出せなければ null）
 */
export function extractIndexPairs(source, indexDef) {
	if (!isPlainObject(source) || !isPlainObject(indexDef)) return null;
	const root = indexDef.hashTag;
	if (!root) return null;

	const subKeys = getIndexSubKeys(indexDef);

	// スカラー Index
	if (!subKeys) {
		const v = source[root];
		if (isEmptyValue(v)) return null;
		return { [root]: String(v) };
	}

	// 複合 Index: root 配下を見る。無ければ source 自身を root 相当とみなす（root 省略形）
	const container = isPlainObject(source[root]) ? source[root] : source;
	const pairs = {};
	for (const k of subKeys) {
		const v = container[k];
		if (isEmptyValue(v)) continue;
		// サブキーの値がさらにオブジェクト/配列の場合は識別子として使えないので落とす
		if (typeof v === 'object') continue;
		pairs[k] = String(v);
	}
	return Object.keys(pairs).length > 0 ? pairs : null;
}

/**
 * `_DBLink` ペイロード（`$Def_DBLinkRef`）から、インデックス部分だけを取り出す
 *
 * @description センチネルキー（`_DB` / `_Work` / `label_JP` / `label_EN`）を除いた残りが
 * インデックス指定。root 付き（`{ Card: {...} }`）とフラット（`{ Num: '57' }`）の双方を扱う。
 * @param {Object} entry - `$Def_DBLinkRef` エントリ
 * @param {Object|null} indexDef - 参照先DBの `$IndexDef`
 * @returns {Object|null} ペア集合
 */
export function extractDbLinkPairs(entry, indexDef) {
	if (!isPlainObject(entry)) return null;
	const stripped = {};
	for (const [k, v] of Object.entries(entry)) {
		if (DBLINK_SENTINEL_KEYS.has(k)) continue;
		stripped[k] = v;
	}
	if (Object.keys(stripped).length === 0) return null;
	const viaIndexDef = extractIndexPairs(stripped, indexDef);
	if (viaIndexDef) return viaIndexDef;

	// `$IndexDef` で解釈できない形（参照先 typedef 未取得など）は、
	// スカラー値のキーをそのままペアとして扱うフォールバック
	const fallback = {};
	for (const [k, v] of Object.entries(stripped)) {
		if (isPlainObject(v)) {
			for (const [k2, v2] of Object.entries(v)) {
				if (!isEmptyValue(v2) && typeof v2 !== 'object') fallback[k2] = String(v2);
			}
			continue;
		}
		if (!isEmptyValue(v) && typeof v !== 'object') fallback[k] = String(v);
	}
	return Object.keys(fallback).length > 0 ? fallback : null;
}

/**
 * ペア集合 a がペア集合 b の部分集合か（同じキーは同じ値か）
 * @param {Object} subset
 * @param {Object} superset
 * @returns {boolean}
 */
export function isPairsSubset(subset, superset) {
	if (!isPlainObject(subset) || !isPlainObject(superset)) return false;
	for (const [k, v] of Object.entries(subset)) {
		if (String(superset[k]) !== String(v)) return false;
	}
	return true;
}

/* ========================================================================
   typedef からのフィールド分類（スキーマ駆動）
   ======================================================================== */

/**
 * `$DefType` エントリ配列を取り出す（`$slot` マーカーは除外）
 * @param {Object|Array} typeDefSource - `db_type.json` 全体 or `$DefType` 配列
 * @returns {Array<Object>}
 */
function toDefTypeEntries(typeDefSource) {
	const arr = Array.isArray(typeDefSource)
		? typeDefSource
		: (Array.isArray(typeDefSource?.$DefType) ? typeDefSource.$DefType : []);
	return arr.filter(e => isPlainObject(e) && typeof e.hashTag === 'string' && e.hashTag);
}

/**
 * `$type` のツリーに指定トークンが含まれるか（文字列ユニオン・インライン構造体の双方を辿る）
 * @param {*} t @param {string} needle @param {number} [depth=0]
 * @returns {boolean}
 */
function typeIncludes(t, needle, depth = 0) {
	if (!needle || depth > 6 || t === null || t === undefined) return false;
	if (typeof t === 'string') return t.includes(needle);
	if (Array.isArray(t)) return t.some(e => typeIncludes(e, needle, depth + 1));
	if (typeof t === 'object') {
		if (Object.prototype.hasOwnProperty.call(t, '$type')) return typeIncludes(t.$type, needle, depth + 1);
		return Object.values(t).some(e => typeIncludes(e, needle, depth + 1));
	}
	return false;
}

/**
 * グローバル＋作品別の `$DefType` から、関係を表すフィールドを分類する
 *
 * @description **field 名をハードコードしない。** 宣言述語だけで判定する:
 * - Relation 系: `$display.sectionWrapper === 'relationSection'`（4 作品すべてが宣言済み）
 *   または `RelationTo_` 接頭辞（suffix 自動ディスパッチと同じ規則）
 * - `*_DBLink` 系: `$type` に `$Def_DBLinkRef` を含む。`$enrich === true` なら同一存在
 *
 * @param {Object|Array} globalTypeDef - グローバル `db_type.json`
 * @param {Object|Array} workTypeDef - 作品別 `db_type.json`
 * @returns {{relation: Map<string,Object>, sameBeing: Set<string>, variant: Set<string>}}
 */
export function classifyRelationFields(globalTypeDef, workTypeDef) {
	const relation = new Map();
	const sameBeing = new Set();
	const variant = new Set();

	const entries = [...toDefTypeEntries(globalTypeDef), ...toDefTypeEntries(workTypeDef)];
	for (const e of entries) {
		const key = e.hashTag;

		const isRelation = e?.$display?.sectionWrapper === 'relationSection' || /^RelationTo_/.test(key);
		if (isRelation) {
			const m = /^RelationTo_(.+)$/.exec(key);
			relation.set(key, {
				key,
				targetDb: m ? m[1] : null, // null = 同一DB
				label_JP: e.hashTag_JP || e.hashtag_JP || key,
				label_EN: e.hashTag_EN || key
			});
			continue;
		}

		if (typeIncludes(e.$type, '$Def_DBLinkRef')) {
			if (e.$enrich === true) sameBeing.add(key);
			else variant.add(key);
		}
	}
	return { relation, sameBeing, variant };
}

/* ========================================================================
   表示名
   ======================================================================== */

/** JP 優先の表示名候補 */
const NAME_ORDER_JP = ['Name_JP', 'FormalName_JP', 'ModelName_JP', 'Title_JP', 'Term_JP', 'Name', 'FormalName', 'ModelName', 'Name_EN', 'FormalName_EN', 'ModelName_EN', 'Title_EN', 'Term_EN'];
/** EN 優先の表示名候補 */
const NAME_ORDER_EN = ['Name_EN', 'FormalName_EN', 'ModelName_EN', 'Title_EN', 'Term_EN', 'Name', 'FormalName', 'ModelName', 'Name_JP', 'FormalName_JP', 'ModelName_JP', 'Title_JP', 'Term_JP'];

/**
 * レコードから表示名を選ぶ
 *
 * @description `lib/section-renders/relation.js` の `pickRelationRecordName()` と同じ候補順。
 * 相関図はグラフ全体を一度に描くため、そちらの IIFE 内プライベート実装を参照できず同順を再掲する。
 * @param {Object} record
 * @param {string} [lang='jp'] - 'jp' | 'en' | 'mix'
 * @returns {string}
 */
export function pickRecordName(record, lang = 'jp') {
	if (!isPlainObject(record)) return '';
	const order = String(lang).toLowerCase() === 'en' ? NAME_ORDER_EN : NAME_ORDER_JP;
	for (const k of order) {
		const v = record[k];
		if (typeof v === 'string' && v.trim()) return v.trim();
	}
	return '';
}

/* ========================================================================
   Union-Find（同一人物の集約）
   ======================================================================== */

/**
 * 素朴な Union-Find（経路圧縮つき）
 * @returns {{find: (x: string) => string, union: (a: string, b: string) => void, groups: () => Map<string, string[]>}}
 */
export function createUnionFind() {
	/** @type {Map<string,string>} */
	const parent = new Map();

	const find = (x) => {
		if (!parent.has(x)) { parent.set(x, x); return x; }
		let root = x;
		while (parent.get(root) !== root) root = parent.get(root);
		// 経路圧縮
		let cur = x;
		while (parent.get(cur) !== root) {
			const next = parent.get(cur);
			parent.set(cur, root);
			cur = next;
		}
		return root;
	};

	const union = (a, b) => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent.set(ra, rb);
	};

	const groups = () => {
		/** @type {Map<string,string[]>} */
		const out = new Map();
		for (const key of parent.keys()) {
			const root = find(key);
			if (!out.has(root)) out.set(root, []);
			out.get(root).push(key);
		}
		return out;
	};

	return { find, union, groups };
}

/* ========================================================================
   グラフ構築
   ======================================================================== */

/**
 * 無向エッジの正規キー（`a|b` を辞書順で固定し、相互参照を畳めるようにする）
 * @param {string} a @param {string} b @param {string} kind
 * @returns {{id: string, source: string, target: string, flipped: boolean}}
 */
function normalizeEdgeEnds(a, b, kind) {
	const flipped = a > b;
	const source = flipped ? b : a;
	const target = flipped ? a : b;
	return { id: `${kind}::${source}::${target}`, source, target, flipped };
}

/**
 * bootstrap 応答と typedef からグラフを構築する
 *
 * @param {Object} input
 * @param {Array<Object>} input.works - bootstrap の `works` 配列
 *   （各要素 `{ work, workInfo, databases[], data: { [dbKey]: records[] } }`）
 * @param {Object|Array} input.globalTypeDef - グローバル `db_type.json`
 * @param {Object<string,Object>} input.workTypeDefs - `{ '#Works_X': 作品別 db_type.json }`
 * @param {Object} [input.options]
 * @param {string} [input.options.lang='jp'] - ノードラベルの言語
 * @param {(workId: string, dbName: string, dbEntry: Object) => boolean} [input.options.dbFilter]
 *   - 採用するDBを選ぶ述語（二次創作の除外などに使う）
 * @returns {{nodes: Array, edges: Array, sameBeingGroups: Map, diagnostics: Object, stats: Object}}
 */
export function buildGraph(input = {}) {
	const works = Array.isArray(input.works) ? input.works : [];
	const globalTypeDef = input.globalTypeDef || {};
	const workTypeDefs = isPlainObject(input.workTypeDefs) ? input.workTypeDefs : {};
	const options = isPlainObject(input.options) ? input.options : {};
	const lang = options.lang || 'jp';
	const dbFilter = typeof options.dbFilter === 'function' ? options.dbFilter : null;

	/** @type {Map<string,Object>} nodeKey -> node */
	const nodes = new Map();
	/** ノード検索用: `${workId}|${dbName}` -> node[] */
	const nodesByDb = new Map();
	/** 作品ごとの分類キャッシュ */
	const classifyCache = new Map();
	/** `${workId}|${dbName}` -> indexDef */
	const indexDefCache = new Map();

	const diagnostics = {
		/** インデックスを取り出せずノード化できなかったレコード（キャラDB内の個別の取りこぼし） */
		unindexedRecords: [],
		/** レコードは在るのに 1 件もノード化できなかったDB（資料系DBなど、キャラDBでないとみなす） */
		skippedDbs: [],
		/** ノードキーが衝突したレコード（先勝ちで残し、2 件目以降をここへ） */
		duplicatedNodes: [],
		/** 参照先が見つからなかったリンク */
		unresolvedLinks: [],
		/** 参照先が複数一致して確定できなかったリンク */
		ambiguousLinks: [],
		/** 非公開として除外した件数（多重防御。通常は SW 側で除外済みなので 0） */
		excluded: { privateRecords: 0, hiddenDbs: 0, hiddenWorks: 0 }
	};

	const getIndexDefFor = (workId, dbName) => {
		const k = `${workId}|${dbName}`;
		if (indexDefCache.has(k)) return indexDefCache.get(k);
		const def = resolveIndexDef(workTypeDefs[workId], dbName);
		indexDefCache.set(k, def);
		return def;
	};

	const getClassifyFor = (workId) => {
		if (classifyCache.has(workId)) return classifyCache.get(workId);
		const c = classifyRelationFields(globalTypeDef, workTypeDefs[workId]);
		classifyCache.set(workId, c);
		return c;
	};

	// ---- 1) ノードを作る -------------------------------------------------
	for (const w of works) {
		const workId = normalizeWorkId(w?.work);
		if (!workId) continue;
		// `Works_Hidden` の作品はまるごと出さない（多重防御）
		if (!isPublicWork(w)) { diagnostics.excluded.hiddenWorks += 1; continue; }
		const dbEntries = Array.isArray(w?.databases) ? w.databases : [];
		const dbEntryByKey = new Map(dbEntries.map(d => [d?.key, d]));
		const data = isPlainObject(w?.data) ? w.data : {};

		for (const [dbName, records] of Object.entries(data)) {
			if (!Array.isArray(records)) continue;
			const dbEntry = dbEntryByKey.get(dbName) || { key: dbName };
			// `DB_Hidden` のDBはまるごと出さない（多重防御）
			if (!isPublicDb(dbEntry)) { diagnostics.excluded.hiddenDbs += 1; continue; }
			if (dbFilter && !dbFilter(workId, dbName, dbEntry)) continue;

			const indexDef = getIndexDefFor(workId, dbName);
			const bucketKey = `${workId}|${dbName}`;
			if (!nodesByDb.has(bucketKey)) nodesByDb.set(bucketKey, []);
			const bucket = nodesByDb.get(bucketKey);

			// このDBでの取りこぼしを一旦ためる。1 件もノード化できなければ
			// 「キャラDBではない（資料系など）」とみなして skippedDbs へまとめ、
			// 個別のノイズとして出さない
			const localUnindexed = [];
			let addedInDb = 0;
			// 非公開を除いた「検討対象」の件数。全件が非公開だったDBを
			// 「キャラDBではない」と誤判定しないために分けて数える
			let consideredInDb = 0;

			for (const rec of records) {
				if (!isPlainObject(rec)) continue;
				// 非公開レコードはノードにしない（多重防御）。
				// エッジの参照先にもならないので、非公開キャラへ伸びるリンクは
				// 「参照先が見つからない」として diagnostics へ落ちる
				if (!isPublicRecord(rec)) { diagnostics.excluded.privateRecords += 1; continue; }
				consideredInDb += 1;
				const pairs = extractIndexPairs(rec, indexDef);
				if (!pairs) {
					localUnindexed.push({ workId, dbName, name: pickRecordName(rec, lang) });
					continue;
				}
				const key = buildNodeKey(workId, dbName, pairs);
				if (nodes.has(key)) {
					// 一意性が崩れた場合は診断へ回し、先勝ちで残す（描画は継続する）
					diagnostics.duplicatedNodes.push({
						workId, dbName, name: pickRecordName(rec, lang), key
					});
					continue;
				}
				const node = {
					key,
					workId,
					dbName,
					dbLabel_JP: dbEntry.DB_Label_JP || dbEntry.DB_Label || dbName,
					dbLabel_EN: dbEntry.DB_Label_EN || dbName,
					pairs,
					indexText: serializeIndexPairs(pairs),
					name_JP: pickRecordName(rec, 'jp'),
					name_EN: pickRecordName(rec, 'en'),
					record: rec
				};
				nodes.set(key, node);
				bucket.push(node);
				addedInDb += 1;
			}

			if (addedInDb === 0 && consideredInDb > 0) {
				diagnostics.skippedDbs.push({ workId, dbName, recordCount: consideredInDb, layer: dbEntry.layer || '' });
				nodesByDb.delete(bucketKey);
			} else if (addedInDb === 0) {
				// 公開レコードが 1 件も無かっただけ（全件が非公開）。キャラDBでないとは判断しない
				nodesByDb.delete(bucketKey);
			} else {
				diagnostics.unindexedRecords.push(...localUnindexed);
			}
		}
	}

	// ---- 2) 参照解決のヘルパー ------------------------------------------
	/**
	 * ペア集合から対象ノードを一意に引く（部分集合一致）
	 * @param {string} workId @param {string} dbName @param {Object} pairs
	 * @returns {{node: Object|null, reason: ''|'notFound'|'ambiguous'}}
	 */
	const findNode = (workId, dbName, pairs) => {
		const bucket = nodesByDb.get(`${workId}|${dbName}`);
		if (!bucket || !pairs) return { node: null, reason: 'notFound' };

		// 完全一致を先に試す（最も安全）
		const exactKey = buildNodeKey(workId, dbName, pairs);
		const exact = nodes.get(exactKey);
		if (exact) return { node: exact, reason: '' };

		// 部分集合一致（ペイロードが一部キーしか持たない場合）
		const hits = bucket.filter(n => isPairsSubset(pairs, n.pairs));
		if (hits.length === 1) return { node: hits[0], reason: '' };
		if (hits.length > 1) return { node: null, reason: 'ambiguous' };
		return { node: null, reason: 'notFound' };
	};

	/** 有向エッジの生の集合（この後で相互参照を畳む） */
	const directed = [];

	/**
	 * 有向エッジを 1 本積む
	 * @param {Object} from @param {string} kind @param {Object} to @param {Object} [meta]
	 */
	const pushEdge = (from, kind, to, meta = {}) => {
		if (!from || !to || from.key === to.key) return;
		directed.push({ from: from.key, to: to.key, kind, meta });
	};

	/**
	 * リンク参照を解決してエッジを積む（失敗時は診断へ）
	 * @param {Object} node - 参照元ノード
	 * @param {string} field - フィールド名
	 * @param {Object} entry - `$Def_DBLinkRef` エントリ
	 * @param {string} kind - エッジ種別
	 */
	const resolveAndPush = (node, field, entry, kind) => {
		if (!isPlainObject(entry)) return;
		const targetWork = entry._Work ? normalizeWorkId(entry._Work) : node.workId;
		const targetDb = entry._DB ? String(entry._DB) : node.dbName;
		const targetIndexDef = getIndexDefFor(targetWork, targetDb);
		const pairs = extractDbLinkPairs(entry, targetIndexDef);
		if (!pairs) {
			diagnostics.unresolvedLinks.push({ from: node.key, field, entry, reason: 'noIndex' });
			return;
		}
		const { node: target, reason } = findNode(targetWork, targetDb, pairs);
		if (!target) {
			const bucket = reason === 'ambiguous' ? diagnostics.ambiguousLinks : diagnostics.unresolvedLinks;
			bucket.push({ from: node.key, field, targetWork, targetDb, pairs, reason });
			return;
		}
		pushEdge(node, kind, target, { field });
	};

	// ---- 3) エッジを集める ----------------------------------------------
	for (const node of nodes.values()) {
		const { relation, sameBeing, variant } = getClassifyFor(node.workId);
		const rec = node.record;

		// 3-1) Relation / RelationTo_*
		for (const [field, def] of relation) {
			const container = rec[field];
			if (!isPlainObject(container)) continue;
			const targetDb = def.targetDb || node.dbName;
			const targetIndexDef = getIndexDefFor(node.workId, targetDb);

			for (const [bucketKey, kind] of [['Related', EDGE_KINDS.RELATED], ['Commented', EDGE_KINDS.COMMENTED]]) {
				const list = container[bucketKey];
				if (!Array.isArray(list)) continue;
				for (const item of list) {
					if (!isPlainObject(item)) continue;
					const pairs = extractIndexPairs(item, targetIndexDef);
					if (!pairs) {
						diagnostics.unresolvedLinks.push({ from: node.key, field, entry: item, reason: 'noIndex' });
						continue;
					}
					const { node: target, reason } = findNode(node.workId, targetDb, pairs);
					if (!target) {
						const dst = reason === 'ambiguous' ? diagnostics.ambiguousLinks : diagnostics.unresolvedLinks;
						dst.push({ from: node.key, field, targetWork: node.workId, targetDb, pairs, reason });
						continue;
					}
					// `Reply` はスキーマ上 `$Def_Relations[]` だが実データは単一オブジェクト。両対応する
					const replyRaw = item.Reply;
					const reply = Array.isArray(replyRaw) ? (replyRaw[0] || null) : (isPlainObject(replyRaw) ? replyRaw : null);
					pushEdge(node, kind, target, {
						field,
						labels: Array.isArray(item.RelationLabel) ? item.RelationLabel : [],
						comment_JP: typeof item.Comments === 'string' ? item.Comments : '',
						comment_EN: typeof item.Comments_EN === 'string' ? item.Comments_EN : '',
						reply: reply
							? {
								labels: Array.isArray(reply.RelationLabel) ? reply.RelationLabel : [],
								comment_JP: typeof reply.Comments === 'string' ? reply.Comments : '',
								comment_EN: typeof reply.Comments_EN === 'string' ? reply.Comments_EN : ''
							}
							: null
					});
				}
			}
		}

		// 3-2) `*_DBLink`（同一存在 / 別版）
		for (const [fieldSet, kind] of [[sameBeing, EDGE_KINDS.SAME_BEING], [variant, EDGE_KINDS.VARIANT]]) {
			for (const field of fieldSet) {
				const raw = rec[field];
				if (!raw) continue;
				const list = Array.isArray(raw) ? raw : [raw];
				for (const entry of list) resolveAndPush(node, field, entry, kind);
			}
		}

		// 3-3) 配列要素に埋まった `_DBLink`（`ThisMasters[]` など）
		//      field 名で決め打ちせず「配列の要素が `_DBLink` を持っているか」で構造的に拾う
		for (const [field, raw] of Object.entries(rec)) {
			if (!Array.isArray(raw) || relation.has(field) || sameBeing.has(field) || variant.has(field)) continue;
			for (const item of raw) {
				if (!isPlainObject(item) || !isPlainObject(item._DBLink)) continue;
				resolveAndPush(node, `${field}._DBLink`, item._DBLink, EDGE_KINDS.MASTER);
			}
		}
	}

	// ---- 4) 相互参照を畳む ----------------------------------------------
	// 有向 a→b と b→a（同一種別）を 1 本の無向エッジへまとめる。
	// 畳まないとエッジ数が水増しされ、力学レイアウトが二重線で歪む。
	/** @type {Map<string,Object>} */
	const edgeMap = new Map();
	for (const d of directed) {
		const { id, source, target, flipped } = normalizeEdgeEnds(d.from, d.to, d.kind);
		if (!edgeMap.has(id)) {
			edgeMap.set(id, {
				id, source, target, kind: d.kind,
				aToB: false, bToA: false,
				metaAToB: null, metaBToA: null
			});
		}
		const e = edgeMap.get(id);
		// source→target 方向を aToB とする
		if (flipped) { e.bToA = true; e.metaBToA = d.meta; }
		else { e.aToB = true; e.metaAToB = d.meta; }
	}
	const edges = [...edgeMap.values()].map(e => ({
		...e,
		direction: (e.aToB && e.bToA) ? 'mutual' : (e.aToB ? 'aToB' : 'bToA')
	}));

	// ---- 5) 同一人物の Union-Find ---------------------------------------
	const uf = createUnionFind();
	for (const e of edges) {
		if (e.kind !== EDGE_KINDS.SAME_BEING) continue;
		uf.union(e.source, e.target);
	}
	const sameBeingGroups = uf.groups();

	// ---- 6) 統計 ---------------------------------------------------------
	const degree = new Map();
	for (const e of edges) {
		degree.set(e.source, (degree.get(e.source) || 0) + 1);
		degree.set(e.target, (degree.get(e.target) || 0) + 1);
	}
	for (const n of nodes.values()) n.degree = degree.get(n.key) || 0;

	const byKind = {};
	for (const k of Object.values(EDGE_KINDS)) byKind[k] = 0;
	for (const e of edges) byKind[e.kind] = (byKind[e.kind] || 0) + 1;

	const stats = {
		nodeCount: nodes.size,
		edgeCount: edges.length,
		directedCount: directed.length,
		mutualCount: edges.filter(e => e.direction === 'mutual').length,
		isolatedCount: [...nodes.values()].filter(n => n.degree === 0).length,
		edgesByKind: byKind,
		unresolvedCount: diagnostics.unresolvedLinks.length,
		ambiguousCount: diagnostics.ambiguousLinks.length
	};

	return { nodes: [...nodes.values()], edges, sameBeingGroups, diagnostics, stats };
}

/**
 * 作品内エッジの密度（ノード 1 件あたりの作品内エッジ数）を作品ごとに算出する
 *
 * @description 密度が低い作品は `Relation` ベースの相関図が成立しない
 * （実測で 9 作品中 5 作品は作品内エッジ 0 本）。UI はこの値を見て
 * 「グルーピング軸を中間ノード化した 2 部グラフ」へ自動フォールバックする。
 * @param {Array<Object>} nodes
 * @param {Array<Object>} edges
 * @returns {Map<string,{nodes: number, intraEdges: number, density: number}>}
 */
export function computeWorkDensity(nodes, edges) {
	const nodeWork = new Map(nodes.map(n => [n.key, n.workId]));
	/** @type {Map<string,{nodes:number,intraEdges:number,density:number}>} */
	const out = new Map();
	for (const n of nodes) {
		if (!out.has(n.workId)) out.set(n.workId, { nodes: 0, intraEdges: 0, density: 0 });
		out.get(n.workId).nodes += 1;
	}
	for (const e of edges) {
		const a = nodeWork.get(e.source);
		const b = nodeWork.get(e.target);
		if (a && a === b && out.has(a)) out.get(a).intraEdges += 1;
	}
	for (const v of out.values()) v.density = v.nodes > 0 ? v.intraEdges / v.nodes : 0;
	return out;
}
