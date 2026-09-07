/**
 * [faction.js] - `$Def_Faction`（所属 / 陣営）系フィールドの basicFields 用レンダラー
 *
 * @description
 *   `Belonging` のような「辞書解決型の子要素（`Faction`）＋ 辞書行から参照解決する子要素
 *   （`FactionsBaseArea`）」を持つ `$Def_Faction` 型を、基本情報テーブル向けの 1 行テキストへ整形します。
 *
 *   整形結果は `所属先（活動地域／地域補足）` の形（EN は `Faction (Area / Supplement)`）。
 *   配列値は `$display.arrayLayout: "multiline"` に従って 1 要素 1 行で連結します。
 *
 *   **field 名に依存した分岐は持ちません**。どの子要素が辞書コードで、どの子要素を辞書行から
 *   参照解決するかは、すべて schema 側の宣言で決まります。
 *
 *   - `$display.role: "factionCode"` … 辞書コードを持つ主要素（`$dict` で辞書名を宣言）
 *   - `$dictRef: { from: "<主要素>", field: "<辞書行のキー>" }` … 辞書行から参照解決する子要素
 *   - `$shorthand: "<子要素名>"` … 生の文字列値を子要素へ読み替える後方互換宣言
 *
 *   参照解決した子要素が `$Def_*` 型（例: `$Def_BaseArea`）の場合は、共通部品
 *   `lib/basic-renders/def-object-common.js` の `formatDefObject()` で「辞書ラベル＋補足」へ整形します。
 *
 * @author 100BeautiesLab.
 * @version 1.1.0
 * @dependencies CharacterValueWrapperRegistry (wrapper-common.js), DefObjectRenderer (basic-renders/def-object-common.js)
 * @see docs/wrapper-summary-registry.md（factionSummary）
 */
(() => {
	'use strict';
	const root = typeof globalThis !== 'undefined' ? globalThis : self;
	const registry = root.CharacterValueWrapperRegistry;
	const D = root.DefObjectRenderer;
	if (!registry || typeof registry.registerWrapper !== 'function' || !D) return;

	const DEF_NAME = '$Def_Faction';
	const { isPlainObject, trimStr, stripArraySuffix } = D;

	/**
	 * `$Def_Faction` 1 要素を「所属先（活動地域）」形式へ整形する
	 * @param {any} value - `{ Faction: '...' }` もしくは `$shorthand` に従う生文字列
	 * @param {Object} container - `$Def_Faction` コンテナ
	 * @param {Object} context - wrapper context
	 * @returns {string}
	 */
	function formatFactionItem(value, container, context) {
		const pageLang = String(context?.pageLang || 'jp');
		const entries = Array.isArray(container?.$DefType) ? container.$DefType : [];

		// 主要素（辞書コードを持つ子要素）: role 宣言 → `$dict` 宣言の順で決める
		const primaryEntry = entries.find((e) => trimStr(e?.$display?.role) === 'factionCode')
			|| entries.find((e) => trimStr(e?.$dict));
		if (!primaryEntry) return '';

		const primaryKey = trimStr(primaryEntry.hashTag);
		const shorthandKey = trimStr(container?.$shorthand) || primaryKey;

		// `{ hideText }` は意図的マスクなので、この wrapper では整形しない（呼び出し側の表示に委ねる）
		if (isPlainObject(value) && trimStr(value.hideText)) return '';

		const code = isPlainObject(value)
			? trimStr(value[primaryKey])
			: (shorthandKey === primaryKey ? trimStr(value) : '');
		if (!code) return '';

		const dictName = trimStr(primaryEntry.$dict) || primaryKey;
		const row = D.resolveDictRow(dictName, code, context);
		const primaryLabel = D.pickDictLabel(row, dictName, code, pageLang);
		if (!primaryLabel) return '';

		// `$dictRef` を持つ子要素を参照解決する（レコード側に実値があればそちらを優先）
		const refTexts = [];
		for (const entry of entries) {
			const ref = entry?.$dictRef;
			if (!isPlainObject(ref)) continue;
			if (trimStr(ref.from) && trimStr(ref.from) !== primaryKey) continue;

			const key = trimStr(entry.hashTag);
			const refField = trimStr(ref.field) || key;
			const refValue = (isPlainObject(value) && value[key] !== undefined && value[key] !== null && value[key] !== '')
				? value[key]
				: row?.[refField];
			if (refValue === null || refValue === undefined || refValue === '') continue;

			// 入れ子の `$Def_*` は「所属先（…）」の括弧内へ入るため、括弧を重ねない inline 形式で整形する
			const defName = stripArraySuffix(String(entry?.$type || '').split('|').find((t) => t.trim().startsWith('$Def_')) || '');
			const text = defName
				? D.formatDefObject(refValue, defName, context, { style: 'inline' })
				: (isPlainObject(refValue) ? trimStr(refValue.hideText) : trimStr(refValue));
			if (text) refTexts.push(text);
		}

		if (!refTexts.length) return primaryLabel;

		const isEn = String(pageLang).toLowerCase() === 'en';
		const joined = refTexts.join(isEn ? ' / ' : '／');
		return isEn ? `${primaryLabel} (${joined})` : `${primaryLabel}（${joined}）`;
	}

	/**
	 * `$Def_Faction` 型の値（単体 / 配列）を表示テキストへ整形する
	 * @param {any} value
	 * @param {Object} context - wrapper context
	 * @returns {string}
	 */
	function formatFaction(value, context = {}) {
		let container = null;
		for (const defName of D.collectDefNames(context)) {
			const found = D.resolveContainer(defName, context);
			if (found) {
				container = found;
				break;
			}
		}
		if (!container) return '';

		return D.joinByArrayLayout(value, container, (item) => formatFactionItem(item, container, context));
	}

	registry.registerWrapper('factionSummary', {
		match: (context) => D.collectDefNames(context).includes(DEF_NAME),
		format: formatFaction
	});

	root.FactionRenderer = {
		formatFaction,
		formatFactionItem,
	};
})();
