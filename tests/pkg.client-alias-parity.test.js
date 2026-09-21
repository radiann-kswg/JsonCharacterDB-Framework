/**
 * pkg.client-alias-parity.test.js - 旧作品名／旧綴りエイリアス表の言語横断パリティテスト
 *
 * @description
 *   エイリアス表は本体（lib / pages / pkg/cloudflare）と 3 クライアント（Node.js / Python / C#）の
 *   計 7 ファイルへ独立に書かれており、SSOT が存在しない。実際に PR #33 → #34 では
 *   「viewer だけ旧綴りを解決し、API/SW と各クライアントは解決しない」という取りこぼしが起きた。
 *   本テストは各ファイルのソースからエイリアス表を抽出し、全ファイルで内容が一致することを検証する。
 *
 *   Python / C# クライアントは実行環境（python3 / dotnet）が CI に無いためソース解析で担保する。
 *   Node.js クライアントの実挙動は `tests/pkg.nodejs.test.js` が担当。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies vitest
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * 識別子の「宣言」に続く `{ ... }` ブロックを波括弧の対応を数えて切り出す
 *
 * 参照箇所（`LEGACY_WORK_ID_ALIASES[key]` 等）を宣言と誤認しないよう、識別子と `{` の間に
 * 代入（`=` / Python の型注釈付き代入 / C# の `= new()`）があることを要求する。
 *
 * @param {string} src - ソース全文
 * @param {string} identifier - テーブルの変数名
 * @returns {string|null} ブロック本体（波括弧を含む）。宣言が見つからなければ null
 */
