# API / Service Worker 技術仕様メモ

このドキュメントは、`/api/v1/*`・`/pages/v1/*`・`/svc/v1/*` の擬似 API と、その背後にある Service Worker / 共通ライブラリの役割分担、および Cloudflare Workers 実 API の仕様を、実装に沿って整理した技術メモです。

対象読者:

- API / SW 周辺のコードを追いたい人
- `db_meta.json` と `db_type.json` の責務差を理解したい人
- `_enrichment` や `_DBLink` の挙動を修正したい人
- Cloudflare Workers 実 API (`pkg/cloudflare/`) を参照したい人

---

## 0. API 二層構成（ADR-0001 採択、2026-06-21）

本リポジトリの API は以下の二層で提供される。

| 層           | エンドポイント                                      | 実装                                            | データソース                  | 主な用途                               |
| ------------ | --------------------------------------------------- | ----------------------------------------------- | ----------------------------- | -------------------------------------- |
| **実 API**   | `database.numbertales-radiann.net/api/v1/*`         | Cloudflare Workers (`pkg/cloudflare/worker.js`) | R2（JSON ミラー）+ D1（FTS5） | 外部クライアント・curl・モバイルアプリ |
| **疑似 API** | `(同一オリジン)/api/v1/*` `/pages/v1/*` `/svc/v1/*` | Service Worker (`pages/sw.js` 等)               | GitHub Pages 静的 JSON        | ブラウザ・キャラシート UI              |

- 疑似 API（SW）は完全 enrich（`_DBLink`/`_Jump` 解決）付き。実 API（Workers）は現時点で `_Commons` 適用のみ（次フェーズで拡張予定）。
- クライアント（`pkg/nodejs`, `pkg/python`, `pkg/csharp`）はローカル JSON を直接読むため、どちらの API にも依存しない。
- Workers のセットアップ手順: `pkg/cloudflare/README.md` を参照。

### Cloudflare Workers 実 API エンドポイント

| メソッド | パス                             | データソース | 説明                                                               |
| -------- | -------------------------------- | ------------ | ------------------------------------------------------------------ |
| GET      | `/api/v1/meta`                   | R2           | グローバルメタ (`data/db_meta.json`)                               |
| GET      | `/api/v1/works`                  | D1 `works`   | 作品一覧（`Works_Hidden=true` 除外、`Works_OfficialLinks[]` 含む） |
| GET      | `/api/v1/:work/meta`             | R2           | 作品別メタ (`data/Works_*/DataBases/db_meta.json`)                 |
| GET      | `/api/v1/:work/dbs`              | D1 `dbs`     | DB 一覧（`DB_Hidden=true` 除外）                                   |
| GET      | `/api/v1/:work/:db/records`      | D1 `records` | レコード一覧（`isPrivate=0`・`_Commons` 適用）                     |
| GET      | `/api/v1/:work/:db/records/:idx` | D1 `records` | 1 件取得（`?idxKey=X` でフィールド指定）                           |
| GET      | `/api/v1/:work/:db/search?q=`    | D1 FTS5      | DB 内全文検索                                                      |
| GET      | `/api/v1/:work/search?q=`        | D1 FTS5      | 作品横断全文検索                                                   |

### D1 スキーマ概要

- `works`: 作品メタ（`key`, `title`, `title_en`, `summary`, `is_hidden`, `meta_json`）
- `dbs`: DB メタ（`work_key`, `db_key`, `db_label`, `db_label_en`, `db_layer`, `is_hidden`）
- `records`: レコード本体（`work_key`, `db_name`, `idx_key`, `idx_value`, `is_private`, `searchable_text`, `data_json`）
- `records_fts`: FTS5 仮想テーブル（`records` を content として外部コンテンツ。INSERT/DELETE/UPDATE トリガーで自動同期）

スキーマ定義: `pkg/cloudflare/schema/d1-init.sql`
マイグレーション: `pkg/cloudflare/scripts/migrate.mjs`

### Workers 実 API と SW 疑似 API の URL 書式比較

両 API は `/api/v1/` を共有するが、`:work` と `:db` の配置が異なる。

| 操作          | Workers 実 API                   | SW 疑似 API                               |
| ------------- | -------------------------------- | ----------------------------------------- |
| 作品一覧      | `/api/v1/works`                  | `/api/v1/works`                           |
| DB 一覧       | `/api/v1/:work/dbs`              | `/api/v1/works/:work/dbs`                 |
| レコード一覧  | `/api/v1/:work/:db/records`      | `/api/v1/works/:work/db/:db/records`      |
| レコード 1 件 | `/api/v1/:work/:db/records/:idx` | `/api/v1/works/:work/db/:db/records/:idx` |
| DB 内検索     | `/api/v1/:work/:db/search?q=`    | `/api/v1/works/:work/db/:db/search?q=`    |
| 作品横断検索  | `/api/v1/:work/search?q=`        | `/api/v1/works/:work/search?q=`           |

主な差分:

- SW 疑似 API: `works/` プレフィックスと `db/` インフィックスを持つ
- Workers 実 API: `:work` と `:db` が直接パスに並ぶ（`works/` / `db/` は省略）
- 疎通確認の具体的な URL 例は `docs/deploy-howto.md` §3 を参照。

---

## 1. 全体像

このリポジトリでは GitHub Pages の静的配信上で、3 つの Service Worker スコープが擬似 API を提供します。

- `/api/v1/*`
  - 標準 API
  - 既定では `resolve=true`, `enrich=false`
- `/pages/v1/*`
  - キャラシート UI 用 API
  - 既定で `resolve=true`, `enrich=true`
