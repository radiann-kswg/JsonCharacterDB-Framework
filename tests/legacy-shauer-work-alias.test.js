/**
 * 獣爾騎兵の旧綴り作品ID（ShouArRiders）→ 現行綴り（ShauErRiders）互換の回帰テスト
 *
 * 背景（PR #33 の積み残し）:
 * - 旧綴りの別名解決が `lib/viewer-locator.js`（ビューア側）にしか無く、
 *   API / SW 経路（`pkg/cloudflare/worker.js`・`lib/sw-common.js`・`lib/data-common.js`）には無かった。
 * - D1 を `--clean` で再同期すると works/dbs/records のキーは現行綴りのみになるため、
 *   `/api/v1/Works_ShouArRiders/...` が 404 になっていた。
 *
 * 各経路の「作品ID正規化」の時点で旧綴りを現行綴りへ読み替えることを検証する。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import worker from "../pkg/cloudflare/worker.js";

// data-common.js はブラウザ/SW向けにグローバル公開する設計だが Node でも評価可能
import "../lib/data-common.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * sw-common.js を vm 上へロードし、SW グローバル相当を揃えたコンテキストを返す
 * @returns {Object}
 */
function loadSwCommon() {
  const context = {
    console: { log() {}, warn() {}, error() {} },
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    URL: globalThis.URL,
    Map: globalThis.Map,
    Set: globalThis.Set,
    Date: globalThis.Date,
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    EnrichmentProcessor: class {},
    ReferenceResolver: class {},
    self: {
      location: {
        origin: "https://example.invalid",
        href: "https://example.invalid/api/sw.js",
      },
      registration: { scope: "https://example.invalid/api/" },
      addEventListener() {},
    },
  };
  vm.runInNewContext(
    readFileSync(join(repoRoot, "lib/sw-common.js"), "utf-8"),
    context,
    {
      filename: "lib/sw-common.js",
    },
  );
  return context;
}

/** fetchJSON 呼び出しを記録するだけの最小 DataFetcher スタブ */
class RecordingDataFetcher {
  constructor() {
    this.calls = [];
  }
  async fetchJSON(path) {
    this.calls.push(path);
    return {};
  }
}

const testConfig = {
  ORIGIN: "http://localhost",
  withRepoBase: (p) => String(p || ""),
};

/**
 * D1 の bind 引数と R2 の get キーを記録する Workers env スタブ
 * @returns {{ env: object, d1Binds: any[][], r2Keys: string[] }}
 */
function makeRecordingEnv() {
  const d1Binds = [];
  const r2Keys = [];
  const env = {
    DB: {
      prepare() {
        return {
          bind(...args) {
            d1Binds.push(args);
            return {
              first: async () => ({ is_hidden: 0 }),
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    },
    BUCKET: {
      head: async () => null,
      get: async (key) => {
        r2Keys.push(String(key));
        return null;
      },
    },
  };
  return { env, d1Binds, r2Keys };
}

describe("lib/sw-common.js: DataUtils.toWorkKey() の旧綴り互換", () => {
  it("ShouArRiders / Works_ShouArRiders / #Works_ShouArRiders は #Works_ShauErRiders へ正規化される", () => {
    const { DataUtils } = loadSwCommon().self;
    expect(DataUtils.toWorkKey("ShouArRiders")).toBe("#Works_ShauErRiders");
    expect(DataUtils.toWorkKey("Works_ShouArRiders")).toBe(
      "#Works_ShauErRiders",
    );
    expect(DataUtils.toWorkKey("#Works_ShouArRiders")).toBe(
      "#Works_ShauErRiders",
    );
  });

  it("現行綴り・他作品は無変換", () => {
    const { DataUtils } = loadSwCommon().self;
    expect(DataUtils.toWorkKey("ShauErRiders")).toBe("#Works_ShauErRiders");
    expect(DataUtils.toWorkKey("NumberTales")).toBe("#Works_NumberTales");
    expect(DataUtils.toWorkKey("bad-name!")).toBeNull();
  });
});

describe("lib/data-common.js: 旧綴り作品IDの正規化とディレクトリ解決", () => {
  it('resolveWorksReference("ShouArRiders") は Works_ShauErRiders から読む', async () => {
    const dataFetcher = new RecordingDataFetcher();
    const resolver = new globalThis.ReferenceResolver(dataFetcher, testConfig);

    await resolver.resolveWorksReference("ShouArRiders");

    expect(dataFetcher.calls).toEqual([
      "/data/Works_ShauErRiders/DataBases/db_meta.json",
    ]);
  });

  it("normalizeWorkId() は旧綴りを #Works_ShauErRiders へ、他作品はそのまま返す", () => {
    const resolver = new globalThis.ReferenceResolver(
      new RecordingDataFetcher(),
      testConfig,
    );
    expect(resolver.normalizeWorkId("#Works_ShouArRiders")).toBe(
      "#Works_ShauErRiders",
    );
    expect(resolver.normalizeWorkId("Works_ShouArRiders")).toBe(
      "#Works_ShauErRiders",
    );
    expect(resolver.normalizeWorkId("ShouArRiders")).toBe(
      "#Works_ShauErRiders",
    );
    expect(resolver.normalizeWorkId("NumberTales")).toBe("#Works_NumberTales");
    expect(resolver.normalizeWorkId("#Works_DestinyFoxRecords")).toBe(
      "#Works_DestinyFoxRecords",
    );
    expect(resolver.normalizeWorkId("")).toBe("");
  });
});

describe("pkg/cloudflare/worker.js: /api/v1/Works_ShouArRiders/* は現行キーで D1 / R2 を引く", () => {
  it("GET /api/v1/Works_ShouArRiders/meta は #Works_ShauErRiders で works を検索し、Works_ShauErRiders 配下を読む", async () => {
    const { env, d1Binds, r2Keys } = makeRecordingEnv();
    const res = await worker.fetch(
      new Request("https://example.invalid/api/v1/Works_ShouArRiders/meta"),
      env,
      {},
    );

    // D1 側の Works_Hidden チェックは現行キーで行われる（旧キーは一切使われない）
    expect(d1Binds.some((args) => args.includes("#Works_ShauErRiders"))).toBe(
      true,
    );
    expect(d1Binds.some((args) => args.includes("#Works_ShouArRiders"))).toBe(
      false,
    );

    // R2 側のパスも現行ディレクトリへ向く
    expect(r2Keys.some((k) => k.includes("Works_ShauErRiders"))).toBe(true);
    expect(r2Keys.some((k) => k.includes("Works_ShouArRiders"))).toBe(false);

    // R2 スタブは空なので 404/空メタでも良いが、「Invalid work ID」(400) にはならない
    expect(res.status).not.toBe(400);
  });
});

describe('data: 旧英名 "Shou-Ar Riders" の残存なし', () => {
  it("db_Primary.json（獣爾騎兵）の Summary_EN に旧英名が残っていない", () => {
    const src = readFileSync(
      join(repoRoot, "data/Works_ShauErRiders/DataBases/db_Primary.json"),
      "utf-8",
    );
    expect(src.includes("Shou-Ar Riders")).toBe(false);
    expect(src.includes("Shou'ar Riders")).toBe(false);
    expect(src.includes("Shau'er Riders")).toBe(true);
  });
});
