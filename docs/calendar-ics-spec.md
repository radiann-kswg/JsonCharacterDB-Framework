# カレンダー(.ics)生成・Google カレンダー購読 仕様

創作キャラクターの**誕生日(`BirthDay`)・記念日(`AnivDay`)**を iCalendar(.ics)として自動生成し、
GitHub Pages で配信して Google カレンダー等から**購読(subscribe)**できるようにする仕組みです。

- 生成スクリプト: `tools/build-calendar-ics.mjs`
- 生成コマンド: `npm run calendar:build`
- 既定の出力先: `calendar/100beautieslab-creations.ics`(リポジトリ管轄外・ビルド成果物)
- 配信 URL: `https://database.numbertales-radiann.net/calendar/100beautieslab-creations.ics`

---

## 1. データソースと抽出ルール

各レコードの以下フィールドから終日イベントを生成します(年情報は持たないため**毎年繰り返し**)。

| フィールド | 形 | 生成イベント |
| --- | --- | --- |
| `BirthDay` | 単一 `{ Day: { Month, DayOfMonth } }` | 🎂 誕生日(1件) |
| `AnivDay` | 配列 `[{ Day: { Month, DayOfMonth }, DayAbout_JP, DayAbout_EN }]` | 🎉 記念日(要素ごと) |

### 除外ルール(公開ガイドライン準拠)

- `isPrivate: true` のレコードは除外。
- グローバル `data/db_meta.json` の `CreationWorks.#Works_*.Works_Hidden = true` の作品は除外。
- 作品別 `db_meta.json` の `Databases` 配下(**ネスト含む**)の `#DB_*` に付く
  `DB_Hidden`/`Works_Hidden = true` の DB は除外。
- `{ hideText: ... }` のマスク値、`Day` 欠損、`Month`/`DayOfMonth` 非数値・範囲外はスキップ。

---

## 2. 出力フォーマット

- **終日 + 毎年繰り返し**: `DTSTART;VALUE=DATE` + `DTEND;VALUE=DATE`(翌日) + `RRULE:FREQ=YEARLY`。
  基準年はうるう年の `2024`(2/29 を保持できるため)。
- **2/29 の扱い**: `RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1`(毎年2月末日)とし、
  **平年は 2/28・うるう年は 2/29** に表示される(一般的な「平年は 2/28 扱い」に準拠)。
- **作品色(`COLOR`)**: 作品ごとの色をグローバル `data/db_meta.json` の
  `CreationWorks.#Works_*.CalendarColorId`(Google イベント色 `"1"`〜`"11"`)で宣言し、
  ICS では RFC 7986 `COLOR`(CSS 色名)として出力する(対応クライアントのみ着色・非対応側は無視)。
  未指定の作品には既定パレットを表示順で自動割り当て。
  schema 宣言は `data/db_type.json($MetaType.$Def_CreationWorkCatalog)`。
- **タイトル**: `🎂 {名前}（誕生日）` / `🎉 {名前}（{記念日の説明}）`。名前は `Name_JP` 系を優先解決。
- **説明欄(`DESCRIPTION`)**: **和文で統一**。「作品 / DB / 英名 / 記念日(`DayAbout_JP`) / 出典」を
  この順で併記する(`lib` 非依存の共通関数 `buildEventDescription()`。Google 同期側と共用)。
- **`UID`**: `作品 | DB | 索引 | 種別 | 識別子` の SHA-1。レコードを一意・安定に識別するため、
  再生成時も同じイベントは同じ UID となり、購読側で**冪等に更新**される。
- **決定的出力**: イベントを月日順にソートし `DTSTAMP` を固定値にしているため、
  入力(data)が同じなら出力は同一バイト列。差分が出るのは実データが変わったときだけ。
- RFC 5545 準拠: テキストエスケープ、行は UTF-8 75 オクテットで折返し、改行は CRLF。

---

## 3. 自動更新フロー(リポジトリ更新への追従)

```
data/ を更新して develop へ push
        │
        ▼
GitHub Actions: jekyll-gh-pages.yml
  1) Node セットアップ
  2) node tools/build-calendar-ics.mjs  ← .ics を生成(コミットバック不要)
  3) Jekyll ビルド(_site に .ics を同梱)
  4) GitHub Pages へデプロイ
        │
        ▼
配信 URL の .ics が最新化
        │
        ▼
Google カレンダーが購読 URL を定期ポーリングして反映
```

> .ics はコミットせず、ビルド時に毎回生成します(`.gitignore` で `/calendar/*.ics` を除外)。

---

## 4. Google カレンダーでの購読手順(初回 1 回のみ)

1. PC ブラウザで Google カレンダーを開く。
2. 左側「他のカレンダー」の **＋** → **URL で追加**。
3. 次の URL を貼り付けて「カレンダーを追加」:
   `https://database.numbertales-radiann.net/calendar/100beautieslab-creations.ics`
