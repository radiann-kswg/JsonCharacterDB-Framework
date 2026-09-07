# CreationsDB — Cloudflare Workers API

100BeautiesLab_CreationsDB の**サーバーサイド API**。
Cloudflare Workers 上で動作し、データを **R2（静的 JSON ミラー）+ D1（FTS5 検索インデックス）** から取得します。Service Worker が使えないクライアント（curl / Python requests / モバイルアプリ等）からも直接アクセスできます。

---

## アーキテクチャ

```
クライアント
    │
    ▼
Cloudflare Workers (worker.js)
    ├─ メタ取得・レコード一覧 ──── R2 (creationsdb-data)
    │                              └─ data/**/*.json の静的ミラー
    └─ 検索・インデックス参照 ─── D1 (creationsdb-d1)
                                   ├─ works テーブル（作品メタ）
                                   ├─ dbs テーブル（DB メタ）
                                   └─ records + records_fts（FTS5 全文検索）
```

---

## 動作要件

| 条件       | 詳細                                   |
| ---------- | -------------------------------------- |
| ランタイム | Cloudflare Workers (V8 Isolate)        |
| Node.js    | Wrangler 実行用 Node.js 18+ (ローカル) |
| 外部依存   | **なし** (Workers API のみ使用)        |

---

## 初回セットアップ

### 1. Wrangler のインストール・ログイン

```sh
npm install -g wrangler
npx wrangler login
```

### 2. D1 スキーマ適用（初回のみ）

```sh
# schema/d1-init.sql を D1 に適用
npx wrangler d1 execute creationsdb-d1 --remote --file=schema/d1-init.sql
```

### 3. データ投入（R2 + D1 マイグレーション）

```sh
# リポジトリルートで実行
node pkg/cloudflare/scripts/migrate.mjs
# オプション例:
#   --dry-run   投入せず内容確認のみ
#   --r2-only   R2 アップロードのみ
#   --d1-only   D1 投入のみ
```

### 4. Worker デプロイ

```sh
# リポジトリルートで実行（--config でパス指定）
npx wrangler deploy --config pkg/cloudflare/wrangler.toml
```

> **注意**: `--env production` は使用しない。`wrangler.toml` で `[env.production]` を定義すると wrangler が名前付き環境を優先し、トップレベルの `routes` が引き継がれず "No targets deployed" になる。環境定義は設けず、トップレベル設定のみで運用する。

> **wrangler.toml のルーティング配置について**: `routes = [...]` は TOML の root-level キーとして、すべての `[section]` / `[[array]]` ヘッダーより前に配置すること。`[vars]` や `[[d1_databases]]` の後ろに書くと、そのスコープ内の環境変数・フィールドとして誤解釈される。

### 5. ローカル開発

```sh
cd pkg/cloudflare
npx wrangler dev
# → http://localhost:8787 で起動
# ※ ローカルでは R2/D1 はローカルシミュレータを使用
```

---

## バインディング

`wrangler.toml` で定義。Cloudflare Dashboard の Bindings 画面でも確認できます。

| バインディング | 種別 | 名前              | 説明                              |
| -------------- | ---- | ----------------- | --------------------------------- |
| `BUCKET`       | R2   | `creationsdb-data` | `data/**` の JSON 静的ミラー     |
| `DB`           | D1   | `creationsdb-d1`  | メタ・FTS5 検索インデックス        |

---

## エンドポイント一覧

| メソッド | パス                                      | データソース | 説明                                         |
| -------- | ----------------------------------------- | ------------ | -------------------------------------------- |
| `GET`    | `/api/v1/meta`                            | R2           | グローバルメタデータ                         |
| `GET`    | `/api/v1/works`                           | D1           | 作品一覧                                     |
| `GET`    | `/api/v1/:work/meta`                      | R2           | 作品別メタデータ                             |
| `GET`    | `/api/v1/:work/dbs`                       | D1           | DB 一覧                                      |
| `GET`    | `/api/v1/:work/:db/records`               | D1           | レコード一覧（_Commons 補完・非公開除外）    |
| `GET`    | `/api/v1/:work/:db/records/:idx`          | D1           | インデックス値でレコード 1 件取得            |
| `GET`    | `/api/v1/:work/:db/records/:idx?idxKey=X` | D1           | インデックスキー指定（ドット記法可）         |
| `GET`    | `/api/v1/:work/:db/search?q=キーワード`   | D1 FTS5      | DB 内全文検索                                |
| `GET`    | `/api/v1/:work/search?q=キーワード`       | D1 FTS5      | 作品横断検索                                 |

