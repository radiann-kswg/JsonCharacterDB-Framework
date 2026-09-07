// API プロトタイプブートストラップとデモ UI
// - Service Worker (sw.js) を登録
// - エンドポイントをテストするための小さな UI を提供

const API_UI_ALLOWED_PREFIX = '/api/v1/';

/**
 * API テスト UI で許可するパスかを判定
 * @param {string} pathname - URL pathname
 * @returns {boolean}
 */
function isAllowedApiUiPath(pathname) {
  const normalizedPath = String(pathname || '').replace(/\/{2,}/g, '/');
  return normalizedPath === '/api/v1' || normalizedPath.startsWith(API_UI_ALLOWED_PREFIX);
}

/**
 * API テスト UI で使用するエンドポイントを正規化・検証
 * - 同一オリジンかつ /api/v1/* のみ許可する
 * - ハッシュは fetch に不要なため除外する
 * @param {string} input - ユーザー入力または data-endpoint
 * @param {string} [baseHref] - 相対URL解決用の基準 URL
 * @returns {{ ok: boolean, path?: string, reason?: string }}
 */
function normalizeApiUiEndpoint(input, baseHref = (typeof location !== 'undefined' ? location.href : 'https://example.invalid/api/index.html')) {
  const raw = String(input || '').trim();
  if (!raw) {
    return { ok: false, reason: 'エンドポイントが空です。' };
  }

  let baseUrl;
  let resolvedUrl;
  try {
    baseUrl = new URL(baseHref);
    resolvedUrl = new URL(raw, baseUrl);
  } catch {
    return { ok: false, reason: '有効な URL または相対パスを指定してください。' };
  }

  if (!/^https?:$/i.test(resolvedUrl.protocol)) {
    return { ok: false, reason: 'http / https 以外のスキームは許可されていません。' };
  }

  if (resolvedUrl.origin !== baseUrl.origin) {
    return { ok: false, reason: '同一オリジンのエンドポイントのみ使用できます。' };
  }

  if (!isAllowedApiUiPath(resolvedUrl.pathname)) {
    return { ok: false, reason: '/api/v1/* のみ指定できます。' };
  }

  return {
    ok: true,
    path: `${resolvedUrl.pathname}${resolvedUrl.search}`
  };
}

if (typeof globalThis !== 'undefined') {
  globalThis.__100blApiUi = Object.freeze({
    isAllowedApiUiPath,
    normalizeApiUiEndpoint,
  });
}

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof navigator === 'undefined') {
    return;
  }

  const swUrl = new URL('sw.js', location.href).toString();

  /**
   * Service Worker を登録
   */
  async function registerSW() {
    if (!('serviceWorker' in navigator)) {
      log({ error: 'このブラウザでは Service Worker がサポートされていません。' });
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register(swUrl, { scope: './' });
      await navigator.serviceWorker.ready;
      log({ info: 'Service Worker が登録されました。', scope: reg.scope });
    } catch (e) {
      log({ error: 'Service Worker の登録に失敗しました', details: String(e) });
    }
  }

  /**
   * 出力エリアにログを表示
   * @param {Object} obj - ログ出力するオブジェクト
   */
  function log(obj) {
    const el = document.getElementById('output');
    if (!el) return;
    el.textContent = JSON.stringify(obj, null, 2);
  }

  /**
   * 指定されたエンドポイントをフェッチしてレスポンスを表示
   * @param {string} path - フェッチするエンドポイントパス
   */
  async function fetchEndpoint(path) {
    const normalized = normalizeApiUiEndpoint(path, location.href);
    if (!normalized.ok) {
      log({ error: '許可されていないエンドポイントです', details: normalized.reason, endpoint: String(path || '') });
      return;
    }

    try {
      const res = await fetch(normalized.path, { headers: { 'Accept': 'application/json' } });
      const ct = res.headers.get('content-type') || '';
      let body;
      if (ct.includes('application/json')) {
        body = await res.json();
      } else {
        body = await res.text();
      }
      log({ status: res.status, ok: res.ok, url: res.url, body });
    } catch (e) {
      log({ error: 'フェッチに失敗しました', details: String(e), endpoint: path });
    }
  }

  /**
   * 自動ブートストラップ処理
   */
  async function autoBootstrap() {
    // 最初に軽量ブートストラップを試行、その後オプションでレコード付きの重い処理
    await fetchEndpoint('/api/v1/bootstrap');
  }

  /**
   * UI コントロールを設定
   */
  function setupUI() {
    const btnInstallSW = document.getElementById('btnInstallSW');
    if (btnInstallSW) btnInstallSW.addEventListener('click', registerSW);

    document.querySelectorAll('.btnFetch[data-endpoint]')
      .forEach(btn => btn.addEventListener('click', () => fetchEndpoint(btn.getAttribute('data-endpoint'))));

    const btnFetchCustom = document.getElementById('btnFetchCustom');
    const customEndpoint = document.getElementById('customEndpoint');
    if (btnFetchCustom && customEndpoint) {
      btnFetchCustom.addEventListener('click', () => {
        const p = customEndpoint.value.trim();
        if (p) fetchEndpoint(p);
      });
    }
  }

  // 初期化
  window.addEventListener('load', () => {
    registerSW();
    setupUI();
    // 自動実行
    setTimeout(autoBootstrap, 500);
  });
})();