4. 読み取り専用の購読カレンダーとして追加され、以後は自動で同期される。

### 注意

- Google 側の購読カレンダーは**再読込の間隔を選べない**(数時間〜最大 1 日程度)。即時反映ではない。
- 購読カレンダーは**読み取り専用**(Google 上で個別イベントを編集しても次回同期で上書き)。
- 購読(pull)の反映遅延・不達はこちらから制御できないため、確実な反映が必要な運用は
  **§6 の push 方式（Calendar API 直接同期）を正**とする。ICS 配信は外部公開用として併存。

---

## 5. 関連ファイル

| 対象 | パス |
| --- | --- |
| 生成スクリプト | `tools/build-calendar-ics.mjs` |
| push 同期スクリプト | `tools/sync-calendar-gcal.mjs` |
| npm スクリプト | `package.json`(`calendar:build` / `calendar:sync` / `calendar:sync:dry`) |
| CI 生成・配信 | `.github/workflows/jekyll-gh-pages.yml` |
| CI push 同期 | `.github/workflows/gcal-sync.yml` |
| テスト | `tests/calendar.ics.test.js` / `tests/calendar.gcal-sync.test.js` |

---

## 6. push 方式（Google Calendar API 直接同期）

購読(pull)の「Google が取りに来ない/遅い」問題を回避するため、`data/` 更新時に
GitHub Actions からサービスアカウントで対象カレンダーへ**完全ミラー同期**する。

### 6.1 仕組み

- スクリプト: `tools/sync-calendar-gcal.mjs`（外部依存なし・Node 18+）。
  ICS 生成と同じ `collectEvents()` を再利用するため、**抽出・除外ルールは §1 と完全に同一**。
- イベント ID は ICS の `UID` と同じ SHA-1（`作品|DB|索引|種別|識別子`）の hex 40 文字。
  Google のイベント ID 規約(base32hex)に適合し、再実行しても**冪等に upsert** される。
- 変更検知: 表示内容のフィンガープリントを `extendedProperties.private.blHash` に保存し、
  一致すればスキップ、不一致なら update。**DB 側から消えたイベントは削除**（完全ミラー）。
- 終日 + `RRULE:FREQ=YEARLY`、基準年 2024（§2 と同一）。2/29 は §2 と同じ
  「毎年2月末日」ルール(`BYMONTH=2;BYMONTHDAY=-1`)で平年 2/28 に表示される。
- **作品ごとの色分け**: `CreationWorks.#Works_*.CalendarColorId` を Google イベント色
  (`colorId` 1〜11)としてそのまま適用。色の変更もフィンガープリントで検知し update する。
- **説明欄**: §2 と同じ和文構成（`buildEventDescription()` を共用）。
- CI: `.github/workflows/gcal-sync.yml` が `develop` への push（`data/**` ほか）で自動実行。
  手動実行(workflow_dispatch)では dry-run も選択可。

### 6.2 初期設定（User 操作・初回 1 回のみ）

1. **サービスアカウント作成**: Google Cloud Console → 対象プロジェクト →
   「IAM と管理 > サービス アカウント」→ 作成（役割は不要。Calendar は共有で権限付与するため）。
2. **Calendar API 有効化**: 「API とサービス > ライブラリ」→ Google Calendar API を有効化。
3. **鍵の発行**: サービスアカウント → 「キー」→ 「新しい鍵を作成(JSON)」→ ダウンロード。
4. **カレンダー共有**: Google カレンダーの対象カレンダー設定 → 「特定のユーザーとの共有」→
   サービスアカウントのメールアドレス(`xxx@xxx.iam.gserviceaccount.com`)を
   **「予定の変更権限」**で追加。
5. **GitHub Secrets 登録**: リポジトリ Settings → Secrets and variables → Actions:
   - `GCAL_SERVICE_ACCOUNT_KEY`: 鍵 JSON の全文
   - `GCAL_CALENDAR_ID`: 対象カレンダー ID（カレンダー設定「カレンダーの統合」に記載）
6. **疎通確認**: Actions タブ → 「Google カレンダー同期」→ Run workflow（dry_run: true → 問題なければ false）。

### 6.3 ローカル検証

```bash
# 書き込みなしで計画のみ表示（認証情報不要）
npm run calendar:sync:dry -- --calendar dummy

# 実同期（鍵ファイルを使う場合）
GCAL_SERVICE_ACCOUNT_KEY_FILE=path/to/key.json GCAL_CALENDAR_ID=xxx npm run calendar:sync
```

### 6.4 注意

- 対象カレンダーは**同期専用**として扱う。手動で追加した予定は完全ミラーにより削除される。
- 初回同期時は、過去に手動/コネクタ経由で登録した非決定 ID のイベントが一度削除され、
  決定的 ID で再登録される（表示内容は同等）。
- 鍵 JSON は Secrets 以外に置かない（リポジトリ・ログへ出力しない）。
