/**
 * migrate.mjs — 100BeautiesLab CreationsDB D1/R2 マイグレーションスクリプト
 *
 * @description
 *   data/ 配下の JSON を Cloudflare R2（静的ミラー）と D1（検索インデックス）に投入する。
 *   wrangler CLI が認証済みであることを前提とする（wrangler login 済み、または
 *   CLOUDFLARE_API_TOKEN 環境変数が設定されていること）。
 *
 *   実行方法:
 *     node pkg/cloudflare/scripts/migrate.mjs [オプション]
 *
 *   オプション:
 *     --repo-root <path>   リポジトリルートのパス（省略時は自動解決）
 *     --dry-run            実際の投入は行わず、処理内容のみを出力
 *     --r2-only            R2 アップロードのみ実行
 *     --d1-only            D1 投入のみ実行
 *     --clean              D1 投入前に既存データを全削除（CI / 再投入向け）
 *     --db-id <name>       D1 データベース名（省略時: creationsdb-d1）
 *     --bucket <name>      R2 バケット名（省略時: creationsdb-data）
 *
 * @author 100BeautiesLab.
 * @version 1.1.0
 */

import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

// D1 の is_private 列は Worker と同一ロジックで算出する必要があるため、
// worker.js の実装をそのまま再利用する（ロジックの二重実装による乖離を避ける）
import { applyCommons, isPublicRecord } from "../worker.js";

// 引数パース・JSON 読み込み・SQL 整形・D1 投入は migrate-aihints.mjs と共通。
// コピーで乖離させないため migrate-common.mjs へ集約している。
import {
  parseCommonArgs,
  readJson,
  findJsonFiles,
  esc,
  resolveIdxKey,
  getByPath,
  CONVENTIONAL_FILES,
  stripDbPrefix,
  capitalize,
  resolveWorkDirForMigrate,
  readWorkBaseFile,
  resolveDbBasePath,
  createD1Runner,
  WRANGLER_CMD,
  WRANGLER_BASE_ARGS,
  SPAWN_OPTS_BASE,
} from "./migrate-common.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// 引数パース
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const { getArg, dryRun: DRY_RUN, clean: CLEAN, dbId: DB_ID, repoRoot: REPO_ROOT } = parseCommonArgs(args);

const R2_ONLY  = args.includes("--r2-only");
const D1_ONLY  = args.includes("--d1-only");
const BUCKET   = getArg("--bucket") ?? "creationsdb-data";

const DATA_DIR = join(REPO_ROOT, "data");

console.log(`[migrate] REPO_ROOT = ${REPO_ROOT}`);
console.log(`[migrate] D1 DB_ID  = ${DB_ID}`);
console.log(`[migrate] R2 BUCKET = ${BUCKET}`);
if (DRY_RUN) console.log("[migrate] ⚠️  DRY RUN モード（実際の投入はしません）");
if (CLEAN)   console.log("[migrate] 🗑️  CLEAN モード（D1 既存データを削除してから投入）");

/** 作品ベースファイルの読み込み（DATA_DIR を束ねた共通ヘルパーの薄いアダプタ） */
const readWorkBase = (workDir, filename) => readWorkBaseFile(DATA_DIR, workDir, filename);

// ─────────────────────────────────────────────────────────────────────────────
// D1 投入ユーティリティ
// ─────────────────────────────────────────────────────────────────────────────

const { d1Execute, d1BatchInsert } = createD1Runner({
  repoRoot: REPO_ROOT,
  dbId: DB_ID,
  dryRun: DRY_RUN,
  tmpDirName: "migrate",
});

// ─────────────────────────────────────────────────────────────────────────────
// メインデータ読み込み
// ─────────────────────────────────────────────────────────────────────────────

/** グローバルメタを読み込む */
const globalMeta = readJson(join(DATA_DIR, "db_meta.json")) ?? {};
const creationWorks = globalMeta.CreationWorks ?? {};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: R2 アップロード
// ─────────────────────────────────────────────────────────────────────────────

/** R2 アップロードに最終的に失敗したキー（スクリプト末尾で終了コードに反映する） */
const r2Failures = [];

/** R2 API が返す一時エラー（500 等）に備えたリトライ回数 */
const R2_MAX_ATTEMPTS = 3;

