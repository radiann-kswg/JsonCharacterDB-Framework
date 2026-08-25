/**
 * graph-edge-route.js のテスト
 *
 * @description 「折れ点が必ず格子点に乗ること」と
 * 「Cytoscape の式で復元すると元の折れ点へ戻ること」が要。
 * 後者がずれると、線は引かれるのに狙った場所を通らないという気づきにくい不具合になる。
 */
import { describe, it, expect } from 'vitest';
import {
	HEX_AXES,
	decomposeHexVector,
	hexBendPoints,
	toSegmentSpec,
	routeEdges
} from '../lib/graph/graph-edge-route.js';
import { hexPoint, hexNeighbors } from '../lib/graph/graph-layout.js';
import { segmentsCross } from '../lib/graph/graph-crossing.js';

const SPACING = 110;
const pt = (col, row) => hexPoint(col, row, SPACING);

/** Cytoscape の `curve-style: segments` が折れ点を復元する式（実装から読み取った通り） */
function reconstruct(from, to, weight, distance) {
	const vx = to.x - from.x;
	const vy = to.y - from.y;
	const len = Math.hypot(vx, vy);
	const ux = vx / len;
	const uy = vy / len;
	return {
		x: from.x + vx * weight + (-uy) * distance,
		y: from.y + vy * weight + ux * distance
	};
}

describe('HEX_AXES', () => {
	it('6 本すべて単位ベクトル', () => {
		expect(HEX_AXES).toHaveLength(6);
		for (const e of HEX_AXES) {
			expect(Math.hypot(e.x, e.y)).toBeCloseTo(1, 12);
		}
	});

	it('hexPoint の隣接方向と一致する', () => {
		// 軸が格子の実際の隣接方向とずれていたら、折れ点が格子から外れる
		for (const row of [0, 1, -1, 2]) {
			for (const col of [0, 2, -3]) {
				const here = pt(col, row);
				for (const nb of hexNeighbors(col, row)) {
					const p = pt(nb.col, nb.row);
					const dx = (p.x - here.x) / SPACING;
					const dy = (p.y - here.y) / SPACING;
					const hit = HEX_AXES.some(e => Math.abs(e.x - dx) < 1e-9 && Math.abs(e.y - dy) < 1e-9);
					expect(hit, `(${col},${row}) -> (${nb.col},${nb.row}) が 6 軸に無い`).toBe(true);
				}
			}
		}
	});

	it('角度が 60° 刻みで昇順', () => {
		const deg = HEX_AXES.map(e => (Math.atan2(e.y, e.x) * 180 / Math.PI + 360) % 360);
		for (let i = 0; i < 6; i += 1) expect(deg[i]).toBeCloseTo(i * 60, 9);
	});
});

describe('decomposeHexVector', () => {
	it('分解を足し戻すと元のベクトルになる', () => {
		for (let i = 0; i < 60; i += 1) {
			const dx = Math.cos(i * 0.37) * (50 + i * 7);
			const dy = Math.sin(i * 0.71) * (40 + i * 5);
			const { axis, a, b } = decomposeHexVector(dx, dy);
			const e0 = HEX_AXES[axis];
			const e1 = HEX_AXES[(axis + 1) % 6];
			expect(e0.x * a + e1.x * b).toBeCloseTo(dx, 9);
			expect(e0.y * a + e1.y * b).toBeCloseTo(dy, 9);
		}
	});

	it('係数は必ず非負（隣り合う 2 軸の扇形に収まる）', () => {
		for (let i = 0; i < 60; i += 1) {
			const { a, b } = decomposeHexVector(Math.cos(i * 1.13) * 100, Math.sin(i * 1.13) * 100);
			expect(a).toBeGreaterThanOrEqual(0);
			expect(b).toBeGreaterThanOrEqual(0);
		}
	});

	it('軸そのものを渡すと片方が 0 になる', () => {
		HEX_AXES.forEach((e, i) => {
			const { axis, a, b } = decomposeHexVector(e.x * 200, e.y * 200);
			// 軸 i の方向は「扇形 i の始端」なので a=200 / b=0 になる
			expect(axis).toBe(i);
			expect(a).toBeCloseTo(200, 9);
			expect(b).toBeCloseTo(0, 9);
		});
	});

	it('ゼロベクトルでも壊れない', () => {
		expect(decomposeHexVector(0, 0)).toEqual({ axis: 0, a: 0, b: 0 });
	});
});

