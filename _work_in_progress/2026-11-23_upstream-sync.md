# 2026-11-23 上流同期の定期点検（JsonCharacterDB-Framework）

> **`git merge` と `data/` の変更は行っていない**（`sync:update` までの読み取り中心の調査と提案）。
> コード・ワークフロー・画像も一切書き換えていない。改善はすべて提案どまり。

## 点検の前提

| 項目 | 値 |
| --- | --- |
| 点検日時 | 2026-11-23 01:10〜01:30 UTC |
| 上流 | `100BeautiesLab_CreationsDB` @ `develop` (`b030645`) |
| 比較基準 | 取り込み済みベンダーコミット `e0692d4`（上流 `4f48192`） |
| 同期対象ファイル数 | 182 |
| 未取り込み | **23 件**（M=15 / A=8） |
| ベンダーブランチ | `upstream/creationsdb` を `53410cf` へ更新済み（`sync:update` 実行済み） |
| コンフリクト見込み | `git merge-tree --write-tree develop upstream/creationsdb` 実測で **0**（23 ファイルすべて中流固有差分ゼロ） |

比較基準はベンダーコミット。「比較基準: HEAD」の異常なし。前回 11-16 の 8 件は未 merge のまま今回の 23 件に含まれる
（Issue #21 も open のまま。merge 後の次回自動点検でクローズされる想定）。
下流 `RadianNs_SecondaryWorksDB` は 0 件（比較基準 `80c316d` / 上流 `77f9cf0`。中流が merge すれば次回以降に降りてくる）。

## 差分 23 件の分類

