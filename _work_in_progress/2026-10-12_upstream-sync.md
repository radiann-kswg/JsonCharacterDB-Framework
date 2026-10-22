# 上流同期点検レポート — JsonCharacterDB-Framework（中流）

> **`git merge` と `data/` の変更は行っていない（`sync:update` までの読み取り中心の調査と提案）。**
> 実行したのは `npm run sync:check` / `npm run sync:update`（ベンダーブランチの更新）/ `npm test`（merge 前の現状確認）と、
> 読み取り系の git コマンド（`git diff` / `git log` / `git merge-tree --write-tree` のドライラン）だけ。
> `develop` への取り込みとコンフリクト解決は User の判断。
> `data/` と `.sync/upstream.json` は 1 バイトも触っていない。

今週は中流に **9 件**の未取り込みが出た（先週は 0 件）。うち **1 件がコンフリクト確定**。
下流 `RadianNs_SecondaryWorksDB` は先週と同じ 8 件が **未 merge のまま**持ち越されている（別レポート参照）。

---

## 1. 点検サマリ

| 項目 | 値 |
| --- | --- |
| 点検日時 | 2026-10-12 10:15 JST |
| 上流 | `radiann-kswg/100BeautiesLab_CreationsDB` @ `develop` |
| 上流 SHA | `3522a3e`（`DB構想追加(ナンバーテールズ)`） |
| 本リポジトリ SHA | `33d741a`（`develop`。`origin/develop` と一致 = push 漏れなし） |
| 比較基準 | 取り込み済みベンダーコミット `c6ae6a7`（上流 `3a645ff`） |
| 同期対象ファイル数 | 172 |
| 未取り込み | **9 件**（M=9 / A=0 / D=0） |
| 実行コマンド | `npm run sync:check`（exit 1 = 差分あり / 正常）→ `npm run sync:update` |
| ベンダーブランチ | `upstream/creationsdb` を `c6ae6a7` → **`ceb2948`** へ更新済み |
| merge 前のテスト | `npm test` = **52 files / 769 tests すべて green**（15.87s） |
| merge ドライラン | `git merge-tree --write-tree HEAD upstream/creationsdb` = **コンフリクト 1 件**（結果ツリー `7ce211d`） |
| 下流の点検結果 | **8 件**（先週からの持ち越し。コンフリクト 0 / ベンダーブランチは最新で更新なし） |
| 前回点検 | [`2026-09-28_upstream-sync.md`](./2026-09-28_upstream-sync.md)（中流に差分があった直近の回） |

比較基準が `HEAD` ではなく取り込み済みベンダーコミット `c6ae6a7` と出ているので、**接ぎ木は正常**。
「比較基準: HEAD」は出ていない。

### 下流について一言

下流の 8 件は先週と**完全に同一のセット**で、ベンダーブランチ `upstream/framework` も `60c0609`（= 中流 `33d741a`）のままだった。
つまり先週から下流側の `git merge` が行われていない。
加えて、今週中流に降りてきた `lib/data-common.js` / `docs/api-sw-spec.md` / `docs/schema-meta-processing.md` /
`pages/characters.js` は**いずれも下流の同期対象 77 ファイルにも入っている**ため、
中流がこの 9 件を merge すれば**下流の件数は 8 → さらに増える**。

---

## 2. 上流で何が起きたか

9 件は **4 テーマ**に収束する。経緯は上流 `CHANGELOG.md` の 2026-10-07 の 2 エントリと、
`表記統一(ナンバーテールズ用クラス)`（`713badb` / `a4b54e3`）の各コミットに書かれている。

| テーマ | 内容 | 件数 |
| --- | --- | --- |
| A. `$alt` enrich をアクティブDB優先に（双方向化） | アクティブDBに `$alt` の primary 値があるとき、リンク先から対応する alternative フィールドをマージしない。`BirthDay` / `AnivDay` のどちらがアクティブDB側にあってもその値を優先する | 2 件 |
| B. 辞書 `scopeField` 例の表記統一 | 例示文字列 `シンフォニー.XVI(ゼクズィン)` → `シンフォニー.XVI`。ドイツ語読みの括弧付き表記を落とす | 4 件 |
| C. 創作ローカライズ校正 Skill `localize-proofread` の追加 | 既存英訳・対訳辞書・キャラスト本文を校正する Skill を新設し、既存ドキュメントから参照を張った | 1 件 |
| D. `extractSolidColors()` の性能改善 | 透過素材の色ヒストグラム走査を、HEX 文字列経由から整数 RGB の二乗距離比較へ置き換え | 1 件 |

