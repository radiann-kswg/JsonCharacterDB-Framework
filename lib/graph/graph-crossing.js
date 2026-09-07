/**
 * graph-crossing.js - 接続線の交差が減り、鉄道路線図のように読みやすくなるようノードの配置を入れ替える
 *
 * @description
 * 力学レイアウト（`cose`）→ 格子スナップ（`graph-layout.js` の六角/三角いずれか）の後に走らせる**仕上げの局所探索**。
 * 格子点はすべて等価（六角格子なら隣接6方向、三角格子なら隣接3方向の距離が等しい）なので、
 * **2 ノードの座標を入れ替えても格子の充填形は変わらない**。この性質を使って
 * 「入れ替えると交差が減る組」を探して適用する。交差数が同点のときは、
 * さらに**次数 2（乗り換えの無い駅）を通る 2 本の辺ができるだけ一直線になる方**を優先する
 * （路線図で「通過するだけの駅」が急に折れ曲がらないのと同じ発想。`totalBendPenalty()` 参照）。
 *
 * この探索自体は `{x, y}` 座標のみを扱う純粋な組み合わせ最適化で、六角格子由来か三角格子由来かに
 * 依存するコードは一切含まない（`HEX_AXES`/`TRI_AXES` のような軸集合を参照しない）。
 * そのため `graph-layout.js` の `snapToTriLattice()` が生成した座標をそのまま渡しても、
 * 変更なしでそのまま機能する。
 *
 * ## なぜ後段でやるのか
 *
 * `cose` はエッジ長の総和を縮める力学模型で、交差数そのものは最小化しない。
 * さらに格子へスナップする段で座標が動くため、力学レイアウトが避けていた交差が復活することがある。
 * 交差はグラフの可読性を最も強く損なう要因なので、**格子へ乗せ切った後**に直接減らす。
 *
 * ## 計算量と予算（実測）
 *
 * 相関図はドリル階層で表示対象を絞るため、**実際に一度に描かれるのは最大 17 ノード / 38 エッジ**
 * （全 9 作品 × 全ドリル段を巡回して計測）。478 ノードが同時に描かれることはない。
 * 入れ替えの評価も「入れ替える 2 ノードに接続するエッジ」だけを再計算する差分方式にしてある。
 *
 * ただし全体は **O(パス数 × n × m²)**（n = ノード数、m = 辺数）で、規模が上がると急激に重くなる。
 * パス数を固定していたときのベンチ実測:
 *
 * | 規模 | パス数固定（6） |
 * | --- | ---: |
 * | 17 ノード / 35 辺 | 10.3ms |
 * | 40 / 90 | 98ms |
 * | 105 / 288 | **5,563ms** |
 * | 220 / 600 | **2 分超** |
 *
 * そこで「ノード数の上限」ではなく**仕事量の見積もり（1 パス ≒ `4nm²`）から反復回数を決める**。
 * 予算内に 1 パスも入らない規模では何もせずに返す。
 * 反復回数が n と m だけで決まるので、**機械の速さに依存せず決定的**なまま保てる
 * （時間で打ち切ると機械ごとに図が変わってしまい、「さっき見た形」を追えなくなる）。
 *
 * 予算制御を入れたあとの実測:
 *
 * | 規模 | 実測 | パス数 | 交差 |
 * | --- | ---: | ---: | --- |
 * | 17 ノード / 35 辺 | 11.6ms | 6 | 176 → 4 |
 * | 25 / 58 | 24.5ms | 4 | 397 → 0 |
 * | 40 / 95 | 38.2ms | 1 | 950 → 81 |
 * | 60 / 150 以上 | **0.1ms** | 0 | 足切り（無改変） |
 *
 * ## 決定的であること
 *
 * 走査順・採否の条件をすべて固定しているので、同じ入力からは必ず同じ配置になる。
 * 乱数を使わないのは、再描画のたびに図が変わると「さっき見た形」を追えなくなるため。
 *
 * DOM 非依存の純関数のみ。**Service Worker の `importScripts()` へは追加しないこと**（ES モジュール）。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 */

/** 浮動小数の比較誤差 */
const EPS = 1e-9;