- `/svc/v1/*`
  - `/api` が広告ブロッカーに妨げられる環境向けのミラー
  - 既定では `resolve=true`, `enrich=false`

実装ファイルの対応:

- `api/sw.js`: `/api/v1/*` の入り口
- `pages/sw.js`: `/pages/v1/*` の入り口。加えて `/svc/v1/*` と `/api/v1/*` のエイリアスも扱う
- `svc/sw.js`: `/svc/v1/*` の入り口
- `lib/sw-common.js`: ルーティング、レスポンス生成、DB 読み込み、標準エンドポイントの共通実装
- `lib/data-common.js`: 参照解決、enrich、typedef 駆動の正規化・検索・画像抽出の共通実装

### 1.1 入口ファイルと `StandardServiceWorker`

3 つの入口はルート表・依存の組み立て・事前キャッシュがすべて同一だったため、
実装は `lib/sw-common.js` の **`StandardServiceWorker`**（`ServiceWorkerBase` を継承）に集約しています。
入口ファイルはスコープ設定だけを持ち、`api/sw.js` と `svc/sw.js` は各 30 行程度です。

スコープ差はコンストラクタ引数の 3 つだけです。

| 引数 | api | svc | pages |
| --- | --- | --- | --- |
| `scope` | `'API'` | `'SVC'` | `'Pages'` |
| `resolvePrefixes` | 省略（`API_PREFIX` のみ） | 省略（同左） | `/pages/v1` + `/svc/v1` + `/api/v1` の 3 本 |
| `enrichDefault` | `false`（`?enrich=1` で opt-in） | `false`（同左） | `true`（常時 enrich） |

固有エンドポイントを足す場合はサブクラスで **`routeExtraEndpoints(seg, url, resolve, debug, enrich)`** を実装します
（現状の利用は `pages/sw.js` の `/pages/v1/enrich` のみ）。未処理なら `null` を返してください。

> **未知パスの扱い（重要）**: `StandardEndpointHandlers.handleAdvancedEndpoints()` は未処理時に `null` を返します。
> 共通ルート表はこれを受けて必ず `ResponseUtils.notFound()` へフォールバックします。
> ここを素通しすると `event.respondWith(null)` となり、404 JSON ではなく**ネットワークエラー**になります
> （統合前の `api/sw.js` / `svc/sw.js` に実在した不具合。2026-08-08 修正）。
> 回帰は `tests/sw.routing.test.js` が守っています。

---

## 2. リクエスト処理の流れ

典型的な `GET /pages/v1/works/{work}/db/{dbName}` は次の順序で処理されます。

1. 各 `sw.js` がリクエストパスを自分の prefix と照合する
2. `StandardEndpointHandlers.handleDbEndpoint()` が対象 DB JSON を読む
3. 作品別 `db_meta.json` が読めれば `_Commons` / `_Secondaries` を適用する
4. `resolve=1` の場合、`ReferenceResolver.resolveAllInAny()` で `#Works` / `#DB` / `#$image` を解決する
5. `enrich=1` の場合、`EnrichmentProcessor.enrichRecords()` で `_DBLink` / `_Jump` / `$alt` / 画像情報 / searchableText / displaySections を付与する
6. JSON レスポンスとして返す

補足:

- `/pages/v1/*` は UI がそのまま使うため、既定で enrich 有効です
- `/api/v1/*` と `/svc/v1/*` は既存互換を優先し、`?enrich=1` を付けたときだけ enrich します
- `resolve=0` を付けると、`#Works` や `#DB` などの参照解決をスキップできます
- `isPrivate: true` を持つレコードは、`db` / `search` / `bootstrap` / `enrich` 系レスポンスから除外します
- **除外は必ず `_Commons` / `_Secondaries` 適用の「後」に行います**。`isPrivate` はレコード自身の宣言だけでなく、`_Secondaries[]._Commons.isPrivate: true` のように**所属シリーズ側から注入**されることがあるため、適用前に判定すると注入値が読まれず非公開指定のレコードが公開されてしまいます（実バグとして発生・修正済み）。Cloudflare Workers 側では D1 の `is_private` 列を `scripts/migrate.mjs` が `_Commons` 適用後の値から算出することでこの規則を担保します
- `_DBLink` の参照先探索でも `isPrivate: true` の候補は採用しません
- `Works_Hidden: true` を持つ作品は、作品一覧・配下のDB・検索の全エンドポイントから除外または 404 で遮断されます（後述の §5.4 を参照）
- `DB_Hidden: true` を持つDBは、作品配下のDB一覧・直接アクセス・検索から除外または 404 で遮断されます（後述の §5.3 を参照）

### 2.1 リクエストスコープのメモ化（`DataFetcher`）

上記 1〜6 の全体は `ServiceWorkerBase.handleApiRequestInScope()` が
`DataFetcher.beginRequestScope()` / `endRequestScope()` で挟んで実行します。
このスコープが有効な間、**メタ・型・辞書 JSON の取得と `HEAD` による存在確認は同一パスにつき 1 回へ合流**します。

- **対象**: パス末尾が `db_meta.json` / `db_type.json` のもの、および `/Dictionaries/` 配下（`DataFetcher._isMemoizableJsonPath()`）
- **非対象**: レコード本体（`db_*.json` / `ref_*.json` / `trans_*.json`）。
  `CommonsProcessor.applyCommonsToRecords()` はレコードを **in-place で書き換える**（`rec[k] = v`）ため、
  レコード配列を共有すると 2 番目以降の利用者が `_Commons` 適用済みの配列を受け取り、別 DB 文脈の値が混ざります
