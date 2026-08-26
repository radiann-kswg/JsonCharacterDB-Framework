# AGENTS.md — JsonCharacterDB-Framework（エージェント共通・正典 / SSOT）

> **このファイルは本リポジトリにおけるエージェント指示の「唯一の正典（Single Source of Truth）」です。**
> Claude（Cowork / Claude Code）・OpenAI Codex・GitHub Copilot など、AGENTS.md 規約に従うすべてのエージェントは、
> 本リポジトリでの応答にあたり本ファイルを読み込み・順守してください。
>
> 各ツール向けの入口ファイル（`CLAUDE.md` / `.github/copilot-instructions.md` / `.claude/skills/`）は、
> 重複を避けるため**本ファイルを正典として参照または生成**します。

---

## 0. ロールプレイ設定（差し替え自由・既定は無効）

本フレームワークは「エージェントに任意の人格を与えて運用する」ことを想定しています。
人格の本文は**このファイルには書かず**、`.agents/roleplay/ROLEPLAY.md` に置いてください。

- **既定**: `.agents/roleplay/ROLEPLAY.md` が存在しない、または本文が空 → **ロールプレイなし**（素の技術アシスタントとして応答）。
- **有効化**: `.agents/roleplay/ROLEPLAY.template.md` を `ROLEPLAY.md` としてコピーし、人格を記述する。
- **エージェントの義務**: セッション開始時に `.agents/roleplay/ROLEPLAY.md` の有無を確認し、
  存在すればその内容を本ファイル §1 以降の技術ルールより**優先度は下**、ただし**口調としては常時適用**する。
- **不変の前提**: ロールプェイの有無にかかわらず、下記「技術・運用ルール」の実行精度は落とさない。
  User から「ロールプレイをやめて」と言われたら即座に停止する。

> 実例が欲しい場合は、派生リポジトリ `RadianNs_SecondaryWorksDB` の `.agents/roleplay/ROLEPLAY.md`（キャラクター「扇一春」）を参照してください。

---

## 1. このリポジトリの立ち位置

| 区分 | リポジトリ | ライセンス |
| --- | --- | --- |
| 上流（本家データベース） | `radiann-kswg/100BeautiesLab_CreationsDB` | 独自（作品ガイドライン準拠） |
| **本リポジトリ（汎用フレームワーク）** | `radiann-kswg/JsonCharacterDB-Framework` | **CC BY-NC 4.0** |
| 派生（二次創作作品DB / Private） | `radiann-kswg/RadianNs_SecondaryWorksDB` | 独自（無断転載・商用利用不可） |

本リポジトリには**創作データの実体を置きません**。`data/Works_Sample/` は動作確認用の雛形です。

### 1-1. フォーク同期（上流 → 本リポジトリ → 派生）

3 つは GitHub 上のフォークではなく**履歴が無関係な独立リポジトリ**です。そのため上流を直接 merge せず、
マニフェストで絞り込んだ**ベンダーブランチ**を経由します。**正典は [`docs/fork-sync.md`](./docs/fork-sync.md)。**

```
上流/develop ──[.sync/upstream.json で絞り込み]──▶ upstream/creationsdb ──[git merge]──▶ develop
```

| やること | コマンド |
| --- | --- |
| 上流との差分を見る | `npm run sync:check`（差分ありで exit 1 / オフラインは `sync:check:offline`） |
| ベンダーブランチを進める | `npm run sync:update` |
| 取り込む | `git merge upstream/creationsdb` → `npm test` |

**エージェントが守ること:**

- **`git merge` を勝手に実行しない。** `sync:update` までは行ってよいが、`develop` への取り込みと
  コンフリクト解決は User の判断です。
- **同期対象は `.sync/upstream.json` だけが決める。** 判断に迷っても推測でファイルをコピーしない。
  対象を変えたいときはマニフェストを編集し、理由を User に説明すること。
- **`data/**` を同期対象へ入れない。** 本リポジトリが創作データを持たない前提が崩れます。
- **ツールを `exclude` したら、そのツールのテストも必ず `exclude` する。** 片方だけだと `npm test` が壊れます。
  この対応関係は `tests/sync-upstream.manifest.test.js` が固定しています。
- **フレームワークのバグは上流で直す。** 本リポジトリで直接直すと次回の同期でコンフリクトになります。

定期点検は 2 系統です。詳細は `docs/fork-sync.md` §7。

- **GitHub Actions**: `.github/workflows/upstream-sync-check.yml`（毎週月曜 09:00 JST・差分があれば Issue を起票/更新）
- **Cowork 週次タスク**: 差分の中身を判断し `_work_in_progress/YYYY-MM-DD_upstream-sync.md` へレポート

依存関係の定期更新は `.github/dependabot.yml`（npm / GitHub Actions・毎週月曜 09:00 JST）。
`.github/**` は**同期対象外**で各リポジトリ個別管理です。

---

## 2. 指示書を更新するときの手順

1. **`AGENTS.md` を編集する**（技術ルール・運用ルールの追加・変更は必ずここ）。
2. `npm run agents:build` を実行して生成物を更新する。
3. 生成物も含めて同じコミットに入れる（`npm run agents:check` / `npm test` がズレを検出します）。

対象の生成物: `.github/copilot-instructions.md` / `.claude/skills/**`

---

# 技術・運用ルール


## 基本ルール（前提条件）

- **回答は必ず日本語で行ってください。**
- 変更量が 500 行を超える可能性が高い場合は、事前に「この指示では変更量が 500 行を超える可能性がありますが、実行しますか?」と確認してください。
- 大きな変更（多数ファイル生成・構成変更・ルール追加など）を行う前に、まず計画を提示し「このような計画で進めようと思います。」と提案してください。
- 不確かな点がある場合は、リポジトリのファイルを探索し、User に「こういうことですか?」と確認してください。
- 大きな変更（複数ファイル編集・データの大量更新・運用ルール追加など）を行う場合は、公開可能な範囲で `./_work_in_progress/` に進捗レポートを残してください。
  - 推奨ファイル名: `YYYY-MM-DD_progress.md`（同日に複数ある場合は `YYYY-MM-DD_progress_<topic>.md`）
  - 最低限の内容: 目的 / 変更点の要約 / 影響範囲（編集したファイル）/ 未完了タスク / 参考リンク
  - 追加で入れて良い内容: 背景・課題 / 合意事項（ルール）/ 実装方針 / 検証（テスト・確認観点）/ 補足（今後の運用）
  - 自動トリアージ（GitHub Issue triage 等の scheduled タスク）やエージェントによる調査・修正方針の **提案ログ** も、本リポジトリでは `./_work_in_progress/` に残す（`.wip/` は使わない。ファイル名例: `YYYY-MM-DD_github-triage.md`）。
- `_work_in_progress/` の完了ログは `_work_in_progress/.completed/` に退避します（Git 管轄外 / `.gitignore` 対象）。
  - 原則: 進行中のログのみ `_work_in_progress/` 直下に残す
  - 退避先（`.completed`）への書き込み/移動は、User の依頼がある場合のみ行う
  - 整理（退避）を行った場合は、`_work_in_progress/README.md` の「進行中/完了」一覧も更新して見通しを維持する
- **一時的に生成するキャッシュ・出力ファイルは `./.cache/` 配下に格納してください。**
  - 対象の目安: テスト実行のログ（例: `test_output.txt` / `test_results.txt` / `test_out.log`）、デバッグ用ダンプ、中間生成ファイルなど
  - `./.cache/` は `.gitignore` 対象（Git 管轄外）です。リポジトリ直下や `data/` 等の管理対象ディレクトリに一時ファイルを直接書き出さないでください
  - フォルダが無ければ作成して構いません（PowerShell: `New-Item -ItemType Directory -Force -Path .cache` / POSIX: `mkdir -p .cache`）。User が明示的に別の出力先を指定した場合はその指示を優先します
- **重要な仕様変更時は `CHANGELOG.md` も更新してください。**
  - 対象の目安: Service Worker のルーティング/API、`lib/` の共通処理、参照解決（enrich/search）、`db_type.json`/`db_meta.json` の仕様、`pages/characters.js` の表示仕様など
  - 原則: 変更と同じコミット/PR 内で `CHANGELOG.md` に追記し、必要に応じて `_work_in_progress/` に補足ログを残す

## 最近の重要方針（要点）

