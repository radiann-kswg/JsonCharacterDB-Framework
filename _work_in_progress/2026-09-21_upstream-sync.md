# 上流同期点検レポート — JsonCharacterDB-Framework（中流）

**`git merge` と `data/` の変更は行っていない（`sync:update` までの読み取り中心の調査と提案）。**
実行したのは `npm run sync:check` / `npm run sync:update`（ベンダーブランチの更新）／ `npm test`（現状確認）と、
読み取り系の git コマンドのみ。`develop` への取り込みとコンフリクト解決は User の判断。
`.sync/upstream.json` も 1 バイトも触っていない（変更提案は §5 に記載）。

---

## 1. 点検サマリ

| 項目 | 値 |
| --- | --- |
| 点検日時 | 2026-09-21 10:12 JST |
| 上流 | `radiann-kswg/100BeautiesLab_CreationsDB` @ `develop` |
| 上流 SHA | `5e8fc7e`（画像サイズ修正（ナンバーテールズ） / 2026-09-17〜） |
| 本リポジトリ SHA | `4709f77`（`develop`） |
| 比較基準 | 取り込み済みベンダーコミット `2f5e3b2`（上流 `74cfc58`） |
| 同期対象ファイル数 | 174 |
| 未取り込み | **23 件**（M=19 / A=4 / D=0） |
| 実行コマンド | `npm run sync:check`（ネットワーク到達可）→ `npm run sync:update` |
| ベンダーブランチ | `upstream/creationsdb` を `2f5e3b2` → **`1676e3f`** へ更新済み |
| merge 前のテスト | `npm test` = **51 files / 767 tests すべて green**（15.6s） |
| 前回点検 | [`2026-09-14_upstream-sync.md`](./2026-09-14_upstream-sync.md) |

比較基準は `HEAD` ではなく取り込み済みベンダーコミット `2f5e3b2` と出ており、
**2026-09-07 の接ぎ木は正常に効いている**（前回 2026-09-14 の点検から基準は動いていない ＝ 前回の分もまだ未 merge）。

> **前回 16 件が今回 23 件に増えているのは、前回レポートの 16 件がまだ `develop` へ merge されていないため。**
> 今回の 23 件は「前回の 16 件 ＋ 2026-09-14〜09-17 の新規分」であり、別件が二重に溜まっているわけではない。

### 下流 `RadianNs_SecondaryWorksDB`

`sync:check` = **0 件 / exit 0**（上流 `JsonCharacterDB-Framework` @ `4709f77`、比較基準 `8ad2036`、同期対象 75 ファイル）。
手順どおり点検はここで終了、レポートは作成していない。
ただし §4 のとおり、**本リポジトリが merge した時点で 14 件が下流へ降りる**（うち 2 件は下流でもテストを壊す）。

---

## 2. 上流で何が起きたか

未取り込みの 26 コミットのうち、同期対象に触れたものは **4 テーマ**に収束している。

| テーマ | 上流コミット | 内容 |
| --- | --- | --- |
| A. 獣爾騎兵の改名追従 | `5c4fa4c` `43161e2` `367a9dd` `908e64c` | `ShouArRiders` → `ShauErRiders` 全改名と、旧綴り別名解決を viewer / SW / API / 4 クライアントへ横展開 |
| B. ロールプレイプロンプト強化 | `96372d1` `6cb712e` | `$enrich: true` の `*_DBLink` から不足フィールドを補填 |
| C. キャッシュ掃除ツール | `38cf84a` | `.cache/` の保守ユーティリティを新規実装 |
| D. 綴り統一（コメント/docs） | 上記に付随 | コード内コメント・ドキュメントの `ShouArRiders` → `ShauErRiders` 置換のみ。挙動不変 |

テーマ A は上流 CHANGELOG（2026-09-12 / 2026-09-14）の「**下流への申し送り**」に
「エイリアス表は 7 ファイルへ独立に書かれているため、追加・変更時は同時更新すること」と明記されている。
今回の 23 件のうち 12 件がこの A に属する。