- **鮮度**: TTL を持たず、参照カウントが 0 へ戻った時点でキャッシュごと破棄します。
  リクエストをまたいで古い内容が残ることはありません（並行する複数リクエストが重なっている間だけ共有します）
- **失敗の扱い**: 404 等の失敗も同一スコープ内では再試行しません。
  `readRefMeta()` / `readLocMeta()` のように「無ければ空を返す」分岐が多く、同一リクエスト内で再取得しても結果が変わらないためです
- 解決値ではなく **Promise 自体**をキャッシュするため、逐次呼び出しだけでなく並行呼び出しも 1 本のフェッチへ合流します

**効果（`/pages/v1/bootstrap?includeRecords=1&enrich=1` の実測）**:
リクエスト **2105 → 252（88.0% 減）**、転送 25.46 → 20.14 MiB。
導入前は `Works_FLInvestigator78/DataBases/db_meta.json` を **39 回**読み直していました。

> 残る 252 リクエストの多くはレコード本体の再読み込みで、`_DBLink` 解決に使う `resolveCache` が
> `handleBootstrapEndpoint()` の **DB ごとのループ内で作り直されている**ことに由来します。
> こちらは別途の最適化対象です（本メモ化の対象外）。

---

## 3. 各定義ファイルの責務

### 3.1 `db_*.json`

- 実データ本体です
- キャラクターごとのフィールド値を持ちます
- `_DBLink` や `_Jump` のような機械処理キーも、ここに含まれることがあります

### 3.2 `db_type.json`

- 基本的に「正」として扱う型定義です
- 主な役割:
  - `$DefType`: フィールド定義、表示ラベル、`$display.section`、`$alt`、検索対象の補助
  - `$IndexDef`: 作品ごとの index 解釈
  - `$VarsDef`: enum/list 辞書の追加定義

UI と enrich/search は、可能な限りこの `db_type.json($DefType)` に追従します。

補足:

- live data 上の `$Def_*` 宣言は `$DefType` に統一します。新規追加・更新では `$TypeDef` を使わず、SW/UI も `$DefType` を前提に扱います。

### 3.3 `db_meta.json`

- 補助メタ情報です
- 主な役割:
  - `General.$VarsDef`: enum/list 辞書
  - `$MetaType`: 作品/DB カタログ向けメタ情報の補助 schema 宣言
  - `CreationWorks.<work>.Title` / `Title_EN` / `Works_Summary` / `OldTitles` / `Works_OfficialLinks`: 作品一覧・作品概要のカタログ情報
  - `CreationWorks.<work>.$DetailLayout`: 詳細表示レイアウト補助
  - `CreationWorks.<work>.Works_Dir` / `Works_ImagesDir`: 物理ディレクトリ名オーバーライド（後述 §5.5）
  - `CreationWorks.<work>.Works_Shared`: 個別の創作タイトルではない共通カタログ（例: 共通資料）であることを示すフラグ。UI ではこれを持つ作品を別 `<optgroup>` へ分離表示する
  - `Databases.#DB_<DbName>` / `Databases.#Ref_<RefName>` の `DB_Label` / `DB_Label_EN` / `DB_Summary` / `DB_Layer` / `DB_File` / `StoryEra` / `DB_Image`: DB 一覧・DB概要のカタログ情報（`DB_Image` は特定レコードに紐づかないDB全体の代表画像ファイル名）
  - `Databases.#DB_<DbName>._Commons`: DB 全体の共通穴埋め
  - `Databases.#DB_<DbName>._Secondaries`: `sec_**` 条件に応じた `_Commons` 分岐
    - 全ての `sec_**` 条件が `null` / 空の定義はデフォルト fallback として扱い、`null` 以外の条件を持つ定義が一致した場合はそちらを優先します
  - `General.$VarsDef.#Dict_Faction[*].FactionsBaseArea`: 陣営辞書に紐づく活動拠点の補助情報。`Belonging.$dict = Faction` のような参照先辞書として使います
  - top-level `Dictionaries`: 辞書 DB カタログ。`data/Dictionaries/` や `data/Works_<work>/Dictionaries/` の `db_meta.json` を runtime で合流したものです

補足:

- 作品別 `db_meta.json` は未整備の作品が存在します
- そのため SW は `db_meta.json` 欠損を 500 エラーにせず、追加価値の処理だけをスキップして継続します
- `Area` / `Belonging` のような共通辞書は `db_meta.json` 本体ではなく `Dictionaries/db_*.json` に分離でき、`DataFetcher.readGlobalMeta()` / `readWorkMeta()` が `General.$VarsDef` へ runtime 合流します
- `Databases.#DB_<DbName>` に `"DB_Hidden": true` を置くと、そのDB全体が API から非公開になります（後述の 5.3 を参照）

---

## 4. 予約語の役割

内部処理では、プレフィックスごとに意味を分けています。

- `_`: 手続き・機械処理キー
  - 例: `_DBLink`, `_Jump`, `_Search`, `_Commons`, `_Secondaries`, `_enrichment`
- `$`: 宣言・定義キー
  - 例: `$DefType`, `$VarsDef`, `$IndexDef`, `$EnumDef_*`, `$display`
- `#`: 特殊フィールド名や辞書キー
  - 例: `#Works`, `#DB`, `#List_*`, `#Index`

通常の公開データフィールドは、原則としてこれらのプレフィックスを避け、先頭大文字の通常キーを使う前提です。

---

## 5. `db_meta.json` 欠損時のポリシー

作品別 `db_meta.json` は追加価値のレイヤーとみなし、欠損しても DB 取得や検索を止めません。

欠損時の挙動:

- `works/{work}` の作品メタ取得は 404 になります
- `works/{work}/db/{dbName}` は継続します
- `search` も継続します
- `_Commons` / `_Secondaries` は適用されません
- `isPrivate: true` のレコードは、meta 欠損有無に関わらず公開 API 応答へ含めません

この方針は、DB ファイル自体は存在するが作品メタが未整備な作品でも、最低限の API 利用を成立させるためです。

関連テスト:

- `tests/sw.dbmeta.tolerance.test.js`

---

## 5.1 作品一覧 / DB一覧エンドポイントのカタログ情報

`StandardEndpointHandlers` の一覧系エンドポイントは、`db_meta.json` の創作タイトル情報を次のように返します。

- `GET /pages/v1/works`
  - 各作品ごとに `key`, `Title`, `Title_EN`, `Works_Summary`, `OldTitles[]`, `Works_OfficialLinks[]` を返します
  - `Works_OfficialLinks[]` は公式サイト等の外部リンク配列（各要素 `{ URL, Label_JP, Label_EN, LinkType }`）。宣言が無い作品では空配列（`[]`）にフォールバックします。UI（キャラシート作品情報欄）は `http/https` の URL のみをリンク化し、`http/https` 以外は破棄します
- `GET /pages/v1/works/{work}`
  - `meta` に加えて `workInfo` を返し、グローバル `CreationWorks.<work>` のカタログ情報を参照できます
- `GET /pages/v1/works/{work}/db`
  - 各 DB ごとに `key`, `file`, `layer`, `metaKey`, `DB_Label`, `DB_Label_EN`, `DB_Summary`, `DB_Layer`, `StoryEra`, `SecondarySummary`, `DB_Image` を返します
- `GET /pages/v1/bootstrap`
  - 各作品項目に `workInfo` を含め、`databases[]` も上記の DB カタログ情報付きで返します

注意:

- `works/{work}/db` は作品別 `db_meta.json` が欠損していても 200 を維持し、概要情報だけ空文字 / `null` になります
- `StoryEra` は構造化データのまま返すため、UI 側では `about_JP` / `about_EN` を優先して整形します
- `DB_Label` / `DB_Label_EN` が未定義の旧メタでも、SW 側で既定表示名を補完して UI の破綻を避けます
- `DB_Layer` を作品別 `Databases.#DB_<DbName>` または `Databases.#Ref_<RefName>` に置くと、SW は `DataBases/` 固定ではなく指定レイヤー配下を探索します
- `#Ref_` prefix の catalog key は既定で `ref_<Name>.json` を優先探索するため、資料系を `References/ref_Glossary.json` / `References/ref_Reference.json` のようにまとめる場合は `DB_File` 省略でも動作します
- `DB_File` は、`db_<DbName>.json` / `ref_<Name>.json` の既定名からさらに外したい場合だけ使います
- UI / enrich の画像解決は DB key と同じ接頭辞を使い、`Images/DB_<DbName>/...` または `Images/Ref_<RefName>/...` を既定として扱います。作品共通画像のみ `Images/General/` を使います
- References 系 DB の画像 field は、shared `data/References/db_type.json` だけでなく作品別 `References/db_type.json` も UI 側で合流して解釈し、`concept-figure_PNGName` のような field 名からサブフォルダ名を導出して解決します。

### 5.2 カタログ用メタ schema 宣言

グローバル `data/db_type.json` では、作品/DB のカタログ情報を補助的に宣言するために `General.$MetaType` ではなくトップレベルの `$MetaType` を持ちます。

- `$Def_CreationWorkCatalog`
  - `Title`, `Title_EN`, `Works_Summary`, `OldTitles[]`, `Works_OfficialLinks[]`
- `$Def_OldTitleCatalog`
  - `Title`, `Title_EN`, `ArchivedYear`
- `$Def_OfficialLinkCatalog`
  - `LinkType`, `URL`, `Label_JP`, `Label_EN`
- `$Def_StoryEra`
  - `EraGen`, `YearInEra`, `byRealYear`, `about_JP`, `about_EN`
- `$Def_DatabaseCatalog`
  - `DB_Label`, `DB_Label_EN`, `DB_Summary`, `DB_Layer`, `DB_File`, `StoryEra`, `SecondarySummary`, `DB_Image`
- `$Def_StoryEraCatalog`
  - `FromEra[]`, `ToEra[]`, `InEra[]`, `about_JP`, `about_EN`

補足 (`$Def_DatabaseCatalog` の補助フィールドについて):

- `DB_Hidden: true` を持つエントリは `works/{work}/db` の一覧と `works/{work}/db/{dbName}` の直接アクセスの両方で非公開扱いになります。スキーマ上は `$Def_DatabaseCatalog` に宣言されていませんが（非公開フラグは表示メタではなくアクセス制御フラグのため）、`db_meta.json` の `Databases.#DB_<DbName>` に直接置く運用です。

---

## 5.3 `DB_Hidden` によるDB単位の完全非公開

`db_meta.json` の `Databases.#DB_<DbName>` に `"DB_Hidden": true` を設定すると、そのDB全体がAPIから非公開になります。

挙動:

- `GET .../works/{work}/db` — リスト応答に当該DBエントリが含まれません
- `GET .../works/{work}/db/{dbName}` — 404 `"Database not found"` を返します
- `search` の `?db=...` 指定でも同様に 404 になります
- メタ欠損時はチェックをスキップするため、`db_meta.json` が存在しない作品では本フラグは機能しません

`isPrivate: true`（レコード単位の非公開）と異なる点:

