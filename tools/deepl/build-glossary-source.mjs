/**
 * build-glossary-source.mjs - DeepL 用語集ソース生成スクリプト
 * @description data/Localization・data/References・data/Dictionaries の
 *   人間監修済み対訳（JP↔EN ペア）を走査して、DeepL 用語集として登録できる
 *   ソースファイル（TSV / JSON）を `.cache/deepl/` に生成する。
 *   創作本文（Summary / BodyBlocks 等の文章フィールド）は対象外とし、
 *   固有名詞・用語などの「短い対訳」だけを抽出する（自動生成はしない）。
 * @author 100BeautiesLab.
 * @version 1.2.0
 * @dependencies Node.js >= 18（標準モジュールのみ）
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** リポジトリルート（tools/deepl の 2 階層上）。pkg/ クライアントと同じ流儀で自解決する。 */
const REPO_ROOT = resolve(__dirname, "..", "..");
const DATA_DIR = join(REPO_ROOT, "data");
const OUT_DIR = join(REPO_ROOT, ".cache", "deepl");

/**
 * 用語集に取り込まない「文章系」ベースフィールド名（小文字比較）。
 * これらは創作本文・解説文であり、固有名詞対訳ではないため除外する。
 */
const EXCLUDE_BASE = new Set([
  "about",
  "summary",
  "bodyblocks",
  "transnote",
  "note",
  "desc",
  "description",
  "reading",
  "comments",
]);

/**
 * 丸括弧（全角/半角）とその中身をすべて除去した素形を返す。
 * 用語集における丸括弧は「読み仮名」「補足注釈」いずれも訳語決定には関与しない
 * 付随情報であり、キー・訳先の双方から落として素形を正とする。
 * 例: `猫又(後天的)` → `猫又` / `Nekomata / Warcat (Acquired)` → `Nekomata / Warcat`
 *     `海陸国(シーバイランド)諸島` → `海陸国諸島` / `Human (with Addon)` → `Human`
 * @param {string} s - JP / EN 表記
 * @returns {string} 括弧注釈を除去した素形
 */
