/**
 * graph-layout.js - 相関図のノード配置（ヘキサグラム格子へのスナップ）
 *
 * @description
 * 力学レイアウト（Cytoscape の `cose`）は密なグラフだとノードが偏って団子になる。
 * 収束後の座標を**六角格子（ハニカム）の格子点へスナップ**して均等感を出す。
 *
 * ## なぜ六角格子か
 *
 * 正方格子より充填が均等で、隣接 6 方向の距離が等しいためエッジの長さが揃いやすい。
 * 「見た目の密度が一定」になるので、ノードが多い作品でも粗密の差が出にくい。
 *
 * ## スナップの方針
 *
 * 1. 力学レイアウトの相対位置（どのノードがどのノードの近くか）は**壊さない**
 * 2. 格子点は 1 ノードにつき 1 つ。奪い合いは「元座標が格子点に近い順」で解決する
 * 3. 空いた格子点が無ければ、螺旋状に外側へ探索する
 *
 * ## 画面に収めることを優先しない
 *
 * 格子の間隔は**ノードが潰れない最小サイズ**から決める。
 * 収まらない場合は縮小せず、そのままはみ出させてパン/ズームで見る
 * （User の指示: 「画面の大きさ上ノードがつぶれてしまう場合、無理して全体表示しなくても大丈夫」）。
 *
 * DOM 非依存の純関数のみ。**Service Worker の `importScripts()` へは追加しないこと**（ES モジュール）。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 */

/** 六角格子の行間係数（正六角形の充填では √3/2） */
const ROW_RATIO = Math.sqrt(3) / 2;

/**
 * 1 セルの縦横比（高さ = 幅 × この値）
 *
 * @description `hexPoint()` が張る格子は「6 近傍すべてが距離 `spacing`」の三角格子で、
 * その各格子点のボロノイ胞は **pointy-top（頂点が上下）の正六角形**になる。
 * 対辺間距離（flat-to-flat・横幅）が `spacing`、頂点間（縦の高さ）が `spacing × 2/√3`。
 * つまり**既存の格子はそのまま「六角タイルの中心座標表」**として使える。
 */
export const HEX_CELL_ASPECT = 2 / Math.sqrt(3);

/**
 * 行が奇数か（奇数行は半セル分だけ右へずれる）
 * @description `hexPoint()` の offset 判定と**必ず同じ式**を使う。ここがずれると近傍が壊れる。
 * @param {number} row @returns {boolean}
 */
function isOddRow(row) {
	return Math.abs(row % 2) === 1;
}

/**
 * セルの 6 近傍を返す
 *
 * @description 奇数行が `spacing/2` 右へずれる格子（odd-r オフセット）なので、
 * 上下の行における列オフセットが行の偶奇で変わる。
 * 偶数行は `col-1` / `col`、奇数行は `col` / `col+1` が上下の隣になる。
 * @param {number} col @param {number} row
 * @returns {Array<{col: number, row: number}>} 常に 6 要素
 */
export function hexNeighbors(col, row) {
	const [da, db] = isOddRow(row) ? [0, 1] : [-1, 0];
	return [
		{ col: col - 1, row },
		{ col: col + 1, row },
		{ col: col + da, row: row - 1 },
		{ col: col + db, row: row - 1 },
		{ col: col + da, row: row + 1 },
		{ col: col + db, row: row + 1 }
	];
}

/**
 * 2 セル間の六角距離（何歩で到達できるか）
 *
 * @description odd-r オフセット座標を cube 座標へ直してから求める。
 * ユークリッド距離ではなく**格子上の歩数**なので、セル割当の成長コストに使える。
 * @param {{col: number, row: number}} a @param {{col: number, row: number}} b
 * @returns {number}
 */
export function hexDistance(a, b) {
	const toCube = (c) => {
		// 奇数行が右へずれる前提。`isOddRow()` と同じ判定を使う
		const q = c.col - (c.row - (isOddRow(c.row) ? 1 : 0)) / 2;
		const r = c.row;
		return { x: q, z: r, y: -q - r };
	};
	const p = toCube(a);
	const q = toCube(b);
	return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z));
}

/**
 * 六角格子の格子点座標を返す
 *
 * @description 奇数行を半セル分ずらすことでハニカム配置になる。
 * @param {number} col - 列インデックス（0 起点、負値可）
 * @param {number} row - 行インデックス（0 起点、負値可）
 * @param {number} spacing - 隣接格子点の距離
 * @returns {{x: number, y: number}}
 */
export function hexPoint(col, row, spacing) {
	const offset = (Math.abs(row % 2) === 1) ? spacing / 2 : 0;
	return { x: col * spacing + offset, y: row * spacing * ROW_RATIO };
}

