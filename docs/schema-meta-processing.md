# `db_type.json` / `db_meta.json` フィールド宣言と内部処理メモ

このドキュメントは、`data/db_type.json` と `data/db_meta.json`、および作品別 `data/Works_<作品>/DataBases/db_type.json` / `db_meta.json` が、UI / Service Worker / enrich 処理の中でどのように使われるかを整理した技術メモです。

対象読者:

- `db_type.json($DefType)` の宣言が UI 表示へどう反映されるかを追いたい人
- `db_meta.json` の `CreationWorks` / `Databases` / `General.$VarsDef` の責務差を把握したい人
- `_Commons` / `_Secondaries` / `$VarsDef` / `$IndexDef` / `$MetaType` の置き場と使われ方を確認したい人

---

## 1. 先に結論

このリポジトリでは、定義ファイルの優先順位は次のように考えます。

1. 作品別 `db_type.json`
2. グローバル `data/db_type.json`
3. 作品別 `db_meta.json`
4. グローバル `data/db_meta.json`
5. UI / SW の後方互換処理

役割を短く言うと次の通りです。

- `db_type.json`
  - 何というフィールドがあるか
  - そのフィールドをどう解釈するか
  - UI がどのセクションへ置くか
  - index / 画像 / 検索 / `$alt` をどう扱うか
- `db_meta.json`
  - 作品や DB の概要をどう見せるか
  - enum/list の辞書をどう補うか
  - `_Commons` / `_Secondaries` による補完をどう定義するか
  - 詳細表示の補助レイアウトをどう与えるか

つまり、**構造の正は typedef、補助辞書と補完条件は meta** です。

---

## 2. ファイルごとの責務

### 2.1 グローバル `data/db_type.json`

主な責務:

- 全作品で共有する `$DefType`
- 全作品共通の `$VarsDef`
- 全作品共通の `$MetaType`

典型用途:

- 多くの作品で共通に持つトップレベル項目の宣言
- 共通 enum/list 辞書の宣言
- 作品/DB カタログの補助 schema 宣言

### 2.2 作品別 `data/Works_<作品>/DataBases/db_type.json`

主な責務:

- 作品固有フィールドの追加
- グローバル `$DefType` の上書き・補完
- 作品ごとの `$IndexDef`
- 作品固有 `$VarsDef`

典型用途:

- `Num`, `Card`, `BeastType` など作品固有 index の定義
- 作品にだけ存在するスペック項目や画像項目の宣言

### 2.3 グローバル `data/db_meta.json`

主な責務:

- `CreationWorks.<work>` による作品カタログ
- `CreationWorks.<work>.$DetailLayout` による詳細補助レイアウト
- `CreationWorks.<work>.Works_Dir` / `Works_ImagesDir` による物理ディレクトリ名オーバーライド（`Works_<id>` 規約に沿わないフォルダを持つ疑似作品向け。例: 共通資料 `#Works_CommonReferences`）
- `CreationWorks.<work>.Works_Shared` による「個別の創作タイトルではない共通カタログ」フラグ（UI の作品セレクトで別 `<optgroup>` に分離表示）
- `General.$VarsDef` による共通表示辞書の合流先

典型用途:

- 作品名、英語名、作品概要、旧題一覧の保持
- 作品単位での `basicFields` / `headerPills` の制御

補足:

- `Area` / `Belonging` のような共通辞書本体は、`data/Dictionaries/` 配下の辞書 DB へ分離できます。
- SW/UI は `data/db_meta.json` だけを直接参照せず、必要に応じて `data/Dictionaries/db_meta.json` と各 `dict_*.json` を追加ロードして `General.$VarsDef` へ合流します。
- `_Secondaries[]` 要素の補助表示に使う schema は、トップレベル `$MetaType.$Def_SecondaryMeta` へ置けます。

### 2.4 作品別 `data/Works_<作品>/DataBases/db_meta.json`

主な責務:

- `Databases.#DB_<DbName>` による DB カタログ
- `_Commons` / `_Secondaries` による補完ルール
- 作品固有 `General.$VarsDef`
- `SupersededDesignElements` による `AppearanceDetail` の `DesignElement` 廃止宣言（§4.8 参照）

典型用途:

- `DB_Label`, `DB_Summary`, `StoryEra` の定義
- `DB_Layer` による DB 実体の配置レイヤー指定
- `DB_File` による DB 実体ファイル名の明示
- `#Ref_` prefix による資料系 DB の既定ファイル名切り替え
- 二次創作 DB ごとの `_Secondaries` 分岐
- 作品専用 list/link 辞書の補足

補足:

- `Databases.#DB_<DbName>.DB_Layer` を指定すると、SW の DB 読み込みと DB 一覧列挙は `DataBases/` 固定ではなく、そのレイヤー配下を探索します。
- `Databases.#Ref_<RefName>.DB_Layer` を指定すると、同じく指定レイヤー配下を探索しつつ、既定ファイル名は `ref_<RefName>.json` を優先します。
- `Databases.#DB_<DbName>.DB_File` / `Databases.#Ref_<RefName>.DB_File` を指定すると、既定ファイル名よりもそのファイル名を優先して参照します。
- 未指定時は従来どおり `DataBases/` を使うため、既存作品のレイアウトは変更不要です。

### 2.5 グローバル / 作品別 `Dictionaries/`

主な責務:

- 辞書専用 DB カタログ (`db_meta.json`)
- 辞書専用型補助 (`db_type.json`)
- `dict_Area.json`, `dict_Faction.json` のような辞書本体

典型用途:

- トップレベル field 名と無関係に流用したい辞書の分離管理
- `#DictIndex` + `$dict` で参照する共通辞書の保存先
- 作品別辞書追加時に `DataBases/` と分離して管理するための拡張ポイント

命名規則:

- 辞書実体ファイルは `dict_{DictName}.json` を正とします。
- `data/Dictionaries/db_meta.json` の各 `Dictionaries.#Dict_*` では、JSON ファイル選択用の `file` フィールドは持たず、SW/UI が `#Dict_*` 名から自動的に `dict_{DictName}.json` を推論します。

---

## 3. `db_type.json` の宣言面

### 3.1 `$DefType`

`$DefType` はトップレベルのフィールド定義配列です。UI と enrich はまずここを見ます。

典型エントリ:

```json
{
  "hashTag": "RaceType",
  "$type": "#ListIndex|#ListIndex_withAbout[]",
  "hashTag_JP": "種族",
  "$display": {
    "section": "basic",
    "tagSpace": "creation"
  }
}
```

主要キー:

- `hashTag`
  - レコード側のトップレベルキー名
- `$type`
  - 型と表示解釈の宣言
- `hashTag_JP`
  - 既定の日本語ラベル
- `$display`
  - セクションや単位などの表示ヒント
- `$alt`
  - 代替キーからの穴埋め候補
- `$slot`
  - マージ時の配置スロット指定（§5.4.1）。作品側エントリに書くと述語より優先される逃がし弁になる

`$DefType` には `hashTag` を持たない **`$slot` マーカー**も並びます。これは作品固有フィールドの挿入位置を宣言するためのもので、フィールド定義ではありません（`mergeDefTypes()` の結果には含まれません）。詳細は §5.4.1 を参照してください。

### 3.2 `$type`

`$type` は単なる型名ではなく、UI / enrich / 検索で使う解釈ヒントを含みます。

よく使う型:

- `##String_JP`, `##String_EN`
  - 名称・短文系
- `#Summary`
  - 概要・本文系
- `#Number`
  - 数値
