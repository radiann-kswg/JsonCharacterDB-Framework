# 上流同期点検レポート — JsonCharacterDB-Framework（中流）

> **`git merge` と `data/` の変更は行っていない（`sync:update` までの読み取り中心の調査と提案）。**
> 実行したのは `npm run sync:check` / `npm run sync:update`（ベンダーブランチの更新）/ `npm test`（merge 前の現状確認）と、
> 読み取り系の git コマンド（`git diff` / `git log` / `git merge-tree --write-tree` のドライラン）だけ。
> `develop` への取り込みとコンフリクト解決は User の判断。
> `data/` と `.sync/upstream.json` は 1 バイトも触っていない。

今週は中流に **19 件**の未取り込みが出た（先週 9 件 + 今週新たに 10 件）。
先週の 9 件が未 merge のままなので比較基準は先週と同じ `c6ae6a7` で、**先週の分がそのまま積み上がっている**。
コンフリクトは先週と同じ **1 件**（`tests/meta.catalog.schema.test.js`）。
加えて **取り込むと `npm test` が確実に落ちる新規テストが 1 件**ある（§4-1）。

なお点検の途中で、**先週のレポート自身が原因で `npm test` が落ちていた**のを見つけて直した（§5）。

---

## 1. 点検サマリ

| 項目 | 値 |
| --- | --- |
| 点検日時 | 2026-10-19 10:15 JST |
| 上流 | `radiann-kswg/100BeautiesLab_CreationsDB` @ `develop` |
| 上流 SHA | `e096bb4`（`キャラシートUI改善`） |
| 本リポジトリ SHA | `33d741a`（`develop`。`origin/develop` と一致 = push 漏れなし） |
| 比較基準 | 取り込み済みベンダーコミット `c6ae6a7`（上流 `3a645ff`）※先週と同じ＝先週分が未 merge |
| 同期対象ファイル数 | 173 |
| 未取り込み | **19 件**（M=18 / A=1 / D=0） |
| 実行コマンド | `npm run sync:check`（exit 1 = 差分あり / 正常）→ `npm run sync:update` |
| ベンダーブランチ | `upstream/creationsdb` を `ceb2948` → **`d222138`**（上流 `e096bb4`）へ更新済み |
| merge 前のテスト | `npm test` = **52 files / 769 tests すべて green**（§5 の修正後。修正前は 1 件 fail） |
| merge ドライラン | `git merge-tree --write-tree develop upstream/creationsdb` = **コンフリクト 1 件**（結果ツリー `f9447b9`） |
| 下流の点検結果 | **8 件**（3 週連続の持ち越し。コンフリクト 0 / ベンダーブランチは最新で更新なし） |
| 前回点検 | [`2026-10-12_upstream-sync.md`](./2026-10-12_upstream-sync.md) |

上流で動いた主な作業（上流 `CHANGELOG.md` の直近 3 エントリ）:

| 日付 | 内容 |
| --- | --- |
| 2026-10-17 | `fix:` キャラシート UI の表示整理（重複行・JP/EN 混入・モバイル段組み） |
| 2026-10-14 | `feat:` 創世紀元年を meta 宣言（`General.StoryEraEpochs`）し `YearInEra` を元年基準へ統一 + 整合テスト新設 |
| 2026-10-07 | `feat:` 校正 Skill `localize-proofread` 追加 / `fix:` `$alt` enrich をアクティブDB優先に |

---

## 2. 取り込むべき（16 件）

上流のバグ修正・共通処理の改善で、下流の意図的な差分と衝突しないもの。

