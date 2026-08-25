/**
 * `StandardServiceWorker` の共通ルーティング回帰テスト
 *
 * `api/sw.js` / `svc/sw.js` / `pages/sw.js` はルート表を `lib/sw-common.js` の
 * `StandardServiceWorker` へ集約している。ここで守りたい性質は 3 つ。
 *
 * 1. **未知パスは必ず Response を返す**（重要）
 *    `StandardEndpointHandlers.handleAdvancedEndpoints()` は未処理時に `null` を返す。
 *    統合前の `api/sw.js` / `svc/sw.js` はこれをそのまま return していたため、
 *    `ServiceWorkerBase` が `event.respondWith(null)` を呼び、404 JSON ではなく
 *    **ネットワークエラー**になっていた（`pages/sw.js` だけが独自 override で回避）。
 *    ブラウザ専用コードのため自動テストでしか検知できない。
 * 2. **`enrich` の既定値がスコープごとに正しく伝わる**
 *    pages は常時 true、api/svc は `?enrich=1` で opt-in。
 * 3. **不正な works は 400 で弾く**
 *    統合前は `pages/sw.js` の override 側にしか検証が無く、api/svc は `workId=null` のまま進んでいた。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * sw-common.js を vm 上へロードし、SW グローバル相当を揃えたコンテキストを返す
 *
 * `EnrichmentProcessor` / `ReferenceResolver` は本来 `lib/data-common.js` が定義するが、
 * ここではルーティングだけを見たいのでスタブを global へ置く
 * （`StandardServiceWorker` のコンストラクタは実行時にこれらを解決する）。
 * @returns {Object} vm コンテキスト
 */
function loadSwCommon() {
	const context = {
		console: { log() {}, warn() {}, error() {} },
		Response: globalThis.Response,
		Headers: globalThis.Headers,
		URL: globalThis.URL,
		Map: globalThis.Map,
		Set: globalThis.Set,
		Date: globalThis.Date,
		fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
		// data-common.js 側クラスのスタブ（ルーティングでは呼ばれない）
		EnrichmentProcessor: class {},
		ReferenceResolver: class {},
		self: {
			location: { origin: 'https://example.invalid', href: 'https://example.invalid/api/sw.js' },
			registration: { scope: 'https://example.invalid/api/' },
			addEventListener() {}
		}
	};
	vm.runInNewContext(readFileSync(join(repoRoot, 'lib/sw-common.js'), 'utf-8'), context, {
		filename: 'lib/sw-common.js'
	});
	return context;
}

/**
 * ルーティングだけを観測できる SW インスタンスを組み立てる
 * @param {Object} context - loadSwCommon() の戻り値
 * @param {Object} [options] - StandardServiceWorker のコンストラクタ引数
 * @returns {{sw: Object, calls: Array<{name: string, args: Array}>}}
 */
function createRoutedWorker(context, options = {}) {
	const { StandardServiceWorker } = context.self;
	const sw = new StandardServiceWorker({ scope: 'API', ...options });
	const calls = [];

	// 共通エンドポイント（index/health 等）は未処理扱いにして標準ルートへ流す
	sw.apiHandlers = { routeCommonEndpoints: async () => null };

	// 標準ハンドラは呼び出し記録だけを行うスタブへ差し替える。
	// handleAdvancedEndpoints は本物と同じく未処理時 null を返す点が肝。
	sw.standardHandlers = new Proxy({}, {
		get: (_t, name) => async (...args) => {
			calls.push({ name, args });
			if (name === 'handleAdvancedEndpoints') return null;
			return new context.Response('{}', { status: 200 });
		}
	});

	return { sw, calls };
}

/** `/{prefix}/<path>` を投げてレスポンスを得る */
const request = (sw, path, query = '') =>
	sw.handleApiRequest(new URL(`https://example.invalid/api/v1${path}${query}`), '/api/v1');

