/**
 * build-agent-instructions.mjs - エージェント指示書・スキルを正典 `AGENTS.md` から生成
 * @description
 *   本リポジトリのエージェント指示は `AGENTS.md` を唯一の正典（SSOT）とし、
 *   各ツール固有の入口ファイルはそこから生成する。
 *
 *   生成対象:
 *   1. `.github/copilot-instructions.md` … `tools/agent-instructions/copilot-header.md` + `AGENTS.md`
 *   2. `.claude/skills/**`               … `.agents/skills/**` の逐語ミラー
 *
 *   設計原則:
 *   - **正典を変換しない**。`AGENTS.md` の本文はバイト単位でそのまま連結する。ツール名の置換等は
 *     行わない（置換は情報を失いやすく、差分レビューを難しくするため）。読み替えはヘッダーで宣言する
 *   - **既定は dry-run**。`--write` を明示するまで書き込まない（tools/normalize-field-order.mjs の作法）
 *   - **削除は明示的に**。ミラー先にだけ存在する不要ファイルは既定では消さず報告のみ。
 *     消すなら `--prune` を明示する（生成物とはいえ破壊的操作を暗黙に行わない）
 *   - **改行は LF 固定**。`.gitattributes` が `* text=auto` のため、比較時は CRLF を正規化してから
 *     突き合わせる（Windows チェックアウトで `--check` が誤検知しないように）
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies node:fs, node:path, node:url
 *
 * @example
 *   node tools/build-agent-instructions.mjs           # dry-run（差分の要約のみ）
 *   node tools/build-agent-instructions.mjs --write   # 生成物を書き出す
 *   node tools/build-agent-instructions.mjs --check   # 差分があれば exit 1（CI/テスト用）
 *   node tools/build-agent-instructions.mjs --write --prune  # ミラーの余剰ファイルも削除
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 正典。ここだけが人手で編集される指示書本体 */
const CANON = 'AGENTS.md';
/** Copilot 生成物のヘッダー（Copilot 固有のメタ情報。正典に混ぜないため別ファイル） */
const COPILOT_HEADER = 'tools/agent-instructions/copilot-header.md';
/** Copilot 生成物 */
const COPILOT_OUT = '.github/copilot-instructions.md';
/** スキルの正典（エージェント共通の置き場）とそのミラー先 */
const SKILLS_SRC = '.agents/skills';
const SKILLS_OUT = '.claude/skills';

/**
 * 改行コードを LF へ正規化する
 * @description `.gitattributes` の `text=auto` により Windows では CRLF で展開され得るため、
 *   内容比較の前段で必ず通す。ファイル書き込み時も LF で統一する。
 * @param {string} text - 対象テキスト
 * @returns {string} LF 正規化済みテキスト
 */
function normalizeEol(text) {
	return text.replace(/\r\n/g, '\n');
}

/**
 * リポジトリ相対パスのファイルを読む（存在しなければ null）
 * @param {string} rel - リポジトリルートからの相対パス
 * @returns {string|null} LF 正規化済みの内容
 */
function readRel(rel) {
	const abs = path.join(repoRoot, rel);
	if (!fs.existsSync(abs)) return null;
	return normalizeEol(fs.readFileSync(abs, 'utf8'));
}

/**
 * ディレクトリ配下のファイルを相対パスで再帰列挙する
 * @param {string} relDir - リポジトリルートからの相対ディレクトリ
 * @returns {string[]} `relDir` を起点とした相対パスの配列（存在しなければ空配列）
 */
function listFiles(relDir) {
	const absDir = path.join(repoRoot, relDir);
	if (!fs.existsSync(absDir)) return [];
	/** @type {string[]} */
	const out = [];
	const walk = (dir, prefix) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
			else out.push(rel);
		}
	};
	walk(absDir, '');
	return out.sort();
}

/**
 * Copilot 向け指示書の期待内容を組み立てる
 * @description ヘッダー + 正典本文の単純連結。正典側は一切変換しない。
 * @returns {string} 生成されるべき `.github/copilot-instructions.md` の内容
 * @throws {Error} 正典またはヘッダーが見つからない場合
 */
