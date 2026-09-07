# wrapper summary registry メモ

このドキュメントは、2026-05-11 セッションと同日コミット群で進めた `Day` / `Era` / `StoryEra` 周辺の wrapper 化、および SW / enrich 連携の現状を、今後の実装で再参照しやすい形にまとめた技術メモです。

対象:

- `lib/wrapper-common.js` を拡張したい人
- `lib/section-wrapper-common.js` を拡張したい人
- `pages/characters.js` の特殊整形をさらに削減したい人
- `lib/sw-common.js` / `lib/data-common.js` で wrapper summary を再利用したい人
- `db_type.json` の `$display.role` / `$display.wrapper` をどう使うか確認したい人

---

## 1. 先に結論

2026-05-11 時点の方針は次の通りです。

1. `Day` / `Era` / `StoryEra` の特殊 summary は、可能な限り `lib/wrapper-common.js` の shared wrapper registry で扱う
2. schema 側は `db_type.json` の `$display.role` と `$display.wrapper` で「どの値を読むか」「どの wrapper を使うか」を宣言する
3. UI は wrapper を先に試し、値が返らない場合だけ generic fallback へ戻る
4. SW / enrich 側も同じ registry を使い、DB カタログ summary や `_enrichment.wrapperSummaries` を生成する
5. `subFields` の standalone section 描画は、値 wrapper と分離した `lib/section-wrapper-common.js` の section renderer registry で扱う
6. `subFields` の renderer 選択は、可能な限り schema 側の `$display.sectionWrapper` で宣言する

つまり、**個別 field 名に依存した if を main code へ増やすのではなく、schema 宣言 + shared wrapper registry へ寄せる**のが現在の正です。

---

## 2. 現在の実装配置

### 2.1 wrapper 実装の中心

- `lib/wrapper-common.js`
- `lib/section-wrapper-common.js`
- `lib/basic-renders/def-object-common.js`（`$Def_*` 構造化フィールドの共通整形。DOM 非依存の純関数）

ここに、shared な特殊整形 handler / subField section renderer を登録します。

現時点の built-in wrapper:

- `daySummary`
- `eraSummary`
- `storyEraSummary`
- `tailsUnitSummary` — `$Def_TailsUnit` 単体を一行サマリー（形状・本数・節数・方向句・分岐内訳）へ整形（`lib/section-renders/tailsUnit.js`）
- `factionSummary` — `$Def_Faction`（`Belonging` 等の所属系フィールド）を「所属先（活動地域／地域補足）」の 1 行へ整形（`lib/basic-renders/faction.js`）。子要素のどれが辞書コードでどれを辞書行から参照解決するかは schema 宣言（`$display.role: "factionCode"` / `$dictRef`）だけで決まり、field 名依存の分岐を持たない。配列値は `$display.arrayLayout`（既定 `multiline`）に従って 1 要素 1 行で連結する。旧形式の生文字列（`["百花繚乱研究所"]`）は `$shorthand` 宣言により `{ Faction: ... }` と同じ経路で整形される
- `baseAreaSummary` — `$Def_BaseArea`（`FromArea` 等の地域フィールド）を「地域（補足）」の 1 行へ整形（`lib/basic-renders/baseArea.js`）。2026-07-29 に `pages/characters.js` の `$Def_BaseArea` ハードコード分岐を置き換えたもの。旧分岐は補足を `about_JP` から読んでいたが、typedef 宣言どおり `BaseAreaAbout_JP` / `_EN` を読む（旧キーも後方互換で拾う）
- `keyedDialogueSummary` — 「キー項目 ＋ 和英の台詞本文 ＋ 補足」を持つ配列要素を `キー：台詞（補足）` の 1 行へ整形（`lib/basic-renders/keyedDialogue.js`）。`ConversationPattern.TouchReactions`（`$Def_TouchReaction[]`）と `*specStats.MotifCommentaries`（`$Def_MotifCommentary[]`）が対象。どの子要素がキーかは `$display.role: "dialogueKey"` / `"dialogueKeyValue"` だけで決まり、field 名依存の分岐を持たない。キー項目を持たない要素（従来の `ConversationPattern.DialogueExamples`）は接頭辞なしで本文だけを返すため、既存フィールドの表示は変わらない

