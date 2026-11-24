# 2026-11-09 GitHub Pages 軽量化・高速化の点検（定期点検）

> `git merge` と `data/` の変更は行っていない（`sync:update` までの読み取り中心の調査と提案）。
> 本リポジトリは `sync:check` が 0 件だったため同期レポートは無く、この Pages 点検のみを残す。
> コード・ワークフロー・画像の書き換えもしていない。すべて提案。

## 点検の前提

| 項目 | 値 |
| --- | --- |
| 点検日時 | 2026-11-09 01:13〜01:25 UTC |
| 上流 | `https://github.com/radiann-kswg/100BeautiesLab_CreationsDB.git` @ `develop` (`95de336`) |
| 比較基準 | 取り込み済みベンダーコミット `e0692d4`（上流 `4f48192`） |
| 同期対象ファイル数 | 174 |
| 未取り込みの差分 | **0 件**（上流の `95de336` までの変更は `data/` のみで `include` 外） |
| Pages ワークフロー | `.github/workflows/pages.yml`（Jekyll を通さない静的配信・`vars.ENABLE_PAGES` でオプトイン） |
| 前回の計測ファイル | なし（`./.cache/pages-perf/latest.json` を今回新規作成。次回から前回比が出る） |

## 1. 配信対象の中身

`pages.yml` は `npm ci` → `npm test` →  `actions/upload-pages-artifact@v5`（`path: .`）の順。
`upload-pages-artifact` の tar は `.git` / `.github` と**ドット始まりのエントリだけ**を除外するため
（`include-hidden-files: false` の既定で `--exclude=.[^/]*`）、`npm ci` で作られた `node_modules/` と
`tests/` `docs/` `tools/` `_work_in_progress/` が**そのまま公開物に入る**。
`.agents/` `.claude/` `.sync/` `.cache/` はドット始まりなので除外されている。

| 公開物に入っているが配信に不要 | 実測サイズ | ファイル数 |
| --- | --- | --- |
| `node_modules/` | **100.7 MB** | 2,975 |
| `tests/` | 413 KB | 55 |
| `docs/` | 358 KB | 20 |
| `tools/` | 284 KB | 22 |
| `_work_in_progress/` | 159 KB | 13 |
| 合計 | **約 101.9 MB** | **3,085** |

## 2. サイズ（`git ls-files` ベース）

| 項目 | 値 |
| --- | --- |
| 追跡ファイル数 | 253 |
| 合計 | **4.89 MB** |
| 上位ディレクトリ | `pages/` 2.23 MB / `lib/` 703 KB / `tests/` 413 KB / `docs/` 358 KB / `pkg/` 302 KB / `tools/` 284 KB |

大きいファイル上位 10 件:

| # | パス | サイズ |
| --- | --- | --- |
| 1 | `pages/vendor/cytoscape/cytoscape.esm.min.js` | 434 KB |
| 2 | `pages/vendor/three/build/three.core.min.js` | 385 KB |
| 3 | `pages/characters.js` | 373 KB |
| 4 | `pages/vendor/three/build/three.module.min.js` | 366 KB |
| 5 | `pages/vendor/three-vrm/three-vrm.module.min.js` | 155 KB |
| 6 | `lib/data-common.js` | 153 KB |
| 7 | `pages/vendor/three/addons/loaders/GLTFLoader.js` | 115 KB |
| 8 | `pages/relations.js` | 110 KB |
| 9 | `lib/sw-common.js` | 98 KB |
| 10 | `.github/copilot-instructions.md` | 76 KB |

`pages/vendor/` の three / three-vrm / cytoscape は相関図・VRM ビューアを開いたときだけ読む遅延資産で、
初回表示には乗らない。

## 3. 初回表示の重さ

`index.html` は JS を読まない（CSS 1 本のみ）。キャラシートは `pages/characters.html` の
`<script type="module">` から `import('./characters.js?v=<asset-version>')` で動的に読む構造。

| 入口 | 件数 | 未圧縮 | gzip 推定 |
| --- | --- | --- | --- |
| `index.html`（2.0 KB）+ `pages/characters.css`（57.3 KB） | 2 | 59.4 KB | **11.3 KB** |
| `pages/characters.html` | 1 | 9.1 KB | 3.6 KB |
| → `pages/characters.js` の静的 import グラフ | **29 モジュール** | 677.4 KB | **206.6 KB** |
| `pages/relations.html` | 1 | 9.9 KB | 3.9 KB |
| → `pages/relations.js` の静的 import グラフ | 14 モジュール | 374.5 KB | 128.4 KB |