---

## 3. 差分ファイルの判断（23 件）

### 3-1. 取り込むべき（21 件）

上流のバグ修正・共通処理の改善。本リポジトリ側に意図的な差分と重なる行は無く、3-way merge はクリーンに通る見込み。

| ファイル | 種別 | なぜそう判断したか |
| --- | --- | --- |
| `lib/sw-common.js` | M | `DataUtils.toWorkKey()` に旧綴り別名を適用。API 404 バグの根治で、シグネチャ不変。本リポジトリのローカル差分なし |
| `lib/data-common.js` | M | `normalizeLegacyWorkKey()` 新設。本リポジトリのローカル差分（`'sub'` セクション追加）は L1629 / L2438 付近で、上流差分は L16-40 / L300 / L473 付近 — **行が完全に離れており衝突しない** |
| `lib/viewer-locator.js` | M | `parseViewerLocator()` の `work` を常に `workKeyForURL()` 経由にする整理。別名表を抜きにしても正規化の一貫性として妥当 |
| `pages/characters.js` | M | `getQS()` / `normalizeWorkKey()` を `workKeyForURL()` ベースへ統一。ローカル差分 3 箇所（L998 / L5166-5240 / L6742）はいずれも上流差分（L95 / L529 / L680 / L4372）と重ならない |
| `pkg/cloudflare/worker.js` | M | `toWorkKey()` へ別名適用。宣言位置の是正も含む。ローカル差分なし |
| `pkg/nodejs/index.mjs` | M | 同上（`LEGACY_WORK_ID_ALIASES` 追加）。4 クライアントのパリティ維持に必要 |
| `pkg/python/creationsdb/client.py` | M | PR #34 レビュー指摘の修正。Python だけ旧ディレクトリを読む分岐を解消 |
| `pkg/csharp/CreationsDBClient.cs` | M | 同上（C# 側） |
| `tools/clean-cache.mjs` | A | `.cache/` の期限切れエントリ掃除。plan がデフォルトで `--write` 時のみ削除。本リポジトリも `.cache/` 運用なので有用。依存なし |
| `tests/clean-cache.test.js` | A | `statTree` の単体テスト。`os.tmpdir()` 上で完結し `data/` に非依存 — **本リポジトリで安全に通る** |
| `tools/build-roleplay-prompts.mjs` | M | enrich 補填機能（+140 行）。本リポジトリも `roleplay:plan/write/check` スクリプトで使用。対応テスト `tests/data.roleplay-prompts.test.js` は exclude 済みなので `npm test` には影響しない |
| `tests/sw.datafetcher-memo.test.js` | M | スタブ上の URL 文字列を改名に追従させただけ。実データ非依存 |
| `docs/roleplay-prompt-generation.md` | M | 上記ツール変更のドキュメント追従 |
| `docs/pkg-client-libraries.md` | M | エイリアス表の記述追加と改訂履歴 1 行 |
| `docs/localization-en-rules.md` | M | 表中の綴り 2 箇所 |
| `docs/wrapper-summary-registry.md` | M | 説明文中の綴り 1 箇所 |
| `pkg/mcp/README.md` | M | 説明文中の綴り |
| `pkg/mcp/server.mjs` | M | ツール description 文字列中の綴り。挙動不変 |
| `lib/basic-renders/type-common.js` | M | コメント中の例示 1 行 |
| `lib/graph/graph-badge.js` | M | コメント表中の 1 行 |
| `lib/section-renders/specStats.js` | M | ヘッダコメント 1 行 |

### 3-2. 要注意（2 件）— **merge するとテストが落ちる**

どちらも新規テストで、**上流の創作データ（`Works_ShauErRiders`）の実在を前提にしている**。
本リポジトリは `data/` に `Works_Sample` しか持たず、`db_meta.json` の `CreationWorks` も `#Works_Sample` のみ。

