# CHANGELOG

## [Unreleased]

### Synced (2026-09-21) — 上流 `100BeautiesLab_CreationsDB` `74cfc58` → `5e8fc7e`

- 21 ファイルをコンフリクトなしで取り込み（`lib/data-common.js` / `pages/characters.js` は
  中流のローカル差分と行が離れており `ort` が自動解決）。**52 ファイル 769 件 green**。
- 上流から取り込んだ機能（下流へも波及）:
  - **獣爾騎兵の旧綴り作品ID 別名解決を全経路へ横展開**（`ShouArRiders` → `ShauErRiders`）。
    `lib/sw-common.js` `DataUtils.toWorkKey()` / `lib/data-common.js` `normalizeLegacyWorkKey()`（新設）/
    `lib/viewer-locator.js` `parseViewerLocator()` / `pages/characters.js` `getQS()` `normalizeWorkKey()` /
    `pkg/cloudflare` `pkg/nodejs` `pkg/python` `pkg/csharp` の 4 クライアント。シグネチャは不変。
    **エイリアス表は SSOT を持たず 7 ファイルへ独立に書かれているため、今後の改名時は同時更新すること**
  - `tools/build-roleplay-prompts.mjs` の enrich 補填。`$enrich: true` を宣言した `*_DBLink` の参照先から
    生成対象レコードの空フィールドを穴埋めする（規則は `lib/data-common.js` `mergeFromLinkedRecord()` に準拠）。
    補填件数はサマリ行の `enriched=N` に出力
  - `tools/clean-cache.mjs`（新規）— `.cache/` 直下の古いエントリを掃除するユーティリティ。
    ディレクトリは**配下で最も新しい mtime** を代表値に取る。plan がデフォルトで、削除は `--write` 時のみ
  - `tests/clean-cache.test.js`（新規・`os.tmpdir()` 上で完結）
- `.sync/upstream.json` の `exclude` に、上流の実データを前提とする新規テスト 2 本を追加
  （`tests/legacy-shauer-work-alias.test.js` / `tests/pkg.client-alias-parity.test.js`）。
  どちらも `data/Works_ShauErRiders` や `db_meta.json` の `CreationWorks` の実在を要求するため、
  `Works_Sample` しか持たない中流では通らない。既に除外済みの `tests/legacy-work-alias.test.js`（Proxies 版）/
  `tests/pkg.nodejs.test.js` と同じ性質。**対応する `lib/**` `pkg/**` の修正自体は取り込んでいる**。
- 未対応（判断待ち）: 上流 `package.json` が追加した `cache:clean` / `cache:clean:write` スクリプトは
  `package.json` が同期対象外のため降りてこない。`tools/clean-cache.mjs` は直叩きで動く。
- 点検レポート: [`_work_in_progress/2026-09-21_upstream-sync.md`](./_work_in_progress/2026-09-21_upstream-sync.md)

### Synced (2026-09-07) — 上流 `100BeautiesLab_CreationsDB` `e11412c` → `74cfc58`

- **ベンダーブランチ `upstream/creationsdb` の初回接ぎ木を実施**。フォーク元の上流コミット `e11412c`
  （2026-08-22）でベンダーブランチを作り `git merge -s ours` で履歴を接いだうえで、上流 `74cfc58`
  （2026-09-07）まで進めて通常の 3-way merge を行った。中流が意図的に持つ差（`'sub'` セクション、
  `$Def_Day` の `year`、`Works_Sample` 前提のテスト、CI の wall-clock 予算など）はコンフリクトなく温存。
  以後は `npm run sync:update` → `git merge upstream/creationsdb` だけで追従できる。
