/**
 * specStats 系セクションレンダラー共通ビルダー。
 * specStats / arcanumSpec の各レンダラーから参照される。
 * globalThis.__specStatsHelpers に関数を格納する。
 */
(() => {
	/** @type {globalThis.__specStatsHelpers} */
	globalThis.__specStatsHelpers = {

		/**
		 * EffectStats オブジェクト（各エフェクトが $Def_EffectText 形式）からタグ要素配列を生成する。
		 * @param {object} effData - EffectStats フィールドの値
		 * @param {string} effPath - スキーマパス (例: "NumerospecStats.EffectStats")
		 * @param {object} context
		 * @returns {Element[]}
		 */
		buildEffectStatsTags(effData, effPath, context) {
			const {
				el,
				isEmptyValueLoose,
				isPlainObject,
				pickSchemaPath,
				pickSchemaHintsForObjectLeaf,
				getFieldLabel,
				formatValueForDisplay
			} = context.helpers || {};
			const { fieldLabelMap, workMeta: metaForLookup, globalDefType } = context;

			if (!isPlainObject?.(effData)) return [];

			return Object.entries(effData)
				.map(([k, v]) => {
					if (!k || typeof k !== 'string' || k.startsWith('_')) return null;
					if (isEmptyValueLoose?.(v)) return null;

					const fallbackPath = `${effPath}.${k}`;
					const schemaPath = pickSchemaPath?.([fallbackPath], fallbackPath) ?? fallbackPath;
					const fieldLabel = getFieldLabel?.(schemaPath, fieldLabelMap, metaForLookup, globalDefType, k) ?? k;
					const { schemaType, schemaDisplay } = pickSchemaHintsForObjectLeaf?.([schemaPath], v) ?? {};
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
		},

		/**
		 * SafetyLevel オブジェクト（単葉 #ListLink 形式）から 1 つのタグ要素を生成する。
		 * @param {object} safetyData - SafetyLevel フィールドの値
		 * @param {string} safetyPath - スキーマパス (例: "NumerospecStats.SafetyLevel")
		 * @param {object} context
		 * @returns {Element|null}
		 */
		buildSafetyTag(safetyData, safetyPath, context) {
			const {
				el,
				isEmptyValueLoose,
				isPlainObject,
				pickSchemaHintsForObjectLeaf,
				getFieldLabel,
				formatValueForDisplay
			} = context.helpers || {};
			const { fieldLabelMap, workMeta: metaForLookup, globalDefType } = context;

			if (!isPlainObject?.(safetyData) || isEmptyValueLoose?.(safetyData)) return null;

			const { schemaType, schemaDisplay } = pickSchemaHintsForObjectLeaf?.([safetyPath], safetyData) ?? {};
			const displayValue = formatValueForDisplay?.(safetyData, fieldLabelMap, metaForLookup, globalDefType, {
				schemaType,
				display: schemaDisplay,
				fieldKey: safetyPath
			});

			const label = getFieldLabel?.(safetyPath, fieldLabelMap, metaForLookup, globalDefType, 'SafetyLevel') ?? 'SafetyLevel';
			const dv = String(displayValue ?? '').trim();
			if (!dv) return null;
			return el?.('div', { class: 'tag' }, [`${label}: ${dv}`]) ?? null;
		},

		/**
		 * 単葉オブジェクト（SpecLevel 等の $EnumDef_Rank 系）からタグ要素を生成する。
		 * @param {object} leafData - 単葉オブジェクトの値
		 * @param {string} fieldPath - スキーマパス
		 * @param {string} fallbackLabel
		 * @param {object} context
		 * @returns {Element|null}
		 */
		buildSingleLeafTag(leafData, fieldPath, fallbackLabel, context) {
			const {
				el,
				isEmptyValueLoose,
				isPlainObject,
				pickSchemaHintsForObjectLeaf,
				getFieldLabel,
				formatValueForDisplay
			} = context.helpers || {};
			const { fieldLabelMap, workMeta: metaForLookup, globalDefType } = context;

			if (!isPlainObject?.(leafData) || isEmptyValueLoose?.(leafData)) return null;

			const { schemaType, schemaDisplay } = pickSchemaHintsForObjectLeaf?.([fieldPath], leafData) ?? {};
			const displayValue = formatValueForDisplay?.(leafData, fieldLabelMap, metaForLookup, globalDefType, {
				schemaType,
				display: schemaDisplay,
				fieldKey: fieldPath
			});

			const label = getFieldLabel?.(fieldPath, fieldLabelMap, metaForLookup, globalDefType, fallbackLabel) ?? fallbackLabel;
			const dv = String(displayValue ?? '').trim();
			if (!dv) return null;
			return el?.('div', { class: 'tag' }, [`${label}: ${dv}`]) ?? null;
		}
	};
})();