- `#String_withAbout`, `#Summary_withAbout`, `#Dialogue_withAbout`
  - `value` と `about_JP/about_EN/about` を持つ補足付き値
- `$Def_TouchReaction`, `$Def_MotifCommentary`
  - **キー付き台詞リスト**。`#Dialogue_bilingual` に「辞書コードのキー項目」を足した形（`{ Action, value_JP, value_EN, about_JP, about_EN }` / `{ Topic, TopicValue, value_JP, … }`）。Bot など外部クライアントがキーで安定して引けるよう、キー項目は生の日本語文字列ではなく `#ListIndex` ＋ `$dict` の辞書コードで持つ。表示は `keyedDialogueSummary` wrapper が `キー：台詞（補足）` へ整形する（`docs/wrapper-summary-registry.md`）
- **`_JP` / `_EN` 分離フィールドの参照**
  - 参照側（`_Jump` の `hashTag`、`_Search` の `hashTag`）は `TypeDefUtils.expandLangAliasCandidates()` で
    「完全一致 → 素の名前 → `_JP` → `_EN`」へ展開されるため、suffix を書かなくても引けます。
    ドットパスの**プレフィックスは保たれ、末尾セグメントだけ**が展開されます。
    `_Jump` は参照元フィールドの suffix を優先言語として使います（`LogicspecAbout_EN` からの参照なら `_EN` が先）。
  - **マスク（`{ hideText }`）は言語非依存**。値が `#List_hideText` の辞書コードなので、
    `_JP` / `_EN` の片方にだけ書けば両言語で表示されます（UI 側の言語ルーティングが
    `isMaskedValue()` で判定し、EN では `_EN` 側の `hashTag_EN` をラベルに使う）。
- `#String_bilingual`, `#Dialogue_bilingual`
  - **和英共有フィールド**。1 要素の中に `value_JP` / `value_EN`（＋補足があれば `about_JP` / `about_EN`）を持ち、フィールド自体は `_JP` / `_EN` へ分けない。配列で和英の要素対応を崩さずに持ちたいときに使う（例: `ConversationPattern.DialogueExamples`、`Works_UnibyteLive` の `StreamingActivity.StreamingCategory` / `StreamingGreeting` / `StreamingAwards`）
  - 表示は `formatValueForDisplay()` がページ言語で `value_JP` / `value_EN` を選ぶ（型名ではなく**値の形**で分岐するため、`_bilingual` は「データの形」を宣言面へ明示するための型名）。1 要素 1 行で出したい配列では union に `_withAbout[]` を併記して改行連結を維持する
- `$EnumDef`, `$EnumDef_<Name>`
  - enum 辞書参照
- `#ListIndex`, `#ListLink`
  - list 辞書参照
- `#DictIndex`
  - 辞書参照。`$dict` に辞書名を持たせる前提で、`Area` / `Belonging` のように field 名と辞書名を切り離したい項目に使う
- `A|B|#Null`
  - union 型
- `...[]`
  - 配列型

内部処理での主用途:

- `TypeDefUtils.looksSearchableType()` による検索対象の推定
- `TypeDefUtils.normalizeValueByTypeSpec()` による軽い正規化
- `TypeDefUtils.looksNumberType()` による index / search 比較

補足:

- `#DictIndex` は「辞書参照である」という宣言を typedef 側に寄せるための型名です。
- `Area` / `Faction` のような共通辞書は、実体を `data/Dictionaries/dict_*.json` へ置き、SW/UI が runtime で `General.$VarsDef` へ合流して使います。
- runtime 合流時には `#Dict_*` を正としつつ、既存実装の互換用に `#List_*` も同じ内容で補完します。
- `#PNGFileName` / `#PNGFilePath` 系フィールドは `$subfolder`（2026-07-10 新設）で画像フォルダの相対パスを明示宣言できます（例: `"$subfolder": "attr/tailsUnit"` → `Images/DB_<DbName>/attr/tailsUnit/`）。未指定の場合は従来通り `TypeDefUtils.inferFolderHintFromKey()` がフィールド名の `_PNG` 接頭辞から推測しますが、`$subfolder` を宣言すればそちらが優先されます。同じ親フォルダ配下を参照フィールドごとにサブフォルダで分けたい場合（`attr/tailsUnit`, `attr/earShape` のように）に使います。
- `#PNGFilePath` / `#PNGFileName` フィールドの値としてDB/Work横断で他の画像フォルダを参照したい場合は、`$Def_DBCrossLinkPath`（2026-07-11 新設、`data/db_type.json` グローバル宣言）を使います。従来の `../../DB_SemiPrimary/...` のような手書き相対パス（ブラウザのURL正規化に依存した非公式な回避策）を廃止し、`{ "_DBCrossLinkPath": { "_DB": "SemiPrimary", "_IsoPath": "..." } }` の形で宣言的に参照します。`_DBLink`（レコード参照機構）とは異なり対象レコードの検索を行わない、パス参照専用の軽量な機構です。詳細は `docs/api-sw-spec.md` §8.3 を参照してください。
- `#VRMFilePath`（2026-07-12 新設、NumberTales `VRMs.corefolder_VRMPath` で使用）は画像ではなく VRM 3Dモデルを指す型です。値の規約は `#PNGFilePath`（フォルダ/拡張子なしファイル名、例: `"16/vrm_corefolder16"`）と同じですが、`Images/` ではなく `VRMs/DB_<DbName>/<category>/` 配下（例: `VRMs/DB_Primary/corefolder/16/vrm_corefolder16.vrm` + 同名 `.png` サムネイル）を指します。`ImageProcessor`/`TypeDefUtils.looksImageType()`/`_enrichment.images` には一切乗らず、`lib/section-renders/vrmViewer.js`（`$display.sectionWrapper: "vrmViewerSection"`）が `helpers.buildVrmAssetUrl`（`pages/characters.js`）経由で独立に解決・表示します。バイナリ資産の種別ごとに専用の型 + section-renderer + URLヘルパーを用意し、既存の画像パイプラインを流用・分岐で汚さない、という今回確立したパターンです。詳細は `docs/wrapper-summary-registry.md` の `vrmViewerSection` を参照してください。

### 3.3 `$display`

`$display` は UI 側の表示ヒントです。コードへ if を増やす前に、まずここで表現できるかを確認します。

主なキー:

- `section`
  - `basic/profile/spec/images/other`
- `unit`
  - 単位表示
- `role`
  - wrapper formatter が子要素を意味単位で読むための役割名
  - 例: `factionCode`（辞書コードを持つ主要素）/ `dialogueKey`（台詞リストのキー項目。`$dict` で辞書名を宣言）/ `dialogueKeyValue`（キーへ連結する数値・識別子。`ライフパス` ＋ `3` → `ライフパス3`）
- `auto:false`
  - 自動表示から除外
- `aliasOf`
  - 表示上の従属関係のヒント
- `tagSpace`
  - タグ系の見せ方の補助
- `wrapper`
  - 特殊 summary formatter を shared registry へ委譲するための識別子
- `index`
  - object 形式 `#Index` の子要素ごとの制御

`$display.index` の主なキー:

- `list`
- `detail`
- `value`
- `link`
- `priority`
- `order`

これは主に `pages/characters.js` と `TypeDefUtils.getIndexDefInfo()` 周辺で使われます。

補足:

- 2026-05-11 時点では `lib/wrapper-common.js` に最小の value wrapper registry を追加し、UI / Service Worker の shared 層で Day / StoryEra などの特殊 summary formatter を登録できるようにした。
- 現段階の built-in wrapper は `daySummary`, `eraSummary`, `storyEraSummary` で、`pages/characters.js` は registry を先に試し、未一致時だけ generic fallback を使う。
- `StoryEra` は `$MetaType.$Def_StoryEraCatalog.$display.wrapper = storyEraSummary` により、characters 側の local formatter ではなく shared registry 経由で summary を組み立てる本格移行を開始した。
- `Era` も `$MetaType.$Def_StoryEra.$display.wrapper = eraSummary` として shared registry に寄せ、将来 standalone field として露出しても同じ handler シグネチャを再利用できるようにした。
- wrapper handler の最小シグネチャは `format(value, context)` で、`context` は `schemaType`, `defName`, `typeSources`, `helpers` を持つ。戻り値が空文字のときだけ呼び出し側が generic fallback を使う。
- `EnrichmentProcessor` は `wrapper` を持つ top-level field を `_enrichment.wrapperSummaries` へ集約し、SW/UI が summary を再利用できるようにした。現時点では `BirthDay`, `StoryEra` などが対象になる。
- DB カタログ側の summary 生成も `lib/sw-common.js` 内の `StoryEra` 直書きではなく、`$MetaType.$Def_DatabaseCatalog.$DefType` を見て wrapper を持つ項目を `${hashTag}Summary` として追加する方式へ寄せた。

### 3.4 `$VarsDef`

`$VarsDef` は enum/list 辞書です。`db_meta.json(General.$VarsDef)` だけでなく `db_type.json($VarsDef)` 側にも置けます。

よくある形:

```json
"$VarsDef": {
  "$EnumDef_Progress": {
    "#Progress_Released": {
      "Progress": "released",
      "Progress_JP": "公開済み"
    }
  },
  "#List_RaceType": [
    {
      "RaceType": "PortableHumanoid(TaleBeastType)",
      "RaceType_JP": "妖獣型ポータブルヒューマノイド"
    }
  ]
}
```

内部処理では次の用途があります。

- SW の `mergeMetaAndTypeVars()` が `db_meta.json` の辞書と合成する
- `EnrichmentProcessor.getWorkContext()` が global/work の meta/type すべてから辞書を合成する
- `#ListLink_*` の補助情報を wrapper object に補完する

補足:

- `#List_*` は既存の list 辞書キーです。
- `#Dict_*` は辞書 DB 由来の正式キーとして扱い、runtime では必要に応じて `#List_*` へも互換展開します。
- `#DictIndex` を宣言した field は、`$dict` 名に対応する辞書 DB を参照できれば field 名そのものに縛られません。
- global（`data/Dictionaries/`）と作品別（`data/Works_<work>/Dictionaries/`）で同名の `#List_*`/`#Dict_*`（同じ `compatListKey`）を持つ辞書が両方存在する場合、`pages/characters.js` の `mergeVarsDefLayers()` が「配列は連結・objectは浅いマージ」で合成します。片方が丸ごと消える上書きにはなりません（`Dictionaries` カタログ自体も同様に合成されます）。

#### 3.4.1 辞書ファイル単位のスコープ条件（`scopeField`）

- `data/Dictionaries/db_meta.json`（または作品別 `Dictionaries/db_meta.json`）のカタログエントリ（`Dictionaries.#Dict_*`）に任意で `scopeField`（`{ フィールド名: 値, ... }` 形式のオブジェクト）を宣言すると、**その辞書ファイル1本まるごと**を「指定フィールドが指定値のキャラクター向け」として扱えます。複数キーを指定した場合は AND 条件です。
  ```json
  "#Dict_SymphonyXVI": {
    "keyField": "Class",
    "compatListKey": "#List_Class",
    "scopeField": { "Belonging": "シンフォニー.XVI(ゼクズィン)" }
  }
  ```
- 辞書本体（`dict_*.json`）側には行ごとにタグを書きません。`scopeField` の内容は、読み込み時（`lib/sw-common.js` の `readDictionaryBundle()` / `pages/characters.js` の `fetchDirectDictionaryBundle()` / テストの `loadDictionaryBundle()`）に辞書の全行へ自動合成されます（行が同名キーを既に持つ場合は行の値を優先）。
- `scopeField` を持たない辞書（大多数）の行は「スコープを問わない共通行」として扱われます。
- 解決順（`pages/characters.js` の `resolveVarsDefLabelPack()`）は「同一レコードの対応フィールド値と `scopeField` が一致する辞書由来の行 → 一致が無ければ `scopeField` を持たない共通行」です。呼び出し元が `recordContext`（対象レコード自体）を渡さない場合は従来通りスコープを無視して全行から探索するため、既存の呼び出し元への後方互換があります。
- `scopeField` は特定のフィールド名にベタ書きしない汎用の宣言なので、`Belonging` 以外のフィールドを軸にした辞書分岐にも流用できます。

### 3.5 `$IndexDef`

`$IndexDef` は作品別 typedef 側に置くのが現在の正です。旧メタの `$DefType_Index` / `$Def_Index` は後方互換の読み取りのみです。

主用途:

- 一覧 chip の主要 index 表示
- 詳細 header pill の表示
- `idx` / `idxKey` 付き直リンク
- `#Index` の値整形
- index ベース検索比較

内部処理では `EnrichmentProcessor.getWorkContext()` が、まず `workType.$IndexDef` を見て、無ければ旧メタ互換にフォールバックします。

#### 3.5.1 DB単位の上書き（サイドカーキー `$IndexDef_<DbNorm>`、2026-07-11 新設）

`$IndexDef` は本来 Work単位の1宣言ですが、同一Work内の複数DBがそれぞれ異なる意味のIndexを持つ場合（例: 「運命線狐の記録」の `Primary` DBは理学単位 `Unit`、`Proxy` DBは代理世代 `Generation`）、`db_type.json` トップレベルに `$IndexDef_<DbNorm>` を追加宣言することで、DB単位に上書きできます。`DbNorm` は DB名から `#DB_` / `#Ref_` / `#Loc_` prefix を除去し先頭を大文字化したもの（例: `Proxy`, `Primary`）です。

```jsonc
{
  "$IndexDef": { "hashTag": "Unit", "$type": "#String", ... },        // 既定値（Primary 相当）
  "$IndexDef_Proxy": { "hashTag": "Generation", "$type": "#Number", ... }, // Proxy DB専用の上書き
  "$DefType": [ ... ]
}
```

この命名規則は `pkg/cloudflare/scripts/migrate.mjs` の `$IndexDef_${dbNorm}`（D1インデックス投入時のIndex解決）に先行実装があり、GitHub Pages側（`lib/data-common.js` の `EnrichmentProcessor.resolveIndexDefForDb()`、`pages/characters.js` の `getWorkIndexField()`）もこれに合わせています。

- `$IndexDef_<DbNorm>` が未宣言のDB/作品は、常に Work既定の `$IndexDef` にフォールバックします（既存作品は無変化）。
- `resolveIndexDefForDb(ctx, dbName)` は `enrichRecords()` / `searchRecords()` / `normalizeRecordByTypeDef()` の `#Index` 正規化・整形すべてで共通に使われます。
- UI側 `getWorkIndexField(workKey, globalMeta, dbName)` も同じ規則で `state.workTypeDef` からDB固有Indexを解決します。

#### 3.5.2 エイリアスIndex（複数Index、2026-07-13 新設）

