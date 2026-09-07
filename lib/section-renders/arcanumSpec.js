/**
 * ArcanumspecStats 専用セクションレンダラー (arcanumSpecSection)。
 * SpecType / SpecLevel / SpecialPattern / SafetyLevel / EffectStats を順序付きで描画する。
 * 旧 characters.js FLInvestigator SpecLevel 互換補正ブロックもここで吸収する。
 */
(() => {
	const registry = globalThis.CharacterSectionRendererRegistry;
	if (!registry?.registerSectionRenderer) return;

	registry.registerSectionRenderer('arcanumSpecSection', {
		/** @param {object} item @param {object} context */
		render: (item, context) => {
			const h = globalThis.__specStatsHelpers;
			const {
				el,
				createDetailTagGrid,
				wrapStandaloneSection,
				isPlainObject,
				isEmptyValueLoose,
				pickSchemaPath,
				pickSchemaType,
				pickSchemaDisplay,
				pickSchemaHintsForObjectLeaf,
				getFieldLabel,
				formatValueForDisplay,
				schemaTypeIncludes,
				kvTable,
				buildObjectChildBlocks
			} = context.helpers || {};
			const { fieldLabelMap, workMeta: metaForLookup, globalDefType, fieldDisplayMap } = context;

			const specValue = item?.value;
			if (!isPlainObject?.(specValue)) return null;

			const specKey = item.key;
			const effPath = `${specKey}.EffectStats`;
			const safetyPath = `${specKey}.SafetyLevel`;
			const specLevelPath = `${specKey}.SpecLevel`;

			// --- SpecLevel タグ (EffectStats グリッドと同列) ---
			const specLevelTag = h?.buildSingleLeafTag(
				specValue?.SpecLevel, specLevelPath, 'SpecLevel', context
			) ?? null;

			// --- EffectStats / SafetyLevel ---
			const effTags = h?.buildEffectStatsTags(specValue?.EffectStats, effPath, context) ?? [];
			const safetyTag = h?.buildSafetyTag(specValue?.SafetyLevel, safetyPath, context) ?? null;

			const detailNodes = [...effTags, safetyTag, specLevelTag].filter(Boolean);

			// --- SpecType: 各子フィールドをタグとして展開 → kvTable ---
			const specTypeValue = specValue?.SpecType;
			const specTypePath = `${specKey}.SpecType`;
			const specTypeLabel = getFieldLabel?.(specTypePath, fieldLabelMap, metaForLookup, globalDefType, 'SpecType') ?? 'SpecType';
			const specTypeNodes = [];
			if (isPlainObject?.(specTypeValue)) {
				for (const [k, v] of Object.entries(specTypeValue)) {
					if (!k || typeof k !== 'string' || k.startsWith('_')) continue;
					if (isEmptyValueLoose?.(v)) continue;

					const childPath = `${specTypePath}.${k}`;
					const schemaPath = pickSchemaPath?.([childPath], childPath) ?? childPath;
					const fieldLabel = getFieldLabel?.(schemaPath, fieldLabelMap, metaForLookup, globalDefType, k) ?? k;

					const hints = (isPlainObject?.(v) && !Array.isArray(v))
						? (pickSchemaHintsForObjectLeaf?.([schemaPath, childPath], v) ?? {})
						: {
							schemaType: pickSchemaType?.(schemaPath, childPath),
							schemaDisplay: pickSchemaDisplay?.(schemaPath, childPath, specTypePath)
						};

					const displayValue = formatValueForDisplay?.(v, fieldLabelMap, metaForLookup, globalDefType, {
						schemaType: hints.schemaType,
						display: hints.schemaDisplay,
						fieldKey: schemaPath
					});

					const dv = String(displayValue ?? '').trim();
					if (!dv) continue;
					specTypeNodes.push(el?.('div', { class: 'tag' }, [`${fieldLabel}: ${dv}`]) ?? null);
				}
			}
			const specTypeRow = specTypeNodes.filter(Boolean).length
				? kvTable?.({}, [[specTypeLabel, createDetailTagGrid?.(specTypeNodes.filter(Boolean))]])
				: null;

			// --- 残りフィールド (SpecialPattern 等) ---
			const excludedKeys = new Set(
				['EffectStats', 'SafetyLevel', 'SpecLevel', 'SpecType'].filter(k => specValue?.[k] != null)
			);
			const extraBlocks = buildObjectChildBlocks?.(specKey, specValue, { excludedChildKeys: excludedKeys }) ?? [];

			const sectionChildren = [
				detailNodes.length ? createDetailTagGrid?.(detailNodes) : null,
				specTypeRow,
				...extraBlocks
			].filter(Boolean);

			if (!sectionChildren.length) return null;
			return wrapStandaloneSection?.(item, sectionChildren) ?? null;
		}
	});
})();
