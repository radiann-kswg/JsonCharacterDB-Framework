# 和英ローカライズ ルールブック

> **対象**: Claude Code / GitHub Copilot / その他 AI 翻訳ツール
> **目的**: 100BeautiesLab. Creations DB の全作品における `_EN` フィールドの英訳を、既存実装と一貫した形式で生成・補完するための規則集
> **最終更新**: 2026-06-24（実データ突き合わせによる項目追補。前回 2026-06-15）

---

## 英訳入力補助（エージェント共通方針・両入口の正典）

> **この節は Claude / Copilot 双方の「英訳入力補助」の共通正典です。** 各エージェントの入口（下表）はこの節を指すだけにし、方針の実体はここに集約します（ロールプレイにおける `AGENTS.md` と同じ「正典＋薄い入口」構造）。

- **既にある日本語を訳す入力補助に限る**: 未記入のキャラ設定・台詞・固有用語などの創作本文を新規生成しない。翻訳元の JP が無いフィールドは空のままにする。
- **既存 `_EN` は上書きしない**: 空（`null`/`""`/未定義）のときだけ訳案を補う（詳細は §0）。
- **固有名詞は監修辞書に固定**: 早見表 [`localization-glossary-quickref.md`](localization-glossary-quickref.md) → 辞書本体（`data/Localization/trans_*.json` / `data/References/ref_*.json` / `data/Dictionaries/dict_*.json`）の順に確認し、勝手な別訳を作らない。作品タイトルの英名は `Works_` 識別子が正。
- **`hideText` を尊重**: `{ "hideText": "..." }` はマスク。訳したり展開したりしない。
- **マスクは片方だけでよい**（2026-08-20〜）: `{ "hideText": "..." }` は `#List_hideText` の辞書コードなので、
  `_JP` 側にだけ書けば英語ページでも対訳（例: `極秘事項` → `Confidential`）が出ます。`_EN` 側へマスクを複製する必要はありません。
  既に両方に書かれている既存データ（18 件）はそのままで正しく、整理は不要です。
- **一括処理との棲み分け**: 大量翻訳・既存英訳の突き合わせ(eval)・用語集同期は `tools/deepl/`（[`deepl-localization.md`](deepl-localization.md)）。エージェントの補助は単発の入力補助。
- **最終採否は User**: 迷う訳は確定させず候補提示に留める。

### 両エージェントの入口（この節を参照する薄いポインタ）

| エージェント                  | 入口ファイル                                           | スコープ機構                                  |
| ----------------------------- | ------------------------------------------------------ | --------------------------------------------- |
| GitHub Copilot                | `.github/instructions/localization-en.instructions.md` | `applyTo: data/**`（Chat/Agent/Edits に適用） |
| Claude (Cowork / Claude Code) | `data/CLAUDE.md`                                       | `data/` 配下を編集する際に自動ロード          |

> インライン補完（Copilot ゴーストテキスト）はカスタム指示を読み込まないため、早見表を隣タブで開いて近傍文脈に入れる運用で補う。

---

## 0. 最優先原則

