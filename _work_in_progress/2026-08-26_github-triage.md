# GitHub 未解決問題トリアージ（2026-08-26）

自動実行（毎朝のGitHub未解決問題トリアージ）による生成物。
**実コードの修正・commit/push は行っていません**（読み取り専用調査＋提案のみ）。

調査手段:

- Gmail 通知（`from:github.com newer_than:14d` ＋ Dependabot / security を `newer_than:45d` で二重走査）
- GitHub 読み取り専用 API（`get_me` / `search_repositories` / `list_issues` / `list_pull_requests` /
  `search_issues` / `search_pull_requests` / `list_commits` / `list_branches` / `get_file_contents`）
- ローカル読み取り専用参照（`git log` / `git status --porcelain --ignored` / `Select-String`）

GitHubコネクタは**正常に利用できました**（`get_me` → `radiann-kswg` で疎通確認済み。認証エラー・アクセス拒否なし）。
ただし **Actions の実行履歴・ジョブログ・annotation を読むツールはコネクタに存在しません**。
CI の判定はメール通知＋メタ情報（リポジトリ作成時刻・コミット時刻）＋ローカル実測からの推定であり、
**落ちたステップ名そのものは未確認**です。

保存先は本リポジトリ `AGENTS.md` の規約どおり `_work_in_progress/`（`.wip/` は使わない）。
本ログ作成にあたり `_work_in_progress/` ディレクトリを新規作成しています（初回のため）。

---

## 1. 🔴 Pages デプロイ失敗 — **未解決 / 本日の最優先**

### 事象

| 項目 | 値 |
| --- | --- |
| ワークフロー | `Deploy static site to GitHub Pages`（`.github/workflows/pages.yml`） |
| ブランチ / SHA | `develop` / `43e6c61` |
| 通知(UTC) | 2026-08-25 07:32:34 |
| メール本文 | **Some jobs were not successful**（＝全ジョブ失敗ではない） |
| 実行URL | https://github.com/radiann-kswg/JsonCharacterDB-Framework/actions |

### 時系列（実測）

| 時刻(UTC) | 出来事 | 根拠 |
| --- | --- | --- |
| 08-25 06:25:41 | `43e6c61` author 日時 | `list_commits` |
| 08-25 07:21:23 | `43e6c61` commit 日時 | `list_commits` |
| 08-25 **07:31:41** | **リポジトリ作成** | `search_repositories` の `created_at` |
| 08-25 07:32:34 | Run failed 通知 | Gmail |
| 08-25 07:34:41 | リポジトリ `updated_at` | `search_repositories` |

**リポジトリ作成のわずか 53 秒後に run が終了して失敗**しています。

### 潰した仮説（ローカル実測で否定済み）

| # | 仮説 | 実測 | 判定 |
| --- | --- | --- | --- |
| A | perf テスト閾値（CreationsDB で 08-20 に起きた真因の再発） | `tests/graph.edge-route.test.js:286` に `const limit = process.env.CI ? 200 : 40;` が**継承済み** | ❌ 原因ではない |
| B | `npm ci` の lockfile 不整合（リポジトリ改名の取りこぼし） | `package.json` / `package-lock.json` とも `"name": "jsoncharacterdb-framework"` で一致。devDeps も一致 | ❌ 原因ではない |
| C | `.gitignore` に食われて未コミットのファイルがある（ローカルだけ緑） | `git status --porcelain --ignored` が**空**＝作業ツリーとコミット内容が一致、ignore された実在ファイルもゼロ | ❌ 原因ではない |
| D | `playwright` の postinstall（ブラウザDL）で `npm ci` が落ちる | 上流 `100BeautiesLab_CreationsDB` も同じ `playwright ^1.60.0` を devDeps に持ち、そちらの Actions は `npm ci` 込み 31〜36 秒で完走している | ❌ 原因ではない（ただし §3 の掃除候補） |

### 最有力仮説: **Pages が有効化される前に run が走った**

`pages.yml` は `build`（checkout → npm ci → npm test → `configure-pages@v5` → `upload-pages-artifact@v3`）と
`deploy`（`deploy-pages@v4`）の 2 ジョブ構成です。メールの **"Some jobs were not successful"** は
「全滅ではない」＝**片方のジョブだけが失敗し、もう片方は成功またはスキップ**したことを意味します
（比較: 単一ジョブの CreationsDB AIHints ワークフローは "All jobs have failed" と出ていた）。

新規作成直後のリポジトリは **Settings → Pages → Source が未設定**です。この状態では
`actions/configure-pages@v5` が `Get Pages site failed` で落ち（→ `build` 失敗・`deploy` スキップ）、
仮に通っても `actions/deploy-pages@v4` が Pages 環境なしで落ちます。
**リポジトリ作成の 53 秒後**という時刻がこの筋を強く支持します。

