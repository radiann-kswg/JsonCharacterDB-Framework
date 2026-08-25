/**
 * graph-hexfill.js - グループを六角格子の「マス」で塗り分ける割当を作る
 *
 * @description
 * 集約表示（作品別 / 陣営別 / クラス別…）を、
 * **格子の頂点に 1 個のノードを置く**形から
 * **格子のマスを人数分だけ塗る**形へ変えるための座標計算。
 *
 * ```
 *  変更前: ●            変更後:  ⬡⬡⬡
 *          「陣営A(12)」          ⬡⬡⬡⬡        ← 12 マス塗る＝12 人
 *                                 ⬡⬡⬡⬡⬡
 * ```
 *
 * ## 1 マスとは何か
 *
 * `graph-layout.js` の `hexPoint()` が張る格子は「6 近傍すべてが距離 `spacing`」の三角格子で、
 * その各格子点のボロノイ胞は **pointy-top の正六角形**になる。
 * つまり**既存の格子はそのまま六角タイルの中心座標表**であって、格子を作り直す必要は無い。
 *
 * ## 守る不変条件
 *
 * | # | 条件 | どう保証するか |
 * | --- | --- | --- |
 * | 1 | **セル数 = メンバー数** | 容量ちょうどで打ち切る。穴を埋めて水増ししない |
 * | 2 | **セルは高々 1 グループ** | 割当済みセルは二度と配らない |
 * | 3 | **各グループは 6 近傍で連結** | 割当済みセルの隣だけを候補に積む（構成上そうなる） |
 * | 4 | **決定的** | 乱数を使わず、優先度の同点は (グループ番号, 行, 列) で必ず解く |
 * | 5 | **隣接グループは別の濃度段** | グループ隣接グラフを貪欲彩色する |
 *
 * **穴（周囲を囲まれた未割当のマス）は残す。** 埋めると条件 1 が壊れ、
 * 「マスを数えれば人数が分かる」という読み方が成立しなくなる。穴は格子の目地として見せる。
 *
 * ## セル数は人数の対数比例（2026-08-04）
 *
 * **2026-08-04 以前**は「セル数 = メンバー数」を厚密な不変条件としていたが、
 * 1 人しかいないグループと数百人のグループが同居すると、最大のグループが図の大半を占めて
 * 他が埋もれて見えなくなる問題が実データで出た（運命線探偵 78 など）。
 * **2026-08-04 以降**は `logProportionalCellCount()` で `セル数 = round(scale × log(1 + 人数))`
 * に圧縮してから `size` として渡す（呼び出し側の責任。本モジュール自体は `size` をそのまま使う）。
 * このため**上記不変条件 1 の「メンバー数」は「呼び出し側が渡した `size`」の意味になり、
 * 実人数とは一致しない。実人数の表示は呼び出し側が別途 `count` として `size` と並べて渡す（
 * 本モジュールの `buildHexFill()` は入力オブジェクトをスプレッドして出力にそのまま混ぜるので、
 * `count` を添えれば `groups[i].count` として固定で取り出せる）。
 *
 * ## 多値軸は組み合わせグループ（延べ人数ではない）2026-08-04
 *
 * 1 キャラが複数値を持つ軸（`Belonging` は最大 3、`Class` は最大 5）でも、
 * `lib/graph/graph-facets.js` の `groupNodesByFacet()` が**組み合わせごとに 1 つのグループ**を作るため、
 * 本モジュールに届く時点ですでに **1 キャラ = 1 グループ**になっている（延べ人数ではなく実人数）。
 *
 * DOM 非依存の純関数のみ。**Service Worker の `importScripts()` へは追加しないこと**（ES モジュール）。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 */

import {
	hexPoint, nearestCell, hexNeighbors, hexDistance, spiralCells,
	triPoint, nearestTriCell, triNeighbors, triDistance, spiralTriCells
} from './graph-layout.js';

