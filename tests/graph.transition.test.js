import { describe, it, expect } from 'vitest';
import {
	planZoomInto,
	planZoomOut,
	computeFrame,
	staggerDelays
} from '../lib/graph/graph-transition.js';

describe('graph-transition', () => {
	const from = { zoom: 1, pan: { x: 10, y: 20 } };
	const to = { zoom: 2, pan: { x: 110, y: 220 } };

	it('reduce motion では duration=0 になる', () => {
		expect(planZoomInto(from, to, { reducedMotion: true }).durationMs).toBe(0);
		expect(planZoomOut(from, to, { reducedMotion: true }).durationMs).toBe(0);
	});

	it('先頭/末尾フレームは from/to と一致する', () => {
		const p = planZoomInto(from, to, { durationMs: 200 });
		const s = computeFrame(p, 0);
		expect(s.zoom).toBeCloseTo(1);
		expect(s.pan.x).toBeCloseTo(10);
		expect(s.pan.y).toBeCloseTo(20);
		expect(s.done).toBe(false);

		const e = computeFrame(p, 200);
		expect(e.zoom).toBeCloseTo(2);
		expect(e.pan.x).toBeCloseTo(110);
		expect(e.pan.y).toBeCloseTo(220);
		expect(e.done).toBe(true);
	});

	it('中間フレームは from/to の間に入る', () => {
		const p = planZoomInto(from, to, { durationMs: 200 });
		const m = computeFrame(p, 100);
		expect(m.zoom).toBeGreaterThan(1);
		expect(m.zoom).toBeLessThan(2);
		expect(m.pan.x).toBeGreaterThan(10);
		expect(m.pan.x).toBeLessThan(110);
	});

	it('staggerDelays は上限付きで単調増加する', () => {
		const d = staggerDelays(8, { stepMs: 30, maxMs: 90 });
		expect(d).toEqual([0, 30, 60, 90, 90, 90, 90, 90]);
	});
});