/**
 * 3 点の向き（外積の符号）。**座標を数値で直接受ける**
 *
 * @description 局所探索のホットループから毎回呼ばれるので、
 * `{x, y}` オブジェクトを作らずに済むようスカラー引数にしてある。
 * @returns {number} 正なら反時計回り、負なら時計回り、0 なら一直線
 */
function orientRaw(ax, ay, bx, by, cx, cy) {
	const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
	return Math.abs(v) < EPS ? 0 : v;
}

/** 点 (cx, cy) が線分 (ax,ay)-(bx,by) 上に乗るか（一直線であることは呼び出し側で確認済み前提ではない） */
function onSegRaw(ax, ay, bx, by, cx, cy) {
	return orientRaw(ax, ay, bx, by, cx, cy) === 0
		&& Math.min(ax, bx) - EPS <= cx && cx <= Math.max(ax, bx) + EPS
		&& Math.min(ay, by) - EPS <= cy && cy <= Math.max(ay, by) + EPS;
}

/**
 * 2 本の線分が交差するか（座標を数値で直接受ける内部版）
 *
 * @description **端点を共有する 2 本は交差とみなさない。**
 * 同じノードから出るエッジ同士は必ず 1 点で会うが、それは「交差」ではなく「分岐」なので
 * 数えてしまうと減らしようのない交差が常に計上されてしまう。
 * 端点が相手の線分の内部に乗る場合（T 字）と、重なって平行な場合は交差として扱う。
 * @returns {boolean}
 */
function crossRaw(p1x, p1y, p2x, p2y, q1x, q1y, q2x, q2y) {
	// 端点共有は分岐であって交差ではない
	if ((Math.abs(p1x - q1x) < EPS && Math.abs(p1y - q1y) < EPS)
		|| (Math.abs(p1x - q2x) < EPS && Math.abs(p1y - q2y) < EPS)
		|| (Math.abs(p2x - q1x) < EPS && Math.abs(p2y - q1y) < EPS)
		|| (Math.abs(p2x - q2x) < EPS && Math.abs(p2y - q2y) < EPS)) return false;

	const d1 = orientRaw(q1x, q1y, q2x, q2y, p1x, p1y);
	const d2 = orientRaw(q1x, q1y, q2x, q2y, p2x, p2y);
	const d3 = orientRaw(p1x, p1y, p2x, p2y, q1x, q1y);
	const d4 = orientRaw(p1x, p1y, p2x, p2y, q2x, q2y);

	// 通常の交差（互いに相手をまたぐ）
	if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;

	// どれも 0 でなければ一直線ケースはあり得ないので早期に打ち切る
	if (d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0) return false;

	// 一直線上に乗るケース（T 字・重なり）
	return onSegRaw(q1x, q1y, q2x, q2y, p1x, p1y)
		|| onSegRaw(q1x, q1y, q2x, q2y, p2x, p2y)
		|| onSegRaw(p1x, p1y, p2x, p2y, q1x, q1y)
		|| onSegRaw(p1x, p1y, p2x, p2y, q2x, q2y);
}

/**
 * 2 本の線分が交差するか
 *
 * @description **端点を共有する 2 本は交差とみなさない**（分岐であって交差ではない）。
 * 端点が相手の線分の内部に乗る場合（T 字）と、重なって平行な場合は交差として扱う。
 * @param {{x: number, y: number}} p1 @param {{x: number, y: number}} p2
 * @param {{x: number, y: number}} q1 @param {{x: number, y: number}} q2
 * @returns {boolean}
 */
export function segmentsCross(p1, p2, q1, q2) {
	return crossRaw(p1.x, p1.y, p2.x, p2.y, q1.x, q1.y, q2.x, q2.y);
}

/**
 * 位置と辺の一覧から交差数を数える
 *
 * @param {Map<string, {x: number, y: number}>} posById - ノードID -> 座標
 * @param {Array<{source: string, target: string}>} edges
 * @returns {number} 交差している辺の組の数
 */
