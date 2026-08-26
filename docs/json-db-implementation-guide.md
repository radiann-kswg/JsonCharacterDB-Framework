# JSON DB 実装ガイド（JSON DB Implementation Guide）

> **対象**: JsonCharacterDB-Framework で自分のキャラクターDBを一から作る人。
> **前提**: Node.js 22.19.0 以上。ビルドは不要です（Vanilla JS + Service Worker）。
>
> 宣言の**仕様の正典**は [`schema-meta-processing.md`](./schema-meta-processing.md) です。
> 本書は「実際に手を動かす順番」を示す実装ガイドで、詳細は逐一そちらへリンクします。

---

## 0. 30 秒で全体像

```
data/
├── db_meta.json                    ← ① 作品カタログ + 共通変数（$VarsDef）
├── db_type.json                    ← ② 全作品共通のフィールド型定義
└── Works_<作品ID>/
    ├── DataBases/
    │   ├── db_meta.json            ← ③ この作品が持つ DB の一覧と共通値
    │   ├── db_type.json            ← ④ この作品だけのフィールド型定義
    │   └── db_Primary.json         ← ⑤ キャラクターの実データ（配列）
    ├── Images/                     ← ⑥ 画像
    ├── Dictionaries/               ← ⑦ 列挙値・辞書（任意）
    └── Localization/               ← ⑧ 対訳（任意）
```

UI は**このJSONだけ**を読んで描画します。HTML/CSS/JS を触る必要はありません。
「表示を変えたい」と思ったら、まず `db_type.json` の `$display` を疑ってください。

---

## 1. 最初の一歩：サンプルを複製する

```bash
cp -r data/Works_Sample data/Works_MyWork
```

`data/db_meta.json` の `CreationWorks` にエントリを足します。

```jsonc
{
  "CreationWorks": {
    "#Works_MyWork": {
      "Title_JP": "わたしの作品",
      "Title_EN": "My Work",
      "Works_Code": "MYW",
      "Works_Summary_JP": "作品の概要。改行は \\n で入れます。",
      "Works_Summary_EN": "Summary of the work.",
      "Works_OfficialLinks": [],
      "$DetailLayout": {
        "headerPills": ["Progress"],
        "basicFields": ["FormalName", "GenderType", "Class", "Height_cm"],
        "subFields": ["AppearanceDetail", "ColorPalette", "Relation"]
      }
    }
  }
}
```

| キー | 必須 | 意味 |
| --- | --- | --- |
| `#Works_<ID>` | ✅ | ディレクトリ名 `Works_<ID>` と一致させます（`Works_Dir` で上書き可） |
| `Title_JP` / `Title_EN` | ✅ | 作品セレクトに出る表示名 |
| `Works_Code` | ✅ | 3文字程度の短縮コード |
| `$DetailLayout` | 推奨 | 詳細画面の項目順。`basicFields` = 基本情報表、`subFields` = 下部セクション |

> ⚠️ **`basicFields` と `subFields` に同じキーを書かないこと。** 表示は `subFields` が勝ち、
> キー順は `basicFields` が勝つため、意図せず順序がずれます（`schema-meta-processing.md` §4.2）。

---

## 2. DB を宣言する（`Works_<ID>/DataBases/db_meta.json`）

1 つの作品は複数の DB を持てます。DB は「一次創作／二次創作／モブ」のような**収録区分**です。

```jsonc
{
  "Databases": {
    "#DB_Primary": {
      "DB_Label_JP": "一次創作",
      "DB_Label_EN": "Primary",
      "DB_Summary": "本編に登場するキャラクター。",
      "DB_Summary_EN": "Characters appearing in the main story.",
      "_Commons": { "Progress": "released" }
    }
  }
}
```

- `#DB_<Name>` は `db_<Name>.json` に対応します（`DB_File` で明示指定も可能）。
- `DB_Hidden: true` にすると UI の DB セレクトから隠せます（API からは読めます）。
- **`_Commons`** はその DB 全レコードの既定値です。データ本体は書き換えず、読み出し時に合流します。
  50 体全員が同じ所属なら、50 回書かずに `_Commons` に 1 回書いてください。
- 二次創作のように「同じ DB の中で権利者ごとに既定値が違う」場合は **`_Secondaries`** を使います
  （`schema-meta-processing.md` §4.7）。

---

## 3. フィールドを定義する（`db_type.json`）

### 3.1 どちらに書くか

