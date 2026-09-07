# データベース更新ガイドライン（DB Update Guidelines）

このドキュメントは、`data/**` 配下の JSON データベースを更新する際の「ルール」と「手順」をまとめたものです。

このリポジトリの基本方針は **スキーマ駆動（`db_type.json($DefType)` を正）**です。
データ（`db_*.json`）の追加・修正だけでなく、表示/検索/参照解決の挙動が破綻しないよう、必要に応じて型定義・メタ定義もセットで更新します。

`db_type.json` / `db_meta.json` の各宣言面と、SW/UI 内部での合流順を詳しく追いたい場合は、`docs/schema-meta-processing.md` を参照してください。

---

## 1. まず決めること（どこを更新するか）

### A. 作品固有（推奨: まずはここ）

- 対象: 1つの作品（例: `Works_NumberTales`）だけに新フィールドを足す/調整する
- 更新先:
  - `data/Works_<作品>/DataBases/db_<種別>.json`
  - `data/Works_<作品>/DataBases/db_type.json`
  - （必要なら）`data/Works_<作品>/DataBases/db_meta.json`

### B. 全作品共通（慎重に）

- 対象: 複数作品に共通で追加したいフィールド（例: 表示制御の共通化）
- 更新先:
  - `data/db_type.json` / `data/db_meta.json`
  - 作品側の `db_type.json` で上書き（override）が必要な場合もあります

---

## 2. 最小の更新手順（フィールド追加の基本）

1. **データを更新**: 対象 `db_*.json` にフィールドを追加
2. **型定義を更新**: 対象 `db_type.json` の `$DefType` に宣言を追加（スキーマ駆動の前提）
3. **必要ならメタを更新**: 表示名辞書（enum/list）や、直リンク/詳細表示レイアウトなど
4. **テスト**: `npm test`
5. （UI/SW 変更を伴う場合）**ローカルで実機確認**: Service Worker が効く環境（HTTPサーバ）で確認

---

## 3. `db_type.json`（型定義）更新ルール

### 3.1 `$DefType` は「正（source of truth）」

- UI の自動表示順序・ラベル・整形は、可能な限り `$DefType` に追従します
- 新フィールドをデータに入れたら、基本的に `$DefType` へも追加します
- **レコードのキー順も `$DefType`（`mergeDefTypes()` の出力）に追従させます**
  - 手書きで追加したフィールドの位置が分からない場合は `npm run data:order:plan` で確認し、`npm run data:order:write` で整列できます
  - CI では `tests/data.field-order.test.js` が全 DB のキー順を検証します
  - 冒頭は `Index → Progress → _DBLinkRef 群 → Name → Images → FormalName → …` の順になります（`$slot` マーカーによる宣言。`docs/schema-meta-processing.md` §5.4.1）
  - `isTriple` / `Regioministration` / `isPrivate` のように**フラグ用にあえて宣言しない**フィールドは、直前の宣言済みキーへアンカーされて元の位置に留まります（整列で末尾へ流されません）

### 3.2 ラベルキー

- 推奨: `hashTag_JP`
- 後方互換: `hashtag_JP`（綴り揺れ吸収）
- どちらも無い場合は、フィールド名がフォールバック表示になります

### 3.3 `$type` の書き方（目安）

- 文字列系: `#String_JP`, `#String_EN`, `#Summary` など
- 数値系: `#Number`
- 配列: `...[]`
- union（複数許容）: `A|B`（例: `#Number|#Number_withAbout[]`）
- 補足付き短文/本文/台詞の配列（例）: `#String[]|#String_withAbout[]|#Null`, `#Summary[]|#Summary_withAbout[]|#Null`, `#Dialogue[]|#Dialogue_withAbout[]|#Null`
- 列挙/辞書参照:
  - enum: `$EnumDef` / `$EnumDef_<Name>`
  - list: `#ListIndex` / `#ListLink`（用途に応じて）

`#String_withAbout` / `#Summary_withAbout` / `#Dialogue_withAbout` 系は、原則として `{ value, about_JP/about_EN/about }` の形を想定します。

例:

```json
{
  "value": "なるほど、その仮説は興味深いですね。",
  "about": "平常時の口調例"
}
```

