/**
 * graph-crossing.js が三角格子由来の座標でも変更なしに動くことを確認するスモークテスト
 *
 * @description 詳細な交差削減アルゴリズムそのものの検証は既存の `tests/graph.crossing.test.js` にある。
 * ここでは「六角格子専用ではなく座標のみを見る純粋な組み合わせ最適化である」という
 * `graph-crossing.js` 冒頭ドキュメントの主張を、実際に三角格子座標（`triPoint`）で裏付けるだけに留める。
 */
import { describe, it, expect } from 'vitest';
import { countCrossings, reduceCrossings } from '../lib/graph/graph-crossing.js';
import { triPoint } from '../lib/graph/graph-layout.js';

describe('graph-crossing.js + 三角格子座標', () => {
	it('triPoint() 由来の座標でも countCrossings が例外なく数えられる', () => {
		const spacing = 40;
		const cells = [
			[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]
		];
		const posById = new Map(cells.map((c, i) => [`n${i}`, triPoint(c[0], c[1], spacing)]));
		const edges = [
			{ source: 'n0', target: 'n1' },
			{ source: 'n0', target: 'n2' },
			{ source: 'n1', target: 'n3' },
			{ source: 'n2', target: 'n4' }
		];
		expect(() => countCrossings(posById, edges)).not.toThrow();
		expect(countCrossings(posById, edges)).toBeGreaterThanOrEqual(0);
	});

	it('triPoint() 由来の座標を渡しても reduceCrossings は交差を増やさない', () => {
		const spacing = 40;
		// XX字状に交差させたペアを含む配置（三角格子の格子点上）
		const cells = [
			[0, 0], [2, 0], [0, 2], [2, 2], [1, 1]
		];
		const positions = cells.map((c, i) => ({ id: `n${i}`, ...triPoint(c[0], c[1], spacing) }));
		const edges = [
			{ source: 'n0', target: 'n3' },
			{ source: 'n1', target: 'n2' },
			{ source: 'n4', target: 'n0' },
			{ source: 'n4', target: 'n1' }
		];
		const before = countCrossings(new Map(positions.map(p => [p.id, p])), edges);
		const result = reduceCrossings(positions, edges);
		expect(result.after).toBeLessThanOrEqual(before);
		// 入れ替え後も座標は元の格子点集合のまま（充填形が変わっていない）
		const beforeSet = new Set(positions.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
		for (const p of result.positions) {
			expect(beforeSet.has(`${p.x.toFixed(3)},${p.y.toFixed(3)}`)).toBe(true);
		}
	});
});
