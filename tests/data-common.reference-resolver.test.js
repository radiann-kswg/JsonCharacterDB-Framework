/**
 * ReferenceResolver.resolveAllInAny() の早期リターン回帰テスト
 *
 * `resolveAllInAny()` は `#Works` / `#DB` のような「`#` 始まりキー × 文字列値」の参照を解決するために
 * オブジェクト木を **await 付きで深いコピー**する。実データの `db_*.json` に参照キーは現状 0 件なのに、
 * 640 レコードの bootstrap で数万回の await が走り、相関図の `/pages/v1/bootstrap` が
 * キャッシュ全命中でも 1.0 秒かかる主要因になっていた（2026-11-02 本番実測）。
 *
 * ここで守りたい性質:
 * 1. 参照キーが無い木は **同一参照のまま**返す（コピーしない・await しない）
 * 2. 参照キーがある木は従来どおり解決される（早期リターンで参照解決を壊さない）
 */
import { describe, it, expect } from 'vitest';

// data-common.js はブラウザ/SW向けにグローバル公開する設計だが、Node でも評価可能
import '../lib/data-common.js';

const { ReferenceResolver } = globalThis;

describe('ReferenceResolver.hasHashReference()', () => {
	it('`#` 始まりキー × 文字列値 を木のどこかに持つときだけ true', () => {
		expect(ReferenceResolver.hasHashReference({ Num: 1, Name_JP: 'x' })).toBe(false);
		expect(ReferenceResolver.hasHashReference([{ a: { b: [{ c: 'd' }] } }])).toBe(false);
		// `#` キーでも値が object なら参照ではない（db_meta.json の `#Works_*` / `#DB_*` コンテナと同じ形）
		expect(ReferenceResolver.hasHashReference({ '#Works_NumberTales': { Title: 'x' } })).toBe(false);
		expect(ReferenceResolver.hasHashReference({ '#Works': '#Works_NumberTales' })).toBe(true);
		expect(ReferenceResolver.hasHashReference([{ x: 1 }, { nested: { '#DB': 'Primary' } }])).toBe(true);
		expect(ReferenceResolver.hasHashReference(null)).toBe(false);
		expect(ReferenceResolver.hasHashReference('str')).toBe(false);
	});
});

describe('ReferenceResolver.resolveAllInAny()', () => {
	const makeResolver = () => new ReferenceResolver(
		{
			// `#Works` 解決が実際に readGlobalMeta 等を呼ぶ経路は本テストの対象外。
			// 参照キーがある場合に「元のオブジェクトとは別物が返る」ことだけ確かめる
			fetchJSON: async () => ({}),
			readGlobalMeta: async () => ({ CreationWorks: {} }),
			readWorkMeta: async () => ({})
		},
		{ withRepoBase: (p) => p }
	);

	it('参照キーが無いレコード配列は同一参照のまま返る（深いコピーしない）', async () => {
		const records = [
			{ Num: 1, Name_JP: 'A', Relation: [{ Num: 2 }] },
			{ Num: 2, Name_JP: 'B', Images: { corefolder: ['x.png'] } }
		];
		const out = await makeResolver().resolveAllInAny(records, new Map());
		expect(out).toBe(records);
		expect(out[0].Relation).toBe(records[0].Relation);
	});

	it('参照キーがあるときは従来どおり別オブジェクトへ解決される', async () => {
		const records = [{ Num: 1, '#Works': '#Works_NumberTales' }];
		const out = await makeResolver().resolveAllInAny(records, new Map());
		expect(out).not.toBe(records);
		expect(Array.isArray(out)).toBe(true);
		expect(out[0]).not.toBe(records[0]);
		expect(out[0].Num).toBe(1);
		expect(Object.prototype.hasOwnProperty.call(out[0], '#Works')).toBe(true);
	});
});
