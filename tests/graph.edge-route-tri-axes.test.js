/**
 * graph-edge-route.js の TRI_AXES（三角格子の軸集合）に関するスモークテスト
 *
 * @description 六角格子版の物理検証は既存の `tests/graph.edge-route.test.js` にある。
 * ここでは「軸配列を差し替え可能にしたリファクタが三角格子でも壊れていないか」だけを確認する。
 */
import { describe, it, expect } from 'vitest';
import {
	TRI_AXES, HEX_AXES, decomposeHexVector, hexBendPoints, routeEdges
} from '../lib/graph/graph-edge-route.js';
import { triPoint, triNeighbors } from '../lib/graph/graph-layout.js';

describe('TRI_AXES', () => {
	it('6本、すべて単位ベクトル、60°間隔で角度昇順', () => {
		expect(TRI_AXES).toHaveLength(6);
		for (const e of TRI_AXES) {
			expect(Math.hypot(e.x, e.y)).toBeCloseTo(1, 9);
		}
		const deg = TRI_AXES.map(e => (Math.atan2(e.y, e.x) * 180 / Math.PI + 360) % 360);
		for (let i = 0; i < deg.length; i += 1) {
			const next = deg[(i + 1) % deg.length];
			const diff = ((next - deg[i]) + 360) % 360;
			expect(diff).toBeCloseTo(60, 6);
		}
	});

	it('HEX_AXESを30°回転させた関係になっている', () => {
		const hexDeg = HEX_AXES.map(e => (Math.atan2(e.y, e.x) * 180 / Math.PI + 360) % 360).sort((a, b) => a - b);
		const triDeg = TRI_AXES.map(e => (Math.atan2(e.y, e.x) * 180 / Math.PI + 360) % 360).sort((a, b) => a - b);
		for (let i = 0; i < hexDeg.length; i += 1) {
			expect(((triDeg[i] - hexDeg[i]) + 360) % 360).toBeCloseTo(30, 6);
		}
	});
});

describe('decomposeHexVector + TRI_AXES（実際の三角格子近傍で検証）', () => {
	it('隣接セルへのベクトルは軸1本ぶんに一致し、折れ点は不要', () => {
		const spacing = 40;
		for (const [col, row] of [[0, 0], [2, 1], [-1, 3]]) {
			const from = triPoint(col, row, spacing);
			for (const nb of triNeighbors(col, row)) {
				const to = triPoint(nb.col, nb.row, spacing);
				const bends = hexBendPoints(from, to, TRI_AXES);
				expect(bends).toHaveLength(0);
			}
		}
	});

	it('2ホップ先（軸をまたぐ）は折れ点2つで元のベクトルに戻る', () => {
		const spacing = 40;
		const a = triPoint(0, 0, spacing);
		// 異なる2方向へ1歩ずつ進んだ先（軸をまたぐ組み合わせ）
		const nbs = triNeighbors(0, 0);
		const mid = triPoint(nbs[0].col, nbs[0].row, spacing);
		const nbs2 = triNeighbors(nbs[0].col, nbs[0].row);
		// mid から見て a と異なる隣を選ぶ
		const far = nbs2.find(c => !(c.col === 0 && c.row === 0));
		const b = triPoint(far.col, far.row, spacing);

		const { axis, a: ca, b: cb } = decomposeHexVector(b.x - a.x, b.y - a.y, TRI_AXES);
		const e0 = TRI_AXES[axis];
		const e1 = TRI_AXES[(axis + 1) % TRI_AXES.length];
		expect(e0.x * ca + e1.x * cb).toBeCloseTo(b.x - a.x, 6);
		expect(e0.y * ca + e1.y * cb).toBeCloseTo(b.y - a.y, 6);
	});
});

describe('routeEdges + TRI_AXES', () => {
	it('三角格子上のノード配置で例外なく経路を作れる', () => {
		const spacing = 40;
		const cells = [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 0, row: 1 }, { col: -1, row: 0 }];
		const positions = new Map(cells.map((c, i) => [`n${i}`, triPoint(c.col, c.row, spacing)]));
		const edges = [
			{ id: 'e1', source: 'n0', target: 'n1' },
			{ id: 'e2', source: 'n0', target: 'n2' },
			{ id: 'e3', source: 'n1', target: 'n3' }
		];
		const out = routeEdges(edges, positions, { axes: TRI_AXES });
		expect(out).toHaveLength(3);
		for (const r of out) {
			expect(['straight', 'round-segments']).toContain(r.curveStyle);
		}
	});
});
