/**
 * lib/graph/graph-layout.js（三角格子まわり）の単体テスト
 *
 * 守りたい性質（六角格子版 graph.layout.test.js と対になる）:
 * 1. **3 近傍がすべて等距離** — 正三角形タイルの重心間距離が `spacing` に揃う
 * 2. **格子点が重ならない** — `snapToTriLattice()` は 1 格子点 1 ノード
 * 3. **近傍探索・距離が `triNeighbors()` と整合する** — BFS ベースの実装同士がずれない
 */
import { describe, it, expect } from 'vitest';
import {
	isTriUp,
	triNeighbors,
	triPoint,
	nearestTriCell,
	triDistance,
	spiralTriCells,
	snapToTriLattice
} from '../lib/graph/graph-layout.js';

describe('isTriUp', () => {
	it('col+row が偶数なら上向き、奇数なら下向き', () => {
		expect(isTriUp(0, 0)).toBe(true);
		expect(isTriUp(1, 0)).toBe(false);
		expect(isTriUp(0, 1)).toBe(false);
		expect(isTriUp(1, 1)).toBe(true);
	});

	it('負の col/row でも正しく判定できる', () => {
		expect(isTriUp(-1, 0)).toBe(false);
		expect(isTriUp(-1, -1)).toBe(true);
		expect(isTriUp(-2, 0)).toBe(true);
	});
});

describe('triNeighbors', () => {
	it('常に3要素を返す', () => {
		for (const [col, row] of [[0, 0], [3, 2], [-2, 5], [7, -3]]) {
			expect(triNeighbors(col, row)).toHaveLength(3);
		}
	});

	it('同じ行の左右2方向は向きに関わらず col±1', () => {
		const up = triNeighbors(0, 0); // isTriUp(0,0) === true
		const down = triNeighbors(1, 0); // isTriUp(1,0) === false
		expect(up[0]).toEqual({ col: -1, row: 0 });
		expect(up[1]).toEqual({ col: 1, row: 0 });
		expect(down[0]).toEqual({ col: 0, row: 0 });
		expect(down[1]).toEqual({ col: 2, row: 0 });
	});

	it('縦方向は上向きなら row+1、下向きなら row-1', () => {
		expect(triNeighbors(0, 0)[2]).toEqual({ col: 0, row: 1 }); // 上向き
		expect(triNeighbors(1, 0)[2]).toEqual({ col: 1, row: -1 }); // 下向き
	});

	it('隣接関係は相互に成立する（a の隣に b があれば b の隣にも a がある）', () => {
		for (const [col, row] of [[0, 0], [3, 2], [-2, 5], [4, -3]]) {
			for (const nb of triNeighbors(col, row)) {
				const back = triNeighbors(nb.col, nb.row);
				expect(back).toContainEqual({ col, row });
			}
		}
	});
});

describe('triPoint', () => {
	it('3近傍の重心間距離がすべて spacing に等しい', () => {
		const spacing = 100;
		for (const [col, row] of [[0, 0], [1, 0], [2, 3], [-2, -1]]) {
			const c = triPoint(col, row, spacing);
			for (const nb of triNeighbors(col, row)) {
				const p = triPoint(nb.col, nb.row, spacing);
				expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(spacing, 6);
			}
		}
	});

	it('同じ col なら上向き/下向きで y だけが変わる', () => {
		const a = triPoint(0, 0, 100); // 上向き
		const b = triPoint(0, -1, 100); // 下向き（col+row=-1 は奇数）
		expect(a.x).toBeCloseTo(b.x, 9);
		expect(a.y).not.toBeCloseTo(b.y, 3);
	});
});

describe('nearestTriCell', () => {
	it('格子点そのものは同じセルへ戻る', () => {
		const spacing = 100;
		for (const [col, row] of [[0, 0], [3, 2], [-2, 5], [7, -3]]) {
			const p = triPoint(col, row, spacing);
			expect(nearestTriCell(p.x, p.y, spacing)).toEqual({ col, row });
		}
	});

	it('spacing が 0 以下なら原点セル', () => {
		expect(nearestTriCell(50, 50, 0)).toEqual({ col: 0, row: 0 });
	});
});

describe('triDistance', () => {
	it('自分自身への距離は 0', () => {
		expect(triDistance({ col: 2, row: 3 }, { col: 2, row: 3 })).toBe(0);
	});

	it('隣接セルへの距離は 1', () => {
		for (const nb of triNeighbors(0, 0)) {
			expect(triDistance({ col: 0, row: 0 }, nb)).toBe(1);
		}
	});

	it('対称である（a→b と b→a が同じ）', () => {
		const a = { col: 0, row: 0 };
		const b = { col: 3, row: 2 };
		expect(triDistance(a, b)).toBe(triDistance(b, a));
	});
});

describe('spiralTriCells', () => {
	it('最初に自分自身を返し、以降は重複が無い', () => {
		const seen = new Set();
		let i = 0;
		for (const c of spiralTriCells(0, 0, 3)) {
			const key = `${c.col},${c.row}`;
			expect(seen.has(key)).toBe(false);
			seen.add(key);
			if (i === 0) expect(c).toEqual({ col: 0, row: 0 });
			i += 1;
			if (i > 40) break; // 安全弁
		}
	});

	it('近い順（隣接セルが早期に出る）', () => {
		const cells = [...spiralTriCells(0, 0, 2)];
		const idxOfNeighbor = triNeighbors(0, 0).map(nb =>
			cells.findIndex(c => c.col === nb.col && c.row === nb.row));
		// 3近傍は必ず最初の4件（自分+3近傍）以内に出る
		for (const idx of idxOfNeighbor) expect(idx).toBeGreaterThan(0);
		for (const idx of idxOfNeighbor) expect(idx).toBeLessThanOrEqual(3);
	});
});

describe('snapToTriLattice', () => {
	it('格子点が重ならない（1格子点1ノード）', () => {
		const positions = Array.from({ length: 30 }, (_, i) => ({
			id: `n${i}`, x: (i % 6) * 20, y: Math.floor(i / 6) * 20
		}));
		const snapped = snapToTriLattice(positions, { spacing: 60 });
		const keys = snapped.map(p => `${p.col},${p.row}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('空配列を渡すと空配列を返す', () => {
		expect(snapToTriLattice([])).toEqual([]);
	});

	it('スナップ後の座標は triPoint の計算結果と一致する', () => {
		const positions = [{ id: 'a', x: 5, y: 5 }, { id: 'b', x: 100, y: 5 }];
		const snapped = snapToTriLattice(positions, { spacing: 80 });
		for (const p of snapped) {
			const ideal = triPoint(p.col, p.row, 80);
			expect(p.x).toBeCloseTo(ideal.x, 9);
			expect(p.y).toBeCloseTo(ideal.y, 9);
		}
	});
});
