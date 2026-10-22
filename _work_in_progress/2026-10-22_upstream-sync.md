# 上流同期レポート — JsonCharacterDB-Framework（中流）2026-10-22

User 指示「一次創作 DB のフレームワーク機能を下流へ追従させる」に基づき、3 週間滞っていた同期を実行した回。
点検ではなく **merge まで実施**。

## 1. やったこと

| 順 | リポジトリ | 内容 | 結果 |
| --- | --- | --- | --- |
| 1 | 下流 `RadianNs_SecondaryWorksDB` | 滞留していた 8 件を `git merge upstream/framework` | コンフリクト 0 / 28 files 247 tests green |
| 2 | 中流（本リポジトリ） | `sync:update` → 19 件を merge | コンフリクト 1（`tests/meta.catalog.schema.test.js`）/ 52 files 772 tests green |
| 3 | 上流 `100BeautiesLab_CreationsDB` | `tests/meta.catalog.schema.test.js` を実データ非依存版に差し替え | 77 files 1404 tests green |
| 4 | 中流 | 上流 3 の差分を再 sync（内容差なし） | `sync:check` 0 件 |
| 5 | 下流 | 中流の最新を再 sync → 15 件 merge | コンフリクト 0 / 28 files 248 tests green / `sync:check` 0 件 |

## 2. 判断（User 確認済み）

- `tests/data.story-era.test.js` → **A'**: `.sync/upstream.json` の `exclude` に追加。暦定義の柔軟化は
  [Issue #12](https://github.com/radiann-kswg/JsonCharacterDB-Framework/issues/12) で追跡。
- `tests/meta.catalog.schema.test.js` → 手動解決に加え **根本対策**: 作品名・年代の実値を書かず `data/Works_*` を
  走査する形に書き換え、上流にも同一ファイルを適用。以後 3 リポジトリで同一内容になりコンフリクトしない。
  `{value, about}` で包まれた `FromEra`（上流 `Works_ShauErRiders`）も許容する。
- `localize-proofread` Skill → 上流から `.agents/skills/` と `.claude/skills/` を手動ミラー（`agents:check` 一致）。

## 3. 残作業（User 側）

VM からは GitHub へ push できない（認証なし）ため、**3 リポジトリとも `git push origin develop` は未実行**。
順序は 上流 → 中流 → 下流（どの順でも壊れないが、ベンダーブランチの参照 SHA が GitHub 側にも揃う）。
push 後に各リポジトリで `npm run sync:check` が 0 件になることを確認する。

## 4. 補足

- テストは VM 側の `node_modules` が Windows 向けバイナリのため、`$HOME` 配下へ作業ツリーを複製して `npm ci` し直して実行した。
  リポジトリ内の `node_modules` には触れていない。
- 下流の `data/` には `$enrich: true` の `*_DBLink` も `$alt` も無いので、今回の enrich ガード変更による表示影響なし。
