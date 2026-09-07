/**
 * graph-crossing.js のテスト
 *
 * @description 接続線の交差を減らす局所探索の不変条件を固定する。
 * 「交差が増えないこと」「格子の占有セルが変わらないこと」「決定的であること」が要。
 */
import { describe, it, expect } from 'vitest';
import { segmentsCross, countCrossings, reduceCrossings, totalBendPenalty } from '../lib/graph/graph-crossing.js';
import { hexPoint, hexNeighbors, hexDistance, snapToHexLattice } from '../lib/graph/graph-layout.js';

const P = (x, y) => ({ x, y });

describe('segmentsCross', () => {
	it('普通に交差する 2 本を検出する', () => {
		expect(segmentsCross(P(0, 0), P(10, 10), P(0, 10), P(10, 0))).toBe(true);
	});

	it('交差しない 2 本は false', () => {
		expect(segmentsCross(P(0, 0), P(10, 0), P(0, 5), P(10, 5))).toBe(false);
	});

	it('端点を共有する 2 本は交差とみなさない（分岐であって交差ではない）', () => {
		// 同じノードから出る 2 本を数えてしまうと、減らしようのない交差が常に計上される
		expect(segmentsCross(P(0, 0), P(10, 10), P(0, 0), P(10, -10))).toBe(false);
		expect(segmentsCross(P(0, 0), P(10, 10), P(10, 10), P(20, 0))).toBe(false);
	});

	it('T 字（端点が相手の内部に乗る）は交差として扱う', () => {
		expect(segmentsCross(P(0, 0), P(10, 0), P(5, 0), P(5, 10))).toBe(true);
	});

	it('一直線上で重なる 2 本は交差として扱う', () => {
		expect(segmentsCross(P(0, 0), P(10, 0), P(4, 0), P(14, 0))).toBe(true);
	});

	it('延長線上で交わるだけの 2 本は false', () => {
		expect(segmentsCross(P(0, 0), P(1, 1), P(5, 5), P(6, 6))).toBe(false);
	});
});

describe('countCrossings', () => {
	it('X 字に組んだ 2 辺で 1 を返す', () => {
		const pos = new Map([['a', P(0, 0)], ['b', P(10, 10)], ['c', P(0, 10)], ['d', P(10, 0)]]);
		expect(countCrossings(pos, [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }])).toBe(1);
	});

	it('座標が無いノードを含む辺は数えない', () => {
		const pos = new Map([['a', P(0, 0)], ['b', P(10, 10)]]);
		expect(countCrossings(pos, [{ source: 'a', target: 'b' }, { source: 'x', target: 'y' }])).toBe(0);
	});

	it('自己ループは数えない', () => {
		const pos = new Map([['a', P(0, 0)], ['b', P(10, 10)]]);
		expect(countCrossings(pos, [{ source: 'a', target: 'a' }, { source: 'a', target: 'b' }])).toBe(0);
	});
});

