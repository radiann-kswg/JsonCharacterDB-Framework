/**
 * normalize-field-order.mjs - JSON DB のフィールドキー順を typedef($DefType) 順へ整列
 * @description
 *   `data/Works_<work>/DataBases/db_<db>.json`（レコード配列）のトップレベルキー順を、
 *   `TypeDefUtils.mergeDefTypes()`（$slot マーカー適用後）の正準順へ揃える。
 *
 *   設計原則:
 *   - **順序ポリシーを持たない**。並び順の正は `data/db_type.json($DefType)` の $slot 宣言であり、
 *     本ツールは mergeDefTypes() の出力を読むだけ。JS 側に field 名のハードコードは無い
 *   - **書式を壊さない**。`JSON.parse` → `JSON.stringify` の往復はしない（tools/extract-palette.mjs:1108
 *     と同じ理由。加えて prettier の objectWrap: "preserve" は一度展開されたインラインオブジェクトを
 *     畳み直さないため、往復するとキー順と無関係な差分が 2,716 行分発生する）。
 *     並べ替えは既存テキスト片の入れ替えのみで行い、値のテキストは 1 バイトも再生成しない
 *   - **既定は dry-run**。`--write` を明示するまで書き込まない（tools/patch-colorpalette.mjs の作法）
 *   - **fail-closed**。書き出し前にキー順以外が変化していないことを検証し、失敗したら書かない
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies node:fs, glob, ../lib/data-common.js (TypeDefUtils), ./extract-palette.mjs
 *
 * @example
 *   node tools/normalize-field-order.mjs                                  # 全 DB dry-run
 *   node tools/normalize-field-order.mjs --work=NumberTales --db=Primary  # 単体 dry-run
 *   node tools/normalize-field-order.mjs --work=NumberTales --db=Primary --write
 *   node tools/normalize-field-order.mjs --check                          # CI: 差分あれば exit 1
 *   node tools/normalize-field-order.mjs --report=.cache/order-report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';

import { scanTopLevelRecords, findValueEnd } from './extract-palette.mjs';
import '../lib/data-common.js';

const { TypeDefUtils } = globalThis;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * レコード配列を持つ DB ファイルだけを拾う。
 * `db_type.json` / `db_meta.json` / `db_temp.json` はレコード配列ではないため除外する。
 * NOTE: 否定先読みは拡張子まで含めること。`(?!type$)` は "type.json" に一致せず素通りする
 */
const RECORD_DB_RE = /^db_(?!type\.json$|meta\.json$|temp\.json$)[A-Za-z]+\.json$/;

const LANG_SUFFIX_RE = /_(JP|JPReading|EN)$/;

// ────────────────────────────────────────────────────────────────────────────
// 正準順（rank）の構築
// ────────────────────────────────────────────────────────────────────────────

/**
 * 正準 hashTag 列から「レコードキー → 順位」の写像を作る。
 *
 * typedef が base 名で宣言され、実データが言語サフィックス付きのケース
 * （例: グローバルの `FirstPersonCalling` ↔ 実データ `FirstPersonCalling_JP` / `_EN`）を吸収する。
 * サフィックス内の並びは docs/localization-en-rules.md:35「`field_EN` は対応する JP キーの直後」に従う。
 *
 * @param {string[]} tags - mergeDefTypes() 出力の hashTag 列
 * @returns {Map<string, number>} キー → 順位
 */
export function buildFieldRank(tags) {
    const rank = new Map();
    let i = 0;
    for (const tag of tags) {
        if (!tag || typeof tag !== 'string') continue;
        if (LANG_SUFFIX_RE.test(tag)) {
            // 既にサフィックス付きで宣言されている（Name_JP 等）
            if (!rank.has(tag)) rank.set(tag, i++);
            continue;
        }
        if (!rank.has(tag)) rank.set(tag, i);
        // base 宣言 → 実データの派生キーを直後へ束ねる
        for (const [suffix, offset] of [['_JP', 0.1], ['_JPReading', 0.2], ['_EN', 0.3]]) {
            const derived = `${tag}${suffix}`;
            if (!rank.has(derived)) rank.set(derived, i + offset);
        }
        i++;
    }
    return rank;
}

/** 未宣言キーを直前の宣言済みキーへアンカーする際の刻み幅（rank の base 展開 0.1 より小さく取る） */
const UNDECLARED_STEP = 0.01;

