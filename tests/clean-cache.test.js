/**
 * clean-cache のツリー集計テスト
 *
 * ディレクトリ自身の mtime は孫階層の更新を反映しないため、`statTree()` が
 * 「配下で最も新しい mtime」を返すことを検証する(作業中のサブフォルダを消さないための要)。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { statTree } from "../tools/clean-cache.mjs";

let tmp;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clean-cache-"));
  fs.mkdirSync(path.join(tmp, "nested", "deep"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "nested", "deep", "fresh.txt"), "12345");

  const old = new Date(Date.now() - 90 * 86_400_000);
  fs.utimesSync(tmp, old, old);
  fs.utimesSync(path.join(tmp, "nested"), old, old);
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("statTree", () => {
  it("孫階層の新しい mtime をディレクトリの代表値として拾う", () => {
    const { mtimeMs } = statTree(tmp);
    expect(Date.now() - mtimeMs).toBeLessThan(60_000);
  });

  it("配下のサイズを合計する", () => {
    expect(statTree(tmp).size).toBe(5);
  });
});