1. **既存の `_EN` 値を上書きしない**: `field_EN` が存在し、かつその値が対応する JP 値（→ §0-1）と異なる場合は上書き禁止（すでに人間が監修した英訳）。
2. **スキーマ駆動**: `db_type.json($DefType)` に登録されていないフィールドへ `_EN` を勝手に追加しない。
3. **キー順序**: `field_EN` は必ず対応する JP キー（→ §0-1）の **直後** に挿入する。末尾への追記は禁止。
4. **コード生成時のパターン**: `Object.assign` を使わず、`insertAfterKey()` + `db.map()` パターンを使う（→ [実装メモ](#実装メモ)）。

---

## 0-1. JP/EN キーの命名規約（実データ準拠）

実データ（`data/Works_*/DataBases/db_*.json`）を走査した結果、和英対応は次の 3 系統で格納されている。本書で「対応する `field`（JP）」と表記する箇所は、原則として **`field_JP`** を指す。

| 系統                                   | 形式                                                 | 該当フィールド（実データで確認）                                                                                                                                                                                                                                          |
| -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`_JP`/`_EN` ペア型（既定・大多数）** | `field_JP` と `field_EN` を隣接配置                  | `CodeName` / `FormalName` / `Name` / `Summary` / `Character` / `Hobby` / `SpecialSkill` / `Favor` / `Unlike` / `Motif` / `*PersonCalling` / `ForMasterCalling` / `NumerospecStats.NumerospecAbout` / `Backgrounds` / `InStory` / `RelationNotes` ほか、本書記載のほぼ全項目（`TailsUnit` は `$Def_TailsUnit` 構造化型へ移行済み。§3-2 参照） |
| **plain + `_EN` 型（例外）**           | `Comments` と `Comments_EN` を隣接配置（`_JP` 無し） | `Relation.*.Comments`（§3-8）のみ（実データ 671 件すべて plain）                                                                                                                                                                                                          |
| **移行中（混在）**                     | `value` / `about` は plain と `_JP` が混在           | `DialogueExamples` の `value`・`about`（§3-9。文字列 → `value_JP` へ移行途上。plain 約 1/3・`_JP` 約 2/3）                                                                                                                                                                |

- **挿入位置**: ペア型は `field_JP` の直後、plain 型は `Comments` の直後。
- **上書き判定の参照元**: ペア型では `field_JP`、plain 型では `Comments` の値を「JP 値」とみなす（§6）。
- 一覧の件数根拠は §3 各節および本リビジョンの突き合わせ結果による。

---

## 1. 代名詞ルール（GenderType 別）

| GenderType           | 代名詞         | 備考                                                            |
| -------------------- | -------------- | --------------------------------------------------------------- |
| `FemaleNeutral`      | `she` / `her`  |                                                                 |
| `MaleNeutral`        | `he` / `him`   |                                                                 |
| `Female`             | `she` / `her`  |                                                                 |
| `Male`               | `he` / `him`   |                                                                 |
| `Neutral`            | `ze` / `zir`   | ネオプロナウン。**`they/them`・`he/she`・`him/her` は使わない** |
| `undefined` / 未設定 | 代名詞を避ける | 名前やキャラクター呼称で代替                                    |

### 1-1. `ze/zir` 活用一覧（Neutral キャラクター専用）

| 文法役割                  | 形式                     | 例                           |
| ------------------------- | ------------------------ | ---------------------------- |
| 主格（Subject）           | `ze`                     | `Ze is a NumberTales who...` |
| 目的格（Object）          | `zir`                    | `...serving zir master`      |
| 所有格（Possessive adj.） | `zir`                    | `...zir unique ability`      |
| 再帰（Reflexive）         | `zirself`                | `Ze did it zirself`          |
| 文頭大文字                | `Ze` / `Zir` / `Zirself` | 文頭では大文字化             |

> **非標準複合形への注意**: `him/herself` や `his/herself` は英語の慣習で `himself/herself` の代わりに書かれることがある。これらも `zirself` に置換する。
>
> **`ThirdPersonCalling_EN` は対象外**: `彼/彼女` → `he/she` のように「このキャラが他者を呼ぶスタイル」を示す呼称フィールドは、キャラクター自身の代名詞ではないため `ze` に変換しない。

### 1-2. 世界観的背景（なぜ `ze/zir` を採用したか）

ナンバーテールズ（数秘術ベースの霊獣型）・運命線探偵78（異能調査者）・獣爾騎兵（獣人型改造人間）等は「人間の性別概念から外れた存在」として設定されている。英語圏の創作においても `ze/zir` は「第三の性を持つ種族・神霊・人間以外の知性体」の代名詞として機能することが確認されており、百花繚乱研究所の創作世界観の英語演出として採用した。（参考: ChatGPT「Ze Zir 言語学文化分析」2026-06-14）

---

## 2. 固有名詞マッピング（確定済み）

| JP 表記        | EN 表記         | 備考                            |
| -------------- | --------------- | ------------------------------- |
| `百(ハゲム)`   | `Hudret`        | Num 00「Hudret Norumber」の略称 |
| `零(レイ)`     | `Zera`          | 開発者キャラ。`Rei` は不正解    |
| `サンジ(惨事)` | `Troubleforcer` | Num 34 の通称                   |

---

## 3. フィールド別英訳ルール

### 3-1. `CodeName_EN`

**ルール**: 漢数字を1桁ずつ対応する英語数詞に変換し、ハイフン（`-`）で連結する。

| 漢字 | 英語  |
| ---- | ----- |
| 〇   | Zero  |
| 一   | One   |
| 二   | Two   |
| 三   | Three |
| 四   | Four  |
| 五   | Five  |
| 六   | Six   |
| 七   | Seven |
| 八   | Eight |
| 九   | Nine  |

**実例:**

| JP       | EN                                     |
| -------- | -------------------------------------- |
| `一`     | `One`                                  |
| `(二)`   | `(Second)` ※特殊例外：括弧保持、Second |
| `一〇`   | `One-Zero`                             |
| `六六`   | `Six-Six`                              |
| `七〇`   | `Seven-Zero`                           |
| `(二〇)` | `(Two-Zero)` ※括弧は保持               |

**注意**: `七〇` = `Seventy` ではなく `Seven-Zero`。複合英数詞（Seventy, Sixty-six 等）は使わない。

**作品固有の CodeName_EN** は全く別体系なので注意:

- FLInvestigator78: タロットカード名（`Fool`, `Magician`, `High-Priestess` 等）
- SinisterChangingGirls: `Lust o'clock in Midnight` 等
- DestinyFoxRecords: SI 単位系（`Metre_SI-L`, `Kelvin_SI-Θ` 等）

---

### 3-2. `TailsUnit`（NumberTales 固有・構造化型）

`TailsUnit` は自由記述の `TailsUnit_JP`/`TailsUnit_EN` ではなく、`$Def_TailsUnit[]`（`data/Works_NumberTales/DataBases/db_meta.json` の `General.$VarsDef`）による構造化型。フィールドは `TailShapeType`（`$EnumDef_TailShapeType` への参照）/ `Count` / `Segment`（任意）/ `Branches[]`（任意、各要素は `Laterality`/`TailCount`/`ClusterCount`）/ `Note_JP`・`Note_EN`（任意の補足）。

表示文字列（例: 「キツネ(枝分かれ)型: 4本 (上: 1本×2束, 下: 3本×1束)」/ "Fox (branched): 4 tails (Upper: 1 tails x2 clusters, Lower: 3 tails x1 clusters)"）は `lib/section-renders/tailsUnit.js` の `tailsUnitSummary` wrapper が `$EnumDef_TailShapeType`/`$EnumDef_Laterality` の辞書エントリから自動生成する。**レコード単位の自由記述訳（本節旧内容）は不要**になった。

新しい尻尾形状を追加する場合は、`$EnumDef_TailShapeType`（`data/Works_NumberTales/DataBases/db_meta.json`）に enum エントリ（`TailShapeType_JP`/`TailShapeType_EN`）を追加するだけでよい。個別レコードの英訳は発生しない。

パターン・スキーマ詳細は `docs/schema-meta-processing.md` / `docs/wrapper-summary-registry.md` を参照。

---

### 3-3. 呼称フィールド（`*PersonCalling_EN` / `ForMasterCalling_EN`）

#### 3-3-1. JP フィールドの書式規則

JP `*Calling` フィールドは次の書式を持つ：

- **セミコロン `;`**: カテゴリ区切り（代名詞 → 指示表現 → 敬称/参照形の優先順）
- **スラッシュ `/`** または **カンマ `,`**: 同カテゴリ内の複数候補
- **`*xxx`**: 指示・代名詞のショートカット（`*いつ`, `*れ`, `*の子` 等）
- **`~`**: 名前プレースホルダー（例: `~さん` = `[Name]-san`）
- **`[※xxx]`**: 参照形（例: `[※名前呼び]`, `[※二人称]`）
- **`\n`**: 文脈別の複数パターン区切り

EN でもこの構造（`;`, `/`, `\n`）をそのまま維持する。

#### 3-3-2. 共通翻訳ルール

| 要素                    | EN 翻訳                                                     | 備考                                        |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| `[※名前呼び]`           | `[*by name]`                                                | 統一表記 — `[*Name calling]` は使わない     |
| `[※二人称]`             | `[*second-person calling]`                                  | 統一表記                                    |
| `[※三人称]`             | `[*third-person calling]`                                   | 統一表記                                    |
| `[※その時により変わる]` | `[*Varies depending on the situation]`                      |                                             |
| `彼/彼女`               | `he/she`                                                    | ThirdPersonCalling 内では GenderType 非依存 |
| `あんた`                | `guy/girl(s) (anta; rough)`                                 | `you (anta)` は使わない                     |
| romaji 注釈             | `(romaji; 補足)`                                            | 括弧**内**に全注釈を収める                  |
| 例外付き注釈            | `(*shi; exceptions apply)` ○ / `(*shi); exceptions apply` ✗ |                                             |
| 複数文脈                | `\n` で区切る                                               | JP と同じ区切り数を維持                     |

#### 3-3-3. 指示表現（`*` 系）の EN 翻訳

| JP 指示表現               | EN 翻訳                                                    | 用法                            |
| ------------------------- | ---------------------------------------------------------- | ------------------------------- |
| `*いつ` / `*イツ`         | `this/that/who/what/which/them (as personal or objective)` | あいつ/こいつ系・主語目的語両用 |
| `*れ` / `*レ`             | `this/that/who/what/which/them (as objective)`             | あれ/それ系・主に目的語         |
| `*いつ/*れ`（組み合わせ） | `this/that/who/what/which/them (as personal or objective)` | 両用                            |
| `*ちら`                   | `that/this person (*chira, formal)`                        | 丁寧な指示                      |
| `*やつ` / `*奴(*やつ)`    | `that fellow (*yatsu)` または `that guy/gal (*yatsu)`      | 粗野な指示                      |
| `*の方`                   | `that person`                                              | 丁寧・ロマナイズ不要            |
| `*の人`                   | `that/this person`                                         | 中立・ロマナイズ不要            |
| `*の子`                   | `that/this/which kid`                                      | カジュアル                      |
| `*の子/*っち`             | `that/this/which kid (*no-ko), ~-cchi`                     | バリアント統合                  |
| `*の子;~(な)コ`           | `that/this kid (*no ko; ~na ko)`                           | バリアント統合（括弧内）        |
| `*の者`                   | `that/this/which one (as personal)`                        | 格式ある指示                    |

> **注意**: `"that/this/who/which/them guy/girl"` 形式や `"that/this/whom one"` 形式は旧パターン。新規翻訳では上記の `(as personal or objective)` / `(as objective)` 形式を使う。

#### 3-3-4. 敬称サフィックスの EN 変換

`~君` / `~さん` はキャラクターの性格・口調に応じてコンテキスト依存で判断する：

- **フォーマル・才能型・距離感のある敬意** → `Mr./Ms.~`（例: 才能あふれる自発的なキャラ、陰キャで信頼人に敬語を使うキャラ）
- **カジュアル・アイドル・友好的・母性型** → `~-kun` / `~-san`（例: 明るいオタクキャラ、ゆるふわ系、アイドル調）
- **補足注釈 `(as Mr/Ms.~)` を付けることは禁止**（どちらか一方に決定する）
- `Mr./Ms.~` を使う場合は必ずピリオドを付ける：`Mr.` `Ms.`（`Mr/Ms.~` はNG）

| JP 敬称                       | EN 変換                                              | 備考                                                             |
| ----------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| `~君` / ロール名+君 / `~クン` | `~-kun` または `Mr./Ms.~` / `Client-kun` 等          | キャラクター性格依存（上記の基準を参照）。ロール名はそのまま前置 |
| `~さん` / ロール名+さん       | `~-san` または `Mr./Ms.~` / `Client-san` 等          | 同上。ロール名はそのまま前置                                     |
| `~ちゃん`                     | `~-chan`                                             |                                                                  |
| `~殿`                         | `~-dono`                                             |                                                                  |
| `~様` / `~さま`               | `~-sama` または `sir/lady.~(~-sama; very honorific)` |                                                                  |
| `~先輩`                       | `~-senpai` / 単独では `senpai`                       |                                                                  |
| `~(な)コ`                     | `~-na-ko (adjectival)`                               |                                                                  |
| `~(な)ヤツ`                   | `~ one (*na yatsu; adjectival)`                      |                                                                  |

#### 3-3-5. `ThirdPersonCalling_EN` 書式

**標準形 1（代名詞あり）:**

```
he/she; [指示表現 or 敬称/参照形]; [*by name or 参照]
```

**標準形 2（代名詞なし）:**

```
[指示表現 or 敬称/参照形]; [*by name or 参照]
```

実例（NT db_Primary の Num を参照）:

```
"he/she; [*by name]"                                                          ← Num 3
"he/she; ~-kun/~-san"                                                         ← Num 19
"[*by name]"                                                                  ← Num 11
"this/that/who/what/which/them (as personal or objective); [*by name]"        ← Num 18, 32, 41
"he/she; this/that/who/what/which/them (as objective); [*by name]"            ← Num 17
"he/she; that/this/who/which/what/them (as personal or objective); [*by name]" ← Num 23
"that person, that fellow (*yatsu); ~-dono"                                   ← Num 7
"~-san\nsenpai (*toward NumberTales)"                                         ← db_Secondary 0xB
"~-dono / this/that/who/what/which/them (*itsu, as personal or objective)"    ← db_Secondary 0xE
```

文脈注釈（`ナンバーテールズに対して：先輩` 等）→ `senpai (*toward NumberTales)` 形式で `\n` 区切り。

#### 3-3-6. `ForMasterCalling_EN` 書式

| パターン             | 書き方                                     | 備考                                                       |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| 名前プレースホルダー | `~`                                        | チルダ記法                                                 |
| ロール称号+名前      | `Instructor.~` / `Trainer.~`               | ピリオド+チルダ                                            |
| 敬称+名前            | `~-senpai` / `~-kun`                       | チルダ-ダッシュ-単語                                       |
| 先生                 | `Teacher [Name]`                           | 名前の前                                                   |
| ～兄さん/姉さん      | `~-bro/sis (-niisan/-neesan), big bro/sis` |                                                            |
| 角括弧参照型         | `[*Adapts to the master's preferences]`    | `[Free Style]` ラベルは含めない                            |
| 括弧内注釈           | `Master.~ (*shi; exceptions apply)`        | 括弧を閉じる前に全注釈を収める                             |
| ロール名+さん        | `Client-san` 等                            | `クライアントさん` → `Client-san`（`Client` のみは不正解） |
| ロール名+君          | `Client-kun` 等                            | `クライアント君` → `Client-kun`（`Client` のみは不正解）   |
| 複数の呼び方         | `\n` で区切る                              |                                                            |

複数候補をスラッシュ区切りにする場合、共通修飾語は前置：
`Holy Father/Mother`（`Father / Holy Mother` ではない）

#### 3-3-7. `FirstPersonCalling_EN` 書式

| JP 一人称              | EN 形式                                                |
| ---------------------- | ------------------------------------------------------ |
| `ぼく` / `僕`          | `I (boku; masc. casual)`                               |
| `オレ` / `俺`          | `I (ore; masc. rough)`                                 |
| `わたし` / `私`        | `I`（女性マーカー不要なら省略可）                      |
| `ママ`                 | `Mama`                                                 |
| `こっち`               | `I/me (kocchi; informal self-ref.)`                    |
| `オイラ`               | `I (oira)`                                             |
| `俺っち`               | `I (orecchi)`                                          |
| 方言・古語             | `I (archaic masc. dialect)` 等コンテキスト注釈を付ける |
| 複数の一人称（文脈別） | `\n` で区切る                                          |

#### 3-3-8. `SecondPersonCalling_EN` 書式

| JP 二人称         | EN                            |
| ----------------- | ----------------------------- |
| `あなた`          | `you (neutral/polite)`        |
| `あなた様`        | `you (very polite)`           |
| `あんた`          | `guy/girl(s) (anta; rough)`   |
| `キミ` / `君`     | `you (familiar)`              |
| `お前` / `おまえ` | `you (omae; rough/familiar)`  |
| `[※三人称]`       | `[*third-person calling]`     |
| `貴殿(きでん)`    | `your lordship (kiden; rare)` |
| 名前呼び          | `[*by name]`                  |

#### 3-3-9. DB 別 ThirdPersonCalling_EN 対応状況

| DB                    | 状況                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------- |
| NT db_Primary         | 全件あり（2026-06-14 修正: Num 5/7/14/19/32/40/41/51）                                 |
| NT db_SemiPrimary     | 全件あり（2026-06-14 修正: 200-dev）                                                   |
| NT db_Secondary       | 0xA–0xF 追加済（2026-06-14）。他レコードに ThirdPersonCalling なし                     |
| FL db_Primary         | 全件あり                                                                               |
| FL db_PrimaryDealer   | 全件あり（2026-06-14 修正: `*のこ` / `~君` 各1件）                                     |
| DestinyFoxRecords     | 全件あり（2026-06-15 修正: `(as Mr/Ms.~)` 注釈削除 2件）                               |
| ShouArRiders          | 全件あり                                                                               |
| Proxies               | 全件あり（2026-06-15 修正: `(as Mr/Ms.~)` 注釈削除・`[by name]` → `[*by name]` 各1件） |
| PastDivers            | 全件あり                                                                               |
| SinisterChangingGirls | 全件あり（2026-06-15 修正: `[by name]` `*` 欠落 1件・`(as Mr/Ms.)` 注釈削除 1件）      |
| UnauthedLogica        | 全件あり（2026-06-15 修正: `(as Mr/Ms.~)` → `Mr./Ms.~` 変換 1件）                      |
| UnibyteLive           | `ThirdPersonCalling` なし（配信系フィールド中心。→ §4-7）                              |

---

### 3-4. `Character_EN` / `Hobby_EN` / `SpecialSkill_EN` / `Favor_EN` / `Unlike_EN`

- 複数行は `\n` で区切る
- `Unlike_EN`: 日本語ネットスラング系補足（例: `'G'`）は省略し主要語のみ記載
- `hideText` オブジェクトの場合: `{ hideText: '???' }` の sibling として `_EN` キーを追加

---

### 3-5. `NumerospecAbout_EN`（NumberTales 固有）

> **配置（2026-08-20〜）**: `NumerospecAbout_JP` / `_EN` はトップレベルではなく `NumerospecStats` 配下にある。
> 同様に `ArcanumspecAbout` は `ArcanumspecStats`、`ChronospecName` / `ChronospecAbout` は
> `ChronospecStats`、`BeastspecName` / `BeastspecAbout` は `BeastspecStats` の配下。翻訳の書式ルール自体は変わらない。
> （綴りは 2026-08-20 に **`Arcanum`** へ統一済み。旧 `Arcanam` 表記はフィールド名・`References/ref_*` の
> 用語と本文とも `Arcanum` へ移行しており、新規の英訳でも `Arcanumspec` を使う。）
> `LogicspecAbout` も同様に `LogicspecStats` 配下（2026-08-20 に器を新設）。5 作品すべてで `*specStats` 配下に揃った。

1〜2行の簡潔な説明文。複数行は `\n` で区切る。
主語を省いた体言止め or 動詞句で統一:

```
"Guarantees mental and physical health"
"Makes others declutter\nThis eliminates waste and excess from the master's daily life"
"Shares the blessings of prayer"
```

---

### 3-6. `Summary_EN`

- 既存値が JP と異なる（人間監修済み）場合は上書き禁止
- 2〜4段落が多い。段落間は `\n` 区切り（`\n\n` ではなく `\n`）
- キャラクター名は `'N(Name)'` 形式（例: `'96(Rota)'`）
- he/she は GenderType に従う（→ セクション 1）
- セリフを引用する場合はダブルクォート: `"I want a body where hard work never betrays me."`

---

### 3-7. `Backgrounds_EN` / `InStory_EN` / `RelationNotes_EN`

**`Backgrounds_EN`**: 1〜2文の背景情報。固有名詞（人名・型番等）はそのまま保持。

NT db_SelfSecondary 等でよく使われる頻出パターン:

| JP パターン                  | EN パターン                                  |
| ---------------------------- | -------------------------------------------- |
| `ちなみに、〜`               | `Incidentally, ...`                          |
| `〜から由来`                 | `Derived from ...`                           |
| `なお、〜`                   | `Note: ...`                                  |
| `〜と姉妹関係は無い`         | `has no sibling relationship with '...'`     |
| `〜と義理の姉妹関係にある`   | `has a step-sibling relationship with '...'` |
| `〜に強く関連しているらしい` | `Reportedly has strong ties to '...'`        |

キャラクター名を引用する場合は `'Num(Name)'` 形式（例: `'366 (Leaperlica)'`）。

**`InStory_EN`**: 作品内の役割・立場説明。特殊ユニット型は `"Unit.N+M type"` 形式。

**`RelationNotes_EN`**: 各キャラとの関係メモ。

- キャラクター名: `'N(Name)'` 形式（例: `'6(Sics)'`）または `\"Quoted Name\"` 形式
- 独自の呼称スタイルを持つキャラは、そのスタイルをそのまま反映:
  例) `Looks up to '6(Sics)' as her "Sister.6(Sics)"`（`nee-sama` というロマナイズより実際の呼称形式）