---

## 使用例

```sh
# 作品一覧
curl https://database.numbertales-radiann.net/api/v1/works

# NumberTales Primary の全レコード
curl https://database.numbertales-radiann.net/api/v1/NumberTales/Primary/records

# インデックス検索（Num = "1"）
curl "https://database.numbertales-radiann.net/api/v1/NumberTales/Primary/records/1"

# ドット記法インデックス（Card.Num = "0"）
curl "https://database.numbertales-radiann.net/api/v1/FLInvestigator78/Primary/records/0?idxKey=Card.Num"

# DB 内全文検索
curl "https://database.numbertales-radiann.net/api/v1/NumberTales/Primary/search?q=たぬき"

# 作品横断検索
curl "https://database.numbertales-radiann.net/api/v1/NumberTales/search?q=狼"
```

---

## work / db の指定形式

以下はすべて同じ作品・DB を指します：

```
/api/v1/NumberTales/Primary/records
/api/v1/Works_NumberTales/Primary/records
/api/v1/#Works_NumberTales/Primary/records   ← URL エンコード推奨: %23Works_NumberTales
```

---

## データ更新フロー

`data/` の JSON を更新した後の反映手順：

```sh
# R2 + D1 を再投入（差分ではなく全件置換）
node pkg/cloudflare/scripts/migrate.mjs

# Worker 本体の変更があれば再デプロイ
cd pkg/cloudflare
npx wrangler deploy
```

---

## ファイル構成

```
pkg/cloudflare/
├── worker.js         # Workers エントリーポイント
├── wrangler.toml     # デプロイ設定（バインディング・ルート）
├── schema/
│   └── d1-init.sql   # D1 テーブル定義・FTS5・トリガー
└── scripts/
    └── migrate.mjs   # R2/D1 マイグレーションスクリプト
```

---

## キャッシュ動作

- Cloudflare エッジキャッシュ (`Cache-Control: public, max-age=300`) を使用
- R2 読み取りは Cloudflare Cache API でメモ化（TTL: 5 分）
- キャッシュを無効化したい場合は Cloudflare Dashboard の「Purge Cache」を使用

---

## Service Worker 版との違い

| 比較項目         | Service Worker 版                | Cloudflare Workers 版 (v2)                |
| ---------------- | -------------------------------- | ----------------------------------------- |
| 実行場所         | ブラウザ内                       | Cloudflare エッジ (APAC)                  |
| 利用クライアント | 同一オリジンのブラウザのみ       | 任意（curl / iOS / Android / Node.js 等） |
| データソース     | GitHub Pages（HTTP fetch）        | R2（JSON 静的ミラー）+ D1（検索 FTS5）    |
| キャッシュ       | Cache Storage (ブラウザ)         | Cloudflare エッジキャッシュ               |
| 検索             | JSON.stringify 含有チェック      | D1 FTS5 全文検索                          |
| enrich 処理      | data-common.js による完全 enrich | _Commons 適用のみ（次フェーズで拡張予定） |
| 運用             | コード変更不要 (SW 自動更新)     | `npx wrangler deploy` が必要              |

---

## セキュリティ

- `work` / `db` パラメータは英数字・アンダースコアのみ許可（`isSafeToken`）
- `Works_Hidden: true` / `DB_Hidden: true` は 404 を返す（D1 クエリで判定）
- `isPrivate: true` のレコードは D1 クエリレベルで除外
- CORS: `Access-Control-Allow-Origin: *`（読み取り専用 API のため）