`factionSummary` / `baseAreaSummary` の整形本体は共通部品 `lib/basic-renders/def-object-common.js`（`globalThis.DefObjectRenderer`）にあります。「`$type` が `#DictIndex` / `#ListIndex` の子要素は辞書ラベルへ解決し、キー末尾が `_JP` / `_EN` の子要素は補足として併記する」という汎用ルールだけを持つ純関数群で、新しい `$Def_*` の wrapper を足すときはここへ委譲する薄い IIFE を 1 本増やせば済みます。補足の繋ぎ方は `style` オプションで切り替えます（単体表示は `paren` = `ラベル（補足）`、他の wrapper の括弧内へ入れ子にする場合は `inline` = `ラベル／補足`）。

現時点の built-in section renderer:

`lib/section-wrapper-common.js` に直接登録（常に最初にロードされる）:
- `structuredObjectSection` — plain object の subField を汎用 structured section へ流す。`*_DBLink` suffix キーは除外（後述の `dbLinkSection` へ委譲）。

`lib/section-renders/` 配下の IIFE ファイルで登録（`characters.js` から import されたタイミングで追加）:
- `relationSection` — `RelationTo_*` suffix フィールドのリレーション表示（`lib/section-renders/relation.js`）
- `statsSection` — 汎用 Stats 系表示（`lib/section-renders/abilityStats.js` 等）
- `specStatsSection` — `*specStats`（モチーフ能力の特性）の汎用表示（`lib/section-renders/specStats.js`）。`EffectStats` / `SafetyLevel` を共通ヘルパーで描き、残り（`*specAbout` / `*specName` / `SpecialPattern` / `Artifact` / `MotifCommentaries` 等）を `buildObjectChildBlocks` へ委譲する。NumberTales `NumerospecStats` / PastDivers `ChronospecStats` / ShouArRiders `BeastspecStats` が共用（旧 `numSpecSection` / `chronoSpecSection` は完全に同一実装だったため 2026-08-20 に統合。ShouArRiders は旧 `statsSection` から移行）
- `arcanumSpecSection` — FLInvestigator78 `ArcanumspecStats` 専用（`lib/section-renders/arcanumSpec.js`）。`specStatsSection` に `SpecLevel` タグと `SpecType` の kvTable を足した派生
- `thisMastersSection` — ThisMasters (`$Def_ThisMastersEntry[]`) 表示（`lib/section-renders/thisMasters.js`）
- `dbLinkSection` — `*_DBLink` suffix フィールドのキャラクターリンク参照表示（`lib/section-renders/dblink.js`）
- `appearanceDetailSection` — `AppearanceDetail` (`$Def_AppearanceDetail[]`) 外見デザイン詳細の Formation グループ別表示。`vdict_*` / `value_Num_*` / `value_JP` / `about_JP` の規約駆動フィールドを `$EnumDef_*`（global+local マージ）で解決し、参考画像（`img_PNGName`）がある場合はライトボックス対応で表示する。エントリ1件は subFields 系共通の `.subfield-entry` クラスによる「テキスト情報（左）+ 右隣の小さな参考画像」の flex 2カラム構造。画像フォルダは `DesignElement` の `#Element_*` から `attr/<lowerCamel>` を自動導出し、判別不能時のみ従来互換として `img/` を既定値にする（`lib/section-renders/appearanceDetail.js`）
  - subFields 系共通レイアウトクラス（`pages/characters.sass`）: `.subfield-entry`（flex コンテナ、狭幅時は wrap で縦積み）/ `.subfield-entry__main`（テキスト情報カラム）/ `.subfield-entry__reference-image`（参考画像カラム、幅120pxの正方形サムネイル）。新しい section renderer で参考画像付きエントリを描画する場合は、field 固有クラス（BEM）に併せてこの共通クラスを付与する（例: `class="tailsunit__entry subfield-entry"`）
