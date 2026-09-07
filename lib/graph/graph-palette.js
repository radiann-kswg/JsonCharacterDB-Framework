/**
 * graph-palette.js - 相関図が Cytoscape へ渡す色を JS 側で組み立てる
 *
 * @description
 * キャラシートのデザイントークン（`pages/characters.sass` の `:root`）を土台に、
 * **新しい色を一つも増やさずに**相関図の配色を作るための純関数群。
 *
 * ## なぜ CSS の `color-mix()` を使わないのか（実測で確定した制約）
 *
 * `characters.sass` は `color-mix(in srgb, var(--accent) N%, …)` の濃度ラダーを 8 段使っている。
 * 同じ手を相関図でも使いたくなるが、**Cytoscape は canvas 描画なので通らない**。
 *
 * | 経路 | 実測結果 |
 * | --- | --- |
 * | `getComputedStyle().getPropertyValue('--mix24')` | `"color-mix(in srgb, #5fd6ff 24%, #0f1830)"` が**未解決の文字列のまま**返る（未登録カスタムプロパティは置換されない） |
 * | Cytoscape へ `color-mix(...)` を渡す | **拒否して `#999` へフォールバック**。例外は投げず警告のみ |
 * | Cytoscape へ `color(srgb …)` / `oklab()` を渡す | 同上 |
 * | `getComputedStyle` でプローブ要素から取り出す | Chromium は `color(srgb …)`、Firefox は `rgb()` を返す＝**エンジン依存** |
 *
 * 「色が出ない」のではなく「**灰色になるだけで気づけない**」のが厄介なので、
 * 相関図では CSS 側の関数に頼らず、ここで実値を作って `rgb()` / `rgba()` として渡す。
 *
 * `mixSrgb()` の結果はブラウザの `color-mix(in srgb, …)` と **12/12 のケースで数値一致**することを実測済み。
 * 仕様は「ガンマ符号化 sRGB の成分ごと線形補間」＝ CSS の `in srgb` と同じ。
 *
 * ## 色を「カテゴリ」ではなく「状態」に使う
 *
 * 相関図の集約表示は六角格子のマス塗りなので、**格子上の位置とラベルがグループの識別子**になる。
 * つまり N 色の循環パレットでカテゴリを塗り分ける必要がそもそも無い。
 * 色は「選択・ホバー・強調」といった状態にだけ使い、グループの区別は
 * 濃度段（`shadeLadder()`）＋境界セルの枠＋ラベル＋凡例の多重符号化で行う。
 *
 * DOM 非依存の純関数のみ。**Service Worker の `importScripts()` へは追加しないこと**（ES モジュール）。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 */

/**
 * `characters.sass` の `:root` で宣言されている色トークンの既定値
 *
 * @description 実行時は `getComputedStyle` で実値を取るのが正だが、
 * DOM の無い環境（テスト・Node）でも同じ結果になるようフォールバックを持つ。
 * **ここに新しい色を足さないこと。** 相関図は既存トークンの範囲で組む。
 */
export const TOKEN_FALLBACKS = Object.freeze({
	'--bg': '#070b16',
	'--bg-deep': '#05080f',
	'--fg': '#e9f3ff',
	'--muted': '#9fb6d6',
	'--card': '#0f1830',
	'--accent': '#5fd6ff',
	'--accent-bright': '#9be9ff',
	'--accent-2': '#9a8cff',
	'--azure': '#3a86e0',
	'--border': '#1d2a4a',
	'--success': '#2bd4a0',
	'--warning': '#f7b733',
	'--error': '#ff5d6c'
});

