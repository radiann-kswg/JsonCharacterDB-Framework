/**
 * wrapper summary の enrich 出力テスト
 *
 * - `$display.wrapper` を持つ top-level field が `_enrichment.wrapperSummaries` へ集約されること
 * - Day / StoryEra が shared wrapper registry 経由で summary を返せること
 */
import { describe, it, expect } from 'vitest';

import '../lib/wrapper-common.js';
import '../lib/data-common.js';

/** @type {typeof globalThis.EnrichmentProcessor} */
const EnrichmentProcessor = globalThis.EnrichmentProcessor;

const testConfig = {
	ORIGIN: 'http://localhost',
	withRepoBase: (path) => String(path || '')
};

function createDataFetcher() {
	return {
		readGeneralVarsDefGlobal: async () => ({}),
		readGeneralVarsDefWork: async () => ({}),
		readGlobalMeta: async () => ({ CreationWorks: {} }),
		readGlobalType: async () => ({
			$DefType: [
				{ hashTag: 'BirthDay', $type: '$Def_Day', hashTag_JP: '誕生日' },
				{ hashTag: 'StoryEra', $type: '$Def_StoryEraCatalog|#Null', hashTag_JP: '年代' }
			],
			$VarsDef: {
				$Def_Day: {
					$display: { wrapper: 'daySummary' },
					$DefType: [
						{ hashTag: 'Month', $display: { role: 'month' } },
						{ hashTag: 'DayOfMonth', $display: { role: 'dayOfMonth' } },
						{ hashTag: 'DayAbout', $display: { role: 'annotation' } }
					]
				}
			},
			$MetaType: {
				$Def_StoryEra: {
					$display: { wrapper: 'eraSummary' },
					$DefType: [
						{ hashTag: 'EraGen', $display: { role: 'eraGeneration' } },
						{ hashTag: 'YearInEra', $display: { role: 'eraYear' } },
						{ hashTag: 'byRealYear', $display: { role: 'realYear' } },
						{ hashTag: 'about_JP', $display: { role: 'pointLabel' } },
						{ hashTag: 'about_EN', $display: { role: 'pointLabelAlt' } }
					]
				},
				$Def_StoryEraCatalog: {
					$display: { wrapper: 'storyEraSummary' },
					$DefType: [
						{ hashTag: 'FromEra', $display: { role: 'rangeStart' } },
						{ hashTag: 'ToEra', $display: { role: 'rangeEnd' } },
						{ hashTag: 'InEra', $display: { role: 'representativePoint' } },
						{ hashTag: 'about_JP', $display: { role: 'preferredLabel' } },
						{ hashTag: 'about_EN', $display: { role: 'preferredLabelAlt' } }
					]
				}
			}
		}),
		readWorkType: async () => ({ $DefType: [] })
	};
}

describe('enrichment wrapper summaries', () => {
	it('stores day and story era summaries under _enrichment.wrapperSummaries', async () => {
		const proc = new EnrichmentProcessor(createDataFetcher(), testConfig);
		const [enriched] = await proc.enrichRecords([
			{
				BirthDay: {
					Day: { Month: 8, DayOfMonth: 15 },
					DayAbout: '誕生日'
				},
				StoryEra: {
					InEra: [{ EraGen: 9, YearInEra: 3 }, { byRealYear: 2050 }]
				}
			}
		], '#Works_Test', 'Primary');

		expect(enriched._enrichment?.wrapperSummaries).toEqual({
			BirthDay: '8月15日（誕生日）',
			StoryEra: '第9創世紀3年 / 西暦2050年'
		});
	});

	it('uses meta/vars role definitions for Day summary in SW enrich path', async () => {
		const proc = new EnrichmentProcessor({
			readGeneralVarsDefGlobal: async () => ({
				$Def_Day: {
					$display: { wrapper: 'daySummary' },
					$DefType: [
						{ hashTag: 'MM', $display: { role: 'month' } },
						{ hashTag: 'DD', $display: { role: 'dayOfMonth' } },
						{ hashTag: 'Note', $display: { role: 'annotation' } }
					]
				}
			}),
			readGeneralVarsDefWork: async () => ({}),
			readGlobalMeta: async () => ({ CreationWorks: {} }),
			readGlobalType: async () => ({
				$DefType: [
					{ hashTag: 'BirthDay', $type: '$Def_Day', hashTag_JP: '誕生日' }
				]
			}),
			readWorkType: async () => ({ $DefType: [] })
		}, testConfig);

		const [enriched] = await proc.enrichRecords([
			{
				BirthDay: {
					Day: { MM: 1, DD: 7 },
					Note: '記念日'
				}
			}
		], '#Works_Test', 'Primary');

		expect(enriched._enrichment?.wrapperSummaries).toEqual({
			BirthDay: '1月7日（記念日）'
		});
	});

	it('includes Day/Era/Area family fields in searchableText via typedef', async () => {
		const proc = new EnrichmentProcessor({
			readGeneralVarsDefGlobal: async () => ({}),
			readGeneralVarsDefWork: async () => ({}),
			readGlobalMeta: async () => ({ CreationWorks: {} }),
			readGlobalType: async () => ({
				$DefType: [
					{ hashTag: 'BirthDay', $type: '$Def_Day' },
					{ hashTag: 'StoryEra', $type: '$Def_StoryEraCatalog|#Null' },
					{ hashTag: 'FromArea', $type: '$Def_BaseArea' },
					{ hashTag: 'Belonging', $type: '$Def_Faction[]', $dict: 'Faction' }
				]
			}),
			readWorkType: async () => ({ $DefType: [] })
		}, testConfig);

		const [enriched] = await proc.enrichRecords([
			{
				BirthDay: { Day: { Month: 3, DayOfMonth: 14 } },
				StoryEra: { InEra: [{ byRealYear: 2050 }] },
				FromArea: { Area: '九蓮国' },
				Belonging: [{ Faction: '百花繚乱研究所' }]
			}
		], '#Works_Test', 'Primary');

		const searchable = String(enriched._enrichment?.searchableText || '');
		expect(searchable).toContain('百花繚乱研究所');
		expect(searchable).toContain('九蓮国');
		expect(searchable).toContain('2050');
	});
});

