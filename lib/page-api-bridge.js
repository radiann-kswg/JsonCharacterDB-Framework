/**
 * page-api-bridge.js - ブラウザページから疑似 API（Service Worker）を使うための橋渡し
 *
 * @description
 * GitHub Pages は静的ホスティングなので、`/pages/v1/*` は **Service Worker が登録され、
 * かつそのページを制御していないと 404 になる**。つまりこのモジュールの `ensureApiSW()` が
 * 成功しない限り、キャラシートも相関図もデータを 1 件も取得できない。
 *
 * 提供するもの:
 * - `ensureApiSW()`  … SW 登録（`/pages/` → `/svc/` → `/api/` の 3 段フォールバック）
 * - `waitForController()` … このページが SW に制御されるまで待つ
 * - `api(path)`      … 現在の API ベースを基準に API URL を組み立てる
 * - `fetchJSON(url)` … タイムアウト付きの JSON 取得
 * - `replayRememberedSwInitError()` … 前回の SW 初期化失敗ログを再出力
 *
 * 広告ブロッカーが `/api/` を含むパスを遮断することがあるため、既定は `/pages/` を使い、
 * 失敗時のみ `/svc/`（別名）→ `/api/`（レガシー）へ落とす。どのベースが採用されたかは
 * モジュール内の状態として保持し、`api()` がそれを参照する。
 *
 * SW 初期化の失敗ログはリロードで流れやすいため `sessionStorage` へ退避し、
 * 次回表示時に `replayRememberedSwInitError()` で引用できるようにしている。
 *
 * 本モジュールは ES モジュール。**Service Worker の `importScripts()` へは追加しないこと**
 * （`importScripts` は classic script しか読めず、`export` 構文は SyntaxError になり SW 全体の
 * 評価が失敗する。`tests/sw.importscripts-scope.test.js` を参照）。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 */

/**
 * 現在の API ベース（ページからの相対パス）
 * - 既定は `/pages/`。`ensureApiSW()` のフォールバック結果に応じて `/svc/` `/api/` へ切り替わる
 * @type {string}
 */
let apiBaseRel = '../pages/';

/** SW 初期化の失敗ログを退避する sessionStorage キー */
const SW_INIT_ERROR_KEY = '100bl.lastSwInitError';

/** controller 取得に失敗したページを 1 回だけ自動リロードするためのフラグキー */
const CONTROLLER_RELOAD_FLAG = '100bl.swControllerReloaded';

/**
 * 現在の API ベースを取得する
 * @returns {string} 例: '../pages/'
 */
export function getApiBase() {
	return apiBaseRel;
}

/**
 * API ベースを既定（`../pages/`）へ戻す
 * - テストの状態リセット用。通常のページ動作では呼ばない
 * @returns {void}
 */
export function resetApiBase() {
	apiBaseRel = '../pages/';
}

/**
 * SW 初期化失敗の情報を sessionStorage に保存
 * @param {string} stage - 'primary' | 'fallback-svc' | 'fallback-api' | etc
 * @param {any} info
 */
function rememberSwInitError(stage, info) {
	try {
		const payload = {
			time: new Date().toISOString(),
			stage: String(stage || '').trim() || 'unknown',
			href: String(location?.href || ''),
			origin: String(location?.origin || ''),
			protocol: String(location?.protocol || ''),
			info
		};
		sessionStorage.setItem(SW_INIT_ERROR_KEY, JSON.stringify(payload));
	} catch {
		// no-op
	}
}

/**
 * 前回のSW初期化失敗ログをコンソールへ再出力（引用できるようにする）
 * @returns {void}
 */
export function replayRememberedSwInitError() {
	try {
		const raw = sessionStorage.getItem(SW_INIT_ERROR_KEY);
		if (!raw) return;
		const payload = JSON.parse(raw);
		// 1回は必ず目立つ形で出す（ただし勝手に消さない）
		console.warn('🧾 前回のService Worker初期化失敗ログ（引用用）:', payload);
	} catch {
		// no-op
	}
}

/**
 * 退避済みの SW 初期化失敗ログを消す
 * @returns {void}
 */
function clearRememberedSwInitError() {
	try { sessionStorage.removeItem(SW_INIT_ERROR_KEY); } catch { /* no-op */ }
}

/**
 * 現在の API ベースを基準とした API URL を構築
 * @param {string} path - API パス (例: 'v1/works' または '/v1/works')
 * @returns {string} 完全な API URL
 */
export function api(path) {
	const base = new URL(apiBaseRel, location.href);
	// 'v1/...' または '/v1/...' のようなパスをサポート
	const p = String(path || '').replace(/^\/?/, '');
	return new URL(p, base).toString();
}

