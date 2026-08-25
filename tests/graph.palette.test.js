/**
 * graph-palette.js のテスト
 *
 * @description 最重要は **`mixSrgb()` がブラウザの `color-mix(in srgb, …)` と数値一致すること**。
 * ここがずれると、SASS 側の `color-mix()` で塗った面と Cytoscape 側で塗った面の色が微妙に食い違う。
 *
 * 期待値は Chromium（HeadlessChrome 148）で
 * `getComputedStyle(probe).color` から実測した値をそのまま固定している。
 * `--accent: #5fd6ff` / `--accent-bright: #9be9ff` / `--azure: #3a86e0`
 * / `--card: #0f1830` / `--border: #1d2a4a` は `pages/characters.sass` の `:root` 実値。
 */
import { describe, it, expect } from 'vitest';
import {
	parseColor,
	formatColor,
	mixSrgb,
	withAlpha,
	shadeLadder,
	buildPalette,
	createTokenReader,
	TOKEN_FALLBACKS,
	SHADE_STEPS
} from '../lib/graph/graph-palette.js';

const ACCENT = '#5fd6ff';
const ACCENT_BRIGHT = '#9be9ff';
const AZURE = '#3a86e0';
const CARD = '#0f1830';
const BORDER = '#1d2a4a';

describe('parseColor / formatColor', () => {
	it('6 桁 hex を解析する', () => {
		expect(parseColor('#5fd6ff')).toEqual({ r: 95, g: 214, b: 255, a: 1 });
	});

	it('3 桁 hex を解析する', () => {
		expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
	});

	it('8 桁 hex のアルファを解析する', () => {
		const c = parseColor('#5fd6ff80');
		expect(c.r).toBe(95);
		expect(c.a).toBeCloseTo(128 / 255, 5);
	});

	it('rgb() / rgba() を解析する', () => {
		expect(parseColor('rgb(95, 214, 255)')).toEqual({ r: 95, g: 214, b: 255, a: 1 });
		expect(parseColor('rgba(95,214,255,0.5)')).toEqual({ r: 95, g: 214, b: 255, a: 0.5 });
		expect(parseColor('rgb(95 214 255 / 50%)')).toEqual({ r: 95, g: 214, b: 255, a: 0.5 });
	});

	it('Cytoscape が拒否する形式は解析しない（先送りせず明示的に失敗させる）', () => {
		// これらを通してしまうと Cytoscape 側で無言の #999 になり、目視で気づけなくなる
		expect(parseColor('color-mix(in srgb, #5fd6ff 24%, #0f1830)')).toBeNull();
		expect(parseColor('color(srgb 0.37 0.84 1)')).toBeNull();
		expect(parseColor('oklab(0.5 0.1 0.1)')).toBeNull();
		expect(parseColor('rebeccapurple')).toBeNull();
		expect(parseColor('')).toBeNull();
		expect(parseColor(null)).toBeNull();
	});

	it('不透明なら rgb()、半透明なら rgba() を返す', () => {
		expect(formatColor({ r: 1, g: 2, b: 3, a: 1 })).toBe('rgb(1, 2, 3)');
		expect(formatColor({ r: 1, g: 2, b: 3, a: 0.5 })).toBe('rgba(1, 2, 3, 0.5)');
	});

	it('範囲外の値をクランプする', () => {
		expect(formatColor({ r: -10, g: 300, b: 128, a: 2 })).toBe('rgb(0, 255, 128)');
	});
});

