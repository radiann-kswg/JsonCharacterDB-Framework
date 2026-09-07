/**
 * viewer-locator.js - ビューア直リンク（圧縮ロケータ）の URL 文法
 *
 * @description
 * ビューアの直リンクは「圧縮ロケータ」1本を正とする:
 *   characters.html?c=NumberTales/Primary/57
 *   characters.html?c=FLInvestigator78/Primary/Card.Num:7
 *   characters.html?c=FLInvestigator78/Primary/Card.Suit:Major,Card.SuitNum:16
 *   characters.html?c=NumberTales/Primary&q=狐
 *
 *   c = <Work>[/<Db>[/<IdxToken>]]
 *   IdxToken = <値> | <条件>[,<条件>]*      条件 = <キーパス>:<値>
 *
 * 複合Index（オブジェクト型 `$IndexDef`）は、単一サブフィールドでは別レコードと衝突し得るため、
 * カテゴリキー（`#IndexListKey`）＋一意になるまでの要素をカンマ区切りで並べる。
 *
 * 旧形式（`work` / `db` / `idx` / `idxKey` / `num` の個別キー、`Works_` 接頭辞付きの作品ID）は
 * **読み取りのみ**互換維持する。生成側は圧縮ロケータのみを出す。
 *
 * ここは `pages/characters.html`（キャラシート）と `pages/relations.html`（相関図）の双方が使う。
 * URL 文法の実装をページごとに書き分けると直リンクの解釈がずれるため、
 * `AGENTS.md` の定めどおり本モジュールへ集約する（各所で `new URLSearchParams({...})` を組み立て直さないこと）。
 *
 * すべて DOM / `location` / `localStorage` に依存しない純関数。現在のクエリを読み書きする
 * `getQS()` / `setQS()` / `buildViewerHref()` は `location` と `history` に依存するため、
 * 各ページ側に残す。
 *
 * 本モジュールは ES モジュール。**Service Worker の `importScripts()` へは追加しないこと**
 * （`importScripts` は classic script しか読めず、`export` 構文は SyntaxError になり SW 全体の
 * 評価が失敗する。`tests/sw.importscripts-scope.test.js` を参照）。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 */

/** 圧縮ロケータのクエリキー */
export const VIEWER_LOCATOR_PARAM = 'c';

/**
 * 短縮ロケータ（インデックスバッジ直リンク）のクエリキー
 *   characters.html?b=NTS-57
 *   characters.html?b=FLI-M16/PrimaryDealer
 *
 *   b = <Works_Code>-<Badge>[/<Db>]
 *
 * バッジは相関図と同じ `Works_Code` + `$IndexDef.$badge` 宣言（`lib/graph/graph-badge.js`）で
 * 組み立てる。DB 省略時の解決は DB カタログ順で最初に一致した DB。読み取り側は圧縮ロケータへ
 * 解決してから通常経路へ合流するため、表示後の URL は `c` 形式へ書き換わる。
 */
export const SHORT_LOCATOR_PARAM = 'b';

/**
 * インデックスのキーパスとして解釈できる文字列（`Num` / `Card.Num` / `BeastType.Beast` など）。
 * IdxToken のコロン分割は、左辺がこの形のときだけキーとみなす。
 * （インデックス値そのものが `Ident:...` の形をしていると誤判定し得るが、実データ上は発生しない）
 */
export const INDEX_KEY_PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * 複合インデックス（`Card.Suit:Major,Card.SuitNum:16`）の条件区切り文字。
 * `,` はクエリ内では正当な文字（RFC 3986 の sub-delims）なので、生成時に %2C を復元して可読性を保つ。
 */
export const INDEX_CONDITION_SEPARATOR = ',';

/** 複合条件であることを示す idxKey の予約語（`_DBLink` の JSON ペイロードと共用） */
export const INDEX_CONDITIONS_KEY = '__conditions__';

/**
 * プレーンオブジェクト判定
 * - `pages/characters.js` にも同名の helper があるが、本モジュールを DOM 非依存の
 *   単独モジュールとして保つためローカルに持つ（3 行のため共有化の利得が無い）
 * @param {any} value
 * @returns {boolean}
 */
