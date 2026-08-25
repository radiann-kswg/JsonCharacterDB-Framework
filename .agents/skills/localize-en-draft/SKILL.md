---
name: localize-en-draft
description: data/Works_*/DataBases/db_*.json 等の JP フィールド（Summary_JP・Character_JP 等）から、対応する空の _EN フィールドを docs/localization-en-rules.md のルールに従って下書き翻訳する。DeepL API や外部コネクタを使わず、エージェント自身がこの手順で翻訳する。field_EN キー自体が未追加（新規挿入が必要）なケースや、少数レコードを丁寧に訳したいときに使う。「Summary_ENを埋めて」「〜の英訳をお願い」「_ENが空だから埋めて」等のときに使う。
---

# localize-en-draft — 英訳（`_EN`）下書き翻訳

`data/` 配下 JSON の日本語フィールドから、対応する英語フィールド（`_EN`）を エージェント自身が翻訳して埋めるための手順書。DeepL の MCP コネクタは対話セッション専用のツールでスクリプトから呼び出せないため、「エージェント自身が翻訳する」運用をこの Skill として型化したもの。

> **このファイルはスキルの正典です。** `.claude/skills/` 側は `npm run agents:build` による生成物なので、
> 編集は必ずこちら（`.agents/skills/`）で行ってください。

## 前提・正典

- 和英ルールの正典: [`docs/localization-en-rules.md`](../../../docs/localization-en-rules.md)（フィールド別ルール §3、代名詞ルール §1、キー順序 §0）
- 固有名詞 早見表: [`docs/localization-glossary-quickref.md`](../../../docs/localization-glossary-quickref.md) → 辞書本体 `data/Localization/trans_*.json` / `data/References/ref_*.json` / `data/Dictionaries/dict_*.json`
- **既にある日本語を訳す入力補助に限る**。未記入のキャラ設定・台詞・固有用語などの創作本文は新規生成しない（翻訳元 JP が無いフィールドは空のまま）。
- **既存 `_EN` は上書きしない**（空のときだけ補助）。`hideText` は尊重する。
- **最終採否は User**。訳に迷う場合は確定させず候補として提示する。

## 他ツールとの使い分け

| ツール | 向いているケース | 前提 |
|---|---|---|
| **本 Skill（このファイル）** | `field_EN` キー自体が JSON にまだ無い（新規挿入が必要）／少数レコードを文脈込みで丁寧に訳したい／固有名詞判断や文体調整が要る | 追加セットアップ不要 |
| `npm run deepl:draft`（Node、`tools/deepl/draft-translate.mjs`） | `field_EN` キーは既に存在し値が空、という大量件数を機械的に下書きしたい | `DEEPL_API_KEY`、`.cache/deepl/glossary-ids.json` |
| `python tools/deepl_py/draft_translate.py`（Python） | 同上（Node 環境が無いマシン／外部リポジトリから使いたい場合） | 同上 |

両ツールは「既存キーが空値の場合のみ埋める（新規キー追加はしない）」設計。新規に `_EN` キーを追加する必要があるとき（例: 今まで一度も `Summary_EN` が書かれていなかったレコード）は、本 Skill で対応する。

## 手順

1. **対象範囲の確認**: 対象の `work`（例: `Works_FLInvestigator78`）・`db`（例: `Primary`）・対象フィールド（例: `Summary`）をユーザーの指示から特定する。曖昧なら確認する。範囲が広い（全レコード横断など）場合は、先に対象件数を把握してからユーザーに進め方を相談する。

2. **対象抽出**: 各レコードを次の基準で走査する。
   - **`_JP`/`_EN` ペア型**（大多数のフィールド）: `field_JP` が非空文字列で、かつ `field_EN` が存在しないか空文字列/`null` の箇所。
   - **plain + `_EN` 型**（`Relation.*.Comments` のみ）: `Comments` が非空で `Comments_EN` が未存在/空、または `Comments_EN === Comments`（まだ JP のまま）の箇所。
   - **`hideText` オブジェクト**は翻訳対象から除外する（意図的マスクとして尊重）。
   - 既存 `field_EN` があり、かつ対応する JP 値と異なる場合は**上書き禁止**（人間監修済みとみなしてスキップ）。

3. **ルール参照**: 対象フィールド名に応じて `docs/localization-en-rules.md` §3 の該当節（`Summary_EN` なら §3-6、`Character_EN`/`Hobby_EN` 等なら §3-4 等）を読む。作品固有ルール（§4-1〜4-7）も確認する。固有名詞は早見表 → 辞書本体の順で確認し、独自の別訳を作らない。

4. **代名詞方針の決定**: レコードの `GenderType` から `docs/localization-en-rules.md` §1 の表に従いポリシーを決める。
   - `FemaleNeutral` / `Female` → `she`/`her`
   - `MaleNeutral` / `Male` → `he`/`him`
   - `Neutral` → `ze`/`zir`（`they/them`・`he/she`・`him/her` は使わない。§1-1 の活用表に従う）
   - 未設定 / `Unknown` 等の非標準値 → 代名詞を避け、名前やキャラクター呼称で代替（原文が代名詞を使っていない場合はそれに倣う）
   - `ThirdPersonCalling_EN` はこのルールの対象外（キャラ自身の代名詞ではなく「他者の呼び方」を示すフィールドのため）。

5. **翻訳文の作成**: 既存の翻訳済みフィールド（`Name_EN` / `FormalName_EN` / `CodeName_EN` 等）や辞書対訳と整合させる。段落区切りは `\n`（`\n\n` ではない）。キャラクター名を引用する場合は既存表記（`'N(Name)'` 形式等）を踏襲する。セリフはダブルクォートで囲む。

6. **挿入**: Edit ツールで、ペア型は `field_JP` の直後、plain 型は `Comments` の直後に `field_EN` キーを挿入する（キー順序厳守。末尾への追記は禁止）。既に空文字列で `field_EN` キーがある場合は、その値を書き換えるだけでよい。

7. **検証**:
   - JSON 構文確認（例: `node -e "JSON.parse(require('fs').readFileSync('<path>','utf-8'))"`）
   - `npm test`（Vitest）を実行し、既存テストが通ることを確認する。

8. **報告**: 何件・どのレコードのどのフィールドを埋めたかをユーザーに提示する。訳に迷いがある箇所は確定させず候補として提示する。`AGENTS.md` の運用ルールに従い、大規模編集（多数ファイル・多数レコード）の場合は `_work_in_progress/` に進捗ログを残すことも検討する。

## 注意

- 創作内容そのもの（未公開設定・台詞・固有用語・ストーリー断片）を新規生成しない。翻訳元 JP が無いフィールドは空のままにする。
- 数十件以上の大量処理は、`npm run deepl:draft` / `python tools/deepl_py/draft_translate.py` で機械的な下書き（`.cache/deepl/draft-report.md`）を先に作り、その内容を本 Skill の手順（§1 の代名詞ルール等）で確認・仕上げする、という組み合わせも検討する。
- 詳細な運用（DeepL 側の用語集・下書き翻訳コマンド）は [`docs/deepl-localization.md`](../../../docs/deepl-localization.md) を参照。
