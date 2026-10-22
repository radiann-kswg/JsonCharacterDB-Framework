# 上流同期点検レポート — JsonCharacterDB-Framework（中流）

**`git merge` と `data/` の変更は行っていない（`sync:update` までの読み取り中心の調査と提案）。**
実行したのは `npm run sync:check` / `npm run sync:update`（ベンダーブランチの更新）／ `npm test`（現状確認）と、
読み取り系の git コマンド（`git diff` / `git log` / `git merge-tree --write-tree` によるドライラン）のみ。
`develop` への取り込みとコンフリクト解決は User の判断。
`.sync/upstream.json` も 1 バイトも触っていない（今回は変更提案なし）。

---

## 1. 点検サマリ

| 項目 | 値 |
| --- | --- |
| 点検日時 | 2026-09-28 10:10 JST |
| 上流 | `radiann-kswg/100BeautiesLab_CreationsDB` @ `develop` |
| 上流 SHA | `3a645ff`（DB進捗更新(ナンバーテールズ) / 2026-09-24〜） |
| 本リポジトリ SHA | `ca7eecd`（`develop`。`origin/develop` と一致 = 前回分は push 済み） |
| 比較基準 | 取り込み済みベンダーコミット `c59c742`（上流 `5e8fc7e`） |
| 同期対象ファイル数 | 172 |
| 未取り込み | **8 件**（M=8 / A=0 / D=0） |
| 実行コマンド | `npm run sync:check`（ネットワーク到達可）→ `npm run sync:update` |
| ベンダーブランチ | `upstream/creationsdb` を `c59c742` → **`c6ae6a7`** へ更新済み |
| merge 前のテスト | `npm test` = **52 files / 769 tests すべて green**（15.5s） |
| merge ドライラン | `git merge-tree --write-tree HEAD upstream/creationsdb` = **コンフリクト 0**（exit 0） |
| 前回点検 | [`2026-09-21_upstream-sync.md`](./2026-09-21_upstream-sync.md) |

比較基準は `HEAD` ではなく取り込み済みベンダーコミット `c59c742` と出ており、
**2026-09-07 の接ぎ木は正常に効いている**。前回 §8 で merge した分（21 件）が基準へ入ったため、
今回出ているのは **2026-09-24 の上流変更だけ**。溜まりは解消済みで、前回の積み残しは無い。

---

## 2. 上流で何が起きたか

未取り込みの 17 コミットのうち、同期対象に触れたものは **2 テーマ**だけ（残りは `data/` の DB 進捗更新・辞書更新）。
どちらも上流 CHANGELOG 2026-09-24 のエントリに対応する。

| テーマ | 内容 | 影響ファイル |
| --- | --- | --- |
| A. enrich の cross-work 2 段ガード | `$Def_DBLinkRef`（`$enrich: true` の `*_DBLink`）経路に meta（`$DetailLayout`）ガードを追加。`$enrich: false` を「enrich 禁止宣言」として通常フィールドへ一般化。ベース名 ↔ `_JP`/`_EN` の相互展開も追加 | `lib/data-common.js` / `docs/api-sw-spec.md` |
| B. 一覧の進捗グループ並び替え | `$DefType` の `$display.listOrder` と辞書行の `isListTop` / `listOrderNum` で、キャラ一覧を進捗タグ順に並べて折りたたむ | `pages/characters.js` / `.sass` / `.css` / `.css.map` / `.html` / `docs/schema-meta-processing.md` |

テーマ A の「下流への申し送り」には、**`tools/build-roleplay-prompts.mjs` の `enrichRecordFromLinks()` は
同じ規則を独立実装しており今回は未追従**と書かれている。本リポジトリは同ツールを持つ（`roleplay:*` スクリプト）ので、
§5 の保留事項として扱う。

---

## 3. 差分ファイルの判断（8 件）

### 3-1. 取り込むべき（8 件）

`merge-tree` のドライランでコンフリクト 0 を確認済み。本リポジトリのローカル差分と行が重ならない。

