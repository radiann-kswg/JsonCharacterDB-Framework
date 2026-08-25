# デプロイ手順書 — Cloudflare Workers + R2 + D1

> ADR-0001 実装完了後の初回デプロイ〜疎通確認までの手順書です。
> 実行環境: ローカル PC（Windows / WSL2 いずれも可）
> 前提: `node` / `npm` / `wrangler` CLI が使える状態であること

---

## GitHub Actions による自動更新（`cf-api-sync.yml`）

`develop` ブランチへの push 時に、変更パスに応じて自動実行される:

| 変更パス | 実行されるジョブ |
|---------|----------------|
| `data/**` | R2/D1 データ同期（`--clean` 付きで全件再投入） |
| `pkg/cloudflare/worker.js` / `wrangler.toml` / `schema/**` / `scripts/**` | Worker デプロイ |

### 初回セットアップ: GitHub Secrets の登録

GitHub リポジトリの **Settings → Secrets and variables → Actions** で以下を登録する:

| Secret 名 | 値の取得方法 |
|-----------|------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare ダッシュボード → My Profile → API Tokens → Create Token<br>テンプレート「**Edit Cloudflare Workers**」を使い、D1・R2 の権限も追加する |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare ダッシュボード右サイドバー「Account ID」 |

#### API Token に必要な権限

| リソース | 権限 |
|---------|------|
| Workers Scripts | Edit |
| Workers Routes | Edit |
| D1 | Edit |
| R2 Storage | Edit |
| Zone (numbertales-radiann.net) | Read |

---

## 0. 前提: wrangler ログイン確認

```bash
npx wrangler whoami
```

未ログインの場合:

```bash
npx wrangler login
```

ブラウザが開くので Cloudflare アカウントでログイン。

---

## 1. Worker デプロイ

```bash
npx wrangler deploy --config pkg/cloudflare/wrangler.toml
```

成功するとデプロイ URL が表示される。カスタムドメインルートが設定済みなので、
`database.numbertales-radiann.net/api/v1/works` で応答が返れば OK。

### よくあるエラー

| エラー | 対処 |
|-------|------|
| `[ERROR] No account id found.` | `wrangler.toml` の `account_id` を確認 |
| `[ERROR] Route already exists` | Cloudflare ダッシュボードで既存ルートを確認・削除 |
| `authentication error` | `npx wrangler login` を再実行 |

---

## 2. R2 + D1 初回データ投入（migrate.mjs）

### 2-1. ドライランで確認

```bash
node pkg/cloudflare/scripts/migrate.mjs --repo-root . --dry-run
```

何件の JSON が対象になるか、D1 に何行 INSERT されるかが表示される。
エラーがないことを確認してから実行へ進む。

### 2-2. R2 のみ先に投入

```bash
node pkg/cloudflare/scripts/migrate.mjs --repo-root . --r2-only
```

`data/**/*.json` が R2 バケット `creationsdb-data` にアップロードされる。
途中でエラーが出た場合、再実行しても上書きされるだけなので何度でも安全に再実行可能。

### 2-3. D1 のみ投入

```bash
node pkg/cloudflare/scripts/migrate.mjs --repo-root . --d1-only
```

`works` / `dbs` / `records` テーブルにデータが挿入される。
中間 SQL ファイルは `.cache/migrate/` に生成されるので、エラー時に内容を確認できる。

### 2-4. R2 + D1 まとめて投入（通常運用）

```bash
# 初回・再投入共通（--clean で D1 既存データを全削除してから再投入）
node pkg/cloudflare/scripts/migrate.mjs --repo-root . --clean
```

> **`--clean` フラグについて**: `records` テーブルは AUTOINCREMENT PK のため `INSERT OR REPLACE` が upsert として機能しない。
> `--clean` を付けると投入前に `DELETE FROM records/dbs/works;` を実行して重複を防ぐ。
> GitHub Actions (`cf-api-sync.yml`) も `--clean` 付きで実行する。

---

## 3. 疎通確認

Worker デプロイ + データ投入が完了したら以下のエンドポイントを順番に確認する。

> **Worker 実 API の URL 書式について**
> Cloudflare Workers 実 API のルートは `/api/v1/:work/:db/records` 形式（`works/` プレフィックスと `db/` インフィックスを持たない）。
> Service Worker 疑似 API の `/api/v1/works/:work/db/:db/records` 形式と異なる点に注意。
> 詳細は `docs/api-sw-spec.md` §0 の書式対比表を参照。