describe('totalBendPenalty', () => {
	it('一直線に並ぶ次数2ノードは 0（曲がりなし）', () => {
		// a-b-c が一直線（b の 2 本が正反対を向く）
		const pos = new Map([['a', P(0, 0)], ['b', P(10, 0)], ['c', P(20, 0)]]);
		const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];
		expect(totalBendPenalty(pos, edges)).toBeCloseTo(0, 9);
	});

	it('直角に折れる次数2ノードは 1（一直線と完全折り返しの中間）', () => {
		const pos = new Map([['a', P(0, 0)], ['b', P(10, 0)], ['c', P(10, 10)]]);
		const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];
		expect(totalBendPenalty(pos, edges)).toBeCloseTo(1, 9);
	});

	it('完全に折り返す（行って戻る）次数2ノードは 2（最悪値）', () => {
		const pos = new Map([['a', P(0, 0)], ['b', P(10, 0)], ['c', P(0, 0.0000001)]]);
		// c をほぼ a と同じ位置に置き、b から見て両隣がほぼ同じ向き（完全な折り返し）になるようにする
		const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];
		expect(totalBendPenalty(pos, edges)).toBeGreaterThan(1.9);
	});

	it('次数 2 以外（分岐・行き止まり）のノードは対象外', () => {
		// b は次数 3（分岐駅）なので曲がりの評価から除外される
		const pos = new Map([['a', P(0, 0)], ['b', P(10, 0)], ['c', P(20, 0)], ['d', P(10, 10)]]);
		const edges = [
			{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'b', target: 'd' }
		];
		expect(totalBendPenalty(pos, edges)).toBe(0);
	});

	it('複数の次数2ノードの曲がりを合算する', () => {
		// a-b-c（直角）と d-e-f（一直線）を両方含む
		const pos = new Map([
			['a', P(0, 0)], ['b', P(10, 0)], ['c', P(10, 10)],
			['d', P(0, 100)], ['e', P(10, 100)], ['f', P(20, 100)]
		]);
		const edges = [
			{ source: 'a', target: 'b' }, { source: 'b', target: 'c' },
			{ source: 'd', target: 'e' }, { source: 'e', target: 'f' }
		];
		expect(totalBendPenalty(pos, edges)).toBeCloseTo(1, 9); // 直角(1) + 一直線(0)
	});
});

