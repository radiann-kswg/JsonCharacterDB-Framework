# 2026-09-02 GitHub 未解決トリアージ（調査・提案のみ / コード変更なし）

## 実施範囲

- Gmail の GitHub 通知（`from:github.com newer_than:14d` = 2026-08-19〜09-02、25 スレッド）を走査
- GitHub コネクタ（`mcp__github__*` 読み取り系のみ）で PR / Issue / ラベル / コミットを実測
  → **省略なし・全件実測**（`get_me` で認証確認済み。401/403 なし）
- ローカル（`D:\VisualStudio Code Userfile\JsonCharacterDB-Framework`）で読み取り専用の
  git / node 実行により原因を切り分け

書き込みは本ログのみ。コード・ワークフロー・設定・git 状態は一切変更していません。

---

## 結論サマリ

| #   | 項目                                                          | 優先度 | 状態                           |
| --- | ------------------------------------------------------------- | ------ | ------------------------------ |
| 1   | Upstream sync check が初回スケジュール実行で失敗（8/31）      | **高** | **未対応（新規・原因特定済）** |
| 2   | 上流 100BeautiesLab_CreationsDB との差分 31 ファイルが未取込  | 中     | 未対応                         |
| 3   | `pages.yml` オプトイン化で自リポジトリの Pages も skip の恐れ | 低     | 要確認（8/31 から継続）        |
| 4   | Pages 失敗 5 件（8/25〜8/26）・PR #1〜#3                      | —      | 解決済み（実測で再確認）       |

---

## 1.【高】Upstream sync check の初回スケジュール実行が失敗（新規）

### 事実

- 通知: 2026-08-31 00:14 UTC（09:14 JST）、`Run failed: Upstream sync check - develop (a53970b)`
  - ジョブ `check` が failed（annotation 1 件）
- cron は `0 0 * * 1`（毎週月曜 00:00 UTC）。本リポジトリは 8/25 作成のため、
  **8/31 が初回のスケジュール実行**であり、このワークフローは一度も成功していません。
- 前回トリアージ（CreationsDB 側 `2026-08-31_github-triage.md`）は JST 早朝に実行されたため
  この通知（09:14 JST 着）を拾えておらず、**本日が初回の取り扱い**になります。

### 実測による切り分け（2026-09-02）

| 確認内容                                                    | 結果                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `upstream-sync` ラベルの存在                                | **存在しない**（`get_label` → `label 'upstream-sync' not found`）   |
| オープン Issue                                              | **0 件**（追跡 Issue が作られていない）                             |
| `node -p "require('./.sync/upstream.json').repo"`            | 正常（`"type": "module"` でも `node -p` は CJS 評価のため無関係）   |
| `node tools/sync-upstream.mjs --check --no-fetch --markdown` | **正常終了**（差分 31 件を検出してマークダウン出力）                |

→ `Fetch upstream` と `Check drift` の 2 ステップは無実です。差分が 31 件ある以上、
ワークフローは `DRIFT != 0` の経路に入り、**「Open or update tracking issue」で追跡 Issue を
作るはず**でしたが、Issue もラベルも存在しません。**失敗箇所はこのステップで確定**です。

### 原因（該当箇所と成立する筋）

`.github/workflows/upstream-sync-check.yml`:

```sh
set -euo pipefail
gh label create upstream-sync --color BFD4F2 --description "上流リポジトリとの同期" 2>/dev/null || true
NUMBER=$(gh issue list --label upstream-sync --state open --limit 1 --json number --jq '.[0].number // empty')
```

1. `gh label create` が何らかの理由で失敗 → `2>/dev/null || true` により**理由がログに一切残らない**
2. ラベルが無いまま `gh issue list --label upstream-sync` を実行 → gh はラベル未存在をエラー扱いにする
3. `set -e` 下のコマンド置換の失敗 → **ステップごと終了（annotation 1 件）**

「ラベルが実在しない」という実測が 1 と 2 の両方に整合します。1 の真因（権限か、
リポジトリ設定の Workflow permissions か、gh の挙動差か）は、**現状の設計ではログに残らない**ため
ここで確定できません。これ自体が最大の問題です。

### 提案（最小差分・計 2 行 + 任意の暫定回避）

**a. 真因をログに残す（診断が先。1 行）**

```diff
-          gh label create upstream-sync --color BFD4F2 --description "上流リポジトリとの同期" 2>/dev/null || true
+          gh label create upstream-sync --color BFD4F2 --description "上流リポジトリとの同期" || echo "::warning::upstream-sync ラベルの作成に失敗（既存なら無害）"
```

`2>/dev/null` を外すのが本質です。既存ラベルがある場合の "already exists" は
`|| echo ...` で握れるので、失敗しても止まらず、かつ理由は残ります。

**b. `set -e` の巻き添えを防ぐ（1 行）**

```diff
-          NUMBER=$(gh issue list --label upstream-sync --state open --limit 1 --json number --jq '.[0].number // empty')
+          NUMBER=$(gh issue list --label upstream-sync --state open --limit 1 --json number --jq '.[0].number // empty' 2>/dev/null || true)
```

ラベルが無い＝追跡 Issue も無いので、空文字にフォールバックして新規作成へ進むのが正しい挙動です。