/**
 * 格子アダプタ
 *
 * @description このファイルの成長アルゴリズム（`relaxSeeds` 以降すべて）は
 * 「近傍・距離・座標変換」を格子の種類に依存しない形で呼んでいるだけなので、
 * この 5 関数を差し替えるだけで六角格子・三角格子のどちらでも同じロジックが動く。
 * 既定は六角格子（`HEX_LATTICE`）。呼び出し側は `options.lattice` に `TRI_LATTICE` を渡す。
 * @typedef {Object} LatticeAdapter
 * @property {(col: number, row: number, spacing: number) => {x: number, y: number}} point
 * @property {(x: number, y: number, spacing: number) => {col: number, row: number}} nearestCell
 * @property {(col: number, row: number) => Array<{col: number, row: number}>} neighbors
 * @property {(a: Object, b: Object) => number} distance
 * @property {(col: number, row: number, maxRing: number) => Generator<{col: number, row: number}>} spiralCells
 * @property {(spacing: number) => {padX: number, padY: number}} cellPadding
 */

/** @type {LatticeAdapter} 六角格子アダプタ（既定値） */
export const HEX_LATTICE = Object.freeze({
	point: hexPoint,
	nearestCell,
	neighbors: hexNeighbors,
	distance: hexDistance,
	spiralCells,
	// 頂点間の高さは spacing × 2/√3（pointy-top 六角形）
	cellPadding: (spacing) => ({ padX: spacing / 2, padY: spacing / Math.sqrt(3) })
});

/** @type {LatticeAdapter} 三角格子アダプタ */
export const TRI_LATTICE = Object.freeze({
	point: triPoint,
	nearestCell: nearestTriCell,
	neighbors: triNeighbors,
	distance: triDistance,
	spiralCells: spiralTriCells,
	// 重心から頂点までの最大距離を目安にした概算（正確な外接矩形は描画側で詰める）
	cellPadding: (spacing) => {
		const s = spacing * Math.sqrt(3);
		const h = s * (Math.sqrt(3) / 2);
		return { padX: s / 2, padY: (2 * h) / 3 };
	}
});

/** `logProportionalCellCount()` の既定係数 */
const DEFAULT_LOG_SCALE = 8;

/**
 * 実人数を対数比例のマス数へ変換する
 *
 * @description `cells = round(scale × log(1 + 人数))`。
 * 人数にそのまま比例させると、1 人のグループと数百人のグループが同居したときに
 * 最大のグループが図の大半を占めて他が埋もれる（実データで運命線探偵78 などに出た問題）。
 * 対数を挟むことで差を圧縮しつつ、人数が多いほどマスも多いという順序関係は保つ。
 * @param {number} memberCount - 実人数（延べではなく、そのグループの実メンバー数）
 * @param {number} [scale=8] - 対数の係数。大きいほどグループ間の面積差が開く
 * @returns {number} 0 以上の整数（マス数）。人数 0 なら 0、人数 1 以上なら必ず 1 以上
 */
export function logProportionalCellCount(memberCount, scale = DEFAULT_LOG_SCALE) {
	const n = Math.max(0, Math.floor(Number(memberCount) || 0));
	if (n <= 0) return 0;
	const s = Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_LOG_SCALE;
	return Math.max(1, Math.round(s * Math.log(1 + n)));
}

/** 原点へ引き寄せる強さ。大きいほど全体が丸くまとまるが、グループの形はいびつになる */
const ORIGIN_PULL = 0.35;

/** seed 反発の反復回数 */
const RELAX_ITERATIONS = 40;

/**
 * 繋がっているグループを引き寄せる強さ
 *
 * @description 実測（13 グループ / 20 本の繋がり。集約段の実データ相当）で、
 * アンカー間の接続線の交差数がこう変わる:
 *
 * | 引力 | 反復 40 | 反復 120 |
 * | ---: | ---: | ---: |
 * | 0（繋がりを見ない） | 38 | 40 |
 * | 0.12 | 36 | 22 |
 * | 0.3 | 21 | 15 |
 * | **0.6** | **10** | 26 |
 * | 1.0 | 9 | 10 |
 *
 * 0.6 を採る（交差 38 → 10 本、外接も 494×494 → 551×461 とほぼ横ばい）。
 * **反復を増やせば良くなるわけではない**のが要注意で、引力と反発が拮抗して振動するため
 * 0.6 では 120 反復のほうがかえって悪化する。反復数は 40 で固定する。
 */
const LINK_ATTRACTION = 0.6;