- 複数行は `\n` で区切る

---

### 3-8. `Relation.Comments_EN`

**フォーマット**: ダブルクォートで囲む（JSON 内ではエスケープ `\"`）

```json
"Comments_EN": "\"A truly wonderful person.\""
```

**上書き条件**: `entry.Comments_EN === entry.Comments`（= まだ JP のまま）の場合のみ上書きする。

**代名詞**: 言及対象キャラの GenderType に従う（→ セクション 1）。例外なし。

**セリフ形式**: 台詞はそのままの文体を保つ。

- `w`（笑）→ `hehe`（`lol` は使わない）
- `はぁ…` → `*Sigh*...`
- 絵文字（`♡` `♪` `☆` `★`）は JP 原文のまま保持（`♥` 等に変換しない）

---

### 3-9. `ConversationPattern` 配下の英訳フィールド

`ConversationPattern` オブジェクトに以下の `_EN` フィールドを対応する JP フィールドの直後に挿入:

| JP フィールド       | EN フィールド          |
| ------------------- | ---------------------- |
| `TalkingTone`       | `TalkingTone_EN`       |
| `TopicPreference`   | `TopicPreference_EN`   |
| `TalkFrequency`     | `TalkFrequency_EN`     |
| `PreferredTopics`   | `PreferredTopics_EN`   |
| `AvoidedTopics`     | `AvoidedTopics_EN`     |
| `ConversationNotes` | `ConversationNotes_EN` |

