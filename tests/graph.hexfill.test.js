/**
 * graph-hexfill.js のテスト
 *
 * @description マス塗り割当の**不変条件**を固定する。
 * ここが崩れると「マスを数えれば人数が分かる」という読み方そのものが成立しなくなる。
 */
import { describe, it, expect } from 'vitest';
import {
	relaxSeeds,
	assignHexCells,
	markBoundaryCells,
	pickAnchorCells,
	buildGroupAdjacency,
	assignShadeSteps,
	buildHexFill
} from '../lib/graph/graph-hexfill.js';
import { hexNeighbors, hexPoint } from '../lib/graph/graph-layout.js';

const key = (c) => `${c.col},${c.row}`;

/** グループのセル集合が 6 近傍で連結しているか（BFS で確かめる） */
function isConnected(cells) {
	if (cells.length <= 1) return true;
	const set = new Set(cells.map(key));
	const seen = new Set([key(cells[0])]);
	const queue = [cells[0]];
	while (queue.length > 0) {
		const c = queue.pop();
		for (const nb of hexNeighbors(c.col, c.row)) {
			const k = key(nb);
			if (!set.has(k) || seen.has(k)) continue;
			seen.add(k);
			queue.push(nb);
		}
	}
	return seen.size === cells.length;
}

/** 実データの規模に近いグループ構成 */
const CASES = {
	// 作品別（9 作品）
	works: [140, 105, 66, 46, 35, 14, 12, 8, 7].map((size, i) => ({ key: `w${i}`, size })),
	// 陣営別（27 グループ・裾が長い）
	belonging: Array.from({ length: 27 }, (_, i) => ({ key: `b${i}`, size: Math.max(1, 40 - i * 2) })),
	// クラス別（12 + その他）
	cls: [50, 22, 18, 15, 12, 10, 9, 7, 6, 5, 4, 3, 63].map((size, i) => ({ key: `c${i}`, size })),
	// 極端: 1 グループだけ / 全部 1 人
	single: [{ key: 'only', size: 12 }],
	ones: Array.from({ length: 20 }, (_, i) => ({ key: `o${i}`, size: 1 }))
};

describe('relaxSeeds', () => {
	it('グループ数ぶんの種セルを返す', () => {
		expect(relaxSeeds([10, 5, 3])).toHaveLength(3);
		expect(relaxSeeds([])).toHaveLength(0);
	});

	it('1 グループなら原点', () => {
		expect(relaxSeeds([9])).toEqual([{ col: 0, row: 0 }]);
	});

	it('決定的（乱数を使わない）', () => {
		const sizes = [30, 20, 12, 8, 5, 3, 2, 1];
		expect(relaxSeeds(sizes)).toEqual(relaxSeeds(sizes));
	});
});

