# 上流同期レポート — JsonCharacterDB-Framework（中流）2026-11-02

User 指示「上流の GitHub Pages 高速化を中流・下流へ適用する」に基づき、上流の本体ローカル（`main`）の Claude Code から
3 リポジトリのローカルクローンを直接操作して **merge まで実施**。

## 1. やったこと

| 順 | リポジトリ | 内容 | 結果 |
| --- | --- | --- | --- |
| 1 | 中流（本リポジトリ） | `sync:update`（上流 `e0dd24f` → `2663133`）→ `git merge upstream/creationsdb` | コンフリクト 0 / 9 files / 52 files 776 tests green |
| 2 | 下流 `RadianNs_SecondaryWorksDB` | 中流のローカル `develop`（`786d268`）を `git fetch <ローカルパス>` → `sync:update --no-fetch --ref 786d268` → `git merge upstream/framework` | コンフリクト 0 / 6 files / 28 files 251 tests green |

取り込んだ 9 件の内訳:

- 高速化（上流 `76a58a5`・6 件）: `lib/sw-common.js` `lib/page-api-bridge.js` `pages/characters.html` `pages/characters.js`
  `tests/sw.datafetcher-memo.test.js` `docs/api-sw-spec.md`
- 相関図ファセットの `$alt` 解釈（上流 `a141ed8`・3 件）: `lib/graph/graph-facets.js` `pages/relations.js` `tests/graph.facets.test.js`。
  ベンダーブランチ方式は前回ベンダーコミット以降を一括で流すため高速化と同梱になった。下流では `exclude` 済みで流れない。

## 2. 判断

- 中流を GitHub へ push する前に下流へ流すため、下流は GitHub ではなく中流のローカルクローンを fetch して `--ref` で指定した。
  ベンダーコミットの `Upstream-Commit:` は中流の merge コミット `786d268` を指すので、中流を push すれば GitHub 側とも一致する。
- `lib/graph/graph-facets.js` が `git diff --stat` で `Bin` 表示になるのは上流のコミット `a141ed8` 時点から同じ（同期の副作用ではない）。

## 3. 残作業（User 側）

- `git push origin develop` は **中流・下流とも未実行**（上流は push 済み）。中流 → 下流の順で push する。
- push 後に中流 `npm run sync:check`、下流 `npm run sync:check` が 0 件になることを確認する（今回はローカル参照で 0 件を確認済み）。

## 4. 補足

- 挙動の変化: `data/` を push した直後、最大 10 分は旧データが見える可能性がある（GitHub Pages の `max-age=600`。HTML / JS と同じルール）。
  「キャッシュ/SWリセット」ボタンは HTTP キャッシュには触れない。
- テストログは各リポジトリの `.cache/test_sync_2026-11-02.txt`（Git 管轄外）。