| ファイル | 変更内容 | 判断理由 |
| --- | --- | --- |
| `lib/data-common.js` | `$alt` の primary に現DBの値がある場合、リンク先の代替キーを enrich で持ち込まない | 片方向だった抑止を双方向にする純粋なバグ修正。`BirthDay` があるのに参照先の `AnivDay` が表示を奪う事故を防ぐ |
| `lib/section-renders/relation.js` | ラベル無しコメント行を `: - コメント` → `: コメント` へ | 区切りの空振り修正。1 行の表示バグ修正で副作用なし |
| `lib/wrapper-common.js` | `eraSummary` が負の `YearInEra` を「第N創世紀元前M年」/「Gen.N BCE M」で出す | 新しい元年規約への追従。既存の正数パスは素通りなので後方互換 |
| `tests/wrapper-common.test.js` | 上記の元前表示のテストを追加（+10 行） | fixture をインラインで持つデータ非依存テスト。中流の `data/` に何も要求しないのでそのまま通る |
| `tools/extract-palette.mjs` | 色の近さ判定を HEX 文字列経由から整数 RGB の二乗距離へ | 2.6 万色 × マージ済み色数の総当たりの性能改善。判定値は `colorDistance()` と同値。中流に `tests/extract-palette.test.js` があるので回帰は検出できる |
| `lib/basic-renders/type-common.js` | コメント中の `scopeField` 例示を `シンフォニー.XVI(ゼクズィン)` → `シンフォニー.XVI` | コメント 1 行のみ。挙動に影響なし |
| `lib/sw-common.js` | 同上（コメントのみ） | 同上 |
| `pages/characters.js` | JP 固定だった UI 文言を `getUiCopyByLanguage()` へ集約 / EN ラベル逆引きを `*_JP` キーにも適用 / EN ラベル無しの最終手段を CamelCase 分割（`BasicInfo` → `Basic Info`） | EN 表示に日本語が残る不具合の修正。フレームワーク側の素の改善 |
| `pages/characters.sass` | `.thumb` / `.poster` の `::before` 文言削除・`.detail-hero` のサイズ指定集約・モバイル 1 カラム化の復活 | **上の `characters.js` と対**。CSS 側の「画像なし」を消して JS 側 placeholder に寄せる変更なので、片方だけ取ると二重表示または文言消失になる |
| `pages/characters.css` / `pages/characters.css.map` | 上記 `.sass` からの再生成物 | 生成物。`.sass` と必ず同時に |
| `pages/characters.html` | `asset-version` を `2026.09.24.3` → `2026.10.17.1` | キャッシュ更新用。UI 変更と同時に上げないと古い CSS/JS が残る |
| `docs/api-sw-spec.md` | `$alt` の enrich 抑止ルールを 1 行追記 | `lib/data-common.js` の仕様記述。コードと同時に |
| `docs/schema-meta-processing.md` | §4.4 に「創世紀元年（`General.StoryEraEpochs`）と `YearInEra` の規約」を追加 / `scopeField` 例示修正 | `lib/wrapper-common.js` の仕様記述。**ただし §4.4 は `tests/data.story-era.test.js` を正典として参照する**（§4-1 と併せて判断） |
| `docs/wrapper-summary-registry.md` | `eraSummary` の負数挙動を 1 行追記 | 同上 |
| `docs/localization-en-rules.md` | 193+/191−。大半は markdown テーブルのパディング除去で、実質の追加は GenderType `Arbitrary` / `ArbitraryFemale` / `ArbitraryMale` の代名詞規則 | 差分は大きいが中身は整形＋規則追加のみ。中流で exclude していないので降りてくる。無害 |

**まとめて取るべき束**: `pages/characters.{js,sass,css,css.map,html}` の 5 ファイルは 1 セット。
`lib/wrapper-common.js` + `tests/wrapper-common.test.js` + `docs/wrapper-summary-registry.md` も 1 セット。

---

## 3. 要注意（コンフリクト見込み・1 件）

| ファイル | 衝突する理由 |
| --- | --- |
| `tests/meta.catalog.schema.test.js` | **`git merge-tree` 実測でコンフリクト確定**。中流は `Works_NumberTales` → `Works_Sample` へ意図的に書き換え済み（`EraGen: 1, YearInEra: 1` / `InEra[2]` が `byRealYear: 2020`）だが、上流は 10-14 の元年統一で同じ行を `EraGen: 8, YearInEra: 5` / `InEra[1]` へ書き換えた。加えて末尾の改行有無も差分に入っている |

解決方針は先週と同じ **「ローカル側（`Works_Sample`）の値を残す」**。上流側の変更は上流の実データ都合なので取り込む意味がない。