- **スキーマ駆動（最優先）**: UI/Service Worker ともに、挙動や表示項目は可能な限り `db_type.json($DefType)` をソース・オブ・トゥルースとして追従させます。
- **typedef 駆動の優先順位**: enrich/search 等で typedef を解釈する場合、優先順位は **表示分類 → 正規化 → 画像 → 検索**（上位ほど破壊的になりやすいため、下位拡張は慎重に段階導入）。
- **enrich 出力メタ**: enrich の結果には、UI が表示制御に使えるメタ情報（例: `_enrichment.displaySections`）を付与する設計を許容します。
- **作業の粒度**: 注釈追加やリファクタは「今回触る範囲に限定」し、全体の一括整形・一括注釈化は避けます（必要時は計画提示のうえ段階導入）。
- **docs と指示書の同期**: 再利用する仕様判断・運用ルールは `docs/` と**本ファイル（`AGENTS.md`）** へ反映する前提で扱います。生成物（`.github/copilot-instructions.md`）へ直接書かないでください。

## 最近の実装運用ルール

- **UI 表示修正の第一候補**: 画面崩れや表示漏れは、まず `db_type.json($DefType)` / `$display` / `db_meta.json($DetailLayout)` で制御できないかを確認し、UI のハードコード追加は最後の手段とします。
- **フィールド順の正**: レコードのキー順・UI の表示順とも `db_type.json($DefType)` を正とします。作品固有フィールド（`Index` / `Images` / 作品固有 `_DBLink` 等）の配置は `$slot` マーカー（`$slotMatch` / `$slotExpand` / `$slotOrder` / `$slotAnchor`）で宣言し、ツールや UI に field 名依存の分岐を足しません。データのキー順は `npm run data:order:write` で整列し、`npm run data:order:check` と `tests/data.field-order.test.js` が守ります。詳細は `docs/schema-meta-processing.md` §5.4.1。
- **`$DetailLayout.subFields` はベース名で宣言する**: `Characters_JP` ではなく `Characters` と書きます。2 言語フィールド（`_JP`/`_EN`）は sub バケットへベース名で積まれるため、`_JP` 付きで宣言すると照合に失敗し並びが末尾へ落ちます。
- **`$DetailLayout.headerPills`**: ヒーロー帯の pill に出すキー。ここに載せたキーは基本情報テーブルへ二重表示されません（`Progress` 決め打ちではなく宣言に従います）。
- **`$DetailLayout` の役割**: グローバル宣言フィールドについては `basicFields` は「どれを basic に出すか」の選択に専念し、並び順は `$DefType` に揃えます。作品別 typedef 宣言のフィールドはグローバル `$DefType` に位置が無いため `$DetailLayout` が位置の正になり、`basicFields` 側は `#WorkBasic` の `$slotAnchor` が「`basicFields` 上の直前の隣人の直後」へ、`subFields` 側は `#WorkRest` の `$slotOrder` が catch-all スロット内の並びを決めます。
- **`basicFields` / `subFields` 両載せキー**: 表示は `subFields` が勝ち（UI の「1項目1箇所の原則」= `isPromotedSubFieldKey` が基本情報テーブル側を抑制）、キー順は `basicFields` が勝ちます。現状 `Works_Sample` の `TailsUnit` のみが該当し、表示位置とキー順がずれるのは User 判断による意図的な例外です（`docs/schema-meta-processing.md` §4.2）。
- **フラグ用の未宣言フィールド**: `isTriple` / `Regioministration` / `isPrivate` のように意図的に `$DefType` へ宣言していないフラグは、整列時に直前の宣言済みキーへアンカーされて元の位置に留まります。勝手に宣言を追加しません（ラベル付けは創作内容に踏み込むため User の判断）。
- **schema/meta 詳解の参照先**: 宣言面と SW/UI/enrich 内部での合流順を説明する場合は、まず `docs/schema-meta-processing.md` を参照・更新対象に含めます。
- **API/SW 技術説明の参照先**: API / SW 周辺の仕様整理や説明追加では、まず `docs/api-sw-spec.md` を参照・更新対象に含めます。
- **wrapper / section renderer の参照先**: `Day` / `Era` / `StoryEra` などの特殊 summary、`subFields` の standalone 描画、`$display.wrapper` / `$display.role` / `$display.sectionWrapper`、`_enrichment.wrapperSummaries`、`StoryEraSummary` 等を変更する場合は、まず `docs/wrapper-summary-registry.md` を参照・更新対象に含めます。
- **英訳(\_EN)入力補助の参照先**: `data/**` の `_EN` を補助するときは、正典 `docs/localization-en-rules.md` と早見表 `docs/localization-glossary-quickref.md` を参照します。Copilot は `.github/instructions/localization-en.instructions.md`（`applyTo: data/**`）、Claude は `data/CLAUDE.md`、Codex は `data/AGENTS.md` が入口です。**インライン補完（ゴーストテキスト）はカスタム指示を読み込まない**ため、早見表を隣タブで開いて近傍文脈に入れます。一括翻訳・既存英訳の突き合わせ・用語集同期は `tools/deepl/`（`docs/deepl-localization.md`）に委ねます。既存値の上書き・創作本文の新規生成はしません。
- **List 系詳細表示**: `#ListIndex[]` / `#ListLink[]` の object 配列は、詳細表示では 1 要素 1 行の multiline 表示を優先します。
- **bilingual multiline 表示**: `##String_JP` / `##String_EN` 系で和英のどちらかに改行が含まれる場合、詳細テーブルでは JP/EN を左右 2 列に分ける表示を優先します。
- **basic 補助項目の重複抑制**: `Belonging` / `Area` / `BirthDay` / `AnivDay` などの basic 補助行は、`$DetailLayout.basicFields` に既に含まれる場合は重複表示しません。
- **cross-work `_DBLink` 制約**: 別作品から `_DBLink` 参照で値を持ち込む場合は、対象作品の `db_type.json($DefType)` とグローバル `data/db_type.json($DefType)` に宣言されたトップレベル項目だけを許可します。
- **作品別 `db_meta.json` 欠損耐性**: 作品別 `db_meta.json` は追加価値レイヤーとして扱い、欠損時でも DB 取得 / 検索 / enrich を 500 で落とさず `_Commons` / `_Secondaries` だけをスキップして継続します。
- **辞書の実行時合流**: enum/list 辞書は `db_meta.json(General.$VarsDef)` と `db_type.json($VarsDef)` の両方から合成される前提で扱い、片側だけを正とみなして説明しません。
- **カタログ用メタ宣言**: 作品/DB の概要メタ（`CreationWorks`, `Databases.#DB_*`）の正式な補助 schema は、グローバル `data/db_type.json` のトップレベル `$MetaType` で管理します。
- **DB 表示名の正**: DB セレクトや作品概要の DB 見出しは、作品別 `db_meta.json` の `Databases.#DB_<DbName>.DB_Label` / `DB_Label_EN` を優先し、未定義時のみ SW の既定ラベル補完に依存します。
- **`DB_Hidden` によるDB完全非公開**: `db_meta.json` の `Databases.#DB_<DbName>` に `"DB_Hidden": true` を置くと、そのDB全体が SW の DB リストと直接アクセスの両方から 404 で遮断されます。`isPrivate`（レコード単位）と異なり DB 単位で作用します。メタ欠損時はチェックをスキップします（`docs/api-sw-spec.md` §5.3）。
- **`Works_Hidden` による作品完全非公開**: `data/db_meta.json` の `CreationWorks.#Works_<WorkName>` に `"Works_Hidden": true` を置くと、その作品全体が SW の作品一覧・配下DB・検索の全エンドポイントから 404 で遮断されます。グローバルメタ欠損時はチェックをスキップします（`docs/api-sw-spec.md` §5.4）。
- **横断運用の参照先**: 実装判断の横断ルールは `docs/implementation-playbook.md` を先に確認し、必要な差分だけ追加します。
- **wrapper / section renderer の第一候補**: 複合 summary は `pages/characters.js` や `lib/sw-common.js` に field 名依存の if を足す前に、`lib/wrapper-common.js` と schema の `$display.wrapper` / `$display.role` で吸収できないかを確認します。`subFields` の standalone 描画も同様に、`lib/section-wrapper-common.js` と `$display.sectionWrapper` で吸収できないかを確認します。
- **辞書行からの参照解決（`$dictRef`）**: `$Def_*` の子要素が「兄弟の辞書コードが指す辞書行の値」を必要とする場合は、レコード側へ値を複製せず `$dictRef: { from: "<兄弟の子要素>", field: "<辞書行のキー>" }` を宣言します。解決結果は enrich の `_enrichment.dictRefs` と basicFields の wrapper が使い、レコード本体の形は変えません（レコードが実値を持つ場合はそちらを優先）。旧形式のスカラー値を同じ経路で読ませたい場合は `$shorthand`、配列の連結方法は `$display.arrayLayout`（`multiline` / `inline`）で宣言します。
- **basicFields の構造型描画**: `$Def_*` 構造型の基本情報テーブル表示は `lib/basic-renders/` の wrapper（schema 側は `$display.wrapper`）へ寄せ、`pages/characters.js` に field 名・型名依存の分岐を足しません。「辞書参照の子要素はラベル解決し、`_JP` / `_EN` の子要素は補足として併記する」汎用整形は `lib/basic-renders/def-object-common.js` にあり、新しい `$Def_*` 用 wrapper はそこへ委譲する薄い登録ファイル（例: `faction.js` / `baseArea.js`）として追加します。
- **main code / subscript 分離原則**: `pages/characters.js` には全 JSON field 共通の API bridge / renderer dispatch / generic fallback だけを残し、field 固有の特殊処理（`Relation` の DOM 組み立て・辞書解決・直リンク生成等を含む）は `lib/wrapper-common.js` / `lib/section-wrapper-common.js` の built-in handler へ寄せます。
- **subscript helper の渡し方**: built-in renderer/wrapper が main code の helper を必要とする場合は、`helpers.relationApi` のような名前付き API object としてまとめて渡し、散発的な global 依存を増やしません。
- **subField 折りたたみ規則**: standalone subField の折りたたみ UI は「non-text section のみ」「初期状態は閉じる」を既定とします。primitive / `#String` / `#Summary` / `#Dialogue` は折りたたみ対象にせず、`hideText` を指定しても元の typedef が text-like なら折りたたみ有無を変えません。
- **hideText の表示経路維持**: `hideText` は value masking であり、section 種別や UI wrapper を変更する理由にはしません。元の typedef が string/summary/dialogue 系なら text-like な表示ルートを維持します。
- **subscript 注釈ルール**: `lib/wrapper-common.js` / `lib/section-wrapper-common.js` の built-in handler・helper・公開 API を追加/変更した場合は、他ファイル同様に日本語 JSDoc / 注釈を付け、期待する context/helper 契約をファイル内で追える状態にします。
- **catalog summary の生成規則**: works / db カタログの summary 追加は、可能な限り `$MetaType.$Def_DatabaseCatalog` を基準に `${hashTag}Summary` を自動生成する方式へ寄せ、特定 field の個別ハードコードを増やしません。
- **enrich summary の生成規則**: wrapper 対象の top-level field を SW/UI で再利用したい場合は、個別 field を別キーへ複製する前に `lib/data-common.js` の `_enrichment.wrapperSummaries` を使える形に寄せます。
- **`*_DBLink` suffix の自動ディスパッチ**: `{FieldName}_DBLink` で終わるフィールドは `lib/section-renders/dblink.js` の `dbLinkSection` renderer が suffix を自動検出して描画します（`$display.sectionWrapper` 指定不要）。`lib/section-wrapper-common.js` の `structuredObjectSection.match` に `*_DBLink` 除外条件があり、単一オブジェクト形式のフィールドでも正しく `dbLinkSection` へ委譲されます。
- **`$Def_DBLinkRef` フォーマット**: `*_DBLink` エントリ（UI リンク用）は `{ "_Work": "WorksTitle", "_DB": "DbName", "IndexKey": "IndexValue" }` 形式を正とします（ネストインデックス可。例: `"Card": { "Suit": "Major", "SuitNum": 17 }`）。旧形式 `{ worksTitle, dbName, _Search }` は廃止。ただし `EnrichmentProcessor.resolveDbLinkPrimaryRecord()` が使うレコードルートの `_DBLink`（マージ用）は旧形式のまま維持します。
- **`ThisMasters._DBLink` のフォーマット**: `$Def_DBLinkRef` 形式を使用。`lib/section-renders/thisMasters.js` の `hydrateThisMastersLink` は SENTINEL_KEYS（`_DB / _Work / label_JP / label_EN`）を除いた最初のキーをインデックスとして動的解決します。
- **画像以外のバイナリ資産（3Dモデル等）の追加パターン**: VRM 3Dアバター（`VRMs.corefolder_VRMPath`: `#VRMFilePath[]`）で確立したパターンとして、既存の `Images`/`ImageProcessor` パイプラインを流用・分岐で汚さず、専用型 + 専用 section-renderer（`$display.sectionWrapper`）+ client側専用URL構築ヘルパー（`pages/characters.js` の `buildTailsUnitImageUrl` 相当）で独立実装します。重い外部ライブラリ（three.js 等）が必要な場合は `pages/vendor/` に同梱（外部CDN非依存）し、ユーザー操作（ボタン押下等）まで動的 `import()` を遅延させます。詳細は `docs/wrapper-summary-registry.md` の `vrmViewerSection` / `docs/schema-meta-processing.md` の `#VRMFilePath` を参照してください。

