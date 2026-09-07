/**
 * agent-instructions.sync.test.js - エージェント指示書の SSOT 同期テスト
 * @description
 *   `AGENTS.md`（正典）から生成される指示書・スキルが、コミットされている生成物と
 *   一致していることを検証する。`npm run agents:build` の実行忘れを検出するのが目的。
 *
 *   本テストが落ちたら、正典を編集したあとに再生成していない可能性が高い:
 *     npm run agents:build
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies vitest, ../tools/build-agent-instructions.mjs
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planAgentInstructions } from '../tools/build-agent-instructions.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('エージェント指示書の SSOT 同期', () => {
	const { targets, stale } = planAgentInstructions();

	it('生成対象が 1 件以上ある（ツールの配線が壊れていない）', () => {
		expect(targets.length).toBeGreaterThan(0);
	});

	it.each(targets.map((t) => [t.rel, t]))(
		'%s は正典から再生成しても差分ゼロ',
		(_rel, target) => {
			expect(
				target.changed,
				`${target.rel} が正典と一致しません（npm run agents:build で再生成できます）`
			).toBe(false);
		}
	);

	it('ミラー先に余剰ファイルが無い', () => {
		expect(stale, `余剰: ${stale.join(', ')}（npm run agents:build -- --prune で削除できます）`).toEqual(
			[]
		);
	});

	it('正典が単一ファイルであることの明示（入口は正典を参照する）', () => {
		// CLAUDE.md は @AGENTS.md で正典を取り込む薄い入口である
		const claudeMd = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8');
		expect(claudeMd).toContain('@AGENTS.md');

		// Copilot 側は生成物である旨のバナーを必ず持つ
		const copilotMd = fs.readFileSync(path.join(repoRoot, '.github/copilot-instructions.md'), 'utf8');
		expect(copilotMd).toContain('自動生成物');
		expect(copilotMd).toContain('npm run agents:build');
	});
});
