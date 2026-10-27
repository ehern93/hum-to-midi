// Synthetic "hum" generator for tests and the fake-mic WAV.
export interface Spec { p: number; beats: number }
export function synthMelody(mel: Spec[], bpm: number, o: { sr?: number; jitter?: number; vib?: number; gap?: number; noise?: number; seed?: number; lead?: number; detune?: number } = {}) {
  const sr = o.sr ?? 44100, b = 60 / bpm; let seed = o.seed ?? 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const lead = o.lead ?? .4; const total = lead + mel.reduce((s, n) => s + n.beats, 0) * b + .6; const x = new Float32Array(Math.ceil(total * sr));
  let t = lead; for (const n of mel) { const j = (rnd() * 2 - 1) * (o.jitter ?? 0) * b; const st = t + j; const dur = n.beats * b - (o.gap ?? .06) - Math.abs(j);
    const det = (rnd() * 2 - 1) * (o.detune ?? 0); const f0 = 440 * Math.pow(2, (n.p + det - 69) / 12); let ph = 0;
    const i0 = Math.floor(st * sr), i1 = Math.floor((st + dur) * sr);
    for (let i = i0; i < i1 && i < x.length; i++) { const tt = (i - i0) / sr; const f = f0 * Math.pow(2, (o.vib ?? 0) / 12 * Math.sin(2 * Math.PI * 5.5 * tt)); ph += 2 * Math.PI * f / sr;
      const env = Math.min(1, tt / .03, (i1 - i) / sr / .04); x[i] += env * .3 * (Math.sin(ph) + .5 * Math.sin(2 * ph) + .25 * Math.sin(3 * ph)); }
    t += n.beats * b; }
  if (o.noise) for (let i = 0; i < x.length; i++) x[i] += (rnd() * 2 - 1) * o.noise;
  return x; }
export const TWINKLE: Spec[] = [60, 60, 67, 67, 69, 69].map(p => ({ p, beats: 1 })).concat([{ p: 67, beats: 2 }], [65, 65, 64, 64, 62, 62].map(p => ({ p, beats: 1 })), [{ p: 60, beats: 2 }]);
export const ODE: Spec[] = [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64].map(p => ({ p, beats: 1 })).concat([{ p: 64, beats: 2 }, { p: 62, beats: 1 }, { p: 62, beats: 2 }]);
export const MINOR: Spec[] = [{ p: 57, beats: 1 }, { p: 60, beats: 1 }, { p: 64, beats: 2 }, { p: 62, beats: 1 }, { p: 60, beats: 1 }, { p: 59, beats: 2 }, { p: 57, beats: 3 }, { p: 64, beats: 1 }, { p: 69, beats: 4 }];
