# 上流同期点検レポート — JsonCharacterDB-Framework（中流）

**`git merge` と `data/` の変更は行っていない（`sync:update` までの読み取り中心の調査と提案）。**
実行したのは `npm run sync:check` / `npm run sync:update`（ベンダーブランチの更新）と読み取り系の git コマンドのみ。
`develop` への取り込みとコンフリクト解決は User の判断。`.sync/upstream.json` も 1 バイトも触っていない（変更提案は §5 に記載）。

---

## 1. 点検サマリ

| 項目 | 値 |
| --- | --- |
| 点検日時 | 2026-09-14 10:15 JST |
| 上流 | `radiann-kswg/100BeautiesLab_CreationsDB` @ `develop` |
| 上流 SHA | `20514d9`（DB追加（ナンバーテールズ） / 2026-09-12〜） |
| 本リポジトリ SHA | `d8995aa`（`develop`） |
| 比較基準 | 取り込み済みベンダーコミット `2f5e3b2`（上流 `74cfc58`） |
| 同期対象ファイル数 | 171 |
| 未取り込み | **16 件**（M=15 / A=1） |
| 実行コマンド | `npm run sync:check`（ネットワーク到達可）→ `npm run sync:update` |
| ベンダーブランチ | `upstream/creationsdb` を `2f5e3b2` → **`ddd0963`** へ更新済み |
| merge 前のテスト | `npm test` = **51 files / 767 tests すべて green** |
| 前回点検 | [`2026-09-07_upstream-sync.md`](./2026-09-07_upstream-sync.md) |

比較基準は `HEAD` ではなく取り込み済みベンダーコミット `2f5e3b2` と出ており、**2026-09-07 の接ぎ木は正常に効いている**（前回 46 件だった差分が、下流の意図的な差を除いた 16 件まで落ちている）。

### 下流 `RadianNs_SecondaryWorksDB`

`sync:check` = **0 件 / exit 0**（上流 `JsonCharacterDB-Framework` @ `d8995aa`、比較基準 `8ad2036`、同期対象 75 ファイル）。
手順どおり点検はここで終了、レポートは作成していない。ただし §4 のとおり、**本リポジトリが merge した時点で 10 件が下流へ降りる**。

---

## 2. 上流で何が起きたか

未取り込みの 6 コミットは、ほぼ **1 つのテーマ**に収束している。

| 上流コミット | 内容 |
| --- | --- |
| `a9e0185` | `grilling` / `grill-me` スキルを `.agents/skills/` へ取り込み（同期対象外） |
| `cb8e6ed` | 創作ガイドラインの補填・`db_meta.json` へ公式サイト登録（`data/` のため同期対象外） |
| `5c4fa4c` / `43161e2` | **獣爾騎兵の英語表記を `ShouArRiders` → `ShauErRiders` へ全改名**＋旧直リンク互換（`lib/viewer-locator.js`） |
| `367a9dd` | 旧綴り別名解決を **API / SW 経路へも追加**（`worker.js` / `sw-common.js` / `data-common.js` / `pkg/nodejs`） |
| `04d1bf7` / `20514d9` | ナンバーテールズの DB 更新（`data/` のため同期対象外） |

つまり同期対象 16 件の中身は、**(a) 識別子リネームに伴う文字列置換**と **(b) 旧綴り作品IDの別名解決テーブル追加**の 2 種類しかない。
破壊的変更は無く、公開関数のシグネチャも不変（上流 `CHANGELOG.md` の「下流への申し送り」でも明記されている）。

**本リポジトリは `data/` に `Works_ShauErRiders` を持たない**（あるのは `Works_Sample` と `Dictionaries` のみ）ため、
別名テーブル自体はこのリポジトリでは実質デッドコードになる。それでも取り込むべき理由は、
フレームワークとして下流へ配る共通処理であること、および上流との差分を溜めないことにある。

---

## 3. ファイル別の判定

`git merge-tree --write-tree HEAD upstream/creationsdb` を実行したところ **exit 0 / コンフリクト 0**。
テキスト上のコンフリクトは発生しない見込み。判定はそのうえで、意味的な影響を見て付けている。

### 3-1. 取り込むべき（13 件）

