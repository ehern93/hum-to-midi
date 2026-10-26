// Pure look-ahead scheduler planning (no audio). Returns the beat segments to schedule and the new transport anchor.
// Root-cause fix: the look-ahead horizon is recomputed after every loop wrap, and iterations are bounded,
// so a loop end can never spin forever or burst-schedule missed loops after a stall.
export interface Clock { schedBeat: number; startBeat: number; startCtxTime: number }
export interface Seg { from: number; to: number; t0: number; b0: number } // play notes with from<=s<to at time t0+(s-b0)*spb
export function plan(c: Clock, now: number, spb: number, loop: { on: boolean; s: number; e: number }, lookahead = 0.12): { segs: Seg[]; clock: Clock } {
  let { schedBeat, startBeat, startCtxTime } = c; const segs: Seg[] = []; const L = loop.on && loop.e > loop.s ? loop : null;
  const posAt = (t: number) => (t - startCtxTime) / spb + startBeat;
  // after a long stall (background tab, GC) don't replay the missed music: jump to "now"
  if (posAt(now) - schedBeat > 1) { schedBeat = posAt(now);
    if (L && schedBeat >= L.e) { const len = L.e - L.s; const nb = L.s + ((schedBeat - L.s) % len); startCtxTime = now; startBeat = nb; schedBeat = nb; } }
  for (let guard = 0; guard < 8; guard++) {
    const ahead = posAt(now + lookahead); if (schedBeat >= ahead) break;
    const end = L && schedBeat < L.e ? Math.min(ahead, L.e) : ahead;
    segs.push({ from: schedBeat, to: end, t0: startCtxTime, b0: startBeat });
    if (L && end === L.e && end < ahead) { startCtxTime = startCtxTime + (L.e - startBeat) * spb; startBeat = L.s; schedBeat = L.s; continue; }
    schedBeat = end; break;
  }
  return { segs, clock: { schedBeat, startBeat, startCtxTime } };
}