export function countCrossings(posById, edges) {
	const list = usableEdges(posById, edges);
	let n = 0;
	for (let i = 0; i < list.length; i += 1) {
		const ei = list[i];
		for (let j = i + 1; j < list.length; j += 1) {
			const ej = list[j];
			if (crossRaw(ei.a.x, ei.a.y, ei.b.x, ei.b.y, ej.a.x, ej.a.y, ej.b.x, ej.b.y)) n += 1;
		}
	}
	return n;
}

/**
 * ある頂点で 2 本の辺がなす「曲がりの度合い」（0 = 一直線 / 2 = 完全に折り返し）
 *
 * @description 路線図では「乗り換えの無い駅（次数 2）」を通る 2 本は
 * できるだけ一直線（他方の延長）に見えるほうが読みやすい。
 * `vAx`,`vAy` と `vBx`,`vBy`（どちらも頂点からの向き）のなす角を余弦で測り、
 * **完全に一直線＝逆向き（内積が -1）のとき 0、完全に折り返し（同じ向き、内積 +1）のとき 2** になるよう
 * `1 + cosθ` を返す（交差数のような整数ではなく連続値なので、tie-break の 2 番手として使う）。
 * @returns {number} 0（一直線）〜2（折り返し）。どちらかの辺の長さが 0 に近い場合は 0（判定不能として無視）
 */
function bendRaw(vAx, vAy, vBx, vBy) {
	const lenA = Math.hypot(vAx, vAy);
	const lenB = Math.hypot(vBx, vBy);
	if (lenA < EPS || lenB < EPS) return 0;
	const cos = (vAx * vBx + vAy * vBy) / (lenA * lenB);
	return 1 + Math.max(-1, Math.min(1, cos));
}

/**
 * 全ノードの「曲がりの総量」を数える（次数 2 のノードだけが対象）
 *
 * @description 路線図らしさの指標。`reduceCrossings()` の tie-break と同じ式を、
 * 検証・可視化のために外から呼べる形で公開する。次数が 2 以外（乗り換え駅・行き止まり）は対象外
 * （3 方向以上は「どの 2 本を一直線とみなすか」が一意に決まらないため）。
 * @param {Map<string, {x: number, y: number}>} posById - ノードID -> 座標
 * @param {Array<{source: string, target: string}>} edges
 * @returns {number} 曲がりペナルティの総和（0 に近いほど一直線が多い）
 */
export function totalBendPenalty(posById, edges) {
	const list = usableEdges(posById, edges);
	/** @type {Map<string, Array<{x: number, y: number}>>} ノードID -> 隣接ノード座標の一覧 */
	const neighborsById = new Map();
	for (const e of list) {
		if (!neighborsById.has(e.source)) neighborsById.set(e.source, []);
		if (!neighborsById.has(e.target)) neighborsById.set(e.target, []);
		neighborsById.get(e.source).push(e.b);
		neighborsById.get(e.target).push(e.a);
	}
	let total = 0;
	for (const [id, neighbors] of neighborsById) {
		if (neighbors.length !== 2) continue; // 乗り換え駅・行き止まりは対象外
		const p = posById.get(id);
		if (!p) continue;
		total += bendRaw(neighbors[0].x - p.x, neighbors[0].y - p.y, neighbors[1].x - p.x, neighbors[1].y - p.y);
	}
	return total;
}

/**
 * 座標が取れる辺だけを線分へ変換する
 * @param {Map<string, {x: number, y: number}>} posById
 * @param {Array<{source: string, target: string}>} edges
 * @returns {Array<{source: string, target: string, a: Object, b: Object}>}
 */
function usableEdges(posById, edges) {
	const out = [];
	for (const e of (Array.isArray(edges) ? edges : [])) {
		if (!e || e.source === e.target) continue; // 自己ループは交差判定に乗せない
		const a = posById.get(e.source);
		const b = posById.get(e.target);
		if (!a || !b) continue;
		out.push({ source: e.source, target: e.target, a, b });
	}
	return out;
}