function isPlainObject(value) {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 作品IDを URL 表記（接頭辞なし）へ短縮する
 * @param {string} workKey - '#Works_NumberTales' / 'Works_NumberTales' / 'NumberTales'
 * @returns {string} 'NumberTales'
 */
export function workKeyForURL(workKey) {
	const raw = String(workKey || '').trim();
	if (!raw) return '';
	return raw.replace(/^#/, '').replace(/^Works_/, '');
}

/**
 * ドット区切りキーパスの位置へ値を代入する（`Card.SuitNum` → `{ Card: { SuitNum: 値 } }`）
 * @param {Object} target - 代入先オブジェクト（破壊的に更新）
 * @param {string} keyPath - `<root>` / `<root>.<child>` 形式のキーパス
 * @param {string} value - 代入する値
 * @returns {boolean} 代入できたか
 */
export function assignByKeyPath(target, keyPath, value) {
	const parts = String(keyPath || '').split('.').filter(Boolean);
	if (!parts.length || !target || typeof target !== 'object') return false;

	let cursor = target;
	for (let i = 0; i < parts.length; i += 1) {
		const part = parts[i];
		if (i === parts.length - 1) {
			cursor[part] = value;
		} else {
			if (!isPlainObject(cursor[part])) cursor[part] = {};
			cursor = cursor[part];
		}
	}
	return true;
}

/**
 * 複合インデックストークン（`Card.Suit:Major,Card.SuitNum:16`）を条件オブジェクトへ変換する
 *
 * すべてのパートが `キーパス:値` 形式のときだけ複合として扱う。
 * こうしないと、値そのものにカンマを含む単一インデックス（例: `Name:9,10`）を壊してしまう。
 *
 * @param {string} token - IdxToken 文字列
 * @returns {Object|null} ネストした条件オブジェクト（複合でなければ null）
 */
export function parseIndexConditionToken(token) {
	const raw = String(token || '').trim();
	if (!raw || raw[0] === '{' || !raw.includes(INDEX_CONDITION_SEPARATOR)) return null;

	const conditions = {};
	for (const part of raw.split(INDEX_CONDITION_SEPARATOR)) {
		const piece = part.trim();
		const sep = piece.indexOf(':');
		if (sep <= 0) return null;
		const keyPath = piece.slice(0, sep).trim();
		const value = piece.slice(sep + 1).trim();
		if (!value || !INDEX_KEY_PATH_RE.test(keyPath)) return null;
		if (!assignByKeyPath(conditions, keyPath, value)) return null;
	}
	return Object.keys(conditions).length > 0 ? conditions : null;
}

/**
 * 条件オブジェクトを `キーパス:値` の組へ平坦化する（複合トークン生成用）
 *
 * URL のトークンとして往復できない値（配列・区切り文字を含む文字列・空値）が
 * 1 つでも混ざっていたら null を返し、呼び出し側で旧形式（JSON ペイロード）へ退避させる。
 *
 * @param {Object} conditions - ネストした条件オブジェクト
 * @param {string} [prefix=''] - キーパスの接頭辞（再帰用）
 * @returns {Array<{keyPath: string, value: string}>|null}
 */
export function flattenIndexConditions(conditions, prefix = '') {
	if (!isPlainObject(conditions)) return null;

	const out = [];
	for (const [key, raw] of Object.entries(conditions)) {
		if (!INDEX_KEY_PATH_RE.test(key)) return null;
		const keyPath = prefix ? `${prefix}.${key}` : key;

		if (isPlainObject(raw)) {
			const nested = flattenIndexConditions(raw, keyPath);
			if (!nested) return null;
			out.push(...nested);
			continue;
		}
		if (raw === null || raw === undefined || typeof raw === 'object') return null;

		const value = String(raw).trim();
		if (!value || value.includes(INDEX_CONDITION_SEPARATOR)) return null;
		out.push({ keyPath, value });
	}
	return out.length > 0 ? out : null;
}

/**
 * IdxToken（`57` / `Card.Num:7` / `Card.Suit:Major,Card.SuitNum:16`）を idx / idxKey へ分解する
 * @param {string} raw - トークン文字列
 * @returns {{idx: string, idxKey: string}}
 */
export function parseIdxToken(raw) {
	const token = String(raw || '').trim();
	if (!token) return { idx: '', idxKey: '' };
	// `_DBLink` の複合条件（JSON ペイロード）はコロンを含むため分割しない
	if (token[0] === '{') return { idx: token, idxKey: '' };

	// 複合インデックスは JSON 条件へ正規化し、既存の `__conditions__`（subset match）経路へ合流させる
	const conditions = parseIndexConditionToken(token);
	if (conditions) return { idx: JSON.stringify(conditions), idxKey: INDEX_CONDITIONS_KEY };

	const sep = token.indexOf(':');
	if (sep > 0) {
		const key = token.slice(0, sep);
		const value = token.slice(sep + 1);
		if (value && INDEX_KEY_PATH_RE.test(key)) return { idx: value, idxKey: key };
	}
	return { idx: token, idxKey: '' };
}

/**
 * idx / idxKey から IdxToken を組み立てる
 *
 * 複合条件（JSON ペイロード）は `キーパス:値` のカンマ区切りへ戻す。
 * 往復できない条件（値に区切り文字を含む等）は空文字を返し、呼び出し側で旧形式へ退避させる。
 *
 * @param {string} idx - インデックス値（複合条件では JSON ペイロード）
 * @param {string} idxKey - インデックスのキーパス（複合条件では `__conditions__`）
 * @returns {string} IdxToken（値が空 / 表現できない場合は空文字）
 */
export function buildIdxToken(idx, idxKey) {
	const value = String(idx ?? '').trim();
	if (!value) return '';
	const key = String(idxKey ?? '').trim();

	if (value[0] === '{') {
		const conditions = (() => {
			try {
				return JSON.parse(value);
			} catch {
				return null;
			}
		})();
		// `__conditions__` はレコード直下の条件、それ以外は idxKey フィールド配下の条件
		const prefix = (!key || key === INDEX_CONDITIONS_KEY) ? '' : key;
		if (prefix && !INDEX_KEY_PATH_RE.test(prefix)) return '';
		const pairs = flattenIndexConditions(conditions, prefix);
		if (!pairs) return '';
		return pairs.map(pair => `${pair.keyPath}:${pair.value}`).join(INDEX_CONDITION_SEPARATOR);
	}

	if (!key || !INDEX_KEY_PATH_RE.test(key)) return value;
	return `${key}:${value}`;
}

/**
 * 短縮ロケータ（`NTS-57` / `FLI-M16/PrimaryDealer`）を分解する
 * @param {string} raw - `b` パラメータの値
 * @returns {{badge: string, db: string}} `badge` は作品コード付きバッジ（`NTS-57`）
 */
export function parseShortLocator(raw) {
	const value = String(raw || '').trim();
	const slash = value.indexOf('/');
	if (slash < 0) return { badge: value, db: '' };
	return { badge: value.slice(0, slash).trim(), db: value.slice(slash + 1).trim() };
}

/**
 * 短縮ロケータのクエリ文字列を組み立てる（`?b=NTS-57` / `?b=FLI-M16/PrimaryDealer`）
 * @param {string} badge - 作品コード付きバッジ
 * @param {string} [db=''] - DB 名（カタログ先頭以外の DB を指すときだけ付ける）
 * @returns {string} '?b=...' 形式のクエリ（バッジが空なら空文字）
 */
export function buildShortQueryString(badge, db = '') {
	const value = String(badge || '').trim();
	if (!value) return '';
	const dbName = String(db || '').trim();
	const qs = new URLSearchParams({ [SHORT_LOCATOR_PARAM]: dbName ? `${value}/${dbName}` : value });
	// `/` はクエリ内では正当な文字なので、可読性のため %2F を戻す（buildViewerQueryString と同じ方針）
	return `?${qs.toString().replace(/%2F/g, '/')}`;
}

/**
 * 圧縮ロケータ（`Work/Db/IdxToken`）を分解する
 * 3セグメント目以降の `/` はインデックス値の一部として保持する
 * @param {string} raw - `c` パラメータの値
 * @returns {{work: string, db: string, idx: string, idxKey: string}}
 */
export function parseViewerLocator(raw) {
	const value = String(raw || '').trim();
	const empty = { work: '', db: '', idx: '', idxKey: '' };
	if (!value) return empty;

	const firstSlash = value.indexOf('/');
	if (firstSlash < 0) return { ...empty, work: value };

	const work = value.slice(0, firstSlash);
	const rest = value.slice(firstSlash + 1);
	const secondSlash = rest.indexOf('/');
	if (secondSlash < 0) return { ...empty, work, db: rest };

	const db = rest.slice(0, secondSlash);
	return { work, db, ...parseIdxToken(rest.slice(secondSlash + 1)) };
}

/**
 * ビューア用のクエリ文字列を組み立てる（空値のパラメータは出力しない）
 *
 * 複合条件（JSON ペイロード + `idxKey=__conditions__`）も `キーパス:値` のカンマ区切りへ
 * 変換して圧縮ロケータへ載せる。往復できない条件（値に区切り文字を含む等）のときだけ、
 * 従来の個別キー形式（`work` / `db` / `idx` / `idxKey`）へ退避する。
 *
 * @param {Object} params - work / db / idx / idxKey / q / lang
 * @returns {string} '?c=...' 形式のクエリ（空なら空文字）
 */
export function buildViewerQueryString(params = {}) {
	const work = workKeyForURL(params?.work);
	const db = String(params?.db ?? '').trim();
	const idx = String(params?.idx ?? '').trim();
	const idxKey = String(params?.idxKey ?? '').trim();
	const q = String(params?.q ?? '').trim();
	const lang = String(params?.lang ?? '').trim();

	const qs = new URLSearchParams();
	const token = buildIdxToken(idx, idxKey);
	if (idx && !token) {
		// 圧縮ロケータで表現できない条件のみ旧形式へ退避（手入力対象外のため許容）
		if (work) qs.set('work', work);
		if (db) qs.set('db', db);
		qs.set('idx', idx);
		if (idxKey) qs.set('idxKey', idxKey);
	} else if (work) {
		let locator = work;
		if (db) locator += `/${db}`;
		// db が無いと IdxToken の位置が決まらないため、work のみのときは値を載せない
		if (db && token) locator += `/${token}`;
		qs.set(VIEWER_LOCATOR_PARAM, locator);
	} else {
		if (db) qs.set('db', db);
		if (token) qs.set('idx', token);
	}
	if (q) qs.set('q', q);
	if (lang) qs.set('lang', lang);

	const encoded = qs.toString();
	if (!encoded) return '';
	// `/` `:` `,` はクエリ内では正当な文字（RFC 3986: query = *( pchar / "/" / "?" )）なので、
	// URLSearchParams が退避した %2F / %3A / %2C を戻して可読性を優先する
	return `?${encoded.replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%2C/g, ',')}`;
}

// IIFE 形式の `lib/section-renders/*.js`（`globalThis` 経由で helper を受け取る）からも
// 参照できるようミラーしておく。ES モジュールとして import できる環境では import を優先すること。
if (typeof globalThis !== 'undefined') {
	globalThis.ViewerLocator = {
		VIEWER_LOCATOR_PARAM,
		INDEX_KEY_PATH_RE,
		INDEX_CONDITION_SEPARATOR,
		INDEX_CONDITIONS_KEY,
		workKeyForURL,
		assignByKeyPath,
		parseIndexConditionToken,
		flattenIndexConditions,
		parseIdxToken,
		buildIdxToken,
		parseViewerLocator,
		buildViewerQueryString,
		SHORT_LOCATOR_PARAM,
		parseShortLocator,
		buildShortQueryString
	};
}
