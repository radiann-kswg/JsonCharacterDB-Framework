/**
 * [roleplay-sections.test.js] - tools/roleplay/sections.mjs の見出しアンカー方式マージ純関数テスト
 * @description
 *   splitSections（分解・コードフェンス無視）／mergeByHeadings（テンプレ由来節の上書き・手書き
 *   独自見出しの位置保全・冪等）／diffSections（added/updated/unchanged/removed）を合成入力で検証する。
 *   LLM・DOM・I/O は使わない。
 */
import { describe, it, expect } from 'vitest';
import { splitSections, mergeByHeadings, diffSections } from '../tools/roleplay/sections.mjs';

describe('splitSections', () => {
	it('前文と見出しでセクション分解する（レベルも取れる）', () => {
		const md = ['# 命令文', '', '本文', '', '## 役割', '', 'x', ''].join('\n');
		const { preamble, sections } = splitSections(md);
		expect(preamble).toBe('');
		expect(sections.map((s) => s.heading)).toEqual(['# 命令文', '## 役割']);
		expect(sections[0].level).toBe(1);
		expect(sections[1].level).toBe(2);
		expect(sections[0].body).toContain('本文');
	});

	it('最初の見出しより前のテキストは preamble になる', () => {
		const md = ['まえがき', '', '# 見出し', '', '本文'].join('\n');
		const { preamble, sections } = splitSections(md);
		expect(preamble).toBe('まえがき\n');
		expect(sections).toHaveLength(1);
	});

	it('コードフェンス内の # は見出しとみなさない', () => {
		const md = ['# H1', '', '~~~', '# not a heading', '~~~', '', '## H2', '', 'more'].join('\n');
		const { sections } = splitSections(md);
		expect(sections.map((s) => s.heading)).toEqual(['# H1', '## H2']);
		expect(sections[0].body).toContain('# not a heading');
	});
});

