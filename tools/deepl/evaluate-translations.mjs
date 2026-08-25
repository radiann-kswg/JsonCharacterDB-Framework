/**
 * evaluate-translations.mjs - 既存英訳の DeepL 突き合わせ（添削補助）
 * @description 各作品 db_*.json の「JP/EN ペア」フィールドについて、JP 値を
 *   DeepL（JA→EN・用語集適用）で機械翻訳し、人間監修済みの既存 `_EN` と差分比較する。
 *   結果は .cache/deepl/eval-report.md に「要レビュー候補」として出力する。
 *
 *   ⚠️ このスクリプトは **絶対にデータを書き換えない**。あくまで人間レビュー用の提案。
 *   localization-en-rules.md §0「既存 _EN を上書きしない」を厳守するための補助ツール。
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies Node.js >= 18, DEEPL_API_KEY, .cache/deepl/glossary-ids.json
 *
 * 使い方:
 *   DEEPL_API_KEY=xxxx node tools/deepl/evaluate-translations.mjs \
 *     [--fields Summary,Character] [--work Works_NumberTales] [--limit 25]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { translate } from "./deepl-client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const DATA_DIR = join(REPO_ROOT, "data");
const CACHE = join(REPO_ROOT, ".cache", "deepl");

/** 簡易 CLI パーサ（--key value 形式）。 */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const FIELDS = arg("fields", "Summary,Character,Backgrounds").split(",").map((s) => s.trim());
const WORK_FILTER = arg("work", null);
const LIMIT = parseInt(arg("limit", "25"), 10);

/** lowercase 単語集合の Jaccard 類似度（0〜1）。低いほど乖離＝要レビュー。 */
function similarity(a, b) {
  const toks = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9']+/g) || []);
  const sa = toks(a);
  const sb = toks(b);
  if (!sa.size && !sb.size) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** JP/EN ペアを収集（jp = field_JP ?? field、en = field_EN）。文字列のみ対象。 */
function collectCandidates() {
  const works = readdirSync(DATA_DIR).filter(
    (d) => d.startsWith("Works_") && (!WORK_FILTER || d === WORK_FILTER),
  );
  const out = [];
  for (const work of works) {
    const dbDir = join(DATA_DIR, work, "DataBases");
    let files = [];
    try {
      files = readdirSync(dbDir).filter((f) => f.startsWith("db_") && f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const file of files) {
      let json;
      try {
        json = JSON.parse(readFileSync(join(dbDir, file), "utf8"));
      } catch {
        continue;
      }
      const records = Array.isArray(json) ? json : [];
      records.forEach((rec, idx) => {
        if (!rec || typeof rec !== "object") return;
        const id = rec.Num ?? rec.Card?.Num ?? rec.Name_JP ?? rec.FormalName_JP ?? `#${idx}`;
        for (const f of FIELDS) {
          const jp = typeof rec[`${f}_JP`] === "string" ? rec[`${f}_JP`] : rec[f];
          const en = rec[`${f}_EN`];
          if (typeof jp === "string" && typeof en === "string" && jp.trim() && en.trim() && jp !== en) {
            out.push({ work, file, id, field: f, jp, en });
          }
        }
      });
    }
  }
  return out;
}

async function main() {
  const idsPath = join(CACHE, "glossary-ids.json");
  if (!existsSync(idsPath)) {
    throw new Error("glossary-ids.json がありません。先に用語集を作成/同期してください。");
  }
  const ids = JSON.parse(readFileSync(idsPath, "utf8"));
  const glossaryId = ids.glossaries?.["ja-en"]?.glossary_id;
  if (!glossaryId) throw new Error("ja-en の glossary_id が見つかりません。");

  let candidates = collectCandidates();
  console.log(`候補 ${candidates.length} 件（fields=${FIELDS.join(",")}）から ${LIMIT} 件を評価します`);
  candidates = candidates.slice(0, LIMIT);
  if (!candidates.length) {
    console.log("対象がありませんでした。--fields / --work を確認してください。");
    return;
  }

  // 50 件ずつバッチ翻訳
  const machine = [];
  for (let i = 0; i < candidates.length; i += 50) {
    const batch = candidates.slice(i, i + 50);
    const res = await translate(
      batch.map((c) => c.jp),
      { target_lang: "EN-US", source_lang: "JA", glossary_id: glossaryId },
    );
    machine.push(...res);
  }

  const rows = candidates
    .map((c, i) => ({ ...c, machine: machine[i], sim: similarity(c.en, machine[i]) }))
    .sort((a, b) => a.sim - b.sim); // 乖離が大きい順

  const lines = [
    "# DeepL 英訳 突き合わせレポート（添削補助）",
    "",
    `生成: ${new Date().toISOString()}`,
    `対象フィールド: ${FIELDS.join(", ")} / 件数: ${rows.length}`,
    "",
    "> 既存 `_EN`（人間監修）と DeepL 機械訳の差分。**自動修正はしていません。**",
    "> 類似度が低い順に並べています。固有名詞は用語集で固定済みのため、",
    "> 差分の多くは文体・意訳の揺れです。採否は人間が判断してください。",
    "",
  ];
  for (const r of rows) {
    lines.push(`## [${r.work}/${r.file}] ${r.id} — ${r.field}（類似度 ${(r.sim * 100).toFixed(0)}%）`);
    lines.push("");
    lines.push(`- **JP**: ${r.jp.replace(/\n/g, " / ")}`);
    lines.push(`- **既存 EN**: ${r.en.replace(/\n/g, " / ")}`);
    lines.push(`- **DeepL**: ${r.machine.replace(/\n/g, " / ")}`);
    lines.push("");
  }

  const outPath = join(CACHE, "eval-report.md");
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`レポート出力: ${outPath}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