- `tailsUnitSection` — `TailsUnit` (`$Def_TailsUnit[]`) の1エントリごとの標準表示（形状タグ・本数・節数・方向句・分岐内訳・補足テキスト・参考画像）。エントリ1件は subFields 系共通の `.subfield-entry` クラスによる「テキスト情報（左）+ 右隣の小さな参考画像」の flex 2カラム構造。参考画像（`TailsUnit_PNGName`）は `$subfolder` をスキーマから解決した上で `createGalleryImageItem`（ライトボックス拡大表示対応）で表示する（`lib/section-renders/tailsUnit.js`）
- `vrmViewerSection` — `VRMs.corefolder_VRMPath`（`#VRMFilePath[]`）を3Dビューア（three.js + `@pixiv/three-vrm`）として表示する。カード1件は「ポスター画像（`.model-viewer__media`）+ 右隣の起動ボタン/3Dステージ（`.model-viewer__body`）」の2カラム構造（768px未満は縦積み。レイアウトは `pages/characters.sass` 側で制御）。`TailsUnit`と同じ設計（構造化データ + 専用URL構築ヘルパー）に寄せており、`_enrichment`/`ImageProcessor`には一切依存しない。URL構築は `helpers.buildVrmAssetUrl`（`pages/characters.js`。`Images`ではなく`VRMs`配下を解決）に委譲する。three.js本体は「起動」ボタン押下時にのみ動的importし、通常表示では一切ロードしない（`pages/vendor/`に同梱、外部CDN非依存。詳細は`pages/vendor/THIRD_PARTY_NOTICES.md`）（`lib/section-renders/vrmViewer.js`）

**suffix 自動ディスパッチ**: `dbLinkSection` と `relationSection` は `$display.sectionWrapper` の宣言なしに suffix だけで自動マッチする。
- `*_DBLink` → `dbLinkSection` が `match` 関数で自動検出
- `RelationTo_*` → `relationSection` が `match` 関数で自動検出（`$display.sectionWrapper: "relationSection"` を付けても同じ）

`relationSection` は 2026-05-15 時点で、`pages/characters.js` にあった `Relation` / `RelationToPrimary` の個別表示ロジック本体も吸収しています。`characters.js` 側は DOM/format/navigation の core helper を渡す bridge に留め、relation label 解決・comment 整形・index link 組み立て・standalone wrapper への接続は `lib/section-wrapper-common.js` 側で処理します。

重要な運用ルール:

- `pages/characters.js` には、可能な限り renderer 選択・共通 fallback・共通 helper bridge だけを残します。
- field 固有の分岐が 1 つの top-level field や 1 種の typedef に閉じるなら、まず `lib/wrapper-common.js` / `lib/section-wrapper-common.js` の built-in handler へ寄せます。
- built-in handler を追加・更新したら、User が後で追えるよう日本語の JSDoc / 注釈で context と helper 契約を明示します。

### 2.2 schema 側の宣言

- `data/db_type.json`

現在の割り当て:

- `$VarsDef.$Def_Day.$display.wrapper = daySummary`
- `$VarsDef.$Def_Faction.$display = { wrapper: "factionSummary", arrayLayout: "multiline" }`（`data/db_meta.json`）。`$DefType.Belonging.$type = "$Def_Faction[]"`（`data/db_type.json`）。`$Def_Faction` は所属 (`Belonging`) 専用ではなく、「陣営辞書 (`#Dict_Faction`) を引く構造化フィールド」全般で再利用する想定の宣言
- `$VarsDef.$Def_BaseArea.$display.wrapper = baseAreaSummary`（`data/db_meta.json`）。`$DefType.FromArea.$type = "$Def_BaseArea"`（`data/db_type.json`）。`$Def_Faction.FactionsBaseArea` のように他の `$Def_*` の子要素としても使う
- `$VarsDef.$Def_TouchReaction.$display = { wrapper: "keyedDialogueSummary", arrayLayout: "multiline" }`（`data/db_meta.json`）。`$DefType.ConversationPattern.$type[].TouchReactions.$type = "$Def_TouchReaction[]|#Null"`（`data/db_type.json`）。キーの `Action` は `$dict: "TouchAction"`（辞書 `#List_TouchAction` はグローバル `data/db_meta.json`。行為の語彙は作品共通）
- `$VarsDef.$Def_MotifCommentary.$display = { wrapper: "keyedDialogueSummary", arrayLayout: "multiline" }`（`data/db_meta.json`）。作品別 `*specStats` の子として宣言する（NumberTales は `$DefType.NumerospecStats.$type[].MotifCommentaries`）。キーの `Topic` は `$dict: "MotifTopic"` で、辞書 `#List_MotifTopic` は**作品別** `db_meta.json` に置く（数秘 / タロット / 十二支で語彙が異なるため）。`TopicValue`（`$display.role: "dialogueKeyValue"`）がラベルへ連結され `ライフパス3` / `Life Path 3` になる
- `$MetaType.$Def_StoryEra.$display.wrapper = eraSummary`
- `$MetaType.$Def_StoryEraCatalog.$display.wrapper = storyEraSummary`
- `$DefType.AppearanceDetail.$display.sectionWrapper = appearanceDetailSection`（`data/db_type.json` — `$Def_AppearanceDetail[]|#Null` 型 / `searchable: false`）
- `$VarsDef.$Def_TailsUnit.$display = { wrapper: "tailsUnitSummary", sectionWrapper: "tailsUnitSection" }`（`data/Works_NumberTales/DataBases/db_meta.json` — work-local）。`$DefType.TailsUnit.$display.sectionWrapper = tailsUnitSection`（`data/Works_NumberTales/DataBases/db_type.json` — `$Def_TailsUnit[]` 型 / `searchable: false`）。`TailsUnit` は `data/db_meta.json` の `CreationWorks.#Works_NumberTales.$DetailLayout.basicFields` にも列挙されているが、同じキーが `subFields` へ昇格すると「1項目1箇所の原則」で `pages/characters.js`（`normalizedBasicFieldKeys` の `isPromotedSubFieldKey` フィルタ）が基本情報テーブルからは自動的に除外するため、実際の表示は `tailsUnitSection`（この専用折りたたみセクション。詳細+参考画像）のみになる
- `$DefType.VRMs.$display.sectionWrapper = vrmViewerSection`（`data/Works_NumberTales/DataBases/db_type.json` — サブフィールド `corefolder_VRMPath`: `#VRMFilePath[]` / `searchable: false`）。`VRMs` は `data/db_meta.json` の `CreationWorks.#Works_NumberTales.$DetailLayout.subFields` にも列挙されており、`vrmViewerSection` の折りたたみセクションとしてのみ表示される（`Images` のギャラリーパイプラインとは完全に独立）