## ブランチ運用方針

### `develop` ブランチ（コアドキュメント・主機能）

- コアコード・ドキュメントの source of truth。このブランチへのコミット・PRが原則。
- **AIHints 関連のコード・スキーマ・エンドポイントは `develop` に含めない**（`addon-ai-tag` ブランチで管理）。

### `addon-ai-tag` ブランチ（AIHints 専用機能）

- `develop` を定期的にマージしながら派生する「拡張ブランチ」。`develop` → `addon-ai-tag` の一方向マージのみ。
- **`addon-ai-tag` → `develop` への逆マージは行わない**。
- 対象: `pkg/cloudflare/schema/d1-aihints.sql`、AIHints エンドポイント（Worker）、`migrate-aihints.mjs`、`cf-api-sync.yml` の AIHints 投入ステップ、`docs/aihints-spec.md`。
- `develop` ブランチで作業中に AIHints 関連の要件に触れた場合、実装は `addon-ai-tag` に委ね、`develop` 側では「仕様上 `addon-ai-tag` で実装」という旨の注記にとどめる。

## サブローカル並行作業運用（予備作業場）

> 本体ローカル（メイン作業ディレクトリ）が特定ブランチで作業中に、別ブランチでの作業を並行したい場合の運用。同一リモートを参照する予備のローカルクローンを「サブローカル」として活用する。

### 前提（環境構成）

- 本リポジトリは、同一リモート（`origin` = `<your-account>/<your-repo>`）を参照する**複数のローカルクローン**で運用されることがある。
  - **本体ローカル**: 現在の主作業ディレクトリ。
  - **サブローカル ×3**: 固定用途を持たない**汎用の予備作業場**。ブランチ単位で使い分け、本体と並行して別ブランチ作業を行うために用意する。
- 本書では 4 環境を **`main`（本体ローカル）/ `sub1` / `sub2` / `sub3`（サブローカル）** と呼称する。エージェントもこの呼称で言及すること。
- 各環境が**現在どの作業を担当しているか**は Git 管理外の `README.LOCAL.md` に記載する（後述「ローカル環境の作業分担（`## 作業分担` 節）」）。
- サブローカルは「ブランチごとに使い分け可能な予備作業場」であり、特定の作業内容を恒久割り当てしない（その時々の必要ブランチをチェックアウトして使う）。
- ただし、時期を限った**暫定の担当分け**が `README.LOCAL.md` の `## 作業分担` 節に定義されている場合は、恒久割り当てではない前提でそれを優先する。
- 各ローカルの物理パスは環境依存のため本書にハードコードしない。Cowork 等では接続済みフォルダ（マウント）として与えられる。

### 発動条件（エージェントの自律判断）

- エージェントは、**本体ローカルと同時に作業できない状況**では自律判断でサブローカルを使い分けてよい。特に次のケースでは**サブローカルでの別ブランチ作業を必須**とする。
  - 本体ローカルが特定ブランチで作業中（未コミット変更を抱える等）で、**別ブランチでの作業を並行**する必要があるとき。
  - 一方のブランチをチェックアウトしたまま、別系統の検証・修正を同時に進めたいとき。
- 逆に、本体ローカルのブランチを切り替えれば足りる単一作業では、無理にサブローカルへ分散しない。

### 安全則（着手前・作業中）

