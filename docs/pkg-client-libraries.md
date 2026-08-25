# pkg/ クライアントライブラリ解説

100BeautiesLab_CreationsDB をサブモジュールとして別リポジトリに導入する際に利用できるクライアントパッケージ群の設計・使い方を説明します。

---

## 概要

`pkg/` 配下には以下の 5 種類のパッケージが含まれます。

| パッケージ             | パス              | 用途                                                |
| ---------------------- | ----------------- | --------------------------------------------------- |
| **Node.js ライブラリ** | `pkg/nodejs/`     | Node.js / Vue.js SSR / Nuxt / Vite SSR など         |
| **Python モジュール**  | `pkg/python/`     | Python スクリプト / Jupyter Notebook / FastAPI など |
| **C# クライアント**    | `pkg/csharp/`     | Unity / .NET アプリケーション                       |
| **Cloudflare Workers** | `pkg/cloudflare/` | サーバーサイド HTTP API（Service Worker 代替）      |
| **MCP サーバー**       | `pkg/mcp/`        | GitHub Copilot Agent / LLM ツールとの連携           |

---

## 設計方針

### 非破壊・独立原則

`pkg/` のクライアントは既存の `lib/sw-common.js` / `pages/` / `api/` / `svc/` に依存しません。
Service Worker グローバル（`self`）やブラウザ API を使わず、ファイルシステム I/O（Node.js `fs` / Python `pathlib` / C# `System.IO`）でデータを直接読み込みます。

### セキュリティ

すべての workId / dbName はエントリーポイントで英数字＋アンダースコアのみ許可するトークン検証を行います。不正な値は即 `null` / 例外 / 400 相当のエラーとして処理します。

---

## リポジトリルートの自動解決

`pkg/` のクライアントはコンストラクタの引数を**省略できます**。サブモジュールとして配置すれば、追加設定なしに動作します。

### 解決の仕組み

各クライアントは自ファイルの位置を起点にリポジトリルートを算出します。

```
<repo root>/
├── data/
│   └── db_meta.json        ← C# の FindRepoRoot() がこのファイルの存在を目印にする
└── pkg/
    ├── nodejs/
    │   └── index.mjs       ← ここから 2 階層上 = repo root
    ├── python/
    │   └── creationsdb/
    │       └── client.py   ← ここから 4 階層上 = repo root
    ├── csharp/
    │   └── CreationsDBClient.cs  ← アセンブリ位置から上方探索
    └── mcp/
        └── server.mjs      ← ここから 2 階層上 = repo root
```

### Node.js

```js
// pkg/nodejs/index.mjs 内での定義
const _DEFAULT_REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
```

省略形（推奨）:

```js
import { CreationsDBClient } from "./submodules/100BeautiesLab_CreationsDB/pkg/nodejs/index.mjs";
const db = new CreationsDBClient();
```

明示指定（任意のパスを使う場合）:

```js
const db = new CreationsDBClient("/path/to/100BeautiesLab_CreationsDB");
```

### Python

```python
# pkg/python/creationsdb/client.py 内での定義
_DEFAULT_REPO_ROOT = str(Path(__file__).resolve().parent.parent.parent.parent)
```

省略形（推奨）:

```python
from creationsdb import CreationsDBClient
db = CreationsDBClient()
```

明示指定（任意のパスを使う場合）:

```python
db = CreationsDBClient('/path/to/100BeautiesLab_CreationsDB')
```

### C#

```csharp
// CreationsDBClient.cs 内での定義
public static string? FindRepoRoot()
{
    // アセンブリ位置 → 実行ベースディレクトリ → カレントディレクトリ の順に
    // 上位フォルダをたどり、data/db_meta.json が存在するフォルダを返す
}
```

省略形（推奨）:

```csharp
using CreationsDB;
var db = new CreationsDBClient();  // FindRepoRoot() で自動探索
```

明示指定（Unity など明示したい場合）:

```csharp
var db = new CreationsDBClient(
    Path.Combine(Application.dataPath, "Submodules/100BeautiesLab_CreationsDB")
);
```

### MCP サーバー

MCP サーバーはコマンドライン引数 → 環境変数 → ファイル位置の順で解決します。

```sh
# 省略形（サブモジュール配置時）
node pkg/mcp/server.mjs

# 明示指定
node pkg/mcp/server.mjs --repo-root /path/to/100BeautiesLab_CreationsDB
# または
CREATIONSDB_REPO_ROOT=/path/to/100BeautiesLab_CreationsDB node pkg/mcp/server.mjs
```

---

## API サーフェス

Node.js / Python / C# の 3 クライアントは同じ API サーフェスを持ちます（命名規則は各言語の慣習に従う）。

### メソッド対応表