1レコードが主Indexに加えて互換番号・別体系の識別子を持つ場合（例: アンオースドロジカの `LogicAlt`）、`$DefType` のトップレベルで `#Index` 型を宣言した field は、現在のDBで解決された `$IndexDef` の rootKey **以外**であれば自動的に「エイリアスIndex」として扱われます。専用の宣言キーは不要です。

```jsonc
// data/Works_UnauthedLogica/DataBases/db_type.json
{
  "$IndexDef":             { "hashTag": "Model", ... },   // Primary 系の主Index
  "$IndexDef_PrimaryMobs": { "hashTag": "Logic", ... },   // Mobs 系の主Index
  "$DefType": [
    { "hashTag": "Model",    "$type": "#Index", ... },
    { "hashTag": "Logic",    "$type": "#Index", ... },
    { "hashTag": "LogicAlt", "$type": "#Index", "hashTag_JP": "互換論理/互換ロジック", ... }
  ]
}
```

挙動（`lib/data-common.js` の `TypeDefUtils.collectIndexAliasDefs()` / UI側 `pages/characters.js` の `getWorkIndexAliasDefs()`）:

- **形状の解決順**: hashTag が一致する `$IndexDef` / `$IndexDef_*` 宣言があればその形状（サブフィールド構造）を継承し、無ければ現在のDBの `$IndexDef` の形状を流用します（`LogicAlt` は `Logic` と同構造とみなす）。
- **正規化・辞書補完**: `enrichRecords()` は主Indexと同様に、エイリアス field も per-field の IndexDef で正規化し、`supplementIndexFieldFromVarsDef()` による辞書補完（`<key>_JP` / `_EN` の穴埋め）を適用します。
- **表示**: 詳細 header pill に「エイリアスラベル + サブフィールドラベル」で表示されます。一覧 chip には出しません（主Indexのみ）。
- **直リンク**: `idx=<値>&idxKey=<エイリアスfield名>.<subKey>`（例: `idx=141&idxKey=LogicAlt.Num`）で解決できます。
- **opt-out**: `$DefType` エントリ側に `$display: { "index": "none" }`（または `false`）を宣言すると、エイリアスとして扱いません。
- レコード上にエイリアス field の実体が無い場合は何も表示・照合されません。

#### 3.5.3 `#IndexListKey` の辞書解決と null キー（2026-07-13 拡張）

`$IndexDef` サブフィールドの `#IndexListKey`（後方互換: `#ListIndex`）は、`supplementIndexFieldFromVarsDef()` が辞書から兄弟サブフィールド・言語バリアントを補完します。辞書リストの解決順は次の通りです。

1. `mergedVars.$Def_<rootKey>.#List_<keyField>`（`$Def_*` コンテキスト配下の宣言。従来からの正）
2. `mergedVars.#List_<keyField>`（`Dictionaries/` の `compatListKey` によるルート実行時合流先）
3. `mergedVars.#Dict_<keyField>`（`compatListKey` 未宣言の辞書カタログ）

これにより、運命線探偵78の `Suit` やアンオースドロジカの `(Model|Logic)Series` のような「`Dictionaries/dict_*.json` に本体を置く辞書」がそのままIndex辞書として機能します（`Dictionaries/db_meta.json` のカタログ登録が必要です）。

さらに **null もキーとして許容**します。キー値が `null` のレコード（例: `Model: { ModelSeries: null, Num: "0" }`）は、辞書側に null キー行が宣言されている場合のみ解決されます。

```jsonc
// data/Works_UnauthedLogica/Dictionaries/dict_ModelSeries.json（null キー行の例）
[
  { "ModelSeries": "AttackerZeroid", "ModelSeries_JP": "人形兵ゼロイド" },
  { "ModelSeries": "notModel", "ModelSeries_JP": "<系統なしのラベル>" },
]
```

- enrich では null キー行の `<key>_JP` / `_EN` が言語バリアントとして補完されます（主キー値の `null` 自体は維持）。
- UI（`collectIndexEntries()`）では null キーのエントリは「表示のみ」（詳細 pill / 値表示）で、単独では直リンクの識別に使いません。
- 辞書に null キー行が無い場合は従来通りスキップされます（表示なし・エラーなし）。

> **既知の修正（2026-07-13）**: `TypeDefUtils.normalizeValueByTypeSpec()` の `#Index` 正規化が、ネストIndexのフィールド値を rootKey で二重に包んでしまう（`Card: {Card:{...}}`）バグがあり、ネストIndexを持つ全作品で一覧 chip・直リンク照合・辞書補完が外れていました。現在はフィールド値を「サブフィールドを直接持つオブジェクト」（`Card: {Suit, Num}`）に正規化し、旧形の二重ネストは読み込み時に unwrap されます。

### 3.6 `$MetaType`

トップレベル `$MetaType` は、作品/DB カタログの補助 schema 宣言です。キャラクター本体の `$DefType` と別系統です。

現状の主な定義:

- `$Def_StoryEra`
- `$Def_CreationWorkCatalog`
- `$Def_OldTitleCatalog`
- `$Def_DatabaseCatalog`
- `$Def_StoryEraCatalog`
- `$Def_SupersededDesignElement`（§4.8 参照）

`$Def_DatabaseCatalog` は現在、`DB_Label`, `DB_Label_EN`, `DB_Summary`, `DB_Layer`, `DB_File`, `StoryEra`, `SecondarySummary` を補助宣言します。catalog key 自体は `#DB_*` に加えて資料系の `#Ref_*` も許容します。

用途:

- `CreationWorks` / `Databases` のメタ項目を docs 上で明示する
- 今後の API / UI 拡張時に「どのメタキーが正式扱いか」を共有する

### 3.7 `$ScalarDef`

`data/db_type.json` のトップレベル `$ScalarDef` は、**基底スカラー型のパターン・フォーマット制約**を宣言します（2026-06-29 追加）。

`$DefType` の `$type` 文字列から参照される型エイリアスの一種ですが、フィールド定義（`$DefType`）ではなく「型そのもの」を定義するための場所です。

現状の定義:

- `#Hexcode` — カラーコード基底型（`pattern: "^#[0-9A-Fa-f]+"` など制約を持つ）
- `#Hexcode_Color` — `extends: "#Hexcode"` + 6/8桁 hex 限定パターン（`^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$`）

利用方法:

- `$Def_AppearanceAttr` の `value_Color` フィールドなどが `#Hexcode_Color` を参照する前提で設計されています。
- UI 側のバリデーションや表示ヒントに使えますが、現時点では表示処理への組み込みは段階的な予定です。

---

## 4. `db_meta.json` の宣言面

### 4.1 `CreationWorks`

グローバル `data/db_meta.json` に置く作品カタログです。

主なキー:

- `Title`
- `Title_EN`
- `Works_Summary`
- `OldTitles[]`
- `$DetailLayout`
- `Works_Dir` / `Works_ImagesDir`（物理ディレクトリ名オーバーライド。省略時は既定の `Works_<id>` / `<workDir>/Images` を使う。詳細は `docs/api-sw-spec.md` §5.5）
- `Works_Shared`（個別の創作タイトルではない共通カタログであることを示すフラグ）

この情報は `StandardEndpointHandlers.buildWorkCatalogEntry()` で works 系 API へ正規化されます。

### 4.2 `$DetailLayout`

`CreationWorks.<work>.$DetailLayout` は、UI 側の詳細表示で補助的に使います。

主なキー:

- `headerPills`
  - 詳細上部の pill 群に出す項目
- `basicFields`
  - basic セクションへ優先表示する項目（`$slotAnchor` 経由で、作品固有フィールドの `$DefType` 上の位置も決める。§5.4.1）
