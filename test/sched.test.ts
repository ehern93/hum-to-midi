import { describe, it, expect } from 'vitest';
import { plan } from '../src/sched';
const loop = { on: true, s: 0, e: 16 };
describe('scheduler plan (regression: freeze at loop end)', () => {
  it('wraps the loop once and terminates', () => {
    const spb = 0.6; const c = { schedBeat: 15.9, startBeat: 0, startCtxTime: 0 }; const now = 16 * spb - 0.05;
    const r = plan(c, now, spb, loop); expect(r.segs.length).toBe(2); expect(r.segs[1].from).toBe(0); expect(r.clock.startBeat).toBe(0);
    expect(r.clock.schedBeat).toBeLessThan(1); expect(r.clock.startCtxTime).toBeCloseTo(16 * spb);
  });
  it('simulated 10 minutes of playback stays bounded', () => {
    const spb = 0.6; let c = { schedBeat: 0, startBeat: 0, startCtxTime: 0 }; let total = 0;
    for (let t = 0; t < 600; t += 0.025) { const r = plan(c, t, spb, loop); c = r.clock; total += r.segs.length; expect(r.segs.length).toBeLessThanOrEqual(2); for (const s of r.segs) expect(s.to - s.from).toBeLessThan(2); }
    expect(total).toBeGreaterThan(1000);
  });
  it('skips missed music after a stall instead of bursting', () => {
    const spb = 0.5; const r = plan({ schedBeat: 2, startBeat: 0, startCtxTime: 0 }, 30, spb, loop);
    const beats = r.segs.reduce((a, s) => a + s.to - s.from, 0); expect(beats).toBeLessThan(1); expect(r.clock.schedBeat).toBeLessThan(16);
  });
  it('degenerate loop (e<=s) does not hang', () => { const r = plan({ schedBeat: 4, startBeat: 4, startCtxTime: 0 }, 1, 0.5, { on: true, s: 4, e: 4 }); expect(r.segs.length).toBe(1); });
});
