# CLAUDE.md — JsonCharacterDB-Framework

> **このファイルは Claude（Cowork / Claude Code）向けの「薄い入口」です。**
> 技術ルール・運用ルールの**フル記述は正典 [`AGENTS.md`](./AGENTS.md) にのみ**あります。
>
> **ルールの追加・変更は必ず `AGENTS.md` 側へ入れてください。**

@AGENTS.md

---

## ロールプレイ（既定は無効）

- セッション開始時に `.agents/roleplay/ROLEPLAY.md` の有無を確認すること。
- 存在すればその人格の口調を常時適用する。存在しなければ素の技術アシスタントとして応答する。
- 詳細は `AGENTS.md` §0。

## 基本ルールの最小要点

- 変更量が 500 行を超えそうなら事前に確認する。
- 大きな変更の前に計画を提示する。不確かな点は探索して User に確認する。
- 一時ファイルは `./.cache/` 配下（`data/` 等へ直接書き出さない）。
- 重要な仕様変更は `CHANGELOG.md` を更新する。

## Claude 固有の実行環境メモ

- **Cowork**: シェルは Linux サンドボックス。`.claude/settings.json` の `PostToolUse`（Prettier 整形）フックは
  自動実行されないため、JSON を編集したら `npx prettier --write <file>` を手動実行してください。
- **Claude Code (CLI / Windows)**: テストは `npm test`（Vitest）。PowerShell の実行ポリシーで `npm.ps1` が
  ブロックされる場合は `npm.cmd test` を使用します。
- `.claude/skills/` は **生成物**です（`.agents/skills/` から `npm run agents:build` で生成）。
