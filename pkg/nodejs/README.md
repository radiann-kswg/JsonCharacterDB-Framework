# CreationsDB — Node.js ライブラリ

100BeautiesLab_CreationsDB をサブモジュールとして導入した Node.js / Vue.js (SSR) 環境から、ファイルシステム経由で DB レコードを取得・検索するためのライブラリです。  
Service Worker / ブラウザ API に依存せず、**Node.js 18 以上** の ESM 環境で単独動作します。

---

## 動作要件

| 条件 | 詳細 |
|------|------|
| ランタイム | Node.js 18.0.0 以上（ESM） |
| 外部依存 | **なし**（Node.js 標準 API のみ） |
| 対応環境 | Node.js CLI / Express / Nuxt (SSR) / Vite SSR など |

---

## セットアップ

```sh
# 親リポジトリにサブモジュールとして追加
git submodule add https://github.com/radiann-kswg/100BeautiesLab_CreationsDB submodules/100BeautiesLab_CreationsDB
```

---

## 基本的な使い方

```js
import { CreationsDBClient } from './submodules/100BeautiesLab_CreationsDB/pkg/nodejs/index.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, 'submodules/100BeautiesLab_CreationsDB');

const db = new CreationsDBClient(repoRoot);

// 作品一覧を取得
const works = await db.listWorks();
console.log(works.map(w => w.Title_JP));
// → ['ナンバーテールズ', '運命線探偵78', ...]

// 特定作品の DB 一覧を取得
const dbs = await db.listDBs('NumberTales');
console.log(dbs.map(d => d.key));
// → ['Primary', 'Secondary', ...]

// レコード一覧を取得（_Commons 補完済み・非公開除外）
const records = await db.getRecords('NumberTales', 'Primary');
console.log(records[0]);

// インデックス値でレコードを 1 件取得
// idxKey を省略するとスキーマ（$IndexDef）から自動解決される
const record = await db.getRecord('NumberTales', 'Primary', '25');
console.log(record?.Name_JP);

// 索引キーは作品ごとに異なる。事前に確認もできる
await db.getIndexKey('FLInvestigator78', 'Primary'); // → 'Card.Suit'
const card = await db.getRecord('FLInvestigator78', 'Primary', 'Major');

// 全文検索（大小文字無視）
const hits = await db.search('NumberTales', 'Primary', 'たぬき');
console.log(hits.length);

// 作品内全 DB を横断検索
const allHits = await db.searchAll('NumberTales', '狼');
console.log(allHits.map(h => `${h.db}: ${h.record.Name_JP}`));
```

---

## API リファレンス

### `new CreationsDBClient(repoRoot?, options?)`

| 引数 | 型 | 説明 |
|------|----|------|
| `repoRoot` | `string` (**省略可**) | サブモジュールのルートディレクトリ絶対パス。省略時は `index.mjs` の 2 階層上を自動使用 |
| `options.includePrivate` | `boolean` | `isPrivate: true` レコードを含めるか（既定: `false`） |
| `options.includeHidden` | `boolean` | `Works_Hidden` / `DB_Hidden` の作品・DB を含めるか（既定: `false`） |

### `client.listWorks()`
作品一覧を返します。`Works_Hidden: true` の作品は除外されます。  
各要素: `{ key, Title_JP, Title_EN, Works_Summary_JP, Works_Summary_EN, Works_Shared, OldTitles, Works_OfficialLinks }`

### `client.listDBs(workId)`
指定作品で利用可能な DB 一覧を返します。`DB_Hidden: true` の DB は除外されます。  
各要素: `{ key, file, layer, DB_Label, DB_Label_EN, DB_Image }`

### `client.getIndexKey(workId, dbName?)`
DB のインデックスキー（`getRecord()` の `idxValue` が照合されるフィールド）をスキーマから解決します。  
`dbName` 省略時は作品既定のキーを返します。

```js
await db.getIndexKey('NumberTales', 'Primary');       // → 'Num'
await db.getIndexKey('FLInvestigator78', 'Primary');  // → 'Card.Suit'
await db.getIndexKey('DestinyFoxRecords', 'Proxy');   // → 'Generation'（DB 単位の上書き）
```

### `client.getWorkType(workId)`
作品別の型定義（`db_type.json`）を返します。未存在時は空オブジェクト。

### `client.getRecords(workId, dbName, options?)`
DB のレコード配列を返します。  
- `options.applyCommons` (boolean, 既定: `true`): `_Commons` / `_Secondaries` 補完を適用するか

### `client.getRecord(workId, dbName, idxValue, idxKey?)`
インデックス値でレコードを 1 件返します。見つからない場合は `null`。

| 引数 | 型 | 既定値 | 説明 |
|------|----|--------|------|
| `idxValue` | `string\|number` | — | インデックス値（例: `"25"`, `"Major"`） |
| `idxKey` | `string` | スキーマから自動解決 | インデックスフィールド名（ドット記法可: `"Card.Num"`）。明示した場合はそちらを優先 |

### `client.search(workId, dbName, query)`
DB 内でキーワード全文検索を行い、ヒットしたレコード配列を返します。

### `client.searchAll(workId, query)`
作品内の全 DB を横断検索し、`{ db: string, record: Object }[]` を返します。

### `CreationsDBNotFoundError`
対象が存在しない、または非公開（`Works_Hidden` / `DB_Hidden`）のため参照できない場合に投げられます。  
Service Worker / Cloudflare Workers 版の 404 レスポンスに対応します。

```js
import { CreationsDBClient, CreationsDBNotFoundError } from '.../pkg/nodejs/index.mjs';

try {
  await db.getRecords('FLInvestigator78', 'UnprocessedDealer'); // DB_Hidden
} catch (e) {
  if (e instanceof CreationsDBNotFoundError) { /* 非公開 */ }
}
```

---

## Vue.js / Nuxt での利用例

### Nuxt 3 (SSR / `server/api/` ルート)

```ts
// server/api/characters/[work]/[db].get.ts
import { CreationsDBClient } from '~/submodules/100BeautiesLab_CreationsDB/pkg/nodejs/index.mjs';
import { join } from 'node:path';

const db = new CreationsDBClient(join(process.cwd(), 'submodules/100BeautiesLab_CreationsDB'));

export default defineEventHandler(async (event) => {
  const { work, db: dbName } = getRouterParams(event);
  return db.getRecords(work, dbName);
});
```

---

## workId の指定形式

以下はすべて同じ作品を指します：

```
"NumberTales"
"Works_NumberTales"
"#Works_NumberTales"
```

---

## 注意事項

- 本ライブラリはローカルファイルシステムを直接読むため、**GitHub Pages (静的配信) 上では動作しません**。ブラウザ環境では Service Worker API (`/pages/v1/*`) を使用してください。
- `getRecords()` は毎回ファイルを読み直します。高頻度アクセス時は呼び出し側でキャッシュを実装してください。
- `isPrivate: true` のレコードは既定で除外されます。`new CreationsDBClient(root, { includePrivate: true })` で全件取得できます。
- `Works_Hidden` / `DB_Hidden` の作品・DB は、一覧からの除外に加えて**直接アクセスも遮断**されます（`CreationsDBNotFoundError`）。リポジトリ所有者のローカルツール等で非公開データを扱う場合のみ `{ includeHidden: true }` でオプトインしてください。
- `_DBLink` / `_Jump` の参照解決 enrich は**未対応**です（Service Worker 専用）。対応機構の一覧は `docs/pkg-client-libraries.md` を参照してください。