describe('StandardServiceWorker のルーティング', () => {
	it('未知パスは null ではなく 404 Response を返す（respondWith(null) 回避）', async () => {
		const context = loadSwCommon();
		const { sw } = createRoutedWorker(context);

		const res = await request(sw, '/bogus');

		// 統合前の api/svc はここで null を返しており、respondWith(null) で
		// ネットワークエラーになっていた
		expect(res).toBeInstanceOf(context.Response);
		expect(res.status).toBe(404);
	});

	it('深い未知パスでも 404 Response を返す', async () => {
		const context = loadSwCommon();
		const { sw } = createRoutedWorker(context);

		const res = await request(sw, '/works/NumberTales/db/Primary/extra/deep');

		expect(res).toBeInstanceOf(context.Response);
		expect(res.status).toBe(404);
	});

	it('標準ルートが想定どおりのハンドラへ振り分けられる', async () => {
		const context = loadSwCommon();
		const { sw, calls } = createRoutedWorker(context);

		await request(sw, '/index');
		await request(sw, '/works');
		await request(sw, '/bootstrap');
		await request(sw, '/search');
		await request(sw, '/works/NumberTales');
		await request(sw, '/works/NumberTales/db');
		await request(sw, '/works/NumberTales/varsdef');
		await request(sw, '/works/NumberTales/db/Primary');

		expect(calls.map((c) => c.name)).toEqual([
			'handleIndexEndpoint',
			'handleWorksListEndpoint',
			'handleBootstrapEndpoint',
			'handleSearchEndpoint',
			'handleWorkEndpoint',
			'handleWorkDbListEndpoint',
			'handleWorkVarsdefEndpoint',
			'handleDbEndpoint'
		]);
	});

	it('api/svc スコープでは enrich が opt-in（既定 false・?enrich=1 で true）', async () => {
		const context = loadSwCommon();
		const { sw, calls } = createRoutedWorker(context, { enrichDefault: false });

		await request(sw, '/works/NumberTales/db/Primary');
		await request(sw, '/works/NumberTales/db/Primary', '?enrich=1');

		// handleDbEndpoint(work, db, resolve, debug, enrich)
		expect(calls[0].args[4]).toBe(false);
		expect(calls[1].args[4]).toBe(true);
	});

	it('pages スコープでは enrich が常時 true（bootstrap にも伝わる）', async () => {
		const context = loadSwCommon();
		const { sw, calls } = createRoutedWorker(context, { scope: 'Pages', enrichDefault: true });

		await request(sw, '/works/NumberTales/db/Primary');
		await request(sw, '/search');
		await request(sw, '/bootstrap');

		expect(calls[0].args[4]).toBe(true);
		// handleSearchEndpoint(url, resolve, debug, enrich)
		expect(calls[1].args[3]).toBe(true);
		// handleBootstrapEndpoint(url, resolve, enrich)
		expect(calls[2].args.slice(1)).toEqual([true, true]);
	});

	it('resolve は既定 true・?resolve=0 で false', async () => {
		const context = loadSwCommon();
		const { sw, calls } = createRoutedWorker(context);

		await request(sw, '/works/NumberTales/db/Primary');
		await request(sw, '/works/NumberTales/db/Primary', '?resolve=0');

		expect(calls[0].args[2]).toBe(true);
		expect(calls[1].args[2]).toBe(false);
	});

	it('スコープ固有エンドポイントは routeExtraEndpoints で差し込める', async () => {
		const context = loadSwCommon();
		const { StandardServiceWorker, ResponseUtils } = context.self;

		class PagesLike extends StandardServiceWorker {
			async routeExtraEndpoints(seg) {
				if (seg.length === 1 && seg[0] === 'enrich') {
					return ResponseUtils.jsonResponse({ ok: true });
				}
				return null;
			}
		}

		const sw = new PagesLike({ scope: 'Pages', enrichDefault: true });
		sw.apiHandlers = { routeCommonEndpoints: async () => null };
		sw.standardHandlers = new Proxy({}, {
			get: () => async () => null
		});

		const hit = await request(sw, '/enrich');
		expect(hit.status).toBe(200);

		// 固有ルートに当たらないものは 404 のまま
		const miss = await request(sw, '/nope');
		expect(miss.status).toBe(404);
	});
});

describe('StandardEndpointHandlers の入力検証', () => {
	it('works/{work}/varsdef は不正な works を 400 で弾く', async () => {
		const context = loadSwCommon();
		const { StandardEndpointHandlers } = context.self;
		const handlers = new StandardEndpointHandlers({}, null, null, 'API');

		// `#Works_<[A-Za-z0-9_]+>` に正規化できない値は toWorkKey() が null を返す
		const res = await handlers.handleWorkVarsdefEndpoint('bad-name!');

		expect(res.status).toBe(400);
	});
});