| ファイル | 判断理由 |
| --- | --- |
| `lib/sw-common.js` | `LEGACY_WORK_ID_ALIASES` 新設＋`DataUtils.toWorkKey()` へ適用。純粋な後方互換の追加で、既存の戻り値は不変。ローカル改変なし |
| `lib/viewer-locator.js` | `workKeyForURL()` / `parseViewerLocator()` の別名解決。公開済み直リンクの 404 を防ぐバグ修正。ローカル改変なし |
| `pkg/cloudflare/worker.js` | `toWorkKey()` に別名を適用。D1/R2 を現行キーで引くための修正。ローカル改変なし |
| `pkg/nodejs/index.mjs` | 上と同じ別名表を `toWorkKey()` / `LEGACY_WORK_DIR_ALIASES` へ追加。クライアント間の挙動を揃える |
| `lib/basic-renders/type-common.js` | コメント中の作品名を新綴りへ置換するだけ（コード実体の変更なし） |
| `lib/graph/graph-badge.js` | 同上（ドキュメンテーションコメントの表中の作品名のみ） |
| `lib/section-renders/specStats.js` | 同上（ヘッダコメントのみ） |
| `pkg/mcp/README.md` | 同上（インデックスキー表の作品名） |
| `pkg/mcp/server.mjs` | 同上（ツール引数の description 文字列） |
| `docs/localization-en-rules.md` | 同上（英訳ルール表の作品名 2 箇所）。ローカル改変なし＝そのまま上書きで問題なし |
| `docs/pkg-client-libraries.md` | 同上（サンプルコード 1 行） |
| `docs/wrapper-summary-registry.md` | 同上（`specStatsSection` の説明文） |
| `tests/sw.datafetcher-memo.test.js` | フィクスチャのパス文字列を新綴りへ置換するのみ。実在ファイルを読まない 404 テストなので、本リポジトリに当該データが無くても通る |

### 3-2. 要注意（2 件）

どちらも **本リポジトリ側に意図的な改変があるファイル**。`merge-tree` ではコンフリクトしないが、
上流とローカルの両方が同じファイルを触っているので、merge 後に `git diff` で意図が潰れていないか目視すること。

| ファイル | 判断理由 |
| --- | --- |
| `lib/data-common.js` | 上流は `normalizeLegacyWorkKey()` を新設し `normalizeWorkId()` / `toWorkKeyFromWorksTitle()` から呼ぶ（ファイル冒頭＋中盤）。本リポジトリ側の改変は `EnrichmentProcessor` の `sectionOrder` と `TypeDefUtils.pickDisplaySection()` への `'sub'` セクション追加（ファイル後半）で、**hunk が重ならない**。merge 後に `'sub'` が残っているかだけ確認する |
| `pages/characters.js` | 上流は `getQS()` / `normalizeWorkKey()` を `workKeyForURL()` ベースへ統一＋作品ラベル表のリネーム。本リポジトリ側の改変は `fetchGlobalDefType()` の `$DefType` フォールバック・`resolveImageStatically()` の空値ガード・`renderDetail()` の `headerPills` 汎用化で、いずれも**別領域**。merge 後にこの 3 点が残っているか確認する |

### 3-3. 要相談（1 件）

| ファイル | 判断理由 |
| --- | --- |
| `tests/legacy-shauer-work-alias.test.js`（新規 197 行） | **このまま取り込むと `npm test` が確実に落ちる。** 4 つの `describe` のうち最後の 1 つが `data/Works_ShauErRiders/DataBases/db_Primary.json` を `readFileSync` するが、本リポジトリの `data/` には `Works_Sample` と `Dictionaries` しか無い（ENOENT）。残る 3 つ（sw-common / data-common / worker の正規化）は純粋なロジック検証で、上流コードを取り込めばそのまま通る |

**選択肢は 2 つ:**

1. **`.sync/upstream.json` の `exclude` へ追加する（推奨）** — マニフェストには既に「上流の実データを前提とするテストは除外」という方針があり、**同種の `tests/legacy-work-alias.test.js`（Proxies 版）は既に除外済み**。同じ扱いにするのが一貫性があり、差分も増えない。代償は、別名解決ロジックが本リポジトリでは無検証になること（ただし Proxies 版で既にそうなっている）。
2. **取り込んだうえで最後の `describe` だけ落とす** — 3 ブロック分のカバレッジは得られるが、上流と恒久的にズレるファイルが 1 本増え、今後の merge で毎回コンフリクトする。