| 項目                         | `isPrivate: true`        | `DB_Hidden: true`                          |
| ---------------------------- | ------------------------ | ------------------------------------------ |
| 粒度                         | レコード単位             | DB 全体                                    |
| 適用場所                     | `db_*.json` の各レコード | `db_meta.json` の `Databases.#DB_<DbName>` |
| DBリスト (`works/{work}/db`) | DBエントリは残る         | DBエントリごと除外                         |
| `db/{dbName}` 直接アクセス   | 対象レコードだけ除外     | 404                                        |

---

## 5.4 `Works_Hidden` による作品単位の完全非公開

`data/db_meta.json` の `CreationWorks.#Works_<WorkName>` に `"Works_Hidden": true` を設定すると、その作品全体がAPIから完全に非公開になります。

挙動:

- `GET .../works` — リスト応答に当該作品エントリが含まれません
- `GET .../index` — 同上
- `GET .../bootstrap` — 同上
- `GET .../works/{work}` — 404 `"Work not found"` を返します
- `GET .../works/{work}/db` — 404 `"Work not found"` を返します
- `GET .../works/{work}/db/{dbName}` — 404 `"Work not found"` を返します
- `search?works={work}&...` — 404 `"Work not found"` を返します
- グローバルメタ (`data/db_meta.json`) 欠損時はチェックをスキップするため、`db_meta.json` が存在しない場合は機能しません

`DB_Hidden`・`isPrivate` との粒度比較:

| 項目                        | `isPrivate: true`        | `DB_Hidden: true`                          | `Works_Hidden: true`                                |
| --------------------------- | ------------------------ | ------------------------------------------ | --------------------------------------------------- |
| 粒度                        | レコード単位             | DB 全体                                    | 作品全体                                            |
| 適用場所                    | `db_*.json` の各レコード | `db_meta.json` の `Databases.#DB_<DbName>` | `db_meta.json` の `CreationWorks.#Works_<WorkName>` |
| 作品一覧 (`works`)          | 作品は残る               | 作品は残る                                 | 作品ごと除外                                        |
| `works/{work}` 直接アクセス | 対象レコードだけ除外     | 作品情報は返る                             | 404                                                 |
| `works/{work}/db`           | DBエントリは残る         | 該当DBが除外                               | 404                                                 |
| `works/{work}/db/{dbName}`  | 対象レコードだけ除外     | 404                                        | 404                                                 |

---

## 5.5 `Works_Dir` / `Works_ImagesDir` による物理レイアウトオーバーライド（共通資料の疑似作品）

`data/References/`（種族・組織・社会情勢・地域文化・語彙などの全作品共通辞書）と `data/GeneralImages/`（全作品共通の画像）を、`#Works_CommonReferences`（表示名: 共通資料 / Common References）という**仮想作品**として `works/{work}/db/{dbName}` の既存の仕組みでそのまま閲覧できるようにする機構。

背景: これらのフォルダは `Works_<Name>/DataBases/...` という通常の作品レイアウト規約に沿わない（`Works_` 接頭辞が無い・`DataBases/` サブフォルダが無い・画像も `<workDir>/Images/` ではなく別ルート直下）。フォルダを規約に合わせて移動すると、既存の「shared layer 上乗せ」機構（`pages/characters.js` の `fetchSharedLayerTypeDef('References')` 等が `data/References/db_type.json` を直接 fetch し、各作品の References レイヤーDB表示に合流する仕組み）が壊れるため、既存ファイルは一切移動せず、宣言的なオーバーライドで解決する。

`CreationWorks.<key>` に追加できる新規フィールド:

- `Works_Dir`（string, 省略可）: 物理ディレクトリ名オーバーライド。省略時は従来通り `Works_<id>` を導出する。
- `Works_ImagesDir`（string, 省略可）: 画像ルートのオーバーライド。省略時は従来通り `<workDir>/Images` を使う。
- `Works_Shared`（boolean, 省略可）: 個別の創作タイトルではない共通カタログであることを示すフラグ。UI の作品セレクトはこれを持つ項目を別 `<optgroup>` へ分離し、個別タイトルと混同されないようにする。

例（`data/db_meta.json`）:

```json
"#Works_CommonReferences": {
  "Title_JP": "共通資料",
  "Title_EN": "Common References",
  "Works_Dir": "References",
  "Works_ImagesDir": "GeneralImages",
  "Works_Shared": true
}
```

解決の流れ:

- `lib/sw-common.js` の `DataFetcher.resolveWorkDir(workId)` は、`getWorksDirOverrides()`（`data/db_meta.json` を軽量fetchして `Works_Dir` を集めたTTLキャッシュ）を優先し、無ければ既存の `resolveWorkDirName()`（`#Works_<Name>` → `Works_<Name>` の単純置換）にフォールバックする。既存作品はこのフィールドを持たないため、動作は一切変わらない。
- `readWorkMeta`/`readWorkType` は `DataBases/db_meta.json`（`db_type.json`）を先に試し、404なら直下の同名ファイルへフォールバックする（`References/` は `DataBases/` サブフォルダを持たないため）。
- `readDB`/`listWorkDBs` は、DB の `DB_Layer` が解決済み `workDir` 自身と一致する場合（例: `workDir==='References'` かつ `DB_Layer==='References'`）、パス結合時にレイヤーセグメントを畳み込み、`/data/References/References/...` の二重化を避ける。既存作品では `DB_Layer` が `Works_<Name>` 名と一致することは無いため非破壊。
- 画像側は `pages/characters.js` の `resolveImagesRootOverride(workId)` が同じ `Works_ImagesDir` を読み、`buildImagePath`/`resolveImageStatically` は `imagesRootOverride` があれば `/data/${imagesRootOverride}/...` を、無ければ従来通り `/data/${wdir}/Images/...` を使う。
- `pkg/cloudflare/worker.js`（`resolveWorkDirWithOverride`/`getWorkMeta`）と `pkg/cloudflare/scripts/migrate.mjs`（`resolveWorkDirForMigrate`/`readWorkBaseFile`）にも同じオーバーライド・フォールバック・レイヤー畳み込みを実装済み。R2アップロード（`data/**/*.json` を無条件・再帰的にアップロードする既存実装）と画像配信（GitHub Pagesからの直接静的配信、R2/D1を経由しない）は変更不要。