配列型の `#String_withAbout[]` / `#Summary_withAbout[]` / `#Dialogue_withAbout[]` では、このオブジェクトを複数並べられます。`#String[]|#String_withAbout[]|#Null`、`#Summary[]|#Summary_withAbout[]|#Null`、`#Dialogue[]|#Dialogue_withAbout[]|#Null` のような union では、文字列配列・補足付き配列・null のいずれも許容します。

> 注意: `$type` は UI/SW の挙動にも影響します。迷う場合は既存フィールドの近い例を探して合わせてください。

### 3.4 `$display`（表示ヒント）の運用

表示を変えたい場合は、まず `"$display"` を使って宣言的に調整する方針です。

代表例:

- `section`: `basic/profile/spec/images/other`（表示セクション）
- `unit`: `cm/kg/歳` など（単位表示）
- `enumFormat` / `rankFormat` / `rarityFormat`: 表示形式のヒント
- `auto:false`: 自動表示（スキーマ駆動の列挙）から除外したいとき
- object 形式の `#Index` では、各子要素の `"$display": { "index": { ... } }` で一覧/詳細/値表示/直リンクの対象を宣言できます

`$display.index` の主なキー:

- `list`: 一覧カードの accent chip に含めるか
- `detail`: 詳細ヘッダの pill に含めるか
- `value`: `#Index` フィールド本体を文字列整形するときに含めるか
- `link`: `idx` / `idxKey` 付き直リンクの候補にするか
- `priority`: 複数候補があるときの優先順位（大きいほど優先）
- `order`: 同 priority 内の並び順（小さいほど先）

未指定時の既定値:

- 一覧 chip / 直リンクは「主要」サブ要素のみ
- 詳細 pill / 値表示は非空の全サブ要素

### 3.5 予約語/機械処理キーの命名（フェーズ3）

このDBは、**予約語のプレフィックス（`_` / `$` / `#`）**で「データ」なのか「宣言/機械処理」なのかを機械的に区別できる設計を優先します。

- `_`（手続き/機械処理）
  - 参照解決や補完など、SW/API が特別扱いする制御キーです。
  - 例: `_DBLink`, `_Jump`, `_Search`（データ側の参照解決）、`_Commons`, `_Secondaries`（メタ側の補完）
- `$`（宣言/定義）
  - `db_type.json` / `db_meta.json` 内で「定義」を表すためのキーです。
  - 例: `$DefType`, `$VarsDef`, `$IndexDef`, `$EnumDef_*`
- `#`（辞書キー/特殊型）
  - 辞書エントリや特殊な `$type`（例: `#Index`）などで使います。
  - 例: `#List_RaceType`, `#DB_Primary`

運用上の目安:

- **ユーザーが自由に追加する“通常フィールド”は先頭大文字（例: `Name`, `Age`, `AbilityStats`）を推奨**します。
- 先頭小文字（例: `hashTag`, `key`, `val`）は、API の引数/内部構造で使う前提のキーとして扱い、DBフィールド名には原則使いません。
- サフィックスによる意味づけ（既存運用）:
  - 言語: `_JP`, `_EN`
  - 単位: `_cm`, `_kg` など（可能なら `$display.unit` で宣言的に表現するのを優先）
  - 拡張子/形式: `_PNG`, `_JPG` 等（画像フィールド運用）

---

## 4. `db_meta.json`（メタ定義）更新ルール

### 4.0 `#Enum` / `#List` の `dict_*.json` 分離（推奨）

`#Enum` 相当の候補値（実質的には `#List_*`）は、作品別 `DataBases/db_meta.json` に直書きし続けるのではなく、
可能な限り `data/Works_<作品>/Dictionaries/dict_*.json` へ分離する運用を推奨します。

- 目的:
  - 作品別 enum/list 辞書を独立管理し、差分を追いやすくする
  - 他タイトルでも同じ仕組みを再利用しやすくする
  - SW の辞書合流（`#Dict_*` と `#List_*` 互換）を活用する

このリポジトリには、既存 `#List_*` を `dict_*.json` に切り出す補助ツールがあります。

```powershell
# dry-run（変更なし）
npm run dict:plan-enums

# dict_*.json / Dictionaries/db_meta.json を生成
npm run dict:export-enums

# 生成に加え、元の DataBases/db_meta.json から #List_* を削除
npm run dict:export-enums:prune
```