Service Worker は `api/sw.js`（1.1 KB）で、`importScripts` で `lib/wrapper-common.js`・
`lib/basic-renders/*`・`lib/sw-common.js`・`lib/data-common.js` の 7 本を読む。
キャッシュ方針の正典は `docs/api-sw-spec.md`（キャッシュ名 `100bl-api-v1`、プリキャッシュは `data/db_meta.json`、
本文は Cache API の stale-while-revalidate ＋ ブラウザ HTTP キャッシュの 3 層）。

## 4. 実サイトの応答

**未計測。** 本リポジトリの Pages は `vars.ENABLE_PAGES` 次第のオプトインで、公開 URL（`github.io` 配下）は
VM・クラウド双方の egress で 403 のため到達できなかった。有効化状況も API からは読めていない。

## 5. 前回比

初回計測のため比較対象なし。`./.cache/pages-perf/latest.json` に保存した。

## 改善案（3 件以内）

### 案 1: `node_modules/` を Pages アーティファクトから外す（本リポジトリ固有・上流には不要）

- **効果**: アーティファクト **−100.7 MB / −2,975 ファイル**（約 101.9 MB → 約 4.9 MB）。
  push ごとの tar・アップロード・デプロイ時間がその分減る。公開サイトから `node_modules/` の中身が
  引けなくなる（公開 npm パッケージなので秘密ではないが、配信する理由もない）
- **変更箇所**: `.github/workflows/pages.yml` の `Test` と `Setup Pages` の間に 1 ステップ

  ```yaml
  - name: Drop dev deps from the artifact
    run: rm -rf node_modules
  ```

  `npm test` は既に終わっているので門番としての役割は保たれる
- **上流 / 下流**: 上流は `actions/jekyll-build-pages` で `_site` を上げており、Jekyll の既定 `exclude` に
  `node_modules` が入っているうえ `npm ci` も走らせないため該当しない。**本リポジトリと下流の固有問題**
  （下流の `pages.yml` は本リポジトリとほぼ同一で、同じ対処が必要）

### 案 2: `tests/` `docs/` `tools/` `_work_in_progress/` を公開物から外す

- **効果**: アーティファクト **−1.21 MB / −110 ファイル**。配信サイズとしては案 1 に比べれば小さいが、
  閲覧者向けでないファイルが 110 件消える
- **変更箇所**: 案 1 と同じ位置で `rm -rf` の対象に加えるか、`upload-pages-artifact` の前に `_site/` を
  作って配信対象だけコピーする形へ寄せる。前者が小さい
- **要注意**: `docs/` は `pages/` から参照されていないかの確認が必要（`viewer-guide.md` 等への
  サイト内リンクがあると 404 になる）。`docs/` だけは外す前に参照の有無を見ること
- **上流 / 下流**: ワークフローは同期対象外（`.github/` は `include` に無い）なので、3 リポジトリそれぞれで直す話

### 案 3: JS モジュールの束ね・`modulepreload` は**今回も見送り**（記録として）

- `pages/characters.js` の静的 import は 29 モジュール（gzip 約 207 KB）で、初回訪問時は
  `characters.js` のダウンロードとパースが終わるまで `lib/*` の取得が始まらない構造になっている
- ただし上流 `_work_in_progress/2026-11-02_progress_pages-load-time.md` の実測で
  「JS モジュールの配信はボトルネックではなかった」「bundle 化はしない（YAGNI）」と結論が出ている。
  当時の 5 秒はすべて SW の `data/**` 取得側の問題で、そこは既に解決済み
- 実測なしに `modulepreload` を足すのは根拠が弱いので提案しない。本リポジトリの Pages が有効化されて
  実測できるようになってから、初回訪問のウォーターフォールを見て判断するのが順序として正しい

## 次にやるべき 1 手

`.github/workflows/pages.yml` の `Test` ステップの直後に `rm -rf node_modules` を 1 ステップ足す（案 1）。
ワークフローは同期対象外なので上流・下流への波及はなく、下流 `RadianNs_SecondaryWorksDB` にも
同じ 1 行を入れれば両方で約 83〜101 MB のアーティファクトが落ちる。