既知の制限:

- サーバ/enrich側の画像解決（`lib/data-common.js` の `ImageProcessor`）は今回オーバーライド対応していない。UI（`pages/characters.js`）は `_enrichment.images`/`primaryImage` を参照せず独自の画像解決を使うため実害は無いが、`enrich=1` の応答に含まれる `_enrichment.images` 系フィールドの値は共通資料の疑似作品では不正確になり得る（既存作品の per-work References DB でも同様の既存ギャップがあり、今回新規に持ち込んだものではない）。
- Cloudflare Workers/D1側は、他の実作品（`Works_NumberTales` 等）自体の「作品別Referencesレイヤーのマージ」（`readRefMeta`/`mergeLayerDatabases` 相当）を依然としてサポートしていない（既存の別ギャップ）。今回追加した `Works_Dir`/フォールバック/レイヤー畳み込みは、共通資料の疑似作品を成立させるための最小限の対応である。

DB全体の代表画像（`DB_Image`、§3.3/§5.2参照）も、この疑似作品向けに `data/References/db_meta.json` の `#Ref_Region8` エントリで使用している（`data/GeneralImages/Ref_Region8/cnsp-map_region8.png`、特定レコードに紐づかない第8界全体の俯瞰マップ）。

---

補足:

- 2026-05-11 時点では `StoryEra` と `Day` の summary 組み立てに向けて `$display.role` を導入し始めており、UI は `preferredLabel` / `representativePoint` / `rangeStart` / `rangeEnd` や `month` / `dayOfMonth` / `annotation` を参照できる状態になっています。
- 追加で `lib/wrapper-common.js` に shared value wrapper registry を導入し、`$display.wrapper` を持つ typedef は UI / SW 共通の formatter へ委譲できるようにした。2026-05-11 時点では `Day`, `Era`, `StoryEra` が wrapper 解決対象である。
- wrapper handler の基本シグネチャは `format(value, context)` で、`context` には `schemaType`, `defName`, `typeSources`, `helpers` が含まれる。
- works/{work}/db 系の DB カタログ応答は、構造化 `StoryEra` を raw のまま返すだけでなく `StoryEraSummary` も返せるようにし、SW 側でも shared wrapper を使って summary を生成するようにした。
- `EnrichmentProcessor.enrichRecords()` は `$display.wrapper` を持つ top-level field の summary を `_enrichment.wrapperSummaries` へ格納する。これにより UI は raw 構造と summary の両方を必要に応じて再利用できる。
- `StoryEraSummary` 自体も `lib/sw-common.js` の個別分岐ではなく、`$MetaType.$Def_DatabaseCatalog` に宣言された field のうち wrapper 解決できる項目から自動生成する。現状では `StoryEra` がその対象で、応答キーは `StoryEraSummary` になる。

これは現状の UI/SW が使うカタログ情報の宣言面を明示するための補助ブロックで、既存のキャラクター本体 schema (`$DefType`) を置き換えるものではありません。

---

## 6. `varsdef` / `typedef` / `deftype` の違い

名前が似ていますが、返すものは少しずつ違います。

- `varsdef`
  - 主に `General.$VarsDef` の俯瞰です
  - enum/list の辞書を確認したいときに使います
- `typedef`
  - `db_type.json` 全体、またはその作品版を返します
  - `$DefType` を含む型定義そのものを見たいときに使います
- `deftype`
  - API 利用側が使いやすい「表示辞書寄り」の結果です
  - `db_meta.json` に加えて `db_type.json($VarsDef)` 側の辞書も `General.$VarsDef` へ合成して返します
  - `db_type.json($DefType)` も併せて含みます（2026-07-01 修正）。フィールド名と `$dict` 名が異なる項目（例: `Belonging` フィールド → `Faction` 辞書）は、UI 側の辞書名解決（`findDictNameInSchema()`）が `$DefType` を必要とするため、これが欠けると当該フィールドが未翻訳のまま表示される不具合があった。

特に enum/list 辞書は `db_meta.json` だけでなく `db_type.json($VarsDef)` にも分散し得るため、API/UI ともに両者の合成を前提にしています。

---

## 7. `_enrichment` の出力仕様

`enrich=1` または `/pages/v1/*` の既定挙動では、各レコードへ `_enrichment` が付与されます。

主なキー:

- `_enrichment.images`
  - 画像候補一覧
  - `_DBCrossLinkPath`（§8.3）で解決したエントリも同じ配列に追記されます
- `_enrichment.primaryImage`
  - 代表画像
- `_enrichment.imageCount`
  - 画像件数
- `_enrichment.searchableText`
  - typedef 駆動で抽出した検索用の連結文字列
- `_enrichment.displaySections`
  - `basic/profile/spec/images/other` へ分類したトップレベルキー一覧
