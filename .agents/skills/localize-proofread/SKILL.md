---
name: localize-proofread
description: 既存の英訳（`_EN`）・対訳辞書・キャラスト本文（`BodyBlocks` / `Dialogue` / `Summary` 系）を、JP 原文と作品コンセプトに照らして校正し、候補を `.cache/localize/proofread-report.md` に提示する。データは書き換えない。「英訳を校正して」「この訳おかしくない？」「造語・固有名詞・劇中スラングの英語版を見直して」「命名の由来（ラテン語・ドイツ語など）を精査して」「小説・サウンドノベル・ナレーションの英文を自然にして」のときに使う。空の `_EN` を埋めるのは `localize-en-draft`。
---

# localize-proofread — 創作ローカライズ校正（候補提示のみ）

`data/` 配下の既存英訳と対訳辞書、キャラスト本文を**校正**し、採否を User が決めるためのレポートを出す手順書。
`localize-en-draft`（空欄を埋める）の対になる Skill で、**こちらは一切データを書き換えない**。

> **このファイルはスキルの正典です。** `.claude/skills/` 側は `npm run agents:build` による生成物なので、
> 編集は必ずこちら（`.agents/skills/`）で行ってください。

## 前提・正典

- 和英ルール: [`docs/localization-en-rules.md`](../../../docs/localization-en-rules.md)（代名詞 §1、フィールド別 §3、作品別 §4、表記 §5）
- 日本語表記: [`docs/jp-notation-rules.md`](../../../docs/jp-notation-rules.md)（JP 原文側の揺れを見つけたときの照合先）
- 固有名詞: 早見表 [`docs/localization-glossary-quickref.md`](../../../docs/localization-glossary-quickref.md) → 辞書本体 `data/Localization/trans_*.json` / `data/References/ref_*.json` / `data/Dictionaries/dict_*.json`
- 作品コンセプト: `data/db_meta.json` → `CreationWorks["#Works_<Title>"]` の `Works_Summary_JP/EN` と `Works_OfficialLinks[].URL`（公式サイト）
- DeepL 併用: [`docs/deepl-localization.md`](../../../docs/deepl-localization.md) §3-3（`npm run deepl:eval`）

## 守ること

- **提案止まり**。`data/**` と `docs/**` は読むだけ。反映は User が手で行うか、User の明示指示で `localize-en-draft` の挿入規則（キー順序・`hideText` 尊重）に従って別途行う。
- **既存の文を直す**のが仕事。未記入の設定・台詞・用語・筋書きを新しく作らない。原文に無い内容を提案に足さない。
- **固有名詞は辞書が正**。辞書と食い違う `_EN` は辞書側に寄せる提案にし、辞書自体を直すべきと判断したときは「辞書修正案」として分けて書く。
- **公式サイトは参照のみ**。取得できない環境（Web 取得不可の Copilot 等）では User に該当ページの本文貼り付けを頼む。
- **判断が割れる箇所は候補を複数並べる**。最終採否は User。

## 校正の 4 レーン

| レーン | 見るもの | 主な観点 |
|---|---|---|
| **A. 対訳** | `field_JP` ↔ `field_EN` のペア、`Comments` ↔ `Comments_EN` | 誤訳・訳抜け・代名詞（§1）・呼称（§3-3）・口語のニュアンス落ち・フィールド別規則（§3） |
| **B. 用語** | 造語・固有名詞・慣用表現・劇中スラング | 辞書対訳との一致、作品内での一貫性、英語圏で誤読される語（既存語と衝突／意図しない含意） |
| **C. 命名由来** | ラテン語・ドイツ語など他言語に由来する名前・用語（`Term_EN` / `Name_EN` / `Aliases` 等） | 元言語での綴り・語形・性数の妥当性、ローマ字化の一貫性、由来と設定の整合。**言語サフィックスの新設（`_DE` 等）は提案しない**（スキーマ変更は `multi-localized` ブランチで別対応） |
| **D. 文芸** | `BodyBlocks(_JP/_EN)`、`#Dialogue` 型、`Summary_*`、`InStory_*`、User が貼った小説・サウンドノベル・ナレーション原稿 | 作品コンセプト（`Works_Summary` ＋公式サイト）との調和、地の文と台詞の声の分離、キャラの話し方（`ConversationPattern` / 呼称フィールド）との一致、英文としての自然さ（直訳調・冗長・時制揺れ） |

## 手順

1. **対象確定**: User の指示から `work`（例 `Works_NumberTales`）・DB/ファイル・フィールド・レーンを特定する。曖昧なら 1 回で確認する。完了条件: 対象レコード件数と対象レーンが言える。
2. **文脈読み込み**: `db_meta.json` の作品コンセプト、対象フィールドの §3/§4 規則、関係する辞書項目を読む。レーン D は公式サイト（取得可能なら）も読む。完了条件: 対象に登場する固有名詞が全て辞書で引けた（引けない語は B レーンの指摘候補）。
3. **DeepL 突き合わせ（任意）**: `DEEPL_API_KEY` がある環境では `npm run deepl:eval -- --work <work> --fields <f1,f2>` を先に回し、`.cache/deepl/eval-report.md` の乖離上位を A レーンの入力に使う。**乖離＝誤りではない**（文体・意訳の揺れが大半）。無い環境は省略する。
4. **校正**: 対象を 1 件ずつ読み、レーンごとに指摘を起こす。重さは 3 段階: `fix`（明確な誤り・規則違反）／`suggest`（より自然・一貫）／`note`（判断材料のみ）。完了条件: 対象レコード全件を見た（見送った件はその旨を書く）。
5. **レポート出力**: `.cache/localize/proofread-report.md` に次の形式で書く（`.cache/` は Git 管理外）。

   ```markdown
   # proofread-report — <work> / <対象> (<YYYY-MM-DD>)
   対象: N 件 / 指摘: fix a, suggest b, note c / DeepL eval: 使用 or 未使用

   | # | 場所 | レーン | 重さ | JP | 現EN | 提案 | 理由 |
   |---|------|--------|------|----|------|------|------|
   | 1 | db_Primary.json#8 Summary_EN | A | fix | … | … | … | §1: Neutral は ze/zir |

   ## 辞書修正案（あれば）
   | 辞書 | 項目 | 現行 | 提案 | 理由 |
   ```

   レーン D の長文は表に収めず、`## 文芸校正` 節に「原文 → 提案（差分が分かる最小単位）→ 理由」で書く。
6. **報告**: 件数と `fix` の要点を User に伝え、採否を仰ぐ。反映を頼まれたら `localize-en-draft` の挿入規則に従い、反映後に `npm test` を通す。

## 他 Skill・ツールとの使い分け

| 状況 | 使うもの |
|---|---|
| `_EN` が空で、埋めたい | `localize-en-draft` ／ 大量なら `npm run deepl:draft` |
| `_EN` が既にあり、点検・改善したい | **本 Skill**（必要なら `npm run deepl:eval` を前段に） |
| 辞書を直した後の用語集同期 | `npm run deepl:sync-glossary` |
