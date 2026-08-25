/**
 * `*specStats`（モチーフ能力の特性）汎用セクションレンダラー (specStatsSection)。
 *
 * EffectStats / SafetyLevel を共通ヘルパーで描画し、残り（`*specAbout` / `*specName` /
 * SpecialPattern / Artifact / MotifCommentaries 等）を buildObjectChildBlocks へ委譲する。
 * NumberTales / PastDivers / ShouArRiders が共用する（作品ごとの分岐は持たない）。
 * 追加要素を持つ FLInvestigator78 だけが arcanumSpec.js の専用レンダラーを使う。
 */
(() => {
	const registry = globalThis.CharacterSectionRendererRegistry;
	if (!registry?.registerSectionRenderer) return;

	registry.registerSectionRenderer('specStatsSection', {
		/** @param {object} item @param {object} context */
		render: (item, context) => {
			const h = globalThis.__specStatsHelpers;
			const {
				createDetailTagGrid,
				wrapStandaloneSection,
				isPlainObject,
				buildObjectChildBlocks
			} = context.helpers || {};

			const specValue = item?.value;
			if (!isPlainObject?.(specValue)) return null;

			const specKey = item.key;
			const effPath = `${specKey}.EffectStats`;
			const safetyPath = `${specKey}.SafetyLevel`;

			// --- 共通: EffectStats / SafetyLevel ---
			const effTags = h?.buildEffectStatsTags(specValue?.EffectStats, effPath, context) ?? [];
			const safetyTag = h?.buildSafetyTag(specValue?.SafetyLevel, safetyPath, context) ?? null;

			const detailNodes = [...effTags, safetyTag].filter(Boolean);

			// --- 残りフィールド（`*specAbout` / SpecialPattern / Artifact 等） ---
			const excludedKeys = new Set(['EffectStats', 'SafetyLevel'].filter(k => specValue?.[k] != null));
			const extraBlocks = buildObjectChildBlocks?.(specKey, specValue, { excludedChildKeys: excludedKeys }) ?? [];

			const sectionChildren = [
				detailNodes.length ? createDetailTagGrid?.(detailNodes) : null,
				...extraBlocks
			].filter(Boolean);

			if (!sectionChildren.length) return null;
			return wrapStandaloneSection?.(item, sectionChildren) ?? null;
		}
	});
})();
