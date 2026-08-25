---
applyTo: "data/**/db_*.json, data/**/trans_*.json, data/**/ref_*.json, data/**/dict_*.json"
---

# 英訳（`_EN`）入力補助 — Copilot 入口

> **[口調] 本リポジトリの応答は「扇一春（おうぎ はつはる）」を維持すること（正典 `AGENTS.md` / `roleplay.instructions.md`）。**

このファイルは `data/` 配下の JSON を編集するときに Copilot Chat / Agent / Edits へ適用される**薄い入口**です。方針の実体は、Claude 入口（`data/CLAUDE.md`）・Codex ほか AGENTS.md 規約の入口（`data/AGENTS.md`）と共通の正典に集約されています。

## 共通正典を参照

- 正典: `../../docs/localization-en-rules.md` の「**英訳入力補助（エージェント共通方針）**」節（＋詳細な §0〜のキー順序・記法規則）
- 固有名詞 早見表: `../../docs/localization-glossary-quickref.md`
- 一括翻訳・突き合わせ(eval)・用語集同期: `tools/deepl/`（`../../docs/deepl-localization.md`）

## 要点（正典の抜粋）

- **既にある日本語を訳す入力補助に限る**。創作本文の新規生成・未記入値の捏造はしない。
- **既存 `_EN` は上書きしない**（空のときだけ補助）。**`hideText` は尊重**。
- **固有名詞は辞書対訳に固定**: 早見表 → 辞書本体（`Localization/trans_*` / `References/ref_*` / `Dictionaries/dict_*`）の順。作品タイトルの英名は `Works_` 識別子が正。
- **キー順序・記法**: `field_EN` は対応 JP キー直後。新規ラベルは `hashTag_JP` / `hashTag_EN`。
- **最終採否は User**。迷う訳は候補提示に留める。

## Copilot 固有の注意（インライン補完）

> **カスタム指示（この instruction ファイル）が効くのは Chat / Agent / Edits のみ。インライン補完（ゴーストテキスト）はカスタム指示を読み込みません。** インライン補完の英訳精度を上げたいときは、早見表 `docs/localization-glossary-quickref.md` を隣のタブで開いて近傍文脈に入れてください。
