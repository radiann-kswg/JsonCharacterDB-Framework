# 相関図ページ仕様（relations）

## 概要

- ページ: pages/relations.html
- スクリプト: pages/relations.js
- 描画: Cytoscape（pages/vendor 同梱）
- 背景マス塗り: board canvas（Cytoscape ノードへは載せない）

## URL パラメータ

- m: マップ種別（own/shared）
- d: ドリルパス（/ 区切り）
- g: グルーピング軸
- f: フォーカスノード
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