補足:

- `:prune` は変更量が大きくなるため、必ず差分レビュー後に適用してください。
- 作品を限定する場合は `node tools/extract-enum-lists-to-dictionaries.mjs --work=Works_NumberTales --write` のように実行できます。

### 4.1 インデックス表示/直リンク

- 作品ごとのインデックス（一覧チップ/直リンクの基準）は、作品別 typedef（`data/Works_<作品名>/DataBases/db_type.json`）の `$IndexDef` を更新して追従させます
- `data/db_meta.json(CreationWorks.*.$DefType_Index / $Def_Index)` は廃止され、Index 定義の置き場は typedef 側に集約されました
- object 形式の `$IndexDef` で複数要素を持つ場合、一覧/詳細/値表示/直リンクの対象は各子要素の `$display.index` で制御します
- `idx` / `idxKey` による直リンクは単一 key-path 前提です。`link:true` を付ける子要素は、同一作品/同一DB内で識別に使って問題ないものを優先してください

補足:

- 作品別メタ（`data/Works_<作品>/DataBases/db_meta.json`）が未整備の作品もあります。Service Worker 側は欠損を許容しますが、`_Commons` / `_Secondaries` 等の付加（補完）処理は適用されません。

### 4.1.1 作品/DB カタログの補助 schema

- グローバル `data/db_type.json` のトップレベル `$MetaType` には、`CreationWorks` / `OldTitles` / `DatabaseCatalog` / `StoryEra` の補助 schema 宣言を置きます
- これはキャラクター本体の `$DefType` とは別系統で、作品一覧や DB 一覧、概要 UI で使うメタ項目の宣言面です
- 実データは引き続き `data/db_meta.json(CreationWorks)` と作品別 `db_meta.json(Databases.#DB_*)` に置きます

### 4.2 詳細表示レイアウト

- 詳細の基本情報・ヘッダピル・抑制キーは `CreationWorks.<work>.$DetailLayout` で制御します
- UI 側のハードコードを増やす前に、まずメタで調整できないか検討してください

### 4.3 enum/list の「表示名辞書（JP/EN）」

`$VarsDef` に enum/list の辞書を定義し、UI が raw 値（英語コード等）から日本語表示名へ解決できるようにします。

- enum（例: `GenderType`）: `General.$VarsDef.$EnumDef_GenderType`
- list（例: `RaceType`）: `General.$VarsDef.#List_RaceType`

辞書要素の目安（例）:

```json
{
  "value": "PortableHumanoid(TaleBeastType)",
  "RaceType_JP": "妖獣型ポータブルヒューマノイド",
  "RaceType_EN": "Portable Humanoid (Tale Beast Type)"
}
```

- `*_JP` / `*_EN` のキー名は **フィールド名に合わせる**（例: `RaceType_JP`）
- `value` は DB に格納される raw 値（コード値）と一致させます

補足:

- 実行時には `db_meta.json(General.$VarsDef)` だけでなく `db_type.json($VarsDef)` も合成されます
- 「どちらに置くべきか」を迷う場合は、共有辞書は meta、作品固有の schema と一体で管理したい辞書は typedef 側、を基本にしてください

---

### 4.4 二次創作系DBの `_Commons` / `_Secondaries`（必要な場合）

二次創作 DB（例: `db_Secondary.json`, `db_SelfSecondary.json`）で「一次創作側の共通情報を補完したい」場合、作品別 `db_meta.json` の `_Commons` と `_Secondaries` で宣言的に制御できます。

- `Databases.#DB_<DbName>._Commons`: DB 全体に適用したい共通フィールド（穴埋め）
- `Databases.#DB_<DbName>._Secondaries[]`: `sec_**`（例: `sec_SeriesTitle`, `sec_Category`）で適用する `_Commons` を分岐
- 全ての `sec_**` が `null` / 空のオブジェクトはデフォルト fallback 用として扱われ、`null` 以外の条件を持つオブジェクトが一致した場合はそちらが優先されます。

後方互換:

- 旧キー `Secondaries` も読み取り対象ですが、**正は `_Secondaries`** です（移行期間中は開発者向け警告が出ます）。