| ファイル | 種別 | なぜそう判断したか |
| --- | --- | --- |
| `lib/data-common.js` | M | テーマ A 本体（+63 -26）。`stripLangSuffix()` 新設、`subFieldKeys` → `allowKeys` へ改名して meta ガードを一本化。参照元作品の `$DetailLayout` 未宣言項目が cross-work enrich で流れ込むバグ（アンオースドロジカにナンバーテールズ本文が出る）の根治。**本リポジトリのローカル差分は L1644 / L2453 の `'sub'` セクション追加のみで、上流差分は L149 / L729-790 / L1269-1410 — 領域が完全に離れている** |
| `docs/api-sw-spec.md` | M | 上記の仕様追記（+18）。§8.2 に「cross-work 時の 2 段ガード（typedef + meta）」節、§enrich 規則に `$enrich: false` の 1 行。ローカル差分なし |
| `pages/characters.js` | M | テーマ B 本体（+80 -1）。`renderList()` に `listOrder` 解決と `<details class="list-group">` のグループ化を追加。**上流差分は L5448 / L5643 付近、ローカル差分は L998（`$DefType` フォールバック）/ L5171-5240（画像 null ガード）/ L6759（`headerPills` 二重表示抑止）— 最接近でも 200 行以上離れている** |
| `pages/characters.sass` | M | 上記のスタイル（+26）。`#list.grid-list > details.list-group` の段組とブレークポイント。既存セレクタを書き換えず末尾付近へ追加するだけ。ローカル差分なし |
| `pages/characters.css` | M | `.sass` からの生成物（+30）。`.sass` と同一コミットで来るので整合する。ローカル差分なし |
| `pages/characters.css.map` | M | 同上（生成物のソースマップ）。ローカル差分なし |
| `pages/characters.html` | M | `asset-version` を `2026.09.07.1` → `2026.09.24.3` へ。CSS/JS を差し替えるので SW キャッシュの世代上げは必須。ローカル差分なし |
| `docs/schema-meta-processing.md` | M | §3.3 の `$display` 一覧へ `listOrder` の項を追加（+6）。ローカル差分なし |

### 3-2. 要注意（0 件）

今回は該当なし。根拠は 2 つ:

- `git merge-tree --write-tree HEAD upstream/creationsdb` が **exit 0・コンフリクト列挙なし**で完了した
  （作業ツリー・ref を触らないドライラン）。マージ結果ツリーは `5f5c8e6`
- 実際に変わるのは上記 8 ファイルだけで、ローカル改変のある 2 ファイル（`lib/data-common.js` / `pages/characters.js`）は
  §3-1 のとおり上流差分と行が離れている。前回 21 件が `ort` で自動マージできたのと同じ構図

テストファイルは 1 件も降りてこない。テーマ A の対応テスト `tests/enrich.dblink.jump.merge.test.js` は
`exclude` 済み（上流の実データ前提）なので、`npm test` の件数は **52 files / 769 tests から変わらない見込み**。

### 3-3. 要相談（2 件）

| # | 項目 | 内容 |
| --- | --- | --- |
| 1 | テーマ B を本リポジトリで有効にするか | `$display.listOrder` は**データ側の宣言が無いと完全に無効**（宣言が無い環境は従来どおり、が上流の設計）。本リポジトリの `data/db_type.json` の `Progress` は `$display` に `section` / `tagSpace` / `facet` しか持たず `listOrder` が無い。`data/db_meta.json` の `$EnumDef_Progress` の行にも `isListTop` / `listOrderNum` が無い。つまり **merge しても一覧の見え方は変わらない**。`Works_Sample` でも進捗グループ表示を見せたいなら、`db_type.json` の `Progress.$display` へ `"listOrder": true` を足し、`$EnumDef_Progress` の各行へ `isListTop` / `listOrderNum` を足す必要がある。**`data/` は今回一切触っていないので、やるかどうかは User 判断** |
| 2 | `tools/build-roleplay-prompts.mjs` の追従 | 上流 CHANGELOG が明言しているとおり、同ツールの `enrichRecordFromLinks()` は enrich 規則を独立実装していて **今回の meta ガード / `$enrich: false` 一般化に追従していない**。本リポジトリは `roleplay:plan/write/check` を持つので、ライブラリ（`lib/data-common.js`）とツールで規則がズレた状態になる。上流が直して流し直すのが原則（`docs/fork-sync.md` §1）なので、**本リポジトリで先に直さないほうがよい**。上流へ Issue を立てるかは User 判断。対応テスト `tests/data.roleplay-prompts.test.js` は `exclude` 済みなので `npm test` は落ちない |

