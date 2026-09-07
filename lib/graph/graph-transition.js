/**
 * graph-transition.js - 相関図ビュー遷移（ズーム/パン）の純関数ユーティリティ
 *
 * @description
 * drill の前後で viewport をいきなり切り替えると位置の対応が追いにくいので、
 * 「開始ビュー -> 目標ビュー」を短時間で補間する。
 *
 * DOM 非依存の純関数を中心にし、描画反映だけ `commitFrame()` で分離する。
 */

/** @param {number} v @returns {number} */
function clamp01(v) {
	if (!Number.isFinite(v)) return 0;
	if (v <= 0) return 0;
	if (v >= 1) return 1;
	return v;
}

/** @param {number} a @param {number} b @param {number} t @returns {number} */
function lerp(a, b, t) {
	return a + (b - a) * t;
}

/** @param {number} t @returns {number} */
function easeOutCubic(t) {
	const x = 1 - clamp01(t);
	return 1 - x * x * x;
}

/**
 * drill-in 用の遷移計画
 * @param {{zoom:number, pan:{x:number,y:number}}} from
 * @param {{zoom:number, pan:{x:number,y:number}}} to
 * @param {{reducedMotion?:boolean, durationMs?:number}} [options]
 * @returns {{from:Object,to:Object,durationMs:number,easing:string}}
 */
export function planZoomInto(from, to, options = {}) {
	const reduced = Boolean(options.reducedMotion);
	const duration = reduced ? 0 : Math.max(0, Number(options.durationMs) || 260);
	return { from, to, durationMs: duration, easing: 'easeOutCubic' };
}

/**
 * drill-out 用の遷移計画
 * @param {{zoom:number, pan:{x:number,y:number}}} from
 * @param {{zoom:number, pan:{x:number,y:number}}} to
 * @param {{reducedMotion?:boolean, durationMs?:number}} [options]
 * @returns {{from:Object,to:Object,durationMs:number,easing:string}}
 */
export function planZoomOut(from, to, options = {}) {
	const reduced = Boolean(options.reducedMotion);
	const duration = reduced ? 0 : Math.max(0, Number(options.durationMs) || 220);
	return { from, to, durationMs: duration, easing: 'easeOutCubic' };
}

/**
 * 指定経過時間のフレームを計算する
 * @param {{from:Object,to:Object,durationMs:number,easing:string}} plan
 * @param {number} elapsedMs
 * @returns {{zoom:number, pan:{x:number,y:number}, done:boolean}}
 */
export function computeFrame(plan, elapsedMs) {
	const d = Math.max(0, Number(plan?.durationMs) || 0);
	if (d === 0) {
		return {
			zoom: Number(plan?.to?.zoom) || 1,
			pan: {
				x: Number(plan?.to?.pan?.x) || 0,
				y: Number(plan?.to?.pan?.y) || 0
			},
			done: true
		};
	}

	const raw = clamp01((Number(elapsedMs) || 0) / d);
	const t = plan?.easing === 'easeOutCubic' ? easeOutCubic(raw) : raw;
	const fromZoom = Number(plan?.from?.zoom) || 1;
	const toZoom = Number(plan?.to?.zoom) || 1;
	const fromX = Number(plan?.from?.pan?.x) || 0;
	const fromY = Number(plan?.from?.pan?.y) || 0;
	const toX = Number(plan?.to?.pan?.x) || 0;
	const toY = Number(plan?.to?.pan?.y) || 0;

	return {
		zoom: lerp(fromZoom, toZoom, t),
		pan: { x: lerp(fromX, toX, t), y: lerp(fromY, toY, t) },
		done: raw >= 1
	};
}

/**
 * フレームを Cytoscape へ反映する
 * @param {{zoom:(v:number)=>void, pan:(p:{x:number,y:number})=>void}} cy
 * @param {{zoom:number, pan:{x:number,y:number}}} frame
 */
export function commitFrame(cy, frame) {
	if (!cy || !frame) return;
	cy.zoom(frame.zoom);
	cy.pan(frame.pan);
}

/**
 * 遅延列を作る（順次表示の下準備）
 * @param {number} count
 * @param {{stepMs?:number,maxMs?:number}} [options]
 * @returns {number[]}
 */
export function staggerDelays(count, options = {}) {
	const n = Math.max(0, Math.floor(Number(count) || 0));
	const step = Math.max(0, Number(options.stepMs) || 18);
	const max = Math.max(0, Number(options.maxMs) || 220);
	const out = [];
	for (let i = 0; i < n; i += 1) out.push(Math.min(max, i * step));
	return out;
}
