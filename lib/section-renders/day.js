/**
 * [day.js] - Day 専用セクションレンダラー
 *
 * `daySection` として登録し、`$Def_Day` 型の日付情報をタググリッドで表示する。
 * - 単一オブジェクト（BirthDay など: `$Def_Day`）→ 1 タグ
 * - 配列（AnivDay など: `$Def_Day[]`）→ 要素ごとに 1 タグ
 * - 各要素は `formatValueForDisplay` で `daySummary` wrapper 経由の整形文字列を取得する
 *
 * `$display.sectionWrapper: "daySection"` が指定されたフィールドに適用される。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies CharacterSectionRendererRegistry (section-wrapper-common.js)
 */
(() => {
	const registry = globalThis.CharacterSectionRendererRegistry;
	if (!registry?.registerSectionRenderer) return;

	registry.registerSectionRenderer('daySection', {
		/**
		 * `$display.sectionWrapper: "daySection"` を持つフィールドに一致する。
		 * rendererMap は sectionWrapper 名で直接引くため、この match は保険として機能する。
		 */
		match: (context) => {
			const display = context?.display ?? context?.item?.display ?? {};
			return display?.sectionWrapper === 'daySection';
		},

		/** @param {object} item @param {object} context */
		render: (item, context) => {
			const {
				el,
				isEmptyValueLoose,
				formatValueForDisplay,
				createDetailTagGrid,
				wrapStandaloneSection,
				isPlainObject
			} = context.helpers || {};
			const { fieldLabelMap, workMeta: metaForLookup, globalDefType } = context;

			const rawValue = item?.value;
			if (rawValue == null || isEmptyValueLoose?.(rawValue)) return null;

			// $Def_Day（object）/ $Def_Day[]（array）の両形式を配列に正規化する
			const dayItems = Array.isArray(rawValue)
				? rawValue
				: isPlainObject?.(rawValue)
					? [rawValue]
					: null;

			if (!dayItems?.length) return null;

			const tagNodes = [];
			for (const d of dayItems) {
				if (!isPlainObject?.(d)) continue;
				const formatted = formatValueForDisplay?.(d, fieldLabelMap, metaForLookup, globalDefType, {
					schemaType: '$Def_Day',
					fieldKey: item.key
				});
				if (!formatted) continue;
				tagNodes.push(el?.('div', { class: 'tag' }, [String(formatted)]) ?? null);
			}

			const validTags = tagNodes.filter(Boolean);
			if (!validTags.length) return null;

			const grid = createDetailTagGrid?.(validTags);
			if (!grid) return null;

			return wrapStandaloneSection?.(item, [grid]) ?? null;
		}
	});
})();