`$enrich: false` の一般化について（挙動確認）:
本リポジトリの `data/db_type.json` は `AnotherVersions_DBLink` に `$enrich: false`、`AnotherRegions_DBLink` に `$enrich: true` を宣言している。
ただし `data/` の作品は `#Works_Sample` 1 件のみで、実データ側に cross-work 参照（`_Work`）も `$enrich` 宣言も無い。
よって**この変更は本リポジトリ自身のデータに対しては挙動不変**で、効いてくるのはフレームワークの利用側（上流・下流の実データ）だけ。
`Works_Sample` の `$DetailLayout` は `headerPills` / `basicFields` / `subFields` の 3 つを持っているので、
将来 cross-work 参照を足したときも meta ガードは正しく働く。

---

## 4. 下流 `RadianNs_SecondaryWorksDB` への波及

下流は**今日時点で別件 12 件が未取り込み**（前回 §7 の予告どおり。詳細は
[`RadianNs_SecondaryWorksDB/_work_in_progress/2026-09-28_upstream-sync.md`](../../WebSites/RadianNs_SecondaryWorksDB/_work_in_progress/2026-09-28_upstream-sync.md)）。

本リポジトリが今回の 8 件を merge して push すると、下流の `include`（`docs/** lib/** pages/** tests/** tools/**` ほか）と
`exclude` を **8 件すべてが通過する**（下流の `exclude` に該当するものが 1 つも無い）。
うち `lib/data-common.js` / `pages/characters.js` は既に下流の未取り込み 12 件に入っているので、
**下流の件数は 12 → 18 件になる**（新規 6 件 = `docs/api-sw-spec.md` / `docs/schema-meta-processing.md` /
`pages/characters.css` / `.css.map` / `.html` / `.sass`）。

下流で追加の `exclude` 対応は不要と判断した。テーマ B はデータ宣言が無ければ無効なので、
下流の 3 作品（`Works_SecondaryArts` / `Works_Corefolders` / `Works_DeformingAndShapeChanging`）の見え方は変わらない。

---

## 5. 依存関係の状態（`npm ci` の未実施）

前回 merge した dependabot PR #7 のあと **`npm ci` が走っていない**。`package-lock.json` と `node_modules` がズレている。

| パッケージ | `package-lock.json` | `node_modules` の実物 |
| --- | --- | --- |
| `vitest` | 5.0.1 | **5.0.0** |
| `jsdom` | 30.1.0 | **30.0.1** |
| `rolldown`（vitest 依存） | 1.2.9 | **1.2.7** |

古い実物でも `npm test` は 769 tests green なので急ぎではないが、CI（lock どおり入る）とローカルで
テスト環境が違う状態になっている。§7 の手順で `npm ci` を先に挟むことを提案する。

---

## 6. 未マージ PR（GitHub）

`.github/dependabot.yml` 由来の open PR を 3 リポジトリで確認した。**1 件、1 週間放置されているものがある。**