- **着手前確認**: 対象ローカルで `git branch --show-current` / `git status` を確認し、想定ブランチか・未コミット変更が無いかを把握してから着手する。
- **二重編集の回避**: 同一ファイルを複数ローカルで同時編集しない。ブランチ／担当範囲を分けて衝突を避ける。
- **同期の明示**: サブローカルで作成したコミットは `push` → 他ローカルで `pull`（または対象ブランチへ merge）して取り込む。どのローカルで何をしたかを追える状態にする。
- **作業ログ**: どのローカル・どのブランチで何を行ったかを `_work_in_progress/` に記録する（複数ローカル横断時は特に明記）。
- **ブランチ運用方針の遵守**: 上記「ブランチ運用方針」（`develop` を source of truth、`addon-ai-tag` の一方向マージ等）はサブローカルでも同様に適用する。

### この指示の配布

- 本節は git 管理ファイル（`AGENTS.md` および生成物）へ記載することで、同一リポジトリを参照する全ローカル環境へ commit / pull 経由で共通配布される。個別ローカルへの手書き複製は行わない。

## `README.LOCAL.md`（ローカル環境ごとの作業メモ）

- リポジトリ直下の `README.LOCAL.md` は `.gitignore` 対象（Git 管轄外）の**ローカル専用メモファイル**。本体ローカル・サブローカルそれぞれのクローンごとに個別に存在し、commit / push / pull では他ローカルに共有されない。
- **用途**: そのローカル固有の情報（物理パス、現在チェックアウト中のブランチ・用途、作業中/一時中断中のタスク、次に自分（または別ローカル）が引き継ぐ際の注意点など）を、そのローカルを使う人・エージェント自身のための備忘録として記録する。
- **`_work_in_progress/` との使い分け**: 複数ローカル横断で共有すべき正式な進捗・決定事項は引き続き `_work_in_progress/`（Git 管理下）に記録する。`README.LOCAL.md` はそれを補う「そのローカルだけのメモ」であり、正式な進捗ログの代替にはしない。
- **ファイルが無い場合**: 存在しなければ最低限のテンプレート（ローカルパス等）を作成してよいが、パス以外の作業メモ内容は User が手動追記する前提とし、エージェントが創作内容や未確認の推測を書き込まない。
- **配布方法**: 本節は正典（本ファイル）に記載することで全ローカル・全エージェントへ commit / pull 経由で共通配布される。`README.LOCAL.md` 自体は各ローカルにコミット不要（`.gitignore` 済み）で運用する。
- **定時スケジュールによる自動議事録（承認済み運用）**: 毎日 4:00（JST）にスケジュールタスク `local-readme-minutes` が各ローカルの `README.LOCAL.md` へ「定時議事録」を追記する。判断根拠は各ローカルの git 事実（`git status` の未コミット変更 / `git reflog` のブランチ切替 / `git log` の直近コミット / 現在ブランチ）に限定し、**その回に実際に使用された（差分・新規コミット・ブランチ切替のある）ローカルだけ**を更新する。未使用ローカルはファイルを一切変更しない。更新対象は各ローカルの `README.LOCAL.md` のみで、他ファイルの編集・git 書き込み（commit/push/merge）は行わない。本項は上記「ファイルが無い場合」の User 手動追記原則に対する例外として自動追記を認めるものだが、記載は git 事実に基づく下書きである旨を明記し、創作内容・未確認の推測は書かない（最終確定は User が加筆修正する）。

### ローカル環境の作業分担（`## 作業分担` 節）

> 複数ローカルを並行運用する期間の「どの環境が何を担当するか」は、**各ローカルの `README.LOCAL.md` の `## 作業分担` 節を正**とする。すべてのエージェント（Claude Code / Claude Desktop・Cowork / GitHub Copilot / Codex ほか）は、そのローカルで作業を始める前に必ずこの節を読むこと。

- **読む義務（着手前）**: 対象ローカルで最初に作業する前に、前掲「安全則」の `git branch --show-current` / `git status` 確認に加えて、`README.LOCAL.md` 冒頭の `## 作業分担` と `### この環境の担当` を読む。担当外の作業を指示された場合は、着手前に「この環境は担当外である」旨を User に伝えて確認する（無断で着手しない）。
- **節の位置**: `# このローカル環境について` の直後、既存の作業メモ・`## 定時議事録` より**前**に置く。議事録の下に埋めない。
- **書式（全ローカル共通）**:
  1. 見出し `## 作業分担（YYYY-MM-DD 更新 / 運用の目的）`
  2. 現在の状況を 1〜2 行（どの環境が何の理由で塞がっているか等）
  3. **全環境の分担表**（`main` / `sub1` / `sub2` / `sub3` の 4 行。呼称は前掲「前提（環境構成）」に合わせる）
  4. 運用注記（暫定運用ならその解除条件、環境をまたぐ変更時の注意など）
  5. `### この環境の担当` … その環境の担当内容を箇条書き（他環境との引継ぎがある場合は相手環境名を明記）
- **同期ルール（重要）**: 分担表（上記 3.）は**全ローカルで同一内容**を保つ。環境ごとに差があってよいのは `### この環境の担当`（同 5.）だけ。`README.LOCAL.md` は `.gitignore` 対象で commit / pull による自動配布が効かないため、分担を変更したときは**4 環境すべての `README.LOCAL.md` を同じ更新日で書き換える**（1 つでも古いまま残さない）。
- **更新の主体**: 分担の新規作成・変更は **User の指示があったときのみ**行う。エージェントが分担を推測して書き換えたり、議事録の観測結果から担当を勝手に変更したりしない。
- **節が無い / 古い場合**: `## 作業分担` 節が無い、または更新日が明らかに古く実態と合わないときは「担当未定」と判断して User に確認する。空欄を創作で埋めない。
- **代行と引継ぎ**: ある環境が他環境の担当作業を一時的に代行した場合は、代行した側と引き継ぐ側の**双方**の `### この環境の担当` に引継ぎの旨を明記し、取り込みが完了したら両方から削除する。
- **自動議事録との関係**: スケジュールタスク `local-readme-minutes` は `## 定時議事録` のみへ追記し、`## 作業分担` 節は読み取り専用として書き換えない。
- **他ドキュメントとの役割分担**: `## 作業分担` は「方針」、`_work_in_progress/` は Git 管理下の「正式な進捗・決定事項」、`## 定時議事録` は「git 事実のログ」。役割が異なるので互いの代替にしない。

## 会話パターン情報追加時の運用制約（重要）

- **User 手動入力が主体**: 会話パターン情報（口調、話題傾向、会話頻度、補足など）の「値」は、エージェントの自動生成前提にせず User が手動入力・監修することを原則とします。
- **創作内容の自動生成を避ける**: 会話例、台詞本文、未公開設定、固有用語、ストーリー断片など作品内容そのものはエージェントが自動生成・補完しません。
- **実装対象は構造と運用補助を優先**: `db_type.json` / `db_meta.json` の整備、API/SW の欠損耐性、入力しやすいスキーマ設計、検証・テスト追加などの「構造面」を優先支援します。
- **prompt 生成は構造化補助に留める**: LLM 利用を補助する場合でも、新規の創作本文を生成する機能は避け、構造化 JSON 返却または固定テンプレート提供に留めます。
- **公開範囲とライセンスに配慮**: 会話パターン情報は創作設定の公開そのものになり得るため、CC BY-NC 4.0 と第三者利用ガイドラインに抵触しないよう扱い、最終公開判断は User が行います。

---

## アプリ概要