/**
 * 座標から最寄りの格子セル（列・行）を求める
 * @param {number} x @param {number} y @param {number} spacing
 * @returns {{col: number, row: number}}
 */
export function nearestCell(x, y, spacing) {
	if (!(spacing > 0)) return { col: 0, row: 0 };
	const row = Math.round(y / (spacing * ROW_RATIO));
	const offset = (Math.abs(row % 2) === 1) ? spacing / 2 : 0;
	const col = Math.round((x - offset) / spacing);
	return { col, row };
}

/**
 * セルの周囲を螺旋状に探索する（空き格子点を探すため）
 *
 * @description 距離 1, 2, 3… のリングを順に返す。近い順に舐めるので、
 * スナップ結果が元の相対位置から大きく離れにくい。
 * @param {number} col @param {number} row @param {number} maxRing
 * @yields {{col: number, row: number}}
 */
export function* spiralCells(col, row, maxRing = 40) {
	yield { col, row };
	for (let ring = 1; ring <= maxRing; ring += 1) {
		for (let dc = -ring; dc <= ring; dc += 1) {
			for (let dr = -ring; dr <= ring; dr += 1) {
				// リングの外周だけ（内側は前のリングで走査済み）
				if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
				yield { col: col + dc, row: row + dr };
			}
		}
	}
}

/**
 * ノード座標を六角格子へスナップする
 *
 * @param {Array<{id: string, x: number, y: number}>} positions - 力学レイアウト後の座標
 * @param {Object} [options]
 * @param {number} [options.spacing=110] - 格子間隔。ノードが潰れない最小サイズから決める
 * @param {number} [options.maxRing=40] - 空き探索の最大リング
 * @returns {Array<{id: string, x: number, y: number, col: number, row: number}>}
 */
export function snapToHexLattice(positions, options = {}) {
	const spacing = Number.isFinite(options.spacing) && options.spacing > 0 ? options.spacing : 110;
	const maxRing = Number.isFinite(options.maxRing) ? options.maxRing : 40;
	const list = Array.isArray(positions) ? positions.filter(p => p && typeof p.id === 'string') : [];
	if (list.length === 0) return [];

	// 元座標が「理想の格子点」に近いノードから先に確定させる。
	// 後から来たノードほど押し出されるが、螺旋探索で近傍に収まる
	const ranked = list.map(p => {
		const cell = nearestCell(p.x, p.y, spacing);
		const ideal = hexPoint(cell.col, cell.row, spacing);
		const dist = Math.hypot(p.x - ideal.x, p.y - ideal.y);
		return { ...p, cell, dist };
	}).sort((a, b) => a.dist - b.dist);

	/** @type {Set<string>} 使用済み格子点 */
	const taken = new Set();
	const out = [];

	for (const p of ranked) {
		let placed = null;
		for (const c of spiralCells(p.cell.col, p.cell.row, maxRing)) {
			const key = `${c.col},${c.row}`;
			if (taken.has(key)) continue;
			taken.add(key);
			placed = c;
			break;
		}
		// 探索し尽くした場合は元座標のまま置く（実用上ここには来ない）
		if (!placed) { out.push({ id: p.id, x: p.x, y: p.y, col: p.cell.col, row: p.cell.row }); continue; }
		const pt = hexPoint(placed.col, placed.row, spacing);
		out.push({ id: p.id, x: pt.x, y: pt.y, col: placed.col, row: placed.row });
	}

	return out;
}

/* ========================================================================
   三角格子（正三角形タイル）— 六角格子（上記）の並行実装
   ========================================================================
   段階移行のため、六角格子の関数群はそのまま残し、三角格子版を別名で追加する。
   `graph-hexfill.js` / `graph-edge-route.js` / `pages/relations.js` 側の
   切り替えが終わるまでは、六角版・三角版が同居する。
   ======================================================================== */

/**
 * セルが「上向き」（頂点が上）三角形かどうか
 *
 * @description `col + row` の偶奇だけで決まる。偶数なら上向き、奇数なら下向き。
 * 負の col/row でも正しく判定できるよう、JS の `%` の結果を正の剰余へ正規化する。
 * @param {number} col @param {number} row @returns {boolean}
 */
export function isTriUp(col, row) {
	return ((col + row) % 2 + 2) % 2 === 0;
}

/**
 * セルの 3 近傍を返す
 *
 * @description 正三角形タイルは**辺で接する隣が 3 つ**しかない（六角格子の 6 方向とは根本的に違う）。
 * 同じ行の左右（col ±1）はどちらの向きでも共通。縦方向だけ向きで変わり、
 * 上向きは 1 つ下の行（row+1）、下向きは 1 つ上の行（row-1）が対になる
 * （2 つの三角形が互いの底辺を共有する形になる。`isTriUp()` と必ず同じ式で判定すること）。
 * @param {number} col @param {number} row
 * @returns {Array<{col: number, row: number}>} 常に 3 要素
 */