| ファイル | 種別 | なぜそう判断したか |
| --- | --- | --- |
| `tests/pkg.client-alias-parity.test.js` | A | `it("ディレクトリエイリアスの解決先が data/ に存在する")` が `data/Works_DestinyFoxRecords` と `data/Works_ShauErRiders` の実在を要求。`it("作品IDエイリアスの解決先が db_meta.json の CreationWorks に存在する")` も `#Works_ShauErRiders` を要求 — **本リポジトリでは 3 アサーションが確実に失敗する** |
| `tests/legacy-shauer-work-alias.test.js` | A | 前半 3 ブロック（sw-common / data-common / worker）はスタブ上で完結し通るが、末尾の `describe('data: 旧英名 "Shou-Ar Riders" の残存なし')` が `data/Works_ShauErRiders/DataBases/db_Primary.json` を `readFileSync` する — **ENOENT で失敗する** |

**検証済み**（読み取りのみ・merge はしていない）:

```
--- parity: ディレクトリ解決先が data/ に実在するか ---
   Proxies      -> data/Works_DestinyFoxRecords  *** NG (存在しない)
   ShouArRiders -> data/Works_ShauErRiders        *** NG (存在しない)
--- parity: 作品IDエイリアス解決先が CreationWorks にあるか ---
   ShouArRiders -> #Works_ShauErRiders            *** NG (存在しない)
--- legacy-shauer: db_Primary.json 実在するか ---
   data/Works_ShauErRiders/DataBases/db_Primary.json  *** NG (存在しない)
```

これは `.sync/upstream.json` の `$comment` が既に言っているパターンそのもの
（「`tests/` の後半ブロックは上流の実データを前提とするテストで、`Works_Sample` しか持たない本リポジトリでは通らないため除外」）。
既存の `tests/legacy-work-alias.test.js`（Proxies 版）が exclude 済みなのと同じ理由で、**この 2 件も exclude が妥当**。
対応するツール／ライブラリ側（3-1 の `lib/**` `pkg/**`）は取り込んで問題ない。

### 3-3. 要相談（1 件）

| 項目 | 内容 |
| --- | --- |
| `tools/clean-cache.mjs` の npm script | 上流は `package.json` に `cache:clean` / `cache:clean:write` を追加しているが、**`package.json` は同期対象外**（`include` に無い）ため降りてこない。ツール本体だけ入って呼び出し口が無い状態になる。merge 後に本リポジトリの `package.json` へ手で 2 行足すか、`node tools/clean-cache.mjs` 直叩き運用にするかは User 判断 |

---

## 4. 下流 `RadianNs_SecondaryWorksDB` への波及

本リポジトリが merge すると、下流の `include`（`docs/** lib/** pages/** tests/** tools/** .gitattributes vitest.config.js`）と
`exclude` を通過した **14 件**が次回 `sync:check` で下流に出る。

| 下流へ降りる（14 件） | 下流に降りない（9 件） |
| --- | --- |
| `docs/roleplay-prompt-generation.md` / `docs/wrapper-summary-registry.md` | `docs/localization-en-rules.md`（exclude 済み） |
| `lib/basic-renders/type-common.js` / `lib/data-common.js` / `lib/graph/graph-badge.js` | `docs/pkg-client-libraries.md`（exclude 済み） |
| `lib/section-renders/specStats.js` / `lib/sw-common.js` / `lib/viewer-locator.js` | `pkg/**` 5 件（下流は `pkg/` ディレクトリ自体を持たない） |
| `pages/characters.js` | `tools/build-roleplay-prompts.mjs`（exclude 済み） |
| `tests/clean-cache.test.js` / `tests/sw.datafetcher-memo.test.js` / `tools/clean-cache.mjs` | |
| **`tests/legacy-shauer-work-alias.test.js`** / **`tests/pkg.client-alias-parity.test.js`** | |

