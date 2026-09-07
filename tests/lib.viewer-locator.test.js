/**
 * lib/viewer-locator.js（ビューア直リンクの URL 文法）の単体テスト
 *
 * `pages/characters.js` から切り出した純関数群を、DOM を一切用意せずに直接検証する。
 * 既存の `tests/pages.characters.url-params.test.js` は jsdom を立てて `location` 経由の
 * 往復（`getQS()` 込み）を見ているのに対し、こちらは文法そのものの境界条件を細かく固定する。
 *
 * 相関図ページ（`pages/relations.html`）も同じモジュールを使うため、
 * ここが崩れると 2 ページの直リンク解釈が同時にずれる。
 */
import { describe, it, expect } from 'vitest';
import {
	VIEWER_LOCATOR_PARAM,
	INDEX_CONDITIONS_KEY,
	workKeyForURL,
	assignByKeyPath,
	parseIndexConditionToken,
	flattenIndexConditions,
	parseIdxToken,
	buildIdxToken,
	parseViewerLocator,
	buildViewerQueryString
} from '../lib/viewer-locator.js';

describe('定数', () => {
	it('圧縮ロケータのクエリキーは `c`', () => {
		expect(VIEWER_LOCATOR_PARAM).toBe('c');
	});

	it('複合条件の予約 idxKey は `__conditions__`（_DBLink のペイロードと共用）', () => {
		expect(INDEX_CONDITIONS_KEY).toBe('__conditions__');
	});
});

describe('workKeyForURL', () => {
	it('`#Works_` / `Works_` 接頭辞を落として短縮形にする', () => {
		expect(workKeyForURL('#Works_NumberTales')).toBe('NumberTales');
		expect(workKeyForURL('Works_NumberTales')).toBe('NumberTales');
		expect(workKeyForURL('NumberTales')).toBe('NumberTales');
	});

	it('空値は空文字になる', () => {
		expect(workKeyForURL('')).toBe('');
		expect(workKeyForURL(null)).toBe('');
		expect(workKeyForURL(undefined)).toBe('');
		expect(workKeyForURL('   ')).toBe('');
	});
});

describe('assignByKeyPath', () => {
	it('ドット区切りのキーパスをネストしたオブジェクトへ展開する', () => {
		const target = {};
		expect(assignByKeyPath(target, 'Card.SuitNum', '16')).toBe(true);
		expect(target).toEqual({ Card: { SuitNum: '16' } });
	});

	it('同じ root へ複数のサブキーを積める', () => {
		const target = {};
		assignByKeyPath(target, 'Card.Suit', 'Major');
		assignByKeyPath(target, 'Card.SuitNum', '16');
		expect(target).toEqual({ Card: { Suit: 'Major', SuitNum: '16' } });
	});

	it('途中がオブジェクトでない場合は上書きしてから潜る', () => {
		const target = { Card: 'scalar' };
		assignByKeyPath(target, 'Card.Num', '7');
		expect(target).toEqual({ Card: { Num: '7' } });
	});

	it('キーパスが空、または代入先がオブジェクトでなければ false', () => {
		expect(assignByKeyPath({}, '', 'x')).toBe(false);
		expect(assignByKeyPath(null, 'Card.Num', '7')).toBe(false);
	});
});

describe('parseIndexConditionToken', () => {
	it('すべてのパートが `キーパス:値` のときだけ複合として扱う', () => {
		expect(parseIndexConditionToken('Card.Suit:Major,Card.SuitNum:16'))
			.toEqual({ Card: { Suit: 'Major', SuitNum: '16' } });
	});

	it('root を省いたサブキーも受理する', () => {
		expect(parseIndexConditionToken('Suit:Major,SuitNum:16'))
			.toEqual({ Suit: 'Major', SuitNum: '16' });
	});

	it('区切り文字を含まない単一トークンは複合ではない', () => {
		expect(parseIndexConditionToken('57')).toBeNull();
		expect(parseIndexConditionToken('Card.Num:7')).toBeNull();
	});

	it('値そのものにカンマを含む単一インデックスを壊さない', () => {
		// `Name:9,10` は 2 パート目が `キーパス:値` でないため複合と解釈しない
		expect(parseIndexConditionToken('Name:9,10')).toBeNull();
	});

	it('JSON ペイロードは対象外', () => {
		expect(parseIndexConditionToken('{"Card":{"Num":7}}')).toBeNull();
	});
});