/**
 * 種同士を離す距離の係数（半径の和に掛ける）
 *
 * @description 1.0 より小さくすると塊が食い込み合い、隙間が減って全体が縮む。
 * 実測（作品別 9 / クラス別 13 / 陣営別 27 グループ）:
 *
 * | 係数 | 充填率 | 外接マス数（作品別 / クラス別 / 陣営別） | 使われた濃度段 |
 * | ---: | ---: | --- | ---: |
 * | 1.15 | 47〜50% | 870 / 475 / 870 | 3 |
 * | 1.00 | 53〜66% | 810 / 340 / 725 | 3〜4 |
 * | **0.85** | **64〜71%** | **676 / 304 / 546** | **3〜5** |
 * | 0.70 | 67〜68% | 650 / 270 / 500 | 4 |
 *
 * 隙間が減ると**グループ同士が隣接する**ので、濃度段の貪欲彩色（`assignShadeSteps()`）も
 * 意味を持つようになる（1.15 では大半のグループが孤立して全員が段 0 になっていた）。
 *
 * ## ただし詰めすぎると囲い込みが起きる
 *
 * 種が近いと、あるグループが他のグループに完全に囲まれて成長先を失い、
 * 容量（= メンバー数）を満たせなくなる。実測の分断グループ数:
 *
 * | 係数 | 作品 / クラス / 陣営 / 最悪 |
 * | ---: | --- |
 * | 0.85 | 0 / 1 / 4 / 2 |
 * | 0.92 | 0 / 0 / 2 / 1 |
 * | 1.00 | 0 / 0 / 1 / 1 |
 * | 1.10 | 0 / 0 / 0 / 0 |
 *
 * そこで**単一の係数を選ばず、囲い込みが起きたら間隔を広げて再試行する**。
 * 詰められる構成では詰め、詰められない構成でだけ緩む。
 * 段は固定なので**決定的**（同じ入力からは必ず同じ割当になる）。
 */
const SEED_SEPARATION_LADDER = Object.freeze([0.85, 1.0, 1.2, 1.5, 2.0]);

/** @param {{col: number, row: number}} c @returns {string} */
const cellKey = (c) => `${c.col},${c.row}`;

/**
 * 最小ヒープ（優先度つきキュー）
 *
 * @description 割当は「いま一番安いセル」から確定していくので、
 * 全候補を毎回ソートせずに済むようヒープを使う。
 * 比較は `cost` → `groupIndex` → `row` → `col` の順で、**同点を必ず一意に解く**（決定性の要）。
 */
class CellHeap {
	constructor() {
		/** @type {Array<{cost: number, group: number, col: number, row: number, from: number}>} */
		this.items = [];
	}

	/** @param {Object} a @param {Object} b @returns {boolean} a が b より優先されるか */
	static before(a, b) {
		if (a.cost !== b.cost) return a.cost < b.cost;
		if (a.group !== b.group) return a.group < b.group;
		if (a.row !== b.row) return a.row < b.row;
		return a.col < b.col;
	}

	get size() { return this.items.length; }

	/** @param {Object} item */
	push(item) {
		const a = this.items;
		a.push(item);
		let i = a.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (!CellHeap.before(a[i], a[p])) break;
			[a[i], a[p]] = [a[p], a[i]];
			i = p;
		}
	}

	/** @returns {Object|null} */
	pop() {
		const a = this.items;
		if (a.length === 0) return null;
		const top = a[0];
		const last = a.pop();
		if (a.length > 0) {
			a[0] = last;
			let i = 0;
			for (;;) {
				const l = i * 2 + 1;
				const r = l + 1;
				let s = i;
				if (l < a.length && CellHeap.before(a[l], a[s])) s = l;
				if (r < a.length && CellHeap.before(a[r], a[s])) s = r;
				if (s === i) break;
				[a[i], a[s]] = [a[s], a[i]];
				i = s;
			}
		}
		return top;
	}
}

