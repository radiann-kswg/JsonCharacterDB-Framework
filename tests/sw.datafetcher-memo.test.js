/**
 * DataFetcher のリクエストスコープ・メモ化の回帰テスト
 *
 * `bootstrap` のように「全作品 × 全DB」を総なめするエンドポイントでは、`readWorkMeta()` が
 * 各所から繰り返し呼ばれ、同一の `db_meta.json` を数十回フェッチし直していた
 * （実測: `Works_FLInvestigator78/DataBases/db_meta.json` が 39 回）。
 *
 * ここで守りたい性質は 2 つある。
 * 1. **速さ**: スコープ内では同一パスのメタ/型/辞書 JSON と HEAD 判定が 1 回に合流すること
 * 2. **正しさ**: レコード本体（`db_*.json` 等）は**決してメモ化しない**こと。
 *    `CommonsProcessor.applyCommonsToRecords()` はレコードを in-place で書き換える（`rec[k] = v`）ため、
 *    レコード配列を共有すると 2 番目以降の利用者が `_Commons` 適用済みの配列を受け取り、
 *    別 DB 文脈の値が混ざる。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);

function loadText(relPath) {
	return readFileSync(join(repoRoot, relPath), 'utf-8');
}

/**
 * sw-common.js を vm 上へロードし、fetch 呼び出しを記録できるコンテキストを返す
 *
 * @param {Object} [options]
 * @param {Set<string>} [options.missing] - 404 を返させたいパス（`new URL()` 後の pathname で判定）
 * @returns {{ctx: Object, calls: string[], fetcher: Object}}
 */
function createFetcher(options = {}) {
	const missing = options.missing || new Set();
	const calls = [];

	const context = {
		console,
		Response: globalThis.Response,
		Headers: globalThis.Headers,
		URL: globalThis.URL,
		self: {
			location: { origin: 'https://example.invalid', pathname: '/' }
		}
	};

	// fetch はコンテキストへ注入する（sw-common.js 内の `fetch(...)` がこれを拾う）
	context.fetch = async (url, init = {}) => {
		const method = String(init.method || 'GET').toUpperCase();
		const pathname = new URL(url).pathname;
		calls.push(`${method} ${pathname}`);
		const ok = !missing.has(pathname);
		return {
			ok,
			status: ok ? 200 : 404,
			// レコードは呼び出しごとに新しい配列であることを確かめたいので毎回生成する
			json: async () => ({ path: pathname, marker: {} })
		};
	};

	vm.runInNewContext(loadText('lib/sw-common.js'), context, { filename: 'lib/sw-common.js' });

	const DataFetcher = context.self.DataFetcher;
	const config = {
		ORIGIN: 'https://example.invalid',
		withRepoBase: (p) => p
	};
	return { ctx: context, calls, fetcher: new DataFetcher(config) };
}

