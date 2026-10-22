# 2026-08-29 GitHub 未解決トリアージ（調査・提案のみ / コード変更なし）

## 結論: 未解決項目なし（下流への波及だけ要判断）

Gmail の GitHub 通知（直近14日）で本リポジトリに出ていた失敗は、すべて解消済みでした。

| 項目 | 優先度 | 状態 |
| --- | --- | --- |
| Pages デプロイ失敗 4 件（8/25〜8/26） | — | **対応済み**（`a53970b`） |
| 同修正の下流（CreationsDB / SecondaryWorksDB）への未波及 | 中 | 要判断 |
| Dependabot PR #2 / #3 | — | マージ済み |

---

## 1. Pages デプロイ失敗 → 対応不要（解決済み）

### 失敗通知（すべて branch `develop`）

| 受信日時 (UTC) | commit | ジョブ |
| --- | --- | --- |
| 2026-08-25 07:32 | `43e6c61` | build failed / deploy skipped |
| 2026-08-25 23:40 | `b1760fd` | 同上 |
| 2026-08-25 23:56 | `86a3496` | 同上 |
| 2026-08-26 00:26 | `a39a8ca` | 同上 |
| 2026-08-26 00:32 | `a517969` | 同上 |

### 確認できた解消経緯

`git log origin/develop` の並びが、そのまま修正の足跡になっています。

```
a53970b fix: Node.js のバージョン要件引き上げ、GitHub Pages配信をオプトイン制に変更  ← 現行 tip
a517969 fix: update wall clock budget for performance tests in graph crossing and hex fill
a39a8ca Merge pull request #3 from .../dependabot/npm_and_yarn/jsdom-30.0.1
```

- `a517969` … 性能テストの wall clock 予算調整。失敗の直接原因（`npm test` 落ち）への対処。
- `a53970b` … `package.json` の `engines.node` を `>=18.0.0` → `>=22.19.0`、
  `pages.yml` / `cf-api-sync.yml` の `node-version` を `"20"` → `"22"`、
  さらに `build` ジョブに `if: vars.ENABLE_PAGES == 'true' || github.event_name == 'workflow_dispatch'`
  のオプトイン門番を追加。

`a53970b` 以降、本リポジトリからの CI 失敗通知は届いていません（8/26 以降ゼロ）。
オプトイン門番により、`ENABLE_PAGES` 未設定の環境では job が skip（灰色）となり赤い失敗が出ない設計です。

- Dependabot PR #2（glob 13.0.6）/ #3（jsdom 30.0.1）: コネクタ実測で **closed / merged: true**。
  オープン PR・Issue はいずれも 0 件。

---

## 2.【中】上流としての責務: `a53970b` の修正が下流へ届いていない

`a53970b` は本リポジトリ固有の不具合ではなく、**jsdom 30 が Node 22 以上を要求するようになった**
ことへの追従です（lockfile の `node_modules/jsdom.engines` = `^22.22.2 || ^24.15.0 || >=26.0.0`）。
同じ構造を持つ下流リポジトリには、まだ届いていません。

| 下流 | jsdom | ワークフローの Node | 状況 |
| --- | --- | --- | --- |
| 100BeautiesLab_CreationsDB | `^30.0.1` | **20** | **不整合。CI 失敗リスクあり** |
| RadianNs_SecondaryWorksDB | `^26.1.0` | 20 | 現時点は整合。jsdom 更新時に同じ問題が出る |

### 提案

- CreationsDB へ「`engines.node` 引き上げ + ワークフローの Node 22 化」を案内する。
  詳細は `100BeautiesLab_CreationsDB/_work_in_progress/2026-08-29_github-triage.md` 項目1 に記載済み。
- `.github/**` は上流同期の対象外（各リポジトリ個別管理）のため、自動では伝播しません。
  `docs/fork-sync.md`「上流としての責務」に、**Node/ランタイム要件の引き上げは下流へ告知する**
  旨を1行追記しておくと、次回同種の変更で取りこぼしません（任意）。

---

## 未確認事項

- GitHub Actions のジョブログ本文（annotation の原文）は、利用可能なコネクタツールに Actions 系の
  読み取り API が無いため未取得。原因はワークフロー定義・commit メッセージ・依存関係メタデータの
  実測から特定しています。