/**
 * グループの種セルを決める（大きいグループほど広い場所を取る）
 *
 * @description 連続座標（1 単位 = 1 セル間隔）で「面積に比例した半径の円」を重ならないよう押し合い、
 * 同時に原点へ弱く引き寄せる。収束後に最寄りの格子セルへ丸める。
 * 乱数は使わず、初期配置も大きい順の螺旋なので**決定的**。
 *
 * ## 繋がっているグループは引き寄せる
 *
 * 大きさだけで配置すると、**濃い関係のあるグループが図の反対側どうしに置かれてしまい、
 * 接続線が図を横断して交差だらけになる**。
 * `links` を渡すと、繋がりの強さに比例した引力が働いて関係の深いグループが隣り合う。
 * 線の引き回しで誤魔化すより、そもそも交差が生まれにくい配置にするほうが効く。
 *
 * @param {number[]} sizes - グループごとのメンバー数
 * @param {number} [iterations=RELAX_ITERATIONS]
 * @param {number} [separation] - 種同士を離す距離の係数
 * @param {Array<{a: number, b: number, weight?: number}>} [links] - グループ間の繋がり（添字で指定）
 * @param {LatticeAdapter} [lattice=HEX_LATTICE] - 格子アダプタ（三角格子なら `TRI_LATTICE` を渡す）
 * @returns {Array<{col: number, row: number}>} グループごとの種セル
 */
export function relaxSeeds(sizes, iterations = RELAX_ITERATIONS, separation = SEED_SEPARATION_LADDER[0], links = null, lattice = HEX_LATTICE) {
	const n = sizes.length;
	if (n === 0) return [];
	if (n === 1) return [{ col: 0, row: 0 }];

	// 半径は面積（メンバー数）に比例させる。円の面積 = πr² より r = √(size/π)
	const radius = sizes.map(s => Math.sqrt(Math.max(1, s) / Math.PI));

	// 初期配置: 大きいグループを中心近くへ置く（後の反発で押し出されにくくする）
	const order = sizes.map((s, i) => i).sort((a, b) => sizes[b] - sizes[a] || a - b);
	const pts = new Array(n);
	order.forEach((gi, rank) => {
		// 黄金角ではなく単純な螺旋（決定的で読みやすい）
		const ring = Math.floor(Math.sqrt(rank));
		const angle = rank * 2.4;
		const r = ring * 2.2 + (rank === 0 ? 0 : 1.6);
		pts[gi] = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
	});

	// 繋がりを正規化しておく（重みは最大 1 に揃え、強い繋がりほど強く引き寄せる）
	const bonds = [];
	if (Array.isArray(links) && links.length > 0) {
		let maxW = 0;
		for (const l of links) {
			if (!l || !Number.isInteger(l.a) || !Number.isInteger(l.b)) continue;
			if (l.a === l.b || l.a < 0 || l.b < 0 || l.a >= n || l.b >= n) continue;
			const w = Number.isFinite(l.weight) ? Math.abs(l.weight) : 1;
			if (w > maxW) maxW = w;
			bonds.push({ a: l.a, b: l.b, w });
		}
		if (maxW > 0) for (const b of bonds) b.w /= maxW;
	}

	for (let it = 0; it < iterations; it += 1) {
		// 引力: 繋がっているグループを近づける（反発より弱くして重ならないようにする）
		for (const bond of bonds) {
			const pa = pts[bond.a];
			const pb = pts[bond.b];
			const dx = pb.x - pa.x;
			const dy = pb.y - pa.y;
			const d = Math.hypot(dx, dy);
			if (d < 1e-6) continue;
			// 半径の和を「ちょうど隣り合う距離」とみなし、それより遠い分だけ引き寄せる
			const rest = (radius[bond.a] + radius[bond.b]) * separation;
			if (d <= rest) continue;
			const pull = (d - rest) * LINK_ATTRACTION * bond.w;
			const ux = dx / d;
			const uy = dy / d;
			pa.x += ux * pull; pa.y += uy * pull;
			pb.x -= ux * pull; pb.y -= uy * pull;
		}

		// 反発: 半径の和より近いペアを押し離す
		for (let i = 0; i < n; i += 1) {
			for (let j = i + 1; j < n; j += 1) {
				const dx = pts[j].x - pts[i].x;
				const dy = pts[j].y - pts[i].y;
				const d = Math.hypot(dx, dy);
				const want = (radius[i] + radius[j]) * separation;
				if (d >= want) continue;
				// 完全に重なっている場合は決定的な向きへずらす（乱数を使わない）
				const ux = d > 1e-6 ? dx / d : Math.cos(i * 1.1 + j);
				const uy = d > 1e-6 ? dy / d : Math.sin(i * 1.1 + j);
				const push = (want - d) * 0.5;
				pts[i].x -= ux * push; pts[i].y -= uy * push;
				pts[j].x += ux * push; pts[j].y += uy * push;
			}
		}
		// 原点への弱い引力（全体が散らばりすぎないように）
		for (let i = 0; i < n; i += 1) {
			pts[i].x -= pts[i].x * ORIGIN_PULL / iterations * 4;
			pts[i].y -= pts[i].y * ORIGIN_PULL / iterations * 4;
		}
	}

	// 連続座標を格子セルへ丸める（1 単位 = spacing 1 の格子として解釈する）
	return pts.map(p => lattice.nearestCell(p.x, p.y, 1));
}

