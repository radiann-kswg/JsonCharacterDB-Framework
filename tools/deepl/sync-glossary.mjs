/**
 * sync-glossary.mjs - DeepL 用語集 同期/更新スクリプト
 * @description build-glossary-source.mjs が生成した TSV（.cache/deepl/）を読み、
 *   DeepL アカウント上の用語集を「同名のものを削除 → 再作成」で最新化する。
 *   DeepL は用語集の部分更新に対応しないため、置き換え方式を採る。
 *   更新後の glossary_id を .cache/deepl/glossary-ids.json へ書き戻す。
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies Node.js >= 18, DEEPL_API_KEY, 事前に `npm run deepl:build-glossary`
 *
 * 使い方:
 *   DEEPL_API_KEY=xxxx node tools/deepl/sync-glossary.mjs
 *   （--dry-run で API 呼び出しせず対象だけ表示）
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { listGlossaries, createGlossary, deleteGlossary } from "./deepl-client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const CACHE = join(REPO_ROOT, ".cache", "deepl");
const DRY_RUN = process.argv.includes("--dry-run");

/** 同期対象の用語集定義（名前・言語・ソース TSV）。 */
const TARGETS = [
  { key: "ja-en", name: "100BL-CreationsDB JA-EN", source_lang: "JA", target_lang: "EN", tsv: "glossary_ja-en.tsv" },
  { key: "en-ja", name: "100BL-CreationsDB EN-JA", source_lang: "EN", target_lang: "JA", tsv: "glossary_en-ja.tsv" },
];

async function main() {
  for (const t of TARGETS) {
    const tsvPath = join(CACHE, t.tsv);
    if (!existsSync(tsvPath)) {
      throw new Error(`TSV が見つかりません: ${t.tsv}\n先に \`npm run deepl:build-glossary\` を実行してください。`);
    }
  }

  const idsPath = join(CACHE, "glossary-ids.json");
  const ids = existsSync(idsPath)
    ? JSON.parse(readFileSync(idsPath, "utf8"))
    : { glossaries: {} };
  ids.glossaries = ids.glossaries || {};

  const existing = DRY_RUN ? [] : await listGlossaries();

  for (const t of TARGETS) {
    const tsv = readFileSync(join(CACHE, t.tsv), "utf8").trim();
    const entryCount = tsv ? tsv.split("\n").length : 0;
    console.log(`[${t.key}] ${t.name}: ${entryCount} エントリ`);

    if (DRY_RUN) {
      console.log(`  (dry-run) 同名用語集を削除→再作成します`);
      continue;
    }

    // 同名の既存用語集を削除（重複登録の防止）
    for (const g of existing.filter((g) => g.name === t.name)) {
      await deleteGlossary(g.glossary_id);
      console.log(`  削除: 旧 ${g.glossary_id}`);
    }

    const created = await createGlossary({
      name: t.name,
      source_lang: t.source_lang,
      target_lang: t.target_lang,
      tsv,
    });
    console.log(`  作成: 新 ${created.glossary_id}（${created.entry_count} 件）`);

    ids.glossaries[t.key] = {
      name: t.name,
      glossary_id: created.glossary_id,
      source_lang: t.source_lang,
      target_lang: t.target_lang,
      entry_count: created.entry_count,
    };
  }

  if (!DRY_RUN) {
    ids.updatedAt = new Date().toISOString();
    ids.note =
      "DeepL 用語集 ID。tools/deepl/sync-glossary.mjs が更新時に上書きする。.cache 配下のため Git 管轄外（再生成可能）。";
    writeFileSync(idsPath, JSON.stringify(ids, null, 2), "utf8");
    console.log(`\nglossary-ids.json を更新しました: ${idsPath}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
