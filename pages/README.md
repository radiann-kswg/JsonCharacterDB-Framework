# pages/characters.html の使い方

- 本ページは `/data/**` の創作データベースを、ブラウザ内 API（Service Worker）`/pages/v1/*` を優先し、必要に応じて `/svc/v1/*` / `/api/v1/*` も使いながら取得し、キャラシートを表示します。
- GitHub Pages などの静的ホスティング上で動作することを想定しています（`file://` 直開きでは Service Worker が有効になりません）。

## 開き方

- ルートから `pages/characters.html` をブラウザで開いてください。
- 初回アクセス時に `pages/sw.js` を登録し、`/pages/v1/*` を優先する疑似 API を利用します。必要に応じて `/svc/v1/*` / `/api/v1/*` へフォールバックします。

## 画面構成

- 作品（Works）と DB を選択 → 一覧が表示されます。
- 名前や番号などで部分一致検索ができます。
- 一覧のカードをクリックすると詳細（キャラシート）表示に切り替わります。
- URL パラメータで直接指定もできます（例：`?work=NumberTales&db=Primary&idx=2&idxKey=Num`）。
  - `work` は作品ドロップダウンの値（例: `NumberTales`）です。
  - 旧互換として `num` も解釈されます（主に `Num` インデックス想定）。

## 表示ポリシー（公開情報）

- API で解決できる情報（`$VarsDef` 由来の日本語/英語ラベル、`#ListLink`/`$EnumLink` の展開など）は、可能な限り表示します。
- キャラシートの表示項目は原則として typedef / meta に基づいて決定し、`_DBLink` などの内部補助情報や schema 外のトップレベル項目は表示しません。
- `BirthDay` は `AnivDay` と同系統の基本情報補助行として扱います。
- レコードに `Images.*` があれば `/data/**/Images/DB_*` または `/data/**/Images/Ref_*` を優先し、作品共通画像は `Images/General/` から推測してサムネイル/ポスターを表示します（なければ省略）。
- データ欠損がある場合でも極力落ちないように実装しています（空欄や省略で表示）。

## 備考

- `pages/characters.html` は UI 反映のためにアセットバージョンを持っています。`characters.js` / `characters.css` の更新で表示差分が出る場合は、必要に応じて `asset-version` も更新してください。
- もし UI 用 API がうまく返らない場合は、`pages/characters.html` を再読み込みしたうえで、必要に応じて「キャッシュ/SWリセット」を実行してください。
