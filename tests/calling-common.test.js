/**
 * [calling-common.test.js] - lib/basic-renders/calling-common.js の純関数ユニットテスト
 * @description
 *   呼称 DSL の解析（parseCalling）・整形（formatCallingText）が、デリミタ階層・こそあど記法・
 *   参照記法・末尾注釈を正しく扱うことを合成入力で検証する。DOM は使わない（純関数テスト）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import '../lib/basic-renders/calling-common.js';

/** @type {any} */
let CC;
beforeAll(() => {
	CC = globalThis.CallingCommon;
});

describe('CallingCommon.parseCalling', () => {
	it('三人称「彼/彼女」を並列候補として両方保持する（GenderType 非依存）', () => {
		const parsed = CC.parseCalling('彼/彼女', { lang: 'jp' });
		expect(parsed.contexts).toHaveLength(1);
		const tokens = parsed.contexts[0].categories[0].tokens;
		expect(tokens.map((t) => t.text)).toEqual(['彼', '彼女']);
		expect(tokens[0].sepAfter).toBe('/');
		expect(tokens[1].sepAfter).toBeNull();
		// いずれも plain（GenderType 分岐で片方を落としたりしない）
		expect(tokens.every((t) => t.type === 'plain')).toBe(true);
	});

	it('`*xxx` こそあど記法を人間可読ラベルへ展開する（type=demo）', () => {
		const parsed = CC.parseCalling('*の子,*の人', { lang: 'jp' });
		const tokens = parsed.contexts[0].categories[0].tokens;
		expect(tokens.map((t) => t.text)).toEqual(['その子/この子系', 'その人/この人系']);
		expect(tokens.every((t) => t.type === 'demo')).toBe(true);
		expect(tokens[0].sepAfter).toBe(',');
	});

	it('JP `[※xxx]` 参照ラベルを展開する（type=ref）', () => {
		const parsed = CC.parseCalling('[※名前呼び]', { lang: 'jp' });
		const tok = parsed.contexts[0].categories[0].tokens[0];
		expect(tok.text).toBe('名前呼び');
		expect(tok.type).toBe('ref');
		expect(tok.raw).toBe('[※名前呼び]');
	});

	it('EN `[*xxx]` 参照ラベルを展開する（lang=en）', () => {
		const parsed = CC.parseCalling('[*by name]', { lang: 'en' });
		const tok = parsed.contexts[0].categories[0].tokens[0];
		expect(tok.text).toBe('by name');
		expect(tok.type).toBe('ref');
	});

	it('`;` でカテゴリ、`\\n` で文脈、末尾 `※` で注釈を分離する', () => {
		const parsed = CC.parseCalling('彼/彼女;[※名前呼び]\n君 ※親しい相手', { lang: 'jp' });
		expect(parsed.contexts).toHaveLength(2);
		// context 1: 2 カテゴリ
		expect(parsed.contexts[0].categories).toHaveLength(2);
		expect(parsed.contexts[0].note).toBeNull();
		// context 2: 注釈付き
		expect(parsed.contexts[1].note).toBe('親しい相手');
		expect(parsed.contexts[1].categories[0].tokens[0].text).toBe('君');
	});

	it('空文字列・非文字列は空の contexts を返す', () => {
		expect(CC.parseCalling('', { lang: 'jp' }).contexts).toEqual([]);
		expect(CC.parseCalling('   ', { lang: 'jp' }).contexts).toEqual([]);
		expect(CC.parseCalling(null).contexts).toEqual([]);
		expect(CC.parseCalling(undefined).contexts).toEqual([]);
	});
});

describe('CallingCommon.formatCallingText / decodeCallingToText', () => {
	it('カテゴリを `・`、代替候補の区切り（/ ,）を維持して整形する', () => {
		const text = CC.decodeCallingToText('彼/彼女;[※名前呼び]', { lang: 'jp' });
		expect(text).toBe('彼/彼女・名前呼び');
	});

	it('末尾注釈を `（※...）` として付加する', () => {
		const text = CC.decodeCallingToText('君 ※親しい相手', { lang: 'jp' });
		expect(text).toBe('君（※親しい相手）');
	});

	it('複数文脈を ctxSep で連結する', () => {
		const text = CC.decodeCallingToText('私\nぼく', { lang: 'jp' });
		expect(text).toBe('私 ／ ぼく');
	});

	it('空入力は空文字列を返す', () => {
		expect(CC.formatCallingText({ contexts: [] })).toBe('');
		expect(CC.formatCallingText(null)).toBe('');
	});
});

describe('CallingCommon 低レベルヘルパ', () => {
	it('splitTopLevel は括弧の深さを考慮してトップレベルのみ分割する', () => {
		expect(CC.splitTopLevel('he/she; (a/b); c', ';')).toEqual(['he/she', '(a/b)', 'c']);
	});

	it('extractNote は末尾 `※` 注釈を分離する', () => {
		expect(CC.extractNote('彼 ※フォーマル')).toEqual({ main: '彼', note: 'フォーマル' });
		expect(CC.extractNote('彼')).toEqual({ main: '彼', note: null });
	});

	it('tokenize は種別（ref/demo/plain）を判定する', () => {
		expect(CC.tokenize('[※二人称]', true).type).toBe('ref');
		expect(CC.tokenize('*れ', true).type).toBe('demo');
		expect(CC.tokenize('私', true).type).toBe('plain');
	});
});