describe('mixSrgb がブラウザの color-mix(in srgb, …) と一致する', () => {
	// 先頭 4 件（★）は Chromium（HeadlessChrome 148）で
	// `getComputedStyle(probe).color` から取得した実測値。
	// 残りは同じ規則（成分ごと線形補間 → 四捨五入）で導いた値で、
	// `characters.sass` が実際に使っている比率と、相関図で使う比率を網羅している。
	it.each([
		['★ accent 18% → border', ACCENT, BORDER, 0.18, 'rgb(41, 73, 107)'],
		['★ accent 24% → border', ACCENT, BORDER, 0.24, 'rgb(45, 83, 117)'],
		['★ accent 40% → border', ACCENT, BORDER, 0.40, 'rgb(55, 111, 146)'],
		['★ accent 8% → card', ACCENT, CARD, 0.08, 'rgb(21, 39, 65)'],
		['accent 30% → border', ACCENT, BORDER, 0.30, 'rgb(49, 94, 128)'],
		['accent 6% → card', ACCENT, CARD, 0.06, 'rgb(20, 35, 60)'],
		['accent 10% → card', ACCENT, CARD, 0.10, 'rgb(23, 43, 69)'],
		['accent 20% → card', ACCENT, CARD, 0.20, 'rgb(31, 62, 89)'],
		['azure 24% → card', AZURE, CARD, 0.24, 'rgb(25, 50, 90)'],
		['accent-bright 40% → card', ACCENT_BRIGHT, CARD, 0.40, 'rgb(71, 108, 131)'],
		['ratio 0 は colorB そのもの', ACCENT, CARD, 0, 'rgb(15, 24, 48)'],
		['ratio 1 は colorA そのもの', ACCENT, CARD, 1, 'rgb(95, 214, 255)']
	])('%s', (_label, a, b, ratio, expected) => {
		expect(mixSrgb(a, b, ratio)).toBe(expected);
	});

	it('成分ごと線形補間の定義そのものと一致する（期待値表の裏取り）', () => {
		// 期待値表を手で書き写す過程での取り違えを防ぐため、定義から独立に検算する
		const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
		for (const [a, b] of [[ACCENT, BORDER], [ACCENT, CARD], [AZURE, CARD], [ACCENT_BRIGHT, CARD]]) {
			const [ar, ag, ab] = hex(a);
			const [br, bg, bb] = hex(b);
			for (const pct of [6, 8, 10, 18, 20, 24, 30, 40]) {
				const t = pct / 100;
				const want = `rgb(${Math.round(ar * t + br * (1 - t))}, ${Math.round(ag * t + bg * (1 - t))}, ${Math.round(ab * t + bb * (1 - t))})`;
				expect(mixSrgb(a, b, t), `${a} ${pct}% → ${b}`).toBe(want);
			}
		}
	});

	it('ratio は 0-1 にクランプされる', () => {
		expect(mixSrgb(ACCENT, CARD, -1)).toBe(mixSrgb(ACCENT, CARD, 0));
		expect(mixSrgb(ACCENT, CARD, 5)).toBe(mixSrgb(ACCENT, CARD, 1));
	});

	it('解析できない色が来たら colorB を返す（#999 へ落とさない）', () => {
		expect(mixSrgb('color-mix(in srgb, red 50%, blue)', CARD, 0.5)).toBe(CARD);
	});

	it('半透明はプリマルチプライして混ぜる', () => {
		// 完全透明 50% と不透明 50% を混ぜると、色は不透明側そのまま・アルファは 0.5
		const out = mixSrgb('rgba(255, 0, 0, 0)', 'rgb(0, 0, 255)', 0.5);
		expect(out).toBe('rgba(0, 0, 255, 0.5)');
	});

	it('戻り値は必ず Cytoscape が受理する形式（rgb / rgba）', () => {
		for (const pct of SHADE_STEPS) {
			expect(mixSrgb(ACCENT, CARD, pct / 100)).toMatch(/^rgba?\([0-9]+, [0-9]+, [0-9]+(, [0-9.]+)?\)$/);
		}
	});
});

describe('withAlpha', () => {
	it('不透明色へアルファを掛ける', () => {
		expect(withAlpha(ACCENT, 0.25)).toBe('rgba(95, 214, 255, 0.25)');
	});

	it('既存のアルファへ乗算する', () => {
		expect(withAlpha('rgba(95, 214, 255, 0.5)', 0.5)).toBe('rgba(95, 214, 255, 0.25)');
	});

	it('alpha 1 なら rgb() へ戻る', () => {
		expect(withAlpha(ACCENT, 1)).toBe('rgb(95, 214, 255)');
	});
});