/**
 * レコードのキー列を正準順へ並べ替える（安定ソート）。
 *
 * 未宣言キー（$DefType に base でも無いもの）は**直前の宣言済みキーへアンカー**して
 * 元の位置に留める。`isTriple` / `Regioministration` のように「フラグ用にあえて宣言しない」
 * 運用のフィールドが、整列のたびに末尾へ流されるのを防ぐための規則。
 * 先頭が未宣言の場合はレコード先頭に留まる。
 *
 * @param {string[]} keys - レコードのキー列（宣言順）
 * @param {Map<string, number>} rank - buildFieldRank() の結果
 * @returns {string[]} 並べ替え後のキー列
 */
export function sortRecordKeys(keys, rank) {
    const rankOf = (key) => {
        if (rank.has(key)) return rank.get(key);
        const base = key.replace(LANG_SUFFIX_RE, '');
        return rank.has(base) ? rank.get(base) : Number.POSITIVE_INFINITY;
    };

    // 宣言済みキーは自分の順位、未宣言キーは「直前の宣言済みキーの順位 + 刻み」を使う
    let anchor = -1;
    let step = 0;
    const effective = keys.map((key, i) => {
        const r = rankOf(key);
        if (Number.isFinite(r)) {
            anchor = r;
            step = 0;
            return { key, i, r };
        }
        step += 1;
        return { key, i, r: anchor + step * UNDECLARED_STEP };
    });

    return effective
        .sort((a, b) => {
            if (a.r !== b.r) return a.r < b.r ? -1 : 1;
            return a.i - b.i;
        })
        .map((x) => x.key);
}

// ────────────────────────────────────────────────────────────────────────────
// テキスト走査（書式非破壊）
// ────────────────────────────────────────────────────────────────────────────

/**
 * `"` から始まる JSON 文字列の終端（閉じ引用符の次）を返す。
 * @param {string} text
 * @param {number} i - 開き `"` のオフセット
 * @returns {number} 閉じ `"` の次のオフセット
 * @throws {Error} 文字列が閉じていない場合
 */
function stringEnd(text, i) {
    let escaped = false;
    for (let j = i + 1; j < text.length; j++) {
        const c = text[j];
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === '"') return j + 1;
    }
    throw new Error('キー文字列が閉じていません');
}

/**
 * レコード span 内の「直下のメンバー」を宣言順で返す。
 *
 * `scanTopLevelRecords()` がレコードの範囲を出すのに対し、本関数はその内側の
 * `"Key": <value>` を 1 段だけ拾う。返す span はキーの `"` から値の最後の文字までで、
 * 前後の空白・カンマ・改行は含めない（それらは呼び出し側がセパレータとして扱う）。
 *
 * @param {string} text - ファイル全体
 * @param {number} s - レコードの `{` のオフセット
 * @param {number} e - レコードの `}` の次のオフセット
 * @returns {Array<{key: string, start: number, end: number}>} メンバー span（宣言順）
 * @throws {Error} 構造を解釈できない場合
 */
export function scanRecordMembers(text, s, e) {
    const out = [];
    let i = s + 1; // '{' の次
    for (;;) {
        while (i < e && /[\s,]/.test(text[i])) i++;
        if (i >= e || text[i] === '}') break;
        if (text[i] !== '"') throw new Error(`キーの開始が " ではありません @${i}`);

        const keyStart = i;
        const keyEnd = stringEnd(text, i);
        const key = JSON.parse(text.slice(keyStart, keyEnd));

        let colon = keyEnd;
        while (colon < e && /\s/.test(text[colon])) colon++;
        if (text[colon] !== ':') throw new Error(`":" が見つかりません @${colon}`);

        let valueEnd = findValueEnd(text, colon);
        // findValueEnd() のスカラー分岐は `,` / `}` / `]` まで走るため、
        // レコード末尾のスカラー値では改行とインデントを span に飲み込む。必ず落とす
        while (valueEnd > colon && /\s/.test(text[valueEnd - 1])) valueEnd--;

        out.push({ key, start: keyStart, end: valueEnd });
        i = valueEnd;
    }
    return out;
}

/**
 * レコード 1 件のテキストを、キー順だけ入れ替えて再構成する。
 *
 * メンバーのテキスト片はスライスをそのまま連結するため、値・インデント・
 * インライン/展開の別は一切変化しない。
 *
 * @param {string} text - ファイル全体
 * @param {[number, number]} span - レコードの [開始, 終了)
 * @param {Map<string, number>} rank - buildFieldRank() の結果
 * @returns {{ text: string, from: string[], to: string[] }|null} 変更不要なら null
 * @throws {Error} セパレータが不均一な場合（意図的な空行グルーピングを壊さないため）
 */