- `_enrichment.dictRefs`
  - typedef の `$dictRef` 宣言に従って辞書行から参照解決した値（`{ フィールド名: 解決済み値 }`）
  - 例: `Belonging: [{ Faction: "百花繚乱研究所" }]` → `dictRefs.Belonging = [{ Faction: "百花繚乱研究所", FactionsBaseArea: { Area: "九蓮国" } }]`
  - レコード本体（`Belonging`）の形は変えません。参照解決の結果はこのキーにだけ載ります
  - レコード側が同名の子要素へ実値を持つ場合は上書きせず、その要素は解決対象から外します（`_DBLink` の穴埋めと同じ方針）
- `_enrichment.altFallbacks`
  - `$alt` によりどの代替キーから穴埋めしたかの provenance
- `_enrichment.schemaDriven`
  - typedef 駆動で処理したことを示すフラグ
- `_enrichment.normalized`
  - 型定義に基づく軽い正規化を通したことを示すフラグ

注意:

- `_enrichment` は UI 制御用の補助メタです
- 公開表示では、そのまま全文を見せる前提ではありません
- UI 側は typedef / meta を使って、必要なキーだけを表示します
- `_enrichment.images`/`primaryImage` は `Works_Dir`/`Works_ImagesDir` オーバーライド（§5.5）に未対応。UI はこれらを参照せず独自解決するため実害は無いが、共通資料の疑似作品ではAPI応答上の値が不正確になり得る（既存の別ギャップ）

---

## 8. `_DBLink` / `_Jump` / `$alt` の順序

`EnrichmentProcessor.enrichRecords()` では、概ね次の順でレコードを整えます。

1. typedef に基づく軽い正規化
2. 自前の `_DBLink`（`$Def_DBLinkRef` 形式）を持つ `_Jump` をフィールド単位で解決・置換
3. `_DBLink` の参照先を解決
4. `_Jump` ラッパーを参照先の実値へ置換
5. 同名フィールドを空値のときだけ穴埋めマージ
6. `$enrich: true` の `*_DBLink` suffix フィールドを解決し、同じ参照先で `_Jump` を置換 → 穴埋めマージ
7. `$alt` による代替キーからの穴埋め
8. `#ListLink_*` を varsdef から補助補完
9. 画像メタ、検索テキスト、displaySections を付加

重要ルール:

- `_DBLink` の穴埋めは空値にだけ適用し、既存値は上書きしません
- `{ hideText: '...' }` は意図的マスクなので上書きしません
- 別 DB から画像フィールドは埋めません
- 別作品からの `_DBLink` では、対象作品の schema に宣言されたトップレベル項目だけを取り込みます
- `_Jump` の `_Search` は 1 件一致だけ採用し、曖昧一致はスキップします
- `_Jump` の参照先は「自前の `_DBLink`（`$Def_DBLinkRef` 形式）→ ルート `_DBLink` → `$enrich: true` の `*_DBLink`」の順に決まります。
  つまり `AnotherRegions_DBLink` などで参照先を書いてあるレコードは、`_Jump` 側へ `_DBLink` を重複して書かなくても同じ相手を引けます
  （複数エントリがある場合は既存の `_DBLink` 運用と同じく**先頭の解決済みエントリ**に従います）
- `_Jump` の `hashTag` は「完全一致 → 言語別名」の順で探します（`TypeDefUtils.expandLangAliasCandidates()`）。
  `_JP` / `_EN` に分離したフィールドを suffix 無しで指せるようにするためで、優先言語は**参照元フィールドの suffix**です。
  入れ子は**明示ドットパス**で指定します（レコード全体を名前で走査することはしません）。
  例: `LogicspecAbout_JP: { _Jump: { hashTag: "NumerospecStats.NumerospecAbout" } }`
  → 参照先の `NumerospecStats.NumerospecAbout_JP` を引く。どの候補にも当たらなければラッパーを維持します

### 8.1 `_Jump` + `$Def_DBLinkRef`（フィールド単位の参照先明示）

レコードルートの `_DBLink`（旧形式・マージ用）が無い場合でも、`_Jump` の中に
`$Def_DBLinkRef` 形式の `_DBLink` を書くことで、フィールド単位に参照先を明示できます。

```json
"BirthDay": {
  "_Jump": {
    "hashTag": "BirthDay",
    "_DBLink": { "_Work": "SinisterChangingGirls", "_DB": "Primary", "Drc": "E" }
  }
}
```

- 参照先レコードの特定は `*_DBLink` suffix フィールドと同じ `resolveDbLinkSuffixRef()`（`$Def_DBLinkRef` 解決）を再利用します（`isPrivate` 除外・ネストインデックス対応も同じ）
- `_Search` の併用も可能で、通常の `_Jump` と同じく **1 件一致のみ採用**します
- 解決に失敗した場合（参照先が見つからない・値が取れない）は `_Jump` ラッパーを維持し、誤置換しません
- 自前 `_DBLink` を持つ `_Jump` は、ルート `_DBLink` 由来の解決パスでは処理されません（二重解決の防止）

### 8.2 `$enrich` 付き `*_DBLink` suffix と null 入りインデックス

typedef で `$enrich: true` を宣言した `*_DBLink` suffix フィールド（例: グローバル
`data/db_type.json` の `AnotherRegions_DBLink`）は、enrich 時に参照先レコードの同名フィールドを
空値のみ穴埋めマージします。

`$Def_DBLinkRef` のインデックス値には null を含められます（例: UnauthedLogica の
`Model: { "ModelSeries": "notModel", "Num": "Q" }` のような型番未確定インデックス）。

- クエリ側の null は「参照先レコード側も null/undefined」の明示マッチとして扱います
- null 入りインデックスは複数レコードに一致し得るため、**1 件一致のみ採用**し、複数一致・0 件はスキップします
- null を含まないインデックスの照合は従来どおり（先頭一致採用・null は不一致扱い）です

