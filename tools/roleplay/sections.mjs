/**
 * [sections.mjs] - ロールプレイプロンプトの見出しアンカー方式マージ（マーカー非依存）
 * @description
 *   生成 Markdown はマーカーを持たない。本モジュールは Markdown を「見出し（ATX）」で
 *   セクションへ分解し、テンプレ由来（管理）見出しは DB 最新へ差し替え、手書き独自見出しは
 *   元の位置のまま保全して織り込む純関数群を提供する（フェーズ2 のマージ更新／フェーズ3 の
 *   adopt で共用）。DOM・ファイル I/O には触れない。
 *
 *   - splitSections(md)            … 前文＋セクション列へ分解（コードフェンス内の `#` は無視）
 *   - mergeByHeadings(a, b)        … 既存 a に、生成 b の管理見出しを権威として合流
 *   - diffSections(a, b)           … セクション別 added/updated/unchanged/removed サマリ
 *
 *   入力は必ず LF へ正規化してから扱う。既存ファイルは Windows のワークツリーで CRLF に
 *   なるため、正規化しないと生成物（LF）との比較が改行コード差だけで全節 updated になる。
 *
 * @author 100BeautiesLab.
 * @version 1.1.0
 * @dependencies tools/roleplay/render.mjs（normalizeEol のみ）
 */
import { normalizeEol } from './render.mjs';

/**
 * Markdown を「前文（最初の見出しより前）＋セクション列」へ分解する。
 * セクションは ATX 見出し（`^#{1,6} 見出し`）を境界に切り出す。コードフェンス
 * （``` / ~~~）内の `#` は見出しとみなさない（コード例中の擬似見出し誤検知を防ぐ）。
 * @param {string} md
 * @returns {{ preamble: string, sections: Array<{heading:string, level:number, body:string, raw:string}> }}
 */
export function splitSections(md) {
	const text = normalizeEol(md);
	const lines = text.split('\n');
	const heads = [];
	let inFence = false;
	let fenceChar = '';
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fence = line.match(/^\s*(`{3,}|~{3,})/);
		if (fence) {
			const ch = fence[1][0];
			if (!inFence) {
				inFence = true;
				fenceChar = ch;
			} else if (ch === fenceChar) {
				inFence = false;
				fenceChar = '';
			}
			continue;
		}
		if (inFence) continue;
		const hm = line.match(/^(#{1,6})\s+\S/);
		if (hm) heads.push({ i, level: hm[1].length });
	}

	const firstHeadLine = heads.length ? heads[0].i : lines.length;
	const preamble = firstHeadLine > 0 ? lines.slice(0, firstHeadLine).join('\n') : '';

	const sections = [];
	for (let k = 0; k < heads.length; k++) {
		const start = heads[k].i;
		const end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
		const raw = lines.slice(start, end).join('\n');
		const heading = lines[start].replace(/\s+$/, '');
		const body = lines.slice(start + 1, end).join('\n');
		sections.push({ heading, level: heads[k].level, body, raw });
	}
	return { preamble, sections };
}

/**
 * ブロック列を「各ブロックの前後空行を除去 → 空行1つで連結 → 末尾改行1個」で整形連結する。
 * 手書きセクション本文の内部改行は保持し、ブロック間の区切りだけ正規化する。
 * @param {string[]} blocks
 * @returns {string}
 */
function joinBlocks(blocks) {
	const cleaned = blocks
		.map((b) => String(b == null ? '' : b).replace(/^\n+/, '').replace(/\n+$/, ''))
		.filter((b) => b.length > 0);
	return cleaned.length ? `${cleaned.join('\n\n')}\n` : '';
}

/**
 * 比較用の正規化（前後空行除去・行末空白除去）。体裁差だけの誤検知（更新扱い）を防ぐ。
 * @param {string} s
 * @returns {string}
 */
function normalizeBlock(s) {
	return normalizeEol(s)
		.replace(/[ \t]+$/gm, '')
		.replace(/^\n+/, '')
		.replace(/\n+$/, '');
}

/**
 * 既存 Markdown `existing` に、生成物 `rendered`（現行 DB の完全生成）の
 * テンプレ由来見出しを権威として合流する。
 * - テンプレ由来見出し（`rendered` に同一見出し文字列があるもの）… `rendered` 側本文で上書き
 * - 手書き独自見出し（`rendered` に無いもの）… 直前隣接の管理見出しをアンカーに元の位置へ保全
 * - `rendered` にあり `existing` に無い節 … 規約順（`rendered` の並び）の位置へ挿入
 * 手書き独自見出しが無い場合は `rendered` をそのまま返す（完全冪等）。
 * @param {string} existing
 * @param {string} rendered
 * @returns {string}
 */
export function mergeByHeadings(existing, rendered) {
	const E = splitSections(existing);
	const R = splitSections(rendered);
	const renderedHeadings = new Set(R.sections.map((s) => s.heading));
	const foreign = E.sections.filter((s) => !renderedHeadings.has(s.heading));
	// 手書き独自見出しが無ければ、生成物が完全な正（冪等・そのまま返す）
	if (foreign.length === 0) return normalizeEol(rendered);

	// 手書き独自セクションを「直前に現れた管理見出し」ごとのバケットへ振り分ける。
	// 先頭（管理見出しより前）に置かれた独自セクションは topForeign へ。
	const topForeign = [];
	const afterManaged = new Map();
	let lastManaged = null;
	for (const s of E.sections) {
		if (renderedHeadings.has(s.heading)) {
			lastManaged = s.heading;
		} else if (lastManaged === null) {
			topForeign.push(s);
		} else {
			if (!afterManaged.has(lastManaged)) afterManaged.set(lastManaged, []);
			afterManaged.get(lastManaged).push(s);
		}
	}

	const blocks = [];
	if (R.preamble && R.preamble.trim()) blocks.push(R.preamble);
	for (const s of topForeign) blocks.push(s.raw);
	for (const r of R.sections) {
		blocks.push(r.raw);
		const extra = afterManaged.get(r.heading);
		if (extra) for (const s of extra) blocks.push(s.raw);
	}
	return joinBlocks(blocks);
}

/**
 * セクション見出し単位で existing → merged の変化を要約する（dry-run 表示・レポート用）。
 * 並びは merged 側の順序（added/updated/unchanged）→ existing のみに在った見出し（removed）。
 * @param {string} existing
 * @param {string} merged
 * @returns {Array<{heading:string, status:('added'|'updated'|'unchanged'|'removed')}>}
 */
export function diffSections(existing, merged) {
	const E = splitSections(existing);
	const M = splitSections(merged);
	const eMap = new Map(E.sections.map((s) => [s.heading, s]));
	const mMap = new Map(M.sections.map((s) => [s.heading, s]));
	const out = [];
	for (const s of M.sections) {
		const e = eMap.get(s.heading);
		if (!e) out.push({ heading: s.heading, status: 'added' });
		else if (normalizeBlock(e.raw) !== normalizeBlock(s.raw)) out.push({ heading: s.heading, status: 'updated' });
		else out.push({ heading: s.heading, status: 'unchanged' });
	}
	for (const s of E.sections) {
		if (!mMap.has(s.heading)) out.push({ heading: s.heading, status: 'removed' });
	}
	return out;
}