| 機能               | Node.js                                        | Python                                              | C#                                                  |
| ------------------ | ---------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| グローバルメタ取得 | `getMeta()`                                    | `get_meta()`                                        | `GetMetaAsync()`                                    |
| 作品一覧           | `listWorks()`                                  | `list_works()`                                      | `ListWorksAsync()`                                  |
| 作品別メタ取得     | `getWorkMeta(workId)`                          | `get_work_meta(work_id)`                            | `GetWorkMetaAsync(workId)`                          |
| 作品別 typedef 取得 | `getWorkType(workId)`                         | `get_work_type(work_id)`                            | `GetWorkTypeAsync(workId)`                          |
| DB 一覧            | `listDBs(workId)`                              | `list_dbs(work_id)`                                 | `ListDbsAsync(workId)`                              |
| インデックスキー解決 | `getIndexKey(workId, dbName?)`               | `get_index_key(work_id, db_name?)`                  | `GetIndexKeyAsync(workId, dbName?)`                 |
| レコード一覧       | `getRecords(workId, dbName)`                   | `get_records(work_id, db_name)`                     | `GetRecordsAsync(workId, dbName)`                   |
| レコード 1 件      | `getRecord(workId, dbName, idxValue, idxKey?)` | `get_record(work_id, db_name, idx_value, idx_key?)` | `GetRecordAsync(workId, dbName, idxValue, idxKey?)` |
| DB 内検索          | `search(workId, dbName, query)`                | `search(work_id, db_name, query)`                   | `SearchAsync(workId, dbName, query)`                |
| 作品横断検索       | `searchAll(workId, query)`                     | `search_all(work_id, query)`                        | `SearchAllAsync(workId, query)`                     |

### 共通オプション

| オプション       | 既定    | 説明                                                                                       |
| ---------------- | ------- | ------------------------------------------------------------------------------------------ |
| `includePrivate` | `false` | `isPrivate: true` のレコードを含めるか                                                     |
| `includeHidden`  | `false` | `Works_Hidden` / `DB_Hidden` の作品・DB を含めるか。既定では一覧・直接アクセスとも遮断する |

---

## 対応する DB 機構

`pkg/` の FS クライアント（Node.js / Python / C#）は `lib/sw-common.js` / `lib/data-common.js` の移植版です。
**本体側の機構追加に自動追従しない**ため、以下の対応状況を把握したうえで利用してください。

### 対応済み

| 機構                                   | 説明                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `isPrivate` 除外                       | 既定で非公開レコードを返さない                                                           |
| `_Commons` / `_Secondaries` 補完       | `sec_SeriesTitle` を主キー、`sec_Category` / `sec_DesignedBy` を追加条件とするスコア一致 |
| `_ListLinkIf_<Field>` 条件付き commons | レコード値に応じた条件分岐の穴埋め                                                        |
| `Works_Hidden` / `DB_Hidden`           | 一覧からの除外に加え、直接アクセスも 404 相当のエラーで遮断                               |
| `Works_Dir` / `Works_Shared`           | 共通資料の疑似作品（`#Works_CommonReferences` → `data/References/`）の解決                |
| レイヤー畳み込み                       | `DB_Layer` が物理ディレクトリ名と同名の場合に二重パスを避ける                             |
| root フォールバック                    | `DataBases/` を持たない作品の `db_meta.json` / `db_type.json` を直下から読む              |
| `$IndexDef` / `$IndexDef_<DbNorm>`     | インデックスキーをスキーマから解決（DB 単位の上書きを含む）                              |
| `DB_Label` / `DB_Label_EN` / `DB_Image` | DB カタログ情報の pass-through                                                           |
| 旧作品名エイリアス                     | `Proxies` → `Works_DestinyFoxRecords`                                                    |

### 未対応（Service Worker 専用）

| 機構                | 備考                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `_DBLink` / `_Jump` | 参照解決 enrich。Cloudflare Workers 版も同様に未対応（次フェーズ）        |
| `_DBCrossLinkPath`  | 画像パスの DB/Work 横断参照。UI 層で解決するため FS クライアントでは不要 |

### インデックスキーのスキーマ駆動解決

作品ごとにインデックスキーが異なるため、`getRecord()` は `idxKey` 省略時にスキーマから自動解決します。
`idxKey` を明示した場合はそちらが優先されます。

```js
await db.getIndexKey("NumberTales", "Primary"); // → "Num"
await db.getIndexKey("FLInvestigator78", "Primary"); // → "Card.Suit"
await db.getIndexKey("ShouArRiders", "Primary"); // → "BeastType.Beast"

// $IndexDef_<DbNorm> サイドカーによる DB 単位の上書き
await db.getIndexKey("DestinyFoxRecords"); // → "Unit"（作品既定）
await db.getIndexKey("DestinyFoxRecords", "Proxy"); // → "Generation"（Proxy DB のみ上書き）

// idxKey 省略で正しく引ける
await db.getRecord("FLInvestigator78", "Primary", "Major");
```