### 8.3 `_DBCrossLinkPath`（画像フィールド専用のDB/Work横断パス参照）

`#PNGFilePath`/`#PNGFileName` フィールドの値（配列要素・単体値のいずれも可）として、
`{ "_DBCrossLinkPath": { "_DB": ..., "_Work": ..., "_Field": ..., "_IsoPath": ... } }` の形の
ラッパーオブジェクトを置くと、他DB・他作品の画像フォルダ内の相対パスを直接参照できます。

```json
"arts_PNGPath": [
  "corefolders/autumnMoon/art_autumnMoon2023",
  { "_DBCrossLinkPath": { "_DB": "SemiPrimary", "_IsoPath": "corefolders/autumnMoon/art_autumnMoon2025" } }
]
```

`_DBLink`（本節冒頭〜§8.2）との決定的な違いは、**対象レコードの検索・照合を一切行わない**点です。
`_DBLink` は「対象レコードをインデックスで検索して見つけ、そのレコードのフィールド値を穴埋めする」
レコード参照機構ですが、`_DBCrossLinkPath` は「対象Work/DBの画像フォルダ内の相対パスを直接指す」
パス参照機構であり、`_IsoPath` の値自体がそのまま参照先の相対パスになります。

サブフィールド（`$Def_DBCrossLinkPath`、`data/db_type.json` で宣言）:

- `_DB`（必須・`#String`）: 参照先DB名。同一DB参照ならこの機構自体が不要なため、意味のあるデフォルト値が存在せず必須にしています
- `_Work`（省略可・`#String|#Null`）: 参照先作品名。省略時は現在Workと同一（同一作品内DB跨ぎ参照）
- `_Field`（省略可・`#String|#Null`）: 参照先の画像フィールド名（folderHint 解決にのみ使用）。省略時は `_DBCrossLinkPath` が出現しているフィールド自身と同名
- `_IsoPath`（必須・`#PNGFilePath`）: 参照先フォルダからの相対パス（単一パス固定）

解決の流れと安全策:

1. `_Field`（またはデフォルト値）が、参照先Workの実効スキーマ（グローバル + 参照先Workの `db_type.json`）で画像型として宣言されている場合のみ解決します。未宣言なら解決しません（安全側フェイルクローズ）
2. 参照先Workが `Works_Hidden: true`（§5.4）、または参照先DBが参照先Workの `db_meta.json` で `DB_Hidden: true`（§5.3）の場合は解決しません。`_DBCrossLinkPath` はレコードを介さない直接パス参照のため `isPrivate` のようなレコード単位の制御は適用できませんが、Work/DB単位の完全非公開制御だけは同じ強度で尊重します
3. 連鎖は禁止です。`_IsoPath` は常に単一の文字列であり、対象レコードを介さないため、解決結果が更に `_DBCrossLinkPath` になることは構造上ありません

出力への反映:

- `_DBCrossLinkPath` の解決結果は `_enrichment.images`（§7）へ**追記のみ**され、`Images.*` の生値（ラッパーオブジェクトそのもの）は書き換えません（`ImageProcessor` の非破壊方針を踏襲）
- `_DBLink` の「別DBからは画像フィールドを埋めない」ルール（本節冒頭の重要ルール、§8 実装上は `allowImages` ゲート）とは無関係の別機構です。`_DBLink` による自動穴埋めが画像を対象外とするルールは変更していません。`_DBCrossLinkPath` は画像パスを明示的に参照するための、意図的な別の opt-in 手段です

---

## 9. 実装上の分担

### 9.1 `lib/sw-common.js`

- `SWConfig`
  - scope から `REPO_BASE` と `API_PREFIX` を計算します
- `DataFetcher`
  - `data/**` の JSON 読み込み、ファイル存在確認、DB 一覧取得を担当します
  - `readGlobalMeta()` / `readWorkMeta()` は `Dictionaries/` も読み、辞書 DB を `General.$VarsDef` と top-level `Dictionaries` へ合流します
- `ApiEndpointHandlers`
  - `meta`, `typedef`, `deftype` など定義系エンドポイントを担当します
- `StandardEndpointHandlers`
  - `index`, `works`, `bootstrap`, `db`, `search`, `varsdef` などの標準処理を担当します
- `ServiceWorkerBase`
  - install / activate / fetch の共通ライフサイクルと、画像パスのフォールバックを持ちます

### 9.2 `lib/data-common.js`

- `ReferenceResolver`
  - `#Works`, `#DB`, `#$image` などの参照を解決します
- `EnrichmentProcessor`
  - schema 駆動の正規化、`_DBLink`, `_Jump`, `$alt`, 検索補助、画像補助をまとめて処理します
- `TypeDefUtils`
  - `$DefType` の抽出、マージ、型解釈、index 解釈を支えます

---

## 10. 先に読むと追いやすいファイル

コードを読む順番の目安です。

1. `api/sw.js` / `pages/sw.js` / `svc/sw.js`
2. `lib/sw-common.js` の `StandardEndpointHandlers`
3. `lib/data-common.js` の `EnrichmentProcessor`
4. `tests/sw.dbmeta.tolerance.test.js`
5. `tests/sw.enrich.basic.test.js`
6. `tests/enrich.dblink.jump.merge.test.js`

---

## 11. 関連ドキュメント

- `docs/viewer-guide.md`: 閲覧者向けの入口説明
- `docs/db-update-guidelines.md`: DB 更新時の運用ルール
- `docs/schema-meta-processing.md`: `db_type.json` / `db_meta.json` の宣言面と内部処理の詳細
- `.github/copilot-instructions.md`: 現在の実装方針と運用制約の詳細