/**
 * 同期的に指定ミリ秒だけ待つ（リトライのバックオフ用）。
 * migrate は逐次処理のスクリプトであり、await へ書き換えずに済ませるため Atomics.wait を使う。
 * @param {number} ms
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

if (!D1_ONLY) {
  console.log("\n[R2] data/** の JSON ファイルを R2 にアップロード...");
  const jsonFiles = findJsonFiles(DATA_DIR);
  console.log(`[R2] 対象ファイル数: ${jsonFiles.length}`);

  for (const filepath of jsonFiles) {
    const rel = relative(REPO_ROOT, filepath).replace(/\\/g, "/");  // R2 キー
    if (DRY_RUN) {
      console.log(`[R2 dry-run] put ${BUCKET}/${rel}`);
      continue;
    }

    let lastErr = null;
    let uploaded = false;

    // R2 API は一時的に 500 Internal Server Error を返すことがある（実際に発生）。
    // 160 ファイルを逐次アップロードするため、1 件の瞬断で全体を落とさないようリトライする。
    for (let attempt = 1; attempt <= R2_MAX_ATTEMPTS; attempt++) {
      try {
        execFileSync(
          WRANGLER_CMD,
          [
            ...WRANGLER_BASE_ARGS,
            "r2", "object", "put",
            `${BUCKET}/${rel}`,
            "--file", rel,
            "--content-type", "application/json",
            // wrangler v4 の r2 object put は既定でローカルシミュレータ (.wrangler/state) へ書き込む。
            // --remote が無いと本番バケットへ一切反映されないまま「成功」して終わる（実際に発生した）。
            // d1 execute 側には元から --remote が付いており、R2 だけ欠けていた。
            "--remote"
          ],
          { stdio: "pipe", cwd: REPO_ROOT, ...SPAWN_OPTS_BASE }
        );
        uploaded = true;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < R2_MAX_ATTEMPTS) {
          console.warn(`[R2] ⟳ retry ${attempt}/${R2_MAX_ATTEMPTS - 1}: ${rel}`);
          sleepSync(1000 * attempt); // 1s, 2s の線形バックオフ
        }
      }
    }

    if (uploaded) {
      console.log(`[R2] ✓ ${rel}`);
    } else {
      console.error(`[R2] ✗ ${rel}: ${lastErr?.message ?? lastErr}`);
      r2Failures.push(rel);
    }
  }

  if (r2Failures.length > 0) {
    // ここで即 exit すると、R2 の瞬断 1 件で D1 投入まで巻き添えでスキップされる
    // （実際に発生し、is_private の是正が D1 へ反映されなかった）。
    // R2 と D1 は独立しているため D1 投入は続行し、終了コードはスクリプト末尾で立てる。
    console.error(`\n[R2] ✗ ${r2Failures.length} 件のアップロードに失敗（D1 投入は続行します）`);
  } else {
    console.log("[R2] アップロード完了");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: D1 — テーブルクリア（--clean 時）→ works 投入
// ─────────────────────────────────────────────────────────────────────────────

if (!R2_ONLY) {
  // records テーブルは AUTOINCREMENT で自然キーがないため、再投入前に全削除が必要。
  if (CLEAN) {
    console.log("\n[D1] 既存データをクリア...");
    d1Execute("clean/records", "DELETE FROM records;");
    d1Execute("clean/dbs",     "DELETE FROM dbs;");
    d1Execute("clean/works",   "DELETE FROM works;");
    console.log("[D1] クリア完了");
  }

  console.log("\n[D1] works テーブルを構築...");

  const worksValues = Object.entries(creationWorks).map(([key, info]) => {
    const isHidden = info?.Works_Hidden ? 1 : 0;
    return `(${esc(key)}, ${esc(info?.Title_JP)}, ${esc(info?.Title_EN)}, ${esc(info?.Works_Summary_JP)}, ${isHidden}, ${esc(JSON.stringify(info))})`;
  });

  if (worksValues.length > 0) {
    d1BatchInsert(
      "works",
      "key, title, title_en, summary, is_hidden, meta_json",
      worksValues,
      "works"
    );
  }
  console.log(`[D1] works: ${worksValues.length} 件投入`);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: D1 — dbs テーブル投入（作品別 db_meta.json を使用）
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\n[D1] dbs テーブルを構築...");
  const dbsValues = [];

  for (const workKey of Object.keys(creationWorks)) {
    const workDir = resolveWorkDirForMigrate(workKey, creationWorks);
    const workMeta = readWorkBase(workDir, "db_meta.json");
    const databases = workMeta?.Databases ?? {};

    for (const [dbKey, dbInfo] of Object.entries(databases)) {
      const isHidden = dbInfo?.DB_Hidden ? 1 : 0;
      const layer    = dbInfo?.DB_Layer ?? "DataBases";
      dbsValues.push(
        `(${esc(workKey)}, ${esc(dbKey)}, ${esc(dbInfo?.DB_Label)}, ${esc(dbInfo?.DB_Label_EN)}, ${esc(layer)}, ${isHidden})`
      );
    }
  }

  if (dbsValues.length > 0) {
    d1BatchInsert(
      "dbs",
      "work_key, db_key, db_label, db_label_en, db_layer, is_hidden",
      dbsValues,
      "dbs"
    );
  }
  console.log(`[D1] dbs: ${dbsValues.length} 件投入`);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4: D1 — records テーブル投入
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\n[D1] records テーブルを構築...");

  let totalRecords = 0;

  for (const workKey of Object.keys(creationWorks)) {
    const workDir  = resolveWorkDirForMigrate(workKey, creationWorks);
    const workMeta     = readWorkBase(workDir, "db_meta.json");
    const databases    = workMeta?.Databases ?? {};

    // 作品別 db_type.json から $IndexDef を読む
    const workType     = readWorkBase(workDir, "db_type.json") ?? {};
    const defaultIdxKey = resolveIdxKey(workType.$IndexDef);

    for (const [dbKey, dbInfo] of Object.entries(databases)) {
      if (dbInfo?.DB_Hidden) continue;

      const dbNorm  = capitalize(stripDbPrefix(dbKey));
      const layer   = (dbInfo?.DB_Layer || "DataBases").trim();
      const fileRaw = (dbInfo?.DB_File  || "").trim();
      const isRef   = dbKey.startsWith("#Ref_");
      const defPfx  = isRef ? "ref_" : "db_";
      const basePath = resolveDbBasePath(DATA_DIR, workDir, layer);

      // ファイル候補順に実在する JSON を探す
      const candidates = [
        fileRaw,
        CONVENTIONAL_FILES[dbNorm],
        `${defPfx}${dbNorm}.json`,
        `db_${dbNorm}.json`,
      ].filter(Boolean);

      let records = null;
      for (const fname of candidates) {
        const fp = join(basePath, fname);
        if (existsSync(fp)) {
          const parsed = readJson(fp);
          if (Array.isArray(parsed)) { records = parsed; break; }
        }
      }
      if (!records) {
        console.warn(`[D1] ⚠️  DB ファイル未発見: ${workKey}/${dbKey}`);
        continue;
      }

      // 作品別 db_type.json の DB 固有 $IndexDef があれば優先
      // 注意: resolveIdxKey() は indexDef が無くても既定値 "Num" を返すため、
      // dbSpecificType が無いのに resolveIdxKey(undefined) を呼ぶと常に "Num" が
      // 真値として確定してしまい defaultIdxKey に絶対フォールバックしない実バグがあった
      // （ネスト型 $IndexDef を持つ作品の idx_key が常に誤って "Num" になっていた）。
      const dbSpecificType = workType[`$IndexDef_${dbNorm}`];
      const idxKey = dbSpecificType ? resolveIdxKey(dbSpecificType) : defaultIdxKey;

      // is_private は _Commons / _Secondaries を適用「後」の値から判定する。
      // isPrivate は `_Secondaries[]._Commons.isPrivate: true` のようにシリーズ単位で
      // 注入されることがあり、生レコードだけを見ると非公開指定を取りこぼして
      // D1（records の SQL フィルタ・FTS 検索の双方）へ公開レコードとして投入されてしまう。
      // data_json は生のまま保持し、_Commons の適用は Worker 側の読み取り時に行う（従来どおり）。
      const resolvedRecords = applyCommons(records, workMeta, dbNorm);

      const recordValues = [];
      for (let i = 0; i < records.length; i++) {
        const rec          = records[i];
        const resolved     = resolvedRecords[i] ?? rec;
        const isPrivate    = isPublicRecord(resolved) ? 0 : 1;
        const idxValue     = getByPath(rec, idxKey);
        const searchText   = rec?._enrichment?.searchableText ?? JSON.stringify(rec);
        const dataJson     = JSON.stringify(rec);

        recordValues.push(
          `(${esc(workKey)}, ${esc(dbNorm)}, ${esc(idxKey)}, ${esc(String(idxValue ?? ""))}, ${isPrivate}, ${esc(searchText)}, ${esc(dataJson)})`
        );
      }

      d1BatchInsert(
        "records",
        "work_key, db_name, idx_key, idx_value, is_private, searchable_text, data_json",
        recordValues,
        `records/${workDir}/${dbNorm}`
      );
      totalRecords += records.length;
      console.log(`[D1] ${workKey}/${dbNorm}: ${records.length} 件`);
    }
  }

  console.log(`\n[D1] records 合計: ${totalRecords} 件投入`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 終了処理
// ─────────────────────────────────────────────────────────────────────────────

// R2 の失敗を握り潰すと、R2 が欠けたまま CI が緑になり、Worker の R2 依存機能
// （グローバル/作品メタ・_Commons 適用）が黙って劣化する。D1 投入まで終えたうえで
// 非ゼロ終了し、CI を赤くして再実行を促す。
if (r2Failures.length > 0) {
  console.error(`\n[migrate] ✗ R2 アップロードに失敗したファイル (${r2Failures.length} 件):`);
  for (const key of r2Failures) console.error(`  - ${key}`);
  console.error("[migrate] D1 の投入は完了しています。ワークフローを再実行してください。");
  process.exit(1);
}

console.log("\n[migrate] 完了 ✓");