| リポジトリ | PR | 内容 | 作成日 | 状態 |
| --- | --- | --- | --- | --- |
| `100BeautiesLab_CreationsDB` | [#36](https://github.com/radiann-kswg/100BeautiesLab_CreationsDB/pull/36) | `dev-minor-patch` group: jsdom 30.0.1→**30.1.1** / vitest 5.0.0→5.0.1 | 2026-09-21 | **open・7 日経過**。dependabot が本日 rebase して jsdom を 30.1.0→30.1.1 へ積み増している（base は現 `develop` = `3a645ff`）。**前回レポート時点から放置されている唯一の PR** |
| `JsonCharacterDB-Framework` | [#8](https://github.com/radiann-kswg/JsonCharacterDB-Framework/pull/8) | `dev-minor-patch` group: jsdom 30.1.0→30.1.1 | 2026-09-28 | open・本日作成。base は現 `develop`（`ca7eecd`）。前回の #7 は merge 済み |
| `RadianNs_SecondaryWorksDB` | — | open PR なし | — | — |

上流 #36 は**最上流のテスト環境の話で、フレームワーク本体には波及しない**（`package.json` は同期対象外）。
本リポジトリの #8 は §7 の merge と独立だが、`npm ci` をやり直すなら #8 を先に入れてから 1 回で済ませるほうが無駄がない。

---

## 7. 次にやるべき 1 手

**`git merge upstream/creationsdb` → `npm test`。**
今回は `.sync/upstream.json` の変更提案が無いので、前回のような「exclude を足してから `sync:update` をやり直す」手順は不要。
ベンダーブランチ `upstream/creationsdb` は **`c6ae6a7`** まで進めてあるので、そのまま merge できる。

```sh
# 0.（任意・推奨）lock と node_modules を揃える。#8 を先に入れるならその後で
npm ci

# 1. 取り込む（ドライランでコンフリクト 0 を確認済み）
git merge upstream/creationsdb

# 2. 門番
npm test
```

### コンフリクト見込み

| ファイル | 見込み | 理由 |
| --- | --- | --- |
| `lib/data-common.js` | **なし**（検証済み） | ローカル差分 L1644 / L2453、上流差分 L149 / L729-790 / L1269-1410。`merge-tree` もコンフリクトを出さなかった |
| `pages/characters.js` | **なし**（検証済み） | ローカル差分 L998 / L5171-5240 / L6759、上流差分 L5448 / L5643。同上 |
| それ以外 6 件 | **なし** | ベンダー基準 `c59c742` から本リポジトリ側が 1 バイトも変えていない |

万一マーカーが出た場合は、**ローカル側（`'sub'` ディスプレイセクション / `$DefType` フォールバック /
画像 null ガード / `$DetailLayout.headerPills` の二重表示抑止）を残し、上流側の meta ガードと `listOrder` を足す**のが正しい解決。どちらも消さない。

### merge 後の確認ポイント

- `npm test` が **52 files / 769 tests green** を維持しているか（テストファイルは 1 件も降りてこないので件数は変わらない見込み）
- §3-3 の 2 件（`listOrder` のデータ宣言を足すか / `build-roleplay-prompts.mjs` の追従を上流へ投げるか）を決める
- push するまで下流の `sync:check` は 12 件のまま。push 後に下流で `npm run sync:update` をやり直すと **18 件が 1 回の merge で降りる**

---

## 8. 実施記録（2026-09-28 10:2x JST・User の実行許可後）

§7 の手順のうち **`npm ci` までを実施し、`git merge` は実行できていない。**

| # | 操作 | 結果 |
| --- | --- | --- |
| 1 | `npm ci` | **成功**（81 packages / 7s、脆弱性 0）。`node_modules` が lock と一致した（vitest 5.0.0 → **5.0.1** / jsdom 30.0.1 → **30.1.0** / rolldown 1.2.7 → **1.2.9**）。`package.json` / `package-lock.json` は書き換わっていない（`git status` クリーン） |
| 2 | `npm test`（merge 前・新しい依存で再確認） | **52 files / 769 tests green**（11.2s）。依存更新による退行なし |
| 3 | `git merge upstream/creationsdb` | **未実行**。このセッションの自動承認ポリシー（auto mode classifier）が `git merge` を「共有リソースの変更」として拒否したため、コマンド自体が走っていない |

`git merge` は別の経路（別シェル・別ツール）で回避実行していない。**User が手で実行する必要がある。**

```sh
cd "D:\VisualStudio Code Userfile\JsonCharacterDB-Framework"
git merge upstream/creationsdb   # ベンダーブランチは c6ae6a7。ドライランでコンフリクト 0 を確認済み
npm test                         # 52 files / 769 tests green を維持する見込み（テストは 1 件も降りてこない）
```

### merge 後にこちらで続けられること（未実施）

- `CHANGELOG.md` へ `### Synced (2026-09-28) — 上流 100BeautiesLab_CreationsDB 5e8fc7e → 3a645ff` のエントリ追加
- §3-3 の 2 件の判断（`listOrder` のデータ宣言 / `build-roleplay-prompts.mjs` の追従を上流へ投げるか）
- `git push`（下流へ降ろすかどうかは §4 / §7 参照）

### この時点で触っていないもの（再確認済み）

`data/` = 0 件、`.sync/upstream.json` = 0 件、`MERGE_HEAD` なし、`develop` は `origin/develop` と一致。
`_work_in_progress/` の本レポートと `.cache/` の一時ファイルだけが増えている。

---

## 9. 実施記録 その 2（§3-3 の保留事項を User 指示により解消）

User から「データ側に宣言したうえで、`$display.listOrder` の使用方法をドキュメントへ追記」「`build-roleplay-prompts.mjs`
の enrich 追従は `$Def_DBLinkRef` 型 typedef の応用機能なので、ドキュメント側を上流機能に合わせる」という指示を受けて実施した。

### 9-1. 方針 — ドキュメントは「上流と同一テキスト」を先に当てる

`docs/schema-meta-processing.md` §3.3 と `docs/api-sw-spec.md` §8.2 は**どちらも同期対象**で、
かつ**今回の未取り込み 8 件に含まれている**。ここへ独自の文言を書くと、merge 時に**同じ行で必ず衝突する**。

そこで、**上流 `3a645ff` 版のファイルをそのまま当てる**方式を採った。
当てる前の中流版が上流 `5e8fc7e` 版とバイト単位で一致していることを `git hash-object` で確認済みなので、
結果は **merge が生成するツリーと完全に同一**になる。つまり merge 時にこの 2 ファイルは差分として現れず、衝突しない
（下流で獣爾騎兵の綴り修正 5 件が「両側同一変更」として無衝突になったのと同じ仕組み）。

| ファイル | 当てる前 | 当てた後 | 上流 `3a645ff` |
| --- | --- | --- | --- |
| `docs/api-sw-spec.md` | `0af38c34`（= 上流 `5e8fc7e`） | `8905b2a8` | `8905b2a8` ✅一致 |
| `docs/schema-meta-processing.md` | `4bf4bece`（= 上流 `5e8fc7e`） | `43c31305` | `43c31305` ✅一致 |

これで中流のドキュメントは、
**`$display.listOrder` / `isListTop` / `listOrderNum` の使用方法**（`schema-meta-processing.md` §3.3）と、
**cross-work enrich の 2 段ガード（typedef + meta）および `$enrich: false` の enrich 禁止宣言**
（`api-sw-spec.md` §8.2 の新節 + enrich 規則の 1 行）を、上流の正典どおりに保持している。

> **注意（一時的な先行）**: ドキュメントだけ先に上流へ揃えたので、`git merge` が済むまでは
> `lib/data-common.js` / `pages/characters.js` の実装が記載に追いついていない状態になる。merge で解消する。

### 9-2. `data/` への宣言（`listOrder` を実際に有効化）

`data/` は同期対象外なので、ここは中流独自の判断で書ける。**上流の宣言と構造を完全に一致させた**。

| ファイル | 変更 |
| --- | --- |
| `data/db_type.json` | `Progress.$display` へ `"listOrder": true` を追加。キー順も上流と同一（`section` → `tagSpace` → `listOrder` → `facet`） |
| `data/db_meta.json` | `$EnumDef_Progress` の **13 行すべて**へ `isListTop`（3 値）と、中間段の行へ `listOrderNum` を追加。上流の値をそのまま採用 |

`$EnumDef_Progress` の最終形（上流 `data/db_meta.json` と `==` で一致することを照合済み）:

| 辞書行 | `Progress` | `isListTop` | `listOrderNum` | 段 |
| --- | --- | --- | --- | --- |
| `#Progress_Unprofiled` | `unprofiled` | `true` | — | 最上位（畳まない） |
| `#Progress_Secret` | `unreleased` | `true` | — | 最上位 |
| `#Progress_BetaReleased` | `released(beta)` | `true` | — | 最上位 |
| `#Progress_Released` | `released` | `true` | — | 最上位 |
| `#Progress_Accepted` | `accepted` | `true` | — | 最上位 |
| `#Progress_Remaded` | `accepted\nremadeReleased` | `true` | — | 最上位 |
| `#Progress_Recreating` | `nowRecreating` | `null` | 1 | 中間 |
| `#Progress_Creating` | `nowCreating` | `null` | 2 | 中間 |
| `#Progress_Remaking` | `accepted\nnowRemaking` | `null` | 3 | 中間 |
| `#Progress_Founded` | `founded` | `null` | 4 | 中間 |
| `#Progress_Tentative` | `stillTentative` | `null` | 5 | 中間 |
| `#Progress_Archived` | `archived` | `null` | 6 | 中間 |
| `#Progress_Yet` | `notProceeded` | `false` | — | 末尾 |

**`Works_Sample` の見え方は変わらない。** レコードは 2 件で `Progress` はどちらも `released`
（= `isListTop: true` の最上位段）なので、折りたたみグループは 1 つも生成されない。
宣言としては正しく、フレームワークの機能デモとしても成立する状態になった。

### 9-3. 検証

| 検査 | 結果 |
| --- | --- |
| `npm test` | **52 files / 769 tests green**（変更前と同数。退行なし） |
| `npm run data:order:check` | **exit 0**（0/1 レコードを整列 = 整列すべきものなし） |
| `db_type.json` / `db_meta.json` の JSON 妥当性・キー順 | スクリプト内で assert 済み |
| `$EnumDef_Progress` の上流との一致 | `==` で `True` |

`tests/data.field-order.test.js` は `db_type.json` / `db_meta.json` を対象外にしている
（`RECORD_DB_RE` が明示的に除外）ので、辞書行へのキー追加はフィールド順検査に影響しない。
辞書行の未知キーを弾く検証も存在しない。

### 9-4. 未コミット / 未実施

作業ツリーの変更（`data/db_type.json` / `data/db_meta.json` / `docs/api-sw-spec.md` / `docs/schema-meta-processing.md`）は
**commit していない**。`git merge` はローカル未コミット変更が対象ファイルと重なると実行を拒否するため、
**merge の前にこの 4 ファイルを commit する必要がある**。

```sh
cd "D:\VisualStudio Code Userfile\JsonCharacterDB-Framework"
git add data/db_type.json data/db_meta.json docs/api-sw-spec.md docs/schema-meta-processing.md
git commit -m "feat: Progress へ \$display.listOrder を宣言し、docs を上流 3a645ff 版へ先行追従"
git merge upstream/creationsdb   # docs 2 本は同一内容なので差分に現れない
npm test
```

### 9-5. コミット記録と、merge 対象の縮小

| 項目 | 値 |
| --- | --- |
| コミット | **`0af6f54`** `feat: Progress へ $display.listOrder を宣言し、docs を上流 3a645ff へ先行追従`（5 files / +83 -13） |
| 内訳 | `CHANGELOG.md` / `data/db_type.json` / `data/db_meta.json` / `docs/api-sw-spec.md` / `docs/schema-meta-processing.md` |
| CHANGELOG | `## [Unreleased]` の先頭へ `### Changed (2026-09-28)` を追記（AGENTS.md §「変更と同じコミットで CHANGELOG を更新」に従う） |
| `develop` | `ca7eecd` → **`0af6f54`**。`origin/develop` より **1 コミット先行**（push はしていない） |

**この commit によって merge 対象が 8 件 → 6 件に減った。** 再度のドライランで確認済み:

```
git merge-tree --write-tree HEAD upstream/creationsdb   → exit 0（コンフリクトなし）
merge で実際に変わるファイル:
  lib/data-common.js        +63 -26
  pages/characters.css      +30
  pages/characters.css.map    1 行
  pages/characters.html       1 行
  pages/characters.js       +80 -1
  pages/characters.sass     +26
  （docs/api-sw-spec.md と docs/schema-meta-processing.md は
    index の blob OID が upstream/creationsdb 側と一致したため差分に現れない）
```

残る 6 件は §3-1 のとおりすべて「取り込むべき」で、コンフリクト見込みなし。**merge は User の手で。**

```sh
cd "D:\VisualStudio Code Userfile\JsonCharacterDB-Framework"
git merge upstream/creationsdb
npm test                     # 52 files / 769 tests green を維持する見込み
```

merge 後に残るのは `CHANGELOG.md` へ `### Synced (2026-09-28) — 上流 5e8fc7e → 3a645ff` を追記することと、
`git push`（push すると下流の未取り込みが 7 件 → 13 件になる。内訳は §5 の 6 件 ＋ 下流の既存 7 件）だけ。

---

## 10. 実施記録 その 3 — merge 完了（User が実行）

| # | 操作 | 結果 |
| --- | --- | --- |
| 1 | `git merge upstream/creationsdb`（User 実行） | **コンフリクトなし**。merge commit **`9efffb6`**。6 files / +201 -29（ドライランの予測と完全一致） |
| 2 | `npm test` | **52 files / 769 tests green**（変更前と同数。テストは 1 件も降りてこないので予想どおり） |
| 3 | `npm run sync:check` | **0 件 / exit 0**。未取り込みは解消 |
| 4 | `CHANGELOG.md` へ `### Synced (2026-09-28) — 上流 5e8fc7e → 3a645ff` を追記 | commit **`33d741a`** |

`docs/api-sw-spec.md` / `docs/schema-meta-processing.md` は §9-1 の先行追従どおり **merge の差分に現れなかった**
（8 件 → 6 件）。ローカル差分（`'sub'` セクション / `$DefType` フォールバック / 画像 null ガード /
`$DetailLayout.headerPills` 抑止）も全て温存されている。

`pages/characters.js` に `listOrder` の実装（L5473 付近）が入り、§9-2 の `data/` 宣言と噛み合った。
**ドキュメント先行だった状態は解消済み。**

### 残っているのは push だけ

`develop` は `origin/develop` より **4 コミット先行**（`0af6f54` / `c6ae6a7`(ベンダー) / `9efffb6` / `33d741a`）。

- push するまで下流の `sync:check` は 0 件のまま（下流は GitHub 上の `develop` を見る）
- **push 後に下流へ降りるのは 6 件**（`docs/api-sw-spec.md` / `docs/schema-meta-processing.md` /
  `pages/characters.css` / `.css.map` / `.html` / `.sass`）。下流で追加の `exclude` 対応は不要
- 下流の `listOrder` は下流の `data/` に宣言が無いため無効のまま（有効化したいなら下流の
  `db_type.json` / `db_meta.json` へ同じ宣言を足す。**下流の `data/` は許諾情報を含むので User 判断**）
- dependabot PR [#8](https://github.com/radiann-kswg/JsonCharacterDB-Framework/pull/8)（jsdom 30.1.0→30.1.1）は未対応。
  ベースが `ca7eecd` なので push 後に `@dependabot rebase` を投げるのが素直
