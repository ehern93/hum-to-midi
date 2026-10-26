import { describe, it, expect } from 'vitest';
import { polish } from '../src/polish';
import { SCALES } from '../src/music';
import { PRESETS, presetNotes } from '../src/drums';
const base = { bpm: 120, latencyMs: 100, strength: 1, grid: 0.5, root: 0, scale: SCALES.major };
describe('polish', () => {
  it('compensates latency and quantizes', () => {
    const r = polish([{ p: 60, s: 0.25, d: 0.9, v: .8 }, { p: 62, s: 1.2, d: 0.8, v: .8 }], base); // 100ms = 0.2 beats
    expect(r.map(n => n.s)).toEqual([0, 1]); expect(r[0].p).toBe(60);
  });
  it('merges jitter and blips, snaps to scale', () => {
    const r = polish([{ p: 64, s: 0, d: 0.5, v: .8 }, { p: 65, s: 0.52, d: 0.04, v: .8 }, { p: 64, s: 0.58, d: 0.4, v: .8 }, { p: 61, s: 1.2, d: 0.9, v: .8 }], { ...base, latencyMs: 0 });
    expect(r.length).toBe(2); expect(r[0].p).toBe(64); expect([60, 62]).toContain(r[1].p);
  });
  it('partial strength moves toward grid', () => {
    const r = polish([{ p: 60, s: 0.2, d: 1, v: .8 }], { ...base, latencyMs: 0, strength: 0.5 }); expect(r[0].s).toBeCloseTo(0.1);
  });
  it('no overlaps', () => {
    const r = polish([{ p: 60, s: 0, d: 2, v: .8 }, { p: 67, s: 1, d: 1, v: .8 }], { ...base, latencyMs: 0 }); expect(r[0].s + r[0].d).toBeLessThanOrEqual(r[1].s);
  });
});
describe('drum presets', () => { it('all build', () => { for (const p of PRESETS) expect(presetNotes(p, 2).every(n => n.s >= 8 && n.s < 12)).toBe(true); }); });
