/**
 * Service Worker: SVC エイリアス（広告ブロッカー回避用）
 *
 * /api での広告ブロッカーを回避するため /svc 下に配置された
 * API Service Worker のエイリアス実装
 *
 * ルート表・依存の組み立て・事前キャッシュは `lib/sw-common.js` の
 * `StandardServiceWorker` に集約されています。本ファイルはスコープ設定のみを持ちます。
 *
 * @fileoverview SVC Service Worker 実装
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

// api/sw.js と同じ挙動（enrich は ?enrich=1 で opt-in）。scope 名だけが応答に載る
const svcServiceWorker = new StandardServiceWorker({ scope: 'SVC' });

console.log('🚀 SVC Service Worker が初期化されました:', svcServiceWorker.swConfig.API_PREFIX);