export function reorderRecordText(text, span, rank) {
    const [s, e] = span;
    const members = scanRecordMembers(text, s, e);
    if (members.length < 2) return null;

    const keys = members.map((m) => m.key);
    const sorted = sortRecordKeys(keys, rank);
    if (sorted.join(' ') === keys.join(' ')) return null;

    // セパレータ（メンバー間のテキスト）が均一でなければ、意図的な空行等の可能性がある
    const separators = [];
    for (let k = 0; k < members.length - 1; k++) {
        separators.push(text.slice(members[k].end, members[k + 1].start));
    }
    if (new Set(separators).size > 1) {
        throw new Error(`メンバー間のセパレータが不均一です（手動確認が必要） @${s}`);
    }
    const separator = separators[0];

    const byKey = new Map(members.map((m) => [m.key, m]));
    const head = text.slice(s, members[0].start);
    const tail = text.slice(members[members.length - 1].end, e);
    const body = sorted.map((k) => text.slice(byKey.get(k).start, byKey.get(k).end)).join(separator);

    return { text: head + body + tail, from: keys, to: sorted };
}

// ────────────────────────────────────────────────────────────────────────────
// 検証（fail-closed）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 再帰的にキーをソートした正規形。順序以外の差異があれば必ず不一致になる。
 * @param {any} v
 * @returns {any}
 */
function canonical(v) {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
        return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
    }
    return v;
}

/**
 * 「キー順以外は 1 ビットも変わっていない」ことを機械的に検証する。
 * @param {string} beforeText
 * @param {string} afterText
 * @throws {Error} 値・レコード数・キー集合のいずれかが変化した場合
 */
function assertOnlyOrderChanged(beforeText, afterText) {
    const before = JSON.parse(beforeText);
    const after = JSON.parse(afterText);
    if (!Array.isArray(before) || !Array.isArray(after)) throw new Error('トップレベルが配列ではありません');
    if (before.length !== after.length) throw new Error(`レコード数が変化しました: ${before.length} → ${after.length}`);
    for (let i = 0; i < before.length; i++) {
        const kb = Object.keys(before[i]).slice().sort();
        const ka = Object.keys(after[i]).slice().sort();
        if (JSON.stringify(kb) !== JSON.stringify(ka)) throw new Error(`レコード ${i} のキー集合が変化しました`);
    }
    if (JSON.stringify(canonical(after)) !== JSON.stringify(canonical(before))) {
        throw new Error('値が変化しました');
    }
}

// ────────────────────────────────────────────────────────────────────────────
// ファイル処理
// ────────────────────────────────────────────────────────────────────────────

const loadJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
const toPosix = (p) => p.replace(/\\/g, '/');

/**
 * 対象 DB ファイルを列挙する。
 * @param {{work?: string, db?: string}} filter
 * @returns {Array<{file: string, rel: string, work: string, db: string}>}
 */
function enumerateDbFiles(filter = {}) {
    const out = [];
    for (const abs of globSync(path.join(REPO_ROOT, 'data/Works_*/DataBases/db_*.json').replace(/\\/g, '/'))) {
        const rel = toPosix(path.relative(REPO_ROOT, abs));
        const base = rel.split('/').pop();
        if (!RECORD_DB_RE.test(base)) continue;
        const work = rel.split('/')[1].replace(/^Works_/, '');
        const db = base.replace(/^db_/, '').replace(/\.json$/, '');
        if (filter.work && filter.work !== work) continue;
        if (filter.db && filter.db !== db) continue;
        out.push({ file: abs, rel, work, db });
    }
    return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * 1 作品の正準順（rank）を構築する。
 * @param {string} work - 作品名（Works_ 接頭辞なし）
 * @returns {Map<string, number>}
 */
function rankForWork(work) {
    const globalType = loadJson('data/db_type.json');
    const globalMeta = loadJson('data/db_meta.json');
    const workType = loadJson(`data/Works_${work}/DataBases/db_type.json`);
    const detailLayout = globalMeta?.CreationWorks?.[`#Works_${work}`]?.$DetailLayout ?? null;
    const merged = TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout });
    return buildFieldRank(merged.map((e) => e.hashTag).filter(Boolean));
}

/**
 * 1 ファイルを整列する（書き込みはしない）。
 * @param {string} file - 絶対パス
 * @param {Map<string, number>} rank
 * @returns {{ text: string, changed: number, total: number, permutations: Map<string, {count: number, from: string[], to: string[]}> }}
 */
