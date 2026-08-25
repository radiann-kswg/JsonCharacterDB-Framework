# CreationsDB — MCP サーバー

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) を使って GitHub Copilot Agent モードや他の LLM ツールから 100BeautiesLab CreationsDB にアクセスするためのサーバーです。  
`pkg/nodejs/index.mjs` の `CreationsDBClient` を内部で使用し、ファイルシステム経由でデータを取得します。

---

## 動作要件

| 条件 | 詳細 |
|------|------|
| ランタイム | Node.js 18+ |
| 依存パッケージ | `@modelcontextprotocol/sdk ^1.0.0` |

---

## セットアップ

### 1. 依存パッケージのインストール

```sh
cd pkg/mcp
npm install
```

### 2. サブモジュールのパスを確認

MCP サーバーは起動時にリポジトリルートを特定します。以下の順で解決します：

1. `--repo-root <path>` コマンドライン引数
2. `CREATIONSDB_REPO_ROOT` 環境変数
3. `server.mjs` の 2 階層上（= リポジトリルート）※サブモジュールとして配置した場合に自動解決

---

## VS Code への登録（GitHub Copilot Agent モード）

`.vscode/mcp.json` に以下を追加します：

```json
{
  "servers": {
    "creationsdb": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/path/to/100BeautiesLab_CreationsDB/pkg/mcp/server.mjs",
        "--repo-root",
        "${workspaceFolder}/path/to/100BeautiesLab_CreationsDB"
      ]
    }
  }
}
```

または、リポジトリをサブモジュールとして `submodules/` 以下に配置している場合：

```json
{
  "servers": {
    "creationsdb": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/submodules/100BeautiesLab_CreationsDB/pkg/mcp/server.mjs"
      ]
    }
  }
}
```

この場合、`--repo-root` は省略でき、`server.mjs` の 2 階層上が自動的にリポジトリルートとして使われます。

---

## 利用可能なツール

| ツール名 | 説明 |
|---------|------|
| `list_works` | 作品一覧を取得 |
| `list_dbs` | 指定作品の DB 一覧を取得 |
| `get_records` | 指定作品・DB の全レコードを取得 |
| `get_record` | インデックス値でレコードを 1 件取得 |
| `get_index_key` | DB のインデックスキーをスキーマから解決 |
| `search_records` | DB 内全文検索 |
| `search_all_records` | 作品横断全文検索 |

### インデックスキーについて

インデックスキー（`get_record` の `idxValue` が照合されるフィールド）は**作品ごとに異なります**。

| 作品 | インデックスキー |
|------|-----------------|
| NumberTales | `Num` |
| FLInvestigator78 | `Card.Suit` |
| ShouArRiders | `BeastType.Beast` |
| DestinyFoxRecords | `Unit`（ただし `Proxy` DB のみ `Generation`） |

`get_record` の `idxKey` を省略すればスキーマ（`$IndexDef`）から自動解決されるため、通常は指定不要です。
事前に確認したい場合は `get_index_key` を使います。

### 公開制御

`CreationsDBClient` を `includePrivate: false` / `includeHidden: false` で生成するため、
`isPrivate: true` のレコードと `Works_Hidden` / `DB_Hidden` の作品・DB は **LLM へ一切公開されません**
（一覧・直接アクセスの双方を遮断）。

---

## 使用例（GitHub Copilot Agent モード）

Copilot Chat でエージェントモードを有効にし、MCP サーバーが登録されていれば、以下のように問いかけられます：

```
@workspace NumberTales の Primary DB にあるキャラクターを一覧してください
```

```
@workspace "狼" で NumberTales の全 DB を検索してください
```

```
@workspace NumberTales Primary の Num=25 のキャラクター情報を教えてください
```

---

## 手動実行

```sh
# 起動（stdio は MCP クライアントが管理するため、通常は直接実行しない）
node server.mjs --repo-root /path/to/100BeautiesLab_CreationsDB

# 動作確認（標準入力に MCP メッセージを流す）
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node server.mjs
```

---

## セキュリティ

- `isPrivate: true` のレコードは既定で除外されます
- `workId` / `dbName` は英数字・アンダースコアのみ許可（`isSafeToken` による検証）
- ファイルシステムアクセスはリポジトリルート以下に限定

---

## 構成ファイル

| ファイル | 説明 |
|---------|------|
| [server.mjs](server.mjs) | MCP サーバー本体 |
| [package.json](package.json) | npm パッケージ定義 |
| [../nodejs/index.mjs](../nodejs/index.mjs) | 内部使用クライアント |
