# 上流同期点検レポート — JsonCharacterDB-Framework（中流）

> **実コードの変更・commit・push は行っていない（読み取り専用の調査と提案のみ）。**
> `git merge` も `npm run sync:update` も実行していない。`data/` と `.sync/upstream.json` は 1 バイトも触っていない。

## 1. 点検サマリ

| 項目 | 値 |
| --- | --- |
| 点検日時 | 2026-09-07 10:16 JST |
| 上流 | `radiann-kswg/100BeautiesLab_CreationsDB` @ `develop` |
| 上流 SHA | `74cfc58`（Merge PR #31: vitest 5.0.0 / 2026-09-07） |
| 本リポジトリ SHA | `a53970b`（develop / 2026-08-26 から進んでいない） |
| 同期対象ファイル数 | 189 |
| 差分あり | 46 件（M=26 / A=20） |
| 同期対象外の下流独自ファイル | 61 件（無視） |
| 実行コマンド | `npm run sync:check`（ネットワーク到達可・fetch 成功） |
| 前回点検 | [`2026-08-31_upstream-sync.md`](./2026-08-31_upstream-sync.md)（上流 `cc0aa87` / 差分 31 件） |

### 前回（8/31）からの変化

上流が `cc0aa87` → `74cfc58` へ 1 週間分進み、差分は **31 件 → 46 件**に増えた。
増分は上流の 3 つの機能追加と 1 つのバグ修正で、内訳は §2 のとおり。
**前回「取り込むべき」と判定した 2 件（`vrmViewer.js` / `build-glossary-source.mjs`）は未着手のまま残っている。**
本リポジトリ側は 8/26 の `a53970b` から 1 コミットも進んでいない。

### 差分の向きについて（重要・前回から変わらず）

`sync:check` の `M` は「内容が食い違っている」しか言わない。実際に中身を読むと、
**M 26 件のうち上流が進んでいるのは 12 件**で、残り 14 件は本リポジトリ側が進んでいるか、
フレームワーク化のために意図的に書き換えた箇所だった。
素直に `git merge upstream/creationsdb` すると、これらが上流の内容で巻き戻る。

なお `lib/data-common.js` と `pages/characters.js` は**今回から両方向の差分を同時に含む**
（上流の画像ディレクトリ修正 ＋ 本リポジトリ独自の一般化）。merge すればコンフリクトマーカーが出る 2 本なので、
手作業での取り込みが要る。

---

## 2. 取り込むべき（上流のバグ修正・共通処理の改善）

| ファイル | 判断理由 |
| --- | --- |
| `lib/section-renders/vrmViewer.js` | **前回から未着手。** 上流 CHANGELOG 2026-08-29 の修正。バウンディングボックス中心へのカメラフィット（等身の低いモデルが沈む不具合）と、サムネイル 404 時に `.model-viewer__media` を畳むフォールバック。影響は本ファイル 1 つに閉じており、DOM 構造と登録名は不変。 |
| `tools/deepl/build-glossary-source.mjs` | **前回から未着手。** 上流 CHANGELOG 2026-08-28。`猫又/化猫` ↔ `Nekomata / Warcat` のような併記形を位置対応でペアリングする修正。断片数が一致しない場合は従来動作を維持するため後方互換。 |
| `lib/data-common.js`（`mapDbNameToImageDir` のみ） | 上流 CHANGELOG 2026-09-07 のバグ修正。`refMapping` が `#Ref_Glossary` → `#Ref_Vocabulary` の改名に追従しておらず、References の画像が存在しない `DB_Vocabulary/` へ解決されていた。あわせて接頭辞素通し判定に `Loc_` を追加し、既定補完と同値だった死にコード `dbMapping`（9 エントリ）を削除。**本リポジトリの `data/Works_Sample` は既に `ref_Vocabulary.json` を採用しているため、この修正が無いとサンプルデータの References 画像が引けない。** ただし同ファイルは §3-1 の `'sub'` 拡張を持つので、ファイル丸ごとの上書きは不可。 |
| `pages/characters.js`（`mapDbNameToImageDir` のみ） | 同上の UI 側。`dbMapping` 削除と `Glossary` → 記述の更新。こちらも §3-1 の独自差分と同居しているため部分取り込み。 |
| `lib/viewer-locator.js` | 新機能「短縮リンク `?b=NTS-57`」の文法（`SHORT_LOCATOR_PARAM` / `parseShortLocator()` / `buildShortQueryString()`）。**既存関数は無変更の純粋な API 追加**で、DOM 非依存。対になる `tests/lib.viewer-locator.test.js` の追加分も往復テストのみで実データを見ない。 |
| `lib/relations-locator.js`（新規 `A` / 75 行） | 相関図の圧縮ロケータ `?r=NTS/100BL` の文法。DOM 非依存の純関数モジュールで、対になる `tests/lib.relations-locator.test.js`（`A`）も実データ参照 0 件。**この 2 本はセットで取り込めば `npm test` を壊さない。** |
| `lib/graph/graph-facets.js` | 上記 `r=` のための `codeFrom`（辞書行の列名）宣言の読み取り。宣言が無ければ空文字へフォールバックするだけの後方互換な追加。 |
| `lib/section-renders/specStats.js` | 上流 CHANGELOG 2026-09-02。`SpecLevel` を `EffectStats` / `SafetyLevel` と同じタググリッドへ描くようにした汎用側の取りこぼし修正。既存ヘルパー `buildSingleLeafTag()` の再利用のみで新規レンダラーは無い。 |
| `pages/relations.js` / `pages/relations.html` | `r=` ロケータの実装本体と `asset-version` 更新。旧 `m` / `d` は読み取り互換を保つ。あわせて `loadAll()` が同名 `#List_*` を後勝ちで潰していたバグ（グローバル辞書が作品側に隠れる）の修正が入っている。 |
| `docs/relations-graph.md` / `docs/wrapper-summary-registry.md` / `docs/schema-meta-processing.md` / `pkg/cloudflare/schema/d1-init.sql` | 上記コード変更に対応するドキュメント・コメントの追従（`#Ref_Glossary` → `#Ref_Vocabulary` の例示更新を含む）。単独では壊れようがない。 |

