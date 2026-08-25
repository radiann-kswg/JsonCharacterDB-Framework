# JsonCharacterDB-Framework

**JSON でキャラクター設定を管理し、GitHub Pages 上でキャラシート・相関図・疑似 API として公開する静的サイトフレームワークです。**

ビルド不要・依存ゼロ（Vanilla JS + Service Worker）。`data/` に JSON を置くだけで、
スキーマ（`db_type.json`）に従って UI が自動生成されます。

- 上流: [radiann-kswg/100BeautiesLab_CreationsDB](https://github.com/radiann-kswg/100BeautiesLab_CreationsDB) の `develop` ブランチ
- ライセンス: **CC BY-NC 4.0**（[LICENSE](./LICENSE)）
- 派生実装の例: `radiann-kswg/RadianNs_SecondaryWorksDB`（二次創作作品DB / Private）

---

## 何ができるか

| 機能 | 実体 | 説明 |
| --- | --- | --- |
| **キャラシート UI** | `pages/characters.html` | スキーマ駆動でキャラクター詳細を描画。検索・ファセット絞り込み・直リンク対応 |
| **相関図 UI** | `pages/relations.html` | キャラ間の関係を三角格子レイアウトのグラフで描画（cytoscape 同梱） |
| **疑似 API** | `pages/sw.js` + `svc/` + `api/` | Service Worker が `/api/v1/...` を JSON で返す。サーバ不要 |
| **実 API（任意）** | `pkg/cloudflare/` | Cloudflare Workers + R2 + D1(FTS5) で外部公開する場合の実装 |
| **クライアントライブラリ** | `pkg/{nodejs,python,csharp,mcp}/` | DB を外部プログラムから読むための薄いクライアント |
| **英訳補助** | `tools/deepl/`, `tools/deepl_py/` | DeepL 用語集の生成・同期と対訳ドラフト |
| **JSON DB 管理ツール** | `tools/*.mjs` | フィールド順の正規化・列挙値の辞書化・パレット抽出 |

---

## クイックスタート

```bash
git clone https://github.com/radiann-kswg/JsonCharacterDB-Framework.git
cd JsonCharacterDB-Framework
npm install
npx serve .          # 任意の静的サーバで OK
# → http://localhost:3000/pages/characters.html
```

同梱の `data/Works_Sample/` がそのまま表示されれば動作確認は完了です。

### 自分の作品DBを作る

1. `data/Works_Sample/` を `data/Works_<あなたの作品ID>/` へコピーする
2. `data/db_meta.json` の `CreationWorks` に `#Works_<あなたの作品ID>` を追加する
3. `data/Works_<ID>/DataBases/db_type.json` に作品固有フィールドを定義する
4. `data/Works_<ID>/DataBases/db_Primary.json` にキャラクターを追加する
5. `npm test` で整合性を確認する

詳しい手順とスキーマの書き方は **[docs/json-db-implementation-guide.md](./docs/json-db-implementation-guide.md)** を読んでください。

---

## ドキュメント

| ファイル | 内容 |
| --- | --- |
| [`docs/json-db-implementation-guide.md`](./docs/json-db-implementation-guide.md) | **JSON DB 実装ガイド**（まずここ）。ディレクトリ構成・スキーマ・型・表示制御 |
| [`docs/db-update-guidelines.md`](./docs/db-update-guidelines.md) | データ更新時の運用ルール |
| [`docs/schema-meta-processing.md`](./docs/schema-meta-processing.md) | `db_meta.json` / `db_type.json` の処理仕様 |
| [`docs/viewer-guide.md`](./docs/viewer-guide.md) | キャラシート UI の使い方 |
| [`docs/relations-graph.md`](./docs/relations-graph.md) | 相関図のレイアウト仕様 |
| [`docs/api-sw-spec.md`](./docs/api-sw-spec.md) | 疑似 API のエンドポイント仕様 |
| [`docs/pkg-client-libraries.md`](./docs/pkg-client-libraries.md) | クライアントライブラリの使い方 |
| [`docs/deepl-localization.md`](./docs/deepl-localization.md) | 英訳補助のワークフロー |
| [`docs/deploy-howto.md`](./docs/deploy-howto.md) | GitHub Pages / Cloudflare へのデプロイ |
| [`AGENTS.md`](./AGENTS.md) | AI エージェント向けの正典（技術・運用ルール、ロールプレイ設定） |

---

## AI エージェントと一緒に使う

`AGENTS.md` を正典とした指示書構成に対応しています（Claude / Codex / Copilot）。

- 人格（ロールプレイ）を持たせたい場合は `.agents/roleplay/ROLEPLAY.template.md` を
  `ROLEPLAY.md` にコピーして書き換えてください。既定はロールプレイなしです。
- `npm run agents:build` で `.github/copilot-instructions.md` と `.claude/skills/**` を再生成します。

---

## ライセンスと利用条件

本フレームワークのコード・ドキュメントは **CC BY-NC 4.0** で提供します。

- ✅ 非商用であれば自由に利用・改変・再配布できます（クレジット表記が必要）
- ❌ 商用利用は許可していません

**`data/` に置くあなたの創作データは、このライセンスの対象外です。**
データのライセンスはあなた自身が決めて、リポジトリ内に別途明記してください。
特に二次創作データを扱う場合は、原作の権利者が定めるガイドラインに従ってください。

同梱している第三者ライブラリのライセンスは [`pages/vendor/THIRD_PARTY_NOTICES.md`](./pages/vendor/THIRD_PARTY_NOTICES.md) を参照してください。