テーマ A が**バグ修正**。従来は抑止が `primary → alternative` の片方向だけで、
アクティブDBに `BirthDay` があってもリンク先の `AnivDay` が追加され、表示に使われてしまうことがあった。

テーマ B は実装の挙動には**一切影響しない**。4 件のうち 3 件（`lib/basic-renders/type-common.js` /
`lib/sw-common.js` / `pages/characters.js`）は**コメント内の例示文字列だけ**の変更で、コード行は 1 行も動いていない。

---

## 3. 差分ファイルの判断（9 件）

### 3-1. 取り込むべき（7 件）

| ファイル | テーマ | なぜそう判断したか |
| --- | --- | --- |
| `lib/data-common.js` | A | 上流のバグ修正。`isEmpty()` を巻き上げて `altKeysBlockedByActivePrimary` を追加するだけ（+18 / -6）。本リポジトリ固有の差分は `sectionOrder` への `'sub'` 追加（1681 行）と `pickDisplaySection()`（2490 行）で、**行が重ならず merge-tree も auto-merge 成功** |
| `docs/api-sw-spec.md` | A | 正典側の 1 行追記（`$alt` で結ばれたフィールドはアクティブDB優先）。実装とセットで入れないと記載と挙動がずれる |
| `docs/schema-meta-processing.md` | B | §3.3 の `scopeField` サンプル JSON の値を 1 行書き換えただけ。仕様文そのものは不変 |
| `lib/basic-renders/type-common.js` | B | JSDoc コメント内の例示文字列 1 行のみ。コード不変 |
| `lib/sw-common.js` | B | 同上（`DataFetcher` 内のコメント 1 行）。コード不変 |
| `pages/characters.js` | B | コメント 2 箇所（1113 行 / 3001 行）のみ。本リポジトリ固有の差分は 998 / 5171 以降 / 6838 行にあり、**重ならず auto-merge 成功** |
| `tools/extract-palette.mjs` | D | 共通処理の性能改善。`colorDistance()`（平方根あり）での `d <= TOL` を二乗距離での `d² <= TOL²` に置き換えたもので**判定は数学的に同値**。`hexToRgb()` は不正値で `[0,0,0]` を返すため `exclude.map(hexToRgb)` が null 落ちすることもない。上流は `tests/extract-palette.test.js` を変更していない＝期待値不変 |

### 3-2. 要注意（1 件 / コンフリクト確定）

| ファイル | テーマ | なぜそう判断したか |
| --- | --- | --- |
| `tests/meta.catalog.schema.test.js` | — | **`merge-tree` 実測でコンフリクト 1 件**。本リポジトリは `Works_NumberTales` → `Works_Sample` へ意図的に書き換え済み（`EraGen: 1, YearInEra: 1` / `InEra[2]` が `byRealYear: 2020`）。上流は自分の実データ更新に合わせて `EraGen: 9,3` → `8,6`、`InEra[2]` → `InEra[1]` の `2050` へ変更しており、**同じ行を両側が書き換えている**。上流版をそのまま当てると `Works_Sample` を読まなくなり `npm test` が確実に落ちる |

**解決方針**: ローカル側（`Works_Sample` / `EraGen: 1, YearInEra: 1` / `InEra[2]` の `2020`）を**全面的に残す**。
上流から取るのは**末尾改行の追加だけ**（上流は `\ No newline at end of file` を解消している）。

### 3-3. 要相談（1 件）

| ファイル | テーマ | なぜそう判断したか |
| --- | --- | --- |
| `docs/deepl-localization.md` | C | Skill `localize-proofread` への参照を 2 箇所追加しているが、**`.claude/skills/**` は同期対象（`include`）に入っていない**ため、本リポジトリには `localize-proofread` が存在しない（あるのは `localize-en-draft` だけ）。取り込むとドキュメント内リンクが切れる。同時に入る「`創世期` → `創世紀`」は純粋な誤記修正なので、こちらは入れたい |

`tests/docs.links.test.js` は `pages/characters.html` の単数形誤記という既知の誤リンクだけを検知する軽量テストで、
**リンク先の存在確認はしない**ため、取り込んでも `npm test` は落ちない（＝テストでは気づけない）。

選択肢は 3 つ:

1. **そのまま取り込み、Skill は後から手動ミラーする** — `localize-en-draft` と同じやり方で
   `.agents/skills/localize-proofread/` → `.claude/skills/localize-proofread/` を上流から持ってくる。
   ドキュメントが先に入るぶん一時的にリンクが切れる。
2. **そのまま取り込み、切れリンクを許容する** — 中流はフレームワーク本体で、ローカライズ Skill まで
   抱えるかは別問題という立場。正典（上流ドキュメント）との差分を増やさずに済む。
3. **参照追加の 2 行だけ落とし、`創世紀` の誤記修正だけ取る** — merge 後に手で 2 行戻す。
   次回以降も同じ 2 行が毎回差分として出続ける（この 1 ファイルだけ恒久的に乖離する）ので、
   やるなら `.sync/upstream.json` の `exclude` 入りも併せて検討することになる。

**おすすめは 1**。ドキュメントと Skill がセットで揃うのが正典の形で、切れリンクも一時的で済む。

---

## 4. `.sync/upstream.json` への提案（変更は未実施）

`tests/meta.catalog.schema.test.js` を `exclude` に追加する案がある。

- **理由**: このテストは上流の実データ（`data/Works_NumberTales/**` の `db_meta.json` の `StoryEra` 値）を
  期待値に直書きしており、**上流がデータを更新するたびに必ずコンフリクトする**構造になっている。
  すでに `exclude` 済みの `tests/data.shape.test.js` / `tests/pages.characters.ui-output.test.js` と同じ性質。
- **副作用**: ローカル版（`Works_Sample` 向けに書き換えた版）はそのまま残って動き続けるので、
  **テストカバレッジは減らない**。ただし 1 つ目の `it()` ブロック
  （`data/db_type.json` の `$MetaType` 宣言の存在確認。データ非依存で、本リポジトリでも有効）への
  上流の改善が今後降りてこなくなる。
- **判断は User に委ねる**。今回は従来どおり取り込んで手でコンフリクト解決する想定で「次にやるべき 1 手」を書いた。

---

## 5. 放置 PR の状況

| リポジトリ | open PR | 内容 | 放置か |
| --- | --- | --- | --- |
| `100BeautiesLab_CreationsDB` | [#41](https://github.com/radiann-kswg/100BeautiesLab_CreationsDB/pull/41) | `chore(deps-dev): bump the dev-minor-patch group with 2 updates`（jsdom 30.1.1→30.1.2 / playwright 1.63.0→1.64.0） | **いいえ**（2026-10-12 00:53 作成 = 点検の約 20 分前） |
| `JsonCharacterDB-Framework` | [#10](https://github.com/radiann-kswg/JsonCharacterDB-Framework/pull/10) | `chore(deps-dev): bump the dev-minor-patch group across 1 directory with 3 updates`（jsdom 30.1.0→30.1.2 / playwright 1.63.0→1.64.0 / vitest 5.0.1→5.0.3） | **いいえ**（2026-10-12 00:54 作成 = 点検の約 20 分前） |
| `RadianNs_SecondaryWorksDB` | 0 件 | — | — |

- 2 件とも今朝 Dependabot が作ったばかりで、**放置 PR は無い**。
- `RadianNs_SecondaryWorksDB` は `state=all` でも PR が 0 件のままで、
  **Dependabot version updates が未有効化の状態は 2026-10-05 の指摘から変わっていない**（未対応）。

---

## 6. 次にやるべき 1 手

```bash
cd "D:\VisualStudio Code Userfile\JsonCharacterDB-Framework"
git merge upstream/creationsdb
# → tests/meta.catalog.schema.test.js で 1 件コンフリクトする
#    ローカル側（Works_Sample / EraGen: 1, YearInEra: 1 / InEra[2] の byRealYear: 2020）を残し、
#    上流からは末尾改行の追加だけ取る
git add tests/meta.catalog.schema.test.js
git commit
npm test   # 52 files / 769 tests が green のままであることを確認
```

**コンフリクト見込みのファイル**: `tests/meta.catalog.schema.test.js`（1 件のみ。merge-tree 実測）
**auto-merge される要注意ファイル**: `lib/data-common.js` / `pages/characters.js`
（どちらもローカル固有の差分と行が重ならないことを確認済みだが、merge 後に念のため該当箇所を目視したい）

merge 後は `docs/deepl-localization.md` の `localize-proofread` 参照（§3-3）の扱いを決める。
そのあと下流へ降ろすなら、下流で `npm run sync:check` → `npm run sync:update` をやり直すこと
（下流の未取り込みが 8 件から増える）。