- `subFields`
  - 詳細画面で独立セクションとして描画する項目（`$slotOrder` 経由で `$DefType` の catch-all スロット内の並びも決める。§5.4.1）

注意点:

- **グローバル宣言フィールドの表示順の正は `$DefType`**。`$DetailLayout` は「どれを出すか」の選択を担い、並び順は `$DefType` に揃える（2026-07-17 に `basicFields` を全 9 作品分 `$DefType` 順へ整列済み。以後もこの一致を保つこと）
- **作品別 typedef で宣言されたフィールドは `$DetailLayout` が位置の正**。グローバル `$DefType` に宣言が無いため `$DefType` 側に「揃えるべき位置」が存在しない
  - `basicFields` に載るもの（`TailsUnit` / `Generation` / `ForMasterCalling` / `For*DealerCalling` 等）は `#WorkBasic` マーカーの `$slotAnchor` が **`basicFields` 上の直前の隣人の直後**へ配置する
  - `subFields` に載るもの（`NumerospecStats` / `ChronoholderName` / `Relation` 等）は `#WorkRest` の `$slotOrder` が catch-all スロット内の並びを決める
- `Belonging` などの補助項目は、`basicFields` にすでに含まれている場合は UI 側で重複抑制される
- **両方に載るキーは「表示」と「キー順」で正が分かれる**（現状 `Works_NumberTales` の `TailsUnit` のみ）
  - 表示: `subFields` が勝つ。UI の「1項目1箇所の原則」（`pages/characters.js` の `isPromotedSubFieldKey`）が基本情報テーブル側の行を抑制するため、`tailsUnitSection` にしか出ない
  - キー順: `basicFields` が勝つ（`$slotAnchor` は `#WorkRest` より前に評価される）。`TailsUnit` は `BustSize` の直後に置かれる
  - この不一致は User 判断による意図的なもの（尺味・体型系の基本属性としてデータ上はまとめたい / 2026-07-17）。「表示順とキー順を揃える」原則の例外なので、揃える方向へ直す場合は `basicFields` から `TailsUnit` を外す

### 4.3 `Databases.#DB_<DbName>`

作品別 `db_meta.json` の DB カタログです。

主なキー:

- `DB_Label`
- `DB_Label_EN`
- `DB_Summary`
- `DB_Layer`
- `DB_File`
- `StoryEra`
- `SecondarySummary`
- `DB_Image`
- `_Commons`
- `_Secondaries`

`DB_Label` / `DB_Label_EN` は、works/{work}/db 一覧と UI の DB セレクト・概要ヘッダで使われます。未定義時は `StandardEndpointHandlers.buildDefaultDatabaseCatalogLabels()` が既定ラベルを補います。

`DB_Layer` は DB 実体の配置ディレクトリを表す補助キーで、未指定時は `DataBases` とみなされます。`Glossaries` や `References` を段階導入する際の入口として使います。

`#Ref_*` は資料系 DB 用の catalog key で、未指定の実体名を `ref_<Name>.json` として扱います。たとえば `#Ref_Glossary` は `References/ref_Glossary.json` を既定候補として引きます。

`DB_File` は DB 実体のファイル名を表す補助キーで、未指定時は `#DB_*` なら `db_<DbName>.json`、`#Ref_*` なら `ref_<Name>.json` を使います。既定名から外したい場合だけ明示します。

画像ディレクトリ名もこの catalog key 系に揃え、通常 DB は `Images/DB_<DbName>/...`、資料系 DB は `Images/Ref_<RefName>/...` を既定とします。作品共通画像のみ `Images/General/` を使います。

資料系 DB の画像定義は shared `data/References/db_type.json` を土台にしつつ、作品別 `References/db_type.json` の `Images.*` 宣言で上書きや追加を行えます。UI の画像解決では、この 2 層を合流したうえで field 名から folder hint を導出し、DB 固有名のハードコード追加を避けます。

`DB_Image` は特定レコードに紐づかない、DB全体の代表画像（俯瞰画像・DBアイコン等）のファイル名を表す補助キーです。`works/{work}/db` 応答へそのまま含まれ、UI の DB 概要欄（`renderSelectionMeta()`）に表示されます。per-record画像フィールドのようなフォルダ推論（`extractImageFields`系）は行わず、画像ディレクトリ（`Images/DB_<DbName>/` または `Images/Ref_<RefName>/`、共通資料の疑似作品では `Works_ImagesDir` オーバーライド先）直下のファイル名として直接解決します。

`DB_Layer` が作品の物理ディレクトリ名（`Works_Dir` オーバーライド解決後）自身と一致する場合、SW/Workers/migrateの各実装はレイヤーセグメントをパスから畳み込みます（`docs/api-sw-spec.md` §5.5参照）。これは共通資料の疑似作品（`Works_Dir: "References"` + `DB_Layer: "References"`）のように、`DataBases/`のような追加サブフォルダを持たないフラットなレイアウトの作品を扱うための規則で、通常の作品（`DB_Layer`が`Works_<Name>`と一致することはない）には影響しません。

### 4.4 `StoryEra`

`StoryEra` は厳密な日付型ではなく、物語年代を表す構造化メタです。

`data/db_type.json` のトップレベル `$MetaType` では、まず単点の年代要素を表す `$Def_StoryEra` を持ち、その配列を束ねる形で `$Def_StoryEraCatalog` を定義します。

`$Def_StoryEra` の主なキー:

- `EraGen`
- `YearInEra`
- `byRealYear`
- `about_JP`
- `about_EN`

よく使うキー:

- `FromEra`
- `ToEra`
- `InEra`
- `about_JP`
- `about_EN`

考え方:

- `FromEra` / `ToEra` / `InEra` は、いずれも `$Def_StoryEra[]` を要素とする配列です
- 1 つの年代について「創作内の紀年」と「現実年換算」を並列表現できるよう、`EraGen` / `YearInEra` と `byRealYear` を同居させます
- `about_JP` / `about_EN` は、人手で整えた概要ラベルを優先表示したい場合の補助です

UI 側は厳密構造より `about_JP` / `about_EN` を優先して整形表示します。
`about_*` が未指定の場合は、現状の `pages/characters.js` では `InEra` を優先し、無ければ `FromEra` / `ToEra` から簡易 summary を自動生成します。

2026-05-11 時点では、`$Def_StoryEraCatalog` / `$Def_StoryEra` / `$Def_Day` に `$display.role` を導入し、summary 組み立ての優先順位を schema から参照できるようにし始めています。

現在の role:

- `$Def_StoryEraCatalog.FromEra`: `rangeStart`
- `$Def_StoryEraCatalog.ToEra`: `rangeEnd`
- `$Def_StoryEraCatalog.InEra`: `representativePoint`
- `$Def_StoryEraCatalog.about_JP`: `preferredLabel`
- `$Def_StoryEraCatalog.about_EN`: `preferredLabelAlt`
- `$Def_StoryEra.EraGen`: `eraGeneration`
- `$Def_StoryEra.YearInEra`: `eraYear`
- `$Def_StoryEra.byRealYear`: `realYear`
- `$Def_StoryEra.about_JP`: `pointLabel`
- `$Def_StoryEra.about_EN`: `pointLabelAlt`
- `$Def_Day.Month`: `month`
- `$Def_Day.DayOfMonth`: `dayOfMonth`
- `$Def_Day.DayAbout`: `annotation`

ただし `Day` は実データが `Day: { Month, DayOfMonth }` のラッパーを持つため、現段階では role 解釈と既存 shape 互換の併用です。