describe('reduceCrossings', () => {
	it('交差する 4 ノードの配置を入れ替えて交差を消す', () => {
		// 正方形の 4 隅に置き、対角同士を結んでいる（＝ 1 交差）。
		// 隣り合う 2 点を入れ替えれば交差が消えるはず
		const positions = [
			{ id: 'a', x: 0, y: 0 },
			{ id: 'b', x: 100, y: 100 },
			{ id: 'c', x: 0, y: 100 },
			{ id: 'd', x: 100, y: 0 }
		];
		const edges = [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }];

		const res = reduceCrossings(positions, edges);
		expect(res.before).toBe(1);
		expect(res.after).toBe(0);
		expect(res.swaps).toBeGreaterThan(0);
	});

	it('交差数・エッジ長が同点でも、次数2ノードの曲がりが小さい方の配置を選ぶ', () => {
		// X-Y-Z の 2 辺（Y は次数 2）と、辺を持たない自由ノード W を用意する。
		// Y の初期位置と W の初期位置は「X, Z を焦点とする同じ楕円（＝辺の長さの合計が等しい）」上に置くことで、
		// 交差数（自己ループ無しなので常に 0）とエッジ長の合計を完全に同点にし、
		// 「次数2ノードの曲がり」だけが違う状況を作る（楕円上では焦点までの距離の和が一定になる性質を利用）。
		const X = { x: -100, y: 0 };
		const Z = { x: 100, y: 0 };
		const a = 130; // 楕円の長半径（焦点間距離 200 の半分＝100 より大きい必要がある）
		const b = Math.sqrt(a * a - 100 * 100);
		const pointOnEllipse = (deg) => {
			const rad = (deg * Math.PI) / 180;
			return { x: a * Math.cos(rad), y: b * Math.sin(rad) };
		};
		const sharp = pointOnEllipse(45); // 曲がりが大きい（後述の実測値で確認済み）
		const straight = pointOnEllipse(90); // 同じ楕円上でより一直線に近い

		const positions = [
			{ id: 'X', ...X },
			{ id: 'Z', ...Z },
			{ id: 'Y', ...sharp }, // 曲がりの大きい配置から開始（Y が X-Z を継ぐ次数2ノード）
			{ id: 'W', ...straight } // 辺を持たない自由ノード（曲がりが小さい配置で待機）
		];
		const edges = [{ source: 'X', target: 'Y' }, { source: 'Y', target: 'Z' }];

		// 前提確認：同じ楕円上なので長さの合計は一致し、曲がりだけ違う
		const lenOf = (p) => Math.hypot(p.x - X.x, p.y - X.y) + Math.hypot(p.x - Z.x, p.y - Z.y);
		expect(lenOf(sharp)).toBeCloseTo(lenOf(straight), 6);
		const bendOf = (p) => totalBendPenalty(
			new Map([['X', X], ['Z', Z], ['Y', p]]),
			edges
		);
		expect(bendOf(sharp)).toBeGreaterThan(bendOf(straight));

		const res = reduceCrossings(positions, edges);

		// 交差もエッジ長も変わらない同点状況で、曲がりの総量（totalBendPenalty）は改善しているはず。
		// ※ どのノードの入れ替えで改善するか（Y 自身を動かすか、隣接する X 側を動かすか）は
		//   走査順に依存するため固定しない。「結果として曲がりが減っている」ことだけを保証する。
		const finalPos = new Map(res.positions.map(p => [p.id, p]));
		const finalBend = totalBendPenalty(finalPos, edges);
		const initialBend = totalBendPenalty(new Map(positions.map(p => [p.id, p])), edges);
		expect(finalBend).toBeLessThan(initialBend);
		// 交差数・エッジ長そのものは同点のまま（曲がりの改善が交差やエッジ長を犠牲にしていない）
		expect(res.after).toBe(res.before);
	});

	it('交差が増えることは無い', () => {
		// ランダムではなく決め打ちの配置を複数用意して、常に before >= after を確かめる
		const cases = [
			{
				positions: [
					{ id: '1', x: 0, y: 0 }, { id: '2', x: 60, y: 0 }, { id: '3', x: 120, y: 0 },
					{ id: '4', x: 0, y: 60 }, { id: '5', x: 60, y: 60 }, { id: '6', x: 120, y: 60 }
				],
				edges: [
					{ source: '1', target: '5' }, { source: '2', target: '4' },
					{ source: '3', target: '5' }, { source: '2', target: '6' },
					{ source: '1', target: '6' }
				]
			},
			{
				positions: Array.from({ length: 9 }, (_, i) => ({
					id: String(i), x: (i % 3) * 50, y: Math.floor(i / 3) * 50
				})),
				edges: [
					{ source: '0', target: '8' }, { source: '2', target: '6' },
					{ source: '1', target: '7' }, { source: '3', target: '5' },
					{ source: '0', target: '4' }, { source: '4', target: '8' }
				]
			}
		];

		for (const c of cases) {
			const res = reduceCrossings(c.positions, c.edges);
			expect(res.after).toBeLessThanOrEqual(res.before);
		}
	});

	it('占有している座標の集合は変わらない（格子の充填形を壊さない）', () => {
		const positions = Array.from({ length: 8 }, (_, i) => ({
			id: String(i), x: (i % 4) * 40, y: Math.floor(i / 4) * 40, col: i % 4, row: Math.floor(i / 4)
		}));
		const edges = [
			{ source: '0', target: '5' }, { source: '1', target: '4' },
			{ source: '2', target: '7' }, { source: '3', target: '6' }
		];
		const res = reduceCrossings(positions, edges);

		const key = (p) => `${p.x},${p.y}`;
		expect(new Set(res.positions.map(key))).toEqual(new Set(positions.map(key)));
		expect(res.positions).toHaveLength(positions.length);
		expect(new Set(res.positions.map(p => p.id))).toEqual(new Set(positions.map(p => p.id)));
	});

	it('col / row が座標に追従する', () => {
		const positions = [
			{ id: 'a', x: 0, y: 0, col: 0, row: 0 },
			{ id: 'b', x: 100, y: 100, col: 1, row: 1 },
			{ id: 'c', x: 0, y: 100, col: 0, row: 1 },
			{ id: 'd', x: 100, y: 0, col: 1, row: 0 }
		];
		const edges = [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }];
		const res = reduceCrossings(positions, edges);

		for (const p of res.positions) {
			// 入れ替え後も「その座標に対応する col/row」を持っている
			const origin = positions.find(o => o.x === p.x && o.y === p.y);
			expect(p.col).toBe(origin.col);
			expect(p.row).toBe(origin.row);
		}
	});

	it('決定的（同じ入力からは必ず同じ配置）', () => {
		const positions = Array.from({ length: 10 }, (_, i) => ({
			id: String(i), x: (i % 5) * 40, y: Math.floor(i / 5) * 40
		}));
		const edges = [
			{ source: '0', target: '7' }, { source: '2', target: '5' },
			{ source: '1', target: '9' }, { source: '3', target: '6' },
			{ source: '4', target: '8' }
		];
		const a = reduceCrossings(positions, edges);
		const b = reduceCrossings(positions, edges);
		expect(a.positions).toEqual(b.positions);
		expect(a.after).toBe(b.after);
	});

	it('予算に 1 パスも入らない規模では諦めて元の配置を返す', () => {
		// 実測: 105 ノード / 288 辺 で 5.5 秒、220 / 600 で 2 分超。
		// ノード数の上限ではなく仕事量（≒ 4nm²）の見積もりで足切りする
		const positions = Array.from({ length: 120 }, (_, i) => ({ id: String(i), x: (i % 12) * 40, y: Math.floor(i / 12) * 40 }));
		const edges = Array.from({ length: 300 }, (_, i) => ({ source: String(i % 120), target: String((i * 7 + 5) % 120) }))
			.filter(e => e.source !== e.target);
		const res = reduceCrossings(positions, edges);
		expect(res.skipped).toBe(true);
		expect(res.passes).toBe(0);
		expect(res.positions).toEqual(positions);
	});

	it('規模に応じて反復回数が減る（決定的・機械の速さに依存しない）', () => {
		const mk = (n, m) => ({
			positions: Array.from({ length: n }, (_, i) => ({ id: String(i), x: (i % 6) * 40, y: Math.floor(i / 6) * 40 })),
			edges: Array.from({ length: m }, (_, i) => ({ source: String(i % n), target: String((i * 7 + 5) % n) }))
				.filter(e => e.source !== e.target)
		});
		const small = mk(17, 38);
		const mid = mk(40, 95);

		const rs = reduceCrossings(small.positions, small.edges);
		const rm = reduceCrossings(mid.positions, mid.edges);

		expect(rs.passes).toBe(6);            // 小さい図は上限まで回す
		expect(rm.passes).toBeGreaterThan(0); // 中くらいでも 1 パスは回る
		expect(rm.passes).toBeLessThan(rs.passes);
	});

	it('辺が少なすぎる／ノードが少なすぎる場合は何もしない', () => {
		expect(reduceCrossings([{ id: 'a', x: 0, y: 0 }], []).swaps).toBe(0);
		expect(reduceCrossings([], []).positions).toEqual([]);
	});

	it('六角格子へスナップした実際の形でも交差が増えない', () => {
		// 力学レイアウト後の座標を模したばらつきを格子へ乗せてから交差削減へ渡す
		const raw = Array.from({ length: 14 }, (_, i) => ({
			id: String(i),
			x: Math.cos(i * 1.7) * 180 + (i % 3) * 22,
			y: Math.sin(i * 2.3) * 180 - (i % 4) * 17
		}));
		const snapped = snapToHexLattice(raw, { spacing: 110 });
		const edges = Array.from({ length: 18 }, (_, i) => ({
			source: String(i % 14), target: String((i * 5 + 3) % 14)
		})).filter(e => e.source !== e.target);

		const res = reduceCrossings(snapped, edges);
		expect(res.skipped).toBe(false);
		expect(res.after).toBeLessThanOrEqual(res.before);
		// 格子点から外れていないこと
		for (const p of res.positions) {
			expect(snapped.some(s => s.x === p.x && s.y === p.y)).toBe(true);
		}
	});

	it('実測規模（17 ノード / 38 エッジ）で暴走しない', () => {
		// 相関図はドリル階層で絞るため、一度に描かれる最大がこの規模。
		//
		// **壁時計時間は主たる保証ではない。** 反復回数が n と m だけで決まる（= 仕事量が有界）
		// ことが本質で、そこは「規模に応じて反復回数が減る」のテストが押さえている。
		// ここは「予算制御が外れて 5 秒級に戻っていないか」を見る粗いガードなので、
		// 他のテストと同時に走って CPU を分け合っても落ちない余裕を持たせる
		// （単体実行では約 11ms、全スイート同時では 30ms 前後まで伸びる実測）。
		const positions = Array.from({ length: 17 }, (_, i) => {
			const pt = hexPoint(i % 5, Math.floor(i / 5), 110);
			return { id: String(i), x: pt.x, y: pt.y, col: i % 5, row: Math.floor(i / 5) };
		});
		const edges = Array.from({ length: 38 }, (_, i) => ({
			source: String(i % 17), target: String((i * 7 + 5) % 17)
		})).filter(e => e.source !== e.target);

		const t0 = Date.now();
		const res = reduceCrossings(positions, edges);
		const ms = Date.now() - t0;

		expect(res.skipped).toBe(false);
		expect(res.passes).toBeLessThanOrEqual(6); // 予算制御が効いている
		expect(res.after).toBeLessThanOrEqual(res.before);
		expect(ms, `${ms}ms かかった（予算制御が外れていないか確認）`).toBeLessThan(300);
	});
});

