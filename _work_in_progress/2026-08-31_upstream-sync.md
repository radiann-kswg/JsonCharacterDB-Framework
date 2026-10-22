# 上流同期点検レポート — JsonCharacterDB-Framework（中流）

> **実コードの変更・commit・push は行っていない（読み取り専用の調査と提案のみ）。**
> `git merge` も `npm run sync:update` も実行していない。`data/` と `.sync/upstream.json` は 1 バイトも触っていない。

## 1. 点検サマリ

| 項目 | 値 |
| --- | --- |
| 点検日時 | 2026-08-31 10:13 JST |
| 上流 | `radiann-kswg/100BeautiesLab_CreationsDB` @ `develop` |
| 上流 SHA | `cc0aa87`（DB情報追加(絵チャット成果物類) / 2026-08-30） |
| 本リポジトリ SHA | `a53970b`（develop） |
| 同期対象ファイル数 | 185 |
| 差分あり | 31 件（M=15 / A=16） |
| 同期対象外の下流独自ファイル | 61 件（無視） |
| 実行コマンド | `npm run sync:check`（ネットワーク到達可・fetch 成功） |

### 差分の向きについて（重要）

`sync:check` の `M` は「内容が食い違っている」しか言わない。実際に `git diff upstream/develop:<path> <path>`
で中身を確認したところ、**M 15 件のうち上流が進んでいるのは 2 件だけ**で、残り 13 件は本リポジトリ側が
進んでいるか、フレームワーク化のために意図的に書き換えた箇所だった。
**素直に `git merge upstream/creationsdb` すると、これらが上流の内容で巻き戻る危険がある。**

---

## 2. 取り込むべき（上流のバグ修正・共通処理の改善）

| ファイル | 判断理由 |
| --- | --- |
| `lib/section-renders/vrmViewer.js` | 上流 CHANGELOG 2026-08-29「VRMビューアのカメラ中央フィットとサムネイル欠損フォールバック」の修正が未取り込み。バウンディングボックス中心へのカメラフィット（等身の低いモデルが沈む不具合）と、サムネイル 404 時に `.model-viewer__media` を畳むフォールバックの 2 点。上流も「下流影響: 本ファイルのみ・DOM構造と登録名は不変」と明記しており、副作用は無い。 |
| `tools/deepl/build-glossary-source.mjs` | 上流 CHANGELOG 2026-08-28「併記形（`/` 区切り）を位置対応ペアリング」。`猫又/化猫` ↔ `Nekomata / Warcat` のような対で訳語が先頭断片へ固定され、対が落ちていたバグの修正。断片数が一致しない場合は従来動作を維持しており後方互換。本リポジトリは `tools/deepl/**` を持つので対象。 |

以上 2 件。どちらも創作データに依存しない純粋なロジック修正なので、`npm test` を壊さない見込み。

---

## 3. 下流の意図的な差（取り込むと壊れる／巻き戻る）

### 3-1. 本リポジトリが上流より進んでいるもの

| ファイル | 判断理由 |
| --- | --- |
| `docs/deploy-howto.md` | 本リポジトリ `a53970b` で追加した「GitHub Pages の公開（オプトイン）」節（`ENABLE_PAGES` 変数）。上流には無い。上流版を取り込むと節ごと消える。 |
| `lib/data-common.js` | 表示セクションに `'sub'` を追加済み（`sectionOrder` と `pickDisplaySection`）。上流は `git log -S` で調べた限り一度も `'sub'` を持ったことがない。下流（RadianNs）にも同じ `'sub'` が入っており、フレームワーク側の拡張として定着している。 |
| `lib/wrapper-common.js` | `$Def_Day` の `year` ロール対応（`2026年8月31日` / `Aug.31, 2026`）。年を持たない誕生日宣言では空のまま、という fail-safe 付き。上流に無い。 |
| `pages/characters.js` | (a) グローバル `data/Dictionaries/` を持たない構成でも `$DefType` の有無でメタ判定できるフォールバック（＝フレームワーク／二次創作 DB 向けの一般化）、(b) `conceptAlt` / `designAlt` / `arts` / `corefolder` / `catalog` の各 PNG 解決で空配列・空文字を弾く `undefined.png` 参照バグの防止。いずれも上流に無い。 |
| `tests/graph.crossing.test.js` / `tests/graph.hexfill.test.js` | 本リポジトリ `a517969` で入れた CI 用の wall-clock 予算（`process.env.CI ? 1200 : 300` / `? 300 : 60`）。上流は固定値のままなので、取り込むと CI で再びフレーキーになる。 |

### 3-2. 創作データを持たない設計に合わせた差

本リポジトリは `data/` に `Works_Sample` しか持たない（CC BY-NC 4.0・創作データなし）。
以下は上流の実データ（`Works_NumberTales` 等）参照をサンプルへ差し替えた／実データ不変条件ブロックを落とした差分で、
**取り込むと `npm test` が確実に落ちる。**

| ファイル | 判断理由 |
| --- | --- |
| `tests/extract-palette.test.js` | サンプル PNG のパスを `Works_NumberTales/.../emstk_corefolderNTS-1-1.png` → `Works_Sample/.../alpha.png` に差し替え済み。実データ前提のケースは削除済み。 |
| `tests/meta.catalog.schema.test.js` | 参照先を `Works_Sample` に差し替え、`EraGen: 9 / byRealYear: 2050` → `1 / 2020` とサンプル値へ変更済み。 |
| `tests/sw.enrich.basic.test.js` | 同上（`Works_NumberTales/DataBases/db_meta.json` → `Works_Sample/...`）。 |
| `tests/data.image-links.test.js` | 走査件数の下限を `>500` → `>0` に緩和済み（サンプル 1 作品では 500 件に届かない）。 |
| `tests/graph.badge.test.js` | 末尾の `describe('実データ不変条件')`（全 9 作品の `Works_Code` / NumberTales の `Num_Badge` 検査、約 94 行）を削除済み。 |
| `tests/graph.facets.test.js` | 同じく `describe('実データ不変条件')`（約 117 行）を削除済み。加えて辞書ファイル名を `sec_DesignedBy.json` → `dict_sec_DesignedBy.json` に修正済み（本リポジトリの命名が正）。 |
| `docs/fork-sync.md` | 上流版は「最上流としての責務」を書いた別文書。本リポジトリ版は同期機構の正典（ベンダーブランチ方式・手順・マニフェスト仕様）で、意図的に内容が違う。上流版で上書きしてはいけない。 |