**`DialogueExamples`（DE）の処理**:

```json
{
  "value_JP": "（JP の台詞）",
  "value_EN": "（翻訳した台詞）",
  "about": "（JP の状況説明）",
  "about_EN": "（翻訳した状況説明）"
}
```

- 元のフォーマット:
  - `value` が文字列 → `value_JP` にリネーム、`value_EN` を追加
  - `value` がオブジェクト `{value: "..."}` → `value_JP` にリネーム、`value_EN` を追加
- `about` が存在し `about_EN` が未存在の場合のみ `about_EN` を追加

---

### 3-10. `FormalName_EN` / `Name_EN`

実データで最多の `_EN` フィールド（`FormalName_EN` 1185 件 / `Name_EN` 308 件、全作品）。いずれも `_JP`/`_EN` ペア型。

**`FormalName_EN`**: 正式名称・型式名の英訳。作品ごとに体系が異なるため、既存値の体系をそのまま踏襲する。

| 作品                | JP 例                   | EN 例                                                      | 方針                                |
| ------------------- | ----------------------- | ---------------------------------------------------------- | ----------------------------------- |
| NumberTales         | `ナンバーテールズ1番機` | `NumberTales #1`                                           | `#N` 表記                           |
| DestinyFoxRecords   | `銫133:=9192631770刻`   | `Cesium133:=9192631770clocks (* no one knows how to read)` | SI 単位系の固有表現を維持（→ §4-5） |
| FLInvestigator78 等 | —                       | —                                                          | 既存体系を踏襲                      |