describe('graph-layout.js の格子プリミティブ', () => {
	it('hexNeighbors が返す 6 セルは hexPoint 上で距離ちょうど spacing になる', () => {
		const spacing = 110;
		// 負の row（奇偶分岐のバグが出やすい）も含めて検査する
		for (const row of [-3, -2, -1, 0, 1, 2, 3]) {
			for (const col of [-2, 0, 3]) {
				const here = hexPoint(col, row, spacing);
				const ns = hexNeighbors(col, row);
				expect(ns).toHaveLength(6);
				for (const n of ns) {
					const p = hexPoint(n.col, n.row, spacing);
					const d = Math.hypot(p.x - here.x, p.y - here.y);
					expect(Math.abs(d - spacing), `(${col},${row}) -> (${n.col},${n.row}) の距離 ${d}`).toBeLessThan(1e-6);
				}
			}
		}
	});

	it('hexNeighbors は重複を返さない', () => {
		for (const row of [-1, 0, 1]) {
			const ns = hexNeighbors(2, row);
			expect(new Set(ns.map(n => `${n.col},${n.row}`)).size).toBe(6);
		}
	});

	it('hexNeighbors は対称（a の隣は b、b の隣は a）', () => {
		for (const row of [-2, -1, 0, 1, 2]) {
			for (const n of hexNeighbors(1, row)) {
				const back = hexNeighbors(n.col, n.row);
				expect(back.some(b => b.col === 1 && b.row === row), `(1,${row}) <-> (${n.col},${n.row})`).toBe(true);
			}
		}
	});

	it('hexDistance が hexNeighbors を 1 歩ずつ辿った歩数（BFS）と一致する', () => {
		// 距離の式を信用せず、近傍関係から独立に求めた歩数と突き合わせる
		const origin = { col: 0, row: 0 };
		const seen = new Map([['0,0', 0]]);
		let frontier = [origin];
		for (let step = 1; step <= 4; step += 1) {
			const next = [];
			for (const c of frontier) {
				for (const n of hexNeighbors(c.col, c.row)) {
					const k = `${n.col},${n.row}`;
					if (seen.has(k)) continue;
					seen.set(k, step);
					next.push(n);
				}
			}
			frontier = next;
		}
		for (const [k, steps] of seen) {
			const [col, row] = k.split(',').map(Number);
			expect(hexDistance(origin, { col, row }), `(${col},${row})`).toBe(steps);
		}
	});

	it('hexDistance は対称で、自分自身との距離は 0', () => {
		const a = { col: 3, row: -2 };
		const b = { col: -1, row: 5 };
		expect(hexDistance(a, a)).toBe(0);
		expect(hexDistance(a, b)).toBe(hexDistance(b, a));
	});
});