### 4.5 `General.$VarsDef`

`db_meta.json` 側の `General.$VarsDef` は、表示辞書の最も古い置き場です。現在でも重要ですが、`db_type.json($VarsDef)` と分散配置される前提です。

そのため実行時には、**meta だけ見ても辞書が完結しない** 場合があります。

`$VarsDef` には enum 辞書（`$EnumDef_*`）だけでなく、**複合オブジェクト型の `$DefType` 定義**を持つオブジェクト（`$Def_*` キー）も置けます。

例（`data/db_meta.json` に置かれているカスタム型）:

- `$Def_AppearanceDetail` — `Formation` / `BodyPart` / `DesignElement` / `Attrs` 等を持つ外見デザイン詳細エントリ
- `$Def_AppearanceAttr` — `AttrLabel` + 規約駆動フィールド（`vdict_*` / `value_*` / `about_*`）を持つ属性行
- `$Def_BaseArea` — `Area`（`#DictIndex` / `$dict: "Area"`）+ `BaseAreaAbout_JP/EN` を持つ活動地域エントリ（`$display.wrapper: "baseAreaSummary"`）
- `$Def_Faction`（2026-07-29 新設）— `Faction`（`#DictIndex` / `$dict: "Faction"`）と、そこから参照解決する `FactionsBaseArea`（`$Def_BaseArea`）を持つ所属エントリ

`$Def_Faction` で導入した宣言（他の `$Def_*` でも同じ意味で使えます）:

- `$dictRef: { from: "<兄弟の子要素名>", field: "<辞書行のキー>" }`
  - 「`from` の子要素が引く辞書行から `field` の値を持ってくる」宣言。レコードには持たせず、辞書側で一元管理したい値に使う
  - 解決結果は enrich の `_enrichment.dictRefs` へ載り、UI では `lib/basic-renders/faction.js` が表示へ反映する（レコード本体の形は変えない）
  - レコード側が同名の子要素に実値を持つ場合はそちらを優先する（辞書値で上書きしない）
- `$shorthand: "<子要素名>"`
  - 「生のスカラー値はこの子要素とみなす」後方互換宣言。旧形式 `"Belonging": ["百花繚乱研究所"]` を `{ Faction: "百花繚乱研究所" }` と同じ経路で解釈できる
- `$display.arrayLayout: "multiline" | "inline"`
  - 配列値を UI でどう連結するか（既定は宣言どおり、`multiline` なら 1 要素 1 行）

例（`data/db_meta.json`）:

```jsonc
"$Def_Faction": {
  "$DefType": [
    { "hashTag": "Faction", "$type": "#DictIndex", "$dict": "Faction", "$display": { "role": "factionCode" } },
    {
      "hashTag": "FactionsBaseArea",
      "$type": "$Def_BaseArea",
      "$dictRef": { "from": "Faction", "field": "FactionsBaseArea" },
      "$display": { "role": "factionArea" }
    }
  ],
  "$shorthand": "Faction",
  "$display": { "wrapper": "factionSummary", "arrayLayout": "multiline" }
}
```

これらは `db_type.json($DefType)` の `$type` 文字列（例: `"$Def_AppearanceDetail[]|#Null"`）から参照されます。UI / SW はこの `$type` 参照を辿って `$DefType` を解決します。

### 4.6 `_Commons`

`_Commons` は、同一 DB のレコードへ一律に穴埋めしたい共通フィールドです。

例:

- 所属の既定値
- 種族の既定値
- list 条件に応じた補助 class 名

内部処理では `CommonsProcessor.applyCommonsToRecords()` が適用します。

ルール:

- 空値だけ埋める
- 作品別 `db_meta.json` 欠損時はスキップする
- DB 本体の取得や検索は止めない

### 4.7 `_Secondaries`

`_Secondaries[]` は、`sec_**` 条件ごとに `_Commons` を切り替える定義です。

マッチングの考え方:

- すべての `sec_**` が `null` / 空の要素は fallback
- 条件付き要素が一致したらそちらを優先
- 曖昧な条件は誤適用しないように扱う
- `sec_SeriesTitle` で要素が特定できた場合は、その要素の `sec_Category` / `sec_DesignedBy` も空欄時にレコードへ補完できる
- UI 側の二次創作 meta 表示は、必要に応じて `$MetaType.$Def_SecondaryMeta` を参照して項目とラベルを決められる

これは主に `Secondary` / `SelfSecondary` のような二次創作系 DB で使います。

### 4.8 `isForSecondary` の三値スコープ

typedef の `isForSecondary` は、DB 文脈ごとの表示・参照マージ範囲を次の三値で表します。

- `null`（または未指定）: 一次創作・二次創作の両方に共通
- `true`: 二次創作系 DB 専用
- `false`: 一次創作系 DB 専用

UI の typedef 抽出と `_DBLink` の enrich マージは同じ判定を使います。共通フィールドへ `false` を置くと、Secondary 文脈の schema 抽出・参照マージから外れるため、共通の Relation やそのサブフィールドには `null` を明示します。

### 4.9 `SupersededDesignElements`

`AppearanceDetail[].DesignElement` の特定の値を、汎用カタログ運用から専用構造化フィールドへ移行（廃止）した際、そのことを宣言するための作品別トップレベルキーです（`Databases`/`General` と同じ階層）。型は `$MetaType.$Def_SupersededDesignElement`（§3.6）で宣言し、データは各作品の `db_meta.json` に配列で持たせます。

背景: `TailsUnit`（尻尾）が `AppearanceDetail[].DesignElement:"#Element_TailsUnit"` から専用フィールド `TailsUnit`（`$Def_TailsUnit[]`）へ移行した際、この宣言機構が無かったため、テスト・ドキュメント・`addon-ai-tag` 側の AIHints ツールの複数箇所で個別に手作業クリーンアップが必要になり、一部（`tools/patch-aihints.mjs` の分類マップ等）に廃止済みキーへの参照が残っていた。以後、同様の移行を行う際はこの宣言を追加することで、テスト（`tests/data.shape.test.js`）が自動的に汎用チェックできるようにする。

例（NumberTales `data/Works_NumberTales/DataBases/db_meta.json`）:

```json
"SupersededDesignElements": [
  {
    "DesignElement": "#Element_TailsUnit",
    "SupersededByField": "TailsUnit",
    "SupersededByType": "$Def_TailsUnit[]",
    "SupersededDate": "2026-07-07",
    "Note_JP": "尻尾の形状情報は AppearanceDetail(#Element_TailsUnit) から専用構造化フィールド TailsUnit($Def_TailsUnit[]) へ全面移行済み。",
    "Note_EN": "Tail shape info was fully migrated from AppearanceDetail (#Element_TailsUnit) to the dedicated TailsUnit ($Def_TailsUnit[]) field."
  }
]
```

`tests/data.shape.test.js` の `SupersededDesignElement schema` テスト群は、この配列に列挙された `DesignElement` 値が、対象作品のどの DB ファイルの `AppearanceDetail[]` にも一件も使われていないことを機械的に検証します。新しい `DesignElement` を廃止する際は、この配列へ1行追加するだけでテストが自動的に追従します（テストコード側の個別追記は不要）。

---

## 5. 実行時の合流順

### 5.1 works/db カタログ系 API

`lib/sw-common.js` の `StandardEndpointHandlers` が担当します。

主な流れ:

1. `readGlobalMeta()` で `CreationWorks` を読む
2. `buildWorkCatalogEntry()` で `Title` などを整形する
3. `listWorkDBs()` で `db_*.json` 一覧を作る
4. 作品別 `readWorkMeta()` が読めれば `decorateDatabaseCatalogEntries()` で `DB_Label` / `DB_Summary` / `StoryEra` を付与する
5. 作品別 meta が欠損していれば bare な DB 一覧だけ返す

ここで使われる宣言面:

- `data/db_meta.json -> CreationWorks.*`
- `data/Works_<作品>/DataBases/db_meta.json -> Databases.#DB_*`

### 5.2 `deftype` / `varsdef` の合流

`ApiEndpointHandlers.mergeMetaAndTypeVars()` は、`db_meta.json` と `db_type.json` の辞書面を API 用に合流します。

合流対象:

- `meta.General.$VarsDef`
- `type.$VarsDef`

重要:

- これは `$DefType` 全体を混ぜる処理ではない
- 目的は「表示辞書を API 利用側から見やすくすること」

### 5.3 enrich / search 用 work context の構築

`lib/data-common.js` の `EnrichmentProcessor.getWorkContext()` が中心です。

読み込むもの:

1. グローバル `db_meta.json(General.$VarsDef)`
2. 作品別 `db_meta.json(General.$VarsDef)`
3. グローバル `db_type.json($VarsDef)`
4. 作品別 `db_type.json($VarsDef)`
5. グローバル `db_type.json($DefType)`
6. 作品別 `db_type.json($DefType)`
7. 必要に応じてグローバル `db_meta.json(CreationWorks.<work>)`

そこから作るもの:

- `mergedVars`
- `defTypeMerged`
- `indices`
- `indexDef`

`indexDef` の優先順位:

1. `workType.$IndexDef`
2. `globalMeta.CreationWorks.<work>.$DefType_Index`
3. `globalMeta.CreationWorks.<work>.$Def_Index`

補足（2026-07-11）: `getWorkContext()` が返す `ctx.indexDef` は「work既定」の値です。DB単位の解決が必要な箇所（`enrichRecords()` / `searchRecords()` / `normalizeRecordByTypeDef()`）は、`ctx.indexDef` を直接使わず `EnrichmentProcessor.resolveIndexDefForDb(ctx, dbName)` を経由します。これは `ctx.workType` から `$IndexDef_<DbNorm>`（§3.5.1）を先に探し、無ければ `ctx.indexDef` にフォールバックします。

補足（2026-07-10）: `indices.imagePathHints` を作る `TypeDefUtils.buildImagePathHints()` は、`$type` が配列のインラインネスト（例: `Images` フィールド）だけでなく、`"$Def_TailsUnit[]"` のような名前付き型参照文字列も `CharacterValueWrapperRegistry.helpers.resolveTypeDefEntries()`（`lib/wrapper-common.js`、SW側は `importScripts` で先に読み込まれるため同一グローバルスコープから参照可能）経由で解決し、内部の画像フィールドまで再帰的に辿ります。これにより `$Def_TailsUnit.TailsUnit_PNGName` や `$Def_AppearanceDetail.img_PNGName` のような、名前付き構造化型の内部に宣言された画像フィールドも typedef 駆動で自動検出されます。

### 5.4 `$DefType` マージ

`TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout })` が、グローバルと作品別 `$DefType` を結合します。

方針:

- グローバルの並び順を土台にする
- 同じ `hashTag` は作品側定義で上書きする（位置はグローバルのまま）
- 作品側だけにある `hashTag` は、グローバルが宣言した **`$slot` マーカー**の位置へ挿す（§5.4.1）
- `$slot` マーカーが 1 つも無ければ、従来どおり作品側だけの `hashTag` を**末尾追加**する（後方互換）

結果:

- UI や enrich から見た「その作品の最終的な `$DefType`」を 1 つにできる
- レコードのキー順もこの正準順に追従させる（`tools/normalize-field-order.mjs` / §5.4.3）

#### 5.4.1 `$slot` マーカー

`Index`（作品ごとに `hashTag` が異なる）・`Images`・作品固有 `_DBLink` はグローバル `$DefType` に宣言が無いため、従来の「作品固有は末尾追加」では常に末尾へ落ちていました。位置をツール側の field 名ハードコードで持つのではなく、schema で宣言するための仕組みが `$slot` マーカーです。

マーカーは **`hashTag` を持たないエントリ**としてグローバル `$DefType` に置きます。既存の `$DefType` 走査はいずれも `hashTag` falsy を `continue` するため、下流からは不可視です。`mergeDefTypes()` はマーカーを結果に含めません。

```jsonc
// data/db_type.json の $DefType
{ "$slot": "#Index", "$slotMatch": { "$type": "#Index" }, "$slotNote": "..." }
```

`$slotMatch` の語彙は 5 種のみです（表現力を意図的に低く保ち、field 名依存の分岐へ逆戻りさせないため）:

| 述語                               | 意味                                                                                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "$type": "<str>" }`             | `$type` の**完全一致**（文字列型のみ）                                                                                                                                                                               |
| `{ "$typeIncludes": "<str>" }`     | `$type` の**部分一致**。`$Def_DBLinkRef[]\|#Null` と `$Def_DBLinkRef\|#Null` の両形を拾う                                                                                                                            |
| `{ "$display": { "<k>": "<v>" } }` | `$display` の**浅い部分集合一致**                                                                                                                                                                                    |
| `{ "$inLayout": "<path>" }`        | `$DetailLayout` の宣言配列に載っているか（例: `"basicFields"`）。base 名で突き合わせる（宣言配列は `ChronoholderName`、実フィールドは `_JP` / `_EN`）。`detailLayout` 未指定なら**一致しない**（catch-all へ落ちる） |
| `"*"`                              | catch-all（**厳密に 1 個必須**）                                                                                                                                                                                     |

補助キー:

- `$slotExpand`: ドット区切りパスが指す定義の `$DefType` をその位置へ展開する（例: `"$MetaType.$Def_SecondaryMeta"` → `sec_*` をトップレベル `$DefType` へ再掲せずに順序へ組み込む）
- `$slotOrder`: そのスロット内の並びを `$DetailLayout` の宣言配列へ寄せる（例: `"subFields"` → 詳細画面のセクション順とデータのキー順を揃える）。解決には呼び出し側から `{ detailLayout }` を渡す必要がある
- `$slotAnchor`: メンバーをマーカー位置へ**まとめず**、`$DetailLayout` の宣言配列上の**直前の隣人の直後**へ散らす（例: `"basicFields"`）。解決には `{ detailLayout }` が必要

`$slotOrder` と `$slotAnchor` は対の概念です。`basicFields` は「グローバル項目の間へ作品固有フィールドが挟まる」宣言（`TailsUnit` は `BustSize` の直後、`ForMasterCalling` は `ThirdPersonCalling` の直後…）なので、行き先が 1 箇所に定まらず `$slotOrder` では表現できません。`$slotAnchor` の解決順は:

1. 既に移設済みの**同 base 兄弟**（`ChronoholderName_JP` → `_JPReading` → `_EN` を束ねる）
2. 宣言配列を**遡って**最初に見つかったキーの直後（同じアンカーを共有する `For79th` → `For80th` は宣言順を保つ）
3. **マーカー自身の位置**（アンカーを解決できないメンバーの落とし先）。`#WorkBasic` は基本項目ブロックの先頭に置いてあるため、`basicFields` の**先頭**に宣言された作品固有フィールドは `Images` の直下へ落ちる（例: `Works_UnibyteLive` の `Generation`）

