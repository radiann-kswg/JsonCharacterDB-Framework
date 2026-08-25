# CHANGELOG

## [0.1.0] - 2026-08-25

### Added

- `radiann-kswg/100BeautiesLab_CreationsDB` の `develop` ブランチから、汎用フレームワーク部分を切り出して初期化。
  - キャラシート UI（`pages/characters.*`）／相関図 UI（`pages/relations.*`）／疑似 API（`pages/sw.js`, `svc/`, `api/`）
  - スキーマ駆動レンダラ（`lib/`）
  - クライアントライブラリ（`pkg/`）と英訳補助（`tools/deepl*`）
- 動作確認用のサンプル作品 `data/Works_Sample/` を追加。
- `docs/json-db-implementation-guide.md`（JSON DB 実装ガイド）を新規作成。
- `.agents/roleplay/ROLEPLAY.template.md` を追加し、エージェントの人格を差し替え可能にした。

### Fixed

- `$DetailLayout.headerPills` に載せたキーが基本情報テーブルへ二重表示される不具合を修正
  （`Progress` 決め打ちだった抑止ロジックを headerPills 宣言駆動へ）。
- `$Def_Day` の `year` ロールを `formatDaySummary()` が解釈するようにした（年を持たない宣言は従来どおり）。
- `$display.section: "sub"` が `lib/data-common.js` のホワイトリストから漏れ、`_enrichment.displaySections` で
  `profile` に落ちていた不具合を修正。
- 画像フィールドが空配列のときに `undefined.png` を参照していた不具合を修正（6 箇所）。
- グローバル `data/Dictionaries/` を持たない構成（辞書が作品スコープのみ）で `fetchGlobalDefType()` の
  妥当性判定が false になり、`$dict` 参照が解決できなくなる不具合を修正。

### Changed

- ライセンスを **CC BY-NC 4.0** に変更（`LICENSE`）。
- `AGENTS.md` から特定作品・特定人格への依存を除去し、汎用の技術・運用ルールへ再構成。

### Removed

- 上流固有の創作データ（`data/Works_*` の実データ、辞書・ローカライズ・参照資料）。
- 上流固有の運用資産（カレンダー同期、会話パターン注入、独自ドメインの `CNAME`、移行スクリプト）。
