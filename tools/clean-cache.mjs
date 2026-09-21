/**
 * clean-cache - `.cache/` の保守ポリシー付きクリーンアップユーティリティ
 *
 * @description
 * リポジトリ直下 `.cache/`(Git 管轄外の一時ファイル置き場) の直下エントリを走査し、
 * 一定期間更新されていないものを削除します。判定はエントリ単位(ファイル or 直下ディレクトリ)で、
 * ディレクトリは**配下で最も新しい mtime** を採用します。ディレクトリの mtime は
 * 孫階層の更新を反映しないため、これをしないと作業中のサブフォルダを消してしまいます。
 *
 * 既存ツール(`normalize-field-order` 等)と同じく **plan がデフォルト**で、
 * 実際の削除は `--write` を付けたときだけ行います。
 *
 * 使い方:
 *   node tools/clean-cache.mjs                 # 14日より古いエントリを一覧(削除しない)
 *   node tools/clean-cache.mjs --days 30       # しきい値を変更
 *   node tools/clean-cache.mjs --write         # 実際に削除
 *   node tools/clean-cache.mjs --all --write   # 期間を無視して全削除
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies node:fs, node:path, node:url
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(REPO_ROOT, ".cache");

/** 既定の保持期間(日) */
const DEFAULT_DAYS = 14;

/**
 * ディレクトリ配下で最も新しい mtime(ミリ秒)と合計サイズを再帰的に集計する
 *
 * @description シンボリックリンクは追跡しない(`.cache/` 外へ抜ける削除を防ぐため)。
 * @param {string} target - 対象のファイル or ディレクトリの絶対パス
 * @returns {{ mtimeMs: number, size: number }} 最新更新時刻と合計バイト数
 */
export function statTree(target) {
  const st = fs.lstatSync(target);
  if (!st.isDirectory()) return { mtimeMs: st.mtimeMs, size: st.size };

  let mtimeMs = st.mtimeMs;
  let size = 0;
  for (const name of fs.readdirSync(target)) {
    const child = statTree(path.join(target, name));
    if (child.mtimeMs > mtimeMs) mtimeMs = child.mtimeMs;
    size += child.size;
  }
  return { mtimeMs, size };
}

/**
 * `.cache/` 直下のエントリから削除対象を選び出す
 *
 * @param {number} cutoffMs - この時刻より古い(未満)エントリを削除対象とする
 * @returns {Array<{ name: string, mtimeMs: number, size: number }>} 削除対象一覧(古い順)
 */
export function planCleanup(cutoffMs) {
  if (!fs.existsSync(CACHE_DIR)) return [];
  return fs
    .readdirSync(CACHE_DIR)
    .map((name) => ({ name, ...statTree(path.join(CACHE_DIR, name)) }))
    .filter((entry) => entry.mtimeMs < cutoffMs)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
}

/** CLI 本体(直接実行時のみ。テストから import したときは走らせない) */
function main(argv) {
  const has = (flag) => argv.includes(flag);
  const days = Number(argv[argv.indexOf("--days") + 1]);
  const keepDays = has("--days") && Number.isFinite(days) ? days : DEFAULT_DAYS;
  const cutoffMs = has("--all") ? Infinity : Date.now() - keepDays * 86_400_000;
  const write = has("--write");

  const targets = planCleanup(cutoffMs);
  const policy = has("--all") ? "全エントリ" : `${keepDays}日より古いエントリ`;

  if (targets.length === 0) {
    console.log(`[clean-cache] ${policy}: 対象なし (.cache/ は整理済み)`);
    return;
  }

  for (const t of targets) {
    const ageDays = Math.floor((Date.now() - t.mtimeMs) / 86_400_000);
    console.log(`  ${write ? "削除" : "対象"}: ${t.name} (${ageDays}日前, ${(t.size / 1024).toFixed(1)} KB)`);
    if (write) fs.rmSync(path.join(CACHE_DIR, t.name), { recursive: true, force: true });
  }

  const totalMB = (targets.reduce((sum, t) => sum + t.size, 0) / 1024 / 1024).toFixed(1);
  console.log(
    write
      ? `[clean-cache] ${policy} ${targets.length} 件 / ${totalMB} MB を削除したよ。`
      : `[clean-cache] ${policy} ${targets.length} 件 / ${totalMB} MB が対象。実行するなら --write を付けてね。`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
