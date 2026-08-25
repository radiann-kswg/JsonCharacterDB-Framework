# サードパーティ ライブラリ 同梱物（pages/vendor/）

各ページが動的 `import()` するライブラリをここに同梱している。GitHub Pages 上の
ビルドレスな静的サイトという構成上、外部CDNに依存せずリポジトリへ直接ファイルを
コミットする方針とした（`_work_in_progress/2026-07-12_progress_vrm-viewer.md` 参照）。

## 同梱物・バージョン・取得元

| ライブラリ | バージョン | ライセンス | 用途 | 配置 |
| --- | --- | --- | --- | --- |
| [three.js](https://github.com/mrdoob/three.js/) | 0.185.1 | MIT | VRM 3Dビューア | `three/build/three.module.min.js`, `three/build/three.core.min.js`, `three/addons/**` |
| [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) | 3.5.5 | MIT | VRM 3Dビューア | `three-vrm/three-vrm.module.min.js` |
| [Cytoscape.js](https://github.com/cytoscape/cytoscape.js) | 3.34.0 | MIT | キャラクター相関図 | `cytoscape/cytoscape.esm.min.js` |

- `three/addons/**` は three.js 本体パッケージの `examples/jsm/` 配下から、`GLTFLoader.js` の
  実行に必要な最小限のファイルのみ抽出したもの（`loaders/GLTFLoader.js` / `controls/OrbitControls.js` /
  `utils/BufferGeometryUtils.js` / `utils/SkeletonUtils.js`）。
- Cytoscape.js は配布物の `dist/cytoscape.esm.min.mjs`（ESM 版・minified）のみを配置している。
  UMD 版（`cytoscape.min.js`）や非 minified 版は使わない。
  レイアウトは本体同梱の `cose` を使うため、`cytoscape-fcose` / `cytoscape-cola` 等の
  拡張パッケージは追加していない。
  **配置時に拡張子を `.mjs` → `.js` へ改名している**（内容は無改変）。
  `.mjs` は静的ホスティングによっては `text/plain` で配信され、
  「Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/plain"」
  でモジュール読み込みが失敗する（ローカル確認に使う `python -m http.server` で実際に発生）。
  three.js を `three.module.min.js` として置いているのと同じ理由。

いずれも `npm pack <package>@<version>` で取得した公式配布物を配置しており、
**中身の改変は行っていない**（上記のとおり Cytoscape.js のみ拡張子を改名）。
無改変であることは配布物とのハッシュ比較で確認できる。
各ディレクトリの `LICENSE` ファイルに原文を同梱する。

どのライブラリも**ユーザー操作またはページ初期化のタイミングで動的 `import()` される**。
`<head>` の import map に宣言があるだけではロードされない。

## 使用箇所

| ライブラリ | 読み込み元 | タイミング |
| --- | --- | --- |
| three.js / @pixiv/three-vrm | `lib/section-renders/vrmViewer.js` | VRM ビューアの「起動」ボタン押下時 |
| Cytoscape.js | `pages/relations.js` | 相関図ページの初期描画時 |

## 更新方法

1. `npm pack <package>@<新バージョン>` で新しい配布物を取得する
   （例: `npm pack three@0.186.0` / `npm pack cytoscape@3.35.0`）。
2. 上記の対応表と同じファイルを抽出し、対象ディレクトリを丸ごと置き換える。
   `LICENSE` も同梱パッケージのものへ更新する。
3. import map のパスに変更がないか確認する
   （`pages/characters.html` の `three` / `three/addons/`、`pages/relations.html` の `cytoscape`）。
4. 本ファイルのバージョン番号を更新する。