describe('shadeLadder', () => {
	it('SHADE_STEPS の段数ぶん返す', () => {
		expect(shadeLadder(ACCENT, CARD)).toHaveLength(SHADE_STEPS.length);
	});

	it('薄い順に並び、すべて異なる色になる', () => {
		const ladder = shadeLadder(ACCENT, CARD);
		expect(new Set(ladder).size).toBe(ladder.length);
		// accent は card より明るいので、混ぜる比率が上がるほど各成分が単調増加する
		const values = ladder.map(c => parseColor(c));
		for (let i = 1; i < values.length; i += 1) {
			expect(values[i].r).toBeGreaterThan(values[i - 1].r);
			expect(values[i].g).toBeGreaterThan(values[i - 1].g);
			expect(values[i].b).toBeGreaterThan(values[i - 1].b);
		}
	});

	it('隣接段が視認できる差を持つ（成分差 4 以上）', () => {
		// 差が小さすぎると濃度段による識別が成立しない
		const values = shadeLadder(ACCENT, CARD).map(c => parseColor(c));
		for (let i = 1; i < values.length; i += 1) {
			const d = Math.max(
				values[i].r - values[i - 1].r,
				values[i].g - values[i - 1].g,
				values[i].b - values[i - 1].b
			);
			expect(d).toBeGreaterThanOrEqual(4);
		}
	});
});

describe('createTokenReader', () => {
	it('DOM が無ければフォールバックを返す', () => {
		const read = createTokenReader(null);
		expect(read('--accent')).toBe(TOKEN_FALLBACKS['--accent']);
		expect(read('--card')).toBe(TOKEN_FALLBACKS['--card']);
	});

	it('getComputedStyle が color-mix を返してもフォールバックへ落とす', () => {
		// 未登録カスタムプロパティは未解決の文字列が返る。そのまま Cytoscape へ渡すと無言の #999 になる
		const fakeDoc = {
			documentElement: {},
			defaultView: {
				getComputedStyle: () => ({
					getPropertyValue: (n) => (n === '--accent' ? 'color-mix(in srgb, #5fd6ff 24%, #0f1830)' : '')
				})
			}
		};
		expect(createTokenReader(fakeDoc)('--accent')).toBe(TOKEN_FALLBACKS['--accent']);
	});

	it('解析できる実値はそのまま採用する', () => {
		const fakeDoc = {
			documentElement: {},
			defaultView: {
				getComputedStyle: () => ({ getPropertyValue: (n) => (n === '--accent' ? '  #123456  ' : '') })
			}
		};
		expect(createTokenReader(fakeDoc)('--accent')).toBe('#123456');
	});
});

describe('buildPalette', () => {
	const palette = buildPalette(createTokenReader(null));

	it('すべての色が Cytoscape の受理する形式か生 hex である', () => {
		const values = [
			palette.accent, palette.accentBright, palette.accent2, palette.azure,
			palette.card, palette.bgDeep, palette.border, palette.muted, palette.fg,
			palette.cellBorder, palette.cellBorderInner,
			palette.nodeFill, palette.nodeBorder, palette.nodeBorderActive, palette.nodeLabel,
			...palette.shades,
			...Object.values(palette.edge)
		];
		for (const v of values) {
			expect(parseColor(v), `解析できない色: ${v}`).not.toBeNull();
		}
	});

	it('意味論色（--success / --warning / --error）を使わない', () => {
		// 状態を表す色をカテゴリ色に流用しない。線種との二重符号化があるので識別性は落ちない
		const semantic = [TOKEN_FALLBACKS['--success'], TOKEN_FALLBACKS['--warning'], TOKEN_FALLBACKS['--error']];
		const used = [...Object.values(palette.edge), ...palette.shades, palette.cellBorder];
		for (const s of semantic) {
			expect(used).not.toContain(s);
		}
	});

	it('エッジ種別 5 種すべてに色が付き、互いに異なる', () => {
		const edges = Object.values(palette.edge);
		expect(edges).toHaveLength(5);
		expect(new Set(edges).size).toBe(5);
	});

	it('濃度段は SHADE_STEPS と同数', () => {
		expect(palette.shades).toHaveLength(SHADE_STEPS.length);
	});

	it('凍結されている（描画中に書き換わらない）', () => {
		expect(Object.isFrozen(palette)).toBe(true);
		expect(Object.isFrozen(palette.edge)).toBe(true);
		expect(Object.isFrozen(palette.shades)).toBe(true);
	});
});