const PAREN_NOTE = /[（(][^（()）]*[）)]/g;
function stripParenNotes(s) {
  if (typeof s !== "string") return s;
  return s.replace(PAREN_NOTE, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * その表記が持つ丸括弧が「すべて読み仮名グロス（中身がかなのみ）」かどうかを判定する。
 * 例: `算象(アリスマ)諸国` `シンフォニー.XVI(ゼクズィン)` → true
 *     `猫又(後天的)` `Human (with Addon)` `Royal of LotusNinea(n)` → false
 *
 * 読み仮名グロス付きの表記は DB 本文にその形のまま出現するため、素形に加えて
 * 原形もソースキーとして登録する（マッチ網羅の維持）。中身が注釈のものは
 * 「注釈込みの語」を用語集キーにしても実文にほぼ出現せず、かえって訳文から
 * 注釈が消える副作用を生むため、素形のみを登録する。
 * @param {string} s - 判定対象の表記
 * @returns {boolean} 括弧が1つ以上あり、そのすべてがかなグロスなら true
 */
const KANA_ONLY_PAREN = /^[（(][ぁ-んゔァ-ヴー・ー]+[）)]$/;
function hasReadingGlossOnly(s) {
  if (typeof s !== "string") return false;
  const notes = s.match(PAREN_NOTE);
  return Array.isArray(notes) && notes.length > 0 && notes.every((n) => KANA_ONLY_PAREN.test(n));
}

/** 用語として妥当な対訳かを判定する（短く・改行を含まない文字列ペアのみ採用）。 */
function isValidTerm(jp, en) {
  if (typeof jp !== "string" || typeof en !== "string") return false;
  const j = jp.trim();
  const e = en.trim();
  if (!j || !e) return false;
  if (j === e) return false; // 翻訳差が無い（記号のみ等）はスキップ
  if (j.includes("\n") || e.includes("\n")) return false;
  if (j.length > 60 || e.length > 60) return false;
  return true;
}

/**
 * 1 レコードから JP↔EN 対訳候補を抽出する。
 * - `X_EN` キー → EN=value、JP=record[X_JP]（無ければ record[X]）
 * - `X_JP` キー → JP=value、EN=record[X_EN]（無ければ record[X]）
 *
 * 明示された `_JP` / `_EN` を常に優先し、素キー（`X`）はそれが無い場合の
 * フォールバックとしてのみ使う。素キーの中身はファイルによって意味が異なり
 * （dict_Area の `Area` は和名だが、dict_RaceType の `RaceType` は英語 ID）、
 * 素キーを優先すると後者で「JP 欄に英語 ID が入った偽ペア」が生まれるため。
 * @param {Object} rec - 対訳レコード
 * @param {string} sourceFile - 出典ファイル名（プロベナンス用）
 * @returns {Array<{jp:string, en:string, base:string, source:string, transPolicy:?string, scope:?Array}>}
 */
function extractPairs(rec, sourceFile) {
  const out = [];
  const seen = new Set();
  const transPolicy = typeof rec.TransPolicy === "string" ? rec.TransPolicy : null;
  const scope = Array.isArray(rec.Scope) ? rec.Scope : null;

  const push = (jp, en, base) => {
    if (EXCLUDE_BASE.has(String(base).toLowerCase())) return;
    if (!isValidTerm(jp, en)) return;
    const key = `${jp} ${en}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ jp: jp.trim(), en: en.trim(), base, source: sourceFile, transPolicy, scope });
  };

  for (const [key, value] of Object.entries(rec)) {
    if (key.endsWith("_EN")) {
      const base = key.slice(0, -3);
      const jp = typeof rec[`${base}_JP`] === "string" ? rec[`${base}_JP`] : rec[base];
      push(jp, value, base);
    } else if (key.endsWith("_JP")) {
      const base = key.slice(0, -3);
      const en = typeof rec[`${base}_EN`] === "string" ? rec[`${base}_EN`] : rec[base];
      push(value, en, base);
    }
  }

  // Aliases（JP 異表記の配列）があれば JA→EN の別表記として取り込む
  if (Array.isArray(rec.Aliases) && (rec.Term_EN || rec.Name_EN)) {
    const en = rec.Term_EN || rec.Name_EN;
    for (const alias of rec.Aliases) {
      if (typeof alias === "string") push(alias, en, "Aliases");
    }
  }

  return out;
}

/** data 配下の対象ディレクトリから `prefix_*.json` を読み、全レコードを返す。 */
function collectFromDir(subdir, prefix) {
  const dir = join(DATA_DIR, subdir);
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".json"));
  } catch {
    console.warn(`[skip] ディレクトリ未検出: ${subdir}`);
    return [];
  }
  const pairs = [];
  for (const file of files) {
    const full = join(dir, file);
    let json;
    try {
      json = JSON.parse(readFileSync(full, "utf8"));
    } catch (err) {
      console.warn(`[warn] JSON 読込失敗: ${file} (${err.message})`);
      continue;
    }
    const records = Array.isArray(json) ? json : [];
    for (const rec of records) {
      if (rec && typeof rec === "object") {
        pairs.push(...extractPairs(rec, `${subdir}/${file}`));
      }
    }
  }
  return pairs;
}

/**
 * 値に「略号 / 全文」「表記A / 表記B」のような複数の言い回しが同居している場合、
 * スラッシュまたは改行で分割し、各断片を独立した用語候補として返す。JP / EN の
 * どちらにも適用する（例: `繁殖鼠/生体改造済みモルモット種族`）。
 *
 * スラッシュは空白の有無を問わず区切りとして検知するが、空白を伴わないスラッシュは
 * 「値全体に空白を含まない」場合に限って区切りとみなす。
 * `Enigma Division, Demotion/Retrograde Research Department` のような、フレーズの
 * 途中に現れる複合語のスラッシュを誤って割らないための安全弁（誤爆防止）。
 * 区切りが見つからなければ元の文字列を単一要素の配列として返す。
 * @param {string} value - 分割対象の値（JP / EN）
 * @returns {string[]} 分割済み断片（前後空白除去・空要素除去）
 */
function splitMultiForm(value) {
  if (typeof value !== "string") return [value];
  const spaced = value
    .split(/\s+\/\s+|\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (spaced.length > 1) return spaced;
  if (value.includes("/") && !/\s/.test(value)) {
    const bare = value
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    if (bare.length > 1) return bare;
  }
  return [value];
}

/**
 * 2つの EN 訳語が「単数形 / 複数形」だけの差かどうかを判定する。
 * 例: `Regiowner` / `Regiowners`。JP側（日本語）は文法上の数を持たないため、
 * この種の衝突は「どちらかが誤り」ではなく文脈依存の正しい使い分けであり、
 * 用語集側で強制的にどちらかへ固定すると逆の文脈で誤訳を生む。
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function isPluralPair(a, b) {
  return a === `${b}s` || b === `${a}s`;
}

/**
 * JA→EN マップを構築する。ソース JP・訳語 EN ともに括弧注釈を除去した素形を用い、
 * JP 側が併記形（`繁殖鼠/生体改造済みモルモット種族`）なら各断片をソースへ展開する。
 * 読みグロス付きの原形（`算象(アリスマ)諸国`）は DB 本文にその形で出るため、素形に
 * 加えてソースへ追加する（マッチ網羅の維持）。
 * JP / EN の双方が併記形で断片数が一致する場合（`猫又/化猫` ↔ `Nekomata / Warcat`）は
 * 位置対応でペアリングし、各断片対（`猫又→Nekomata` / `化猫→Warcat`）を独立エントリと
 * して登録する。断片数が一致しない場合は従来どおり EN 先頭断片（本文中で
 * 実際に多用される略号・優先表記）を JA→EN の訳語として採用する。
 * 衝突は「同一 JP ソースに異なる EN」が来た場合のみ記録するが、単数/複数形
 * だけの差は文法依存のため用語集へ登録せず、レビュー用に別記する。
 * @param {Array} pairs - 対訳候補
 * @returns {{map: Map, conflicts: Array}}
 */
function buildJaEnMap(pairs) {
  const map = new Map();
  const conflicts = [];
  const grammarExcluded = new Set();
  const add = (jp, en, source, base) => {
    if (!jp || !en || jp === en) return;
    if (grammarExcluded.has(jp)) return;
    if (!map.has(jp)) {
      map.set(jp, { target: en, source, base });
      return;
    }
    const existing = map.get(jp);
    if (existing.target === en) return;
    if (isPluralPair(existing.target, en)) {
      map.delete(jp);
      grammarExcluded.add(jp);
      conflicts.push({
        src: jp,
        grammar: true,
        candidates: [existing.target, en],
        file: source,
      });
      return;
    }
    conflicts.push({ src: jp, kept: existing.target, dropped: en, file: source });
  };
  for (const p of pairs) {
    const enSegs = splitMultiForm(stripParenNotes(p.en));
    const jpSegs = splitMultiForm(stripParenNotes(p.jp));
    const paired = jpSegs.length > 1 && jpSegs.length === enSegs.length;
    jpSegs.forEach((seg, i) => {
      add(seg, paired ? enSegs[i] : enSegs[0], p.source, p.base);
    });
    if (hasReadingGlossOnly(p.jp)) {
      const rawSegs = splitMultiForm(p.jp);
      const rawPaired = rawSegs.length > 1 && rawSegs.length === enSegs.length;
      rawSegs.forEach((seg, i) => {
        add(seg, rawPaired ? enSegs[i] : enSegs[0], `${p.source} (reading-gloss)`, p.base);
      });
    }
  }
  return { map, conflicts };
}

/**
 * EN→JA マップを構築する。ソース EN・訳先 JP ともに括弧注釈を除去した素形を採用する
 * （方針: 機械訳にフリガナ・注釈を混ぜない／注釈違いだけの語を別キーにしない）。
 * これにより「併記形 vs 素形」「注釈付き vs 素形」だけの差は衝突にならない。
 * EN / JP の双方が併記形で断片数が一致する場合は位置対応でペアリングし、各断片対
 * （`Nekomata→猫又` / `Warcat→化猫`）を独立エントリとして登録する。
 * 断片数が一致しない場合は訳先 JP の先頭断片を採用し、EN側の断片それぞれを別の
 * ソースキーとして登録する（略号・全文のどちらで出現しても同じ JP へ解決できる）。
 *
 * 「正式名（Term_JP）vs 通称（Aliases）」の衝突は、文章の性質（冗長な説明文
 * では通称・略称寄り、該当語自体を定義する文では正式名寄り）で使い分けるべき
 * ものであり、EN→JA の単一キーには機械的に固定できない。そのため登録を見送り
 * `registerDependent` 付きで別記する（訳出は人間が文脈判断する）。
 * それ以外（Aliases 由来同士、または非Aliases同士）で素形が食い違う場合だけを
 * 真の衝突として記録する。
 * @param {Array} pairs - 対訳候補
 * @returns {{map: Map, conflicts: Array}}
 */
function buildEnJaMap(pairs) {
  const map = new Map();
  const conflicts = [];
  const registerExcluded = new Set();
  const add = (en, jpTarget, source, isAlias) => {
    if (!en || !jpTarget || en === jpTarget) return;
    if (registerExcluded.has(en)) return;
    if (!map.has(en)) {
      map.set(en, { target: jpTarget, source, isAlias });
      return;
    }
    const existing = map.get(en);
    if (existing.target === jpTarget) return;
    if (existing.isAlias !== isAlias) {
      map.delete(en);
      registerExcluded.add(en);
      conflicts.push({
        src: en,
        registerDependent: true,
        candidates: [existing.target, jpTarget],
        file: source,
      });
      return;
    }
    conflicts.push({ src: en, kept: existing.target, dropped: jpTarget, file: source });
  };
  for (const p of pairs) {
    const jpSegs = splitMultiForm(stripParenNotes(p.jp));
    const enSegs = splitMultiForm(stripParenNotes(p.en));
    const paired = enSegs.length > 1 && enSegs.length === jpSegs.length;
    const isAlias = p.base === "Aliases";
    enSegs.forEach((seg, i) => {
      add(seg, paired ? jpSegs[i] : jpSegs[0], p.source, isAlias);
    });
  }
  return { map, conflicts };
}

/** TSV 文字列を生成（DeepL 用語集の TSV 入力形式: `source<TAB>target`）。 */
function toTsv(map) {
  return [...map.entries()].map(([src, v]) => `${src}\t${v.target}`).join("\n") + "\n";
}

function main() {
  const allPairs = [
    ...collectFromDir("Localization", "trans_"),
    ...collectFromDir("References", "ref_"),
    ...collectFromDir("Dictionaries", "dict_"),
  ];

  const jaEn = buildJaEnMap(allPairs);
  const enJa = buildEnJaMap(allPairs);

  mkdirSync(OUT_DIR, { recursive: true });

  writeFileSync(join(OUT_DIR, "glossary_ja-en.tsv"), toTsv(jaEn.map), "utf8");
  writeFileSync(join(OUT_DIR, "glossary_en-ja.tsv"), toTsv(enJa.map), "utf8");

  // 出典付きソース（レビュー・再現用）
  const source = {
    generatedAt: new Date().toISOString(),
    sourceDirs: ["Localization/trans_*", "References/ref_*", "Dictionaries/dict_*"],
    totalPairs: allPairs.length,
    jaEnUnique: jaEn.map.size,
    enJaUnique: enJa.map.size,
    // base（フィールド名。例: `Class` / `Term` / `RaceType`）は早見表の見出しグルーピングに使う
    entries: [...jaEn.map.entries()].map(([jp, v]) => ({
      jp,
      en: v.target,
      source: v.source,
      base: v.base ?? null,
    })),
  };
  writeFileSync(join(OUT_DIR, "glossary_source.json"), JSON.stringify(source, null, 2), "utf8");

  // 衝突ログ（人間レビュー用）
  const conflictLines = [
    "# DeepL 用語集 ソース衝突ログ",
    "",
    `生成: ${source.generatedAt}`,
    "",
    "> 同一 source に複数の訳語が存在したエントリ。先に出現した訳を採用（kept）。",
    "> 丸括弧の中身（読み仮名グロス・補足注釈）は訳語決定に関与しない付随情報として自動除去済みのため、`猫又` と `猫又(後天的)` のような差はここには出ません。",
    "> `略号 / 全文` のような併記形（スラッシュ区切り・改行区切り）も自動分割済みのため、双方向とも登録できていればここには出ません。JP/EN の断片数が一致する併記形（`猫又/化猫` ↔ `Nekomata / Warcat`）は位置対応でペアリングし、各断片対を独立エントリとして登録します。",
    "> 単数形/複数形だけの差（例: `Regiowner`/`Regiowners`）は JP側に数の情報が無く用語集で強制すると逆の文脈で誤訳になるため、`[文法差につき用語集登録なし]` として自動除外し、双方をレビュー用に併記します。採否は用途に応じて人間が個別に判断してください。",
    "> 正式名（Term_JP）vs 通称（Aliases）の差（例: `『第7の世界創造』`/`多様化社会`）は、冗長な説明文では通称・略称寄り、該当語自体を定義・説明する文では正式名寄りという文脈依存の使い分けがあり、EN→JA の単一キーには固定できないため `[文脈依存につき用語集登録なし]` として自動除外し、双方をレビュー用に併記します。訳出時は文章の性質に応じて人間が個別に判断してください。",
    "> ここに残るのは「素形でも異なる」真の衝突です。必要なら trans_*.json / ref_*.json / dict_*.json 側で正規化してください。",
    "",
    "## JA→EN",
    ...(jaEn.conflicts.length
      ? jaEn.conflicts.map((c) =>
          c.grammar
            ? `- \`${c.src}\` → [文法差につき用語集登録なし] 候補: \`${c.candidates[0]}\` / \`${c.candidates[1]}\` (${c.file})`
            : `- \`${c.src}\` → kept: \`${c.kept}\` / dropped: \`${c.dropped}\` (${c.file})`
        )
      : ["（衝突なし）"]),
    "",
    "## EN→JA",
    ...(enJa.conflicts.length
      ? enJa.conflicts.map((c) =>
          c.registerDependent
            ? `- \`${c.src}\` → [文脈依存につき用語集登録なし] 候補: \`${c.candidates[0]}\` / \`${c.candidates[1]}\` (${c.file})`
            : `- \`${c.src}\` → kept: \`${c.kept}\` / dropped: \`${c.dropped}\` (${c.file})`
        )
      : ["（衝突なし）"]),
    "",
  ];
  writeFileSync(join(OUT_DIR, "glossary-conflicts.md"), conflictLines.join("\n"), "utf8");

  console.log("=== DeepL 用語集ソース生成完了 ===");
  console.log(`抽出対訳ペア(延べ): ${allPairs.length}`);
  console.log(`JA→EN 一意エントリ: ${jaEn.map.size}（衝突 ${jaEn.conflicts.length}）`);
  console.log(`EN→JA 一意エントリ: ${enJa.map.size}（衝突 ${enJa.conflicts.length}）`);
  console.log(`出力先: ${OUT_DIR}`);
}

main();