describe('assignHexCells の不変条件', () => {
	for (const [name, groups] of Object.entries(CASES)) {
		describe(name, () => {
			const { cells, byGroup } = assignHexCells(groups);

			it('セル数がメンバー数と一致する（穴で水増ししない）', () => {
				groups.forEach((g, i) => {
					expect(byGroup[i], `${g.key}`).toHaveLength(g.size);
				});
			});

			it('セルは高々 1 グループにしか属さない', () => {
				const all = byGroup.flat().map(key);
				expect(new Set(all).size).toBe(all.length);
				expect(cells.size).toBe(all.length);
			});

			it('各グループが 6 近傍で連結している', () => {
				groups.forEach((g, i) => {
					expect(isConnected(byGroup[i]), `${g.key} が分断されている`).toBe(true);
				});
			});

			it('決定的（同じ入力からは必ず同じ割当）', () => {
				const again = assignHexCells(groups);
				expect(again.byGroup.map(l => l.map(key))).toEqual(byGroup.map(l => l.map(key)));
			});

			it('囲い込みによる退避が起きていない', () => {
				// 種を詰めすぎるとグループが他グループに囲まれて成長先を失い、
				// 容量を満たすために塊から離れた小片へ退避することになる（実測で最大距離 9〜10）。
				// 間隔の段階的な再試行でこれをゼロにしている
				const r = assignHexCells(groups);
				expect(r.fragmented, JSON.stringify(r.fragmented)).toHaveLength(0);
			});
		});
	}

	it('囲い込みが起きたら種の間隔を広げて再試行する', () => {
		// 同じくらいの大きさのグループが多いほど囲い込みが起きやすい
		const tight = Array.from({ length: 27 }, (_, i) => ({ key: `t${i}`, size: Math.max(1, 40 - i * 2) }));
		const loose = [{ key: 'a', size: 20 }, { key: 'b', size: 5 }];

		const rTight = assignHexCells(tight);
		const rLoose = assignHexCells(loose);

		// 詰められる構成では最小の間隔がそのまま採用される
		expect(rLoose.separation).toBe(0.85);
		// 詰められない構成では緩む
		expect(rTight.separation).toBeGreaterThan(0.85);
		// どちらも退避ゼロ
		expect(rTight.fragmented).toHaveLength(0);
		expect(rLoose.fragmented).toHaveLength(0);
	});

	it('size 0 のグループはセルを持たない', () => {
		const { byGroup } = assignHexCells([{ key: 'a', size: 3 }, { key: 'b', size: 0 }, { key: 'c', size: 2 }]);
		expect(byGroup[0]).toHaveLength(3);
		expect(byGroup[1]).toHaveLength(0);
		expect(byGroup[2]).toHaveLength(2);
	});

	it('空の入力でも壊れない', () => {
		const r = assignHexCells([]);
		expect(r.byGroup).toEqual([]);
		expect(r.cells.size).toBe(0);
	});
});

describe('markBoundaryCells', () => {
	it('単独セルは境界', () => {
		const { cells, byGroup } = assignHexCells([{ key: 'a', size: 1 }]);
		expect(markBoundaryCells(cells, byGroup).size).toBe(1);
	});

	it('内部セルは境界にならない（十分大きい塊を作れば内部が生じる）', () => {
		const { cells, byGroup } = assignHexCells([{ key: 'a', size: 40 }]);
		const boundary = markBoundaryCells(cells, byGroup);
		expect(boundary.size).toBeLessThan(byGroup[0].length);
		expect(boundary.size).toBeGreaterThan(0);
	});

	it('境界セルは必ず「別グループか未割当」の隣を持つ', () => {
		const { cells, byGroup } = assignHexCells(CASES.cls);
		const boundary = markBoundaryCells(cells, byGroup);
		for (const k of boundary) {
			const [col, row] = k.split(',').map(Number);
			const mine = cells.get(k);
			const hasForeign = hexNeighbors(col, row).some(nb => cells.get(key(nb)) !== mine);
			expect(hasForeign, `${k} が境界なのに周囲が全部同じグループ`).toBe(true);
		}
	});
});

describe('pickAnchorCells', () => {
	it('アンカーは必ずそのグループのセルの 1 つ', () => {
		const { byGroup } = assignHexCells(CASES.belonging);
		const anchors = pickAnchorCells(byGroup, 38);
		anchors.forEach((a, i) => {
			expect(byGroup[i].some(c => c.col === a.col && c.row === a.row), `グループ ${i}`).toBe(true);
		});
	});

	it('セルが無いグループは null', () => {
		expect(pickAnchorCells([[]], 38)[0]).toBeNull();
	});

	it('x / y が hexPoint と一致する', () => {
		const { byGroup } = assignHexCells(CASES.works);
		const anchors = pickAnchorCells(byGroup, 38);
		for (const a of anchors) {
			const p = hexPoint(a.col, a.row, 38);
			expect(a.x).toBeCloseTo(p.x, 9);
			expect(a.y).toBeCloseTo(p.y, 9);
		}
	});
});