describe('flattenIndexConditions', () => {
	it('ネストした条件を `キーパス:値` の組へ平坦化する', () => {
		expect(flattenIndexConditions({ Card: { Suit: 'Major', SuitNum: 16 } }))
			.toEqual([
				{ keyPath: 'Card.Suit', value: 'Major' },
				{ keyPath: 'Card.SuitNum', value: '16' }
			]);
	});

	it('接頭辞を付けられる', () => {
		expect(flattenIndexConditions({ Suit: 'Major' }, 'Card'))
			.toEqual([{ keyPath: 'Card.Suit', value: 'Major' }]);
	});

	it('往復できない値（配列 / 区切り文字入り / 空 / null）が混ざったら null', () => {
		expect(flattenIndexConditions({ Card: { Suit: ['Major'] } })).toBeNull();
		expect(flattenIndexConditions({ Card: { Suit: 'Ma,jor' } })).toBeNull();
		expect(flattenIndexConditions({ Card: { Suit: '' } })).toBeNull();
		expect(flattenIndexConditions({ Card: { Suit: null } })).toBeNull();
	});

	it('キーパスとして不正なキーがあれば null', () => {
		expect(flattenIndexConditions({ 'Card-Suit': 'Major' })).toBeNull();
	});

	it('オブジェクトでない入力・空オブジェクトは null', () => {
		expect(flattenIndexConditions(null)).toBeNull();
		expect(flattenIndexConditions([])).toBeNull();
		expect(flattenIndexConditions({})).toBeNull();
	});
});

describe('parseIdxToken', () => {
	it('単純な値はそのまま idx になる', () => {
		expect(parseIdxToken('57')).toEqual({ idx: '57', idxKey: '' });
	});

	it('`キーパス:値` は idx / idxKey へ分解する', () => {
		expect(parseIdxToken('Card.Num:7')).toEqual({ idx: '7', idxKey: 'Card.Num' });
		expect(parseIdxToken('Num:57')).toEqual({ idx: '57', idxKey: 'Num' });
	});

	it('複合条件は JSON へ正規化し idxKey を `__conditions__` にする', () => {
		const parsed = parseIdxToken('Suit:Major,SuitNum:16');
		expect(parsed.idxKey).toBe(INDEX_CONDITIONS_KEY);
		expect(JSON.parse(parsed.idx)).toEqual({ Suit: 'Major', SuitNum: '16' });
	});

	it('JSON ペイロードはコロンで分割しない', () => {
		const raw = '{"Card":{"Num":7}}';
		expect(parseIdxToken(raw)).toEqual({ idx: raw, idxKey: '' });
	});

	it('左辺がキーパスとして不正なら分割せず値として扱う', () => {
		// 実データでは発生しないが、`Ident:...` 形式の値を壊さないための保険
		expect(parseIdxToken('9,10')).toEqual({ idx: '9,10', idxKey: '' });
	});

	it('空値は空の組を返す', () => {
		expect(parseIdxToken('')).toEqual({ idx: '', idxKey: '' });
		expect(parseIdxToken(null)).toEqual({ idx: '', idxKey: '' });
	});
});

describe('buildIdxToken', () => {
	it('`キーパス:値` へ戻す', () => {
		expect(buildIdxToken('7', 'Card.Num')).toBe('Card.Num:7');
	});

	it('idxKey が無ければ値だけ', () => {
		expect(buildIdxToken('57', '')).toBe('57');
	});

	it('複合条件（JSON + `__conditions__`）はカンマ区切りへ戻す', () => {
		const idx = JSON.stringify({ Suit: 'Major', SuitNum: '16' });
		expect(buildIdxToken(idx, INDEX_CONDITIONS_KEY)).toBe('Suit:Major,SuitNum:16');
	});

	it('idxKey がフィールド名なら JSON 条件をその配下として組み立てる', () => {
		const idx = JSON.stringify({ Suit: 'Major', SuitNum: '16' });
		expect(buildIdxToken(idx, 'Card')).toBe('Card.Suit:Major,Card.SuitNum:16');
	});

	it('往復できない条件は空文字（呼び出し側が旧形式へ退避する合図）', () => {
		expect(buildIdxToken(JSON.stringify({ Suit: ['Major'] }), INDEX_CONDITIONS_KEY)).toBe('');
		expect(buildIdxToken('{壊れたJSON', INDEX_CONDITIONS_KEY)).toBe('');
	});

	it('値が空なら空文字', () => {
		expect(buildIdxToken('', 'Num')).toBe('');
		expect(buildIdxToken(null, 'Num')).toBe('');
	});
});

