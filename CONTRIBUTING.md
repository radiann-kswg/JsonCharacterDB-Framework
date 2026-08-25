# Contributing Guide（貢献ガイド）

このリポジトリ（JsonCharacterDB-Framework）へ貢献するためのガイドです。
最優先の目的は「迷わせないこと」です（Issue / PR / データ更新の入口をここに集約します）。

> 注意：フレームワーク本体のライセンスは `LICENSE`（CC BY-NC 4.0）が正です。
> `data/` に置く創作データのライセンスは各リポジトリの運用者が別途定めてください（フレームワークのライセンスは及びません）。
> 本ドキュメントは、コード/データ/ドキュメントの変更手順と開発ルールを扱います。

## できること（貢献の例）

- データ（`data/**`）の追加・修正（キャラクター、メタ、型定義）
- キャラシートUI（`pages/**`）の改善
- 疑似API（Service Worker）や共通ライブラリ（`api/`, `pages/`, `svc/`, `lib/**`）の改善
- テスト（`tests/**`）の追加・更新
- ドキュメント（`*.md`）の整備

## まず最初に（相談/報告）

- バグ報告・改善提案は GitHub Issues へ
- 仕様変更やデータ構造に関わる相談は、Issue で背景と目的を共有してから PR に進めるのがおすすめです

### Issue に書いてほしいこと

- 何が起きているか（期待結果 / 実結果）
- 再現手順（URL、`work` / `db`、直リンクパラメータなど）
- 環境（本番 or ローカル、ブラウザ、OS）
- 可能ならスクリーンショットやコンソールログ

## 開発環境のセットアップ

### 前提

- Node.js >= 18（テスト実行用）
- 任意の HTTP サーバ（Service Worker が必要なため、`file://` 直開きは不可）

### セットアップ

```powershell
npm install
```

### ローカル起動（例）

- VS Code の Live Server 等で `pages/characters.html` を開く
- もしくは任意の HTTP サーバでリポジトリルートを配信する

例（Python を使う場合）:

```powershell
python -m http.server 5500
# -> http://127.0.0.1:5500/pages/characters.html
```

## テスト

```powershell
# 通常
npm test

# PowerShell の実行ポリシーにより npm.ps1 がブロックされる環境では npm.cmd を使います
npm.cmd test
# or
npm run test:watch
npm.cmd run test:watch
```

主に以下をカバーします。

- `data/` 配下 JSON の構文・存在チェック
- `db_type.json` / `db_meta.json` とデータの整合
- Service Worker の基本エンドポイント/エンリッチの回帰

## リポジトリ構成（要点）

- `data/` : DB 本体（作品ごとの JSON、グローバルの meta/type）
- `pages/` : キャラシートUI（`pages/characters.html`）
- `api/` : 疑似 API（Service Worker、テストページ）
- `svc/` : API ミラー（主にブロッカー回避用途）
- `lib/` : SW/データ処理の共通ライブラリ
- `tests/` : Vitest

## データ更新ガイド（重要）

このリポジトリは「スキーマ駆動」を基本方針としています。
新しいフィールドを追加する場合、原則として **データ（db\_\*.json）と型定義（db_type.json）をセットで更新**してください。

詳細な更新手順・ルール（`db_type.json` / `db_meta.json` の更新目安、enum/list辞書、影響範囲、テスト観点）は以下に集約します。

- `docs/db-update-guidelines.md`

### どのファイルを触る？（最小チェック）

- 作品データ: `data/Works_<作品名>/DataBases/db_<種別>.json`
- 作品の型定義: `data/Works_<作品名>/DataBases/db_type.json`
- 作品のメタ: `data/Works_<作品名>/DataBases/db_meta.json`（必要な場合）

### `db_type.json` 更新の目安

- フィールド追加・構造変更をしたら `$DefType` に宣言を追加
- 表示や分類の意図がある場合は `"$display"` を付与（例：`section` / `unit` / `enumFormat` / `auto:false`）
- ラベルは `hashTag_JP` / `hashtag_JP`（綴り揺れ吸収）を利用（無い場合はフィールド名フォールバック）

### `db_meta.json` 更新の目安

- 作品のインデックス表示や直リンク挙動を変えるときは、まず作品別 typedef（`data/Works_<作品名>/DataBases/db_type.json`）の `$IndexDef` を更新して追従させます
- 詳細表示の抑制や並び替えは `CreationWorks.<work>.$DetailLayout` のメタで制御します

### 画像の追加

- 作品ごとの `data/Works_<作品名>/Images/**` 配下へ追加します
- 画像の解釈は `db_type.json` の `$image` 定義や `$display` ヒントを参照します
- 別DB（別JSON）から画像を穴埋めしない等、参照マージにはルールがあります（詳細は `.github/copilot-instructions.md` の「参照マージ」節）

## コーディング規約（要点）

- JavaScript は ES Modules（`import/export`）を前提
- 複雑な処理は `lib/**` に寄せ、テスト可能な関数として切り出す
- コメントは日本語、関数/クラスには JSDoc 形式を推奨（プロジェクト方針）

### CSS/SASS

- スタイル修正は `*.sass` を編集し、`*.css` は生成物として扱います

## 開発フロー（ブランチ/コミット/PR）

### ブランチ命名（例）

- `feature/<topic>` : 機能追加
- `fix/<topic>` : バグ修正
- `data/<topic>` : データ更新
- `docs/<topic>` : ドキュメント更新
- `refactor/<topic>` : リファクタ

### コミットメッセージ（例）

- 短く要約（日本語/英語どちらでも可、プロジェクト内で一貫すること）
- 例: `docs: add contributing guide` / `fix: handle object wrappers in display`

### PR のチェックリスト

- 変更理由が説明されている（What/Why）
- `npm test` が通っている
- データ更新の場合：`db_meta.json` / `db_type.json` の整合が取れている
- 重要な仕様変更の場合：`CHANGELOG.md` を更新している
- 大規模更新の場合：`_work_in_progress/` に進捗ログを残している（公開可能な範囲で）

## ドキュメントの扱い

- 入口（ルール/手順）は `CONTRIBUTING.md`
- 詳細仕様や長い検討ログは `_work_in_progress/` に残す（必要に応じて README / pages/README に要点を反映）

## 第三者利用（運用規約）

第三者によるデータ/API 利用（商用利用の扱い、AI 学習、再配布の方針）については、以下に集約します。

- `docs/third-party-policy.md`

## セキュリティ

- 機密情報を JSON やログに含めないでください
- 脆弱性の疑いがある場合は公開 Issue を避け、メンテナへ連絡してください