上流 CHANGELOG の 11-15（`scopeField` fix）〜11-22（#28 完成絵収録）の 6 エントリに対応する。
中核は 11-20 の「外見の形態・衣装・着脱補完と画像単位の AI 除外 (#60/#61/#62)」。

### 取り込むべき — 18 件

| ファイル | 判断理由（1 行） |
| --- | --- |
| `lib/basic-renders/type-common.js` | 構造化 `scopeField` 値を解決できないバグの修正（11-16 判定どおり・後方互換） |
| `pkg/nodejs/index.mjs` | 辞書バンドル読み込みの `dictFile` 宣言準拠 fix（11-16 判定どおり） |
| `pkg/python/creationsdb/client.py` | 同上（Python クライアント） |
| `pkg/csharp/CreationsDBClient.cs` | 同上（C# クライアント） |
| `tools/deepl/build-glossary-source.mjs` | 辞書サブフォルダを再帰で拾う改善（11-16 判定どおり） |
| `docs/deepl-localization.md` | 11-16 ぶんの 2 行更新のみ（追加変更なし） |
| `docs/schema-meta-processing.md` | §3.4.1 構造化 `scopeField` の文書化＋画像単位 AI 除外指定（`Images_AIOptout`）の仕様追記 |
| `docs/api-sw-spec.md` | DB 単位の AI 利用除外条件（`DB_Hidden` / `AI_Optout`）の 2 行追記 |
| `docs/third-party-policy.md` | 「画像ごとの AI 利用除外」節の追加（ポリシー文書） |
| `docs/db-update-guidelines.md` | 完成絵公開手順 §7.1・作品ごとの形態名 §7.2 の追記（ドキュメントのみ） |
| `docs/jp-notation-rules.md` | `Laterality`（身体基準の左右）の表記規則 §1-8 追加 |
| `docs/appearance-detail-tools.md` | 新規ドキュメント。対象ツールは既存 exclude（`tools/patch-*.mjs`）のままで矛盾しない |
| `lib/section-renders/appearanceDetail.js` | 着脱タグ表示＋継承元宣言の生コードタグ抑止。宣言が無いデータでは従来挙動で安全 |
| `pages/characters.html` | `asset-version` の 2026.11.20.1 への bump のみ |
| `pkg/ai-image-policy.mjs` | 画像 AI 除外の検証・正規化の純粋関数モジュール（データ非依存の共通処理） |
| `pkg/cloudflare/scripts/migrate-common.mjs` | 本番/検証の D1・R2 取り違えガード＋`invalidateAIImagePolicy` 追加（インフラ安全性の改善） |
| `pkg/cloudflare/scripts/migrate.mjs` | 引数パースの共通化＋同期前の AI 許可表無効化。`migrate-common.mjs` と**必ず対で**取り込む |
| `tests/ai-image-policy-invalidate.test.js` | fs / child_process を全面モックしたデータ非依存テスト。`migrate-common` の回帰テストとして有効 |

### 要注意 — 0 件

中流の意図的差分と重なるファイルなし（merge-tree 実測コンフリクト 0）。

### 要相談 — 5 件（そのまま merge すると `npm test` が落ちる見込み）

| ファイル | 判断理由（1 行） |
| --- | --- |
| `tests/ai-image-policy.test.js` | 後半が `data/Works_NumberTales/…` と `data/db_type.json` の実データ前提で、`Works_Sample` しか無い中流では ENOENT で落ちる |
| `tests/appearance-state-data.test.js` | SCG / SAR / NTS の実データ回帰テスト。既存 exclude の実データテスト群と同種 |
| `tests/appearance-detail-detachable.test.js` | 中流の `data/db_meta.json` の `$Def_AppearanceDetail.$DefType` に `Detachable` 宣言が無く、宣言検索が undefined でクラッシュする |
| `tools/inventory-numbertales-art.mjs` | NumberTales 固有 CLI。上流 CHANGELOG 11-22 の申し送り「DB 固有 CLI と対応テストは対で同期対象から除外する」に該当 |
| `tests/inventory-numbertales-art.test.js` | 上記 CLI の対のテスト（exclude の不変則「ツールを除外したらテストも除外」どおり） |

**提案（`.sync/upstream.json` は書き換えていない・User 判断待ち）**:

1. `exclude` に次の 4 件を追加する:
   `tools/inventory-numbertales-art.mjs` / `tests/inventory-numbertales-art.test.js` /
   `tests/ai-image-policy.test.js` / `tests/appearance-state-data.test.js`
2. `tests/appearance-detail-detachable.test.js` は二択:
   (a) `Works_Sample` 用の `data/db_meta.json` に `Detachable` の宣言（`hashTag_JP`/`hashTag_EN` 付き）を足して取り込む
   （renderer 改善のテストが中流でも生きる・推奨）、または (b) これも `exclude` に足す。
3. exclude を変更したら **`npm run sync:update` を再実行してから** `git merge upstream/creationsdb` する
   （現在のベンダーブランチ `53410cf` には 5 件が入ったままのため）。

## Dependabot open PR（radiann-kswg 3 リポジトリ・2026-11-23 時点）

| リポジトリ | PR | 内容 | open から |
| --- | --- | --- | --- |
| 上流 | #69 | dev-minor-patch グループ 3 更新 | 本日 00:13 UTC（放置なし） |
| 中流 | #22 | dev-minor-patch グループ 3 更新 | 本日 00:15 UTC（放置なし） |
| 下流 | — | open 0 件 | （version updates 未稼働疑いが 10-05 から継続・User 確認待ち） |

前回残の上流 #58（glob 14.0.6）は解消済み（open に無し）。

---

## GitHub Pages 軽量化・高速化の点検

ワークフロー（`pages.yml`）は 11-16 の GH_REPO fix 以降変更なし。`npm ci` → `npm test` → `upload-pages-artifact@v5`（`path: .`）のままで、
**`node_modules/` が公開物に載る問題は未解消**（`node_modules/vitest/package.json` が本日も 200）。

| 計測 | 今回（11-23） | 前回（11-16） | 増減 |
| --- | --- | --- | --- |
| 追跡ファイル | 253 件 / 4,885,556 B | 253 件 / 4,885,335 B | +221 B |
| `node_modules/`（配信混入分） | 92,120,228 B / 2,570 件 | 同左 | 変化なし |
| `pages/characters.js` モジュールグラフ | 28 modules / 658,361 B / gzip 176,007 B | 28 / 658,361 B / gzip 176,179 B | 本体変化なし（gzip は算出再実装の誤差） |
| `pages/relations.js` モジュールグラフ | 14 modules / 374,497 B / gzip 115,778 B | 14 / 374,497 B / gzip 116,028 B | 同上 |
| 実サイト `/`（github.io） | 200 / TTFB 0.332s / 989 B / gzip / max-age=600 | 200 / 0.638s / 989 B | TTFB 改善（測定ばらつきの範囲） |
| `node_modules` 露出 | **あり（200）** | あり（200） | 変化なし |

計測値は `./.cache/pages-perf/latest.json` に保存（Windows 側シェルで計測・一時スクリプトは削除済み）。

**改善案（既出 1 件のみ・新規なし）**:

1. `pages.yml` の `Test` ステップ直後に `run: rm -rf node_modules` を 1 行追加 — **−92.1 MB / −2,570 ファイル**。
   変更箇所は `.github/workflows/pages.yml`（同期対象外のため中流固有の修正。下流 `pages.yml` にも同種の 1 行で −82.9 MB）。

参考（上流・下流の状況）: 上流は 11-19 に Pages ワークフローへ `test` ジョブ（`npm ci` → `npm test`）が追加され、
デプロイ前にテストが走るようになった。ビルドジョブとは別ジョブなので成果物に `node_modules` は入らず、実測でも 404 のまま（問題なし）。
下流は実測で JS/CSS が引き続き `max-age=600`（Cloudflare 設定の既出提案のまま）、`node_modules` 露出も継続。

## 次にやるべき 1 手

`.sync/upstream.json` の `exclude` に上記 4 件（＋detachable テストの扱いを決定）を追加 → `npm run sync:update` を再実行 →
`git merge upstream/creationsdb` → `npm test`（merge-tree 実測ではコンフリクト 0 見込み）。

---

## 追記: 定期点検（2026-11-23 03:43〜03:55 UTC 再点検）

> 前回分と同じく **`git merge` と `data/` の変更は行っていない**（`sync:update` までの読み取り中心の調査と提案）。
> コード・ワークフロー・`.sync/upstream.json` も書き換えていない。

### 点検の前提

| 項目 | 値 |
| --- | --- |
| 点検日時 | 2026-11-23 03:43〜03:55 UTC |
| 上流 | `100BeautiesLab_CreationsDB` @ `develop` (`5c3fe2f`)。01:10 の点検時 `b030645` からは Dependabot #69 の merge（`package.json` / `package-lock.json` のみ・同期対象外）だけ進んだ |
| 比較基準 | 取り込み済みベンダーコミット `e0692d4`（上流 `4f48192`）。「比較基準: HEAD」の異常なし |
| 同期対象ファイル数 | 182 |
| 未取り込み | 23 件（M=15 / A=8、前回と同じ一覧） |
| ベンダーブランチ | `sync:update` を実行 →「最新です（更新なし）」。`upstream/creationsdb` は `53410cf` のまま（ツリーは上流 `5c3fe2f` と一致） |
| コンフリクト見込み | `git merge-tree --write-tree develop upstream/creationsdb` でコンフリクト 0（結果ツリー `5e7cc9a`）。23 件とも `e0692d4..develop` に中流側の変更なし |

下流 `RadianNs_SecondaryWorksDB` は 0 件（比較基準 `80c316d` / 上流 `77f9cf0`）。

### 追加検証: merge 後のツリーで `npm test` を実行

前回は「落ちる見込み」までしか確認していなかった。今回は merge-tree の結果ツリー `5e7cc9a` を `git archive` で `.cache/sync-preview/` に展開し、
`node_modules` をジャンクションで借りて Vitest を全件実行した（作業ツリーとブランチには触れていない。展開物は検証後に削除済み）。

結果は **59 ファイル中 3 ファイル失敗 / 809 件中 3 件失敗**。落ちたのは今回追加された新規テストだけで、既存テストの退行はない。

| ファイル | 実行結果 | 原因 |
| --- | --- | --- |
| `tests/appearance-state-data.test.js` | ファイル全体が失敗 | `data/Works_SinisterChangingGirls/…` が無く ENOENT（実データ前提） |
| `tests/ai-image-policy.test.js` | **16 件中 1 件だけ失敗**（`61のアイドル4項目と…`） | `data/Works_NumberTales/…` が無く ENOENT。残り 15 件は純粋関数のテストと「全作品 DB の宣言一致」で、`Works_Sample` でも通る |
| `tests/appearance-detail-detachable.test.js` | 2 件失敗 | 中流の `$Def_AppearanceDetail.$DefType` に `Detachable` が無く、`find()` が undefined を返して TypeError |
| `tests/inventory-numbertales-art.test.js` | **通る** | 一時ディレクトリに合成データを書いて CLI を実行する自己完結テストで、実データに依存しない |

### 分類の見直し（前回からの変更点）

「取り込むべき」18 件は変わらない。「要相談」の 5 件は、実行結果に合わせて扱いを次のように改める。

| ファイル | 分類 | 判断理由（1 行） |
| --- | --- | --- |
| `tests/appearance-state-data.test.js` | 要相談 → exclude を推奨 | SCG / SAR の実データ回帰テスト。既存の exclude にある実データテスト群と同じ種類 |
| `tests/ai-image-policy.test.js` | 要相談 → **上流での分割を推奨** | 失敗は実データを読む 1 件だけ。ファイルごと exclude すると `pkg/ai-image-policy.mjs` の純粋関数テスト 15 件も失う |
| `tests/appearance-detail-detachable.test.js` | 要相談（前回の二択のまま） | (a) `Works_Sample` 側の `data/db_meta.json` に `Detachable` 宣言を足す / (b) exclude |
| `tools/inventory-numbertales-art.mjs` + `tests/inventory-numbertales-art.test.js` | 要相談 → exclude を推奨（急ぎではない） | テストは中流でも通るので `npm test` は壊れない。ただ NumberTales 固有の CLI で中流には使い道がない。上流 CHANGELOG 11-20（#60/#61/#62）の申し送り「DB 固有 CLI と対応テストは対で同期対象から除外する」に従うのが筋 |

**上流への提案（`ai-image-policy.test.js`）**: 上流で `61のアイドル4項目と分数D-Vines4人の指定を維持する` を実データ専用ファイル
（例: `tests/data.ai-image-policy-numbertales.test.js`）へ分ける。分割版が降りてくれば、中流はその 1 ファイルだけを exclude すればよく、
純粋関数のテストは中流・下流でも動く。上流で直せばそのまま下流へ流れる種類の修正。分割されるまでの暫定措置として、ファイルごと exclude しても `npm test` は通る。

**提案（`.sync/upstream.json` は書き換えていない・User の判断待ち）**:

1. `exclude` に次を追加する: `tests/appearance-state-data.test.js` / `tools/inventory-numbertales-art.mjs` / `tests/inventory-numbertales-art.test.js` /（暫定）`tests/ai-image-policy.test.js`
2. `tests/appearance-detail-detachable.test.js` は (a) を推奨（renderer の新機能のテストが中流でも生きる）。(a) は中流の `data/` を変える判断なので User が決める。決めない場合は (b)
3. exclude を変えたら `npm run sync:update` を再実行してから merge する

### Dependabot の open PR（03:50 UTC 時点）

| リポジトリ | 状況 |
| --- | --- |
| 上流 | open 0 件（#69 は前回点検後に merge 済み） |
| 中流 | #22 dev-minor-patch（jsdom 31.0.1 / playwright 1.65.1 / vitest 5.1.1）。本日 00:15 UTC に作成されたもので、放置ではない |
| 下流 | open 0 件。`gh pr list --state all` でも PR 履歴が 0 件。`.github/dependabot.yml` はあるのに version updates の PR が一度も作られていない（10-05 からの懸念が続いている。Insights → Dependency graph → Dependabot のログ確認が必要） |

### GitHub Pages 軽量化・高速化の点検（再計測）

ワークフロー `pages.yml` は変更なし（`npm ci` → `npm test` → `upload-pages-artifact@v5`、`path: .`）。

| 計測 | 今回（03:4x UTC） | 前回（01:16 UTC） | 増減 |
| --- | --- | --- | --- |
| 追跡ファイル | 253 件 / 4,885,556 B | 同左 | 0 |
| `node_modules/`（ローカル実測） | 101,800,269 B / 2,686 件 | 92,120,228 B / 2,570 件 | +9.68 MB / +116。本点検の検証テストで Vitest のモジュールキャッシュ `node_modules/.vitest-cache/` が増えた分で、依存の変化ではない |
| `pages/characters.js` の import グラフ | 29 modules / 677,444 B / gzip 181,585 B | 28 / 658,361 B / 176,007 B | **算出定義の差**。今回の再実装は 11-09 版と同じく 29 モジュールを数える。追跡ファイルは変わっていない |
| `pages/relations.js` の import グラフ | 14 / 374,497 B / gzip 115,830 B | 14 / 374,497 B / 115,778 B | 変化なし（gzip の差は実装差） |
| `index.html` + `pages/characters.css` | 2,024 B + 57,348 B（gzip 1,006 + 10,312） | 同左 | 変化なし |
| SW `svc/sw.js` | 1,126 B | 1,126 B | 変化なし |
| 実サイト `/`（github.io） | 200 / TTFB 0.357s / 989 B gzip / `max-age=600` | 200 / 0.034s / 989 B | 転送量は同じ。TTFB の差は計測のばらつき |
| `node_modules` の露出 | あり（200） | あり（200） | 変化なし |

CI でも `npm test` はアップロード前に走るので、公開物の `node_modules/` には依存パッケージに加えて Vitest のキャッシュも載っている見込み。

**新規: 公開物に開発用ファイルが含まれているかの抜き取り検査**（HTTP ステータスのみ確認）

| パス | HTTP |
| --- | --- |
| `/docs/api-sw-spec.md` | 200 |
| `/tests/data.sanity.test.js` | 200 |
| `/tools/sync-upstream.mjs` | 200 |
| `/_work_in_progress/2026-08-26_github-triage.md` | 200 |
| `/package.json` / `/AGENTS.md` | 200 |
| `/.sync/upstream.json` / `/.agents/roleplay/ROLEPLAY.template.md` | 404（隠しディレクトリは `upload-pages-artifact` が除外する） |

中流は public リポジトリなので、内容の機密性は問題にならない。ただ、閲覧者向けではないファイルが配信されている。
なお `index.html` が `./docs/json-db-implementation-guide.md` と `./README.md` にリンクしているので、**`docs/` と `README.md` は公開物から外さないこと**。
`tools/` `tests/` `_work_in_progress/` は `index.html` / `pages/` / `lib/` / `svc/` / `api/` のどこからも参照されていない（grep で確認済み）。

**改善案（1 件・既出の案を更新）**:

1. `pages.yml` の `Test` ステップ直後に `run: rm -rf node_modules tests tools _work_in_progress` を 1 行追加する。
   効果は **−92 MB 以上 / −2,570 ファイル以上**（`node_modules` と Vitest キャッシュ）。さらに `tests/` 413 KB・`tools/` 284 KB・追跡されている作業ログも公開物から外れる。
   `docs/` と `README.md` はサイトから参照されているので残す。変更箇所は `.github/workflows/pages.yml`（同期対象外なので中流だけの修正）。

### 次にやるべき 1 手（更新）

`.sync/upstream.json` の `exclude` に `tests/appearance-state-data.test.js` / `tools/inventory-numbertales-art.mjs` / `tests/inventory-numbertales-art.test.js` /
（暫定）`tests/ai-image-policy.test.js` を追加し、detachable テストを (a) と (b) のどちらにするか決める → `npm run sync:update` → `git merge upstream/creationsdb` → `npm test`
（コンフリクトは 0。実際に落ちるのはこの 4 ファイルぶんだけと確認済み）。

---

## 追記: Pages の改善案 1 を実装・再デプロイ（2026-11-23 03:58〜04:10 UTC・User 了承済み）

- `3e20942` を `develop` に push。`pages.yml` に `Stage site`（`index.html README.md LICENSE api docs pages lib svc data` を `_site/` へ）を追加し、`path: _site` に変更。`docs/deploy-howto.md` と `CHANGELOG.md` も更新した。
- push 時のデプロイは `ENABLE_PAGES` 未設定のため skip された。最後に成功していたデプロイは **2026-08-26（`90e58f9`）** で、公開サイトはそれ以来更新されていなかった。User の了承を得て `workflow_dispatch` で手動実行（run `45109117053`）し、build・deploy とも成功。
- 本番での確認:
  - 200: `/`・`/README.md`・`/LICENSE`・`/docs/json-db-implementation-guide.md`・`/api/`・ページ・3 系統の SW・`lib/`・`pages/vendor/`・`data/`
  - 404: `/_work_in_progress/…`・`/AGENTS.md`・`/CHANGELOG.md`・`/package.json`・`/tests/…`・`/tools/…`・`/pkg/…`・`/node_modules/vitest/package.json`
  - キャラシートは `pages/sw.js` の制御下で表示され、相関図も cytoscape で描画された（`Works_Sample` はレコードが 1 件だけ）。
- 公開サイトは今回から 08-26 版ではなく現在の `develop` の内容になった。
- 続けて User の依頼でリポジトリ変数 `ENABLE_PAGES=true` を設定（04:01 UTC）。skip されていた push 起点の実行 `45109009962` を再実行し、build・deploy とも成功することを確認した。以後は `develop` への push で自動デプロイされる（変数はフォーク先へ引き継がれないので、テンプレートとしてのオプトイン制は維持される）。

---

## 追記: 23 件を取り込み・下流まで反映（2026-11-24・User 判断のもと実施）

- 上流で初期表示の fix（`pages/characters.js` の `populateWorks()`）が `aeb8833` として develop に入ったため、未取り込みは 24 件になった。
- **`.sync/upstream.json`**（`b299649`）: User の判断で `exclude` に 5 件を追加した。
  - `tools/inventory-numbertales-art.mjs` / `tests/inventory-numbertales-art.test.js`
  - `tests/ai-image-policy.test.js` / `tests/appearance-state-data.test.js`
  - `tests/appearance-detail-detachable.test.js`（二択は (b) の exclude。`Works_Sample` の `data/` は変更していない）
- `sync:update`（ベンダー `20097f6`）→ `git merge upstream/creationsdb`（`bb627cd`）で 19 件を取り込んだ。コンフリクトは 0。**55 ファイル 790 件 green**。`agents:check` も一致。`CHANGELOG.md` に Synced を記録（`7e6ead3`）し、`origin/develop` へ push 済み。
- 下流 `RadianNs_SecondaryWorksDB` も同日に 10 件を取り込み済み（`tests/ai-image-policy-invalidate.test.js` は下流に `pkg/` が無いため下流側で exclude）。

### 残った論点（上の再点検の内容と、今回の判断の差）

- `tests/ai-image-policy.test.js` はファイルごと除外した。そのため、再点検で「中流でも通る」とした純粋関数のテスト 15 件も中流では走らない。上流で実データ依存の 1 件を別ファイルへ分ければ、その 1 ファイルだけの除外に戻せる。
- `tests/inventory-numbertales-art.test.js` は再点検では中流でも通る（自己完結）と確認していた。今回は「NumberTales 固有の CLI は対で除外する」方針を優先して、CLI とあわせて除外した。
