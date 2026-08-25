/**
 * [type-common.test.js] - lib/basic-renders/type-common.js の純関数ユニットテスト
 * @description
 *   $EnumDef_* / #List_* による enum/辞書コードのラベル解決（resolveVarsDefLabel /
 *   resolveVarsDefLabelPack）と補助関数（normalizeVarsDefKey / mergeVarsDefLayers）を
 *   合成した $VarsDef で検証する。DOM・現在言語には依存しない（純関数テスト）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import '../lib/basic-renders/type-common.js';

/** @type {any} */
let TR;
beforeAll(() => {
	TR = globalThis.TypeResolver;
});

/** GenderType/RaceType の合成 $EnumDef / #List を持つ globalDefType */
const globalDefType = {
	General: {
		$VarsDef: {
			$EnumDef_GenderType: {
				'#Neutral': { GenderType: 'Neutral', GenderType_JP: '中性', GenderType_EN: 'Neutral' },
				'#FemaleNeutral': { GenderType: 'FemaleNeutral', GenderType_JP: '女性中性', GenderType_EN: 'Female-Neutral' },
			},
			'#List_RaceType': [
				{ RaceType: 'Fox', RaceType_JP: '狐', RaceType_EN: 'Fox' },
				{ RaceType: 'FangSpeeder', RaceType_JP: '牙駆', RaceType_EN: '' },
			],
		},
	},
};

describe('TypeResolver.resolveVarsDefLabel', () => {
	it('$EnumDef からコードを JP ラベルへ解決する（GenderType）', () => {
		expect(TR.resolveVarsDefLabel('GenderType', 'Neutral', globalDefType)).toBe('中性');
	});

	it('#List からコードを JP ラベルへ解決する（RaceType）', () => {
		expect(TR.resolveVarsDefLabel('RaceType', 'Fox', globalDefType)).toBe('狐');
	});

	it('辞書に無いコードは raw をそのまま返す', () => {
		expect(TR.resolveVarsDefLabel('GenderType', 'Unknown', globalDefType)).toBe('Unknown');
	});

	it('辞書ソースが無ければ raw を返す', () => {
		expect(TR.resolveVarsDefLabel('GenderType', 'Neutral', null, null)).toBe('Neutral');
	});

	it('空値は空文字列を返す', () => {
		expect(TR.resolveVarsDefLabel('GenderType', '', globalDefType)).toBe('');
		expect(TR.resolveVarsDefLabel('GenderType', null, globalDefType)).toBe('');
	});
});

describe('TypeResolver.resolveVarsDefLabelPack', () => {
	it('JP/EN/raw のパックを返す', () => {
		const pack = TR.resolveVarsDefLabelPack('GenderType', 'Neutral', globalDefType);
		expect(pack).toEqual({ raw: 'Neutral', jp: '中性', en: 'Neutral' });
	});

	it('`#` 付きコードでも直接キー引きで解決する', () => {
		const pack = TR.resolveVarsDefLabelPack('GenderType', '#FemaleNeutral', globalDefType);
		expect(pack.jp).toBe('女性中性');
		expect(pack.en).toBe('Female-Neutral');
	});

	it('EN 欠落エントリは raw をフォールバックにする（創作補完しない）', () => {
		const pack = TR.resolveVarsDefLabelPack('RaceType', 'FangSpeeder', globalDefType);
		expect(pack.jp).toBe('牙駆');
		// RaceType_EN が空なので raw（コード）へフォールバック（勝手に訳語を作らない）
		expect(pack.en).toBe('FangSpeeder');
	});

	it('未解決は null を返す', () => {
		expect(TR.resolveVarsDefLabelPack('GenderType', 'Unknown', globalDefType)).toBeNull();
	});
});

describe('TypeResolver.normalizeVarsDefKey', () => {
	it('言語サフィックスを除去してベースキーへ正規化する', () => {
		expect(TR.normalizeVarsDefKey('GenderType_JP')).toBe('GenderType');
		expect(TR.normalizeVarsDefKey('RaceType_EN')).toBe('RaceType');
		expect(TR.normalizeVarsDefKey('GenderType')).toBe('GenderType');
	});
});

describe('TypeResolver.mergeVarsDefLayers', () => {
	it('配列は連結、object は浅くマージする（同名 #List_* を消さない）', () => {
		const merged = TR.mergeVarsDefLayers(
			{ '#List_Class': [{ Class: 'A' }], $EnumDef_X: { a: 1 } },
			{ '#List_Class': [{ Class: 'B' }], $EnumDef_X: { b: 2 } },
		);
		expect(merged['#List_Class']).toHaveLength(2);
		expect(merged.$EnumDef_X).toEqual({ a: 1, b: 2 });
	});

	it('非オブジェクト source は無視する', () => {
		expect(TR.mergeVarsDefLayers(null, undefined, { a: 1 })).toEqual({ a: 1 });
	});
});
