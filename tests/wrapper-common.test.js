/**
 * wrapper-common.js の最小レジストリ回帰テスト
 *
 * Day / Era / StoryEra の built-in wrapper が登録され、
 * role ベースの summary 整形を単体で呼び出せることを確認する。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);

function loadJson(relPath) {
	return JSON.parse(readFileSync(join(repoRoot, relPath), 'utf-8'));
}

beforeAll(async () => {
	const moduleUrl = `${pathToFileURL(join(repoRoot, 'lib/wrapper-common.js')).href}?wrapper-common-test=${Date.now()}`;
	await import(moduleUrl);
});

describe('wrapper-common registry', () => {
	it('registers built-in wrappers', () => {
		const registry = globalThis.CharacterValueWrapperRegistry;
		expect(registry).toBeTruthy();

		const wrapperNames = registry.getRegisteredWrappers().map((wrapper) => wrapper.name).sort();
		expect(wrapperNames).toEqual(['daySummary', 'eraSummary', 'storyEraSummary']);
	});

	it('resolves StoryEra / Era / Day wrappers from schema display metadata', () => {
		const registry = globalThis.CharacterValueWrapperRegistry;
		const globalTypeDef = loadJson('data/db_type.json');
		const globalDefMeta = loadJson('data/db_meta.json');

		expect(registry.resolveWrapperName({
			schemaType: '$Def_StoryEraCatalog|#Null',
			typeSources: [globalTypeDef]
		})).toBe('storyEraSummary');

		expect(registry.resolveWrapperName({
			schemaType: '$Def_Day',
			typeSources: [globalDefMeta, globalTypeDef]
		})).toBe('daySummary');

		expect(registry.resolveWrapperName({
			schemaType: '$Def_StoryEra|#Null',
			typeSources: [globalTypeDef]
		})).toBe('eraSummary');
	});

	it('formats a standalone era point summary', () => {
		const registry = globalThis.CharacterValueWrapperRegistry;
		const globalTypeDef = loadJson('data/db_type.json');
		const summary = registry.formatWithRegisteredWrapper(
			{ EraGen: 9, YearInEra: 3, byRealYear: 2050 },
			{
				schemaType: '$Def_StoryEra|#Null',
				defName: '$Def_StoryEra',
				typeSources: [globalTypeDef]
			}
		);

		expect(summary).toBe('第9創世紀3年 / 西暦2050年');
	});

	it('formats story era summaries from structured role-aware points', () => {
		const registry = globalThis.CharacterValueWrapperRegistry;
		const globalTypeDef = loadJson('data/db_type.json');
		const summary = registry.formatWithRegisteredWrapper(
			{
				InEra: [
					{
						EraGen: 9,
						YearInEra: 3,
						byRealYear: 2050
					}
				]
			},
			{
				schemaType: '$Def_StoryEraCatalog|#Null',
				defName: '$Def_StoryEraCatalog',
				typeSources: [globalTypeDef]
			}
		);

		expect(summary).toBe('第9創世紀3年 / 西暦2050年');
	});

	it('formats wrapped day summaries with annotation', () => {
		const registry = globalThis.CharacterValueWrapperRegistry;
		const globalTypeDef = loadJson('data/db_type.json');
		const summary = registry.formatWithRegisteredWrapper(
			{
				Day: {
					Month: 8,
					DayOfMonth: 15
				},
				DayAbout_JP: '誕生日'
			},
			{
				schemaType: '$Def_Day',
				defName: '$Def_Day',
				typeSources: [globalTypeDef]
			}
		);

		expect(summary).toBe('8月15日（誕生日）');
	});

	it('formats wrapped day summaries in English when pageLang=en', () => {
		const registry = globalThis.CharacterValueWrapperRegistry;
		const globalTypeDef = loadJson('data/db_type.json');
		const summary = registry.formatWithRegisteredWrapper(
			{
				Day: {
					Month: 5,
					DayOfMonth: 19
				},
				DayAbout_EN: 'Birthday (as ALPBETS)'
			},
			{
				schemaType: '$Def_Day',
				defName: '$Def_Day',
				typeSources: [globalTypeDef],
				pageLang: 'en'
			}
		);

		expect(summary).toBe('May.19（Birthday (as ALPBETS)）');
	});
});
