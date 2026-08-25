/**
 * graph-hexfill.js の格子アダプタ（TRI_LATTICE）を使った三角格子マス塗りのスモークテスト
 *
 * @description `buildHexFill()` 系の成長アルゴリズム本体は六角/三角で共通化した（`options.lattice`）。
 * ここでは「三角格子アダプタを渡しても同じ不変条件（セル数=メンバー数・重ならない・連結）が保たれるか」だけを確認する。
 * 詳細な物理（等距離・近傍対称性など）は `tests/graph.tri-layout.test.js` 側で検証済み。
 */
import { describe, it, expect } from 'vitest';
import {
	assignHexCells, buildHexFill, markBoundaryCells, buildGroupAdjacency, TRI_LATTICE
} from '../lib/graph/graph-hexfill.js';
import { triPoint, triNeighbors } from '../lib/graph/graph-layout.js';

const GROUPS = [
	{ key: 'a', label: 'A', size: 8 },
	{ key: 'b', label: 'B', size: 5 },
	{ key: 'c', label: 'C', size: 3 }
];

describe('assignHexCells + TRI_LATTICE', () => {
	it('セル数がメンバー数の合計と一致する', () => {
		const { cells } = assignHexCells(GROUPS, { lattice: TRI_LATTICE });
		expect(cells.size).toBe(8 + 5 + 3);
	});

	it('各グループのセル集合は triNeighbors で連結している', () => {
		const { byGroup } = assignHexCells(GROUPS, { lattice: TRI_LATTICE });
		for (const list of byGroup) {
			if (list.length <= 1) continue;
			const keys = new Set(list.map(c => `${c.col},${c.row}`));
			const seen = new Set([`${list[0].col},${list[0].row}`]);
			const queue = [list[0]];
			while (queue.length > 0) {
				const cur = queue.shift();
				for (const nb of triNeighbors(cur.col, cur.row)) {
					const k = `${nb.col},${nb.row}`;
					if (keys.has(k) && !seen.has(k)) { seen.add(k); queue.push(nb); }
				}
			}
			expect(seen.size).toBe(list.length);
		}
	});

	it('境界セル判定・隣接構築も TRI_LATTICE で例外なく動く', () => {
		const { cells, byGroup } = assignHexCells(GROUPS, { lattice: TRI_LATTICE });
		expect(() => markBoundaryCells(cells, byGroup, TRI_LATTICE)).not.toThrow();
		expect(() => buildGroupAdjacency(cells, byGroup, TRI_LATTICE)).not.toThrow();
	});
});

describe('buildHexFill + TRI_LATTICE', () => {
	it('セルの座標が triPoint の計算結果と一致する', () => {
		const res = buildHexFill(GROUPS, { lattice: TRI_LATTICE, spacing: 40 });
		expect(res.totalCells).toBe(16);
		for (const c of res.cells) {
			const p = triPoint(c.col, c.row, 40);
			expect(c.x).toBeCloseTo(p.x, 9);
			expect(c.y).toBeCloseTo(p.y, 9);
		}
	});

	it('bounds が空でない有限値になる', () => {
		const res = buildHexFill(GROUPS, { lattice: TRI_LATTICE, spacing: 40 });
		expect(Number.isFinite(res.bounds.width)).toBe(true);
		expect(Number.isFinite(res.bounds.height)).toBe(true);
		expect(res.bounds.width).toBeGreaterThan(0);
		expect(res.bounds.height).toBeGreaterThan(0);
	});
});