| 書く場所 | 使う場面 |
| --- | --- |
| `data/db_type.json`（グローバル） | 全作品で共通の項目（`Name_JP`, `Height_cm`, `ColorPalette` など） |
| `data/Works_<ID>/DataBases/db_type.json`（作品別） | その作品にしかない項目、**主インデックス** |

作品別が**後勝ち**でマージされます。まず作品別に書き、複数作品で使い回すようになったらグローバルへ昇格させてください。

### 3.2 最小の宣言

```jsonc
{
  "$IndexDef": { "hashTag": "CharaId", "IndexLabel_JP": "キャラクターID", "IndexLabel_EN": "Character ID" },
  "$DefType": [
    { "hashTag": "CharaId", "$type": "#Index", "hashTag_JP": "キャラクターID", "hashTag_EN": "Character ID" },
    {
      "hashTag": "Nickname",
      "$type": "#String_bilingual",
      "hashTag_JP": "呼び名",
      "hashTag_EN": "Nickname",
      "$display": { "section": "profile" }
    }
  ]
}
```

**`hashTag` が JSON のキー名そのもの**です。`hashTag_JP` / `hashTag_EN` が UI のラベルになります。

### 3.3 よく使う `$type`

| `$type` | データの書き方 | 用途 |
| --- | --- | --- |
| `#Index` | `"001"` | 主キー。1 作品に 1 つ以上必要 |
| `#String` | `"text"` | 単一言語の短い文字列 |
| `#String_bilingual` | `Foo_JP` / `Foo_EN` の 2 キーに分割 | 日英併記する短文 |
| `#Summary` | `"長文\n改行あり"` | 概要・説明文 |
| `#Number` | `160` | 数値 |
| `#Number_withAbout` | `[{ "value": 160, "about_JP": "推定", "about_EN": "Presumption" }]` | 数値＋注釈 |
| `#DictIndex` | `"#Faction_Lab"` | `Dictionaries/` の項目を参照 |
| `#ListIndex` | `"AA"` | `$VarsDef` のリストから選ぶ |
| `#PNGFileName` / `#PNGFilePath[]` | `"sub/dir/filename"`（拡張子なし） | 画像。`Images/` からの相対 |
| `$EnumDef` | `"released"` | `$VarsDef.$EnumDef_*` の列挙値 |
| `<型>|#Null` | `null` を許可 | 未設定を明示したいとき |
| `<型>[]` | 配列 | 複数値 |

> 数値は「そのままの数値」ではなく **`_withAbout` 形式（配列）** を使うと、
> 「推定 147cm」「公式 150cm」のような複数説を 1 項目で表現できます。

### 3.4 `$display` で表示を制御する

```jsonc
"$display": {
  "section": "basic",          // basic | profile | spec | sub | images | other
  "auto": false,               // true(既定): 自動描画 / false: 専用レンダラに任せる
  "langMode": "shared",        // 言語切替の対象外にする
  "tagSpace": "internal",      // 検索タグの名前空間
  "sectionWrapper": "relationSection",  // 専用セクションレンダラ名
  "facet": { "order": 40 }     // 絞り込みファセットに出す（順序つき）
}
```

- **`section` を書かないと基本情報表に出ません。** 「データを入れたのに出ない」の 9 割はこれです。
- `auto: false` は「`lib/section-renders/` の専用レンダラが描くので自動描画しないで」の意味です。
  対応するレンダラが無いと**何も表示されません**。新規フィールドではまず `auto` を省略してください。

詳細な一覧は [`schema-meta-processing.md` §3.3](./schema-meta-processing.md) を参照。

---

## 4. データを書く（`db_Primary.json`）

**トップレベルは必ず配列**です。オブジェクトにするとテストが落ちます。

```jsonc
[
  {
    "CharaId": "001",
    "Progress": "released",
    "Name_JP": "サンプル・アルファ",
    "Name_EN": "Sample Alpha",
    "Images": { "concept_PNGName": "alpha/concept", "arts_PNGPath": [] },
    "GenderType": "Neutral",
    "Height_cm": [{ "value": 160, "about_JP": "設定値", "about_EN": "Design value" }],
    "Character_JP": "説明文。",
    "Character_EN": "Description."
  }
]
```

ルール:

- **`db_type.json` に無いキーは書かない。** 型宣言のないキーは UI に出ず、検索索引にも載りません。
- **値が無い項目は `null` を明示する**（キーごと消すより、後から埋める場所が分かる）。
- **フィールドの並び順は `db_type.json` の宣言順に合わせる。** 手で揃えず、次のコマンドを使ってください。

