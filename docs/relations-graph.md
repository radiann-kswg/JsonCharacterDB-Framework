# 相関図ページ仕様（relations）

## 概要

- ページ: pages/relations.html
- スクリプト: pages/relations.js
- 描画: Cytoscape（pages/vendor 同梱）
- 背景マス塗り: board canvas（Cytoscape ノードへは載せない）

## URL パラメータ

- r: 圧縮ロケータ `[<map>/]<Works_Code>/<段の値...>`（例: `r=NTS`, `r=NTS/100BL`, `r=shared/FLI/M`）。
  map は own / shared（own は省略）。作品は `Works_Code`（`NTS`。短縮ID `NumberTales` も読める）。
  段の値は軸の `$display.facet.codeFrom` が指す辞書列の code（例: `Suit_Code` → `M`）、宣言や辞書列が無ければ生値。
  未設定グループは `-`。文法は lib/relations-locator.js、値の解決は relations.js の resolveLocators()
- m / d: 旧形式（マップ種別 / ドリルパス）。読み取りのみ互換、生成しない
- g: グルーピング軸
- f: フォーカスノード。インデックスバッジ `NTS-57`（同じバッジのノードが他にあれば `NTS-57/Db`）。旧形式のノードキー（`|` 区切り）も読める
- e: 非表示エッジ種別
- q: 検索クエリ
- lang: 表示言語
- sec: 二次創作DBを含めるか
- t: サムネイル表示

## 遷移（Phase 3-D）

- lib/graph/graph-transition.js の純関数を利用
- drill-in/out 時に zoom/pan を短時間補間
- prefers-reduced-motion: reduce では即時反映（duration=0）
- 反映は commitFrame() のみが行う

## 運用メモ

- 盤面描画は六角格子を採用（鋭角ノイズ回避）
- エッジ経路は graph-edge-route.js の既定軸（HEX_AXES）
- 仕様変更時は pages/relations.html の asset-version を更新する
