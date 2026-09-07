/**
 * AbilityStats 専用セクションレンダラー。
 * 'statsSection' として登録し、AbilityStats の各能力値を rank タググリッドで表示する。
 * characters.js から import されると section-wrapper-common.js の既存登録を上書きする。
 */
(() => {
	const registry = globalThis.CharacterSectionRendererRegistry;
	if (!registry?.registerSectionRenderer) return;

	registry.registerSectionRenderer('statsSection', {
		match: (context) => {
			const item = context?.item;
			if (!item?.value || typeof item.value !== 'object' || Array.isArray(item.value)) return false;
			// AbilityStats: 全子フィールドが $EnumDef_Rank 系の flat object
			// sectionWrapper: "statsSection" を持つフィールドのみ受け入れる
			const display = context?.display ?? item?.display ?? {};
			return display?.sectionWrapper === 'statsSection';
		},
		/** @param {object} item @param {object} context */
		render: (item, context) => {
			const {
				el,
				isEmptyValueLoose,
				pickSchemaPath,
				pickSchemaType,
				pickSchemaDisplay,
				getFieldLabel,
				formatValueForDisplay,
				createDetailTagGrid,
				wrapStandaloneSection,
				isPlainObject,
				getCurrentPageLanguage
			} = context.helpers || {};
			const { fieldLabelMap, workMeta: metaForLookup, globalDefType } = context;

			if (!isPlainObject?.(item?.value)) return null;

			const pageLang = getCurrentPageLanguage?.() ?? 'jp';

			const tags = Object.entries(item.value)
				.map(([k, v]) => {
					if (!k || typeof k !== 'string' || k.startsWith('_')) return null;
					if (isEmptyValueLoose?.(v)) return null;
					if (pageLang === 'jp' && k.endsWith('_EN')) return null;
					if (pageLang === 'en' && k.endsWith('_JP')) return null;

					const fallbackPath = `${item.key}.${k}`;
					const schemaPath = pickSchemaPath?.([fallbackPath], fallbackPath) ?? fallbackPath;
					const fieldLabel = getFieldLabel?.(schemaPath, fieldLabelMap, metaForLookup, globalDefType, k) ?? k;
					const schemaType = pickSchemaType?.(schemaPath);
					const schemaDisplay = pickSchemaDisplay?.(schemaPath, item.key);
					const displayValue = formatValueForDisplay?.(v, fieldLabelMap, metaForLookup, globalDefType, {
						schemaType,
						display: schemaDisplay,
						fieldKey: schemaPath
					});

					const fl = String(fieldLabel ?? '').trim();
					const dv = String(displayValue ?? '').trim();
					if (!fl || !dv) return null;
					return el?.('div', { class: 'tag' }, [`${fl}: ${dv}`]) ?? null;
				})
				.filter(Boolean);

			if (!tags.length) return null;
			return wrapStandaloneSection?.(item, [createDetailTagGrid?.(tags)]) ?? null;
		}
	});
})();
