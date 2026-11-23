# AppearanceDetail の入力・校正補助

`tools/patch-appearance-detail.mjs` は、作者の手動入力や利用可能な原画の観察を、既存 schema に沿った候補へ整理して反映する CLI です。外部 AI API は使用しません。表情・動作は既存の `#Element_Expression` を使います。描かれていない性格・台詞・状況別の仕草を推測する機能はありません。

## 候補を準備する

```powershell
node tools/patch-appearance-detail.mjs --prepare --work NumberTales --db Primary --match '{"Num":61}' --out .cache/appearance-61.json
```

現在の `AppearanceDetail` を `before` と `after` へ複写します。未入力なら `before: null` / `after: []` になります。`after` を編集し、`sources` に監修・観察の根拠を記入してください。`before` は編集しません。既存の候補ファイルを上書きしません。

候補ファイルは次のオブジェクトの配列です。

| キー | 内容 |
| --- | --- |
| `db` | `Primary` などの DB 名 |
| `match` | 一意に一致する条件。`{"Num":61}`、`{"Drc":"NE"}`、`{"Card":{"Suit":"Major","SuitNum":17}}` など |
| `before` | 作成時の外見配列。未入力なら null |
| `after` | 監修済みの外見配列 |
| `sources` | 下記の手動入力または画像観察の根拠 |

作者の手動入力は `{ "kind": "manual", "note": "作者が確認した変更内容と根拠" }` です。画像観察は `{ "field": "concept_PNGName", "value": "cnsp_imgNTS-61", "note": "確認した部位と特徴", "permissionNote": "原著作者による利用許諾の根拠" }` です。画像は元の Images 値と完全一致し、実在と利用可否も検査します。許諾メモはオプトアウトや不正な指定を解除しません。

## 確認して適用する

```powershell
node tools/patch-appearance-detail.mjs --work NumberTales --patch .cache/appearance-61.json
node tools/patch-appearance-detail.mjs --work NumberTales --patch .cache/appearance-61.json --apply
```

既定は dry-run です。対象と変更箇所の before / after・根拠を出力し、`--apply` で書き込みます。全候補の検証を終えてから変更するため、古い before、曖昧な対象、重複候補、未定義コード、不正な型、画像利用の拒否があれば適用しません。

既存項目の変更と末尾追加に対応します。削除・並べ替えはこのツールの対象外です。対象外レコード・項目の書式は保持します。適用後は `npm run data:order:check` と対象データのテストを実行してください。

形態・衣装・着脱を判断するときは [schema/meta 詳解](schema-meta-processing.md) の外見の節を参照してください。原画にない姿や未確定の状態対応は、候補へ断定して追加せず作者へ確認します。