---

## 3. 下流の意図的な差（取り込むと壊れる／巻き戻る）

### 3-1. 本リポジトリが上流より進んでいるもの

前回 8/31 から変化なし。**上流に手戻しすべき候補**でもある（§4）。

| ファイル | 判断理由 |
| --- | --- |
| `docs/deploy-howto.md` | 本リポジトリ `a53970b` で追加した「GitHub Pages の公開（オプトイン）」節（`ENABLE_PAGES` 変数）。上流には無く、上流版を取り込むと節ごと消える。 |
| `lib/data-common.js` | 表示セクション `'sub'`（`sectionOrder` と `pickDisplaySection`）。上流は一度も持ったことがない。下流 RadianNs にも同じ `'sub'` があり、フレームワーク側の拡張として定着している。 |
| `lib/wrapper-common.js` | `$Def_Day` の `year` ロール対応（`2026年8月31日` / `Aug.31, 2026`）。年を持たない誕生日宣言では空のまま、という fail-safe 付き。上流に無い。 |
| `pages/characters.js` | (a) グローバル `data/Dictionaries/` を持たない構成でも `$DefType` の有無でメタ判定できるフォールバック（フレームワーク／二次創作 DB 向けの一般化）、(b) `conceptAlt` / `designAlt` / `arts` / `corefolder` / `catalog` の PNG 解決で空配列・空文字を弾く `undefined.png` 参照バグの防止、(c) ヒーロー帯 pill の二重表示抑止を `$DetailLayout.headerPills` 宣言駆動にした一般化（上流は `Progress` 決め打ち）。いずれも上流に無い。 |
| `tests/graph.crossing.test.js` / `tests/graph.hexfill.test.js` | 本リポジトリ `a517969` で入れた CI 用 wall-clock 予算（`process.env.CI ? 1200 : 300` / `? 300 : 60`）。上流は固定値のままなので、取り込むと CI で再びフレーキーになる。 |

### 3-2. 創作データを持たない設計に合わせた差

本リポジトリは `data/` に `Works_Sample` しか持たない（CC BY-NC 4.0・創作データなし）。
以下は上流の実データ参照をサンプルへ差し替えた／実データ不変条件ブロックを落とした差分で、
**取り込むと `npm test` が確実に落ちる。**

| ファイル | 判断理由 |
| --- | --- |
| `tests/extract-palette.test.js` | サンプル PNG パスを `Works_NumberTales/.../emstk_corefolderNTS-1-1.png` → `Works_Sample/.../alpha.png` に差し替え済み。 |
| `tests/meta.catalog.schema.test.js` | 参照先を `Works_Sample` へ、`EraGen: 9 / byRealYear: 2050` → `1 / 2020` とサンプル値へ変更済み。 |
| `tests/sw.enrich.basic.test.js` | 同上（`Works_NumberTales/DataBases/db_meta.json` → `Works_Sample/...`）。 |
| `tests/data.image-links.test.js` | 走査件数の下限を `>500` → `>0` に緩和済み（サンプル 1 作品では 500 件に届かない）。 |
| `tests/graph.badge.test.js` | 末尾の `describe('実データ不変条件')`（全 9 作品の `Works_Code` / `Num_Badge` 検査）を削除済み。 |
| `tests/graph.facets.test.js` | 同じく `describe('実データ不変条件')` を削除済み。加えて辞書ファイル名を `sec_DesignedBy.json` → `dict_sec_DesignedBy.json` に修正済み（本リポジトリの命名が正）。**ただし今回の上流差分には `codeFrom` の単体テスト追加も含まれる**ので、その 1 ブロックだけは §2 の `graph-facets.js` と一緒に手で足すのが望ましい。 |
| `docs/fork-sync.md` | 上流版は「最上流としての責務」を書いた別文書。本リポジトリ版は同期機構の正典（ベンダーブランチ方式・手順・マニフェスト仕様）。上流版で上書きしてはいけない。 |
| `pages/characters.html` | `asset-version` と短縮リンクボタン（`#btn-copy-short`）の追加は §2 側だが、取り込むなら `pages/characters.js` の `loadBadgeContext()` / `resolveShortLocator()` / `wireControls()` 追加と**必ずセット**にすること。HTML だけ入れるとボタンが無反応になる。 |