export function normalizeFileText(file, rank) {
    const original = fs.readFileSync(file, 'utf8');
    const spans = scanTopLevelRecords(original);
    const permutations = new Map();
    let text = original;
    let changed = 0;

    // オフセットのずれを避けるため末尾から先頭へ適用する（extract-palette.mjs と同じ手法）
    for (let i = spans.length - 1; i >= 0; i--) {
        const result = reorderRecordText(text, spans[i], rank);
        if (!result) continue;
        text = text.slice(0, spans[i][0]) + result.text + text.slice(spans[i][1]);
        changed++;
        const sig = `${result.from.join(' > ')}${result.to.join(' > ')}`;
        const hit = permutations.get(sig);
        if (hit) hit.count++;
        else permutations.set(sig, { count: 1, from: result.from, to: result.to });
    }

    if (changed > 0) assertOnlyOrderChanged(original, text);
    return { text, changed, total: spans.length, permutations };
}

// ────────────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────────────

/**
 * 置換パターンから「動いたキー」を要約する。
 * @param {string[]} from
 * @param {string[]} to
 * @returns {string[]} "Key: 4 -> 6" 形式
 */
function describeMoves(from, to) {
    const moves = [];
    for (const key of from) {
        const a = from.indexOf(key);
        const b = to.indexOf(key);
        if (a !== b) moves.push(`${key}: ${a} -> ${b}`);
    }
    return moves;
}

function parseArgs(argv) {
    const opts = { write: false, check: false, work: null, db: null, report: null };
    for (const arg of argv) {
        if (arg === '--write') opts.write = true;
        else if (arg === '--check') opts.check = true;
        else if (arg === '--dry-run') opts.write = false;
        else if (arg.startsWith('--work=')) opts.work = arg.slice(7);
        else if (arg.startsWith('--db=')) opts.db = arg.slice(5);
        else if (arg.startsWith('--report=')) opts.report = arg.slice(9);
        else throw new Error(`不明な引数: ${arg}`);
    }
    if (opts.write && opts.check) throw new Error('--write と --check は同時に指定できません');
    return opts;
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    const targets = enumerateDbFiles({ work: opts.work, db: opts.db });
    if (targets.length === 0) {
        console.error('対象ファイルがありません（--work / --db を確認してください）');
        process.exit(1);
    }

    const rankCache = new Map();
    const report = {};
    let totalChanged = 0;
    let totalRecords = 0;
    let failed = 0;

    for (const t of targets) {
        if (!rankCache.has(t.work)) rankCache.set(t.work, rankForWork(t.work));
        const rank = rankCache.get(t.work);

        let result;
        try {
            result = normalizeFileText(t.file, rank);
        } catch (err) {
            console.error(`✗ ${t.rel}\n    ${err.message}`);
            failed++;
            continue;
        }

        totalChanged += result.changed;
        totalRecords += result.total;

        const mark = result.changed === 0 ? '=' : '~';
        console.log(`${mark} ${t.rel.padEnd(58)} ${String(result.changed).padStart(4)}/${String(result.total).padStart(4)} レコードを整列`);

        if (result.changed > 0) {
            const patterns = [...result.permutations.values()].sort((a, b) => b.count - a.count);
            report[`${t.work}/${t.db}`] = {
                records: result.total,
                reordered: result.changed,
                permutations: patterns.map((p) => ({
                    count: p.count,
                    moved: describeMoves(p.from, p.to),
                    from: p.from.join(' > '),
                    to: p.to.join(' > '),
                })),
            };
            for (const p of patterns) {
                console.log(`    x${String(p.count).padStart(4)} | ${describeMoves(p.from, p.to).join(', ') || '(順序のみ)'}`);
            }
            if (opts.write) fs.writeFileSync(t.file, result.text);
        }
    }

    console.log(`\n合計: ${totalChanged}/${totalRecords} レコードを整列（${targets.length} ファイル）`);
    if (failed > 0) console.log(`エラー: ${failed} ファイル`);

    if (opts.report) {
        const dest = path.isAbsolute(opts.report) ? opts.report : path.join(REPO_ROOT, opts.report);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, JSON.stringify(report, null, 2) + '\n');
        console.log(`レポート: ${toPosix(path.relative(REPO_ROOT, dest))}`);
    }

    if (failed > 0) process.exit(1);
    if (opts.check && totalChanged > 0) {
        console.error('\n--check: キー順が正準順と一致しません（node tools/normalize-field-order.mjs --write で整列できます）');
        process.exit(1);
    }
    if (!opts.write && !opts.check && totalChanged > 0) {
        console.log('（dry-run。書き込むには --write を付けてください）');
    }
}

// 直接実行時のみ CLI を走らせる（テストから import しても main() は動かない）
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
    main();
}