### 2.3 UI 側の利用

- `pages/characters.js`

`formatValueForDisplay()` は object 値を整形するときに wrapper registry を先に試します。

- `schemaType`
- `defName`
- `typeSources`

を渡して wrapper 解決を行い、文字列が返ればそれを採用します。

`subFields` の standalone section 描画では、`CharacterSectionRendererRegistry.renderWithRegisteredSectionRenderer()` を先に試します。

- `item.display.sectionWrapper`
- `helpers.renderStructuredObjectSection`
- `helpers.renderStatsSection`

relation renderer のように built-in 側へ本体実装を寄せる場合は、必要な core helper を `helpers.relationApi` のような名前付き API object として渡します。non-subField から built-in renderer を明示的に呼びたい場合は `CharacterSectionRendererRegistry.renderNamedSectionRenderer(name, item, context)` を使えます。

これらを渡して section renderer 解決を行い、Node が返ればそれを採用します。

### 2.3.1 section renderer へ渡す helper の考え方

- generic helper は `helpers.renderStructuredObjectSection` / `helpers.renderStatsSection` のように単機能で渡します。
- built-in renderer が DOM 生成・辞書解決・navigation など複数責務の core helper を必要とする場合は、`helpers.relationApi` のような名前付き API object に束ねて渡します。
- subscript 側は「どの helper をどう組み合わせるか」を持ち、`window` や page-local state への直接依存はできるだけ bridge 側に閉じ込めます。

### 2.3.2 `subFields` 折りたたみ UI の規則

- standalone subField の折りたたみは UI shell 側の責務ですが、判定は schema-driven に保ちます。
- 既定では non-text section のみ `details/summary` で包み、初期状態は閉じたまま表示します。
- primitive / `#String` / `#Summary` / `#Dialogue` は text-like とみなし、折りたたみ対象にしません。
- `hideText` を使って object wrapper へ変わっても、元の typedef が text-like なら折りたたみ有無も表示ルートも変えません。

### 2.4 SW / enrich 側の利用

- `lib/sw-common.js`
- `lib/data-common.js`

現時点の利用箇所:

- works/{work}/db の DB カタログ応答に `StoryEraSummary` を付与
- enrich 結果に `_enrichment.wrapperSummaries` を付与

---

## 3. wrapper handler の最小シグネチャ

handler シグネチャは次で固定しています。

```js
format(value, context);
```

`context` の主要項目:

- `schemaType`
- `defName`
- `fieldKey`
- `typeSources`
- `helpers`

`helpers` に含むもの:

- `isPlainObject`
- `splitSchemaTypeTokens`
- `schemaTypeIncludes`
- `resolveTypeDefContainer`
- `resolveTypeDefEntries`
- `getRoleEntries`
- `getRoleRawValues`
- `pickRoleRawValue`
- `pickAboutText`