導出規則は `pkg/cloudflare/scripts/migrate.mjs` の `resolveIdxKey()` と同一です
（ネスト型は `#IndexListKey` → `#Number` → 先頭要素 の優先順で主インデックスの子要素を選ぶ）。

### 非公開制御

`Works_Hidden` / `DB_Hidden` は**一覧からの除外だけでなく直接アクセスも遮断**します
（`docs/api-sw-spec.md` §5.3 / §5.4 の「リストと直接アクセスの両方から 404」に対応）。

```js
await db.listDBs("FLInvestigator78"); // → 隠しDBは含まれない
await db.getRecords("FLInvestigator78", "UnprocessedDealer"); // → CreationsDBNotFoundError
```

エラー型: Node.js `CreationsDBNotFoundError` / Python `CreationsDBNotFoundError` / C# `CreationsDBNotFoundException`。

リポジトリ所有者のローカルツール等で非公開データを扱う場合のみ `includeHidden` でオプトインします。

> **注意**: `isPrivate` のフィルタは `_Commons` 適用**後**に行います。
> `_Secondaries[]._Commons.isPrivate: true` のように、レコード自身ではなく所属シリーズ側で
> 非公開指定されるケースがあるためです。順序を逆にすると注入値が読まれず、
> 非公開指定のレコードが公開されてしまいます。

---

## Cloudflare Workers API

ファイルシステムが使えない環境向けに、GitHub Pages の静的 JSON を `fetch` で取得するサーバーサイド API です。
Service Worker 版と同等のエンドポイント仕様を提供します。

```
GET /api/v1/meta
GET /api/v1/works
GET /api/v1/:work/meta
GET /api/v1/:work/dbs
GET /api/v1/:work/:db/records
GET /api/v1/:work/:db/records/:idx?idxKey=X
GET /api/v1/:work/:db/search?q=キーワード
GET /api/v1/:work/search?q=キーワード
```

詳細は `pkg/cloudflare/README.md` を参照してください。

---

## MCP サーバー

GitHub Copilot Agent モードや他の LLM ツールに公開するツール一覧:

| ツール名             | 説明                                            |
| -------------------- | ----------------------------------------------- |
| `list_works`         | 作品一覧の取得                                  |
| `list_dbs`           | DB 一覧の取得                                   |
| `get_records`        | レコード一覧の取得                              |
| `get_record`         | インデックス値でレコード 1 件取得               |
| `get_index_key`      | DB のインデックスキーをスキーマから解決         |
| `search_records`     | DB 内全文検索                                   |
| `search_all_records` | 作品横断全文検索                                |

MCP サーバーは Node.js クライアントを内部で利用するため、`pkg/nodejs/` の変更がそのまま反映されます。
`includePrivate` / `includeHidden` とも `false` で生成するため、非公開データは LLM へ一切公開されません。

詳細は `pkg/mcp/README.md` を参照してください。

---

## サブモジュールとして使う手順

```sh
# 親リポジトリに追加
git submodule add https://github.com/radiann-kswg/100BeautiesLab_CreationsDB submodules/100BeautiesLab_CreationsDB

# サブモジュールを最新化
git submodule update --remote
```

---

## テスト

`tests/pkg.nodejs.test.js`（Vitest）が Node.js クライアントの DB 機構追従を検証します。

`pkg/` は本体側の機構追加に自動追従しないため、**`lib/` に DB 機構を追加したら本テストの
期待値も見直してください**。Python / C# は同一 API サーフェスを持つ独立移植のため、
Node.js 側の期待値を変更したら両者も追従させる必要があります。

```sh
npx vitest run tests/pkg.nodejs.test.js
```

---

## 更新履歴

| 日付       | 内容                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-02 | `pkg/` 全 5 パッケージを新規実装（Node.js / Python / C# / Cloudflare Workers / MCP）                                                                                                  |
| 2026-06-02 | コンストラクタの `repoRoot` 引数を省略可能化（サブモジュール配置時に自動解決）                                                                                                        |
| 2026-07-13 | FS クライアント 4 種（Node.js / Python / C# / MCP）を本体 DB 機構へ追従。`Works_Hidden` / `DB_Hidden` の直接アクセス遮断、`Works_Dir` オーバーライド、`$IndexDef` のスキーマ駆動解決、旧作品名エイリアス、JP/EN 命名、`_Secondaries` の完全一致規則、`isPrivate` フィルタ順序の修正。`tests/pkg.nodejs.test.js` を新設 |