**下流では 3-2 の 2 件がさらに深刻**:
下流の `data/` は `Works_SecondaryArts` / `Works_Corefolders` / `Works_DeformingAndShapeChanging` の 3 作品のみで、
かつ **`pkg/` ディレクトリが存在しない**。`tests/pkg.client-alias-parity.test.js` は
`pkg/nodejs/index.mjs` / `pkg/python/creationsdb/client.py` / `pkg/csharp/CreationsDBClient.cs` を
`readFileSync` するため、アサーション以前に**ファイル読み取りで落ちる**。

→ 本リポジトリで exclude すればベンダーツリーから消えるので下流にも降りない。
中流で対処すれば下流は追加対応不要。

---

## 5. `.sync/upstream.json` への変更提案（未適用）

`exclude` の「実データ前提テスト」ブロックへ 2 行追加することを提案する。

```jsonc
    "tests/baseArea.render.test.js",
    "tests/commons.secondaries.test.js",
    "tests/data.facet-codes.test.js",
    "tests/data.shape.test.js",
    "tests/enrich.dblink.jump.merge.test.js",
    "tests/enrich.index-alias-dict.test.js",
    "tests/enrich.indexdef.perdb.test.js",
    "tests/faction.render.test.js",
    "tests/image-dir-mapping.test.js",
    "tests/keyedDialogue.render.test.js",
    "tests/legacy-work-alias.test.js",
+   "tests/legacy-shauer-work-alias.test.js",
    "tests/migrate-common.test.js",
    "tests/pages.characters.ui-output.test.js",
    "tests/pages.characters.url-params.test.js",
    "tests/pkg.nodejs.test.js",
+   "tests/pkg.client-alias-parity.test.js",
    "tests/private-commons-order.test.js",
    "tests/section-renders.relation.test.js"
```

根拠:

- 既存の `tests/legacy-work-alias.test.js`（Proxies 版・同じ性質）が既に exclude されている。今回のは獣爾騎兵版で対になる
- `tests/pkg.nodejs.test.js` も既に exclude 済み。`tests/pkg.client-alias-parity.test.js` はその兄弟で、
  同じく `data/` 実在を前提にする
- **ツール／ライブラリ側は exclude しない**。`$comment` の不変則は「ツールを exclude したらそのテストも exclude」であり、
  今回はその逆（実データ前提のテストだけ落として、共通処理の修正は取り込む）で、既存 24 件と同じ扱い

---

## 6. 未マージ PR（GitHub）

`.github/dependabot.yml` 由来の open PR を 3 リポジトリで確認した。**放置されているものは無い**（いずれも本日作成）。