/**
 * 濃度ラダーの刻み（%）
 *
 * @description `characters.sass` で実際に稼働している 8 段
 * （`:860,863,1457,1502,1504,1547,1549,1559` の 6/8/10/18/20/24/30/40%）から、
 * 面塗りとして視認できる差が付く 6 段を選んだもの。
 * 隣接するグループに同じ段を割り当てない貪欲彩色（`graph-hexfill.js`）と組み合わせて使う。
 * 隣接セルの境界が視認しやすいよう、元の 6/8/10/18/20/24% よりも幅を広げてある（色相は追加せず同一系統のまま）。
 */
export const SHADE_STEPS = Object.freeze([6, 14, 22, 30, 38, 48]);

/** 3 桁 / 6 桁の hex を受ける */
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** `rgb(1 2 3)` / `rgb(1,2,3)` / `rgba(1,2,3,.5)` を受ける */
const RGB_RE = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)(?:[\s,/]+([0-9.]+%?))?\s*\)$/i;

/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
function clamp(v, lo, hi) {
	return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * 色文字列を `{r, g, b, a}`（r/g/b は 0-255、a は 0-1）へ解析する
 *
 * @description hex（3/4/6/8 桁）と `rgb()` / `rgba()` を受ける。
 * `color-mix()` / `color(srgb …)` / 色名は**受けない**（Cytoscape が拒否する形式を
 * ここで通してしまうと、結局 `#999` になる問題を先送りするだけなので明示的に失敗させる）。
 * @param {string} input
 * @returns {{r: number, g: number, b: number, a: number}|null} 解析できなければ null
 */
export function parseColor(input) {
	const s = String(input || '').trim();
	if (!s) return null;

	const hex = HEX_RE.exec(s);
	if (hex) {
		const h = hex[1];
		if (h.length === 3 || h.length === 4) {
			const [r, g, b, a] = h.split('').map(c => parseInt(c + c, 16));
			return { r, g, b, a: h.length === 4 ? a / 255 : 1 };
		}
		const r = parseInt(h.slice(0, 2), 16);
		const g = parseInt(h.slice(2, 4), 16);
		const b = parseInt(h.slice(4, 6), 16);
		const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
		return { r, g, b, a };
	}

	const rgb = RGB_RE.exec(s);
	if (rgb) {
		const alphaRaw = rgb[4];
		const a = alphaRaw === undefined
			? 1
			: (alphaRaw.endsWith('%') ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw));
		return {
			r: clamp(Math.round(parseFloat(rgb[1])), 0, 255),
			g: clamp(Math.round(parseFloat(rgb[2])), 0, 255),
			b: clamp(Math.round(parseFloat(rgb[3])), 0, 255),
			a: clamp(Number.isFinite(a) ? a : 1, 0, 1)
		};
	}

	return null;
}

/**
 * `{r, g, b, a}` を Cytoscape が受理する文字列へ整形する
 * @param {{r: number, g: number, b: number, a: number}} c
 * @returns {string} `rgb(r, g, b)` または `rgba(r, g, b, a)`
 */
