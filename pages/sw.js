/**
 * Service Worker: Pages スコープのAPIルーター（キャラクターページ制御用）
 *
 * 広告ブロッカーとスコープの落とし穴を避けるため複数のプレフィックスをインターセプト:
 * /pages/v1/* (プライマリ)、および /svc/v1/*、/api/v1/* のエイリアス
 *
 * 標準ルート表・依存の組み立て・事前キャッシュは `lib/sw-common.js` の
 * `StandardServiceWorker` に集約されています。本ファイルには Pages 固有の
 * `/pages/v1/enrich` エンドポイントだけが残っています。
 *
 * @fileoverview Pages Service Worker 実装
 * @author 100BeautiesLab Creations Database Team
 * @version 1.0.0
 */

// 共通ライブラリを読み込み
importScripts(
  '../lib/wrapper-common.js',
  '../lib/basic-renders/type-common.js',
  '../lib/basic-renders/def-object-common.js',
  '../lib/basic-renders/faction.js',
  '../lib/basic-renders/baseArea.js',
  '../lib/sw-common.js',
  '../lib/data-common.js'
);

/**
 * Pages Service Worker クラス
 * 複数プレフィックス対応とキャラクターページ特化の enrich エンドポイントを持つ
 */
class PagesServiceWorker extends StandardServiceWorker {
  constructor() {
    super({
      scope: 'Pages',
      // '/pages/v1' を主とし、'/svc/v1' '/api/v1' もエイリアスとして拾う
      resolvePrefixes: (config) => [
        config.API_PREFIX,
        `${config.REPO_BASE}svc/v1`,
        `${config.REPO_BASE}api/v1`
      ],
      // キャラシートは常に完全 enrich 済みのレスポンスを前提とする
      enrichDefault: true
    });
  }

  /**
   * Pages 固有エンドポイントのルーティング
   * @param {Array<string>} seg - パスセグメント配列
   * @param {URL} url - リクエストURL
   * @param {boolean} resolve - 参照解決フラグ
   * @param {boolean} debug - デバッグフラグ
   * @returns {Promise<Response|null>} レスポンスまたは null（未処理）
   */
  async routeExtraEndpoints(seg, url, resolve, debug) {
    // /pages/v1/enrich - 充実化エンドポイント（キャラクターページ特化）
    if (seg.length === 1 && seg[0] === 'enrich') {
      return this.handleEnrichEndpoint(url, resolve, debug);
    }
    return null;
  }

  /**
   * /pages/v1/enrich エンドポイント（キャラクターページ特化）
   * @param {URL} url - リクエストURL
   * @param {boolean} resolve - 参照解決フラグ
   * @param {boolean} debug - デバッグフラグ
   * @returns {Promise<Response>} APIレスポンス
   */
  async handleEnrichEndpoint(url, resolve, debug) {
    const params = url.searchParams;
    const workId = DataUtils.toWorkKey(params.get('works'));
    const dbName = params.get('db');

    if (!workId || !dbName) return ResponseUtils.badRequest('Query must include works and db parameters');
    if (!DataUtils.isValidDbName(dbName)) return ResponseUtils.badRequest('Invalid db parameter');

    let records = await this.dataFetcher.readDB(workId, dbName);
    try {
      const workMeta = await this.dataFetcher.readWorkMeta(workId);
      records = CommonsProcessor.applyCommonsToRecords(records, workMeta, dbName);
    } catch {
      // メタ欠損時は _Commons 適用をスキップ
    }

    const resolveCache = new Map();
    if (resolve) {
      records = await this.referenceResolver.resolveAllInAny(records, resolveCache);
    }

    // 充実化処理
    records = await this.enrichmentProcessor.enrichRecords(records, workId, dbName);

    const response = {
      work: workId,
      db: dbName,
      records: records,
      resolved: resolve,
      enriched: true
    };

    if (debug) {
      response.debug = {
        recordCount: records.length,
        enrichmentApplied: true
      };
    }

    return ResponseUtils.jsonResponse(response);
  }
}

// Service Worker インスタンスを作成
const pagesServiceWorker = new PagesServiceWorker();

console.log('🚀 Pages Service Worker が初期化されました:', pagesServiceWorker.apiPrefixes);