- 上流から取り込んだ機能（下流へも波及）:
  - 相関図の圧縮ロケータ `?r=NTS/100BL`（`lib/relations-locator.js` / `pages/relations.js`）。
    辞書行の `$display.facet.codeFrom` を `lib/graph/graph-facets.js` が読む。旧 `m` / `d` は読み取り互換
  - キャラシートの短縮リンク `?b=NTS-57`（`lib/viewer-locator.js` / `pages/characters.js` / `#btn-copy-short`）
  - `mapDbNameToImageDir` の `#Ref_Vocabulary` 追従と `Loc_` 素通し（`Works_Sample` の References 画像が解決できるようになった）
  - `pages/relations.js` `loadAll()` が同名 `#List_*` を後勝ちで潰していたバグの修正
  - `vrmViewer.js` のカメラフィット修正とサムネイル 404 フォールバック
  - `specStats.js` の `SpecLevel` タググリッド描画
  - `tools/deepl/build-glossary-source.mjs` の併記形ペアリング修正
  - `tests/data.bodypart-enum.test.js`（`$EnumDef_DesignBodyPart` の不変条件。中流でも通る）
- `.sync/upstream.json` の `exclude` に、上流の実データ（`Works_NumberTales` 等）を前提とするテスト 17 本と、
  中流で意図的に書き換えている `docs/fork-sync.md` / `docs/deploy-howto.md` を追加。
  `sync:check` の出力が「中流の意図的な差」だけになり、点検のノイズが消えた。
- `vitest` を `^5.0.0` へ（上流と同じ。PR #4 と同内容）。50 ファイル 764 件 green。
- **`tools/sync-upstream.mjs` の差分比較基準を HEAD → 「develop の履歴に取り込み済みの最新ベンダーコミット」へ変更**。
  従来は下流が意図的に持つ差（`'sub'` セクション等 11 件）が毎回 `M` として出続け、CI の
  `upstream-sync-check` が永久に Issue を開いたままになる構造だった。以後は**上流で新しく変わって
  まだ取り込んでいないものだけ**が出る（`D` は上流削除／`exclude` 追加）。ベンダーコミットは
  commit-tree のトレーラ `Upstream-Repo:` で履歴から見つけるため、`upstream/<name>` ブランチが無い
  fresh clone でも `sync:update` が初回プロンプトを出さず続きを作る（clone で動作確認済み）。
  これに伴い `.github/workflows/upstream-sync-check.yml` の checkout を `fetch-depth: 0` に変更。
  履歴にベンダーコミットが無い（未接ぎ木の）リポジトリでは従来どおり HEAD と比べる。

### Added

- **上流 `100BeautiesLab_CreationsDB` との同期の仕組みを実装**（正典: `docs/fork-sync.md`）。
  3 リポジトリは GitHub 上のフォークではなく履歴が無関係な独立リポジトリのため、`git subtree` も
  素の `git merge` も使えない。マニフェストで絞り込んだ**ベンダーブランチ `upstream/creationsdb` を経由**して
  通常の `git merge` で取り込む方式を採用した（1 回接げば以後は普通の 3-way merge になる）。
  - `.sync/upstream.json` — 同期対象のマニフェスト（`include` / `exclude`）。運用の調整ノブはここだけで、
    スクリプト本体を触る必要はない
  - `tools/sync-upstream.mjs` — ベンダーブランチの更新と差分報告。`git read-tree` / `write-tree` を
    一時 index 上で使うため**作業ツリーに触れず**、上流の blob をそのまま使うので
    上流 CRLF / 下流 LF の改行差で偽の差分が出ない。`develop` への merge は行わない
  - npm scripts: `sync:check`（差分ありで exit 1）/ `sync:check:offline` / `sync:update`
  - `tests/sync-upstream.manifest.test.js` — glob マッチャとマニフェストの健全性を固定。
    `data/**` や生成物が同期対象へ入らないこと、**除外したツールとそのテストが対で除外されている**ことを検査する
- **定期点検を 2 系統で設置**。
  - `.github/workflows/upstream-sync-check.yml` — 毎週月曜 09:00 JST。差分があれば `upstream-sync`
    ラベルの Issue を起票/上書き更新し、解消で自動クローズ。上流が public のため**PAT 不要**
  - Cowork の週次タスク — 差分の中身を判断し `_work_in_progress/YYYY-MM-DD_upstream-sync.md` へレポート