export function triNeighbors(col, row) {
	const vertical = isTriUp(col, row) ? { col, row: row + 1 } : { col, row: row - 1 };
	return [{ col: col - 1, row }, { col: col + 1, row }, vertical];
}

/**
 * 三角格子の格子点（タイルの重心）座標を返す
 *
 * @description `spacing` は隣接タイルの重心間距離（`hexPoint()` の `spacing` と同じ意味で揃えてある）。
 * 正三角形の一辺 `s` は重心間距離の √3 倍になる（重心間距離が一辺の 1/√3 になる幾何から逆算）。
 * x はどちらの向きでも `(col+1) × s/2` に一致し、y だけ上向き/下向きで
 * 行内オフセット（2h/3 or h/3）が変わる（h は三角形の高さ）。
 * @param {number} col @param {number} row @param {number} spacing
 * @returns {{x: number, y: number}}
 */
export function triPoint(col, row, spacing) {
	const s = spacing * Math.sqrt(3);
	const h = s * ROW_RATIO;
	const cx = ((col + 1) * s) / 2;
	const cy = row * h + (isTriUp(col, row) ? (2 * h) / 3 : h / 3);
	return { x: cx, y: cy };
}

/**
 * 座標から最寄りの三角セル（列・行）を求める
 *
 * @description 三角格子は列オフセットが六角格子より複雑（同じ行に上向き/下向きが交互に並ぶ）ため、
 * 式で一発には求めず、おおよその row/col から 3×3 の候補を実距離で比べて確定させる
 * （呼び出し頻度は低い＝ホバー当たり判定・スナップ時のみなので計算量は問題にならない）。
 * @param {number} x @param {number} y @param {number} spacing
 * @returns {{col: number, row: number}}
 */
export function nearestTriCell(x, y, spacing) {
	if (!(spacing > 0)) return { col: 0, row: 0 };
	const s = spacing * Math.sqrt(3);
	const h = s * ROW_RATIO;
	const rowGuess = Math.floor(y / h);
	const colGuess = Math.round((x * 2) / s - 1);
	let best = { col: colGuess, row: rowGuess };
	let bestDist = Infinity;
	for (let dr = -1; dr <= 1; dr += 1) {
		for (let dc = -1; dc <= 1; dc += 1) {
			const c = colGuess + dc;
			const r = rowGuess + dr;
			const p = triPoint(c, r, spacing);
			const d = Math.hypot(x - p.x, y - p.y);
			if (d < bestDist) { bestDist = d; best = { col: c, row: r }; }
		}
	}
	return best;
}

/**
 * 2 セル間の三角格子距離（何歩で到達できるか）
 *
 * @description 六角格子は cube 座標で距離を式一発で求められるが、三角格子は隣接が 3 方向・
 * 非対称（縦移動が向きで片側にしか進めない）なため閉じた式にしにくい。
 * `triNeighbors()` を辿る幅優先探索で正確に求める（`graph-hexfill.js` の
 * 貪欲成長で優先度計算に使う想定＝距離は小さい範囲で呼ばれる）。
 * @param {{col: number, row: number}} a @param {{col: number, row: number}} b
 * @param {number} [maxRing=60] - 打ち切り上限（届かない場合はこの値を返す。実用上は来ない）
 * @returns {number}
 */
export function triDistance(a, b, maxRing = 60) {
	if (a.col === b.col && a.row === b.row) return 0;
	const goalKey = `${b.col},${b.row}`;
	const visited = new Set([`${a.col},${a.row}`]);
	let frontier = [a];
	for (let ring = 1; ring <= maxRing; ring += 1) {
		const next = [];
		for (const cell of frontier) {
			for (const nb of triNeighbors(cell.col, cell.row)) {
				const key = `${nb.col},${nb.row}`;
				if (visited.has(key)) continue;
				if (key === goalKey) return ring;
				visited.add(key);
				next.push(nb);
			}
		}
		frontier = next;
	}
	return maxRing;
}

/**
 * セルの周囲を三角格子上で幅優先に探索する（空き格子点を探すため）
 *
 * @description 六角格子の `spiralCells()` は等差の座標演算だけでリングを作れるが、
 * 三角格子は隣接が 3 方向で非対称なため、`triNeighbors()` を辿る BFS でリングを作る。
 * 同じリング内の順序は「先に見つかった隣から」で決定的（乱数を使わない）。
 * @param {number} col @param {number} row @param {number} maxRing
 * @yields {{col: number, row: number}}
 */
