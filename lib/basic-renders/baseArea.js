/**
 * [baseArea.js] - `$Def_BaseArea`（活動地域 / 出身地）系フィールドの basicFields 用レンダラー
 *
 * @description
 *   `FromArea` のような「地域辞書を引く子要素（`Area`）＋ 補足（`BaseAreaAbout_JP` / `_EN`）」を持つ
 *   `$Def_BaseArea` 型を、基本情報テーブル向けの 1 行テキスト `地域（補足）` へ整形します
 *   （EN は `Area (Supplement)`）。
 *
 *   整形本体は `lib/basic-renders/def-object-common.js` の `formatDefObject()` に委譲しており、
 *   本ファイルは `$display.wrapper: "baseAreaSummary"` への登録と配列連結だけを担います。
 *   どの子要素が辞書コードでどれが補足かは schema 宣言（`$type` / `$dict` / キー末尾の `_JP` `_EN`）
 *   だけで決まるため、**field 名に依存した分岐は持ちません**。
 *
 *   `$Def_Faction` の内側（`FactionsBaseArea`）でも同じ整形関数を使いますが、そちらは所属先の括弧内へ
 *   入れ子で置くため `ラベル／補足` 形式（`style: 'inline'`）を使い、単体表示のこちらは
 *   `ラベル（補足）` 形式（`style: 'paren'`）を使います。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies CharacterValueWrapperRegistry (wrapper-common.js), DefObjectRenderer (basic-renders/def-object-common.js)
 * @see docs/wrapper-summary-registry.md（baseAreaSummary）
 */
(() => {
	'use strict';
	const root = typeof globalThis !== 'undefined' ? globalThis : self;
	const registry = root.CharacterValueWrapperRegistry;
	const D = root.DefObjectRenderer;
	if (!registry || typeof registry.registerWrapper !== 'function' || !D) return;

	const DEF_NAME = '$Def_BaseArea';

	/**
	 * `$Def_BaseArea` 型の値（単体 / 配列）を表示テキストへ整形する
	 * @param {any} value - `{ Area, BaseAreaAbout_JP/EN }` もしくはその配列
	 * @param {Object} context - wrapper context
	 * @returns {string}
	 */
	function formatBaseArea(value, context = {}) {
		const defName = D.collectDefNames(context).find((name) => name === DEF_NAME) || DEF_NAME;
		const container = D.resolveContainer(defName, context);
		if (!container) return '';

		return D.joinByArrayLayout(
			value,
			container,
			(item) => D.formatDefObject(item, defName, context, { style: 'paren' })
		);
	}

	registry.registerWrapper('baseAreaSummary', {
		match: (context) => D.collectDefNames(context).includes(DEF_NAME),
		format: formatBaseArea
	});

	root.BaseAreaRenderer = { formatBaseArea };
})();