- **`.github/dependabot.yml` を新規追加**（npm: リポジトリ直下 / `pkg/mcp`、GitHub Actions。毎週月曜 09:00 JST）。
  上流にも存在しなかったため新規導入（従来動いていたのは設定不要の security updates のみ）。
  `_work_in_progress/2026-08-26_github-triage.md` §3-2 の Node20 deprecation（actions v4 → v5）は
  これで自動追従される。

### Changed

- **必要な Node.js を 18.0.0 以上 → 22.19.0 以上へ引き上げ**（`package.json` の `engines`、
  CI 全ワークフローの `node-version: "22"`、`AGENTS.md` / `docs/json-db-implementation-guide.md`）。
  dependabot が入れた `jsdom@30` の依存 `undici@8` が `>=22.19.0` を要求し、Node 20 の CI では
  `TypeError: webidl.util.markAsUncloneable is not a function` で jsdom 系テストが collect 段階から
  落ちていた（`npm ci` 後の `npm test` は 49 ファイル 742 件すべて green を確認）。
  `pkg/{nodejs,mcp}` は jsdom に依存しない独立パッケージのため Node 18 対応のまま据え置き。

- **GitHub Pages への配信（`.github/workflows/pages.yml`）をオプトイン制へ変更**。
  Actions Variables に `ENABLE_PAGES=true` がある場合のみ push で走る（`cf-api-sync.yml` と同じ
  「配布時は動かさない」方針に揃えた）。未設定のクローン/フォークではジョブが skip され、
  Pages 未設定リポジトリで赤い失敗ログが溜まらない。手動実行（`workflow_dispatch`）は
  変数なしでも動くので、お試しデプロイの導線は残る。手順は `docs/deploy-howto.md`。

- `AGENTS.md` §1 に「1-1. フォーク同期」を追加。エージェントは `sync:update` まで行ってよいが、
  **`git merge` は User の判断**とすることを明文化した。

## [0.1.0] - 2026-08-25

### Added

- `radiann-kswg/100BeautiesLab_CreationsDB` の `develop` ブランチから、汎用フレームワーク部分を切り出して初期化。
  - キャラシート UI（`pages/characters.*`）／相関図 UI（`pages/relations.*`）／疑似 API（`pages/sw.js`, `svc/`, `api/`）
  - スキーマ駆動レンダラ（`lib/`）
  - クライアントライブラリ（`pkg/`）と英訳補助（`tools/deepl*`）
- 動作確認用のサンプル作品 `data/Works_Sample/` を追加。
- `docs/json-db-implementation-guide.md`（JSON DB 実装ガイド）を新規作成。
- `.agents/roleplay/ROLEPLAY.template.md` を追加し、エージェントの人格を差し替え可能にした。

### Fixed

- `$DetailLayout.headerPills` に載せたキーが基本情報テーブルへ二重表示される不具合を修正
  （`Progress` 決め打ちだった抑止ロジックを headerPills 宣言駆動へ）。
- `$Def_Day` の `year` ロールを `formatDaySummary()` が解釈するようにした（年を持たない宣言は従来どおり）。
- `$display.section: "sub"` が `lib/data-common.js` のホワイトリストから漏れ、`_enrichment.displaySections` で
  `profile` に落ちていた不具合を修正。
- 画像フィールドが空配列のときに `undefined.png` を参照していた不具合を修正（6 箇所）。
- グローバル `data/Dictionaries/` を持たない構成（辞書が作品スコープのみ）で `fetchGlobalDefType()` の
  妥当性判定が false になり、`$dict` 参照が解決できなくなる不具合を修正。

### Changed

- ライセンスを **CC BY-NC 4.0** に変更（`LICENSE`）。
- `AGENTS.md` から特定作品・特定人格への依存を除去し、汎用の技術・運用ルールへ再構成。

### Removed

- 上流固有の創作データ（`data/Works_*` の実データ、辞書・ローカライズ・参照資料）。
- 上流固有の運用資産（カレンダー同期、会話パターン注入、独自ドメインの `CNAME`、移行スクリプト）。