---

## 4. 要相談（破壊的変更・判断が割れるもの）

| 対象 | 判断理由 |
| --- | --- |
| 上流の新規テスト 16 件（`A`）のうち 13 件 | `commons.secondaries` / `data.shape` / `enrich.dblink.jump.merge` / `enrich.index-alias-dict` / `enrich.indexdef.perdb` / `keyedDialogue.render` / `legacy-work-alias` / `migrate-common` / `pages.characters.ui-output` / `pages.characters.url-params` / `pkg.nodejs` / `private-commons-order` / `section-renders.relation` は `Works_NumberTales` 等の実データ参照を含む（多いもので `pages.characters.ui-output.test.js` が 92 箇所 / 1719 行）。**そのまま取り込むと `npm test` が全滅する。** 選択肢は (a) `Works_Sample` 前提に書き換えて取り込む、(b) `.sync/upstream.json` の `exclude` へ追加して恒久的に除外、の 2 つ。書き換え量が大きいので User 判断が要る。 |
| 上流の新規テスト 3 件（`A`）| `tests/baseArea.render.test.js`（116 行）/ `tests/data.bodypart-enum.test.js`（85 行）/ `tests/faction.render.test.js`（219 行）は実データ参照 0 件で、グローバル `data/db_type.json` 等しか見ない。**取り込める可能性が高い**が、`Works_Sample` の宣言内容次第で落ちうるので、取り込み後に `npm test` で要確認。 |
| `lib/data-common.js` の `'sub'` セクション | 本リポジトリと RadianNs にはあり、最上流には無い。一方向フローの原則からすると**最上流に無いのは事故**の可能性がある。最上流へ手戻しするか、フレームワーク限定の拡張として `docs/fork-sync.md` に明記するか、User に決めてほしい。 |
| `tests/graph.crossing` / `graph.hexfill` の CI 予算 | 同様に本リポジトリだけが持つ修正。最上流でも同じフレーキーが起きるはずなので、最上流へ入れて流し直すのが原則（`docs/fork-sync.md` §1）。 |
| 上流 open PR: [100BeautiesLab_CreationsDB #29](https://github.com/radiann-kswg/100BeautiesLab_CreationsDB/pull/29) | `glob` 11.1.0 → 13.0.6。2026-08-31 00:16 UTC 作成。本リポジトリは PR #2 で既に `^13.0.6` に上げ済み（`engines.node >=22.19.0`）。最上流は `d7d6dda`「merge-conflict duplicates の解消」で `^11.1.0` に戻ってしまったと思われ、Dependabot が再提案している。`package.json` は同期対象外なので本リポジトリへの影響は無いが、**最上流側で取りこぼしが起きている**ので指摘しておく。 |

### 未マージ PR 一覧（`radiann-kswg` 3 リポジトリ / open）

| リポジトリ | # | 内容 | 作成 | 状態 |
| --- | --- | --- | --- | --- |
| 100BeautiesLab_CreationsDB | 29 | chore(deps-dev): bump glob 11.1.0 → 13.0.6 | 2026-08-31 | 放置ではないが、8/26 に一度マージした内容の再提案（前述の巻き戻り疑い） |
| JsonCharacterDB-Framework | — | open PR なし | — | — |
| RadianNs_SecondaryWorksDB | — | open PR なし | — | private リポジトリのため Dependabot の定期更新 PR が出ていない可能性がある（`.github/dependabot.yml` は存在する）。`jsdom ^26.1.0` / `glob ^11.1.0` と 2 リポジトリより古いままなので、要確認 |

---

## 5. `.sync/upstream.json` への提案（未適用）

現行の `exclude` には `tools/deepl/**` が入っていない一方、上流の実データ前提テストを弾く仕組みが無い。
§4 で (b) を選ぶ場合、以下の追加を提案する（**このレポートは提案までで、ファイルは書き換えていない**）。

```jsonc
"exclude": [
  // ... 既存 ...
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
  "tests/section-renders.relation.test.js"
]
```

なお `.sync/upstream.json` の不変則「ツールを exclude したらそのツールのテストも exclude する」に照らすと、
上記はいずれもツール本体ではなくテスト単体の除外なので、対になるツールの除外は不要。

---

## 6. 次にやるべき 1 手

**`lib/section-renders/vrmViewer.js` の上流修正だけを cherry-pick 相当で手取り込みし、`npm test` を通す。**

`git merge upstream/creationsdb` は §3 の 13 ファイルを巻き戻すリスクがあるため、まだ実行しない。
まず影響が本ファイル 1 つに閉じている VRM ビューアの修正（カメラ中央フィット + サムネイル 404 フォールバック）を
`git show upstream/develop:lib/section-renders/vrmViewer.js` から手で当て、`npm test` が通ることを確認する。
そこまで済んだら §4 の新規テスト 16 件の扱い（書き換え取り込み or `exclude` 追加）を決め、その後に
`npm run sync:update` → `git merge` へ進むのが安全。