/**
 * グループごとにセルを割り当てる（容量制約つき多元六角 BFS）
 *
 * @description 種セルから同時に成長させ、**割当済みセルの隣だけ**を候補に積む。
 * これにより各グループのセル集合は必ず 6 近傍で連結する（不変条件 3）。
 * 候補の優先度は「種からの六角距離 + λ×原点からの六角距離」で、
 * 後者があることで全体が丸くまとまる。
 *
 * @param {Array<{key: string, size: number}>} groups - 表示順のグループ（`size` = マス数）
 * @param {Object} [options]
 * @param {number} [options.originWeight=0.15] - 原点方向へのバイアス λ
 * @param {number} [options.maxRing=200] - 種セルが埋まっていた場合の空き探索の上限
 * @param {LatticeAdapter} [options.lattice=HEX_LATTICE] - 格子アダプタ（三角格子なら `TRI_LATTICE`）
 * @returns {{cells: Map<string, number>, byGroup: Array<Array<{col: number, row: number}>>, seeds: Array<{col: number, row: number}>}}
 *   `cells` はセルキー -> グループ番号
 */
export function assignHexCells(groups, options = {}) {
	const ladder = Array.isArray(options.separationLadder) && options.separationLadder.length > 0
		? options.separationLadder
		: SEED_SEPARATION_LADDER;

	// 詰められるところまで詰め、囲い込みが起きたら間隔を広げて再試行する。
	// 段が固定なので機械の速さに依存せず決定的。
	let last = null;
	for (const separation of ladder) {
		last = assignHexCellsAt(groups, separation, options);
		if (last.fragmented.length === 0) return last;
	}
	return last;
}

/**
 * 指定した種間隔で 1 回だけ割当を試す
 * @param {Array<{key: string, size: number}>} groups
 * @param {number} separation - 種同士を離す距離の係数
 * @param {Object} [options]
 * @returns {{cells: Map<string, number>, byGroup: Array, seeds: Array, fragmented: Array, separation: number}}
 */