**`Name_EN`**: 呼び名・通称の英訳。DestinyFoxRecords では SI 単位記号を冠した固有名（`メトレ` → `Metre_SI-L`、`ケルビン` → `Kelvin_SI-Θ`）になっており、`_SI-<記号>` サフィックスを保持する。

---

### 3-11. `ModelName_EN`

機体名・型式（`_JP`/`_EN` ペア型、146 件。NumberTales / PastDivers / SinisterChangingGirls / UnauthedLogica）。

- 「N号機 / N番機」→ `Unit.N` または `Mk.N` 形式。
- 例: `ナンバーテールズ試作型1号機(1番機)` → `NumberTales' Prototype Mk.1 as Standard Unit.1 (Mk.1)` / `ナンバーテールズ1号機改(2番機)` → `NumberTales Unit.1 Revised (Mk.2)`。
- 括弧書きの補助番号（`(N番機)`）は `(Mk.N)` として保持。

---

### 3-12. `SPCodeName_EN`（NumberTales 固有）

特殊コードネーム（`_JP`/`_EN` ペア型、124 件。NumberTales の Primary / SemiPrimary / SelfSecondary）。

> **重要 — `CodeName_EN`（§3-1）とは数詞方式が異なる。** `SPCodeName_EN` は**標準の英語数詞（複合形あり）**を使う。`CodeName_EN` の「桁別連結（`Seven-Zero`）」方式を適用しないこと。

