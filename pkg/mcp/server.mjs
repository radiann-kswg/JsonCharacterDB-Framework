/**
 * server.mjs — 100BeautiesLab CreationsDB MCP サーバー
 *
 * @description
 *   Model Context Protocol (MCP) を使って GitHub Copilot Agent モード等の
 *   LLM ツールから 100BeautiesLab CreationsDB にアクセスするためのサーバー。
 *   stdio トランスポートで起動し、以下のツールを公開する。
 *
 *   ツール一覧:
 *     list_works         — 作品一覧の取得
 *     list_dbs           — DB 一覧の取得
 *     get_records        — レコード一覧の取得
 *     get_record         — インデックス値でレコード 1 件取得
 *     get_index_key      — DB のインデックスキーをスキーマから解決
 *     search_records     — DB 内全文検索
 *     search_all_records — 作品横断全文検索
 *
 *   公開制御:
 *     CreationsDBClient を既定オプション（includePrivate / includeHidden とも false）で
 *     生成するため、`isPrivate: true` のレコードと `Works_Hidden` / `DB_Hidden` の
 *     作品・DB は LLM へ一切公開されない（一覧・直接アクセスの双方を遮断）。
 *
 *   実行方法:
 *     node server.mjs --repo-root /path/to/100BeautiesLab_CreationsDB
 *
 * @author 100BeautiesLab.
 * @version 1.1.0
 * @dependencies @modelcontextprotocol/sdk (^1.0.0), ../nodejs/index.mjs
 */

import { Server }        from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath }  from "node:url";
import path               from "node:path";
import { CreationsDBClient } from "../nodejs/index.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// リポジトリルートの解決
// ─────────────────────────────────────────────────────────────────────────────

/**
 * コマンドライン引数または環境変数からリポジトリルートを取得する。
 * --repo-root <path> または CREATIONSDB_REPO_ROOT 環境変数を優先。
 * 未指定時は server.mjs の 2 階層上をデフォルトとする。
 * @returns {string}
 */
function resolveRepoRoot() {
  // --repo-root <path> 引数を探す
  const argIdx = process.argv.indexOf("--repo-root");
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return path.resolve(process.argv[argIdx + 1]);
  }
  // 環境変数
  if (process.env.CREATIONSDB_REPO_ROOT) {
    return path.resolve(process.env.CREATIONSDB_REPO_ROOT);
  }
  // デフォルト: pkg/mcp/ の 2 つ上 (= リポジトリルート)
  const __filename = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(__filename), "../..");
}

const REPO_ROOT = resolveRepoRoot();

// CreationsDB クライアント。
// LLM へ非公開データを渡さないため、isPrivate レコードと Works_Hidden / DB_Hidden の
// 作品・DB は明示的に除外する（既定値だが、意図を明示するため省略しない）。
const dbClient = new CreationsDBClient(REPO_ROOT, {
  includePrivate: false,
  includeHidden: false,
});

// ─────────────────────────────────────────────────────────────────────────────
// ツール定義（JSON Schema）
// ─────────────────────────────────────────────────────────────────────────────