/**
 * 交差が減るようにノードの座標を入れ替える
 *
 * @description 格子点は等価なので、2 ノードの座標を入れ替えても格子の充填形は変わらない。
 * 「入れ替えると交差が減る組」を貪欲に適用し、改善が無くなるまで繰り返す。
 * 交差数が同じ場合は**次数 2（乗り換えの無い駅）の曲がりが減る方**を優先し
 * （路線図のように、通過するだけの駅は一直線に近いほうが読みやすい）、
 * それも同点なら**エッジ長の総和が縮む方**を採る（振動を防ぐ最終の tie-break）。
 *
 * @param {Array<{id: string, x: number, y: number, col?: number, row?: number}>} positions
 * @param {Array<{source: string, target: string}>} edges
 * @param {Object} [options]
 * @param {number} [options.workBudget=1500000] - 総仕事量の上限。実測で 1 単位 ≒ 20ns なので既定は約 30ms 相当
 * @param {number} [options.maxPasses=6] - 全ペア走査の最大回数
 * @returns {{positions: Array, before: number, after: number, swaps: number, skipped: boolean, passes: number}}
 */
export function reduceCrossings(positions, edges, options = {}) {
	const workBudget = Number.isFinite(options.workBudget) ? options.workBudget : 1_500_000;
	const maxPasses = Number.isFinite(options.maxPasses) ? options.maxPasses : 6;

	const list = Array.isArray(positions) ? positions.map(p => ({ ...p })) : [];
	if (list.length < 4 || !Array.isArray(edges) || edges.length < 2) {
		return { positions: list, before: 0, after: 0, swaps: 0, skipped: false, passes: 0 };
	}

	// --- 数値配列へ落とす（ホットループでオブジェクトを作らないため） ---
	const n = list.length;
	const indexOf = new Map(list.map((p, i) => [p.id, i]));
	const px = new Float64Array(n);
	const py = new Float64Array(n);
	for (let i = 0; i < n; i += 1) { px[i] = list[i].x; py[i] = list[i].y; }

	/** 辺の端点（ノード添字）。座標が取れない辺と自己ループは落とす */
	const es = [];
	const et = [];
	for (const e of edges) {
		if (!e || e.source === e.target) continue;
		const s = indexOf.get(e.source);
		const t = indexOf.get(e.target);
		if (s === undefined || t === undefined) continue;
		es.push(s); et.push(t);
	}
	const m = es.length;
	if (m < 2) return { positions: list, before: 0, after: 0, swaps: 0, skipped: false, passes: 0 };

	// 仕事量の見積もりから反復回数を決める。
	// 1 パスで「全ペア(n²/2) × 触れた辺(≒4m/n) × 全辺(m) × 前後 2 回」の交差判定が走るので ≒ 4nm²。
	// n と m だけで決まるので機械の速さに依存せず決定的。
	const workPerPass = 4 * n * m * m;
	const passes = Math.min(maxPasses, Math.floor(workBudget / Math.max(1, workPerPass)));
	if (passes < 1) {
		// 1 パスも予算に入らない規模。何もせず返す（描画を止めないための保険）
		return { positions: list, before: 0, after: 0, swaps: 0, skipped: true, passes: 0 };
	}

	/** ノード添字 -> 接続する辺の添字 */
	const incident = Array.from({ length: n }, () => []);
	for (let k = 0; k < m; k += 1) { incident[es[k]].push(k); incident[et[k]].push(k); }

	/** 全交差数を数える */
	const countAll = () => {
		let c = 0;
		for (let i = 0; i < m; i += 1) {
			const a = es[i], b = et[i];
			for (let j = i + 1; j < m; j += 1) {
				const cc = es[j], dd = et[j];
				if (crossRaw(px[a], py[a], px[b], py[b], px[cc], py[cc], px[dd], py[dd])) c += 1;
			}
		}
		return c;
	};

	// 「この辺が触れられているか」を毎回 Set で作らず、世代番号つきのフラグ配列で判定する
	const mark = new Int32Array(m);
	let generation = 0;

	/**
	 * 触れた辺が関わる交差数とエッジ長の合計を測る
	 * @param {number[]} touched - 辺の添字（`mark` は呼び出し前に立てておく）
	 * @param {number} gen
	 * @returns {number} 交差数（エッジ長は `lenAcc` へ）
	 */
	let lenAcc = 0;
	const measure = (touched, gen) => {
		let cross = 0;
		lenAcc = 0;
		for (let ti = 0; ti < touched.length; ti += 1) {
			const i = touched[ti];
			const a = es[i], b = et[i];
			const ax = px[a], ay = py[a], bx = px[b], by = py[b];
			lenAcc += Math.hypot(ax - bx, ay - by);
			for (let j = 0; j < m; j += 1) {
				if (j === i) continue;
				// 触れた辺同士の組を二重に数えない（小さい方の添字のときだけ数える）
				if (mark[j] === gen && j < i) continue;
				const cc = es[j], dd = et[j];
				if (crossRaw(ax, ay, bx, by, px[cc], py[cc], px[dd], py[dd])) cross += 1;
			}
		}
		return cross;
	};

	/**
	 * ノード添字が「次数 2（乗り換えの無い駅）」なら、その 2 本の曲がりペナルティを返す
	 *
	 * @description 路線図らしさの tie-break 用。次数が 2 以外（分岐・行き止まり）は 0（対象外）。
	 * @param {number} idx
	 * @returns {number} `bendRaw()` と同じ 0（一直線）〜2（折り返し）
	 */
	const bendAt = (idx) => {
		const inc = incident[idx];
		if (inc.length !== 2) return 0;
		const e0 = inc[0], e1 = inc[1];
		const o0 = es[e0] === idx ? et[e0] : es[e0];
		const o1 = es[e1] === idx ? et[e1] : es[e1];
		return bendRaw(px[o0] - px[idx], py[o0] - py[idx], px[o1] - px[idx], py[o1] - py[idx]);
	};

	const before = countAll();
	let swaps = 0;

	// 走査順を固定して決定的にする（同じ入力からは必ず同じ配置になる）
	for (let pass = 0; pass < passes; pass += 1) {
		let improved = false;

		for (let i = 0; i < n; i += 1) {
			for (let j = i + 1; j < n; j += 1) {
				const ea = incident[i];
				const eb = incident[j];
				// どちらにも辺が無ければ入れ替えても図は変わらない
				if (ea.length === 0 && eb.length === 0) continue;

				// 触れた辺に印を付ける（重複は自然に吸収される）
				generation += 1;
				const gen = generation;
				const touched = [];
				for (const k of ea) if (mark[k] !== gen) { mark[k] = gen; touched.push(k); }
				for (const k of eb) if (mark[k] !== gen) { mark[k] = gen; touched.push(k); }

				const baseCross = measure(touched, gen);
				const baseLen = lenAcc;
				const baseBend = bendAt(i) + bendAt(j);

				// 入れ替えて測り直す
				const tx = px[i], ty = py[i];
				px[i] = px[j]; py[i] = py[j];
				px[j] = tx; py[j] = ty;

				const nextCross = measure(touched, gen);
				const nextLen = lenAcc;
				const nextBend = bendAt(i) + bendAt(j);

				// 採用条件（優先順）: ① 交差が減る ② 交差が同数なら乗り換え無し駅の曲がりが減る
				// （路線図らしく、次数 2 のノードは一直線に近いほうを優先） ③ さらに同点ならエッジ長が縮む方（振動を防ぐ）
				const accept = nextCross < baseCross
					|| (nextCross === baseCross && nextBend < baseBend - EPS)
					|| (nextCross === baseCross && Math.abs(nextBend - baseBend) < EPS && nextLen < baseLen - EPS);

				if (accept) {
					swaps += 1;
					improved = true;
				} else {
					px[j] = px[i]; py[j] = py[i];
					px[i] = tx; py[i] = ty;
				}
			}
		}

		if (!improved) break;
	}

	// 入れ替え結果を書き戻す（col / row も座標に合わせて連れていく）
	const cellByPoint = new Map(list.map(p => [`${p.x},${p.y}`, { col: p.col, row: p.row }]));
	const out = list.map((p, i) => {
		const cell = cellByPoint.get(`${px[i]},${py[i]}`) || {};
		return { ...p, x: px[i], y: py[i], col: cell.col ?? p.col, row: cell.row ?? p.row };
	});

	return { positions: out, before, after: countAll(), swaps, skipped: false, passes };
}