| JP               | EN                        |
| ---------------- | ------------------------- |
| `一,初`          | `First`                   |
| `次`             | `Next`                    |
| `十`             | `Ten`                     |
| `十一`           | `Eleven`                  |
| `十五\n(一半十)` | `Fifteen\n(One-Half Ten)` |
| `廿`             | `Twenty`                  |
| `廿一`           | `Twenty-One`              |

- 複数候補のカンマ区切り（`一,初`）は、代表 1 語（`First`）に集約された実例がある。
- 補足の括弧書き・改行（`\n`）は JP の構造を保持。

---

### 3-13. `Motif_EN`

デザインモチーフの語句リスト。`Motif` オブジェクト内に **`Motif_JP`（配列）と `Motif_EN`（配列）** を持つ入れ子ペア型（187 件）。

- 各要素は外見・服飾・特徴を表す短い英語句（`"red orange hair"`, `"fox ears(left ear drooping)"`, `"arrow-shaped chest zipper"` 等）。
- `Motif_JP` と要素数・順序を一致させる。
- 文ではなく名詞句で統一。冠詞は原則付けない。

---

### 3-14. `MarkColor_EN` / `MarkNotation_EN` / `MarkPosition_EN`（NumberTales Primary）

刻印（マーク）の色・表記・位置（各 201 件、`_JP`/`_EN` ペア型）。

| フィールド        | 方針                                                          | 例                                                                                                                                   |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `MarkColor_EN`    | 色名のみ・小文字                                              | `赤` → `red` / `橙色` → `orange` / `暗色` → `dark`                                                                                   |
| `MarkNotation_EN` | 表記内容。和文の鉤括弧「」内はシングルクォート `'...'` で囲む | `アラビア数字の「1」` → `Arabic numeral '1'`                                                                                         |
| `MarkPosition_EN` | 位置を説明する名詞句                                          | `トップスの左胸` → `the left chest of the top` / `球体の前面左胸の白色部分` → `the white area on the front-left chest of the sphere` |

---

### 3-15. `Strength_EN` / `Weakness_EN`

長所・短所（`Strength_EN` 29 件 / `Weakness_EN` 32 件、`_JP`/`_EN` ペア型）。

- 1 項目 1 文の説明句。主語は省略し、動詞句・形容詞句で始める実例が多い。
- 補足の括弧書きは保持: `泳げない（炭酸風呂でさえ溺れかけた経験あり）` → `Cannot swim (has nearly drowned even in a sparkling bath)`。
- 並列は `/` または `;`、`—`（em dash）で接続した実例がある: `予定が狂わない/予定を狂わさせない` → `Never falls behind schedule / refuses to let others fall behind schedule either`。
- 複数行は `\n` で区切る。

---

### 3-16. `DayAbout_EN`

記念日・特定日の説明（131 件、`_JP`/`_EN` ペア型。NumberTales / SinisterChangingGirls / UnauthedLogica / UnibyteLive）。

- 簡潔な名詞句。`記念` → `commemoration`、`〜の日` → `Day ...`。
- 文脈注記の括弧は保持: `第一リリース記念(劇中)` → `First release commemoration (in-story)` / `第一リリース記念(忠実)` → `First release commemoration (faithful ver.)`。
- 例: `開発記念` → `Development commemoration` / `育て主に拾われた日` → `Day found by foster master`。

---

### 3-17. `AdditionalDesigned_EN`

追加デザイン・制作クレジット（39 件、`_JP`/`_EN` ペア型。FLInvestigator78 / NumberTales）。

- **固有名・ハンドルネーム・URL はそのまま保持**（翻訳・改変しない）。
- ラベル部分のみ英訳: `カードイラスト：` → `Card Illustration：` / `カード背景・CG：` → `Card Backimage & CG：`。
- 全角コロン `：` と改行 `\n` の区切り構造を維持する。