describe('mergeByHeadings', () => {
	const rendered = [
		'# 命令文', '', '本文A', '',
		'## 「X」の概要', '', '- 概要1', '',
		'## 「X」の口調', '', '- 口調1', '',
		'# 末尾', '', 'しめ', '',
	].join('\n');

	it('手書き独自見出しが無ければ rendered をそのまま返す（完全冪等）', () => {
		expect(mergeByHeadings(rendered, rendered)).toBe(rendered);
	});

	it('テンプレ由来節は DB 最新で上書きし、手書き独自見出しは元の位置に保全する', () => {
		const existing = [
			'# 命令文', '', '本文A旧', '',
			'## 強制ルーティン', '', '手書きルーティン', '',
			'## 「X」の概要', '', '- 概要旧', '',
			'## 「X」の性格', '', '手書き性格', '',
			'## 「X」の口調', '', '- 口調旧', '',
			'## 応答スタイル', '', '手書きスタイル', '',
			'# 末尾', '', 'しめ', '',
		].join('\n');
		const out = mergeByHeadings(existing, rendered);

		// テンプレ由来節は rendered 側本文へ（旧本文は消える）
		expect(out).toContain('本文A');
		expect(out).not.toContain('本文A旧');
		expect(out).toContain('- 概要1');
		expect(out).not.toContain('- 概要旧');
		expect(out).toContain('- 口調1');
		expect(out).not.toContain('- 口調旧');

		// 手書き独自見出しと本文は保全される
		expect(out).toContain('## 強制ルーティン');
		expect(out).toContain('手書きルーティン');
		expect(out).toContain('## 「X」の性格');
		expect(out).toContain('手書き性格');
		expect(out).toContain('## 応答スタイル');
		expect(out).toContain('手書きスタイル');

		// 位置: 強制ルーティンは命令文の後・概要の前、性格は概要の後・口調の前、応答スタイルは口調の後
		expect(out.indexOf('## 強制ルーティン')).toBeGreaterThan(out.indexOf('# 命令文'));
		expect(out.indexOf('## 強制ルーティン')).toBeLessThan(out.indexOf('## 「X」の概要'));
		expect(out.indexOf('## 「X」の性格')).toBeGreaterThan(out.indexOf('## 「X」の概要'));
		expect(out.indexOf('## 「X」の性格')).toBeLessThan(out.indexOf('## 「X」の口調'));
		expect(out.indexOf('## 応答スタイル')).toBeGreaterThan(out.indexOf('## 「X」の口調'));
		expect(out.indexOf('## 応答スタイル')).toBeLessThan(out.indexOf('# 末尾'));
	});

	it('再マージしても安定（冪等・foreign 節を二重化しない）', () => {
		const existing = [
			'# 命令文', '', 'A', '',
			'## メモ', '', '手書きメモ', '',
			'## 「X」の概要', '', '- 概要旧', '',
			'## 「X」の口調', '', '- 口調1', '',
			'# 末尾', '', 'しめ', '',
		].join('\n');
		const once = mergeByHeadings(existing, rendered);
		const twice = mergeByHeadings(once, rendered);
		expect(twice).toBe(once);
		expect((once.match(/## メモ/g) || []).length).toBe(1);
	});

	it('先頭（管理見出しより前）の手書き独自節も保全する', () => {
		const existing = ['## 前置き', '', 'まえがき手書き', '', '# 命令文', '', 'A旧'].join('\n');
		const r = ['# 命令文', '', 'A', ''].join('\n');
		const out = mergeByHeadings(existing, r);
		expect(out).toContain('## 前置き');
		expect(out).toContain('まえがき手書き');
		expect(out.indexOf('## 前置き')).toBeLessThan(out.indexOf('# 命令文'));
		expect(out).toContain('\nA');
		expect(out).not.toContain('A旧');
	});

	it('rendered にあり existing に無い節は挿入される（新規テンプレ節）', () => {
		const existing = ['# 命令文', '', 'A', ''].join('\n');
		const r = ['# 命令文', '', 'A', '', '## 新セクション', '', '新本文', ''].join('\n');
		const out = mergeByHeadings(existing, r);
		expect(out).toContain('## 新セクション');
		expect(out).toContain('新本文');
	});
});

describe('diffSections', () => {
	it('added/updated/unchanged/removed を判定する', () => {
		const existing = ['# A', '', '旧', '', '## B', '', '同じ', ''].join('\n');
		const merged = ['# A', '', '新', '', '## B', '', '同じ', '', '## C', '', '追加', ''].join('\n');
		const diff = diffSections(existing, merged);
		const byHeading = Object.fromEntries(diff.map((d) => [d.heading, d.status]));
		expect(byHeading['# A']).toBe('updated');
		expect(byHeading['## B']).toBe('unchanged');
		expect(byHeading['## C']).toBe('added');
	});

	it('existing のみに在った見出しは removed', () => {
		const existing = ['# A', '', 'x', '', '## 消える', '', 'y', ''].join('\n');
		const merged = ['# A', '', 'x', ''].join('\n');
		const diff = diffSections(existing, merged);
		expect(diff.find((d) => d.heading === '## 消える').status).toBe('removed');
	});
});

describe('CRLF 耐性（Windows ワークツリー）', () => {
	const lf = ['# 命令文', '', '本文A', '', '## 「X」の概要', '', '- 概要1', ''].join('\n');
	const crlf = lf.replace(/\n/g, '\r\n');

	it('改行コードだけが違う既存は unchanged 扱い（毎回 updated にしない）', () => {
		const diff = diffSections(crlf, lf);
		expect(diff.every((d) => d.status === 'unchanged')).toBe(true);
	});

	it('CRLF の既存へマージしても LF の生成物をそのまま返す', () => {
		expect(mergeByHeadings(crlf, lf)).toBe(lf);
	});

	it('CRLF でも見出し分解は LF と同じ結果になる', () => {
		expect(splitSections(crlf).sections.map((s) => s.heading))
			.toEqual(splitSections(lf).sections.map((s) => s.heading));
		expect(splitSections(crlf).sections[0].body).not.toContain('\r');
	});
});