/** MCP ツール定義リスト */
const TOOLS = [
  {
    name: "list_works",
    description:
      "100BeautiesLab CreationsDB の作品一覧を取得します。各作品のタイトル・概要・旧タイトル一覧を返します。",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "list_dbs",
    description:
      "指定した作品で利用可能なデータベース (DB) 一覧を取得します。",
    inputSchema: {
      type: "object",
      properties: {
        workId: {
          type: "string",
          description:
            '作品 ID。例: "NumberTales", "Works_NumberTales", "#Works_NumberTales"',
        },
      },
      required: ["workId"],
    },
  },
  {
    name: "get_records",
    description:
      "指定した作品・DB の全レコードを取得します。_Commons 補完・非公開除外が適用されます。",
    inputSchema: {
      type: "object",
      properties: {
        workId: { type: "string", description: '作品 ID。例: "NumberTales"' },
        dbName: {
          type: "string",
          description: 'DB 名。例: "Primary", "Secondary"',
        },
      },
      required: ["workId", "dbName"],
    },
  },
  {
    name: "get_record",
    description:
      "インデックス値で指定した作品・DB のレコードを 1 件取得します。",
    inputSchema: {
      type: "object",
      properties: {
        workId:   { type: "string", description: '作品 ID。例: "NumberTales"' },
        dbName:   { type: "string", description: 'DB 名。例: "Primary"' },
        idxValue: {
          type: "string",
          description: 'インデックス値。例: "25", "Major", "Wrath"',
        },
        idxKey: {
          type: "string",
          description:
            'インデックスフィールド名（ドット記法可）。省略時はスキーマ ($IndexDef / $IndexDef_<DB名>) から' +
            '自動解決されるため、通常は指定不要。作品ごとに異なる（NumberTales → "Num", ' +
            'FLInvestigator78 → "Card.Suit", ShouArRiders → "BeastType.Beast"）。' +
            "どのキーが使われるかは get_index_key ツールで確認できる。",
        },
      },
      required: ["workId", "dbName", "idxValue"],
    },
  },
  {
    name: "get_index_key",
    description:
      "指定した作品・DB のインデックスキー（get_record の idxValue が照合されるフィールド）を" +
      "スキーマから解決して返します。作品ごと・DB ごとに異なるため、get_record の前に確認できます。",
    inputSchema: {
      type: "object",
      properties: {
        workId: { type: "string", description: '作品 ID。例: "NumberTales"' },
        dbName: {
          type: "string",
          description: 'DB 名。省略時は作品既定のインデックスキーを返す。例: "Primary"',
        },
      },
      required: ["workId"],
    },
  },
  {
    name: "search_records",
    description:
      "指定した作品・DB 内でキーワード全文検索します（大小文字無視・部分一致）。",
    inputSchema: {
      type: "object",
      properties: {
        workId: { type: "string", description: '作品 ID。例: "NumberTales"' },
        dbName: { type: "string", description: 'DB 名。例: "Primary"' },
        query:  { type: "string", description: "検索キーワード" },
      },
      required: ["workId", "dbName", "query"],
    },
  },
  {
    name: "search_all_records",
    description:
      "指定した作品の全 DB を横断してキーワード全文検索します。各ヒットに DB 名が付属します。",
    inputSchema: {
      type: "object",
      properties: {
        workId: { type: "string", description: '作品 ID。例: "NumberTales"' },
        query:  { type: "string", description: "検索キーワード" },
      },
      required: ["workId", "query"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ツールハンドラー
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ツール呼び出しを実行して結果テキストを返す
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>} JSON 文字列
 */
async function callTool(toolName, args) {
  switch (toolName) {
    case "list_works": {
      const works = await dbClient.listWorks();
      return JSON.stringify(works, null, 2);
    }

    case "list_dbs": {
      const { workId } = args;
      if (!workId) throw new Error("workId is required");
      const dbs = await dbClient.listDBs(String(workId));
      return JSON.stringify(dbs, null, 2);
    }

    case "get_records": {
      const { workId, dbName } = args;
      if (!workId) throw new Error("workId is required");
      if (!dbName) throw new Error("dbName is required");
      const records = await dbClient.getRecords(String(workId), String(dbName));
      return JSON.stringify(records, null, 2);
    }

    case "get_record": {
      const { workId, dbName, idxValue, idxKey } = args;
      if (!workId)   throw new Error("workId is required");
      if (!dbName)   throw new Error("dbName is required");
      if (!idxValue) throw new Error("idxValue is required");
      // idxKey 未指定時は undefined を渡し、クライアント側でスキーマ ($IndexDef) から自動解決させる
      const record = await dbClient.getRecord(
        String(workId),
        String(dbName),
        String(idxValue),
        idxKey ? String(idxKey) : undefined
      );
      if (record === null) {
        // 見つからない場合、照合に使われたキーを添えて LLM が原因を判断できるようにする
        const usedKey = idxKey
          ? String(idxKey)
          : await dbClient.getIndexKey(String(workId), String(dbName));
        return JSON.stringify({ found: false, idxKey: usedKey });
      }
      return JSON.stringify(record, null, 2);
    }

    case "get_index_key": {
      const { workId, dbName } = args;
      if (!workId) throw new Error("workId is required");
      const idxKey = await dbClient.getIndexKey(
        String(workId),
        dbName ? String(dbName) : undefined
      );
      return JSON.stringify({ workId: String(workId), dbName: dbName ?? null, idxKey }, null, 2);
    }

    case "search_records": {
      const { workId, dbName, query } = args;
      if (!workId) throw new Error("workId is required");
      if (!dbName) throw new Error("dbName is required");
      if (!query)  throw new Error("query is required");
      const hits = await dbClient.search(String(workId), String(dbName), String(query));
      return JSON.stringify(hits, null, 2);
    }

    case "search_all_records": {
      const { workId, query } = args;
      if (!workId) throw new Error("workId is required");
      if (!query)  throw new Error("query is required");
      const results = await dbClient.searchAll(String(workId), String(query));
      return JSON.stringify(results, null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP サーバー初期化
// ─────────────────────────────────────────────────────────────────────────────

/** MCP サーバーインスタンス */
const server = new Server(
  {
    name: "creationsdb-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ── ツール一覧ハンドラー ──────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// ── ツール実行ハンドラー ──────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    const text = await callTool(name, args);
    return {
      content: [{ type: "text", text }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        },
      ],
      isError: true,
    };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// エントリーポイント
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr にのみ出力（stdout は MCP プロトコル専用）
  process.stderr.write(
    `[CreationsDB MCP] Server started. repoRoot=${REPO_ROOT}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[CreationsDB MCP] Fatal error: ${err}\n`);
  process.exit(1);
});