### 3-1. 作品一覧

```
GET https://database.numbertales-radiann.net/api/v1/works
```

期待レスポンス例（配列形式）:

```json
[
  { "key": "#Works_NumberTales", "Title": "ナンバーテールズ", "Title_EN": "NumberTales", ... },
  ...
]
```

### 3-2. 特定作品のDB一覧

```
GET https://database.numbertales-radiann.net/api/v1/Works_NumberTales/dbs
```

### 3-3. レコード一覧

```
GET https://database.numbertales-radiann.net/api/v1/Works_NumberTales/Primary/records
```

### 3-4. 単一レコード取得

```
GET https://database.numbertales-radiann.net/api/v1/Works_NumberTales/Primary/records/1
```

インデックスキーを明示する場合:

```
GET https://database.numbertales-radiann.net/api/v1/Works_NumberTales/Primary/records/1?idxKey=Num
```

### 3-5. 全文検索（DB 内）

```
GET https://database.numbertales-radiann.net/api/v1/Works_NumberTales/Primary/search?q=ハジメ
```

### 3-6. 全文検索（作品横断）

```
GET https://database.numbertales-radiann.net/api/v1/Works_NumberTales/search?q=ハジメ
```

---

## 4. D1 データの再投入（data/ 更新時）

`data/` 配下の JSON を更新した場合は以下の手順でデータを同期する。

```bash
# R2 + D1 を一括再投入（推奨: --clean で既存データをクリアしてから再投入）
node pkg/cloudflare/scripts/migrate.mjs --repo-root . --clean

# R2 のみ更新したい場合
node pkg/cloudflare/scripts/migrate.mjs --repo-root . --r2-only

# D1 のみ再投入したい場合（--clean で既存データを削除してから投入）
node pkg/cloudflare/scripts/migrate.mjs --repo-root . --d1-only --clean
```

> FTS5 トリガーが自動で同期するため、`records_fts` の手動操作は不要。
> `--clean` なしで `--d1-only` を使う場合は、先に手動でテーブルをクリアすること:
> ```bash
> npx wrangler d1 execute b8bf7187-1966-4831-88d2-2b8906cfa745 --remote --yes \
>   --command "DELETE FROM records; DELETE FROM dbs; DELETE FROM works;"
> ```

---

## 5. Worker コードの更新デプロイ

`pkg/cloudflare/worker.js` を変更したら再デプロイするだけ:

```bash
npx wrangler deploy --config pkg/cloudflare/wrangler.toml
```

R2 / D1 のデータはそのまま維持される。

---

## 6. ローカルでの動作確認（オプション）

```bash
npx wrangler dev --config pkg/cloudflare/wrangler.toml --remote
```

`--remote` を付けることで本番の R2/D1 を参照した状態でローカル確認できる。
`http://localhost:8787/api/v1/works` でアクセス可能。

---

## 7. Google Cloud Run デプロイ（ADR-0002 / 将来手順）

> 現時点では未実装。`numbertales-imagegen` のコンテナ化が完了したら実施。

```bash
# 1. Artifact Registry リポジトリ作成（初回のみ）
gcloud artifacts repositories create numbertales-imagegen \
  --repository-format=docker \
  --location=asia-northeast1 \
  --project=claude-radiannkswg

# 2. イメージビルド & プッシュ
gcloud builds submit --tag \
  asia-northeast1-docker.pkg.dev/claude-radiannkswg/numbertales-imagegen/app:latest \
  --project=claude-radiannkswg

# 3. Cloud Run デプロイ
gcloud run deploy numbertales-imagegen \
  --image asia-northeast1-docker.pkg.dev/claude-radiannkswg/numbertales-imagegen/app:latest \
  --platform managed \
  --region asia-northeast1 \
  --no-allow-unauthenticated \
  --timeout 300 \
  --memory 4Gi \
  --project=claude-radiannkswg
```

詳細は `_work_in_progress/2026-06-21_progress_cloudflare-api-adr2-gcloud.md` を参照。

---

## 参考

| 対象 | 参照先 |
|------|--------|
| Workers 実 API 仕様 | `docs/api-sw-spec.md` §0 |
| Cloudflare セットアップ全般 | `pkg/cloudflare/README.md` |
| ADR-0001 実装記録 | `_work_in_progress/2026-06-21_progress_cloudflare-api-adr.md` |
| ADR-0002 Google Cloud 設計 | `_work_in_progress/2026-06-21_progress_cloudflare-api-adr2-gcloud.md` |
