/**
 * graph-badge.js - キャラクターの短い識別子（インデックスバッジ）を組み立てる
 *
 * @description
 * 相関図のノード内に出す「57」「M16」のような**短い識別子**を、
 * `db_meta.json` の `CreationWorks.#Works_*.Works_Code`（作品コード）と
 * 作品別 `db_type.json` の `$IndexDef.$badge`（連結規則）**の宣言だけ**から組み立てる。
 *
 * ## なぜ宣言が要るのか
 *
 * 画像 688 ファイルの実測で、作品ごとに識別子の体系が完全に違っていた（改名前の姿）。
 *
 * | 作品 | 旧ファイル名 | 導出元 |
 * | --- | --- | --- |
 * | NumberTales | `cnsp_img57` | `Num` そのまま |
 * | FLInvestigator78 | `crddsn_imgFLM16` | `FL` + `M`(Major) + `SuitNum` |
 * | ShouArRiders | `cnsp_imgEZ13` | `EZ` + 辞書 `dict_Beast.json` の `Num` |
 * | PastDivers | `cnsp_imgCL3G3` | `CL` + 辞書 Num + `G` + `Generation` |
 * | DestinyFoxRecords | `design_imgSII` | `SI` + SI 基本次元記号（`Unit` 値とは別体系） |
 *
 * さらに規則外の変換（`Num:"222-alt"` → `img222B`）や、インデックス値そのものがファイル名に
 * 使えないケース（`Num:"%"` / `"∞"`、VirtuesUs の `Virtues:"仁"`）が実在した。
 * **機械導出しようとすると必ず破綻する**ので、規則は宣言する。
 *
 * ## 宣言の書式
 *
 * ```jsonc
 * // 作品別 db_type.json
 * "$IndexDef": {
 *   "hashTag": "Card",
 *   "$type": [ ... ],
 *   "$badge": {
 *     "keys": [
 *       { "key": "Suit", "codeFrom": "Suit_Code" },   // 辞書行を引いて別列の値を使う
 *       { "key": "SuitNum" },                          // 値そのまま
 *       { "key": "Num", "whenMissing": "SuitNum" }     // SuitNum が無いときだけ使う
 *     ],
 *     "separator": ""
 *   }
 * }
 * ```
 *
 * | `keys` 要素 | 意味 |
 * | --- | --- |
 * | 文字列 | そのサブキーの値をそのまま使う |
 * | `{ key }` | 同上 |
 * | `{ key, codeFrom }` | `$dict` の辞書行を引き、`codeFrom` 列の値を使う。取れなければ生値へフォールバック |
 * | `{ key, prefix }` | 値の前に固定文字列を挟む（`G3` の `G`） |
 * | `{ key, whenMissing }` | 指定サブキーがレコードに**無いときだけ**この要素を使う |
 *
 * 値が取れない要素は**黙って飛ばす**。全要素が空なら `null` を返す（呼び出し側でインデックス文字列へフォールバック）。
 *
 * ## 適用範囲
 *
 * **表示専用。画像ファイル名を実行時に生成することはしない。**
 * 画像パス解決は従来どおり DB へ手書きされたファイル名をそのまま使う
 * （`lib/data-common.js` の `resolveImagePath()` は無改修）。
 *
 * ただし 2026-08-02 に、既存の画像 640 ファイルを `full`（作品コード付き `NTS-57` / `FLI-M0`）表記へ
 * **一括改名した**（`_work_in_progress/2026-08-02_progress_image-rename-index-badge.md`）。
 * よって実データ上はファイル名の識別子部分とバッジが一致している。
 * それでも「バッジからファイル名を組み立てる」実装は入れないこと。
 * ファイル名には別カットを表す接尾辞（`-humanoid` / `-1` / `C`）や連名（`NTS-34,NTS-43`）が付き、
 * バッジだけからは復元できない。新規ファイルを足すときは DB へ実名を手書きする。
 *
 * DOM 非依存の純関数のみ。**Service Worker の `importScripts()` へは追加しないこと**（ES モジュール）。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 */

/** バッジの既定の連結文字 */
const DEFAULT_SEPARATOR = '-';