---

### 3-18. `Unit_EN`（DestinyFoxRecords 固有）

単位記号に対する物理量名（9 件、`_JP`/`_EN` ペア型）。

- `Unit_JP` は SI 単位記号（`s`, `m`, `kg`, `cd`, `K`, `A`）、`Unit_EN` は対応する物理量名。
- 例: `s` → `Time(KMS Method)` / `m` → `Length(KMS Method)` / `kg` → `Mass(KMS Method)` / `cd` → `Luminous Intensity` / `K` → `Thermodynamic Temperature` / `A` → `Electric Current`。

---

## 4. 作品別固有ルール

### 4-1. NumberTales

- `TailsUnit`: `$Def_TailsUnit` 構造化型（自由記述訳は不要）。セクション 3-2 参照
- `CodeName_EN`: 漢数字→桁別英語数詞（セクション 3-1）
- `NumerospecAbout_EN`: 体言止め or 動詞句
- `corefolder` は**全文小文字**（`CoreFolder` ではない）

### 4-2. FLInvestigator78

- `CodeName_EN`: タロットカードの公式英語名（例: `High-Priestess`, `Hermit`）
- `ArcanumspecAbout_EN`: NumerospecAbout_EN と同じ形式
- `EffectText_EN`: ランク説明の固定文。**レコード側ではなく辞書側**（`DataBases/db_meta.json` の `General.$VarsDef.$Def_ArcanumspecStats.$Def_EffectStats.#ListLink_EffectText[]`）に `EffectText` / `EffectText_EN` ペアとして定義される enum。レコードの `EffectText`（JP）は enum 値を参照する。固定訳の例: `危険`→`Dangerous` / `絶大`→`Tremendous` / `期待`→`Expected` / `希薄`→`Dilute` / `効果無`→`No Benefit` / `逆効果`→`Counterproductive`。新訳は追加せず、既存 enum に従う。
- `For79thDealerCalling_EN` / `For80thDealerCalling_EN`: ForMasterCalling_EN と同形式

### 4-3. ShouArRiders

- `BeastspecName_EN`: 獣の属性を英訳した固有名詞
- `BeastspecAbout_EN`: NumerospecAbout_EN と同形式

### 4-4. PastDivers

- `ChronoholderName_EN`: `ChronoRize`, `ChronoFreeze` 等の固有 EN 名
- `ChronospecName_EN`: 詩的な英語表現（`"Beginning of Impulse"` 等）
- `ChronospecAbout_EN`: 時間能力の効果説明（13 件）。主語を省いた動詞句で統一。例: `時間の進行を加速させる` → `Accelerates the flow of time` / `時間の進行を止めて動きを封じる` → `Stops the flow of time, sealing movement` / `時間を逆行し傷を癒す` → `Reverses time to heal wounds`。
- `ChronoizedAbout_EN`: 複数段落可
- `Career_EN`: 経歴文（13 件）。複数文の散文。`夜月機関` → `Yadzuki Orgs`、登場キャラ名は `'Name'` 形式で引用するなど、固有名詞の既存訳を踏襲する。

### 4-5. DestinyFoxRecords / Proxies

- `CodeName_EN`: SI 単位系（`Metre_SI-L`, `Kelvin_SI-Θ` 等）
- `Name_EN` / `FormalName_EN`: SI 単位系の固有名（§3-10）。`_SI-<記号>` サフィックスや特殊表記を保持
- `Unit_EN`: SI 単位記号 → 物理量名（§3-18）
- `InStory_EN` / `Backgrounds_EN`: メタキャラクター向けの簡潔な説明

### 4-6. UnauthedLogica

- `LogicspecAbout_EN`: 論理能力の効果説明（4 件、`db_PrimaryMobs`）。動詞句で統一。例: `状態を切り下げ/切り上げする` → `Cuts off / rounds up state values` / `論理的計算をする` → `Performs logical calculations` / `アリスメティアの能力を拡張する` → `Extends the capabilities of the Arithmetica series`。
- 固有シリーズ名（`アリスメティア` → `Arithmetica` 等）は既存訳を踏襲。
- `Strength_EN` / `Weakness_EN`: §3-15（`db_PrimaryMobs` に実在）。

### 4-7. UnibyteLive

配信者（VTuber 系）モチーフの作品。本作固有の配信系フィールドを持つ。

`StreamingActivity` 配下の**配列系フィールドは和英共有フィールド**で、`Field_JP` / `Field_EN` へ分けず 1 要素に `value_JP` / `value_EN`（＋補足があれば `about_JP` / `about_EN`）を持つ（§3-9 の DialogueExamples と同じ流儀）。翻訳対象は要素内の `value_EN` / `about_EN` であり、`StreamingCategory_EN` のようなフィールドは存在しない。

- `StreamingSummary_EN`: 配信活動の概要（散文、複数段落可）。ここだけは `_JP`/`_EN` ペア型（グローバルの `Summary_JP`/`Summary_EN` と同じ扱い）。
- `StreamingCategory[].value_EN` / `.about_EN`: 配信カテゴリと、その補足。例: `{ "value_JP": "リスナーとの交流", "value_EN": "Interaction with listeners", "about_JP": "メイン活動,…", "about_EN": "Main activity, …" }`。
- `StreamingGreeting[].value_EN`: 挨拶定型句。キャラの口癖を反映した意訳。例: `こんな～み！` → `Hi, Surger!` / `ジグザってるか〜！` → `Are you zigzagging?`。
- `StreamingAwards[].value_EN`: 受賞・実績。例: `Holds a game engine patent`。
- `ListenerNickname_EN`: リスナー呼称（ファンネーム）。ここは bilingual wrapper（`ListenerNickname: { ListenerNickname_JP, ListenerNickname_EN }`）。造語は意訳: `なみのりー` → `Surger(s)` / `ノコギリ族` → `Zigzaggers`。
- `AccessoryUnit_EN`: 装身具・付属パーツの説明（名詞句）。例: `Sの字状に波打ったポニーテールや猫型の尻尾` → `S-shaped wavy ponytail and cat-like tail`。
- 基本フィールド（`FormalName_EN` / `Name_EN` / `CodeName_EN` / `DayAbout_EN`）も使用。`ThirdPersonCalling` 系は現状未収録（→ §3-3-9）。

