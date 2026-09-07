/**
 * lib/relations-locator.js（相関図の圧縮ロケータ `r=`）の単体テスト
 *
 * `pages/relations.js` はブラウザ専用（Cytoscape 依存）で Node から import できないため、
 * URL 文法の境界条件はこの純関数側で固定する。
 * 値の意味付け（作品コード → 作品ID、辞書 code → 軸の値）は relations.js の `resolveLocators()` が担う。
 */
import { describe, it, expect } from 'vitest';
import {
	RELATIONS_LOCATOR_PARAM,
	RELATIONS_DEFAULT_MAP,
	parseRelationsLocator,
	buildRelationsLocator
} from '../lib/relations-locator.js';

describe('定数', () => {
	it('クエリキーは `r`、既定マップは `own`', () => {
		expect(RELATIONS_LOCATOR_PARAM).toBe('r');
		expect(RELATIONS_DEFAULT_MAP).toBe('own');
	});
});

describe('parseRelationsLocator', () => {
	it('先頭がマップ語ならマップとして読む', () => {
		expect(parseRelationsLocator('shared/NTS/100BL')).toEqual({ map: 'shared', segments: ['NTS', '100BL'] });
		expect(parseRelationsLocator('own/NTS')).toEqual({ map: 'own', segments: ['NTS'] });
		expect(parseRelationsLocator('shared')).toEqual({ map: 'shared', segments: [] });
	});

	it('マップ語が無ければ own として全セグメントを経路にする', () => {
		expect(parseRelationsLocator('NTS/100BL')).toEqual({ map: 'own', segments: ['NTS', '100BL'] });
	});

	it('空値・空セグメント・前後空白を落とす', () => {
		expect(parseRelationsLocator('')).toEqual({ map: 'own', segments: [] });
		expect(parseRelationsLocator('//NTS//')).toEqual({ map: 'own', segments: ['NTS'] });
		expect(parseRelationsLocator(' NTS / 100BL ')).toEqual({ map: 'own', segments: ['NTS', '100BL'] });
	});

	it('値に含まれる `/`（%2F 退避）を戻す', () => {
		expect(parseRelationsLocator('NTS/A%2FB').segments).toEqual(['NTS', 'A/B']);
		expect(parseRelationsLocator('NTS/A%2fB').segments).toEqual(['NTS', 'A/B']);
	});

	it('生値（日本語）のセグメントもそのまま通す（辞書 code が無い軸のフォールバック）', () => {
		expect(parseRelationsLocator('NTS/百花繚乱研究所').segments).toEqual(['NTS', '百花繚乱研究所']);
	});
});

describe('buildRelationsLocator', () => {
	it('既定マップ own は省略する', () => {
		expect(buildRelationsLocator({ map: 'own', segments: ['NTS', '100BL'] })).toBe('NTS/100BL');
		expect(buildRelationsLocator({ segments: ['NTS'] })).toBe('NTS');
	});

	it('shared は先頭に付ける（経路が無くても付ける）', () => {
		expect(buildRelationsLocator({ map: 'shared', segments: ['NTS'] })).toBe('shared/NTS');
		expect(buildRelationsLocator({ map: 'shared' })).toBe('shared');
	});

	it('own で経路も無ければ空文字（クエリに載せない）', () => {
		expect(buildRelationsLocator({})).toBe('');
		expect(buildRelationsLocator()).toBe('');
	});

	it('不明なマップは own に倒す', () => {
		expect(buildRelationsLocator({ map: 'weird', segments: ['NTS'] })).toBe('NTS');
	});

	it('値に含まれる `/` を %2F へ退避し、空セグメントを落とす', () => {
		expect(buildRelationsLocator({ segments: ['NTS', 'A/B', '', null] })).toBe('NTS/A%2FB');
	});
});

describe('往復（build → parse）', () => {
	const cases = [
		{ map: 'own', segments: ['NTS'] },
		{ map: 'own', segments: ['NTS', '100BL', '-'] },
		{ map: 'shared', segments: ['FLI', 'M'] },
		{ map: 'shared', segments: [] },
		{ map: 'own', segments: ['NTS', 'A/B', '百花繚乱研究所'] }
	];
	for (const input of cases) {
		it(`${JSON.stringify(input)} が往復しても同じ組に解決する`, () => {
			expect(parseRelationsLocator(buildRelationsLocator(input))).toEqual(input);
		});
	}
});
