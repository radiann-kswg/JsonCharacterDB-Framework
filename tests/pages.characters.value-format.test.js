/**
 * formatValueForDisplay から巻き上げた純粋ヘルパーのユニットテスト
 *
 * これらはもともと formatValueForDisplay の内部クロージャで、呼び出しごとに
 * 再生成されていたため単体では検証できなかった。モジュールスコープへ移したことで
 * 分岐（英語序数の 11th/12th/13th 例外、enum の表示形式 4 種、単位の言語別付与など）を
 * 直接突けるようになったので、その分岐をここで固定する。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

let helpers;
let dom;

beforeAll(async () => {
	// characters.js はトップレベルで DOM / localStorage を触るため jsdom を先に立てる
	dom = new JSDOM('<!DOCTYPE html><html lang="ja"><body></body></html>', {
		url: 'http://127.0.0.1:5500/pages/characters.html'
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.location = dom.window.location;
	globalThis.history = dom.window.history;
	globalThis.Node = dom.window.Node;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.Event = dom.window.Event;
	globalThis.CustomEvent = dom.window.CustomEvent;
	globalThis.sessionStorage = dom.window.sessionStorage;
	globalThis.localStorage = dom.window.localStorage;
	globalThis.URL = dom.window.URL;
	globalThis.URLSearchParams = dom.window.URLSearchParams;
	Object.defineProperty(globalThis, 'navigator', {
		value: dom.window.navigator,
		configurable: true,
		writable: true
	});
	globalThis.fetch = async () => {
		throw new Error('Unexpected fetch in pages.characters.value-format.test.js');
	};

	const mod = await import(pathToFileURL(join(repoRoot, 'pages', 'characters.js')).href);
	helpers = mod.__getValueFormatHelpersForTest();
});

afterAll(() => {
	dom?.window?.close();
});

describe('toEnglishOrdinal', () => {
	it('通常の 1/2/3 は st/nd/rd', () => {
		const { toEnglishOrdinal } = helpers;
		expect(toEnglishOrdinal(1)).toBe('1st');
		expect(toEnglishOrdinal(2)).toBe('2nd');
		expect(toEnglishOrdinal(3)).toBe('3rd');
		expect(toEnglishOrdinal(4)).toBe('4th');
	});

	it('11/12/13 は例外的に th（21/22/23 は st/nd/rd に戻る）', () => {
		const { toEnglishOrdinal } = helpers;
		expect(toEnglishOrdinal(11)).toBe('11th');
		expect(toEnglishOrdinal(12)).toBe('12th');
		expect(toEnglishOrdinal(13)).toBe('13th');
		expect(toEnglishOrdinal(21)).toBe('21st');
		expect(toEnglishOrdinal(22)).toBe('22nd');
		expect(toEnglishOrdinal(23)).toBe('23rd');
		expect(toEnglishOrdinal(111)).toBe('111th');
	});

	it('整数として読めない値は空文字', () => {
		const { toEnglishOrdinal } = helpers;
		expect(toEnglishOrdinal(null)).toBe('');
		expect(toEnglishOrdinal(undefined)).toBe('');
		expect(toEnglishOrdinal('abc')).toBe('');
		expect(toEnglishOrdinal('1.5')).toBe('');
		expect(toEnglishOrdinal('')).toBe('');
	});
});

describe('applyDisplayUnit', () => {
	const D = { unit: 'cm', unit_JP: 'センチ', unit_EN: 'cm' };

	it('JP は値と単位を詰めて連結する', () => {
		expect(helpers.applyDisplayUnit('170', D, 'jp')).toBe('170センチ');
	});

	it('EN は空白区切りで連結する', () => {
		expect(helpers.applyDisplayUnit('170', D, 'en')).toBe('170 cm');
	});

	it('mix は言語非依存の unit を使う', () => {
		expect(helpers.applyDisplayUnit('170', D, 'mix')).toBe('170 cm');
	});

	it('unit_EN_ordinal 宣言時は EN のみ序数化する', () => {
		const ord = { unit_EN: 'Arcanum', unit_EN_ordinal: true, unit_JP: '番アルカナ' };
		expect(helpers.applyDisplayUnit('17', ord, 'en')).toBe('17th Arcanum');
		expect(helpers.applyDisplayUnit('17', ord, 'jp')).toBe('17番アルカナ');
	});

	it('単位宣言が無ければ素の値を返す', () => {
		expect(helpers.applyDisplayUnit('170', {}, 'jp')).toBe('170');
		expect(helpers.applyDisplayUnit('170', null, 'jp')).toBe('170');
	});

	it('空値は空文字（単位だけが残らない）', () => {
		expect(helpers.applyDisplayUnit('', D, 'jp')).toBe('');
		expect(helpers.applyDisplayUnit(null, D, 'jp')).toBe('');
	});
});

describe('formatEnumCodeWithAbout / normalizeEnumFormat / pickEnumFormat', () => {
	it('形式未指定なら about の有無で alphaLabel 相当 / alpha を切り替える', () => {
		const { formatEnumCodeWithAbout } = helpers;
		expect(formatEnumCodeWithAbout('S', '最高', '')).toBe('S（最高）');
		expect(formatEnumCodeWithAbout('S', '', '')).toBe('S');
	});

	it('4 種の表示形式をそれぞれ反映する', () => {
		const { formatEnumCodeWithAbout } = helpers;
		expect(formatEnumCodeWithAbout('S', '最高', 'alpha')).toBe('S');
		expect(formatEnumCodeWithAbout('S', '最高', 'label')).toBe('最高');
		expect(formatEnumCodeWithAbout('S', '最高', 'alphaLabel')).toBe('S（最高）');
		expect(formatEnumCodeWithAbout('S', '最高', 'labelAlpha')).toBe('最高（S）');
	});

	it('label 指定でも about が無ければコードへフォールバック', () => {
		expect(helpers.formatEnumCodeWithAbout('S', '', 'label')).toBe('S');
	});

	it('コードが空なら空文字', () => {
		expect(helpers.formatEnumCodeWithAbout('', '最高', 'label')).toBe('');
	});

	it('normalizeEnumFormat は綴り揺れ（code / codeLabel / labelCode）を吸収する', () => {
		const { normalizeEnumFormat } = helpers;
		expect(normalizeEnumFormat('code')).toBe('alpha');
		expect(normalizeEnumFormat('codeLabel')).toBe('alphaLabel');
		expect(normalizeEnumFormat('labelCode')).toBe('labelAlpha');
		expect(normalizeEnumFormat('unknown')).toBe('');
	});

	it('pickEnumFormat は Rank/Rarity/Decave の専用キーを enumFormat より優先する', () => {
		const { pickEnumFormat } = helpers;
		const d = { enumFormat: 'alpha', rankFormat: 'label', rarityFormat: 'labelAlpha' };
		expect(pickEnumFormat(d, 'Rank')).toBe('label');
		expect(pickEnumFormat(d, 'Rarity')).toBe('labelAlpha');
		expect(pickEnumFormat(d, 'GenderType')).toBe('alpha');
		expect(pickEnumFormat(null, 'Rank')).toBe('');
	});
});

describe('pickAboutByLang', () => {
	it('言語に応じて about_JP / about_EN を選び、無ければもう一方へ落ちる', () => {
		const { pickAboutByLang } = helpers;
		const both = { about_JP: '和', about_EN: 'en' };
		expect(pickAboutByLang(both, 'jp')).toBe('和');
		expect(pickAboutByLang(both, 'en')).toBe('en');
		expect(pickAboutByLang({ about_EN: 'en' }, 'jp')).toBe('en');
		expect(pickAboutByLang({ about: '素' }, 'jp')).toBe('素');
		expect(pickAboutByLang({}, 'jp')).toBe('');
		expect(pickAboutByLang(null, 'jp')).toBe('');
	});
});

describe('extractEnumValueParts', () => {
	it('プリミティブ値と注釈を分離する', () => {
		expect(helpers.extractEnumValueParts({ GenderType: 'Male', about_JP: '男性' }, 'GenderType', 'jp'))
			.toEqual({ code: 'Male', about: '男性' });
	});

	it('注釈が無ければ code だけを返す', () => {
		expect(helpers.extractEnumValueParts({ GenderType: 'Male' }, 'GenderType', 'jp'))
			.toEqual({ code: 'Male' });
	});

	it('hideText はマスク情報としてそのまま返す', () => {
		expect(helpers.extractEnumValueParts({ Rank: { hideText: '???' } }, 'Rank', 'jp'))
			.toEqual({ hideText: '???' });
	});

	it('ネストした { Rank: { Rank, about } } も解ける', () => {
		expect(helpers.extractEnumValueParts({ Rank: { Rank: 'A', about_JP: '高い' } }, 'Rank', 'jp'))
			.toEqual({ code: 'A', about: '高い' });
	});

	it('対象キーが無い / enum 名が空なら null', () => {
		const { extractEnumValueParts } = helpers;
		expect(extractEnumValueParts({ Other: 'x' }, 'Rank', 'jp')).toBeNull();
		expect(extractEnumValueParts({ Rank: 'A' }, '', 'jp')).toBeNull();
		expect(extractEnumValueParts(null, 'Rank', 'jp')).toBeNull();
	});
});

describe('schemaTypeIncludes / pickEnumNameFromSchemaType', () => {
	it('文字列・配列・{ $type } のいずれでも型名を拾う', () => {
		const { schemaTypeIncludes } = helpers;
		expect(schemaTypeIncludes('#Index', '#Index')).toBe(true);
		expect(schemaTypeIncludes(['#String', '#Index'], '#Index')).toBe(true);
		expect(schemaTypeIncludes({ $type: '#Index' }, '#Index')).toBe(true);
		expect(schemaTypeIncludes('#String', '#Index')).toBe(false);
		expect(schemaTypeIncludes(null, '#Index')).toBe(false);
		expect(schemaTypeIncludes('#Index', '')).toBe(false);
	});

	it('$EnumDef_withAbout は enum 名として扱わない（辞書解決を潰さないため）', () => {
		const { pickEnumNameFromSchemaType } = helpers;
		expect(pickEnumNameFromSchemaType('$EnumDef_Rank')).toBe('Rank');
		expect(pickEnumNameFromSchemaType('$EnumDef_withAbout')).toBe('');
		expect(pickEnumNameFromSchemaType('#String')).toBe('');
	});
});

describe('findNestedKey / formatSearchPairs / readListLinkDisplayOpt', () => {
	it('findNestedKey はネストを辿って目的のキーを返す', () => {
		const { findNestedKey } = helpers;
		expect(findNestedKey({ a: { b: { '#ListLink_X': [1] } } }, '#ListLink_X')).toEqual([1]);
		expect(findNestedKey({ a: 1 }, '#ListLink_X')).toBeNull();
	});

	it('findNestedKey は深すぎるネストを打ち切る（無限走査の防止）', () => {
		let deep = { target: 'found' };
		for (let i = 0; i < 10; i++) deep = { nest: deep };
		expect(helpers.findNestedKey(deep, 'target')).toBeNull();
	});

	it('formatSearchPairs は hashTag=key 形式へ整形する', () => {
		const { formatSearchPairs } = helpers;
		expect(formatSearchPairs([{ hashTag: 'DayAbout', key: '誕生日' }])).toBe('DayAbout=誕生日');
		expect(formatSearchPairs([{ hashTag: 'A', key: 1 }, { hashTag: 'B' }])).toBe('A=1, B');
		expect(formatSearchPairs([])).toBe('');
		expect(formatSearchPairs(null)).toBe('');
	});

	it('readListLinkDisplayOpt は showEnum を既定 true で返す', () => {
		const { readListLinkDisplayOpt } = helpers;
		expect(readListLinkDisplayOpt(null)).toEqual({ showEnum: true, enumName: '' });
		expect(readListLinkDisplayOpt({ listLinkShowEnum: false, listLinkEnumName: ' Rank ' }))
			.toEqual({ showEnum: false, enumName: 'Rank' });
	});
});
