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

## 3. push と確認

- `git push origin develop` は中流 → 下流の順で **実行済み**（2026-11-02）。中流は push 前に origin の Dependabot 更新 6 件
  （`package.json` / `package-lock.json`）を merge し、`npm ci` 後も 52 files 776 tests green。
- push 後の `npm run sync:check`（GitHub 基準）は中流・下流とも 0 件。

## 4. 補足

- 挙動の変化: `data/` を push した直後、最大 10 分は旧データが見える可能性がある（GitHub Pages の `max-age=600`。HTML / JS と同じルール）。
  「キャッシュ/SWリセット」ボタンは HTTP キャッシュには触れない。
- テストログは各リポジトリの `.cache/test_sync_2026-11-02.txt`（Git 管轄外）。

---

## 追記: 定期点検（Cowork / 2026-11-02 10:12〜10:16 JST）

上記 merge と**ほぼ同時刻**に定期点検が走ったため、独立した検証結果をここに追記する。
この追記の作業では **`git merge` を実行しておらず、`data/` 配下も `.sync/upstream.json` も一切変更していない**
（`sync:update` も既に最新だったため再実行なし）。読み取り中心の調査と提案のみ。

### 点検時の数値

| 項目 | 値 |
| --- | --- |
| 上流 | `100BeautiesLab_CreationsDB` @ `develop` = `2663133` |
| 同期対象 | 172 ファイル |
| 比較基準（点検開始時 10:12） | 取り込み済みベンダーコミット `64b3095`（上流 `e0dd24f`） |
| 未取り込み | 9 件（M=9 / A・D なし） |
| 比較基準（点検終了時 10:15） | `4c3e4d5`（上流 `2663133`）→ **0 件** |
| 下流 `RadianNs_SecondaryWorksDB` | 点検時 **0 件**（比較基準 `026e508`。merge 済み分 `e794aa1` は中流が未 push のため基準に乗らない） |

reflog は `merge upstream/creationsdb: Merge made by the 'ort' strategy.` でコンフリクトの痕跡なし、
作業ツリーもクリーン。点検側でも merge 結果を再計算して 9 件の取り込みを確認した。

### 9 件の取り込み可否（ファイル単位の判断）

**取り込むべき（7 件）** — いずれも上流の素のバグ修正・共通処理の改善で、本リポジトリ固有の差分と重ならない。

| ファイル | 由来 | 判断理由 |
| --- | --- | --- |
| `lib/sw-common.js` | `76a58a5` | `_fetchTextShared()` で進行中フェッチを束ねる共通処理の改善。固有差分なし |
| `lib/page-api-bridge.js` | `76a58a5` | `reg.update()` を await しない修正。初回ロードの無駄待ちを消す素のバグ修正 |
| `pages/characters.html` | `76a58a5` | `asset-version` 更新のみ。上の JS と対で入れないとキャッシュが切り替わらない |
| `tests/sw.datafetcher-memo.test.js` | `76a58a5` | 上記 `lib/sw-common.js` 対応テスト。ツールとテストは必ず同時（`.sync/upstream.json` の不変則） |
| `docs/api-sw-spec.md` | `76a58a5` | §2.2 への仕様追記。本リポジトリで書き換えている docs には当たらない |
| `lib/graph/graph-facets.js` | `a141ed8` | `$alt` 解釈の追加。`$alt` を持たない既存の軸は挙動不変（`alts` は空配列） |
| `pages/relations.js` | `a141ed8` | ラベル解決と URL code が借り先辞書へフォールバックする追加のみ。既存経路は借り元で従来どおり解決 |

**要注意（2 件）** — 本リポジトリが意図的に書き換えている箇所と重なる候補。**実測コンフリクトは 0。**

| ファイル | 固有差分 | 実測 |
| --- | --- | --- |
| `pages/characters.js` | 比較基準に対して +27 / -2 行。(a) グローバル `data/Dictionaries/` を持たない構成向けに `isGlobalScopedMeta` へ `$DefType` 判定を追加 (b) `resolveImageStatically()` で空配列・空文字を弾くガード | 上流側の変更は import の `?v=` 行だけで位置が重ならない。merge 後も +27 / -2 が完全に保持されている |
| `tests/graph.facets.test.js` | +1 / -132 行（上流の実データ前提ケースを削除） | 上流の追加（`$alt` ケース +20 行）は削った範囲とは別位置。merge 後も +1 / -132 を保持 |