> この「未宣言/未解決は直前の宣言済みキーへアンカー」という考え方は、`tools/normalize-field-order.mjs` がレコード側の未宣言キー（§5.4.3）へ適用している規則と同じものです。

解決順は **作品側エントリの `$slot` 明示（逃がし弁） > `$slotMatch` 述語（宣言順に先勝ち） > catch-all** です。述語で拾えない例外は作品側へ `"$slot": "#Images"` のように 1 行足して上書きします（例: `Works_DestinyFoxRecords` の `Unit_FullEN`）。

> **注意**: `$display.index.order`（§3.3）は `#Index` のサブフィールド順であり、`$slot`（トップレベル配置）とは無関係です。名前が紛らわしいので混同しないでください。

#### 5.4.2 現在の宣言（2026-07-17）

`data/db_type.json` の `$DefType` には次の 6 マーカーが並び、`Index → Progress → _DBLinkRef 群 → Name → Images → FormalName → …` の順を作ります。

| `$slot`          | 述語 / 補助                                               | 拾うもの                                                                                                                                               |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `#Index`         | `$type: "#Index"`                                         | `Num` / `Card` / `Unit` / `BeastType` など                                                                                                             |
| `#SecondaryMeta` | `$slotExpand: "$MetaType.$Def_SecondaryMeta"`             | `sec_SeriesTitle` / `sec_Category` など                                                                                                                |
| `#WorkDBLinkRef` | `$typeIncludes: "$Def_DBLinkRef"`                         | `SameModels_DBLink` / `ThisPerformer_DBLink`                                                                                                           |
| `#Images`        | `$display: { section: "images" }`                         | `Images`（画像を持たない作品では空になる）                                                                                                             |
| `#WorkBasic`     | `$inLayout: "basicFields"` + `$slotAnchor: "basicFields"` | `TailsUnit` / `Generation` / `ForMasterCalling` / `For79thDealerCalling` / `For80thDealerCalling`（**マーカー位置ではなく basicFields 上の隣へ散る**） |
| `#WorkRest`      | `"*"` + `$slotOrder: "subFields"`                         | 残りすべて（`$DetailLayout.subFields` 順）                                                                                                             |

`#WorkBasic` は `#Index` / `#WorkDBLinkRef` / `#Images` より**後**に宣言してあります（`$slotMatch` は宣言順に先勝ちのため）。`basicFields` に載っていても Index や `_DBLink` はそれぞれのスロットが先に拾います。

#### 5.4.3 レコードのキー順

レコードのトップレベルキー順も、この正準順に追従させます。

- 整列: `npm run data:order:write`（`tools/normalize-field-order.mjs`。既定は dry-run）
- 検証: `npm run data:order:check` / `tests/data.field-order.test.js`
- 未宣言キー（`isTriple` / `Regioministration` / `isPrivate` など「フラグ用にあえて宣言しない」もの）は、**直前の宣言済みキーへアンカー**して元の位置に留まります

なお `_Commons` 適用（§5.5）は未定義キーへの代入なので、注入されたキーはランタイムでは必ず末尾に付きます。API 応答のキー順はファイル上の順とは一致しません。

### 5.5 `_Commons` 適用

`lib/sw-common.js` の `CommonsProcessor.applyCommonsToRecords()` が DB 取得時に実行されます。

主な適用箇所:

- `bootstrap`
- `works/{work}/db/{dbName}`
- `search`

注意:

- `works/{work}` や `works` のカタログ取得では `_Commons` は使わない
- meta 欠損時は単にスキップする

### 5.6 `_DBLink` / `_Jump` / `$alt` / `displaySections`

`EnrichmentProcessor.enrichRecords()` の大まかな順序は次の通りです。

1. `normalizeRecordByTypeDef()` で `$DefType` ベースの軽い正規化
2. `_DBLink` の参照先解決
3. `_Jump` ラッパーの実値置換
4. 同名フィールドの空値マージ
5. `$alt` による代替キー穴埋め
6. `#ListLink_*` 辞書から wrapper 補完
7. 画像候補、検索用文字列、`displaySections` の付与

ここで見る宣言面:

- `$DefType`
- `$VarsDef`
- `$IndexDef`
- `Databases.#DB_*._Commons`
- `Databases.#DB_*._Secondaries`

---

## 6. UI が何をどこから使うか

主な利用箇所:

- `pages/characters.js -> fetchGlobalDefType()`
  - `deftype/global` を取得し、必要なら直 fetch で辞書を回復
- `pages/characters.js -> fetchWorkTypeDef()`
  - 作品別 typedef を取得
- `pages/characters.js -> listWorks()`
  - works カタログの `Title` などを利用
- `pages/characters.js -> listWorkDBs()`
  - DB カタログの `DB_Label` などを利用
- `pages/characters.js -> renderSelectionMeta()`
  - `Works_Summary`, `OldTitles`, `DB_Summary`, `StoryEra` を表示

つまり UI は、**本体表示では typedef を優先し、選択 UI や作品/DB の概要では meta カタログを使う** という分担です。

---

## 7. 変更したい内容ごとの更新先

### 7.1 新しいキャラクターフィールドを増やしたい

更新先:

- 対象 `db_*.json`
- 対象 `db_type.json($DefType)`

必要に応じて:

- `db_meta.json(General.$VarsDef)`

### 7.2 enum/list の表示名を足したい

更新候補:

- `db_meta.json(General.$VarsDef)`
- `db_type.json($VarsDef)`

判断基準:

- 既存の meta 辞書に寄せたいなら meta
- 作品固有の schema と一緒に閉じたいなら typedef

### 7.3 作品概要や DB 概要を変えたい

更新先:

- グローバル `db_meta.json -> CreationWorks`
- 作品別 `db_meta.json -> Databases.#DB_*`

### 7.4 詳細画面の強調項目を変えたい

更新先:

- `CreationWorks.<work>.$DetailLayout`
- 必要なら `$DefType.$display.section`

### 7.5 DB セレクトの表示名を変えたい

更新先:

- `Databases.#DB_<DbName>.DB_Label`
- `Databases.#DB_<DbName>.DB_Label_EN`

### 7.6 `AppearanceDetail` の `DesignElement` を廃止して専用フィールドへ移行したい

更新先:

- `data/db_type.json($MetaType.$Def_SupersededDesignElement)`（型宣言、通常は変更不要）
- 対象作品の `db_meta.json(SupersededDesignElements)`（廃止した `DesignElement` を1件追加。§4.8 参照）

---

## 8. よくある誤解

### 8.1 `db_meta.json` だけ直せば UI 本体も追従する

必ずしもそうではありません。キャラクター本体の表示セクションや検索補助、画像ヒントは基本的に `$DefType` が正です。

### 8.2 `db_type.json($VarsDef)` か `db_meta.json(General.$VarsDef)` のどちらか一方だけ見ればよい

違います。実装は両方を見る前提です。特に enrich/search は global/work の meta/type をすべて合成します。

### 8.3 `works/{work}/db` が返すラベルは DB ファイル名そのもの

現在は `DB_Label` / `DB_Label_EN` を優先し、無いときだけ既定表示名へフォールバックします。

### 8.4 `_Commons` はデータ本体を書き換える

永続ファイルを書き換えるわけではありません。API 応答や enrich の直前で、読み出したレコードへ補完的に適用されます。

---

## 9. 関連資料

- `docs/db-update-guidelines.md`
- `docs/api-sw-spec.md`
- `docs/implementation-playbook.md`
- `.github/copilot-instructions.md`