export function formatColor(c) {
	const r = clamp(Math.round(c.r), 0, 255);
	const g = clamp(Math.round(c.g), 0, 255);
	const b = clamp(Math.round(c.b), 0, 255);
	const a = clamp(Number.isFinite(c.a) ? c.a : 1, 0, 1);
	// 不透明なら rgb() を返す（Cytoscape のスタイル差分比較で余計な揺れを作らない）
	if (a >= 1) return `rgb(${r}, ${g}, ${b})`;
	return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

/**
 * CSS の `color-mix(in srgb, colorA <ratio>%, colorB)` と同じ結果を返す
 *
 * @description ガンマ符号化 sRGB の成分ごと線形補間。
 * アルファがある場合はプリマルチプライしてから混ぜ、最後に戻す（CSS の `in srgb` と同じ）。
 *
 * ブラウザ実測との一致例（`--accent: #5fd6ff` / `--border: #1d2a4a` / `--card: #0f1830`）:
 *
 * | 式 | 結果 |
 * | --- | --- |
 * | `mixSrgb(accent, border, 0.18)` | `rgb(41, 73, 107)` |
 * | `mixSrgb(accent, border, 0.24)` | `rgb(45, 83, 117)` |
 * | `mixSrgb(accent, border, 0.40)` | `rgb(55, 111, 146)` |
 * | `mixSrgb(accent, card, 0.08)` | `rgb(21, 39, 65)` |
 *
 * @param {string} colorA - 混ぜる色（`ratio` の比率で入る側）
 * @param {string} colorB - 混ぜられる色（残りの比率）
 * @param {number} ratio - 0-1。`color-mix` の `N%` に対応（0.24 = 24%）
 * @returns {string} `rgb()` / `rgba()` 文字列。解析できなければ `colorB` をそのまま返す
 */
export function mixSrgb(colorA, colorB, ratio) {
	const a = parseColor(colorA);
	const b = parseColor(colorB);
	if (!a || !b) return String(colorB || colorA || '');

	const t = clamp(Number.isFinite(ratio) ? ratio : 0, 0, 1);
	const alpha = a.a * t + b.a * (1 - t);

	// 両方とも不透明な通常ケースは単純な成分補間で足りる
	if (a.a >= 1 && b.a >= 1) {
		return formatColor({
			r: a.r * t + b.r * (1 - t),
			g: a.g * t + b.g * (1 - t),
			b: a.b * t + b.b * (1 - t),
			a: 1
		});
	}

	// 半透明が絡む場合はプリマルチプライしてから混ぜる
	if (alpha <= 0) return formatColor({ r: 0, g: 0, b: 0, a: 0 });
	const mix = (ca, cb) => (ca * a.a * t + cb * b.a * (1 - t)) / alpha;
	return formatColor({ r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b), a: alpha });
}

/**
 * 色に不透明度を掛けた `rgba()` を返す
 * @param {string} color @param {number} alpha - 0-1
 * @returns {string}
 */
export function withAlpha(color, alpha) {
	const c = parseColor(color);
	if (!c) return String(color || '');
	return formatColor({ ...c, a: c.a * clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1) });
}

/**
 * デザイントークンを読み出す関数を作る
 *
 * @description ブラウザでは `getComputedStyle` から実値を取り、取れなければ `TOKEN_FALLBACKS` に落ちる。
 * DOM の無い環境ではフォールバックだけで動く（テストがブラウザ非依存になる）。
 *
 * **`color-mix()` を含むカスタムプロパティは読まないこと。** 未登録のカスタムプロパティは
 * `getComputedStyle` が未解決の文字列をそのまま返すため、Cytoscape へ渡すと無言で `#999` になる。
 * 濃度段が要る場合は生のトークンを読んでから `mixSrgb()` で作る。
 *
 * @param {Object} [doc] - `document` 相当（省略時は `globalThis.document`）
 * @returns {(name: string) => string} トークン名（`--accent` 等）を実値へ解決する関数
 */
export function createTokenReader(doc) {
	const d = doc || (typeof globalThis !== 'undefined' ? globalThis.document : null);
	const root = d?.documentElement || null;
	const view = d?.defaultView || (typeof globalThis !== 'undefined' ? globalThis : null);
	const canRead = Boolean(root && typeof view?.getComputedStyle === 'function');

	/** @type {Map<string, string>} 起動中は変わらない前提でキャッシュする */
	const cache = new Map();

	return (name) => {
		const key = String(name || '').trim();
		if (!key) return '';
		if (cache.has(key)) return cache.get(key);

		let value = '';
		if (canRead) {
			try {
				value = String(view.getComputedStyle(root).getPropertyValue(key) || '').trim();
			} catch {
				value = '';
			}
		}
		// 解析できない値（`color-mix(...)` が素通りした等）はフォールバックへ落とす。
		// ここで弾かないと Cytoscape 側で無言の #999 になる
		if (!value || !parseColor(value)) value = TOKEN_FALLBACKS[key] || value;

		cache.set(key, value);
		return value;
	};
}