**JsonCharacterDB-Framework** は、GitHub Pages 上で動作する「JSON 形式のキャラクターDB」を誰でも構築できるようにした静的サイトフレームワークです。
創作キャラクターの設定を JSON で管理し、キャラシート UI・相関図 UI・疑似 API として公開できます。
本リポジトリは [radiann-kswg/100BeautiesLab_CreationsDB](https://github.com/radiann-kswg/100BeautiesLab_CreationsDB) の `develop` ブランチから、
特定の創作データを除いた汎用部分を切り出したものです。

### 主な機能

- **JSON 形式のデータベース**: 創作タイトル概要や各キャラクターの設定データを JSON テキストで収録
- **疑似 API 出力**: Service Worker と GitHub Pages による疑似 API
- **キャラシート機能**: API を活用したキャラシート生成機能
- **メタデータ**: 各フィールドの書式・型宣言をまとめたメタファイル

### 技術スタック

- **言語**: JavaScript (ES6+), JSON, HTML5, CSS3
- **フレームワーク / ビルド**: なし（Vanilla JavaScript / 静的ファイル配信）
- **スタイリング**: CSS3 + SASS（プリプロセッサ）
- **API アーキテクチャ（二層構成）**:
  - **実 API**: Cloudflare Workers (`<your-api-domain>/api/v1/`) + R2（JSON 静的ミラー）+ D1（FTS5 検索インデックス）→ `pkg/cloudflare/`
  - **疑似 API（ブラウザ専用）**: Service Worker (`/pages/v1/`, `/svc/v1/`) + 共通ライブラリ（`lib/sw-common.js`, `lib/data-common.js`）→ GitHub Pages 継続
- **ホスティング**: GitHub Pages（静的サイト）+ Cloudflare Workers（エッジ実 API）
- **生成・バッチ処理（計画中）**: Google Cloud（Cloud Run / GCE）→ ADR-0002
- **テスト**: Vitest（`npm test` / `npm run test:watch`、Node.js 18.0.0 以上）
- **パッケージ管理 / バージョン管理**: npm / Git

### 主要ディレクトリ

```
./
├── index.html             # GitHub Pages トップ（入口/導線）
├── AGENTS.md              # エージェント指示の正典（SSOT）
├── lib/                   # 共通ライブラリ
│   ├── sw-common.js       # Service Worker 共通機能
│   ├── data-common.js     # データ処理共通機能（EnrichmentProcessor 等）
│   ├── wrapper-common.js  # wrapper / 複合 summary の built-in handler
│   ├── section-wrapper-common.js  # standalone subField の built-in handler
│   ├── basic-renders/     # 呼称 DSL / 型解決の共通デコード
│   └── section-renders/   # セクション renderer（dblink.js, thisMasters.js 等）
├── data/                  # JSON データベース
│   ├── db_meta.json       # 全体メタ情報
│   ├── db_type.json       # 全体フィールド定義（スキーマのソース・オブ・トゥルース / $MetaType）
│   └── Works_*/           # 作品別データベース
│       ├── DataBases/     # 作品別 db_meta.json / db_type.json / db_*.json
│       ├── Dictionaries/  # 作品別辞書（dict_*.json）
│       ├── References/    # 資料系 DB（ref_*.json）
│       ├── RoleplayPrompts/  # 配布用ロールプレイプロンプト
│       └── Images/        # 作品別画像（DB_*/ Ref_*/ General/）
├── pages/                 # キャラシート生成機能（メイン）
│   ├── characters.html / .css / .sass / .js
│   ├── relations.html / .css / .sass / .js  # 相関図ページ
│   ├── vendor/            # 同梱外部ライブラリ（外部CDN非依存）
│   └── sw.js              # Service Worker
├── api/                   # API 機能（レガシー）
├── svc/                   # 参照解決用 Service Worker
├── tests/                 # Vitest テスト
├── tools/                 # 生成・整形ツール（CLI）
├── pkg/                   # サブモジュール向けパッケージ群（nodejs/python/csharp/cloudflare/mcp）
│   └── cloudflare/        # Cloudflare Workers 実 API（worker.js / wrangler.toml / schema/ / scripts/）
├── docs/                  # 技術仕様ドキュメント
└── _work_in_progress/     # 進捗レポート
```

---

## アーキテクチャ指針

### システム設計原則

1. **静的サイト設計**: GitHub Pages 上で動作する完全な静的サイト（アセット配信に専念）
2. **実 API（Cloudflare Workers）**: `<your-api-domain>/api/v1/` → R2（JSON ミラー）+ D1（FTS5）で外部クライアントから直接利用可能（**ADR-0001 実装・稼働済み。2026-06-21 初回デプロイ完了**）
3. **疑似 API（Service Worker）**: `/pages/v1/`, `/svc/v1/` はブラウザ専用の完全 enrich（`_DBLink`/`_Jump`）付き API として GitHub Pages で継続稼働
4. **共通ライブラリアーキテクチャ**: `lib/sw-common.js` / `lib/data-common.js` による機能統合
5. **データ駆動設計**: `db_type.json` に基づく型安全なデータ操作
6. **マルチエンドポイント**: `/api/v1`, `/pages/v1`, `/svc/v1` の 3 エンドポイント提供
7. **参照解決**: データベース間の関連性を動的に解決（SW 側で完全実施、Workers 側は段階実装）
8. **`pkg/` パッケージ群**: 別リポジトリへサブモジュール導入する独立クライアント群（非破壊・独立）
9. **生成・バッチ処理**: 重い処理（画像生成・GPU/バッチ）は Google Cloud に棲み分け（ADR-0002, 計画中）

### データフロー

**ブラウザ経由（完全 enrich）**:
UI → Service Worker (`/pages/v1/`) → 静的 JSON 読み込み + `_DBLink`/`_Jump` 解決 → キャッシュ → UI

**外部クライアント経由（軽量 API）**:
クライアント → Cloudflare Workers (`/api/v1/`) → R2（JSON）or D1（検索/インデックス）→ レスポンス

### 命名規則

- **作品識別子**: `Works_[作品名]`（例: `Works_Sample`）
- **データベースファイル**: `db_[種別].json`（例: `db_Primary.json`）
- **メタファイル**: `db_meta.json`（作品・DB 情報）, `db_type.json`（スキーマ定義）
- **API エンドポイント**: `/api/v1/*`, `/pages/v1/*`, `/svc/v1/*`、キャッシュ名 `100bl-api-v1`
- **画像**: `Images/DB_[種別]/[サブカテゴリ]/`、資料系は `Images/Ref_[種別]/`、共通は `Images/General/`。旧 `Images/Primary` のような裸 DB 名ディレクトリは新規運用しない

---

## 作品・キャラクター設定指針

### 作品シリーズ

本フレームワークは作品シリーズを固定しません。`data/db_meta.json` の `CreationWorks` に
`#Works_<英字ID>` を追加した分だけ作品が増えます。同梱の `#Works_Sample`（`data/Works_Sample/`）が
最小の実例なので、これを複製して自分の作品を定義してください。

### データベース種別

- **Primary**: 一次創作 / **Secondary**: 公認二次創作 / **SemiPrimary**: 公式アンソロジー（準一次） / **SelfSecondary**: 公式セルフ二次創作（構想上のみ） / **Proxy**: 代理 / **Mobs**: モブ

---

## UI 実装ガイド

### スタイリング原則

- CSS Grid を基本、CSS カスタムプロパティで色・サイズを統一管理、SASS で記述、モバイルファースト、BEM 命名。

### JavaScript 原則

- ES6+ モジュール（`import/export`）で機能分離、`async/await` での Promise ベース処理、ユーザーフレンドリーなエラー表示、検索・フィルタリングでのデバウンス。

### パフォーマンス最適化

- Service Worker キャッシュ（頻繁にアクセスするデータ）、画像とデータの遅延読み込み、クライアントサイドでの高速フィルタリング。

### スキーマ駆動 UI（重要）

- **表示項目の追従**: キャラシート（`pages/characters.js`）は `db_type.json($DefType)` を参照し、表示項目・順序・ラベルを可能な限りスキーマ駆動で生成します。
- **表示完結の原則**: 公開表示は typedef / meta で完結させ、schema 外のトップレベル項目を「その他の項目」として自動表示しません。
- **ラベルの優先順**: `hashTag_JP` / `hashtag_JP`（綴り揺れ吸収）を優先し、無ければフィールド名にフォールバック。新規・修正は `hashTag_JP` に寄せます（`hashtag_JP` は後方互換の読み取り対象）。
- **インデックス表示名**: 作品別 typedef（`data/Works_<作品名>/DataBases/db_type.json`）の `$IndexDef` を参照し、`hashTagName_JP/EN` を表示名として利用します。
- **複数 Index 要素の表示制御**: object 形式の `$IndexDef` は既定で「一覧/直リンクは主要要素」「詳細/値表示は全要素」とし、各子要素の `$display.index`（`list/detail/value/link/priority/order`）で上書きします。
- **basic 補助項目の扱い**: `BirthDay` のように typedef 上は基本情報だが作品別 `basicFields` へ必ずしも列挙されない項目は、既存の basic 補助行（例: `AnivDay`）と同系統で扱うことを許容します。
- **List 系 / 2言語 multiline**: `#ListIndex[]` / `#ListLink[]` は改行ベース表示を優先。`##String_JP` / `##String_EN` の名称系で和英いずれかに改行があれば JP/EN 列を分けて表示します。

### 直リンク（URL クエリ）

- **圧縮ロケータ（正）**: キャラ詳細の直リンクは `c=<作品>[/<DB>[/<インデックス>]]` の 1 パラメータにまとめます（例: `?c=Sample/Primary/CharaId:001`, `?c=Sample/Primary&q=alpha`）。作品IDは `Works_` 接頭辞なしの短縮形です。
- **インデックス表記**: `値` / `キーパス:値` / `キーパス:値,キーパス:値...`（キーパスは `<root>` / `<root>.<child>`。例: `Num`, `Card.Num`, `BeastType.Beast`）。キーパス省略時は `$IndexDef` の主要要素として解釈。
- **複合 Index（object 形式 `$IndexDef`）**: カテゴリキー（`#IndexListKey`。`Card.Suit` / `Letter.Alphabet` 等）を常に載せ、一意にならない場合だけ他のサブフィールドをカンマ区切りで追加します（例: `?c=FLInvestigator78/Primary/Suit:Major,SuitNum:16`）。数値サブフィールド単独の直リンクは「どの分類の N 番か」を示せず別レコードと衝突するため生成しません。複合トークンは `idx`（JSON 条件）+ `idxKey=__conditions__` へ正規化され、既存の subset match 経路で解決されます。
- **複合 Index の root 省略**: 複合条件では主 Index の root（`Card` / `Letter`）を落とします（`$IndexDef` は 1 レコード 1 オブジェクト前提で root に識別情報が無いため）。単一キーは従来どおり root 付き（`Card.Num:7`）。root を落とすのは `getIndexIdentifierFromRecord()` 側だけで、`_DBLink` 由来のペイロード（サブ Index を指す可能性がある）は root 付きのまま出力します。
- **root 省略キーの解決順**: 解決側は「完全一致 → 主 Index の root 配下 → サブ Index（エイリアス）の root 配下」の順に照合します（`getIndexRootCandidates()`）。単一キー・複合の双方に効き、サブ Index（`LogicAlt` 等）も主 Index と同じく root 抜きで参照できます。同名サブキーが複数 Index にある場合は主 Index が優先され、値まで重複するなら一意にならない（＝生成側は一意性を検証してからその形を出す）。
- **空値を出さない**: `q` / `lang` は値があるときだけ付与し、空パラメータは URL に残しません。
- **後方互換**: 旧パラメータ（`work` / `db` / `idx` / `idxKey` / `num` の個別キー、`Works_` 接頭辞付き作品ID）と、カテゴリキーを含まない旧 URL（例: `Card.SuitNum:16`）は **読み取りのみ**互換維持。生成側は常に `c` 形式で出力し、旧形式で開かれた URL は表示時に新形式へ書き換わります。
- **例外**: 値そのものにカンマを含む等、圧縮ロケータへ往復できない複合条件のみ、従来の個別キー形式で出力します。
- **実装の集約先**: URL 文法の実装は **`lib/viewer-locator.js`** の `buildViewerQueryString()` / `parseViewerLocator()` / `parseIdxToken()` に集約します（キャラシートと相関図の双方が import する DOM 非依存の純関数群）。各所で `new URLSearchParams({...})` を組み立て直さないでください。`location` / `history` に依存する現在クエリの読み書き（`getQS()` / `setQS()` / `buildViewerHref()`）だけを各ページ側に置きます。
- **運用方針**: 直リンク挙動の変更は、原則コード変更ではなく作品別 typedef の `$IndexDef` を更新して追従させます。

---

## API 通信とデータ管理

### Cloudflare Workers 実 API (`pkg/cloudflare/`)

- **エンドポイント**: `<your-api-domain>/api/v1/`
- **データソース**: R2 (`creationsdb-data`) で JSON 静的ミラー、D1 (`creationsdb-d1`) で FTS5 検索インデックス
- **初回セットアップ**: `schema/d1-init.sql` を D1 に適用 → `scripts/migrate.mjs` でデータ投入 → `wrangler deploy`
- **データ更新**: `data/` を変更したら `scripts/migrate.mjs` を再実行して R2/D1 を同期
- **現在の対応範囲**: `_Commons` 適用・`isPrivate` 除外・FTS5 検索。`_DBLink`/`_Jump` 解決は次フェーズ。
- **`Works_Hidden` / `DB_Hidden`**: D1 クエリレベルで判定して 404 を返す

### Service Worker 疑似 API（ブラウザ専用）

- **マルチプレフィックス**: `/api/v1/`, `/pages/v1/`, `/svc/v1/`（`/api/v1` は将来的に Workers へ完全移行予定）
- **参照解決機能**: データベース間の関連データ自動取得
- **キャッシュ戦略**: 頻繁にアクセスするメタデータの効率的キャッシュ
- **エラー処理**: 404/400 エラーの適切なハンドリング
- **作品別メタの欠損耐性**: `data/Works_<work>/DataBases/db_meta.json` 欠損時でも DB 取得/検索/enrich は 500 で落とさず、`_Commons` 等の付加処理をスキップして継続します（メタは追加価値）。
- **辞書の合成**: enum/list 辞書は `db_meta.json` と `db_type.json($VarsDef)` の両方を合成して扱います。
- **typedef 駆動**: enrich/search は `db_type.json($DefType)` を参照して補助（表示分類・正規化・画像ヒント・検索対象テキスト）。優先順位は 表示分類 → 正規化 → 画像 → 検索。
- **画像ディレクトリ規約**: 画像解決は catalog key に対応する `Images/DB_*` / `Images/Ref_*` を正とします。資料系 DB 画像は DB 名ごとのハードコードを増やさず、shared / work-local の `References/db_type.json($DefType)` を合流し `Images.*` 配下の field 名から folder hint を導出します。
- **enrich のメタ情報**: enrich 応答に `_enrichment`（例: `displaySections`）を含め、UI がセクション分け・表示制御に利用できるようにします。
- **仕様メモの同期**: ルーティング、`_enrichment`、`varsdef`/`typedef`/`deftype` の責務、欠損耐性を変更したら `docs/api-sw-spec.md` も同時更新します。

### `_Commons` / `_Secondaries`（運用の要点）

- 作品別メタの `Databases.#DB_<DbName>._Commons` で共通フィールドの穴埋めを定義できます。
- 二次創作等では `Databases.#DB_<DbName>._Secondaries[]` により、レコードの `sec_**`（例: `sec_SeriesTitle`, `sec_Category`）で適用する `_Commons` を分岐できます。
- `sec_**` が全て `null`/空の定義はデフォルト fallback、`null` 以外の条件を持つ定義が一致したらそちらを優先します。
- 誤適用防止: `sec_SeriesTitle` 指定の定義は「シリーズを主キー」とし追加 `sec_**` 条件はレコード側に値がある場合のみ一致チェック。`sec_SeriesTitle` 未指定で `sec_Category` 等を持つ定義は必須一致として扱います。

### 参照マージ（`_DBLink` / `_Jump`）運用ルール（重要）

- **基本方針**: `pages/*` 経由の enrich 出力で `_DBLink` を解決し、参照先 DB の値を出力に直接マージします（`lib/data-common.js` の `EnrichmentProcessor.enrichRecords()`）。
- **UI 露出の抑制**: `_DBLink` / `_DBLinkResolved` は内部補助情報として扱い、公開表示には原則含めません。
- **同名フィールド穴埋め**: ベース側が空値（`undefined/null/''/[]` 等）の場合のみ埋め、既存値は上書きしません。
- **`hideText` の尊重**: `{ hideText: '...' }` は意図的マスクとして扱い、参照先値で上書きしません。
- **曖昧一致の扱い**: `_Search` による参照先特定は **1件一致のみ採用**し、曖昧・複数一致はスキップします。
- **別作品からの持ち込み制限**: cross-work の `_DBLink` では、対象作品の schema に未宣言なトップレベル項目を持ち込みません。
- **画像の扱い**: 画像系フィールドは **別DB（別JSON）から参照・穴埋めしません**。同一DB参照の場合のみ画像穴埋めを許可します。
- **`isPrivate: true` への参照**: `*_DBLink` 参照はクライアント側でフィルタし非表示にします（セクション全体も非表示）。
- **複数 `_DBLink`**: 配列の場合の合成仕様は未確定のため、現状は先頭要素のみ参照対象とします。
- **`_Jump`**: `{ _Jump: { hashTag, _Search } }` は参照先レコードの `hashTag`（ドットパス可）から値を取り出し置換。`_Search` の絞り込みも 1件一致のみ置換します。`hashTag` は「完全一致 → 言語別名（`TypeDefUtils.expandLangAliasCandidates()`）」の順で探すため、`_JP` / `_EN` に分離したフィールドを suffix 無しで指せます（優先言語は参照元フィールドの suffix）。入れ子フィールドは**明示ドットパス**で指定します（例: `NumerospecStats.NumerospecAbout`）。レコード全体を名前で走査することはしません。参照先は「自前の `_DBLink` → ルート `_DBLink` → `$enrich: true` の `*_DBLink`」の順に決まるため、`AnotherRegions_DBLink` 等で参照先を書いてあるレコードは `_Jump` 側へ `_DBLink` を重複して書く必要がありません（複数エントリは先頭の解決済みエントリに従う）。
- **`hideText` は言語非依存**: マスク値は `#List_hideText` の辞書コードで、`formatMaskedValue()` が言語に応じて解決します。したがって `_JP` / `_EN` の**片方にだけ**書けば両言語で表示されます（EN 表示時は `_EN` 側の `hashTag_EN` をラベルに使う）。既存の両方書きも有効なので移行は不要です。

### データベース構造 / 画像管理

- **JSON Schema**: `db_type.json` による型定義。階層は 作品 → DB 種別 → キャラクターデータの 3 層。メタは作品情報・DB 情報・フィールド定義を分離管理。
- **画像**: `db_type.json` の `$image` に基づくパス解決、キャラクターデータからの動的ギャラリー生成、GitHub Pages サブパス対応のパス正規化。

---

## `pkg/` パッケージ群の開発ルール

- **非破壊・独立**: `pkg/` は `lib/sw-common.js` / `pages/` / `api/` / `svc/` に依存しません（Service Worker グローバル前提の API に依存させない）。
- **ファイルシステム I/O**: Node.js `fs` / Python `pathlib` / C# `System.IO` でデータを読みます。
- **セキュリティトークン**: すべての workId / dbName はエントリーポイントで `isSafeToken()` / `_is_safe_token()` による `[A-Za-z0-9_]+` 検証を行います。**変更・削除は禁止**。
- **リポジトリルート自動解決**: 各クライアントは引数省略時、自パッケージ位置を起点にルートを自動解決します。

| パッケージ | 解決方法 |
| ---------- | -------- |
| **Node.js** (`pkg/nodejs/index.mjs`) | `resolve(dirname(fileURLToPath(import.meta.url)), '../..')` — 2 階層上 |
| **Python** (`pkg/python/creationsdb/client.py`) | `Path(__file__).resolve().parent.parent.parent.parent` — 4 階層上 |
| **C#** (`pkg/csharp/CharacterDBClient.cs`) | `FindRepoRoot()` — アセンブリ位置からフォルダを上方探索し `data/db_meta.json` の存在で判定 |
| **MCP** (`pkg/mcp/server.mjs`) | コマンドライン引数 → 環境変数 → `server.mjs` の 2 階層上、の順 |
| **Cloudflare Workers** | ファイルシステム不使用（URL から fetch） |

- **`lib/` 変更と連動させない**: `pkg/nodejs/index.mjs` は `lib/sw-common.js` の移植版。`lib/` 変更が影響する場合は手動同期し、各 `pkg/*/README.md` の使用例も更新します。詳細は `docs/pkg-client-libraries.md`。

---

## テスト戦略

- **フレームワーク**: Vitest。`npm test`（全実行）/ `npm run test:watch`。Node.js 18.0.0 以上。
- **Windows/PowerShell 補足**: 実行ポリシーで `npm.ps1` がブロックされる環境では `npm.cmd test` または `.\node_modules\.bin\vitest.cmd run` を使用します。

### 主なテスト

- `tests/data.sanity.test.js` — JSON 構文・ファイル存在
- `tests/data.shape.test.js` — 構造・型整合
- `tests/data.field-order.test.js` — レコードのキー順が `$DefType` 正準順であること
- `tests/sw.enrich.basic.test.js` — 参照解決・エンドポイント・キャッシュ
- `tests/enrich.dblink.jump.merge.test.js` — `_DBLink`/`_Jump` マージ回帰（穴埋め・置換・別DBから画像を埋めない等）
- `tests/agent-instructions.sync.test.js` — 本ファイルから生成される指示書・スキルにズレが無いこと

### テスト作成指針

- **網羅的テスト**: データの追加・変更時は対応テストも更新。エラーケース・欠損ファイル・大量データの処理時間も検証対象に含めます。
- **データ更新時のテスト追従**: `data/**`（JSON データベース）を変更したら、該当箇所に対応する `tests/` を実行し、テスト回路が動作するか併せて確認します。DB 更新によってテストが落ちるようになった場合は、原則としてテスト側を新しいデータ仕様へ追従させる形でテスト回路を修正し、同じ変更内に含めます。ただし、テストではなく実装・描画ロジック側の追従漏れ（= 実バグ）が原因で落ちている場合は、テスト期待値の書き換えで隠さず、実装側の課題として扱い記録します。

---

## ビルドとデプロイ

- **配信**: GitHub Pages 自動デプロイ（main へ push）。全ファイルを静的リソースとして配信、Service Worker がブラウザ側で API ルーティング。
- **ローカル開発**: 任意の HTTP サーバー（例: `python -m http.server`, Live Server）。直接編集後リロードで確認。
- **注意**: 相対パス前提、Service Worker 内 CORS 設定、キャッシュ（`CACHE_NAME`）のバージョン管理。

---


## コーディング規約・ベストプラクティス

- **JavaScript**: ES6+ 構文、機能ごとのモジュール分割、`async/await` 優先（Promise チェーンは最小限）、`try-catch` でユーザーフレンドリーなエラー表示、設定値は定数化。
- **Service Worker**: 重要リソースの効率的キャッシュ、`CACHE_NAME` による明確なバージョン管理、404/400 の適切な JSON レスポンス、不要なネットワークリクエスト回避。
- **CSS/SASS**:
  - スタイルシートの編集は必ず **SASS ファイル（`.sass`）** で行う。CSS への変換は VS Code 拡張が自動実行するため手動変換不要。
  - `pages/characters.html` の `<meta name="asset-version">` は `characters.css` と `characters.js` の共通バージョン。`pages/characters.sass/.css/.js` の更新でキャッシュ影響が出る可能性がある場合はこの値も更新。
  - レスポンシブ（モバイルファースト）、BEM 命名、CSS Grid/Flexbox、カスタムプロパティで設定値統一。
- **JSON データ**: `db_type.json` 構造の厳守、Unicode 適切処理、必須フィールド確実記載、参照整合性。新規ラベルは `hashTag_JP`（`hashtag_JP` は段階的解消、読み取りは当面両許容）。
- **非同期処理**: `fetch` API での Service Worker とのやり取り、ネットワーク・データエラーの適切な処理、ローディング状態の明確な伝達。
- **ファイル・ディレクトリ管理**: 命名統一、画像最適化（適切なファイルサイズ・形式）、相対/絶対パスの適切な使い分け。
- **コメント**: 関数・クラス・重要変数に日本語 JSDoc。複雑な処理にインライン説明。将来改善点は `// TODO:`。**注釈は WHY が非自明なもののみ**、自明な処理への過度な説明は避ける。

---

## 日本語注釈・コメント標準化ガイド

### 注釈作成の基本方針

本プロジェクトでは、コードの可読性・保守性向上のため、スクリプトファイルに日本語での注釈を追加します。

#### 対象ファイル

- **JavaScript ファイル**: `.js` 拡張子のスクリプトファイル（Service Worker、メインアプリケーション等）
- **HTML ファイル**: `.html` ページファイル（構造的なコメント）
- **CSS/SASS ファイル**: `.css`, `.sass` スタイルシートファイル（デザインシステム説明）
- **除外対象**: JSON データベースファイル（データ操作は除外）

### JavaScript ファイルの注釈規則

#### 1. ファイルヘッダー注釈

```javascript
/**
 * [ファイル名] - [機能概要の日本語説明]
 *
 * @description [詳細な機能説明]
 * @author <your-name>
 * @version [バージョン情報]
 * @dependencies [依存関係]
 */
```

#### 2. 関数・メソッド注釈

```javascript
/**
 * [機能の日本語説明]
 *
 * @description [詳細な動作説明]
 * @param {型} パラメータ名 - パラメータの日本語説明
 * @returns {型} 戻り値の日本語説明
 * @throws {Error} エラー条件の日本語説明
 * @example
 * // 使用例のコード
 */
function 関数名(パラメータ) {
  // 処理ステップの日本語説明
}
```

#### 3. 変数・定数注釈

```javascript
// [変数の役割・用途の日本語説明]
const CONSTANT_NAME = "value";

// [複雑な処理の場合、ブロック説明]
let complexVariable = processData();
```

#### 4. Service Worker 特有の注釈

```javascript
// Service Worker のライフサイクル説明
self.addEventListener("install", (event) => {
  // インストール時の処理内容説明
});

// API ルーティング処理の説明
self.addEventListener("fetch", (event) => {
  // リクエスト処理のロジック説明
});
```

### HTML ファイルの注釈規則

```html
<!-- ========================================
     [セクション名] - [機能説明]
     ======================================== -->
<section class="section-name">
  <!-- [具体的な要素の役割説明] -->
  <div class="element">内容</div>
</section>
```

### CSS/SASS ファイルの注釈規則

```scss
/* ========================================
   [セクション名] - [デザイン要素の説明]
   ======================================== */

// [カスタムプロパティの用途説明]
:root {
  --primary-color: #color; /* [色の用途・意味説明] */
}

// [ブレークポイントの説明・対象デバイス]
@media (min-width: 768px) {
  // [レスポンシブ対応の内容説明]
}
```

### 注釈品質基準

#### 必須要素

1. **機能目的**: そのコードが何をするためのものか
2. **動作説明**: どのように動作するか
3. **関連性**: 他の機能やファイルとの関係
4. **注意事項**: 特別な考慮事項や制約

#### JSDoc 準拠

- **@description**: 詳細な説明 / **@param**: パラメータの型と説明 / **@returns**: 戻り値の型と説明 / **@throws**: 例外の条件と説明 / **@example**: 使用例の提示

#### 可読性配慮

- **簡潔性**: 必要十分な情報を簡潔に
- **階層性**: インデントや記号による視覚的な整理
- **一貫性**: プロジェクト全体での統一したスタイル

### 注釈メンテナンス指針

- **更新タイミング**: 機能追加時（必ず対応する注釈を追加）/ 機能変更時（既存注釈を変更内容に合わせて更新）/ リファクタリング時（コード構造変更に伴う見直し）/ 定期レビュー。
- **品質管理**: 一貫性確保・最新性保証（コード変更と注釈更新の同期）・完全性確認・正確性検証（注釈内容とコード動作の一致）。

---

## アンチパターン（発見時はリファクタリングを提案）

- **Service Worker**: 重複登録の競合、古いキャッシュ残存、過度なキャッシュ、エラー未処理。
- **JSON データ**: スキーマ違反、存在しないデータへの参照、文字化け、必須フィールド欠損。
- **JavaScript**: グローバル汚染、同期ブロッキング、イベントリスナー削除漏れ（メモリリーク）、`catch` でのエラー隠蔽。
- **CSS/レイアウト**: 固定幅設計、インライン CSS 濫用、`!important` 濫用、`float`/`table` レイアウト。
- **パフォーマンス**: 過度な DOM 操作、画像最適化不足、キャッシュ済みデータの再取得、デバウンス不足。
- **データベース**: 作品間の整合性不足、画像パス不整合、型不一致（数値フィールドへの文字列格納）。
- **日本語注釈**: 注釈不足、英語注釈混在、古い注釈、過度な注釈、JSDoc 非準拠、注釈とコードの不一致、HTML/CSS の構造的注釈欠如。

---

## セキュリティとプライバシー

- **HTTPS 通信**: GitHub Pages による自動 HTTPS 化。
- **XSS 対策**: ユーザー入力を `innerHTML` に流さない（`textContent` + DOM 構築を優先）。検索フィールド等は必ずサニタイズ/エスケープ前提。
- **入力検証**: `works` / `db` などパス組み立てに関わる値は英数字 + `_` 等の安全トークンのみ許可し、不正入力は 400/404 で明示的に返す。
- **CORS / オリジン**: 適切な CORS ヘッダー、機密データのキャッシュ回避、同一オリジンからのリクエストのみ処理。
- **CSP**: 適切な Content Security Policy の実装検討。
- **情報漏洩防止**: 機密情報・実在人物情報を JSON / キャラクター設定に記載しない。使用画像の権利確認・クレジット表記を明記。

## アクセシビリティ (a11y)

- WCAG 2.1 AA を目安に、適切な ARIA、キーボード操作（Tab/Enter/Escape）、十分なコントラスト、セマンティック HTML、全画像への `alt`、明確なフォーカス表示・エラーメッセージ。画像ギャラリーには説明文を付与。

---

## ドキュメント更新に関する重要な注意

### ガイドラインファイル（編集禁止）

**⚠️ `LICENSE` および各リポジトリが定める作品利用ガイドラインの本文は、エージェントが編集してはいけません。** ライセンス情報・利用規約・違反定義・二次創作 OK/NG リスト等を含み、法的・権利的に重要なためです。`README.md` には導線リンクだけを置き、本文を重複させないでください。

### 更新が許可される部分

- `README.md` の `# 当リポジトリについて(日本語版)` 以降 / `# About This Repository (English Version)` 以降のテクニカルセクション
- API 仕様、技術スタック、アーキテクチャ、使用方法などの技術文書

---

## 大規模更新時の確認事項

`data/` の大量更新、SW ルーティング改修、`lib/` の共通処理変更、複数ページ横断修正などを行った場合、実装後に最低限以下を確認します。

- **自動テスト**: `npm test`（Vitest）が成功していること
- **データ更新時**: `db_meta.json` / `db_type.json` の整合と参照解決が破綻しないこと
- **Service Worker 更新時**: キャッシュ名・バージョン管理、`/api/v1`・`/pages/v1`・`/svc/v1` の基本ルーティングが想定通りであること
- **Workers / R2 / D1 更新時**: `scripts/migrate.mjs` 再実行 → `wrangler deploy` → `<your-api-domain>/api/v1/works` で疎通確認
- **UI 更新時**: ローカル HTTP サーバー上で主要ページ（例: `pages/characters.html`）の基本動作（取得・表示・検索）が成立すること
- **指示書更新時**: 本ファイルを編集したら `npm run agents:build` で生成物を更新すること
- **変更履歴**: 重要な仕様変更は `CHANGELOG.md` へ追記
- **作業ログ**: 公開可能な範囲で確認結果（成功/未実施/課題）を `./_work_in_progress/` に記録

---

## 主要ドキュメント参照先

| 対象                                   | 参照先                                                                |
| -------------------------------------- | --------------------------------------------------------------------- |
| API/SW 仕様（SW + Cloudflare Workers） | `docs/api-sw-spec.md`                                                 |
| schema/meta 詳解                       | `docs/schema-meta-processing.md`                                      |
| wrapper/section renderer               | `docs/wrapper-summary-registry.md`                                    |
| 横断運用ルール                         | `docs/implementation-playbook.md`                                     |
| pkg/ クライアントライブラリ            | `docs/pkg-client-libraries.md`                                        |
| 英訳(_EN)補助・用語集早見表             | `docs/localization-en-rules.md` / `docs/localization-glossary-quickref.md` / `docs/deepl-localization.md` |
| ロールプレイプロンプト生成             | `docs/roleplay-prompt-generation.md`                                  |
| Cloudflare Workers セットアップ        | `pkg/cloudflare/README.md`                                            |
| Google Cloud 設計（ADR-0002）          | `_work_in_progress/2026-06-21_progress_cloudflare-api-adr2-gcloud.md` |

---

## 禁止事項（まとめ）

- `LICENSE` および作品利用ガイドラインの本文を編集しない（User 手動管理）
- 会話パターン情報・創作内容（台詞・未公開設定・固有用語等）を自動生成しない
- `pkg/` の `isSafeToken()` / `_is_safe_token()` による入力検証を削除・変更しない
- `data/` 等の管理対象ディレクトリへ一時ファイルを直接書き出さない（一時ファイルは `./.cache/`）
- 旧画像ディレクトリ（裸の DB 名、例: `Images/Primary`）の新規運用
- **生成物（`.github/copilot-instructions.md` / `.claude/skills/`）を直接編集しない**（本ファイルを編集して `npm run agents:build`）

---