> 補足: `https://radiann-kswg.github.io/JsonCharacterDB-Framework/` への到達確認は試みましたが、
> 手元のフェッチ手段は SW/JS 前提の同系サイト（稼働中の `database.numbertales-radiann.net`）でも
> 本文ゼロを返すため、**公開状態の判定材料にはなりませんでした**。

### 提案（未適用・優先順）

1. **まず設定を確認する（コード変更ゼロ）**
   Settings → Pages → Build and deployment → Source を **GitHub Actions** にし、
   Actions から `Deploy static site to GitHub Pages` を **Re-run**。これで緑になれば本件は確定・完了。
2. **1 で直らない場合**: 失敗ジョブのログで落ちたステップ名を確認する。
   `build` の `npm ci` / `npm test` なのか、`configure-pages` なのか、`deploy` なのかで打ち手が変わる。
3. **恒久策（任意）**: `pages.yml` の `configure-pages` に `enablement: true` を付ける。
   ```yaml
   - name: Setup Pages
     uses: actions/configure-pages@v5
     with:
       enablement: true
   ```
   `permissions: pages: write` は既に付いているため追加権限は不要。
   フレームワークとして**他人がフォークして初回デプロイする**ことを想定するなら、これは入れておく価値が高い。

---

## 2. 🟢 Issue / PR — **未解決ゼロ**

- `list_issues(OPEN)` / `list_pull_requests(open)` とも本リポジトリは **0 件**（2026-08-26 実測）。
- アカウント全体でも `search_issues(is:issue is:open user:radiann-kswg)` は **1 件のみ**で、
  それは `100BeautiesLab_CreationsDB#13`（本リポジトリ管轄外。詳細は CreationsDB 側の同日ログ）。
- `search_pull_requests(is:pr is:open user:radiann-kswg)` は **0 件**。
- Dependabot / セキュリティアラートのメールは `newer_than:45d` で本リポジトリ宛て **0 件**
  （作成 08-25 のため当然。※アラート一覧を読むツールはコネクタに無いため、メール基準の判断）。

---

## 3. 🔵 ついでに見つかった掃除候補（急ぎではない・未適用）

### 3-1. 未使用 devDependency `playwright`

`playwright ^1.60.0` を devDeps に持っていますが、実コードからの参照は
`vitest.config.js:11` の**コメント 1 行だけ**（`npm pack cytoscape` の展開物に
`playwright-tests/renderer.spec.js` が含まれる、という注記）です。テストは vitest + jsdom で完結しています。

**提案**: 上流由来の惰性なら削除で `npm ci` が軽くなる。
残すなら、CI では `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` を付けるとブラウザDLを止められる。
※ 今回の失敗の原因ではない（§潰した仮説 D）ので、Pages 復旧とは切り離して判断してよい。

### 3-2. Node.js 20 deprecation（上流 CreationsDB からの積み残しと同件）

`pages.yml` / `cf-api-sync.yml` / `codeql.yml` が `actions/checkout@v4` / `actions/setup-node@v4` を
pin しています。上流 CreationsDB では workflow の annotation に Node20 deprecation が出ていました。
本リポジトリも同じ pin を継承しているため、いずれ同じ警告が出ます。

**提案**: 3 ファイルまとめて `@v5` へ。急ぎではないが、Pages を直すついでにやると手戻りが少ない。

### 3-3. `upload-pages-artifact` の `path: .`

リポジトリ丸ごと（`tests/` `tools/` `.github/` `docs/` 含む）を Pages 成果物として上げています。
公開サイトとしては動くものの、フレームワークとして配る前提なら公開範囲を絞る余地があります。
上流の設計をそのまま継承した箇所なので、**現時点では変更を勧めません**（挙動が変わるリスクの方が大きい）。

---

## 本日のまとめ

| # | 件名 | 状態 | 優先度 |
| --- | --- | --- | --- |
| 1 | Pages デプロイ失敗（`develop` / `43e6c61`） | 🔴 未解決 | 高 |
| 2 | Issue / PR / Dependabot | 🟢 未解決ゼロ | — |
| 3-1 | 未使用 devDependency `playwright` | 🔵 提案 | 低 |
| 3-2 | Node20 deprecation（actions v4 → v5） | 🔵 提案 | 低 |
| 3-3 | `upload-pages-artifact: path: .` | ⚪ 変更非推奨 | — |

**次にやるべき 1 手**: Settings → Pages → Source を **GitHub Actions** にして Re-run。
これで §1 は白黒つきます。落ちたステップ名が判明したら、このログに追記してください。