describe('hexBendPoints', () => {
	it('折れ点は必ず格子点に乗る', () => {
		// 格子点どうしを結ぶ限り、折れ点も格子点（= spacing の整数倍の位置）になるはず
		const cells = [];
		for (let c = -3; c <= 3; c += 1) for (let r = -3; r <= 3; r += 1) cells.push({ c, r });

		let checked = 0;
		for (const A of cells) {
			for (const B of cells) {
				if (A.c === B.c && A.r === B.r) continue;
				const from = pt(A.c, A.r);
				const to = pt(B.c, B.r);
				for (const bend of hexBendPoints(from, to)) {
					checked += 1;
					// 格子点なら row = y / (spacing * √3/2) が整数
					const row = bend.y / (SPACING * Math.sqrt(3) / 2);
					expect(Math.abs(row - Math.round(row)), `row=${row}`).toBeLessThan(1e-9);
					// col も整数（奇数行は半セルずれる）
					const offset = (Math.abs(Math.round(row) % 2) === 1) ? SPACING / 2 : 0;
					const col = (bend.x - offset) / SPACING;
					expect(Math.abs(col - Math.round(col)), `col=${col}`).toBeLessThan(1e-9);
				}
			}
		}
		expect(checked).toBeGreaterThan(1000); // 走査が空回りしていないこと
	});

	it('折れ点を経由すると 6 方向の脚だけで到達する', () => {
		const from = pt(0, 0);
		const to = pt(3, 4);
		const [b0, b1] = hexBendPoints(from, to);
		for (const bend of [b0, b1]) {
			for (const [p, q] of [[from, bend], [bend, to]]) {
				const dx = q.x - p.x;
				const dy = q.y - p.y;
				if (Math.hypot(dx, dy) < 1e-9) continue;
				const deg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
				expect(Math.abs(deg - Math.round(deg / 60) * 60), `${deg}°`).toBeLessThan(1e-6);
			}
		}
	});

	it('軸と平行なら折れ点を作らない', () => {
		// 真横（0°）
		expect(hexBendPoints(pt(0, 0), pt(4, 0))).toHaveLength(0);
		// 60° 方向へ 1 歩 / 2 歩。
		// （真下 `pt(0,2)` は 90° で 6 軸に無いため軸平行ではない。折れ点が要る）
		expect(hexBendPoints(pt(0, 0), pt(0, 1))).toHaveLength(0);
		expect(hexBendPoints(pt(0, 0), pt(1, 2))).toHaveLength(0);
		expect(hexBendPoints(pt(0, 0), pt(0, 2))).toHaveLength(2);
	});

	it('2 通りの折れ点は互いに反対側にある', () => {
		const from = pt(0, 0);
		const to = pt(3, 4);
		const [b0, b1] = hexBendPoints(from, to);
		const s0 = toSegmentSpec(from, to, b0);
		const s1 = toSegmentSpec(from, to, b1);
		expect(Math.sign(s0.distance)).toBe(-Math.sign(s1.distance));
	});
});

describe('toSegmentSpec', () => {
	it('Cytoscape の式で復元すると元の折れ点へ戻る', () => {
		// ここがずれると「線は引かれるのに狙った場所を通らない」不具合になる
		let maxErr = 0;
		let checked = 0;
		for (let c = -4; c <= 4; c += 1) {
			for (let r = -4; r <= 4; r += 1) {
				if (c === 0 && r === 0) continue;
				const from = pt(0, 0);
				const to = pt(c, r);
				for (const bend of hexBendPoints(from, to)) {
					const spec = toSegmentSpec(from, to, bend);
					const back = reconstruct(from, to, spec.weight, spec.distance);
					maxErr = Math.max(maxErr, Math.hypot(back.x - bend.x, back.y - bend.y));
					checked += 1;
				}
			}
		}
		expect(checked).toBeGreaterThan(50);
		expect(maxErr, `最大誤差 ${maxErr}px`).toBeLessThan(1e-9);
	});

	it('weight は 0-1 に収まる（折れ点が線分の範囲内へ射影される）', () => {
		for (let c = -4; c <= 4; c += 1) {
			for (let r = -4; r <= 4; r += 1) {
				if (c === 0 && r === 0) continue;
				const from = pt(0, 0);
				const to = pt(c, r);
				for (const bend of hexBendPoints(from, to)) {
					const { weight } = toSegmentSpec(from, to, bend);
					expect(weight).toBeGreaterThanOrEqual(-1e-9);
					expect(weight).toBeLessThanOrEqual(1 + 1e-9);
				}
			}
		}
	});

	it('distance の符号は進行方向の右手側が正', () => {
		// 左→右のエッジで、下側（y が大きい方）の折れ点が正になる
		const from = { x: 0, y: 0 };
		const to = { x: 100, y: 0 };
		expect(toSegmentSpec(from, to, { x: 50, y: 30 }).distance).toBeGreaterThan(0);
		expect(toSegmentSpec(from, to, { x: 50, y: -30 }).distance).toBeLessThan(0);
	});

	it('始点と終点が同じなら null', () => {
		expect(toSegmentSpec({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 0, y: 0 })).toBeNull();
	});
});

