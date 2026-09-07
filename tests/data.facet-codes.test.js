/**
 * 相関図 URL 用の辞書 code（`$display.facet.codeFrom` が指す列。`Class_Code` / `Suit_Code` 等）の実データ不変条件
 *
 * 相関図の圧縮ロケータ（`r=NTS/N.DV`）は、段の値を辞書行の code へ置き換えて URL に載せる。
 * code は URL の識別子なので、次を壊すと共有済みの URL が別グループを指したり化けたりする。
 *
 * 1. **文字種**: 英数字と `.` だけ（`_` / `-` は後続機能の区切りに予約するため使わない。
 *    `~` は URLSearchParams が `%7E` へ変えるので使わない）
 * 2. **一意**: 同じスコープ（グローバル辞書 + 作品辞書を連結した `#List_*`）の中で、
 *    異なる値が同じ code を持たない（同じ値が複数辞書にあるのは可。先勝ちで同じ code なら問題ない）
 *
 * 未入力（列が無い行）は許容する。生値へフォールバックするだけで動作は変わらないため
 * （例: `Faction_Code` はまだ未入力）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import { collectFacets } from '../lib/graph/graph-facets.js';

const repoRoot = process.cwd();
const readJson = (p) => JSON.parse(readFileSync(path.resolve(repoRoot, p), 'utf-8'));

/** URL 識別子として許す文字種 */
const CODE_RE = /^[A-Za-z0-9.]+$/;

/**
 * 1 ディレクトリ分の辞書を `#List_*` へ束ねる（`sw-common.js` の `readDictionaryBundle()` と同じ規則）
 * @param {string} dir @returns {Object<string, Array<Object>>}
 */
function bundleDictionaries(dir) {
	const vars = {};
	const metaPath = path.resolve(repoRoot, dir, 'db_meta.json');
	if (!existsSync(metaPath)) return vars;
	const catalog = readJson(metaPath)?.Dictionaries || {};
	for (const [rawKey, info] of Object.entries(catalog)) {
		const name = rawKey.replace(/^#Dict_/, '');
		const file = path.resolve(repoRoot, dir, info?.dictFile || `dict_${name}.json`);
		if (!existsSync(file)) continue;
		let rows;
		try { rows = JSON.parse(readFileSync(file, 'utf-8')); } catch { continue; }
		if (!Array.isArray(rows)) continue;
		const listKey = info?.compatListKey || `#List_${name}`;
		(vars[listKey] ||= []).push(...rows.map(r => ({ ...r, __file: path.relative(repoRoot, file) })));
	}
	return vars;
}

describe('相関図 URL 用の辞書 code（$display.facet.codeFrom）', () => {
	const globalTypeDef = readJson('data/db_type.json');
	const workTypeDefs = {};
	for (const p of globSync('data/Works_*/DataBases/db_type.json', { cwd: repoRoot })) {
		const workDir = p.split(/[/\\]/)[1];
		workTypeDefs[`#Works_${workDir.replace('Works_', '')}`] = readJson(p);
	}
	const facets = collectFacets(globalTypeDef, workTypeDefs).filter(f => f.codeFrom && f.dict);
	const globalVars = bundleDictionaries('data/Dictionaries');
	const workDirs = globSync('data/Works_*/Dictionaries/db_meta.json', { cwd: repoRoot }).map(p => p.split(/[/\\]/)[1]);

	it('codeFrom を宣言した軸が少なくとも 1 つある（宣言が消えたらこのテストの前提が崩れる）', () => {
		expect(facets.map(f => `${f.key}:${f.codeFrom}`)).toContain('Class:Class_Code');
	});

	for (const facet of facets) {
		const listKey = `#List_${facet.dict}`;
		const valueKey = facet.dict; // 辞書行の値列（`Class` / `Suit` / `Faction`）

		for (const workDir of workDirs) {
			const rows = [...(globalVars[listKey] || []), ...(bundleDictionaries(`data/${workDir}/Dictionaries`)[listKey] || [])];
			if (rows.length === 0) continue;

			it(`${facet.key}（${facet.codeFrom}）: ${workDir} のスコープで文字種が英数字と "." だけ`, () => {
				const bad = rows
					.filter(r => r[facet.codeFrom] !== undefined && r[facet.codeFrom] !== null && r[facet.codeFrom] !== '')
					.filter(r => !CODE_RE.test(String(r[facet.codeFrom])))
					.map(r => `${r.__file}: ${r[valueKey]} = ${JSON.stringify(r[facet.codeFrom])}`);
				expect(bad, `_ / - などを含む code: ${bad.slice(0, 5).join(' / ')}`).toEqual([]);
			});

			it(`${facet.key}（${facet.codeFrom}）: ${workDir} のスコープで異なる値が同じ code を持たない`, () => {
				const byCode = new Map();
				for (const r of rows) {
					const code = r[facet.codeFrom];
					if (code === undefined || code === null || code === '') continue;
					if (!byCode.has(code)) byCode.set(code, new Set());
					byCode.get(code).add(String(r[valueKey]));
				}
				const dups = [...byCode].filter(([, values]) => values.size > 1).map(([code, values]) => `${code} → {${[...values].join(' | ')}}`);
				expect(dups, `code の衝突: ${dups.slice(0, 5).join(' / ')}`).toEqual([]);
			});
		}
	}
});