function assignHexCellsAt(groups, separation, options = {}) {
	const originWeight = Number.isFinite(options.originWeight) ? options.originWeight : 0.15;
	const maxRing = Number.isFinite(options.maxRing) ? options.maxRing : 200;
	const lattice = options.lattice || HEX_LATTICE;

	const list = Array.isArray(groups) ? groups : [];
	const sizes = list.map(g => Math.max(0, Math.floor(g?.size ?? 0)));
	const seeds = relaxSeeds(sizes, RELAX_ITERATIONS, separation, options.links, lattice);

	/** @type {Map<string, number>} セルキー -> グループ番号 */
	const cells = new Map();
	/** @type {Array<Array<{col: number, row: number}>>} */
	const byGroup = list.map(() => []);
	const remaining = sizes.slice();
	const origin = { col: 0, row: 0 };

	/**
	 * グループごとに独立したヒープを持つ（**成長速度を揃えるため**）
	 *
	 * @description ヒープを 1 本にしてコスト順で確定させると、
	 * 大きいグループが先に食べ進んで小さいグループの成長先を塞ぎ、
	 * 容量を満たせないグループが出る（実測: 陣営別で 40 マス要求に対し 32 マスしか取れなかった）。
	 * グループごとにヒープを分け、1 巡につき 1 マスずつ交代で取ることで成長速度が揃う。
	 */
	const heaps = list.map(() => new CellHeap());

	// 種セルを確保する。既に埋まっていたら螺旋状に空きを探す
	const placedSeeds = [];
	for (let g = 0; g < list.length; g += 1) {
		if (sizes[g] <= 0) { placedSeeds.push(seeds[g]); continue; }
		let seed = null;
		for (const c of lattice.spiralCells(seeds[g].col, seeds[g].row, maxRing)) {
			if (!cells.has(cellKey(c))) { seed = c; break; }
		}
		if (!seed) seed = seeds[g];
		placedSeeds.push(seed);
		cells.set(cellKey(seed), g);
		byGroup[g].push(seed);
		remaining[g] -= 1;
		for (const nb of lattice.neighbors(seed.col, seed.row)) {
			heaps[g].push({
				cost: 1 + originWeight * lattice.distance(nb, origin),
				group: g, col: nb.col, row: nb.row, from: g
			});
		}
	}

	/** 囲い込まれて成長できなくなったグループ */
	const starved = new Set();

	// 1 巡につき各グループが 1 マスずつ取る（交代制）
	for (;;) {
		let progressed = false;

		for (let g = 0; g < list.length; g += 1) {
			if (remaining[g] <= 0 || starved.has(g)) continue;

			// 自分のヒープから最初に見つかった空きセルを取る
			let placed = null;
			const heap = heaps[g];
			while (heap.size > 0) {
				const item = heap.pop();
				const k = `${item.col},${item.row}`;
				if (cells.has(k)) continue;
				placed = item;
				break;
			}

			if (!placed) {
				// 隣接する空きが尽きた＝他のグループに囲い込まれた
				starved.add(g);
				continue;
			}

			cells.set(`${placed.col},${placed.row}`, g);
			byGroup[g].push({ col: placed.col, row: placed.row });
			remaining[g] -= 1;
			progressed = true;

			if (remaining[g] <= 0) continue;
			const seed = placedSeeds[g];
			for (const nb of lattice.neighbors(placed.col, placed.row)) {
				if (cells.has(cellKey(nb))) continue;
				heaps[g].push({
					cost: lattice.distance(nb, seed) + originWeight * lattice.distance(nb, origin),
					group: g, col: nb.col, row: nb.row, from: g
				});
			}
		}

		if (!progressed) break;
	}

	/**
	 * 囲い込まれたグループの残りを、塊にいちばん近い空きセルへ退避させる
	 *
	 * @description **「セル数 = メンバー数」は譲れない不変条件**なので、
	 * ここだけは連結性より容量を優先する（マスを数えて人数が分かることが最優先）。
	 *
	 * 退避先は**塊のセル全体を始点にした BFS** で探すので、
	 * 「塊から最も近い空きセル」から順に埋まる。囲い込まれている以上は距離 1 の空きが無いが、
	 * たいていは距離 2（他グループのセルを 1 つ挟んだ向こう側）に着地するので、
	 * 図の上では「境界のすぐ外」に見えて離島にはなりにくい。
	 *
	 * 退避が起きたグループは `fragmented` に記録して呼び出し側が把握できるようにする。
	 */
	const fragmented = [];
	for (const g of starved) {
		if (remaining[g] <= 0) continue;

		// 自グループのセルすべてを始点にした BFS（通り道は空きセルのみ）
		const visited = new Set(byGroup[g].map(cellKey));
		let frontier = byGroup[g].slice();
		let added = 0;
		let maxDist = 0;

		for (let d = 1; d <= maxRing && remaining[g] > 0; d += 1) {
			const next = [];
			for (const c of frontier) {
				for (const nb of lattice.neighbors(c.col, c.row)) {
					const k = cellKey(nb);
					if (visited.has(k)) continue;
					visited.add(k);
					if (cells.has(k)) {
						// 他グループのセル。通り抜けて先を探す
						next.push(nb);
						continue;
					}
					if (remaining[g] <= 0) continue;
					cells.set(k, g);
					byGroup[g].push({ col: nb.col, row: nb.row });
					remaining[g] -= 1;
					added += 1;
					maxDist = d;
					// 置いたセルの隣も次の候補にする（小片自体を成長させる）
					next.push(nb);
				}
			}
			if (next.length === 0) break;
			frontier = next;
		}

		if (added > 0) fragmented.push({ group: g, cells: added, maxDistance: maxDist });
	}

	return { cells, byGroup, seeds: placedSeeds, fragmented, separation };
}