describe('parseViewerLocator', () => {
	it('`Work/Db/IdxToken` を分解する', () => {
		expect(parseViewerLocator('NumberTales/Primary/57'))
			.toEqual({ work: 'NumberTales', db: 'Primary', idx: '57', idxKey: '' });
	});

	it('キーパス付きの IdxToken を分解する', () => {
		expect(parseViewerLocator('FLInvestigator78/Primary/Card.Num:7'))
			.toEqual({ work: 'FLInvestigator78', db: 'Primary', idx: '7', idxKey: 'Card.Num' });
	});

	it('複合条件を分解する', () => {
		const parsed = parseViewerLocator('FLInvestigator78/Primary/Suit:Major,SuitNum:16');
		expect(parsed.work).toBe('FLInvestigator78');
		expect(parsed.db).toBe('Primary');
		expect(parsed.idxKey).toBe(INDEX_CONDITIONS_KEY);
		expect(JSON.parse(parsed.idx)).toEqual({ Suit: 'Major', SuitNum: '16' });
	});

	it('作品のみ / 作品+DB のみも扱える', () => {
		expect(parseViewerLocator('NumberTales'))
			.toEqual({ work: 'NumberTales', db: '', idx: '', idxKey: '' });
		expect(parseViewerLocator('NumberTales/Primary'))
			.toEqual({ work: 'NumberTales', db: 'Primary', idx: '', idxKey: '' });
	});

	it('3 セグメント目以降の `/` はインデックス値の一部として保持する', () => {
		expect(parseViewerLocator('NumberTales/Primary/a/b').idx).toBe('a/b');
	});

	it('空値は空の組を返す', () => {
		expect(parseViewerLocator(''))
			.toEqual({ work: '', db: '', idx: '', idxKey: '' });
	});
});

describe('buildViewerQueryString', () => {
	it('圧縮ロケータ 1 本にまとめる', () => {
		expect(buildViewerQueryString({ work: '#Works_NumberTales', db: 'Primary', idx: '57', idxKey: 'Num' }))
			.toBe('?c=NumberTales/Primary/Num:57');
	});

	it('`/` `:` `,` はエスケープを戻して可読性を優先する', () => {
		const qs = buildViewerQueryString({
			work: 'FLInvestigator78',
			db: 'Primary',
			idx: JSON.stringify({ Suit: 'Major', SuitNum: '16' }),
			idxKey: INDEX_CONDITIONS_KEY
		});
		expect(qs).toBe('?c=FLInvestigator78/Primary/Suit:Major,SuitNum:16');
		expect(qs).not.toContain('%2F');
		expect(qs).not.toContain('%3A');
		expect(qs).not.toContain('%2C');
	});

	it('空値のパラメータは出力しない', () => {
		expect(buildViewerQueryString({ work: 'NumberTales', db: 'Primary', q: '', lang: '' }))
			.toBe('?c=NumberTales/Primary');
	});

	it('q / lang は値があるときだけ付く', () => {
		expect(buildViewerQueryString({ work: 'NumberTales', db: 'Primary', q: '狐' }))
			.toBe('?c=NumberTales/Primary&q=%E7%8B%90');
		expect(buildViewerQueryString({ work: 'NumberTales', db: 'Primary', lang: 'en' }))
			.toBe('?c=NumberTales/Primary&lang=en');
	});

	it('db が無いと IdxToken の位置が決まらないため値を載せない', () => {
		expect(buildViewerQueryString({ work: 'NumberTales', idx: '57', idxKey: 'Num' }))
			.toBe('?c=NumberTales');
	});

	it('往復できない条件のときだけ旧形式（個別キー）へ退避する', () => {
		const qs = buildViewerQueryString({
			work: 'NumberTales',
			db: 'Primary',
			idx: JSON.stringify({ Suit: ['Major'] }),
			idxKey: INDEX_CONDITIONS_KEY
		});
		expect(qs).toContain('work=NumberTales');
		expect(qs).toContain('db=Primary');
		expect(qs).toContain('idx=');
		expect(qs).toContain(`idxKey=${INDEX_CONDITIONS_KEY}`);
		expect(qs).not.toContain('c=');
	});

	it('work が無ければ db / idx を個別キーで出す', () => {
		expect(buildViewerQueryString({ db: 'Primary', idx: '57', idxKey: 'Num' }))
			.toBe('?db=Primary&idx=Num:57');
	});

	it('何も無ければ空文字', () => {
		expect(buildViewerQueryString({})).toBe('');
		expect(buildViewerQueryString()).toBe('');
	});
});

describe('往復（parse → build → parse）', () => {
	const cases = [
		'NumberTales/Primary/57',
		'NumberTales/Primary/Num:57',
		'FLInvestigator78/Primary/Card.Num:7',
		'FLInvestigator78/Primary/Suit:Major,SuitNum:16',
		'NumberTales/Primary',
		'NumberTales'
	];

	for (const locator of cases) {
		it(`\`${locator}\` が往復しても同じ組に解決する`, () => {
			const first = parseViewerLocator(locator);
			const qs = buildViewerQueryString(first);
			const rebuilt = new URLSearchParams(qs.replace(/^\?/, '')).get(VIEWER_LOCATOR_PARAM);
			expect(parseViewerLocator(rebuilt || '')).toEqual(first);
		});
	}
});
