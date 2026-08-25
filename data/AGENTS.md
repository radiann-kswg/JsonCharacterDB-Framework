# AGENTS.md — `data/` パススコープ

> 正典は リポジトリルートの [`AGENTS.md`](../AGENTS.md) です。ここは `data/` 配下を編集するときの要点だけを置きます。

## このディレクトリの原則

1. **`db_type.json` に宣言の無いキーをデータへ書かない。** UI にも検索索引にも載りません。
2. **DB ファイルのトップレベルは必ず配列。**
3. **値が無い項目は `null` を明示する**（キーごと削除しない）。
4. **フィールド順は手で揃えない。** `npm run data:order:write` を使う。
5. **`_Commons` / `_Secondaries` を使い、同じ値を全レコードへ複写しない。**
6. **画像パスは拡張子なしの相対パス。**
7. 編集後は `npm test` を通す。

## 手順

- 新しいフィールドを足す → [`docs/json-db-implementation-guide.md`](../docs/json-db-implementation-guide.md) §3
- 仕様の詳細 → [`docs/schema-meta-processing.md`](../docs/schema-meta-processing.md)
- 英訳を足す → [`docs/localization-en-rules.md`](../docs/localization-en-rules.md)

## 禁止

- 未公開の創作内容をエージェントが自動生成して `data/` へ書き込むこと。創作内容は User が入力・監修します。
- `data/` へ一時ファイルを書き出すこと（一時作業は `./.cache/` を使う）。
