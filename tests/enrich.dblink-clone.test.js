/**
 * _DBLink 参照先ルックアップの回帰テスト（参照先レコードを共有配列から切り離す）
 *
 * `readDBShared()` の配列はリクエスト内で共有される（docs/api-sw-spec.md §2.1）。照合して取り出した 1 件を
 * そのまま返すと、マージ側の in-place 書き換え（`_Commons` 適用・`normalizeListLinkWrappers` 等）が
 * 共有元へ波及し、同じ参照先を引いた別レコードに別 DB 文脈の値が混ざる。
 * ここで守るのは「戻り値を書き換えても、共有配列と次の解決結果が変わらない」ことだけ。
 */
import { describe, it, expect } from 'vitest';

// data-common.js はブラウザ/SW向けにグローバル公開する設計だが、Node でも評価可能
import '../lib/data-common.js';

const { EnrichmentProcessor } = globalThis;

const makeShared = () => [
	{ Num: 7, Name_JP: 'A', Relation: [{ Num: 8 }] },
	{ Num: 9, Name_JP: 'B' }
];

describe('_DBLink 参照先は共有配列から切り離して返す', () => {
	it('resolveDbLinkSuffixRef: 戻り値を書き換えても共有配列と次の解決結果に波及しない', async () => {
		const shared = makeShared();
		const proc = new EnrichmentProcessor({ readDBShared: async () => shared }, {});
		const entry = { Num: 7, _DB: 'Primary' };

		const first = await proc.resolveDbLinkSuffixRef(entry, '#Works_NumberTales', 'Primary', new Map());
		expect(first).toEqual(shared[0]);
		expect(first).not.toBe(shared[0]);

		first.Name_JP = 'changed';
		first.Relation.push({ Num: 99 });

		const second = await proc.resolveDbLinkSuffixRef(entry, '#Works_NumberTales', 'Primary', new Map());
		expect(shared[0]).toEqual({ Num: 7, Name_JP: 'A', Relation: [{ Num: 8 }] });
		expect(second).toEqual(shared[0]);
	});

	it('resolveDbLinkPrimaryRecord: 同じく切り離して返す', async () => {
		const shared = makeShared();
		const proc = new EnrichmentProcessor({ readDBShared: async () => shared }, {});
		// typedef 駆動の比較器は本テストの対象外なので、先頭 1 件一致に固定する
		proc.searchRecords = async (records) => [records[0]];

		const def = { worksTitle: 'NumberTales', dbName: 'Primary', _Search: [{ hashTag: 'Num', key: 7 }] };
		const first = await proc.resolveDbLinkPrimaryRecord(def, new Map());
		expect(first).toEqual(shared[0]);
		expect(first).not.toBe(shared[0]);

		first.Relation[0].Num = 100;
		expect(shared[0].Relation[0].Num).toBe(8);
	});
});