export function* spiralTriCells(col, row, maxRing = 40) {
	yield { col, row };
	const visited = new Set([`${col},${row}`]);
	let frontier = [{ col, row }];
	for (let ring = 1; ring <= maxRing; ring += 1) {
		const next = [];
		for (const cell of frontier) {
			for (const nb of triNeighbors(cell.col, cell.row)) {
				const key = `${nb.col},${nb.row}`;
				if (visited.has(key)) continue;
				visited.add(key);
				next.push(nb);
			}
		}
		for (const cell of next) yield cell;
		frontier = next;
	}
}

/**
 * ノード座標を三角格子へスナップする
 *
 * @description `snapToHexLattice()` の三角格子版。方針は同じ
 * （元の相対位置は壊さない／近い順に確定／空きが無ければ螺旋状に外側へ）。
 * @param {Array<{id: string, x: number, y: number}>} positions - 力学レイアウト後の座標
 * @param {Object} [options]
 * @param {number} [options.spacing=110] - 格子間隔（隣接タイルの重心間距離）
 * @param {number} [options.maxRing=40] - 空き探索の最大リング
 * @returns {Array<{id: string, x: number, y: number, col: number, row: number}>}
 */
export function snapToTriLattice(positions, options = {}) {
	const spacing = Number.isFinite(options.spacing) && options.spacing > 0 ? options.spacing : 110;
	const maxRing = Number.isFinite(options.maxRing) ? options.maxRing : 40;
	const list = Array.isArray(positions) ? positions.filter(p => p && typeof p.id === 'string') : [];
	if (list.length === 0) return [];

	const ranked = list.map(p => {
		const cell = nearestTriCell(p.x, p.y, spacing);
		const ideal = triPoint(cell.col, cell.row, spacing);
		const dist = Math.hypot(p.x - ideal.x, p.y - ideal.y);
		return { ...p, cell, dist };
	}).sort((a, b) => a.dist - b.dist);

	/** @type {Set<string>} 使用済み格子点 */
	const taken = new Set();
	const out = [];

	for (const p of ranked) {
		let placed = null;
		for (const c of spiralTriCells(p.cell.col, p.cell.row, maxRing)) {
			const key = `${c.col},${c.row}`;
			if (taken.has(key)) continue;
			taken.add(key);
			placed = c;
			break;
		}
		if (!placed) { out.push({ id: p.id, x: p.x, y: p.y, col: p.cell.col, row: p.cell.row }); continue; }
		const pt = triPoint(placed.col, placed.row, spacing);
		out.push({ id: p.id, x: pt.x, y: pt.y, col: placed.col, row: placed.row });
	}

	return out;
}

/**
 * ノード数と最小ノードサイズから、潰れない格子間隔を決める
 *
 * @description **画面サイズに合わせて縮めない。** 収まらなければはみ出させ、パン/ズームで見る。
 * @param {Object} [options]
 * @param {number} [options.nodeSize=46] - ノードの一辺（角丸タイルの大きさ）
 * @param {number} [options.labelWidth=0] - ラベルの想定幅（0 ならノードサイズのみで決める）
 * @param {number} [options.gap=28] - ノード間に最低限空ける余白
 * @returns {number} 格子間隔
 */
export function resolveSpacing(options = {}) {
	const nodeSize = Number.isFinite(options.nodeSize) ? options.nodeSize : 46;
	const labelWidth = Number.isFinite(options.labelWidth) ? options.labelWidth : 0;
	const gap = Number.isFinite(options.gap) ? options.gap : 28;
	return Math.max(nodeSize, labelWidth) + gap;
}

/**
 * スナップ結果の外接矩形を返す（fit するかの判断材料）
 * @param {Array<{x: number, y: number}>} positions
 * @param {number} [padding=40]
 * @returns {{minX: number, minY: number, maxX: number, maxY: number, width: number, height: number}}
 */
export function boundsOf(positions, padding = 40) {
	const list = Array.isArray(positions) ? positions : [];
	if (list.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const p of list) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	return {
		minX: minX - padding, minY: minY - padding,
		maxX: maxX + padding, maxY: maxY + padding,
		width: (maxX - minX) + padding * 2,
		height: (maxY - minY) + padding * 2
	};
}

/**
 * 全体表示したときの倍率が実用下限を下回るか判定する
 *
 * @description 下回る場合は fit せず、等倍付近で表示してパン/ズームに委ねる。
 * @param {{width: number, height: number}} bounds
 * @param {{width: number, height: number}} viewport
 * @param {number} [minZoom=0.45] - これ未満に縮むならノードが潰れて読めない
 * @returns {{fits: boolean, zoom: number}}
 */
export function shouldFitToViewport(bounds, viewport, minZoom = 0.45) {
	if (!bounds?.width || !bounds?.height || !viewport?.width || !viewport?.height) {
		return { fits: true, zoom: 1 };
	}
	const zoom = Math.min(viewport.width / bounds.width, viewport.height / bounds.height);
	return { fits: zoom >= minZoom, zoom };
}