/**
 * このページが Service Worker によって制御されるまで待機
 * @param {number} timeoutMs - タイムアウト時間（ミリ秒、デフォルト: 15000）
 * @returns {Promise<void>} ページが制御されるかタイムアウト時に解決
 */
export function waitForController(timeoutMs = 15000) {
	if (navigator.serviceWorker.controller) return Promise.resolve();

	return new Promise((resolve, reject) => {
		let done = false;

		/** @type {ReturnType<typeof setTimeout>|null} */
		let to = null;

		const cleanup = () => {
			navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
		};

		const onControllerChange = () => {
			if (done) return;
			if (!navigator.serviceWorker.controller) return;
			done = true;
			if (to != null) clearTimeout(to);
			cleanup();
			resolve();
		};

		// レース対策: リスナーを先に登録してから controller を再チェック
		navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
		if (navigator.serviceWorker.controller) {
			done = true;
			cleanup();
			resolve();
			return;
		}

		to = setTimeout(() => {
			if (done) return;
			done = true;
			cleanup();
			reject(new Error(`Service Worker controller timeout after ${timeoutMs}ms`));
		}, timeoutMs);
	});
}

/**
 * URL から JSON をフェッチして解析（タイムアウトと拡張エラーハンドリング付き）
 * @param {string} url - フェッチする URL
 * @param {number} timeout - タイムアウト時間（ミリ秒、デフォルト: 10秒）
 * @returns {Promise<Object>} 解析された JSON レスポンス
 * @throws {Error} リクエストが失敗するかレスポンスが OK でない場合
 */
export async function fetchJSON(url, timeout = 10000) {
	console.log('🌐 フェッチ中:', url);
	const startTime = performance.now();

	try {
		// Create timeout promise
		const timeoutPromise = new Promise((_, reject) =>
			setTimeout(() => reject(new Error(`Request timeout after ${timeout}ms`)), timeout)
		);

		// Race between fetch and timeout
		const fetchPromise = fetch(url, {
			headers: { 'Accept': 'application/json' },
			// SW/API 側の enrich 仕様変更を即時反映しやすくするため、疑似API応答は都度取得する
			cache: 'no-store'
		});

		const res = await Promise.race([fetchPromise, timeoutPromise]);
		const fetchTime = performance.now() - startTime;

		if (!res.ok) {
			console.error('❌ Fetch failed:', {
				status: res.status,
				statusText: res.statusText,
				url: url,
				time: `${fetchTime.toFixed(2)}ms`,
				headers: Object.fromEntries(res.headers.entries())
			});
			throw new Error(`${res.status} ${res.statusText} ${url}`);
		}

		const parseStart = performance.now();
		const data = await res.json();
		const parseTime = performance.now() - parseStart;
		const totalTime = performance.now() - startTime;

		console.log('✅ Fetch success:', url, {
			fetchTime: `${fetchTime.toFixed(2)}ms`,
			parseTime: `${parseTime.toFixed(2)}ms`,
			totalTime: `${totalTime.toFixed(2)}ms`,
			responseSize: `${JSON.stringify(data).length} chars`
		});

		return data;
	} catch (error) {
		const totalTime = performance.now() - startTime;
		console.error('❌ Fetch error:', {
			message: error.message,
			url: url,
			time: `${totalTime.toFixed(2)}ms`,
			type: error.constructor.name
		});
		throw error;
	}
}

/**
 * Service Worker の登録（複数のフォールバック戦略付き）
 * 広告ブロッカーの制限を回避するため、/pages/, /svc/, /api/ の順で試行
 * @returns {Promise<void>} SW が準備完了してページを制御した時点で解決
 */