describe('enrichment image path hints (typedef-driven, named $Def_* refs)', () => {
	function createTailsUnitDataFetcher() {
		return {
			readGeneralVarsDefGlobal: async () => ({}),
			readGeneralVarsDefWork: async () => ({
				$Def_TailsUnit: {
					$DefType: [
						{ hashTag: 'TailShapeType', $type: '#ListIndex' },
						{ hashTag: 'Count', $type: '#Number' },
						{
							hashTag: 'TailsUnit_PNGName',
							$type: '#PNGFileName|#Null',
							$subfolder: 'attr/tailsUnit'
						}
					]
				}
			}),
			readGlobalMeta: async () => ({ CreationWorks: {} }),
			readGlobalType: async () => ({ $DefType: [] }),
			readWorkType: async () => ({
				$DefType: [
					{
						hashTag: 'TailsUnit',
						$type: '$Def_TailsUnit[]',
						hashTag_JP: '尻尾ユニット',
						$display: { sectionWrapper: 'tailsUnitSection' }
					}
				]
			})
		};
	}

	it('resolves image fields nested inside a named $Def_* type reference (e.g. "$Def_TailsUnit[]")', async () => {
		const proc = new EnrichmentProcessor(createTailsUnitDataFetcher(), testConfig);
		const ctx = await proc.getWorkContext('#Works_TailsUnitImageHintTest');

		const hint = (ctx.indices?.imagePathHints || []).find((h) => h.path === 'TailsUnit.TailsUnit_PNGName');
		expect(hint).toBeDefined();
		expect(hint.key).toBe('TailsUnit_PNGName');
	});

	it('prefers an explicit $subfolder declaration over the regex-inferred _PNG prefix folder hint', async () => {
		const proc = new EnrichmentProcessor(createTailsUnitDataFetcher(), testConfig);
		const ctx = await proc.getWorkContext('#Works_TailsUnitImageHintTest2');

		const hint = (ctx.indices?.imagePathHints || []).find((h) => h.path === 'TailsUnit.TailsUnit_PNGName');
		// キー名から機械的に推測すると 'TailsUnit' になるはずだが、$subfolder 明示があるためそちらを優先する
		expect(hint?.folderHint).toBe('attr/tailsUnit');
	});

	it('still falls back to the regex-inferred folder hint when $subfolder is absent', async () => {
		const proc = new EnrichmentProcessor({
			readGeneralVarsDefGlobal: async () => ({}),
			readGeneralVarsDefWork: async () => ({}),
			readGlobalMeta: async () => ({ CreationWorks: {} }),
			readGlobalType: async () => ({
				$DefType: [
					{ hashTag: 'concept_PNGName', $type: '#PNGFileName|#Null', hashTag_JP: '設定原画' }
				]
			}),
			readWorkType: async () => ({ $DefType: [] })
		}, testConfig);
		const ctx = await proc.getWorkContext('#Works_TailsUnitImageHintTest3');

		const hint = (ctx.indices?.imagePathHints || []).find((h) => h.path === 'concept_PNGName');
		expect(hint?.folderHint).toBe('concept');
	});
});
