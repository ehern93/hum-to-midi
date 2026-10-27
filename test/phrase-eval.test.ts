import { it, expect } from 'vitest';
import { analyze } from '../src/phrase';
import { synthMelody, Spec } from '../tools/hum-synth';
// 40 random melodies in C major, 1-3 beat notes, human-ish imperfections. Reports note-level accuracy.
it('random melodies accuracy', () => { let seed = 11; const r = () => (seed = (seed * 48271) % 2147483647) / 2147483647; const SC = [0, 2, 4, 5, 7, 9, 11];
  let tot = 0, pOk = 0, allOk = 0, cntOk = 0, mel = 0;
  for (let k = 0; k < 40; k++) { const bpm = 80 + Math.floor(r() * 50); const m: Spec[] = []; let beats = 0;
    while (beats < 14) { const d = 1 + Math.floor(r() * 3); m.push({ p: 55 + SC[Math.floor(r() * 7)] + (r() < .4 ? 12 : 0), beats: d }); beats += d; }
    const x = synthMelody(m, bpm, { jitter: .1, vib: .45, detune: .3, noise: .01, seed: k + 1, gap: .02 + r() * .08 });
    const g = analyze(x, 44100, bpm).notes; let s = 0; const e = m.map(n => { const o = { p: n.p, s, d: n.beats }; s += n.beats; return o; });
    tot += e.length; if (g.length === e.length) cntOk++; let same = true;
    e.forEach((n, i) => { const h = g[i]; if (h && h.p === n.p) pOk++; if (h && h.p === n.p && h.s === n.s && h.d === n.d) allOk++; else same = false; }); if (same && g.length === e.length) mel++; }
  process.stderr.write(`notes ${tot}: pitch ${(100 * pOk / tot).toFixed(1)}%  pitch+rhythm ${(100 * allOk / tot).toFixed(1)}%  note count right ${cntOk}/40  perfect melodies ${mel}/40\n`);
  expect(pOk / tot).toBeGreaterThan(.9); });