**要相談（0 件）。** 破壊的変更はなし。`.sync/upstream.json` への変更提案もなし
（`tests/data.story-era.test.js` の `exclude` は [Issue #12](https://github.com/radiann-kswg/JsonCharacterDB-Framework/issues/12) 待ちで据え置き）。

付随して、`lib/graph/graph-facets.js` は上流 `a141ed8` で `UNSET_GROUP_KEY` の生 NUL が
`'\u0000unset'` エスケープへ置き換わっており、**取り込み後のファイルに NUL は無い**ことを確認した。
§4 の「`Bin` 表示」は旧版側の NUL が原因で、次回以降の diff は通常表示になる。

### 逆流の提案（1 件・今回の範囲外）

`pages/characters.js` の固有差分 (b)（画像名が空配列・空文字のとき存在しないファイル名を組み立ててしまうのを防ぐガード）は
上流にも同じ素のバグがあるはずの箇所。上流へ逆流させれば固有差分が 1 系統減り、将来のコンフリクト面積が小さくなる。

### 次にやるべき 1 手（§3 の残作業に 1 つ前提が増えた）

点検時点で中流 `develop` は `origin/develop` に対して **2 ahead / 6 behind**。
behind 分は GitHub 側で merge された Dependabot PR 3 件（#10 dev-minor-patch / #13 vite 8.3.5 / #14 undici 8.12.3）とその元コミット。
**push の前に `origin/develop` を取り込む必要がある。**

```
cd "D:\VisualStudio Code Userfile\JsonCharacterDB-Framework"
git merge origin/develop
npm test
git push                 # 中流 → その後 下流（下流は 3 ahead / behind なし）
```

- コンフリクト見込み: `package.json` / `package-lock.json` のみ（ahead 側の 2 コミットは依存を触っていないため実質ストレート）。
  上流由来の 9 ファイルと Dependabot の 6 コミットは触る範囲が重ならない
- `npm test` は点検側では**未実行**（Cowork の VM では `node_modules` が Windows 向けバイナリで起動しないため）。
  §1 の green は merge 時点のもので、`origin/develop` 取り込み後の確認は Windows 側で必要
- 持ち越しだった中流 #10（14 日放置）は merge 済み。上流の open PR も 0 件になった

### Dependabot の open PR（点検時）

| リポジトリ | PR | 内容 | open から |
| --- | --- | --- | --- |
| 中流 | [#15](https://github.com/radiann-kswg/JsonCharacterDB-Framework/pull/15) | brace-expansion 5.0.9 → 5.0.12 | 11-01 |
| 中流 | [#16](https://github.com/radiann-kswg/JsonCharacterDB-Framework/pull/16) | glob 13.0.6 → **14.0.3**（メジャー） | 11-02 |

- 上流は open 0 件。#48 が glob 14.0.3 なので中流 #16 は上流と同じ版へ揃える更新で、入れて問題ない見込み。
  ただし glob 14 は minimatch 11 ベースのメジャーなので、**#15 の後に単独で**入れて `npm test` を通すのが安全
- 下流 `RadianNs_SecondaryWorksDB` は `state=all` でも PR が 1 件も無い状態が続く（2026-10-05 検出・未解決）。
  Settings → Code security → Dependabot version updates の確認が未済

### 環境メモ

- VM の git に削除権限が無いため `.git/objects/*/tmp_obj_*` が増え続けている（中流 26 件 + `.git/objects/maintenance.lock`、下流 19 件）。
  Windows 側でまとめて削除すれば解消する（追跡ファイルではないので安全）
- 上流 `100BeautiesLab_CreationsDB` に未コミットの staged 変更（`lib/sw-common.js` ほか）がある。
  点検は GitHub の `develop`（`2663133`）基準なので今回の結果には影響しないが、次回の同期対象になる

## 5. その2（同日・上流 `b9197d8` = 「GitHub Pages高速化 その２」）

| 順 | リポジトリ | 内容 | 結果 |
| --- | --- | --- | --- |
| 1 | 中流 | `sync:update`（`2663133` → `b9197d8`）→ `git merge upstream/creationsdb` | コンフリクト 0 / 3 files / 52 files 781 tests green |
| 2 | 下流 | 中流ローカル `develop`（`9e64272`）を `--no-fetch --ref` で同期 → `git merge upstream/framework` | コンフリクト 0 / 3 files / 28 files 256 tests green |

- 取り込んだ 3 件: `lib/sw-common.js` `tests/sw.datafetcher-memo.test.js` `docs/api-sw-spec.md`（Cache API の stale-while-revalidate。
  上流 CHANGELOG の申し送りどおり `lib/` と `tests/` を対で取り込んだ）。
- 鮮度の約束が変わる: `data/` push 後、最初のロードは旧データ（裏で更新）、次のロードから新データ。即時反映は UI の「キャッシュ/SWリセット」。
- `git push origin develop` は中流 → 下流の順で実行済み。push 後の `sync:check`（GitHub 基準）は両方 0 件。

## 6. その3（同日・上流 `61101b8` + `0b26d82` = 「GitHub Pages高速化 その３」「同 続き」）

| 順 | リポジトリ | 内容 | 結果 |
| --- | --- | --- | --- |
| 1 | 中流 | `sync:update`（`b9197d8` → `0b26d82`）→ `git merge upstream/creationsdb` | コンフリクト 0 / 7 files / 53 files 784 tests green |
| 2 | 下流 | 中流ローカル `develop`（`89296d8`）を `--no-fetch --ref` で同期 → `git merge upstream/framework` | コンフリクト 0 / 7 files / 29 files 259 tests green |

- 取り込んだ 7 件: `lib/sw-common.js` `lib/data-common.js` `lib/basic-renders/type-common.js` `pages/characters.js` `pages/characters.html`
  `docs/api-sw-spec.md` と新規 `tests/data-common.reference-resolver.test.js`（SW / UI の CPU コスト削減。`readDBShared()` と各種メモ化）。
  上流 CHANGELOG の申し送りどおり `lib/` 3 ファイルと新規テストを対で取り込んだ。`_DBLink` マージの出力は不変。
- `git push origin develop` は中流 → 下流の順で実行済み。push 後の `sync:check`（GitHub 基準）は両方 0 件。

## 7. その4（同日・上流 `52c1f24` = 「GitHub Pages高速化 その４」）＋ AGENTS 恒常対応のミラー

| 順 | リポジトリ | 内容 | 結果 |
| --- | --- | --- | --- |
| 1 | 中流 | `sync:update`（`0b26d82` → `52c1f24`）→ `git merge upstream/creationsdb`（`lib/sw-common.js` のみ） | コンフリクト 0 / 53 files 784 tests green |
| 2 | 下流 | 中流ローカル `develop`（`6d232fa`）を `--no-fetch --ref` で同期 → `git merge upstream/framework` | コンフリクト 0 / 29 files 259 tests green |
| 3 | 中流・下流 | `AGENTS.md` に上流の「GitHub Pages の軽量化・高速化（恒常対応）」節と確認事項「ロード性能」をミラー → `agents:build` / `agents:check` 一致 | 両方 `npm test` green |

- 上流の本番（`database.numbertales-radiann.net`・その4 デプロイ後）を Claude の内蔵ブラウザで実測:
  `characters.html?c=NumberTales/Primary` 2 回目以降 `🎉 Application initialization complete in` **675ms / 426ms**（1000ms 未満）。
  `relations.html?r=NTS` 2 回目以降は `/pages/v1/bootstrap` が navigation から **437ms** で応答。
- `AGENTS.md` は同期対象外（リポジトリの身元）なので手動ミラー。上流固有の参照（`NumberTales/Primary`・`r=NTS`・`_work_in_progress/` の経緯レポート）だけ
  本リポジトリ向けに言い換え、下流はさらに相関図なし・Pages 未公開時はローカル配信、と言い換えた。
- `git push origin develop` は中流 → 下流の順で実行済み。push 後の `sync:check`（GitHub 基準）は両方 0 件。