describe('DataFetcher のリクエストスコープ・メモ化', () => {
	it('スコープ外では同一パスでも毎回フェッチする（既定挙動は不変）', async () => {
		const { calls, fetcher } = createFetcher();

		await fetcher.fetchJSON('/data/db_meta.json');
		await fetcher.fetchJSON('/data/db_meta.json');

		expect(calls).toEqual(['GET /data/db_meta.json', 'GET /data/db_meta.json']);
	});

	it('スコープ内ではメタ JSON の逐次呼び出しが 1 回に合流する', async () => {
		const { calls, fetcher } = createFetcher();

		fetcher.beginRequestScope();
		const a = await fetcher.fetchJSON('/data/Works_FLInvestigator78/DataBases/db_meta.json');
		const b = await fetcher.fetchJSON('/data/Works_FLInvestigator78/DataBases/db_meta.json');
		fetcher.endRequestScope();

		expect(calls).toHaveLength(1);
		// 同一 Promise を共有するので参照も一致する（メタは読み取り専用で扱われる前提）
		expect(a).toBe(b);
	});

	it('スコープ内では並行呼び出しも 1 本のフェッチへ合流する', async () => {
		const { calls, fetcher } = createFetcher();

		fetcher.beginRequestScope();
		await Promise.all([
			fetcher.fetchJSON('/data/db_type.json'),
			fetcher.fetchJSON('/data/db_type.json'),
			fetcher.fetchJSON('/data/db_type.json')
		]);
		fetcher.endRequestScope();

		expect(calls).toHaveLength(1);
	});

	it('辞書ディレクトリ配下もメモ化対象になる', async () => {
		const { calls, fetcher } = createFetcher();

		fetcher.beginRequestScope();
		await fetcher.fetchJSON('/data/Dictionaries/dict_Faction.json');
		await fetcher.fetchJSON('/data/Dictionaries/dict_Faction.json');
		fetcher.endRequestScope();

		expect(calls).toHaveLength(1);
	});

	it('レコード本体はスコープ内でもメモ化しない（_Commons の in-place 適用が混ざるため）', async () => {
		const { calls, fetcher } = createFetcher();

		fetcher.beginRequestScope();
		const a = await fetcher.fetchJSON('/data/Works_NumberTales/DataBases/db_Primary.json');
		const b = await fetcher.fetchJSON('/data/Works_NumberTales/DataBases/db_Primary.json');
		fetcher.endRequestScope();

		expect(calls).toHaveLength(2);
		// 別オブジェクトであること（片方を書き換えても他方へ波及しない）
		expect(a).not.toBe(b);
		a.marker.applied = true;
		expect(b.marker.applied).toBeUndefined();
	});

	it('参照系レコード（ref_ / trans_）もメモ化しない', async () => {
		const { calls, fetcher } = createFetcher();

		fetcher.beginRequestScope();
		await fetcher.fetchJSON('/data/Works_NumberTales/References/ref_Faction.json');
		await fetcher.fetchJSON('/data/Works_NumberTales/References/ref_Faction.json');
		await fetcher.fetchJSON('/data/Works_NumberTales/Localization/trans_Regions.json');
		await fetcher.fetchJSON('/data/Works_NumberTales/Localization/trans_Regions.json');
		fetcher.endRequestScope();

		expect(calls).toHaveLength(4);
	});

	it('fileExists（HEAD）はスコープ内で合流する', async () => {
		const { calls, fetcher } = createFetcher();

		fetcher.beginRequestScope();
		await fetcher.fileExists('/data/Works_NumberTales/DataBases/db_Primary.json');
		await fetcher.fileExists('/data/Works_NumberTales/DataBases/db_Primary.json');
		fetcher.endRequestScope();

		expect(calls).toEqual(['HEAD /data/Works_NumberTales/DataBases/db_Primary.json']);
	});

	it('失敗（404）も同一スコープ内では再試行しない', async () => {
		const missing = new Set(['/data/Works_ShouArRiders/References/db_meta.json']);
		const { calls, fetcher } = createFetcher({ missing });

		fetcher.beginRequestScope();
		await expect(fetcher.fetchJSON('/data/Works_ShouArRiders/References/db_meta.json')).rejects.toThrow();
		await expect(fetcher.fetchJSON('/data/Works_ShouArRiders/References/db_meta.json')).rejects.toThrow();
		fetcher.endRequestScope();

		expect(calls).toHaveLength(1);
	});

	it('スコープを閉じるとキャッシュが破棄され、次のリクエストでは取り直す', async () => {
		const { calls, fetcher } = createFetcher();

		fetcher.beginRequestScope();
		await fetcher.fetchJSON('/data/db_meta.json');
		fetcher.endRequestScope();

		fetcher.beginRequestScope();
		await fetcher.fetchJSON('/data/db_meta.json');
		fetcher.endRequestScope();

		expect(calls).toHaveLength(2);
	});

	it('ネストしたスコープは参照カウントで管理され、外側が閉じるまで破棄されない', async () => {
		const { calls, fetcher } = createFetcher();

		fetcher.beginRequestScope();
		await fetcher.fetchJSON('/data/db_meta.json');

		fetcher.beginRequestScope();
		await fetcher.fetchJSON('/data/db_meta.json');
		fetcher.endRequestScope();

		// 内側を閉じただけではキャッシュは生きている
		await fetcher.fetchJSON('/data/db_meta.json');
		fetcher.endRequestScope();

		expect(calls).toHaveLength(1);

		// 外側も閉じたので次は取り直す
		await fetcher.fetchJSON('/data/db_meta.json');
		expect(calls).toHaveLength(2);
	});

	it('endRequestScope の余分な呼び出しでカウントが負にならない', async () => {
		const { calls, fetcher } = createFetcher();

		fetcher.endRequestScope();
		fetcher.endRequestScope();

		fetcher.beginRequestScope();
		await fetcher.fetchJSON('/data/db_meta.json');
		await fetcher.fetchJSON('/data/db_meta.json');
		fetcher.endRequestScope();

		expect(calls).toHaveLength(1);
	});
});

describe('ServiceWorkerBase.handleApiRequestInScope', () => {
	it('handleApiRequest の前後でスコープを開閉し、例外時も必ず閉じる', async () => {
		const { ctx } = createFetcher();
		const ServiceWorkerBase = ctx.self.ServiceWorkerBase;
		expect(ServiceWorkerBase).toBeTypeOf('function');

		const events = [];
		const stubFetcher = {
			beginRequestScope() { events.push('begin'); },
			endRequestScope() { events.push('end'); }
		};

		// ServiceWorkerBase のコンストラクタは self.addEventListener を呼ぶのでスタブを足す
		ctx.self.addEventListener = () => { };

		class TestSW extends ServiceWorkerBase {
			constructor(shouldThrow) {
				super(['/pages/v1']);
				this.dataFetcher = stubFetcher;
				this.shouldThrow = shouldThrow;
			}
			async handleApiRequest() {
				events.push('handle');
				if (this.shouldThrow) throw new Error('boom');
				return 'ok';
			}
		}

		const okSw = new TestSW(false);
		await expect(okSw.handleApiRequestInScope(new ctx.URL('https://example.invalid/pages/v1/works'), '/pages/v1'))
			.resolves.toBe('ok');
		expect(events).toEqual(['begin', 'handle', 'end']);

		events.length = 0;
		const ngSw = new TestSW(true);
		await expect(ngSw.handleApiRequestInScope(new ctx.URL('https://example.invalid/pages/v1/works'), '/pages/v1'))
			.rejects.toThrow('boom');
		expect(events).toEqual(['begin', 'handle', 'end']);
	});
});