/**
 * 各グループの境界セルに印を付ける
 *
 * @description 近傍のいずれかが「別グループ」または「未割当」なら境界。
 * 塊の輪郭だけを濃い枠で描くことで、面をベタ塗りせずに区画の形を見せられる。
 * @param {Map<string, number>} cells - `assignHexCells()` の `cells`
 * @param {Array<Array<{col: number, row: number}>>} byGroup
 * @param {LatticeAdapter} [lattice=HEX_LATTICE] - 格子アダプタ（三角格子なら `TRI_LATTICE`）
 * @returns {Set<string>} 境界セルのキー集合
 */
export function markBoundaryCells(cells, byGroup, lattice = HEX_LATTICE) {
	const boundary = new Set();
	for (const list of byGroup) {
		for (const c of list) {
			const mine = cells.get(cellKey(c));
			for (const nb of lattice.neighbors(c.col, c.row)) {
				if (cells.get(cellKey(nb)) !== mine) { boundary.add(cellKey(c)); break; }
			}
		}
	}
	return boundary;
}

/**
 * 各グループの代表セル（アンカー）を選ぶ
 *
 * @description ラベルの置き場所・エッジの接続先・ドリルの当たり判定に使う。
 * 「そのグループの重心に最も近い自グループのセル」を選ぶので、
 * 塊がいびつでも必ず塊の内側に来る。同点は (行, 列) で解く。
 * @param {Array<Array<{col: number, row: number}>>} byGroup
 * @param {number} [spacing=1]
 * @param {LatticeAdapter} [lattice=HEX_LATTICE] - 格子アダプタ（三角格子なら `TRI_LATTICE`）
 * @returns {Array<{col: number, row: number, x: number, y: number}|null>}
 */
export function pickAnchorCells(byGroup, spacing = 1, lattice = HEX_LATTICE) {
	return byGroup.map(list => {
		if (!list || list.length === 0) return null;
		let sx = 0;
		let sy = 0;
		for (const c of list) {
			const p = lattice.point(c.col, c.row, spacing);
			sx += p.x; sy += p.y;
		}
		const cx = sx / list.length;
		const cy = sy / list.length;

		let best = null;
		let bestD = Infinity;
		for (const c of list) {
			const p = lattice.point(c.col, c.row, spacing);
			const d = Math.hypot(p.x - cx, p.y - cy);
			// 同点は (行, 列) の小さい方で必ず解く（決定性）
			if (d < bestD - 1e-9 || (Math.abs(d - bestD) < 1e-9 && best && (c.row < best.row || (c.row === best.row && c.col < best.col)))) {
				best = c; bestD = d;
			}
		}
		const p = lattice.point(best.col, best.row, spacing);
		return { col: best.col, row: best.row, x: p.x, y: p.y };
	});
}

/**
 * グループ同士の隣接関係を求める
 *
 * @description 一方のセルが他方のセルの近傍にあれば隣接。濃度段の貪欲彩色に使う。
 * @param {Map<string, number>} cells
 * @param {Array<Array<{col: number, row: number}>>} byGroup
 * @param {LatticeAdapter} [lattice=HEX_LATTICE] - 格子アダプタ（三角格子なら `TRI_LATTICE`）
 * @returns {Array<Set<number>>} グループ番号 -> 隣接グループ番号の集合
 */
export function buildGroupAdjacency(cells, byGroup, lattice = HEX_LATTICE) {
	const adj = byGroup.map(() => new Set());
	for (let g = 0; g < byGroup.length; g += 1) {
		for (const c of byGroup[g]) {
			for (const nb of lattice.neighbors(c.col, c.row)) {
				const other = cells.get(cellKey(nb));
				if (other === undefined || other === g) continue;
				adj[g].add(other);
				adj[other].add(g);
			}
		}
	}
	return adj;
}

/**
 * 隣接グループへ同じ濃度段を割り当てないように彩色する
 *
 * @description 貪欲彩色。段数が足りない場合は「隣接に無い段のうち最小」が取れないので
 * 使用回数の最も少ない段へ落とす（見た目の破綻より、必ず値が返ることを優先）。
 * 走査順は「隣接数の多い順 → グループ番号順」で固定し、決定的にする。
 * @param {Array<Set<number>>} adjacency
 * @param {number} shadeCount - 使える濃度段の数
 * @returns {number[]} グループ番号 -> 濃度段のインデックス
 */