判断が割れるので User に委ねる。1 を選ぶ場合は merge **前**に `.sync/upstream.json` を編集してから `sync:update` をやり直す必要がある。

---

## 4. 下流（`RadianNs_SecondaryWorksDB`）への波及

現時点で下流は 0 件だが、本リポジトリが merge すると **16 件のうち 10 件**が下流の同期対象に入る。

- **降りるもの（10 件）**: `docs/wrapper-summary-registry.md` / `lib/basic-renders/type-common.js` / `lib/data-common.js` / `lib/graph/graph-badge.js` / `lib/section-renders/specStats.js` / `lib/sw-common.js` / `lib/viewer-locator.js` / `pages/characters.js` / `tests/legacy-shauer-work-alias.test.js` / `tests/sw.datafetcher-memo.test.js`
- **降りないもの（6 件）**: `pkg/**` の 4 件（下流の `include` に `pkg/**` が無い）、`docs/localization-en-rules.md` と `docs/pkg-client-libraries.md`（下流で `exclude` 済み）

下流も `Works_ShauErRiders` のデータを持たないため、**§3-3 と同じ問題がそのまま再発する**。
§3-3 で選択肢 1 を採るなら、下流の `.sync/upstream.json` にも同じ `exclude` を入れておくのが自然。

---

## 5. `.sync/upstream.json` への変更提案（未適用）

読み取り中心の調査のため編集はしていない。適用するかは User の判断。

```jsonc
// JsonCharacterDB-Framework/.sync/upstream.json — exclude 末尾の「上流の実データ前提」ブロックへ
"tests/legacy-shauer-work-alias.test.js",

// WebSites/RadianNs_SecondaryWorksDB/.sync/upstream.json — 同じく exclude へ
"tests/legacy-shauer-work-alias.test.js",
```

既に `tests/legacy-work-alias.test.js` が同じ理由で除外されているので、その隣へ並べるのが読みやすい。

---

## 6. 未マージの PR（GitHub）

`.github/dependabot.yml` 由来の open PR を確認した。**放置されているものは無い**（いずれも本日 2026-09-14 00:14 UTC 作成）。

| リポジトリ | PR | 内容 | 状態 |
| --- | --- | --- | --- |
| `100BeautiesLab_CreationsDB` | [#35](https://github.com/radiann-kswg/100BeautiesLab_CreationsDB/pull/35) | `playwright` 1.62.1 → 1.63.0（dev-minor-patch group） | open / 本日作成 |
| `JsonCharacterDB-Framework` | [#6](https://github.com/radiann-kswg/JsonCharacterDB-Framework/pull/6) | 同上 | open / 本日作成 |
| `RadianNs_SecondaryWorksDB` | — | open PR なし | — |

同一の dev 依存バンプなので、3 リポジトリで足並みを揃えて処理するのが楽。

---

## 7. 次にやるべき 1 手

**`.sync/upstream.json` の扱い（§3-3・§5）を先に決めてから** 取り込む。

```powershell
cd 'D:\VisualStudio Code Userfile\JsonCharacterDB-Framework'
git merge upstream/creationsdb     # ベンダーブランチは ddd0963 へ更新済み
npm.cmd test
```

- **コンフリクト見込み: なし**（`git merge-tree` で確認済み）。ただし `lib/data-common.js` と `pages/characters.js` は本リポジトリ側の改変と同一ファイルなので、merge 後に §3-2 の 3 点＋`'sub'` セクションが残っているか `git diff` で目視すること。
- **`npm test` は `tests/legacy-shauer-work-alias.test.js` の最後の `describe` で落ちる**（`data/Works_ShauErRiders/...` が存在しないため）。§3-3 の選択肢 1 を採るなら、`.sync/upstream.json` へ 1 行足してから `npm run sync:update` をやり直せば、この失敗自体が消える。
- merge が済んだら、下流 `RadianNs_SecondaryWorksDB` で `npm run sync:check` を再実行すると §4 の 10 件が出る。
- 上流 `CHANGELOG.md` にある `wrangler deploy` / `scripts/migrate.mjs` の再実行は、`data/Works_ShauErRiders` を持つ上流リポジトリ側の作業。本リポジトリには該当データが無いため不要。