注意:

- `sec_Category` 等の条件で分岐したい場合、レコード側にもそのフィールドを持たせ、定義と一致するようにしてください（曖昧な定義は誤適用防止のため適用されません）。

### 4.5 DB カタログ表示名

作品別 `db_meta.json` の `Databases.#DB_<DbName>` では、次のようなカタログ項目を持てます。

- `DB_Label`
- `DB_Label_EN`
- `DB_Summary`
- `StoryEra`
- `SecondarySummary`

用途:

- `DB_Label` / `DB_Label_EN`: DB セレクトや概要ヘッダの表示名
- `DB_Summary`: DB 概要文
- `StoryEra`: DB 単位の年代メモ
- `SecondarySummary`: 二次創作系の補足概要

未定義時は SW 側で既定ラベルへフォールバックしますが、原則として明示定義を推奨します。

## 5. 2言語（JP/EN）フィールド運用ルール（最小）

- `Foo_JP` と `Foo_EN` のようにサフィックスで言語を区別します
- UI/検索が「同じ意味のフィールド」として扱えるよう、命名を揃えるのが前提です
- 同様に `*_JP` 表示名（辞書）を追加する場合も、ベース名を一致させます

---

## 6. 参照解決（`_DBLink` / `_Jump`）を伴う更新時の注意

- `_DBLink` は参照先レコードの同名フィールドを **空値のときだけ穴埋め**します（既存値は上書きしません）
- `{ hideText: "..." }` は意図的マスクなので上書きしません
- 画像系フィールドは **別DB（別JSON）から穴埋めしません**（同一DB内のみ許可）
- ルート `_DBLink` が無いレコードでも、`_Jump` の中に `$Def_DBLinkRef` 形式の `_DBLink` を書けばフィールド単位で参照先を明示できます（`docs/api-sw-spec.md` §8.1 参照）

詳細ルールは `.github/copilot-instructions.md` の「参照マージ」節を正とします。

---

## 7. 画像を追加/更新する場合

- 作品ごとの `data/Works_<作品>/Images/**` 配下へ配置します
- DB 個別画像は `Images/DB_<DbName>/`、References 画像は `Images/Ref_<RefName>/`、作品共通画像は `Images/General/` を使います
- 画像の抽出/表示は `db_type.json` の `$image` 定義や型定義を参照します
- 画像を増やすだけであれば、必ずしも `db_meta.json` 更新は不要です（ただし型定義の設計次第）

---

## 8. 検証（最低限）

### 8.1 自動テスト

```powershell
npm test
npm.cmd test
```

- `tests/data.sanity.test.js`: JSON 構文・存在
- `tests/data.shape.test.js`: スキーマ/メタとの整合
- `tests/data.field-order.test.js`: レコードのキー順が `$DefType` の正準順に追従しているか（`npm run data:order:check` と同等の検証 + `$slot` マーカーの健全性）
- `tests/sw.deftype.slot.test.js`: `$slot` マーカーのマージ規則
- `tests/normalize-field-order.test.js`: 整列ツールの単体（書式非破壊・冪等）
- `tests/sw.enrich.basic.test.js`: enrich と基本エンドポイント
- `tests/enrich.dblink.jump.merge.test.js`: 参照マージの回帰
- `tests/docs.links.test.js`: ドキュメント内の既知誤リンク（例: `pages/characters.html` の単数表記）を継続検知

### 8.2 実機確認（UI/SWに影響する変更の場合）

Service Worker が必要なため、HTTP サーバ配下で確認します。

```powershell
python -m http.server 5500
# -> http://127.0.0.1:5500/pages/characters.html
```

確認観点（最小）:

- 対象作品/DB が読み込める
- 追加フィールドが想定のセクションに表示される（または抑制される）
- 検索/参照解決の回帰がない

---

## 9. PR（変更提案）の最小チェックリスト

- データ更新だけで完結するか（UI/SW 変更が必要か）
- `db_*.json` と `db_type.json` の整合が取れている
- enum/list 辞書が必要なら `db_meta.json($VarsDef)` を更新している
- `npm test` が通っている
- 重要な仕様変更の場合は `CHANGELOG.md` を更新している
