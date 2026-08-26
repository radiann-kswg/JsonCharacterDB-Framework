// tools/sync-upstream.mjs のマニフェスト解釈（glob マッチャ）と .sync/upstream.json の健全性。
//
// ここが壊れると「同期対象の集合」が静かにズレて、上流の修正を取りこぼしたり
// 逆に取り込んではいけないファイル（創作データ等）を巻き込んだりします。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globToRegExp, makeMatcher } from '../tools/sync-upstream.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, '.sync', 'upstream.json'), 'utf-8'));

describe('globToRegExp', () => {
	it('`*` はディレクトリ区切りを跨がない', () => {
		const re = globToRegExp('tools/patch-*.mjs');
		expect(re.test('tools/patch-colorpalette.mjs')).toBe(true);
		expect(re.test('tools/patch-a/b.mjs')).toBe(false);
		expect(re.test('tools/build-agent-instructions.mjs')).toBe(false);
	});

	it('末尾 `**` は配下すべてに一致する', () => {
		const re = globToRegExp('lib/**');
		expect(re.test('lib/data-common.js')).toBe(true);
		expect(re.test('lib/graph/graph-layout.js')).toBe(true);
		expect(re.test('libs/other.js')).toBe(false);
	});

	it('`**/` は 0 段以上のディレクトリに一致する', () => {
		const re = globToRegExp('**/CNAME');
		expect(re.test('CNAME')).toBe(true);
		expect(re.test('pages/CNAME')).toBe(true);
		// 部分一致で誤爆しないこと（`.*CNAME` になっていると通ってしまう）
		expect(re.test('pagesCNAME')).toBe(false);
		expect(re.test('CNAME.bak')).toBe(false);
	});

	it('ドットなどの正規表現メタ文字はリテラル扱い', () => {
		const re = globToRegExp('vitest.config.js');
		expect(re.test('vitest.config.js')).toBe(true);
		expect(re.test('vitestXconfig.js')).toBe(false);
	});
});

describe('.sync/upstream.json', () => {
	const matches = makeMatcher(manifest);

	it('必須フィールドが揃っている', () => {
		for (const key of ['name', 'repo', 'branch', 'include', 'exclude']) {
			expect(manifest[key], `${key} が未設定`).toBeTruthy();
		}
		expect(manifest.repo).toMatch(/^https:\/\/github\.com\/.+\.git$/);
	});

	it('創作データ・リポジトリ固有ファイルを同期対象にしない', () => {
		const mustNotSync = [
			'data/Works_NumberTales/DataBases/db_Primary.json',
			'data/Dictionaries/dict_Faction.json',
			'AGENTS.md',
			'CLAUDE.md',
			'README.md',
			'CHANGELOG.md',
			'package.json',
			'package-lock.json',
			'index.html',
			'CNAME',
			'.github/workflows/pages.yml',
			'.github/dependabot.yml',
			'.github/copilot-instructions.md',
			'.claude/skills/localize-en-draft/SKILL.md',
			'.agents/roleplay/ROLEPLAY.md',
			'.sync/upstream.json',
		];
		for (const p of mustNotSync) {
			expect(matches(p), `${p} が同期対象に入っている`).toBe(false);
		}
	});

	it('フレームワーク本体は同期対象に入る', () => {
		const mustSync = ['lib/data-common.js', 'pages/characters.js', 'tools/normalize-field-order.mjs'];
		for (const p of mustSync) {
			expect(matches(p), `${p} が同期対象から漏れている`).toBe(true);
		}
	});

	it('exclude したツールのテストも exclude されている（npm test が壊れるため）', () => {
		// 対になっていない除外はドリフトの温床になるので、対応表で固定する。
		const pairs = [
			['tools/build-calendar-ics.mjs', 'tests/calendar.ics.test.js'],
			['tools/sync-calendar-gcal.mjs', 'tests/calendar.gcal-sync.test.js'],
			['tools/inject-conversation-patterns.mjs', 'tests/conversation-pattern.test.js'],
			['tools/patch-colorpalette.mjs', 'tests/patch-colorpalette.test.js'],
		];
		for (const [tool, test] of pairs) {
			expect(matches(tool), `${tool} が exclude されていない`).toBe(false);
			expect(matches(test), `${tool} を除外しているのに ${test} が残っている`).toBe(false);
		}
	});
});