describe('routeEdges', () => {
	const positions = new Map([
		['a', pt(0, 0)], ['b', pt(3, 4)], ['c', pt(4, 0)], ['d', pt(-2, 3)]
	]);

	it('軸平行の辺は straight になる', () => {
		const out = routeEdges([{ id: 'e1', source: 'a', target: 'c' }], positions);
		expect(out[0].curveStyle).toBe('straight');
	});

	it('斜めの辺は round-segments になり、折れ点が格子点へ復元される', () => {
		const out = routeEdges([{ id: 'e1', source: 'a', target: 'b' }], positions);
		expect(out[0].curveStyle).toBe('round-segments');
		// ずらす必要が無い（廊下を独占している）辺は折れ点 1 個のまま
		expect(out[0].weights).toHaveLength(1);
		const back = reconstruct(positions.get('a'), positions.get('b'), out[0].weights[0], out[0].distances[0]);
		const row = back.y / (SPACING * Math.sqrt(3) / 2);
		expect(Math.abs(row - Math.round(row))).toBeLessThan(1e-9);
	});

	it('多重辺は交互に別の折れ方を使う', () => {
		const out = routeEdges([
			{ id: 'e1', source: 'a', target: 'b' },
			{ id: 'e2', source: 'a', target: 'b' }
		], positions);
		expect(out).toHaveLength(2);
		// 2 本が別の折れ方（互いに反対側）を使うので、そもそもずらす必要が無い
		expect(Math.sign(out[0].distances[0])).toBe(-Math.sign(out[1].distances[0]));
	});

	it('自己ループと座標の無いノードは飛ばす', () => {
		const out = routeEdges([
			{ id: 'self', source: 'a', target: 'a' },
			{ id: 'ghost', source: 'a', target: 'zzz' },
			{ id: 'ok', source: 'a', target: 'b' }
		], positions);
		expect(out.map(o => o.id)).toEqual(['ok']);
	});

	it('ノードを貫通しない折れ方を選ぶ', () => {
		// a→b の 2 通りの折れ点のうち、片方の経路上にノードを置く
		const bends = hexBendPoints(pt(0, 0), pt(3, 4));
		const blocker = { x: (pt(0, 0).x + bends[0].x) / 2, y: (pt(0, 0).y + bends[0].y) / 2 };
		const pos = new Map([...positions, ['blk', blocker]]);
		const out = routeEdges([{ id: 'e1', source: 'a', target: 'b' }], pos, { nodeRadius: 30 });
		const mid = Math.floor(out[0].weights.length / 2);
		const back = reconstruct(pt(0, 0), pt(3, 4), out[0].weights[mid], out[0].distances[mid]);
		// 塞がれていない方（bends[1]）が選ばれるはず
		expect(Math.hypot(back.x - bends[1].x, back.y - bends[1].y)).toBeLessThan(1e-6);
	});

	it('850 辺を実用的な時間で処理する', () => {
		const nodes = new Map();
		for (let i = 0; i < 120; i += 1) nodes.set(String(i), pt(i % 12, Math.floor(i / 12)));
		const edges = Array.from({ length: 850 }, (_, i) => ({
			id: `e${i}`, source: String(i % 120), target: String((i * 7 + 5) % 120)
		})).filter(e => e.source !== e.target);

		// 初回は JIT のウォームアップぶんが乗る（実測で初回 36ms / 温まると 4.4ms）ので、
		// 数回まわして中央値を見る
		const runs = [];
		let out;
		for (let k = 0; k < 5; k += 1) {
			const t0 = performance.now();
			out = routeEdges(edges, nodes);
			runs.push(performance.now() - t0);
		}
		runs.sort((a, b) => a - b);
		const median = runs[2];

		// 閾値はマシン性能に左右される絶対値。GitHub Actions の共有ランナーは同じコードで
		// 実測 41〜66ms（ローカルは数 ms）だったため、CI では回帰検知に足りる緩い上限にする。
		// アルゴリズムが悪化すれば桁で増えるので、緩めても検知力は残る。
		const limit = process.env.CI ? 200 : 40;

		expect(out.length).toBeGreaterThan(700);
		expect(median, `中央値 ${median.toFixed(1)}ms`).toBeLessThan(limit);
	});

	it('レーン分離で線分の完全な重なりが消える', () => {
		// 向きを 6 方向へ制約すると別々の辺が同じ経路へ集まる。
		// レーン分離を入れる前は **53 本の線分のうち 83% が完全な重なり**に巻き込まれ、
		// 最大 5 本が 1 本に潰れていた（交差は減っても追えないので図としては悪化）
		const nodes = new Map();
		for (let i = 0; i < 40; i += 1) nodes.set(String(i), pt(i % 8, Math.floor(i / 8)));
		const edges = Array.from({ length: 120 }, (_, i) => ({
			id: `e${i}`, source: String(i % 40), target: String((i * 7 + 5) % 40)
		})).filter(e => e.source !== e.target);

		const out = routeEdges(edges, nodes);

		// 各辺を線分へ展開し、両端が一致する線分の重複を数える
		const segs = [];
		for (const r of out) {
			const e = edges.find(x => x.id === r.id);
			const A = nodes.get(e.source);
			const B = nodes.get(e.target);
			if (r.curveStyle === 'straight') { segs.push([A, B]); continue; }
			const pts = r.weights.map((w, i) => reconstruct(A, B, w, r.distances[i]));
			const chain = [A, ...pts, B];
			for (let i = 1; i < chain.length; i += 1) segs.push([chain[i - 1], chain[i]]);
		}
		const key = (p) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
		const count = new Map();
		for (const [a, b] of segs) {
			const ka = key(a);
			const kb = key(b);
			const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
			count.set(k, (count.get(k) || 0) + 1);
		}
		// **ノード際の「渡り」（数 px）は除いて数える。**
		// 同じノードから同じ側へ出る線は、根元の数 px が重なるのが自然な見え方で、
		// 追えなくなる原因にはならない（実測でも重なるのは長さ 10〜18px の渡りだけだった）
		const longKeys = new Set();
		for (const [a, b] of segs) {
			if (Math.hypot(b.x - a.x, b.y - a.y) < 60) continue;
			const ka = key(a);
			const kb = key(b);
			longKeys.add(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`);
		}
		const overlapped = [...count.entries()]
			.filter(([k, v]) => v > 1 && longKeys.has(k))
			.reduce((s, [, v]) => s + v, 0);

		expect(segs.length).toBeGreaterThan(100);
		expect(overlapped, `${overlapped}/${segs.length} 線分が重なっている`).toBe(0);
	});

	it('主要な脚は厳密に格子の 6 方向へ乗る', () => {
		// **折れ点 1 個のままレーンをずらすと脚が傾く**（実測で 60° からのずれが中央値 9.8°・最大 27.7°）。
		// 両端に渡りを挟む方式にしたことで、主要な脚は元の格子方向を厳密に保つ
		const nodes = new Map();
		for (let i = 0; i < 40; i += 1) nodes.set(String(i), pt(i % 8, Math.floor(i / 8)));
		const edges = Array.from({ length: 120 }, (_, i) => ({
			id: `e${i}`, source: String(i % 40), target: String((i * 7 + 5) % 40)
		})).filter(e => e.source !== e.target);

		const out = routeEdges(edges, nodes);
		let checked = 0;
		for (const r of out) {
			const e = edges.find(x => x.id === r.id);
			const A = nodes.get(e.source);
			const B = nodes.get(e.target);
			const pts = r.curveStyle === 'straight'
				? []
				: r.weights.map((w, i) => reconstruct(A, B, w, r.distances[i]));
			const chain = [A, ...pts, B];
			// **渡りは長さでは見分けられない**（レーン数が多いと 50px 近くになる）ので構造で判定する。
			// ずらした辺は両端に渡りが付く: 斜めなら 3 点（渡り + 脚 + 脚 + 渡り）、
			// 軸平行なら 2 点（渡り + 脚 + 渡り）。ずらしていない辺（1 点）には渡りが無い
			const hasJogs = pts.length >= 2;
			for (let i = 1; i < chain.length; i += 1) {
				if (hasJogs && (i === 1 || i === chain.length - 1)) continue;
				const p = chain[i - 1];
				const q = chain[i];
				if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-6) continue;
				checked += 1;
				const deg = (Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI + 360) % 360;
				expect(Math.abs(deg - Math.round(deg / 60) * 60), `脚の向きが ${deg.toFixed(2)}°（60° の倍数から外れている）`)
					.toBeLessThan(1e-6);
			}
		}
		expect(checked).toBeGreaterThan(150);
	});

	it('レーンずらし後の最終形で残る交差を、折れ方の入れ替えで修復する', () => {
		// 1 巡目の交差回避判定は「既に決めた辺」との比較しかしない（貪欲）ため、
		// 後から登場する辺との交差は 1 巡目では気付けない。
		// A-B は 2 通りの折れ方があり、どちらを選ぶかで C-D（軸平行の直線）と交差するかが変わる。
		// A-B を先に処理すると（この時点では C-D は未確定なので）交差する方の折れ方が選ばれてしまうが、
		// 4 巡目でレーンずらし後の最終形を見直し、交差しない方へ入れ替えられるはず
		// （他に辺が無いので、入れ替えても新しい重なりは発生し得ない＝安全に直せる状況）。
		const nodes = new Map([
			['A', { x: 0, y: 0 }],
			['B', { x: 275, y: 95.26279441628824 }],
			['C', { x: 100, y: 50 }],
			['D', { x: 300, y: 50 }]
		]);
		const edges = [
			{ id: 'ab', source: 'A', target: 'B' },
			{ id: 'cd', source: 'C', target: 'D' }
		];

		const out = routeEdges(edges, nodes);
		const ab = out.find(o => o.id === 'ab');
		const A = nodes.get('A');
		const B = nodes.get('B');
		const pts = [A, ...ab.weights.map((w, i) => reconstruct(A, B, w, ab.distances[i])), B];

		const C = nodes.get('C');
		const D = nodes.get('D');
		let crossesCD = false;
		for (let i = 0; i < pts.length - 1; i += 1) {
			if (segmentsCross(pts[i], pts[i + 1], C, D)) crossesCD = true;
		}
		expect(crossesCD, 'A-B の最終形が C-D と交差している（折れ方の入れ替えで直せるはず）').toBe(false);
	});

	it('折れ方を入れ替えると別の辺と重なってしまう場合は、交差が残っても入れ替えない', () => {
		// 実機のブラウザ確認で見つかった実例。A-B（の一部の脚）が別の直線の辺 C-D と交差しているが、
		// A-B のもう一方の折れ方は「別の辺と完全に重なって 1 本に見えてしまう」経路になる。
		// 重なりは交差よりも読みにくい（線が消える）ため、この場合は入れ替えを見送り、
		// 交差が残る（＝重なりを増やさない）ほうを選ぶのが正しい。
		const nodes = new Map([
			['3', { x: 122, y: 422.62039704680603 }],
			['4', { x: 122, y: 211.31019852340302 }],
			['5', { x: 0, y: 211.31019852340302 }],
			['6', { x: 183, y: 316.96529778510455 }],
			['8', { x: 122, y: 0 }],
			['9', { x: 244, y: 211.31019852340302 }]
		]);
		const edges = [
			{ id: 'r35', source: '3', target: '5' },
			{ id: 'c36', source: '3', target: '6' },
			{ id: 'r45', source: '4', target: '5' },
			{ id: 'r46', source: '4', target: '6' },
			{ id: 'c48', source: '4', target: '8' },
			{ id: 'r56', source: '5', target: '6' },
			{ id: 'r69', source: '6', target: '9' },
			{ id: 'c56', source: '5', target: '6' },
			{ id: 'c49', source: '4', target: '9' }
		];

		const out = routeEdges(edges, nodes);

		const segmentsOf = (r) => {
			const e = edges.find(x => x.id === r.id);
			const A = nodes.get(e.source);
			const B = nodes.get(e.target);
			const pts = [A, ...r.weights.map((w, i) => reconstruct(A, B, w, r.distances[i])), B];
			const segs = [];
			for (let i = 0; i < pts.length - 1; i += 1) segs.push([pts[i], pts[i + 1]]);
			return segs;
		};

		const sameEnd = (p, q) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
		let crossings = 0;
		let overlaps = 0;
		for (let i = 0; i < out.length; i += 1) {
			for (let j = i + 1; j < out.length; j += 1) {
				for (const [a, b] of segmentsOf(out[i])) {
					for (const [c, d] of segmentsOf(out[j])) {
						if (segmentsCross(a, b, c, d)) crossings += 1;
						if ((sameEnd(a, c) && sameEnd(b, d)) || (sameEnd(a, d) && sameEnd(b, c))) overlaps += 1;
					}
				}
			}
		}
		// 交差 1 本は残るが、それを重なりへ悪化させてはいない
		expect(overlaps, '折れ方の入れ替えで別の辺と重なってしまっている').toBe(0);
		expect(crossings).toBeLessThanOrEqual(1);
	});

	it('空の入力でも壊れない', () => {
		expect(routeEdges([], positions)).toEqual([]);
		expect(routeEdges(null, positions)).toEqual([]);
	});
});