```bash
npm run data:order:plan    # 差分の確認（dry-run）
npm run data:order:write   # 実際に並べ替える
npm run data:order:check   # ズレていたら exit 1（CI 用）
```

---

## 5. 画像を置く

```
data/Works_<ID>/Images/
├── General/            # 作品共通の画像
├── DB_Primary/         # DB 別
│   └── <サブカテゴリ>/
└── Ref_<種別>/         # 資料系
```

JSON 側は**拡張子なしの相対パス**で書きます（`"DB_Primary/alpha/concept"` → `Images/DB_Primary/alpha/concept.png`）。
実ファイルとの対応は `npm test` の `data.image-links` テストが検証します。

画像そのものをリポジトリに置きたくない場合（容量・権利の都合）は、
パスだけを記録して実体は外部ストレージに置く運用も可能です。その場合は
`data.image-links` テストを自分の運用に合わせて調整してください。

---

## 6. 列挙値と辞書

同じ文字列を何度も書く項目（所属・種族・色役割など）は辞書化します。

```bash
npm run dict:plan-enums     # 既存データから列挙値の候補を抽出（dry-run）
npm run dict:export-enums   # Dictionaries/ へ書き出す
```

- 少数・固定の値 → `db_meta.json` の `General.$VarsDef.$EnumDef_<名前>`
- 項目数が多い・作品ごとに増える → `Dictionaries/` に切り出して `#DictIndex` で参照

---

## 7. 確認する

```bash
npm test              # Vitest。JSON 構文・構造・画像リンク・UI 出力まで検証
npx serve .           # http://localhost:3000/pages/characters.html
```

主なテストと落ちたときの見どころ:

| テスト | 落ちる原因 |
| --- | --- |
| `data.sanity` | `data/` 配下の JSON に構文エラーがある |
| `data.shape` | DB ファイルが配列になっていない |
| `data.field-order` | フィールド順が `db_type.json` の宣言順とズレている → `npm run data:order:write` |
| `data.image-links` | JSON が参照する画像が `Images/` に無い |
| `bilingual-fields` | `_JP` はあるのに `_EN` が無い（またはその逆） |
| `meta.catalog.schema` | `db_meta.json` の必須キーが欠けている |

---

## 8. 公開する

1. リポジトリの Settings → Pages → Source を `develop`（または `main`）ブランチのルートに設定
2. 独自ドメインを使う場合はリポジトリ直下に `CNAME`（1 行、ドメイン名のみ）を置く
3. `.nojekyll` が直下にあることを確認（`_`始まりのディレクトリが無視されるのを防ぐ）

Cloudflare Workers で実 API も公開する場合は [`deploy-howto.md`](./deploy-howto.md) と `pkg/cloudflare/` を参照。

---

## 9. つまずきポイント早見表

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| キャラが 1 件も出ない | `db_meta.json` の `Databases` キーとファイル名が不一致 | `#DB_Primary` ↔ `db_Primary.json` を確認 |
| 項目が表示されない | `$display.section` が未指定 | `section` を足す |
| 項目が空欄で出る | `auto: false` なのに対応レンダラが無い | `auto` を省略する |
| 英語表示が空 | `_EN` キーが無い | `bilingual-fields` テストで洗い出す |
| 画像が出ない | パスに拡張子を書いている | 拡張子を外す |
| Service Worker が古いデータを返す | SW キャッシュ | ブラウザで Hard Reload、または SW を Unregister |
| 作品セレクトに出ない | `data/db_meta.json` の `CreationWorks` に未登録 | エントリを追加 |

---

## 10. 関連資料

- [`schema-meta-processing.md`](./schema-meta-processing.md) — 宣言と内部処理の仕様（正典）
- [`db-update-guidelines.md`](./db-update-guidelines.md) — 更新時の運用ルール
- [`api-sw-spec.md`](./api-sw-spec.md) — 疑似 API のエンドポイント仕様
- [`viewer-guide.md`](./viewer-guide.md) — キャラシート UI の使い方
- [`relations-graph.md`](./relations-graph.md) — 相関図のレイアウト仕様
- [`jp-notation-rules.md`](./jp-notation-rules.md) — 日本語表記ルール
- [`localization-en-rules.md`](./localization-en-rules.md) / [`deepl-localization.md`](./deepl-localization.md) — 英訳運用