これは 10-12 のレポート §4 で挙げた**構造的コンフリクト**がそのまま再発したもの。
上流がデータを更新するたびに毎回ここで止まるので、`.sync/upstream.json` の `exclude` 入れを引き続き提案する（§4-3）。

---

## 4. 要相談（2 件）

### 4-1. `tests/data.story-era.test.js`（新規・A）— 取り込むと `npm test` が確実に落ちる

上流 10-14 の新規テスト。`data/` を走査して次の 2 つを守る:

1. 全 `StoryEra` 点の `YearInEra` が `General.StoryEraEpochs` の元年との相対年数として `byRealYear` に合うこと
2. 実年齢キャラクターの `誕生年 = InEra.byRealYear - Age` が `$enrich: true` の `*_DBLink` 先と一致すること

**中流では 2 箇所で落ちる**（データを読んで確認済み）:

| 落ちる箇所 | 理由 |
| --- | --- |
| `it('元年が宣言されている')` | 中流の `data/db_meta.json` は `General: {}` で `StoryEraEpochs` が無い → `expect(Object.keys(epochs).length).toBeGreaterThan(0)` が落ちる |
| `it('全 StoryEra 点で …元年に合う')` | `Works_Sample` の `InEra` が `[{EraGen:1,YearInEra:1}, {EraGen:1,YearInEra:2}, {byRealYear:2020}]`。`byRealYear` が 1 個に対し `YearInEra` が 1 と 2 の 2 点あるので、元年を 2020 と宣言しても `YearInEra: 2` は 2021 と計算されて不一致になる |

つまり**取り込むには `data/` の変更（`General.StoryEraEpochs` の宣言 + `Works_Sample` の `InEra` 修正）が必要**で、本点検の範囲外。

上流の `CHANGELOG.md` にも申し送りがある:

> 下流で `StoryEra` を使う場合は自作品の `data/db_meta.json` に `General.StoryEraEpochs` を宣言しないと同テストが「元年未宣言」で落ちる（`StoryEra` や `$enrich: true` の `*_DBLink` を持たない下流は同テストを除外対象にする）。

選択肢:

| 案 | 内容 | 評価 |
| --- | --- | --- |
| **A（おすすめ）** | `.sync/upstream.json` の `exclude` に `tests/data.story-era.test.js` を追加 | 1 行で済み `data/` を触らない。失うのは「実データの年代整合テスト」だが、これは**フレームワークのロジックではなく実データの不変条件**を見るテストで、サンプル 1 作品しか持たない中流では守る対象が実質無い |
| B | 中流の `data/db_meta.json` に `General.StoryEraEpochs`（第1=2020 等）を宣言し、`Works_Sample` の `InEra` を 1 点に整える | 本来の筋。ただし `data/` の変更なので User の判断が必要。サンプルデータを上流の年代規約に合わせる意味があるかという論点もある |

**この 1 件のためだけに merge を止める必要はない**。merge して `npm test` の失敗を見てから A/B を決める運用でも問題ない（テストの失敗は表示にも配布にも影響しない）。

### 4-2. `docs/deepl-localization.md` の `localize-proofread` 参照（10-12 からの持ち越し・再確認）

上流が Skill `localize-proofread` への参照を 2 箇所追加したが、`.claude/skills/**` は同期対象外。
中流の `.claude/skills/` には **`localize-en-draft` だけ**（今回も再確認済み）なので、取り込むとドキュメント内リンクが 2 本切れる。

`tests/docs.links.test.js` を読んだところ、**リンク先の実在確認はしていない**（`existsSync` / `statSync` を一切使わず、既知の誤りパス文字列の有無だけを見る軽量テスト）ので `npm test` では気づけない。

選択肢は 10-12 §3-3 と同じ 3 つで、**おすすめも変わらず「取り込んだうえで Skill を手動ミラー」**。
上流の `.agents/skills/localize-proofread/` が正典で `.claude/skills/` はその生成物なので、両方を中流へコピーすれば解決する。

### 4-3. `.sync/upstream.json` への提案（実装はしていない）