---

## 5. フォーマット・表記規則

### 5-1. 括弧・ブラケット

| 用途             | 記法               | 例                                                          |
| ---------------- | ------------------ | ----------------------------------------------------------- |
| 参照・補足       | `[*説明]`          | `[*by name]`, `[*Adapts to the master's preferences]`       |
| ロマナイズ注釈   | `(romaji; 補足)`   | `(ore; masc. rough)`, `(shi; exceptions apply)`             |
| 注釈のセミコロン | 括弧**内**に収める | `(*shi; exceptions apply)` ○ / `(*shi); exceptions apply` ✗ |

### 5-2. 特殊ユニット・役職名

| JP                | EN                                        |
| ----------------- | ----------------------------------------- |
| `Unit.N+M 型`     | `Unit.N+M type`                           |
| `～教官`          | `Instructor.~`                            |
| `～トレーナー`    | `Trainer.~`                               |
| `先生`            | `Teacher [Name]`                          |
| `～先輩`          | `~-senpai`                                |
| `～君/くん`       | `~-kun`                                   |
| `～ちゃん`        | `~-chan`                                  |
| `～兄さん/姉さん` | `-bro/sis (-niisan/-neesan), big bro/sis` |

### 5-3. 絵文字・特殊文字

| JP 原文                      | EN 処理                          |
| ---------------------------- | -------------------------------- |
| `♡`                          | そのまま `♡`（`♥` に変換しない） |
| `♪`                          | そのまま `♪`                     |
| `☆` / `★`                    | そのまま `☆` / `★`               |
| `w`（笑）                    | `hehe`                           |
| `はぁ…`                      | `*Sigh*...`                      |
| `（※検閲で削除されている…）` | `(* censored...)`                |

### 5-4. 架空コンテンツ名

JP タイトル + ローマ字副題（`タイトル(ローマ字副題)` 形式）の場合、ローマ字副題のみを使用:
例) `御伽の電子妖精(テールズ ｅ-フェアリーズ)` → `Tales e-Fairies`

---

## 6. スキップ条件

以下の場合は `_EN` フィールドを追加・変更しない:

1. `field_EN` がすでに存在し、値が対応 JP フィールドの値と**異なる**（人間監修済み）
2. 対応する JP フィールドが `null` または空文字列
3. 対応する JP フィールドが `hideText` オブジェクトで、かつ `_EN` 版の追加場所が定義されていない
4. `_Search` で複数レコードにマッチする参照（ambiguous reference）

---

## 7. 実装メモ（スクリプト向け）

### キー順序を保つ insertAfterKey パターン

```javascript
function insertAfterKey(obj, baseKey, enKey, enValue) {
  if (enKey in obj) return obj; // すでに存在する場合はスキップ
  const keys = Object.keys(obj);
  const idx = keys.indexOf(baseKey);
  const result = {};
  if (idx === -1) {
    for (const k of keys) result[k] = obj[k];
    result[enKey] = enValue;
  } else {
    for (let i = 0; i <= idx; i++) result[keys[i]] = obj[keys[i]];
    result[enKey] = enValue;
    for (let i = idx + 1; i < keys.length; i++) result[keys[i]] = obj[keys[i]];
  }
  return result;
}

// 必ずこのパターンで使う（Object.assign は使わない）
db = db.map((rec) => {
  if (rec.Num !== TARGET_NUM) return rec;
  let current = rec;
  current = insertAfterKey(current, "FieldJP", "FieldJP_EN", "EN value");
  // ... 追加フィールド分だけ current = insertAfterKey(...) を連鎖
  return current;
});
```

**禁止パターン**: `Object.assign(rec, insertAfterKey(...))` — 新規キーが末尾に追記されキー順序が崩れる。

### Comments_EN の上書き判定

```javascript
function setCommentEN(record, type, targetNum, enText) {
  const entries = record.Relation?.[type];
  if (!entries) return;
  for (const entry of entries) {
    // String() で比較することで "00"（文字列）も安全にマッチ
    if (
      String(entry.Num) === String(targetNum) &&
      entry.Comments &&
      entry.Comments_EN === entry.Comments
    ) {
      entry.Comments_EN = enText;
    }
  }
}
```

---

## 8. 参照先ドキュメント

| 対象                 | 参照先                                                              |
| -------------------- | ------------------------------------------------------------------- |
| スキーマ全体         | `data/db_type.json ($DefType)`                                      |
| DeepL 翻訳運用       | `docs/deepl-localization.md`（用語集・添削補助・上書き禁止の境界）  |
| API/SW 仕様          | `docs/api-sw-spec.md`                                               |
| 実装方針             | `docs/implementation-playbook.md`                                   |
| 英訳作業進捗（最新） | `_work_in_progress/2026-06-24_progress_localization-rules-audit.md` |
| 英訳作業進捗（旧）   | `_work_in_progress/2026-06-15_progress_localization-audit.md`       |
