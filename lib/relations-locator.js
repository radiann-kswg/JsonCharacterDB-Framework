/**
 * relations-locator.js - 相関図の圧縮ロケータ（`r=<map>/<Work>/<drill...>`）の URL 文法
 *
 * @description
 * 相関図（`pages/relations.html`）の「どのマップの、どの作品の、どの段を見ているか」を
 * 1 本のクエリ `r` にまとめる。
 *
 *   relations.html?r=NTS                 マップ own（既定なので省略）/ 作品 NumberTales
 *   relations.html?r=NTS/100BL           所属の段まで掘った状態（値は辞書 code か生値）
 *   relations.html?r=shared/NTS          共同二次創作マップ
 *   relations.html?r=FLI/M&f=FLI-M16     フォーカスはインデックスバッジ（キャラシートの `b=` と同じ語彙）
 *
 *   r = [<map>/]<segment>[/<segment>...]     map = own | shared（省略時 own）
 *
 * セグメントの**意味付け**（作品コード → 作品ID、辞書 code → 軸の値、バッジ → ノード）は
 * 実データが要るので `pages/relations.js` 側（`resolveLocators()`）が行う。
 * ここは文字列の分解・組み立てだけを持つ DOM 非依存の純関数で、
 * 値に含まれる `/` を `%2F` へ退避して区切りの `/` と衝突させない責務だけを持つ。
 *
 * キャラシートの `c` / `b`（`lib/viewer-locator.js`）とは意味が違うため同居させない
 * （`_work_in_progress/2026-08-20_progress_relations-url-locator.md` §4）。
 *
 * ES モジュール。**Service Worker の `importScripts()` へは追加しないこと**。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 */

/** 相関図ロケータのクエリキー */
export const RELATIONS_LOCATOR_PARAM = 'r';

/** マップ種別（先頭セグメントとして許容する語） */
export const RELATIONS_MAPS = Object.freeze(['own', 'shared']);

/** 既定のマップ（ロケータからは省略する） */
export const RELATIONS_DEFAULT_MAP = 'own';

/** セグメント値に含まれる `/` の退避表記 */
const SEGMENT_SLASH = '%2F';

/**
 * ロケータ文字列を分解する
 *
 * @description 先頭がマップ語（`own` / `shared`）ならマップとして読み、そうでなければ
 * マップは既定の `own` として全セグメントを経路とみなす。空セグメントは落とす。
 * @param {string} raw - `r` パラメータの値
 * @returns {{map: string, segments: string[]}}
 */
export function parseRelationsLocator(raw) {
	const parts = String(raw || '').split('/').map(s => s.trim()).filter(Boolean);
	const head = String(parts[0] || '').toLowerCase();
	const hasMap = RELATIONS_MAPS.includes(head);
	return {
		map: hasMap ? head : RELATIONS_DEFAULT_MAP,
		segments: (hasMap ? parts.slice(1) : parts).map(s => s.replace(/%2F/gi, '/'))
	};
}

/**
 * ロケータ文字列を組み立てる
 *
 * @description 既定マップ（`own`）は省略し、`shared` のときだけ先頭に付ける。
 * 既定マップで経路も無ければ空文字（クエリに載せない）。
 * @param {{map?: string, segments?: Array<string>}} [input]
 * @returns {string} `NTS/100BL` / `shared/NTS` / `shared` / ''
 */
export function buildRelationsLocator({ map = RELATIONS_DEFAULT_MAP, segments = [] } = {}) {
	const head = RELATIONS_MAPS.includes(String(map)) ? String(map) : RELATIONS_DEFAULT_MAP;
	const body = (Array.isArray(segments) ? segments : [])
		.map(s => String(s ?? '').trim())
		.filter(Boolean)
		.map(s => s.replace(/\//g, SEGMENT_SLASH));
	const parts = head === RELATIONS_DEFAULT_MAP ? body : [head, ...body];
	return parts.join('/');
}
