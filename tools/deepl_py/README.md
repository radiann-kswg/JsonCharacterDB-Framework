# tools/deepl_py — DeepL 下書き翻訳ツール（Python 版）

`tools/deepl/*.mjs`（Node.js 版）の `draft-translate.mjs` に対応する Python 実装です。
`data/Works_*/DataBases/db_*.json` の**既存キーが空の** `*_EN` フィールドを DeepL で下書き翻訳します。
**外部ライブラリ依存なし** — Python 標準ライブラリ（`urllib`, `json`, `re`, `pathlib`, `argparse`）のみで動作します。

Node 環境が無い開発機や、外部リポジトリから Python でこのリポジトリのローカライズ作業を行いたい場合に使います。

---

## できること / できないこと

| できること | できないこと |
|---|---|
| **既にある** `field_EN` キー（値が空）を DeepL で下書き翻訳 | **存在しない** `field_EN` キーの新規追加（→ Claude Code / Cowork の Skill `localize-en-draft` を使う） |
| `GenderType` に基づく代名詞（she/he/ze/avoid）の機械的な正規化 | 創作本文（未公開設定・台詞等）の新規生成 |
| 一人称混入・呼称不一致の**検知**（レポート表示のみ） | 一人称混入・呼称不一致の自動修正（文法崩壊のリスクがあるため） |
| DeepL 用語集を使った固有名詞の訳語固定 | 用語集そのものの作成・同期（Node 版 `npm run deepl:sync-glossary` を使う） |

---

## セットアップ

### 動作要件

| 項目 | 詳細 |
|---|---|
| ランタイム | Python 3.9+ |
| 外部依存 | なし（標準ライブラリのみ） |
| API キー | `DEEPL_API_KEY`（`.env` に設定。無料プランのキーは末尾 `:fx`） |
| 用語集 | `.cache/deepl/glossary-ids.json`（**Node 版で事前に作成**しておく必要がある） |

### 手順

```sh
# 1) リポジトリルートで .env を用意（Node 版と共用）
cp .env.example .env
# .env を編集して DEEPL_API_KEY=... を設定

# 2) 用語集がまだ無い場合は Node 版で作成・同期（Python 側は用語集の作成/同期を行わない）
npm run deepl:build-glossary
npm run deepl:sync-glossary

# 3) 動作確認（--help はネットワークアクセスなしで確認できる）
python tools/deepl_py/draft_translate.py --help
```

`pkg/python` のようにサブモジュール経由で他リポジトリへ配布する想定ではなく、**このリポジトリのチェックアウト内で直接実行する開発ツール**です（`pkg/` の「DB 読み取り専用クライアント」とは目的が異なるため、`pkg/` 配下には置いていません）。ただし本リポジトリをサブモジュールとして持つ別リポジトリからでも、そのチェックアウトパス経由で `python <submodule path>/tools/deepl_py/draft_translate.py ...` として実行できます（`pkg/python` と同じ「自ファイル位置からリポジトリルートを相対解決する」設計のため）。

---

## 使い方

### 基本形

```sh
python tools/deepl_py/draft_translate.py --work Works_NumberTales
```

既定では**データを一切書き換えません**。`.cache/deepl/draft-report.md` にレポートを出力するだけです。

### オプション一覧

| オプション | 必須 | 説明 |
|---|---|---|
| `--work` | ✅ | 作品ディレクトリ名（例: `Works_NumberTales`） |
| `--db` | - | DB 名（例: `Primary`）。省略時は作品内の全 `db_*.json` |
| `--id` | - | `Num` 等でレコードを 1 件に絞る |
| `--under` | - | サブツリー限定（例: `ConversationPattern`。ドット区切りで深い階層も指定可） |
| `--field` | - | トップレベルの `field_EN` 名で絞り込み（例: `Summary` → `Summary_EN` のみ対象） |
| `--limit` | - | 候補の最大件数（既定 30） |
| `--apply` | - | **警告が一つも無い候補だけ**、実際に空の `_EN` へ書き戻す |

### 実行例

```sh
# 8番のキャラの ConversationPattern 配下だけを下書き翻訳（レポートのみ、書き換えなし）
python tools/deepl_py/draft_translate.py --work Works_NumberTales --db Primary --id 8 --under ConversationPattern

# Summary_EN が空のレコードだけをまとめて対象にする
python tools/deepl_py/draft_translate.py --work Works_FLInvestigator78 --db Primary --field Summary

# 警告なし候補を実際に書き戻す
python tools/deepl_py/draft_translate.py --work Works_NumberTales --db Primary --id 8 --under ConversationPattern --apply
```

### 出力

`.cache/deepl/draft-report.md`（Node 版と同じ場所・同じ内容形式）に、レコードごとの候補一覧を Markdown で出力します。

- `✅ 適用済み`: `--apply` で実際に書き戻された候補
- `⚠️ 要確認（未適用）`: 一人称混入・呼称不一致・`they/them` からの変換等の警告があり、自動反映されなかった候補
- `⏳ レポートのみ`: `--apply` 未指定のため反映されていない候補

`⚠️` 付きの候補は人間が内容を確認し、必要なら手動で `_EN` を修正します（Claude Code / Cowork のセッションで `localize-en-draft` Skill を使って仕上げるのも有効です）。

---

## Node 版との対応表

| Node 版 (`tools/deepl/`) | Python 版 (`tools/deepl_py/`) | 備考 |
|---|---|---|
| `deepl-client.mjs` | `deepl_client.py` | `translate()` / `list_glossaries()`。用語集の作成・削除（`createGlossary`/`deleteGlossary`）は Python 側では省略（Node 側に一元化） |
| `pronoun-normalize.mjs` | `pronoun_normalize.py` | 関数名は snake_case（`pronounPolicyForGenderType` → `pronoun_policy_for_gender_type` 等）。ロジックは 1:1 移植 |
| `draft-translate.mjs` | `draft_translate.py` | CLI オプションは共通（`--work --db --id --under --field --limit --apply`）。`--field` は Node 版にも同時追加済み |
| `build-glossary-source.mjs` / `sync-glossary.mjs` / `evaluate-translations.mjs` / `build-copilot-quickref.mjs` | （移植なし） | 用語集の作成・同期・添削・早見表生成は Node 版に一元化。Python 側は `.cache/deepl/glossary-ids.json` を読むだけ |

---

## トラブルシューティング

| 症状 | 原因・対処 |
|---|---|
| `DEEPL_API_KEY が未設定です` | リポジトリルートの `.env` に `DEEPL_API_KEY=...` を設定する |
| `glossary-ids.json がありません` | `npm run deepl:build-glossary && npm run deepl:sync-glossary` を先に実行する（Python 側では用語集を作成しない） |
| `対象 db_*.json が見つかりませんでした` | `--work` / `--db` の綴りを確認する（`data/<--work>/DataBases/db_<--db>.json` が存在するか） |
| 候補が 0 件のまま | 対象フィールドの `_EN` キーがそもそも JSON に存在しない可能性がある（→ Skill `localize-en-draft` を使う）。既に値が入っている場合もスキップされる |

---

## 参照

- 運用ガイド（用語集・ワークフロー全体）: [`docs/deepl-localization.md`](../../docs/deepl-localization.md)
- 和英ローカライズ規則: [`docs/localization-en-rules.md`](../../docs/localization-en-rules.md)
- Claude 向け Skill（新規 `_EN` キー挿入・少数レコードの丁寧な翻訳）: [`.claude/skills/localize-en-draft/SKILL.md`](../../.claude/skills/localize-en-draft/SKILL.md)
