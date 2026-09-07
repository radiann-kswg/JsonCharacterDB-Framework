/**
 * `*specStats`（モチーフ能力の特性）汎用セクションレンダラー (specStatsSection)。
 *
 * EffectStats / SafetyLevel / SpecLevel を共通ヘルパーで描画し、残り（`*specAbout` / `*specName` /
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
			const specLevelPath = `${specKey}.SpecLevel`;

			// --- 共通: EffectStats / SafetyLevel / SpecLevel ---
			// SpecLevel（`$EnumDef_Rank,$EnumLink` の単葉オブジェクト）は EffectStats と同じ度数系の指標なので、
			// 大ブロックへ落とさず同じタググリッドへ並べる（FLInvestigator78 の arcanumSpecSection と同挙動）
			const effTags = h?.buildEffectStatsTags(specValue?.EffectStats, effPath, context) ?? [];
			const safetyTag = h?.buildSafetyTag(specValue?.SafetyLevel, safetyPath, context) ?? null;
			const specLevelTag = h?.buildSingleLeafTag(
				specValue?.SpecLevel, specLevelPath, 'SpecLevel', context
			) ?? null;

			const detailNodes = [...effTags, safetyTag, specLevelTag].filter(Boolean);

			// --- 残りフィールド（`*specAbout` / SpecialPattern / Artifact 等） ---
			const excludedKeys = new Set(
				['EffectStats', 'SafetyLevel', 'SpecLevel'].filter(k => specValue?.[k] != null)
			);
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