function buildCopilotInstructions() {
	const canon = readRel(CANON);
	if (canon === null) throw new Error(`正典が見つかりません: ${CANON}`);
	const header = readRel(COPILOT_HEADER);
	if (header === null) throw new Error(`ヘッダーが見つかりません: ${COPILOT_HEADER}`);
	return `${header.trimEnd()}\n\n${canon.trimStart()}`;
}

/**
 * 生成計画を作る（書き込みはしない）
 * @description 生成対象ごとに「現状」「期待値」を突き合わせ、差分の有無を判定する。
 * @returns {{targets: Array<{rel: string, expected: string, current: string|null, changed: boolean}>, stale: string[]}}
 *   targets: 生成対象の一覧 / stale: ミラー先にのみ存在する余剰ファイル（相対パス）
 */
export function planAgentInstructions() {
	/** @type {Array<{rel: string, expected: string, current: string|null, changed: boolean}>} */
	const targets = [];

	// 1. Copilot 指示書
	const copilotExpected = buildCopilotInstructions();
	const copilotCurrent = readRel(COPILOT_OUT);
	targets.push({
		rel: COPILOT_OUT,
		expected: copilotExpected,
		current: copilotCurrent,
		changed: copilotCurrent !== copilotExpected
	});

	// 2. スキルのミラー
	const skillFiles = listFiles(SKILLS_SRC);
	for (const rel of skillFiles) {
		const expected = readRel(`${SKILLS_SRC}/${rel}`);
		if (expected === null) continue;
		const outRel = `${SKILLS_OUT}/${rel}`;
		const current = readRel(outRel);
		targets.push({ rel: outRel, expected, current, changed: current !== expected });
	}

	// ミラー先にだけ残っている余剰ファイル（正典側から消えたスキル等）
	const srcSet = new Set(skillFiles);
	const stale = listFiles(SKILLS_OUT)
		.filter((rel) => !srcSet.has(rel))
		.map((rel) => `${SKILLS_OUT}/${rel}`);

	return { targets, stale };
}

/**
 * 生成物を書き出す
 * @param {Array<{rel: string, expected: string, changed: boolean}>} targets - 生成対象
 * @returns {number} 実際に書き込んだファイル数
 */
function writeTargets(targets) {
	let written = 0;
	for (const t of targets) {
		if (!t.changed) continue;
		const abs = path.join(repoRoot, t.rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, t.expected, 'utf8');
		written += 1;
	}
	return written;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
// import されたときは副作用を起こさない（テストから planAgentInstructions() を使うため）
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
	const argv = process.argv.slice(2);
	const doWrite = argv.includes('--write');
	const doCheck = argv.includes('--check');
	const doPrune = argv.includes('--prune');

	const { targets, stale } = planAgentInstructions();
	const changed = targets.filter((t) => t.changed);

	for (const t of targets) {
		const mark = t.changed ? (t.current === null ? '+' : '~') : '=';
		console.log(`${mark} ${t.rel}`);
	}
	for (const rel of stale) {
		console.log(`? ${rel}（正典側に対応ファイルが無い余剰）`);
	}
	console.log(`\n合計: ${changed.length}/${targets.length} 件が要更新` + (stale.length ? ` / 余剰 ${stale.length} 件` : ''));

	if (doCheck) {
		if (changed.length || stale.length) {
			console.error(
				'\n--check: 生成物が正典と一致しません（npm run agents:build で再生成できます）'
			);
			process.exit(1);
		}
		console.log('--check: 生成物は正典と一致しています');
	} else if (doWrite) {
		const written = writeTargets(targets);
		let removed = 0;
		if (doPrune) {
			for (const rel of stale) {
				fs.rmSync(path.join(repoRoot, rel), { force: true });
				removed += 1;
			}
		}
		console.log(`\n書き込み: ${written} 件` + (doPrune ? ` / 削除: ${removed} 件` : ''));
		if (stale.length && !doPrune) {
			console.log('余剰ファイルは残しました（削除するには --prune を付けてください）');
		}
	} else {
		console.log('\n（dry-run。書き込むには --write を付けてください）');
	}
}
