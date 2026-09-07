/**
 * lib/graph/graph-layout.js（六角格子へのスナップ）の単体テスト
 *
 * 守りたい性質:
 * 1. **格子点が重ならない** — 1 格子点 1 ノード
 * 2. **相対位置を壊さない** — 力学レイアウトの近傍関係がスナップ後も概ね保たれる
 * 3. **画面に合わせて縮めない** — 収まらないときは fit せずパン/ズームに委ねる
 */
import { describe, it, expect } from 'vitest';
import {
	hexPoint,
	nearestCell,
	snapToHexLattice,
	resolveSpacing,
	boundsOf,
	shouldFitToViewport
} from '../lib/graph/graph-layout.js';

describe('hexPoint', () => {
	it('偶数行はずらさない', () => {
		expect(hexPoint(0, 0, 100)).toEqual({ x: 0, y: 0 });
		expect(hexPoint(2, 0, 100)).toEqual({ x: 200, y: 0 });
	});

	it('奇数行は半セルずらす（ハニカム配置）', () => {
		const p = hexPoint(0, 1, 100);
		expect(p.x).toBe(50);
		expect(p.y).toBeCloseTo(100 * Math.sqrt(3) / 2);
	});

	it('負のインデックスも扱える', () => {
		expect(hexPoint(-1, 0, 100).x).toBe(-100);
		expect(hexPoint(0, -1, 100).x).toBe(50); // 行の偶奇は絶対値で見る
	});

	it('隣接 6 方向の距離が概ね等しい', () => {
		const c = hexPoint(0, 0, 100);
		const neighbours = [
			hexPoint(1, 0, 100), hexPoint(-1, 0, 100),
			hexPoint(0, 1, 100), hexPoint(-1, 1, 100),
			hexPoint(0, -1, 100), hexPoint(-1, -1, 100)
		];
		for (const n of neighbours) {
			expect(Math.hypot(n.x - c.x, n.y - c.y)).toBeCloseTo(100, 0);
		}
	});
});

describe('nearestCell', () => {
	it('格子点そのものは同じセルへ戻る', () => {
		for (const [col, row] of [[0, 0], [3, 2], [-2, 5], [7, -3]]) {
			const p = hexPoint(col, row, 100);
			expect(nearestCell(p.x, p.y, 100)).toEqual({ col, row });
		}
	});

	it('spacing が 0 以下なら原点セル', () => {
		expect(nearestCell(50, 50, 0)).toEqual({ col: 0, row: 0 });
	});
});

describe('snapToHexLattice', () => {
	it('すべてのノードが異なる格子点に置かれる', () => {
		const positions = Array.from({ length: 60 }, (_, i) => ({
			id: `n${i}`,
			x: Math.cos(i) * 120,
			y: Math.sin(i) * 120
		}));
		const snapped = snapToHexLattice(positions, { spacing: 100 });
		expect(snapped).toHaveLength(60);
		const cells = snapped.map(p => `${p.col},${p.row}`);
		expect(new Set(cells).size).toBe(60);
	});

	it('同じ座標に重なった入力も別々の格子点へ散る', () => {
		const positions = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, x: 0, y: 0 }));
		const snapped = snapToHexLattice(positions, { spacing: 100 });
		expect(new Set(snapped.map(p => `${p.x},${p.y}`)).size).toBe(12);
	});

	it('出力座標が格子点に乗っている', () => {
		const snapped = snapToHexLattice(
			[{ id: 'a', x: 13, y: 7 }, { id: 'b', x: 205, y: 190 }],
			{ spacing: 100 }
		);
		for (const p of snapped) {
			const expected = hexPoint(p.col, p.row, 100);
			expect(p.x).toBeCloseTo(expected.x);
			expect(p.y).toBeCloseTo(expected.y);
		}
	});

	it('相対位置が概ね保たれる（遠いノードはスナップ後も遠い）', () => {
		const positions = [
			{ id: 'left', x: -500, y: 0 },
			{ id: 'mid', x: 0, y: 0 },
			{ id: 'right', x: 500, y: 0 }
		];
		const map = new Map(snapToHexLattice(positions, { spacing: 100 }).map(p => [p.id, p]));
		expect(map.get('left').x).toBeLessThan(map.get('mid').x);
		expect(map.get('mid').x).toBeLessThan(map.get('right').x);
	});

	it('空入力・不正入力でも落ちない', () => {
		expect(snapToHexLattice([])).toEqual([]);
		expect(snapToHexLattice(null)).toEqual([]);
		expect(snapToHexLattice([{ x: 1, y: 1 }])).toEqual([]); // id が無いものは捨てる
	});
});

describe('resolveSpacing', () => {
	it('ノードサイズ＋余白で決まる（画面サイズに依存しない）', () => {
		expect(resolveSpacing({ nodeSize: 46, gap: 28 })).toBe(74);
	});

	it('ラベル幅の方が広ければそちらを使う', () => {
		expect(resolveSpacing({ nodeSize: 46, labelWidth: 120, gap: 20 })).toBe(140);
	});

	it('既定値がある', () => {
		expect(resolveSpacing()).toBeGreaterThan(0);
	});
});

describe('boundsOf', () => {
	it('外接矩形と余白を返す', () => {
		const b = boundsOf([{ x: 0, y: 0 }, { x: 100, y: 200 }], 10);
		expect(b).toEqual({ minX: -10, minY: -10, maxX: 110, maxY: 210, width: 120, height: 220 });
	});

	it('空なら 0', () => {
		expect(boundsOf([]).width).toBe(0);
	});
});

describe('shouldFitToViewport', () => {
	it('十分収まるなら fit する', () => {
		const r = shouldFitToViewport({ width: 500, height: 400 }, { width: 1000, height: 800 });
		expect(r.fits).toBe(true);
		expect(r.zoom).toBeCloseTo(2);
	});

	it('縮めすぎになるなら fit しない（ノードが潰れるため）', () => {
		const r = shouldFitToViewport({ width: 8000, height: 6000 }, { width: 1000, height: 800 });
		expect(r.fits).toBe(false);
		expect(r.zoom).toBeLessThan(0.45);
	});

	it('しきい値を上書きできる', () => {
		expect(shouldFitToViewport({ width: 4000, height: 3000 }, { width: 1000, height: 800 }, 0.2).fits).toBe(true);
	});

	it('サイズ不明なら fit 扱い', () => {
		expect(shouldFitToViewport(null, null).fits).toBe(true);
	});
});