function extractBraceBlock(src, identifier) {
  const decl = new RegExp(
    `${identifier}\\s*(?::[^=\\n]*)?=\\s*(?:new\\s*\\(\\s*\\))?\\s*\\{`,
  );
  const m = decl.exec(src);
  if (!m) return null;
  const open = src.indexOf("{", m.index + m[0].length - 1);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * エイリアス表のブロックから key → value を抽出する
 *
 * JS の `Key: 'Value'`、Python の `'Key': 'Value'`、C# の `{ "Key", "Value" }` を
 * 同じ 1 本の正規表現で拾う（キーのクォートは任意、区切りは `:` または `,`）。
 *
 * @param {string} block - extractBraceBlock() の戻り値
 * @returns {Record<string, string>}
 */
function parseAliasEntries(block) {
  const entries = {};
  const re = /["']?([A-Za-z0-9_]+)["']?\s*[:,]\s*["']([A-Za-z0-9_]+)["']/g;
  let m;
  while ((m = re.exec(block))) entries[m[1]] = m[2];
  return entries;
}

/**
 * ソースからエイリアス表を読み出す
 *
 * @param {string} rel - リポジトリルートからの相対パス
 * @param {string} identifier - テーブルの変数名
 * @returns {Record<string, string>}
 */
function readAliasTable(rel, identifier) {
  const src = fs.readFileSync(path.resolve(repoRoot, rel), "utf-8");
  const block = extractBraceBlock(src, identifier);
  expect(
    block,
    `${rel} に ${identifier} の宣言が見つかりません`,
  ).not.toBeNull();
  return parseAliasEntries(block);
}

/** 旧作品名 → 現行ディレクトリ名（`Proxies` → `Works_DestinyFoxRecords` 等） */
const DIR_ALIAS_TABLES = [
  ["lib/sw-common.js", "LEGACY_WORK_DIR_ALIASES"],
  ["lib/data-common.js", "DATA_COMMON_LEGACY_WORK_DIR_ALIASES"],
  ["pages/characters.js", "LEGACY_WORK_DIR_ALIASES"],
  ["pkg/nodejs/index.mjs", "LEGACY_WORK_DIR_ALIASES"],
  ["pkg/python/creationsdb/client.py", "_LEGACY_WORK_DIR_ALIASES"],
  ["pkg/csharp/CreationsDBClient.cs", "LegacyWorkDirAliases"],
];

/** 旧綴りの作品ID → 現行綴り（`ShouArRiders` → `ShauErRiders` 等） */
const ID_ALIAS_TABLES = [
  ["lib/viewer-locator.js", "LEGACY_WORK_ALIASES"],
  ["lib/sw-common.js", "LEGACY_WORK_ID_ALIASES"],
  ["lib/data-common.js", "DATA_COMMON_LEGACY_WORK_ID_ALIASES"],
  ["pkg/cloudflare/worker.js", "LEGACY_WORK_ID_ALIASES"],
  ["pkg/nodejs/index.mjs", "LEGACY_WORK_ID_ALIASES"],
  ["pkg/python/creationsdb/client.py", "_LEGACY_WORK_ID_ALIASES"],
  ["pkg/csharp/CreationsDBClient.cs", "LegacyWorkIdAliases"],
];

describe("エイリアス表のパリティ: 旧作品名 → 現行ディレクトリ名", () => {
  const [baseRel, baseId] = DIR_ALIAS_TABLES[0];
  const base = readAliasTable(baseRel, baseId);

  it("抽出できている（パーサが壊れていない）", () => {
    expect(Object.keys(base).length).toBeGreaterThan(0);
    expect(base.Proxies).toBe("Works_DestinyFoxRecords");
    expect(base.ShouArRiders).toBe("Works_ShauErRiders");
  });

  it.each(DIR_ALIAS_TABLES.slice(1))(
    "%s の %s が本体と一致する",
    (rel, identifier) => {
      expect(
        readAliasTable(rel, identifier),
        `${rel} の ${identifier} が ${baseRel} と食い違っています（全クライアントで同期させてください）`,
      ).toEqual(base);
    },
  );
});

describe("エイリアス表のパリティ: 旧綴りの作品ID → 現行綴り", () => {
  const [baseRel, baseId] = ID_ALIAS_TABLES[0];
  const base = readAliasTable(baseRel, baseId);

  it("抽出できている（パーサが壊れていない）", () => {
    expect(Object.keys(base).length).toBeGreaterThan(0);
    expect(base.ShouArRiders).toBe("ShauErRiders");
  });

  it.each(ID_ALIAS_TABLES.slice(1))(
    "%s の %s が本体と一致する",
    (rel, identifier) => {
      expect(
        readAliasTable(rel, identifier),
        `${rel} の ${identifier} が ${baseRel} と食い違っています（全クライアントで同期させてください）`,
      ).toEqual(base);
    },
  );
});

describe("エイリアス表の整合: 作品IDエイリアスは対応するディレクトリエイリアスを伴う", () => {
  // PR #33 の取りこぼしはこの不一致そのもの（ID だけ読み替えてディレクトリが旧名のままだと
  // 現行ディレクトリへ到達できない）。逆向き（dir のみ）は `Proxies` のような
  // DB 単位の統合で正当に発生するため検査しない。
  it.each(ID_ALIAS_TABLES)(
    "%s の %s が指す現行綴りにディレクトリ解決が追従している",
    (rel, identifier) => {
      const idAliases = readAliasTable(rel, identifier);
      for (const [legacy, current] of Object.entries(idAliases)) {
        for (const [dirRel, dirId] of DIR_ALIAS_TABLES) {
          expect(
            readAliasTable(dirRel, dirId)[legacy],
            `${dirRel} の ${dirId} に ${legacy} → Works_${current} がありません`,
          ).toBe(`Works_${current}`);
        }
      }
    },
  );
});

describe("エイリアスの解決先が実在する", () => {
  const globalMeta = JSON.parse(
    fs.readFileSync(path.resolve(repoRoot, "data/db_meta.json"), "utf-8"),
  );

  it("ディレクトリエイリアスの解決先が data/ に存在する", () => {
    for (const [legacy, dir] of Object.entries(
      readAliasTable(...DIR_ALIAS_TABLES[0]),
    )) {
      expect(
        fs.existsSync(path.resolve(repoRoot, "data", dir)),
        `${legacy} → data/${dir} が存在しません`,
      ).toBe(true);
    }
  });

  it("作品IDエイリアスの解決先が db_meta.json の CreationWorks に存在する", () => {
    for (const [legacy, current] of Object.entries(
      readAliasTable(...ID_ALIAS_TABLES[0]),
    )) {
      expect(
        globalMeta.CreationWorks?.[`#Works_${current}`],
        `${legacy} → #Works_${current} が CreationWorks にありません`,
      ).toBeDefined();
    }
  });

  it("旧綴りの作品IDが CreationWorks に残っていない（改名の取りこぼし検出）", () => {
    for (const legacy of Object.keys(readAliasTable(...ID_ALIAS_TABLES[0]))) {
      expect(globalMeta.CreationWorks?.[`#Works_${legacy}`]).toBeUndefined();
    }
  });
});