describe('assignShadeSteps', () => {
	it('隣接グループに同じ濃度段を割り当てない', () => {
		const { cells, byGroup } = assignHexCells(CASES.belonging);
		const adj = buildGroupAdjacency(cells, byGroup);
		const steps = assignShadeSteps(adj, 6);

		for (let g = 0; g < adj.length; g += 1) {
			for (const nb of adj[g]) {
				expect(steps[g], `グループ ${g} と ${nb} が同じ濃度段 ${steps[g]}`).not.toBe(steps[nb]);
			}
		}
	});

	it('段が足りなくても必ず値を返す（描画を止めない）', () => {
		// 完全グラフ 8 頂点に対して段が 2 つしか無い状況
		const adj = Array.from({ length: 8 }, (_, i) =>
			new Set(Array.from({ length: 8 }, (_, j) => j).filter(j => j !== i)));
		const steps = assignShadeSteps(adj, 2);
		expect(steps).toHaveLength(8);
		for (const s of steps) {
			expect(s).toBeGreaterThanOrEqual(0);
			expect(s).toBeLessThan(2);
		}
	});

	it('決定的', () => {
		const { cells, byGroup } = assignHexCells(CASES.cls);
		const adj = buildGroupAdjacency(cells, byGroup);
		expect(assignShadeSteps(adj, 6)).toEqual(assignShadeSteps(adj, 6));
	});

	it('空の入力でも壊れない', () => {
		expect(assignShadeSteps([], 6)).toEqual([]);
	});
});

describe('buildGroupAdjacency', () => {
	it('対称（a が b の隣なら b も a の隣）', () => {
		const { cells, byGroup } = assignHexCells(CASES.cls);
		const adj = buildGroupAdjacency(cells, byGroup);
		for (let g = 0; g < adj.length; g += 1) {
			for (const nb of adj[g]) expect(adj[nb].has(g), `${g} <-> ${nb}`).toBe(true);
		}
	});

	it('自分自身を隣接に含めない', () => {
		const { cells, byGroup } = assignHexCells(CASES.works);
		buildGroupAdjacency(cells, byGroup).forEach((s, g) => expect(s.has(g)).toBe(false));
	});
});

describe('buildHexFill', () => {
	it('総セル数がメンバー数の合計と一致する', () => {
		const total = CASES.belonging.reduce((s, g) => s + g.size, 0);
		expect(buildHexFill(CASES.belonging).totalCells).toBe(total);
	});

	it('面積がメンバー数に比例する（セル数の比 = 人数の比）', () => {
		const res = buildHexFill(CASES.works);
		res.groups.forEach((g, i) => {
			expect(g.cellCount).toBe(CASES.works[i].size);
		});
	});

	it('bounds が全セルを含む', () => {
		const res = buildHexFill(CASES.cls, { spacing: 38 });
		for (const c of res.cells) {
			expect(c.x).toBeGreaterThanOrEqual(res.bounds.minX);
			expect(c.x).toBeLessThanOrEqual(res.bounds.maxX);
			expect(c.y).toBeGreaterThanOrEqual(res.bounds.minY);
			expect(c.y).toBeLessThanOrEqual(res.bounds.maxY);
		}
		expect(res.bounds.width).toBeGreaterThan(0);
		expect(res.bounds.height).toBeGreaterThan(0);
	});

	it('各セルが濃度段と境界フラグを持つ', () => {
		const res = buildHexFill(CASES.cls, { shadeCount: 6 });
		for (const c of res.cells) {
			expect(c.shade).toBeGreaterThanOrEqual(0);
			expect(c.shade).toBeLessThan(6);
			expect(typeof c.boundary).toBe('boolean');
		}
	});

	it('空の入力でも壊れない', () => {
		const res = buildHexFill([]);
		expect(res.totalCells).toBe(0);
		expect(res.cells).toEqual([]);
		expect(res.bounds.width).toBeGreaterThanOrEqual(0);
	});

	it('478 セル / 27 グループで 60ms 以内に収まる', () => {
		// 全キャラを 1 段で塗る最悪ケース（実際はドリル階層が絞るのでここまで大きくならない）。
		// 間隔の再試行が最大 5 回走るぶんも含めた時間
		const groups = Array.from({ length: 27 }, (_, i) => ({ key: `g${i}`, size: i === 0 ? 100 : 14 }));
		const t0 = Date.now();
		const res = buildHexFill(groups);
		const ms = Date.now() - t0;
		expect(res.totalCells).toBe(groups.reduce((s, g) => s + g.size, 0));
		expect(ms, `${ms}ms かかった`).toBeLessThan(60);
	});
});