**c. 暫定回避（コード変更なしで今すぐ通したい場合）**

Settings → Labels で `upstream-sync`（色 `BFD4F2`）を手動作成する。
a/b を入れない限り再発の芽は残りますが、次回月曜の実行は通ります。

### 検証方法（実施は人の判断で）

- Actions → Upstream sync check → **Run workflow**（`workflow_dispatch` あり）で手動実行し、
  ジョブが緑になり追跡 Issue が 1 件作られることを確認する。
- a を入れた場合、ラベル作成が失敗していたなら `::warning::` に実理由が出ます。

---

## 2.【中】上流 100BeautiesLab_CreationsDB との差分 31 ファイルが未取り込み

項目 1 のせいで追跡 Issue が立っていないため、ローカルで `--check` を実行した実測を記録します
（上流 `develop` @ `cc0aa87` 時点 / 同期対象 185 ファイル中 **差分 31 件**）。

- 変更（M・本体 6 件）: `docs/deploy-howto.md`, `docs/fork-sync.md`, `lib/data-common.js`,
  `lib/section-renders/vrmViewer.js`, `lib/wrapper-common.js`, `pages/characters.js`
- 追加（A・16 件）: `tests/baseArea.render.test.js`, `tests/commons.secondaries.test.js`,
  `tests/data.bodypart-enum.test.js`, `tests/data.shape.test.js`, `tests/enrich.dblink.jump.merge.test.js`,
  `tests/enrich.index-alias-dict.test.js`, `tests/enrich.indexdef.perdb.test.js`,
  `tests/faction.render.test.js`, `tests/keyedDialogue.render.test.js`, `tests/legacy-work-alias.test.js`,
  `tests/migrate-common.test.js`, `tests/pages.characters.ui-output.test.js`,
  `tests/pages.characters.url-params.test.js`, `tests/pkg.nodejs.test.js`,
  `tests/private-commons-order.test.js`, `tests/section-renders.relation.test.js`
- 変更（M・テスト/ツール 9 件）: `tests/data.image-links.test.js`, `tests/extract-palette.test.js`,
  `tests/graph.badge.test.js`, `tests/graph.crossing.test.js`, `tests/graph.facets.test.js`,
  `tests/graph.hexfill.test.js`, `tests/meta.catalog.schema.test.js`, `tests/sw.enrich.basic.test.js`,
  `tools/deepl/build-glossary-source.mjs`

取り込み手順（`docs/fork-sync.md` の正典どおり）:

```sh
npm run sync:update
git merge upstream/creationsdb
```

> 注意: 追加分の多くがテストです。`.sync/upstream.json` の不変則
> 「ツールを exclude したらそのテストも exclude する」に照らし、exclude 対象
> （`tools/agent-instructions/**` 等）に対応するテストが混ざっていないか、
> マージ後に `npm test` で確認してください。

---

## 3.【低】`pages.yml` のオプトイン化で自リポジトリの Pages が静かに skip される可能性

- `a53970b` で build ジョブに
  `if: vars.ENABLE_PAGES == 'true' || github.event_name == 'workflow_dispatch'` が入りました。
  フレームワーク配布物としては妥当な設計です。
- ただし**本リポジトリ自身**（`has_pages: true`）でリポジトリ変数 `ENABLE_PAGES` が
  未設定だと、自分の Pages も push では更新されなくなります。
- 8/26 以降 Pages 失敗通知が止まっているのは「直った」のではなく
  「**ゲートで止めた**」可能性があります（perf 予算を直した `a517969` の直後の実行も失敗している）。
- 確認: Settings → Secrets and variables → Actions → Variables に `ENABLE_PAGES=true` があるか。
  コネクタに変数読み取り API が無いため未確認のままです。

---

## 対応不要と判断した項目（根拠つき / 確認日時: 2026-09-02）

| 項目                                      | 判断根拠（実測）                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| PR #1 / #2 / #3（Dependabot・Copilot 対応） | `list_pull_requests state=open` → `[]`。develop 履歴にマージコミットあり |
| Pages 失敗 5 件（8/25 07:32〜8/26 00:32）  | 8/26 の `a53970b` 以降、失敗通知ゼロ（ただし項目 3 の留保つき）           |
| オープン Issue                             | `list_issues state=OPEN` → 0 件                                           |

---

## 未確認事項・制約

- **Actions のジョブログ本文（annotation の原文）は取得していません。** 利用可能なコネクタに
  Actions 系の読み取り API が無いためです。項目 1 の原因は、ワークフロー定義・ラベル実在確認・
  ローカルでのスクリプト再現から詰めています（annotation 1 件という件数とも整合）。
- **Dependabot / Code scanning のアラート現況は未確認**（同じく読み取り API 無し）。
  直近 14 日の Gmail にアラートメールは 1 件も届いていません。
- ローカル clone の Node は v24.16.0（CI は 22）。`--check` の再現はバージョン非依存の
  git 操作のみのため、この差は結論に影響しません。

## 参考リンク

- 該当ワークフロー: `.github/workflows/upstream-sync-check.yml`
- 同期の正典: `docs/fork-sync.md` / `.sync/upstream.json`
- 同一原因の下流側ログ: `RadianNs_SecondaryWorksDB/_work_in_progress/2026-09-02_github-triage.md`