| リポジトリ | PR | 内容 | 作成日 | 状態 |
| --- | --- | --- | --- | --- |
| `100BeautiesLab_CreationsDB` | [#36](https://github.com/radiann-kswg/100BeautiesLab_CreationsDB/pull/36) | `dev-minor-patch` group: jsdom 30.0.1→30.1.0 / vitest 5.0.0→5.0.1 | 2026-09-21 | open・本日作成 |
| `JsonCharacterDB-Framework` | [#7](https://github.com/radiann-kswg/JsonCharacterDB-Framework/pull/7) | 同上 | 2026-09-21 | open・本日作成 |
| `RadianNs_SecondaryWorksDB` | — | open PR なし | — | — |

本リポジトリの #7 は `develop`（`4709f77`）ベース。§7 の merge より先に入れても後でも構わないが、
**`npm test` の基準を揃えたいなら upstream merge → `npm test` green 確認 → #7 の順**が安全。

---

## 7. 次にやるべき 1 手

**`.sync/upstream.json` へ §5 の 2 行を足してから `sync:update` をやり直し、その後 merge する。**

```sh
# 1. .sync/upstream.json の exclude へ 2 行追加（§5）
#    tests/legacy-shauer-work-alias.test.js
#    tests/pkg.client-alias-parity.test.js

# 2. ベンダーツリーを作り直す（exclude を反映させるため必須）
npm run sync:update

# 3. 取り込む
git merge upstream/creationsdb

# 4. 門番
npm test
```

**順序が重要**: 先に merge すると 2 件のテストが作業ツリーへ入ってしまい、あとで `git rm` ＋ exclude 追加の
2 段階になる。exclude を先に入れてから `sync:update` を回せば、ベンダーツリーに最初から含まれない。

### コンフリクト見込み

| ファイル | 見込み | 理由 |
| --- | --- | --- |
| `lib/data-common.js` | **低**（自動マージ可） | ローカル差分 L1629 / L2438、上流差分 L16-40 / L300 / L473。領域が離れている |
| `pages/characters.js` | **低**（自動マージ可） | ローカル差分 L998 / L5166-5240 / L6742、上流差分 L95 / L529 / L680 / L4372。領域が離れている |
| それ以外 21 件 | **なし** | ベンダー基準 `2f5e3b2` から本リポジトリ側が 1 バイトも変えていない |

コンフリクトが出るとすれば上記 2 ファイルだが、行が離れているので 3-way merge が自力で解決する見込み。
万一マーカーが出た場合は、**ローカル側（`'sub'` セクション / `$DetailLayout.headerPills` / 画像 null ガード）を残し、
上流側の別名表・正規化関数を足す**のが正しい解決。どちらも消さない。

### merge 後の確認ポイント

- `npm test` が **51 files / 767 tests green** を維持しているか（exclude が効いていれば新規テストは `tests/clean-cache.test.js` の 1 件だけ増える見込み）
- `tools/clean-cache.mjs` の呼び出し口（§3-3）をどうするか決める
- 本リポジトリは D1 / R2 を持たないため、上流 CHANGELOG の「`wrangler deploy` が必要」は**該当しない**

---

## 8. 実施記録（2026-09-21 10:35 JST・User 承認のうえ実行）

§7 の手順を実行した。**この章が §7 を上書きする。**

| # | 操作 | 結果 |
| --- | --- | --- |
| 1 | `.sync/upstream.json` の `exclude` へ §5 の 2 行を追加 | commit `7e10d1a` |
| 2 | `npm run sync:update` | 同期対象 174 → **172** ファイル、未取り込み 23 → **21** 件。ベンダーブランチ `1676e3f` → **`c59c742`** |
| 3 | `git merge upstream/creationsdb` | **コンフリクトなし**。`ort` が `lib/data-common.js` / `pages/characters.js` を自動マージ。21 files / +408 -48。merge commit `601bbed` |
| 4 | `npm test` | **52 files / 769 tests green**（51/767 → +1 file / +2 tests ＝ `tests/clean-cache.test.js` のみ。予想どおり） |
| 5 | `CHANGELOG.md` に Synced エントリ追加 | commit `a397c93` |
| 6 | §3-3 の保留事項を解消（`cache:clean` / `cache:clean:write` を `package.json` へ手で追加） | commit `f855147`。`npm run cache:clean` の plan 動作を確認（6 件 / 0.1 MB が対象と表示、削除はしていない）。再テストも 52/769 green |

### ローカル差分は全て温存された

merge 後も以下はそのまま残っている（3-1 の予想どおり衝突しなかった）:

- `lib/data-common.js` — `'sub'` ディスプレイセクション（`sectionOrder` / `pickDisplaySection`）
- `pages/characters.js` — `$DetailLayout.headerPills`、画像 null ガード、`$DefType` による
  グローバルメタ判定のフォールバック

### 未実施（User 判断で保留）

- **`git push` はしていない。** `develop` は `origin/develop` より **7 コミット先行**の状態。
- push するまで下流 `RadianNs_SecondaryWorksDB` の `sync:check` は 0 件のまま
  （下流は GitHub 上の `JsonCharacterDB-Framework` @ `develop` を見るため）。
- **push 後に下流へ降りるのは 12 件**（§4 の 14 件から、exclude した 2 テストを引いた数）。
  下流で追加の exclude 対応は不要。
- dependabot PR [#7](https://github.com/radiann-kswg/JsonCharacterDB-Framework/pull/7) は未対応。
  ベースが `4709f77` なので、push 後に `@dependabot rebase` を投げるのが素直。