ルール:

- wrapper は非空の文字列を返したときだけ採用される
- 空文字を返した場合は呼び出し側が fallback を継続する
- handler 内で field 名を直接固定するより、可能な限り `role` を使って値を読む

---

## 4. `Era` 主体での整理

### 4.1 現在の考え方

`StoryEra` は単体 formatter ではなく、**`Era` 単点 formatter の合成結果**として扱います。

実装上は次の役割分担です。

- `eraSummary`
  - 単点年代の整形を担当
  - `EraGen`, `YearInEra`, `byRealYear`, `about_*` を読む
- `storyEraSummary`
  - `InEra`, `FromEra`, `ToEra` を見て、内部で `eraSummary` 相当の整形を並べて summary を作る

### 4.2 この構成にした理由

- `Era` 単点ロジックを 1 か所に閉じられる
- `StoryEra` / `FromEra` / `ToEra` / `InEra` の挙動差分を catalog 側の組み立てへ限定できる
- 将来 `Era` が standalone field として top-level に現れても同じ handler を流用できる

---

## 5. SW / enrich 側の summary 露出

### 5.1 DB カタログ応答

- `lib/sw-common.js`
- works/{work}/db, bootstrap 系

現状:

- raw の `StoryEra` を返す
- さらに `StoryEraSummary` を返す

重要:

- `StoryEraSummary` は `lib/sw-common.js` の個別ハードコードではなく、`$MetaType.$Def_DatabaseCatalog.$DefType` を見て wrapper 解決できる field から `${hashTag}Summary` を自動生成する
- 現時点では `StoryEra` がその対象なので `StoryEraSummary` が生成される

### 5.2 enrich 出力

- `lib/data-common.js`
- `EnrichmentProcessor.enrichRecords()`

現状:

- `_enrichment.wrapperSummaries` を追加
- wrapper 解決できる top-level field の summary を保持

例:

```json
{
  "_enrichment": {
    "wrapperSummaries": {
      "BirthDay": "8/15（誕生日）",
      "StoryEra": "第9創世紀3年 / 西暦2050年"
    }
  }
}
```

この summary は UI が raw 構造を再解釈せずに利用したいときの再利用ポイントです。

---

## 6. 今後の判断基準

### 6.1 新しい特殊 summary 型を追加したいとき

先に確認する順:

1. 既存 typedef に `$display.role` を足せば済まないか
2. 既存 wrapper の合成で済まないか
3. それでも足りない場合だけ `lib/wrapper-common.js` に新 wrapper を追加する

### 6.2 main code に if を足したくなったとき

まず次を確認します。

- schema に `$display.wrapper` を付けられないか
- schema に `$display.sectionWrapper` を付けられないか
- `helpers.pickRoleRawValue()` で値を読めないか
- DB カタログや enrich 側なら generic な summary 集約へ寄せられないか
- `subFields` の standalone 描画なら `lib/section-wrapper-common.js` へ寄せられないか

補足:

- `Relation` のように従来 main code に置いていた field 専用の DOM 組み立ても、必要な helper を named API object として渡せるなら built-in section renderer 側へ移せます。
- `hideText` 対応で object wrapper が増えた場合も、先に「元の typedef が何型か」を見て、section 種別や折りたたみ判定を変えないで済まないかを確認します。

### 6.3 docs 同期先

wrapper 周辺を触ったら、最低限次を確認します。

- `docs/schema-meta-processing.md`
- `docs/api-sw-spec.md`
- `docs/implementation-playbook.md`
- `.github/copilot-instructions.md`
- `_work_in_progress/2026-05-11_progress_storyera-schema.md`
- `CHANGELOG.md`

---

## 7. 代表テスト

wrapper 周辺を触ったときに優先して回すテスト:

- `tests/wrapper-common.test.js`
- `tests/section-wrapper-common.test.js`
- `tests/enrich.wrapper-summaries.test.js`
- `tests/sw.work-meta-info.test.js`
- `tests/pages.characters.ui-output.test.js`
- `tests/pages.characters.syntax.test.js`
- `tests/section-renders.vrmViewer.test.js`
- 必要に応じて `tests/meta.catalog.schema.test.js`

---

## 8. 関連資料

- `docs/schema-meta-processing.md`
- `docs/api-sw-spec.md`
- `docs/implementation-playbook.md`
- `.github/copilot-instructions.md`
- `_work_in_progress/2026-05-11_progress_storyera-schema.md`