/**
 * グループの濃度段を作る
 *
 * @description `base` を `into` へ `SHADE_STEPS` の比率で混ぜた色の配列を返す。
 * 段数を増やすほど隣接段の差が縮むので、`graph-hexfill.js` の貪欲彩色で
 * 「隣り合うグループに同じ段を割り当てない」ことと合わせて使う前提。
 *
 * @param {string} base - 濃くしていく色（既定は `--accent`）
 * @param {string} into - 地の色（既定は `--card`）
 * @param {number[]} [steps=SHADE_STEPS] - 各段の % 値
 * @returns {string[]} `rgb()` 文字列の配列（薄い順）
 */
export function shadeLadder(base, into, steps = SHADE_STEPS) {
	const list = Array.isArray(steps) && steps.length > 0 ? steps : SHADE_STEPS;
	return list.map(pct => mixSrgb(base, into, pct / 100));
}

/**
 * 相関図が使う色をまとめて解決する
 *
 * @description 起動時に 1 回だけ呼び、結果を使い回す（`getComputedStyle` は同期レイアウトを誘発するので
 * 描画のたびに呼ばない）。返す値はすべて Cytoscape が受理する `rgb()` / `rgba()` 文字列。
 *
 * ## エッジ種別の色について
 *
 * 従来は同一存在に `--success`（緑）、主従に `--warning`（橙）を使っていたが、
 * これは「状態を表す意味論色」の目的外流用だった。相関図は水色〜紺の単一系統へ寄せ、
 * `--success` / `--warning` は本来の状態語彙へ返す。
 * 線種（solid / dashed / dotted）との二重符号化が既にあるので、色を寄せても識別性は落ちない。
 *
 * @param {(name: string) => string} [readToken] - `createTokenReader()` の戻り値
 * @returns {Object} 解決済みのパレット
 */
export function buildPalette(readToken) {
	const t = typeof readToken === 'function' ? readToken : createTokenReader();
	const token = (name) => t(name) || TOKEN_FALLBACKS[name] || '#888888';

	const accent = token('--accent');
	const accentBright = token('--accent-bright');
	const accent2 = token('--accent-2');
	const azure = token('--azure');
	const card = token('--card');
	const bgDeep = token('--bg-deep');
	const border = token('--border');
	const muted = token('--muted');
	const fg = token('--fg');

	return Object.freeze({
		// 生トークン（そのまま渡してよい実値）
		accent, accentBright, accent2, azure, card, bgDeep, border, muted, fg,

		/** グループのマス塗りに使う濃度段（薄い順） */
		shades: Object.freeze(shadeLadder(accent, card)),

		/** マスの境界セルの枠。塊の輪郭だけを濃く見せる */
		cellBorder: mixSrgb(accent, border, 0.4),
		/** マス内部のセルの枠。ほぼ地に沈める */
		cellBorderInner: mixSrgb(accent, border, 0.14),
		/**
		 * ポインタが乗っている区画の塗り
		 * @description 濃度段の最大（40%）より濃くして、どの段の区画が乗っても必ず「起きて」見えるようにする。
		 * 色相は変えない（`characters.sass:1478-1487` の沈める / 起こす作法）
		 */
		hoverFill: mixSrgb(accent, card, 0.56),

		/** キャラクタータイルの地と枠 */
		nodeFill: card,
		nodeBorder: border,
		/** 選択・強調（色相は変えず accent で縁取る） */
		nodeBorderActive: accent,
		nodeLabel: fg,

		/** エッジ種別の色（水色〜紺の単一系統へ寄せる） */
		edge: Object.freeze({
			related: accent,
			sameBeing: accentBright,
			master: azure,
			variant: accent2,
			commented: muted
		}),

		/** 減光した要素（周囲を沈めて選択項目を浮かせる） */
		dimAlpha: 0.22
	});
}