/** 作品コードとバッジ本体の連結文字 */
const WORK_CODE_SEPARATOR = '-';

/** @param {*} v @returns {boolean} */
function isPlainObject(v) {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 値が「空」か（バッジの構成要素として使えないか）
 * @param {*} v @returns {boolean}
 */
function isEmptyValue(v) {
	return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/**
 * 辞書行の値をバッジ用のスカラーへ落とす
 *
 * @description 辞書の列は `13` のようなスカラーだけでなく
 * `[{value: 13, about_JP: "便宜上"}, {value: 3, about_JP: "種族上"}]` の配列にもなる
 * （`dict_Beast.json` の `Cat` / `Dog`）。その場合は**先頭要素の `value`** を採る。
 * @param {*} raw
 * @returns {string} 取れなければ空文字
 */
export function normalizeDictCell(raw) {
	if (isEmptyValue(raw)) return '';
	if (Array.isArray(raw)) {
		for (const item of raw) {
			const v = normalizeDictCell(item);
			if (v) return v;
		}
		return '';
	}
	if (isPlainObject(raw)) {
		// `#Number_withAbout` 形式（`{ value, about_JP, about_EN }`）
		return isEmptyValue(raw.value) ? '' : String(raw.value).trim();
	}
	return String(raw).trim();
}

/**
 * 作品コードを取り出す
 * @param {Object} globalMeta - `data/db_meta.json` 相当
 * @param {string} workId - '#Works_NumberTales'
 * @returns {string} 未宣言なら空文字
 */
export function getWorksCode(globalMeta, workId) {
	const entry = globalMeta?.CreationWorks?.[workId];
	const code = entry?.Works_Code;
	return typeof code === 'string' ? code.trim() : '';
}

/**
 * `$badge` 宣言を正規化する
 * @param {Object|null} indexDef - 対象DBの `$IndexDef`
 * @returns {{keys: Array<Object>, separator: string}}
 */
export function normalizeBadgeSpec(indexDef) {
	const spec = indexDef?.$badge;
	const separator = (typeof spec?.separator === 'string') ? spec.separator : DEFAULT_SEPARATOR;

	const rawKeys = Array.isArray(spec?.keys) ? spec.keys : null;
	if (!rawKeys || rawKeys.length === 0) {
		// 宣言が無ければ主サブキー（複合なら先頭、スカラーなら root）だけを使う
		const subs = Array.isArray(indexDef?.$type)
			? indexDef.$type.map(e => e?.hashTag).filter(Boolean)
			: null;
		const fallbackKey = subs && subs.length > 0 ? subs[0] : indexDef?.hashTag;
		return { keys: fallbackKey ? [{ key: fallbackKey }] : [], separator };
	}

	const keys = rawKeys
		.map(k => (typeof k === 'string' ? { key: k } : (isPlainObject(k) ? k : null)))
		.filter(k => k && typeof k.key === 'string' && k.key);
	return { keys, separator };
}

/**
 * インデックスのペア集合からバッジ本体を組み立てる
 *
 * @description `keys` の各要素は**インデックスのペア → レコードのフィールド**の順に探す。
 * これにより「インデックスとは別に用意した短縮コード用フィールド」（NumberTales の `Num_Badge` など）を
 * 宣言だけで使える。インデックスフィールド自体は読むだけで書き換えない。
 *
 * @param {Object} pairs - `extractIndexPairs()` の出力（`{ Suit: 'Major', SuitNum: '16' }`）
 * @param {Object|null} indexDef - 対象DBの `$IndexDef`
 * @param {(key: string, value: string, column: string) => string} [lookupDictCell]
 *   - 辞書行を引く関数。`codeFrom` 宣言があるときだけ呼ばれる。取れなければ空文字を返すこと
 * @param {Object|null} [record] - レコード本体（`pairs` に無いキーの参照先）
 * @returns {string} バッジ本体（組み立てられなければ空文字）
 */
export function buildBadgeBody(pairs, indexDef, lookupDictCell = null, record = null) {
	const { keys, separator } = normalizeBadgeSpec(indexDef);
	if (keys.length === 0) return '';

	/** インデックスのペア優先、無ければレコードのフィールドを見る */
	const valueOf = (key) => {
		if (isPlainObject(pairs) && !isEmptyValue(pairs[key])) return pairs[key];
		if (isPlainObject(record) && !isEmptyValue(record[key])) return record[key];
		return null;
	};

	const parts = [];
	for (const spec of keys) {
		// `whenMissing` 指定は「そのキーの値が無いときだけ使う」条件付き要素
		if (typeof spec.whenMissing === 'string' && spec.whenMissing) {
			if (!isEmptyValue(valueOf(spec.whenMissing))) continue;
		}

		const raw = valueOf(spec.key);
		if (isEmptyValue(raw)) continue;

		let piece = String(raw).trim();
		if (typeof spec.codeFrom === 'string' && spec.codeFrom && typeof lookupDictCell === 'function') {
			// 辞書行の別列を引く。取れなければ生値のまま（`Major` のように辞書行が無い値でも壊れない）
			const looked = normalizeDictCell(lookupDictCell(spec.key, piece, spec.codeFrom));
			if (looked) piece = looked;
		}
		if (!piece) continue;
		if (typeof spec.prefix === 'string' && spec.prefix) piece = `${spec.prefix}${piece}`;
		parts.push(piece);
	}

	return parts.join(separator);
}

/**
 * 完全なバッジ（作品コード付き）を組み立てる
 *
 * @param {Object} input
 * @param {Object} input.pairs - インデックスのペア集合
 * @param {Object|null} input.indexDef - 対象DBの `$IndexDef`
 * @param {string} [input.worksCode] - `Works_Code`
 * @param {Function} [input.lookupDictCell] - 辞書行を引く関数
 * @param {Object|null} [input.record] - レコード本体（`pairs` に無いキーの参照先）
 * @param {boolean} [input.withWorkCode=false] - 作品コードを付けるか
 * @returns {{badge: string, full: string}} `badge` はノード内表示用、`full` は作品コード付き
 */
export function buildBadge(input = {}) {
	const body = buildBadgeBody(input.pairs, input.indexDef, input.lookupDictCell, input.record);
	const code = String(input.worksCode || '').trim();
	if (!body) return { badge: '', full: code };
	const full = code ? `${code}${WORK_CODE_SEPARATOR}${body}` : body;
	return { badge: input.withWorkCode ? full : body, full };
}

/**
 * `$dict` 宣言つきの辞書から行を引く lookup 関数を作る
 *
 * @description 相関図は全作品を同時に扱うので、作品ごとの辞書束を渡して
 * 「サブキー名 → 辞書名」の対応は `$IndexDef` の子要素の `$dict` 宣言から導く。
 * 宣言が無ければサブキー名をそのまま辞書名とみなす（`Suit` → `#List_Suit` / `#Dict_Suit`）。
 *
 * @param {Object} varsDef - 辞書合流済みの `General.$VarsDef` 相当（`#List_Suit` などを持つ）
 * @param {Object|null} indexDef - 対象DBの `$IndexDef`
 * @returns {(key: string, value: string, column: string) => string}
 */
export function createDictCellLookup(varsDef, indexDef) {
	const subDefs = Array.isArray(indexDef?.$type) ? indexDef.$type : [];
	const dictNameOf = (key) => {
		const sub = subDefs.find(e => e?.hashTag === key);
		const declared = typeof sub?.$dict === 'string' ? sub.$dict.trim() : '';
		return declared || key;
	};

	return (key, value, column) => {
		if (!isPlainObject(varsDef) || !key || !value || !column) return '';
		const name = dictNameOf(key);
		// 辞書は `#List_<Name>` / `#Dict_<Name>` のどちらかに載る
		const rows = varsDef[`#List_${name}`] || varsDef[`#Dict_${name}`];
		if (!Array.isArray(rows)) return '';
		const hit = rows.find(r => isPlainObject(r) && String(r[key] ?? r[name] ?? '').trim() === String(value).trim());
		if (!hit) return '';
		return normalizeDictCell(hit[column]);
	};
}