export function assignShadeSteps(adjacency, shadeCount) {
	const n = adjacency.length;
	const steps = new Array(n).fill(-1);
	if (n === 0) return steps;
	const total = Math.max(1, Math.floor(shadeCount) || 1);

	// 隣接の多いグループから決める（後になるほど選択肢が狭まるため）
	const order = Array.from({ length: n }, (_, i) => i)
		.sort((a, b) => adjacency[b].size - adjacency[a].size || a - b);

	const usage = new Array(total).fill(0);
	for (const g of order) {
		const taken = new Set();
		for (const nb of adjacency[g]) if (steps[nb] >= 0) taken.add(steps[nb]);

		let pick = -1;
		for (let s = 0; s < total; s += 1) {
			if (!taken.has(s)) { pick = s; break; }
		}
		if (pick < 0) {
			// 段が足りない: 使用回数が最も少ない段へ（同点は小さい番号）
			pick = 0;
			for (let s = 1; s < total; s += 1) if (usage[s] < usage[pick]) pick = s;
		}
		steps[g] = pick;
		usage[pick] += 1;
	}
	return steps;
}

/**
 * マス塗りの割当を一括で作る
 *
 * @description `assignHexCells` → `markBoundaryCells` → `pickAnchorCells`
 * → `buildGroupAdjacency` → `assignShadeSteps` をまとめて実行し、描画に必要な形へ整える。
 *
 * @param {Array<{key: string, label: string, size: number}>} groups
 * @param {Object} [options]
 * @param {number} [options.spacing=38] - セル間隔（px）。集約段はキャラ個体段より細かく取る
 * @param {number} [options.shadeCount=6] - 使える濃度段の数
 * @param {number} [options.originWeight=0.15]
 * @param {LatticeAdapter} [options.lattice=HEX_LATTICE] - 格子アダプタ。三角格子タイルにするなら `TRI_LATTICE` を渡す
 * @returns {{groups: Array<Object>, cells: Array<Object>, bounds: {minX: number, minY: number, maxX: number, maxY: number, width: number, height: number}, totalCells: number}}
 */
export function buildHexFill(groups, options = {}) {
	const spacing = Number.isFinite(options.spacing) && options.spacing > 0 ? options.spacing : 38;
	const shadeCount = Number.isFinite(options.shadeCount) ? options.shadeCount : 6;
	const lattice = options.lattice || HEX_LATTICE;

	const list = Array.isArray(groups) ? groups : [];
	const { cells, byGroup, seeds } = assignHexCells(list, { originWeight: options.originWeight, links: options.links, lattice, maxRing: options.maxRing, separationLadder: options.separationLadder });
	const boundary = markBoundaryCells(cells, byGroup, lattice);
	const anchors = pickAnchorCells(byGroup, spacing, lattice);
	const shades = assignShadeSteps(buildGroupAdjacency(cells, byGroup, lattice), shadeCount);

	/** 描画用のフラットなセル一覧 */
	const flat = [];
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let g = 0; g < byGroup.length; g += 1) {
		for (const c of byGroup[g]) {
			const p = lattice.point(c.col, c.row, spacing);
			flat.push({
				col: c.col, row: c.row, x: p.x, y: p.y,
				group: g, shade: shades[g], boundary: boundary.has(cellKey(c))
			});
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.x > maxX) maxX = p.x;
			if (p.y > maxY) maxY = p.y;
		}
	}
	if (flat.length === 0) { minX = minY = maxX = maxY = 0; }

	// セル半径ぶんだけ外へ広げる（格子の種類ごとにタイル形状が違うので lattice に聞く）
	const { padX, padY } = lattice.cellPadding(spacing);

	return {
		groups: list.map((g, i) => ({
			...g,
			index: i,
			shade: shades[i],
			seed: seeds[i],
			anchor: anchors[i],
			cellCount: byGroup[i].length
		})),
		cells: flat,
		/**
		 * セルキー（`"col,row"`）-> グループ番号。
		 * 当たり判定（どの区画を押したか）と輪郭描画（隣が別グループかの判定）で毎フレーム引くので、
		 * 線形探索にならないよう索引を持たせる
		 */
		cellIndex: cells,
		bounds: {
			minX: minX - padX, minY: minY - padY, maxX: maxX + padX, maxY: maxY + padY,
			width: (maxX - minX) + padX * 2, height: (maxY - minY) + padY * 2
		},
		totalCells: flat.length
	};
}