```jsonc
"exclude": [
  // …既存…
  "tests/meta.catalog.schema.test.js",   // §3: 上流の実データ更新ごとに必ずコンフリクト
  "tests/data.story-era.test.js"         // §4-1: 中流の data/ では通らない
]
```

`tests/meta.catalog.schema.test.js` を exclude するとカバレッジは減らない（データ非依存の 1 つ目の `it()` は残る）が、
そちらへの上流改善が降りてこなくなる点は 10-12 から変わらずトレードオフ。

---

## 5. 点検中に見つけて直したもの

`npm test` が **`tests/docs.links.test.js > does not contain known broken UI paths` で 1 件 fail** していた。
原因は **10-12 のレポート（`_work_in_progress/2026-10-12_upstream-sync.md`）の §3 で、誤りパスの例として
`pages/characters.html` の単数形（末尾 `s` 抜け）という誤りパスをリテラルでそのまま書いていた**こと。
`docs.links.test.js` はこの文字列を `_work_in_progress/` 配下まで含めて検知するので、
レポートが自分でテストを落としていた。

当該行を「`pages/characters.html` の単数形誤記」という言い回しに直し、`npm test` は **52 files / 769 tests すべて green** に戻した。
変更したのは先週のレポート本文 1 行だけで、`data/` にも `.sync/` にもコードにも触っていない。

**今後このレポートを書くときは、誤りパスをリテラルで書かないこと。**

---

## 6. 次にやるべき 1 手

```bash
cd "D:\VisualStudio Code Userfile\JsonCharacterDB-Framework"
git merge upstream/creationsdb
#   → tests/meta.catalog.schema.test.js でコンフリクト（1 件のみ・確定）
#      ローカル側（Works_Sample / EraGen: 1, YearInEra: 1 / InEra[2] = byRealYear 2020）を残す。
#      末尾の改行有無も差分に入っているので、改行は上流側（末尾改行あり）に合わせてよい。
git add tests/meta.catalog.schema.test.js
git commit
npm test
#   → tests/data.story-era.test.js が 2 件落ちる見込み（§4-1）。
#      §4-1 の A 案（exclude）か B 案（data/ 側で元年宣言）を選んで対応する。
```

merge 後は `docs/deepl-localization.md` のリンク切れ（§4-2）も残るので、
Skill `localize-proofread` を上流から手動ミラーするか判断してほしい。

中流を merge して push すると、下流 `RadianNs_SecondaryWorksDB` の未取り込みが 8 件から増える
（`lib/data-common.js` / `docs/api-sw-spec.md` / `docs/schema-meta-processing.md` / `pages/characters.*` が重複するので
実数は 8 → 14 前後）。下流は 3 週連続で未 merge なので、**下流を先に通してから中流を merge した方が差分は読みやすい**。

---

## 7. 未マージ PR（Dependabot）

| リポジトリ | PR | 内容 | 状態 |
| --- | --- | --- | --- |
| `JsonCharacterDB-Framework`（中流） | [#10](https://github.com/radiann-kswg/JsonCharacterDB-Framework/pull/10) | `dev-minor-patch` グループ: jsdom 30.1.0→30.1.2 / playwright 1.63.0→1.64.0 / vitest 5.0.1→5.0.3 | **2026-10-12 から 1 週間 open のまま**。上流は同等の更新（#41）を既に merge 済みなので、中流だけ遅れている |
| `100BeautiesLab_CreationsDB`（上流） | [#43](https://github.com/radiann-kswg/100BeautiesLab_CreationsDB/pull/43) | `dev-minor-patch` グループ: jsdom 30.1.2→30.1.3 / playwright 1.64.0→1.64.1 / vitest 5.0.3→5.0.5 | 本日（10-19）作成。放置ではない |
| `RadianNs_SecondaryWorksDB`（下流） | なし | — | `state=all` で PR が **1 件も作られたことがない**（3 週連続で 0 件）。Dependabot version updates が未有効のままと見られる |

中流 #10 は jsdom / playwright / vitest の dev 依存のみで本体コードに影響しない。
上流 #43 が入ると中流 #10 は上流より古くなるので、**#10 を merge してから上流 #43 を追う**のが素直。