export async function ensureApiSW() {
	if (!('serviceWorker' in navigator)) {
		console.warn('🚫 Service Worker はサポートされていません');
		return;
	}

	// Service Worker は secure context（https or localhost）でのみ有効
	// - file:// などでは必ず失敗するため、早めに理由を出す
	try {
		const p = String(location?.protocol || '');
		if (p && p !== 'https:' && p !== 'http:') {
			const err = new Error(`Unsupported protocol for Service Worker: ${p}`);
			rememberSwInitError('precheck', { message: err.message, name: err.name, stack: err.stack });
			console.warn('🚫 Service Worker はこのプロトコルでは利用できません:', p);
			throw err;
		}
	} catch (e) {
		// throw された場合は呼び元に伝播
		throw e;
	}

	const withTimeout = (promise, label, timeoutMs = 10000) => Promise.race([
		promise,
		new Promise((_, reject) => setTimeout(
			() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)),
			timeoutMs
		))
	]);

	// 既にページを制御中なら、register() の再実行で既存 SW の更新待ちを発生させない。
	// 開発サーバーやブラウザーの SW 更新が保留中でも、制御中の SW は API を処理できる。
	if (navigator.serviceWorker.controller) {
		apiBaseRel = '../pages/';
		clearRememberedSwInitError();
		console.log('✅ 既存の Pages SW がページを制御中');
		return;
	}

	// 前回の登録失敗で残った、active/installing/waiting が全て無い登録を掃除する。
	// 死んだ登録を残したまま register() すると、ブラウザーによっては promise が解決しない。
	try {
		const registrations = await withTimeout(
			navigator.serviceWorker.getRegistrations(),
			'Service Worker registration cleanup',
			2000
		);
		await Promise.all(registrations
			.filter((registration) => !registration.active && !registration.installing && !registration.waiting)
			.map((registration) => withTimeout(
				registration.unregister(),
				'Service Worker stale registration removal',
				2000
			)));
	} catch (error) {
		console.warn('⚠️ Service Worker の古い登録を掃除できませんでした:', error);
	}

	/**
	 * active な SW に対して clients.claim() を再実行するよう依頼
	 * - controller が付かない環境の救済
	 */
	const requestClaimClients = async (label) => {
		try {
			const reg = await navigator.serviceWorker.ready;
			if (reg?.active) {
				console.warn(`📨 SWに clients.claim() を依頼します: ${label || ''}`.trim());
				reg.active.postMessage({ type: '100bl.claimClients', label: String(label || '') });
			}
		} catch {
			// no-op
		}
	};

	/**
	 * controller が付与されない環境向けに、SW ready 後すぐに claim を依頼しつつ段階的に待機する
	 * @param {string} baseLabel
	 */
	const ensureControlledBySw = async (baseLabel) => {
		if (navigator.serviceWorker.controller) return;

		// 先に claim を依頼して、短い待機で controllerchange を待つ（15s待ちを回避）
		await requestClaimClients(`${baseLabel}/after-ready`);
		try {
			await waitForController(2000);
			return;
		} catch (e) {
			const msg = String(e?.message || e || '');
			if (!msg.includes('controller timeout')) throw e;
		}

		if (navigator.serviceWorker.controller) return;

		// それでもダメならもう一度 claim して、少し長めに待つ
		await requestClaimClients(`${baseLabel}/retry`);
		await waitForController(8000);
	};

	console.log('🔧 Service Worker の登録を試行中...');

	try {
		// 1) /pages/v1, /svc/v1, /api/v1 をインターセプトするページスコープ SW を登録
		const pageSwUrl = new URL('./sw.js', location.href).toString();
		const pageScope = new URL('./', location.href).pathname; // '/pages/'
		console.log(`🌐 プライマリ SW を登録: ${pageSwUrl} (スコープ: ${pageScope})`);
		const reg = await withTimeout(
			navigator.serviceWorker.register(pageSwUrl, { scope: pageScope }),
			'Primary SW registration'
		);
		console.log('✅ プライマリ SW の登録に成功');
		// ブラウザが SW スクリプトを強くキャッシュしている場合に備え、更新を促す
		try { await withTimeout(reg.update(), 'Primary SW update'); } catch (_) { /* no-op */ }
		apiBaseRel = '../pages/';
		await withTimeout(navigator.serviceWorker.ready, 'Primary SW ready'); // アクティベーションを待機
		console.log('✅ プライマリ SW の準備完了');
		// フェッチを開始する前にこのページが制御されることを保証
		// - controller が付かないケースでは、SWに claim を依頼して再試行する
		await ensureControlledBySw('primary');
		if (!navigator.serviceWorker.controller) throw new Error('Primary SW is ready but did not take control of this page');
		console.log('✅ プライマリ SW がページを制御中');

		// 成功したら、前回エラーの退避はクリア
		clearRememberedSwInitError();

		// 成功したら、リロード済みフラグは解除
		try { sessionStorage.removeItem(CONTROLLER_RELOAD_FLAG); } catch (_) { /* no-op */ }
	} catch (err) {
		console.warn('❌ プライマリ SW の登録に失敗:', err);
		rememberSwInitError('primary', {
			message: String(err?.message || err || ''),
			name: String(err?.name || ''),
			stack: String(err?.stack || ''),
			pageSwUrl: (() => { try { return new URL('./sw.js', location.href).toString(); } catch { return ''; } })(),
			pageScope: (() => { try { return new URL('./', location.href).pathname; } catch { return ''; } })(),
		});

		// キャッシュの消去＋ハードリロード等では、その1回のナビゲーションがSW制御されないことがある。
		// この場合、次の通常リロードで controller が付与されるため、1回だけ自動リロードして復旧する。
		const msg = String(err?.message || err || '');
		if (msg.includes('SW registration timeout')) {
			throw err;
		}
		if (msg.includes('controller timeout') || msg.includes('did not take control')) {
			let alreadyReloaded = false;
			try { alreadyReloaded = sessionStorage.getItem(CONTROLLER_RELOAD_FLAG) === '1'; } catch (_) { /* no-op */ }

			if (!alreadyReloaded) {
				try { sessionStorage.setItem(CONTROLLER_RELOAD_FLAG, '1'); } catch (_) { /* no-op */ }
				console.warn('🔁 SW controller が取得できないため、通常リロードで復旧を試行します');
				location.reload();
				throw new Error('SW_CONTROLLER_RELOAD');
			}
		}

		// このページが SW に制御されない限り /pages/v1/* は解決できないため、
		// controller 系の失敗はフォールバックしても回復しない（スコープが一致しない）
		if (msg.includes('controller timeout') || msg.includes('did not take control')) {
			throw err;
		}
		try {
			// 2) /svc へのフォールバック（エイリアスパス）
			const svcSwUrl = new URL('../svc/sw.js', location.href).toString();
			const svcScope = new URL('../svc/', location.href).pathname;
			console.log(`🌐 フォールバック SW を登録: ${svcSwUrl} (スコープ: ${svcScope})`);
			const reg2 = await withTimeout(
				navigator.serviceWorker.register(svcSwUrl, { scope: svcScope }),
				'Fallback SW registration'
			);
			console.log('✅ フォールバック SW の登録に成功');
			try { await withTimeout(reg2.update(), 'Fallback SW update'); } catch (_) { /* no-op */ }
			apiBaseRel = '../svc/';
			await withTimeout(navigator.serviceWorker.ready, 'Fallback SW ready');
			console.log('✅ フォールバック SW の準備完了');
			await waitForController();
			if (!navigator.serviceWorker.controller) throw new Error('Fallback SW is ready but did not take control of this page');
			console.log('✅ フォールバック SW がページを制御中');

			clearRememberedSwInitError();
		} catch (err2) {
			console.warn('❌ フォールバック SW の登録に失敗:', err2);
			rememberSwInitError('fallback-svc', {
				message: String(err2?.message || err2 || ''),
				name: String(err2?.name || ''),
				stack: String(err2?.stack || ''),
				svcSwUrl: (() => { try { return new URL('../svc/sw.js', location.href).toString(); } catch { return ''; } })(),
				svcScope: (() => { try { return new URL('../svc/', location.href).pathname; } catch { return ''; } })(),
			});
			try {
				// 3) /api への最終フォールバック
				const apiSwUrl = new URL('../api/sw.js', location.href).toString();
				const apiScope = new URL('../api/', location.href).pathname;
				console.log(`🌐 最終フォールバック SW を登録: ${apiSwUrl} (スコープ: ${apiScope})`);
				const reg3 = await navigator.serviceWorker.register(apiSwUrl, { scope: apiScope });
				console.log('✅ 最終フォールバック SW の登録に成功');
				try { await reg3.update(); } catch (_) { /* no-op */ }
				apiBaseRel = '../api/';
				await navigator.serviceWorker.ready;
				console.log('✅ 最終フォールバック SW の準備完了');
				await waitForController();
				if (!navigator.serviceWorker.controller) throw new Error('Last-resort SW is ready but did not take control of this page');
				console.log('✅ 最終フォールバック SW がページを制御中');

				clearRememberedSwInitError();
			} catch (err3) {
				console.error('❌ すべての SW 登録試行が失敗:', err3);
				rememberSwInitError('fallback-api', {
					message: String(err3?.message || err3 || ''),
					name: String(err3?.name || ''),
					stack: String(err3?.stack || ''),
					apiSwUrl: (() => { try { return new URL('../api/sw.js', location.href).toString(); } catch { return ''; } })(),
					apiScope: (() => { try { return new URL('../api/', location.href).pathname; } catch { return ''; } })(),
				});
				// SW が利用できない場合、/pages/v1 は静的ホスティングでは 404 になるため、ここで失敗として扱う
				throw err3;
			}
		}
	}
}

// IIFE 形式の `lib/section-renders/*.js` からも参照できるようミラーしておく。
// ES モジュールとして import できる環境では import を優先すること。
if (typeof globalThis !== 'undefined') {
	globalThis.PageApiBridge = {
		getApiBase,
		resetApiBase,
		api,
		waitForController,
		fetchJSON,
		ensureApiSW,
		replayRememberedSwInitError
	};
}