---

## 4. 要相談（破壊的変更・判断が割れるもの）

| 対象 | 判断理由 |
| --- | --- |
| 上流の新規テスト 20 件（`A`）のうち 16 件 | `baseArea.render` / `commons.secondaries` / `data.shape` / `enrich.dblink.jump.merge` / `enrich.index-alias-dict` / `enrich.indexdef.perdb` / `faction.render` / `image-dir-mapping` / `keyedDialogue.render` / `legacy-work-alias` / `migrate-common` / `pages.characters.ui-output` / `pages.characters.url-params` / `pkg.nodejs` / `private-commons-order` / `section-renders.relation` は上流の実データ（`Works_NumberTales` 等）を前提とする。**そのまま取り込むと `npm test` が全滅する。** 選択肢は (a) `Works_Sample` 前提に書き換えて取り込む、(b) `exclude` へ追加して恒久除外の 2 つ。書き換え量が大きいので User 判断が要る。 |
| `tests/image-dir-mapping.test.js`（新規 `A`） | **前回は無かった新顔で、特に判断が要る 1 本。** `expect([...refDbsWithImages].sort()).toEqual(['Reference', 'Vocabulary'])` と上流の実データ集合をハードコードしている。本リポジトリの `Works_Sample` は `ref_Vocabulary.json` を持つが `ref_Reference.json` を持たないため、**取り込めば確実に赤くなる。** 一方でこのテストが守っている不変条件（例外表と実データのズレ検出）は本リポジトリでも意味があるので、`Works_Sample` 前提に書き換える価値はある。 |
| 上流の新規テスト 4 件（`A`） | `tests/data.bodypart-enum.test.js` / `tests/data.facet-codes.test.js` / `tests/lib.relations-locator.test.js` の 3 件は実データ作品名の参照が 0 件。特に `lib.relations-locator` は純粋なユニットテストで安全。`data.bodypart-enum` は `data/db_meta.json` の `$EnumDef_DesignBodyPart` を読むが**本リポジトリにも宣言がある**ので通る見込み。`data.facet-codes` は `codeFrom` 未宣言なら素通りする見込み。いずれも取り込み後に `npm test` で要確認。 |
| `lib/data-common.js` の `'sub'` セクション / `pages/characters.js` の 3 つの一般化 / `graph.crossing`・`graph.hexfill` の CI 予算 | **前回から進展なし。** 本リポジトリと RadianNs にはあり、最上流には無い。一方向フローの原則（`docs/fork-sync.md` §1）からすると最上流へ手戻しすべき。特に `pages/characters.js` の `undefined.png` 防止は**最上流にも同じバグが残っている**はずで、放置すると上流の画像解決が壊れ続ける。 |
| 未マージ PR: [JsonCharacterDB-Framework #4](https://github.com/radiann-kswg/JsonCharacterDB-Framework/pull/4) | `vitest` 4.1.11 → **5.0.0**（メジャー）。2026-09-07 00:17 UTC 作成で放置ではない。最上流は同内容の PR #31 を今日マージ済み（`74cfc58`）で既に `^5.0.0`。`package.json` は同期対象外なので merge の可否には影響しないが、上流の新規テストを取り込むなら**先にこの PR を通して vitest を揃えておくほうが安全**。 |

### 未マージ PR 一覧（`radiann-kswg` 3 リポジトリ / open）

| リポジトリ | # | 内容 | 作成 | 状態 |
| --- | --- | --- | --- | --- |
| JsonCharacterDB-Framework（本リポジトリ） | [4](https://github.com/radiann-kswg/JsonCharacterDB-Framework/pull/4) | chore(deps-dev): bump vitest 4.1.11 → 5.0.0 | 2026-09-07 | 当日作成。放置ではないがメジャー更新なので `npm test` 確認のうえで判断 |
| 100BeautiesLab_CreationsDB（最上流） | — | open PR なし | — | 前回指摘の #29（glob 巻き戻り）は解消済み |
| RadianNs_SecondaryWorksDB（下流） | — | open PR なし | — | `jsdom ^26.1.0` / `glob ^11.1.0` と古いまま。private リポジトリで Dependabot version updates が動いていない疑いは前回から未解消 |

---

## 5. `.sync/upstream.json` への提案（未適用）

前回の提案（実データ前提テスト 13 件の `exclude` 追加）は未適用のまま。今回の増分を踏まえ、以下を加えたい。
**このレポートは提案までで、ファイルは書き換えていない。**

```jsonc
"exclude": [
  // ... 既存 ...

  // 上流の実データ（Works_NumberTales 等）を前提とするテスト
  "tests/commons.secondaries.test.js",
  "tests/data.shape.test.js",
  "tests/enrich.dblink.jump.merge.test.js",
  "tests/enrich.index-alias-dict.test.js",
  "tests/enrich.indexdef.perdb.test.js",
  "tests/keyedDialogue.render.test.js",
  "tests/legacy-work-alias.test.js",
  "tests/migrate-common.test.js",
  "tests/pages.characters.ui-output.test.js",
  "tests/pages.characters.url-params.test.js",
  "tests/pkg.nodejs.test.js",
  "tests/private-commons-order.test.js",
  "tests/section-renders.relation.test.js",
  "tests/image-dir-mapping.test.js",   // ← 今回追加分（Works_Sample 前提に書き換えるなら不要）

  // 本リポジトリ側で意図的に書き換え済み（上流版で上書きされると壊れる）
  "docs/fork-sync.md",
  "docs/deploy-howto.md"
]
```

`docs/fork-sync.md` / `docs/deploy-howto.md` の 2 本は前回から「毎回 `M` として出続けるが取り込んではいけない」
状態が続いている。点検のノイズになっているので、`exclude` へ入れて恒久的に外すことを提案する。

また、マニフェストの `$comment` にある不変則「ツールを exclude したらそのツールのテストも exclude する」に照らすと、
上記はいずれもテスト単体・ドキュメント単体の除外なので、対になるツールの除外は不要。

### もう 1 点（構造の話）

`git branch --list 'upstream/*'` の結果が空で、**ベンダーブランチ `upstream/creationsdb` はまだ 1 度も作られていない**。
つまり `docs/fork-sync.md` §5 の「初回の履歴接ぎ木」が未実施で、次に `npm run sync:update` を打つと
2 択のプロンプトが出る。§3 の 14 ファイルを守るなら **A 案（`git merge -s ours --allow-unrelated-histories`）** を選び、
そのうえで §2 の内容を手で当てていくのが安全。

---

## 6. 次にやるべき 1 手

**`lib/section-renders/vrmViewer.js` の上流修正を手で当て、`npm test` を通す。**

前回（8/31）に同じことを勧めてから 1 週間動いていない。これは影響が本ファイル 1 つに閉じており、
`data/` にも `.sync/` にも触らず、merge も要らない**最も安全で最も小さい 1 手**。

```sh
git show upstream/develop:lib/section-renders/vrmViewer.js > lib/section-renders/vrmViewer.js
npm test
```

これが通ったら、次は同じ要領で `tools/deepl/build-glossary-source.mjs`
→ `lib/relations-locator.js` + `tests/lib.relations-locator.test.js`（新規 2 本セット）と進める。
`lib/data-common.js` / `pages/characters.js` の部分取り込みと、§4 の新規テスト 16 件の扱い（書き換え or `exclude`）を
決めるまでは、`npm run sync:update` → `git merge` へ進まないこと。

---

## 7. 適用結果（同日 追記）

§1〜§6 の提案を実行した。詳細は `CHANGELOG.md` の「Synced (2026-09-07)」。

- ベンダーブランチは §5 の A 案ではなく、**フォーク元 `e11412c` でベンダーブランチを作って `-s ours` で接ぎ、そのうえで `74cfc58` まで進めて 3-way merge** した。§2 の全項目が自動で入り、§3 の 14 ファイルはコンフリクトなしで温存された（手当ては不要だった）。
- §4 の新規テスト 16 本＋`tests/image-dir-mapping.test.js`＋`tests/data.facet-codes.test.js`（`Class:Class_Code` を実データに要求）は `exclude` へ。`tests/data.bodypart-enum.test.js` は中流でも通るので取り込んだ。
- `vitest ^5.0.0`（PR #4 と同内容 → push 後に PR #4 はクローズしてよい）。51 ファイル 767 件 green。
- `sync:check` の残差分 12 件はすべて §3-1 / §3-2 の意図的な差。
- **未 push**（6 コミット）。push 順は 中流 → 下流。
