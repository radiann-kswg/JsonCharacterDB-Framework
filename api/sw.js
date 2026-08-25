/**
 * Service Worker: GitHub Pages 用の静的 API ルーター
 *
 * /api/v1/* リクエストをインターセプトし、/data/** から JSON を読み取って
 * 疑似 API レスポンスを返します。参照解決と検索機能を提供します。
 *
 * ルート表・依存の組み立て・事前キャッシュは `lib/sw-common.js` の
 * `StandardServiceWorker` に集約されています。本ファイルはスコープ設定のみを持ちます。
 *
 * @fileoverview API Service Worker 実装
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

// enrich は互換維持のため opt-in（?enrich=1）とする
const apiServiceWorker = new StandardServiceWorker({ scope: 'API' });

console.log('🚀 API Service Worker が初期化されました:', apiServiceWorker.swConfig.API_PREFIX);
