// "Hum a Song": offline analysis of a hummed phrase -> beat-grid notes. Pure (runs in a worker or tests).
import { detectPitch } from './pitch';
export interface RawNote { t: number; dur: number; m: number }   // seconds, float midi
export interface GridNote { p: number; s: number; d: number; v: number }
export interface Phrase { notes: GridNote[]; key: { tonic: number; minor: boolean; name: string }; raw: RawNote[]; shift: number }
const KN = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJ_S = [0, 2, 4, 5, 7, 9, 11], MIN_S = [0, 2, 3, 5, 7, 8, 10];
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); const n = b.length; return n ? (n % 2 ? b[n >> 1] : (b[n / 2 - 1] + b[n / 2]) / 2) : NaN; };
const pc = (m: number) => ((Math.round(m) % 12) + 12) % 12;

/** Frame-by-frame pitch track (float midi or NaN when unvoiced) at ~11 kHz. */
export function track(x: Float32Array, sr: number) {
  const f = Math.max(1, Math.round(sr / 11025)); const r = sr / f; const n = Math.floor(x.length / f); const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < f; k++) s += x[i * f + k]; y[i] = s / f; } // box low-pass + decimate
  const N = 512, H = 128; const hop = H / r; const pitch: number[] = [], rms: number[] = [];
  for (let i = 0; i + N <= n; i += H) { const fr = y.subarray(i, i + N); const p = detectPitch(fr, r, .2, 70, 1000);
    rms.push(p.rms); pitch.push(p.freq > 0 && p.clarity > .75 ? 69 + 12 * Math.log2(p.freq / 440) : NaN); }
  const sorted = [...rms].sort((a, b) => a - b); const floor = Math.max(.008, (sorted[Math.floor(sorted.length * .95)] || 0) * .12);
  for (let i = 0; i < pitch.length; i++) if (rms[i] < floor) pitch[i] = NaN;
  // 5-frame median smoothing over voiced neighbours (kills octave glitches, keeps vibrato centre)
  const sm = pitch.map((v, i) => { if (isNaN(v)) return NaN; const w = pitch.slice(Math.max(0, i - 2), i + 3).filter(z => !isNaN(z)); return med(w); });
  return { pitch: sm, rms, hop, floor };
}

/** Split the track into notes using gaps, pitch changes and loudness onsets; drop short blips. */
export function segment(pitch: number[], rms: number[], hop: number, minDur = .09): RawNote[] {
  const out: RawNote[] = []; let cur: number[] = [], st = 0, gap = 0, off = 0;
  const close = (end: number) => { if (cur.length * hop >= minDur) out.push({ t: st * hop, dur: (end - st) * hop, m: med(cur) }); cur = []; off = 0; };
  for (let i = 0; i < pitch.length; i++) { const v = pitch[i];
    if (isNaN(v)) { if (cur.length && ++gap > 2) close(i - gap + 1); continue; }
    const onset = i >= 3 && rms[i] > 2.2 * rms[i - 3] && cur.length > 4;
    if (cur.length) { const c = med(cur.slice(-12)); if (Math.abs(v - c) > .8) off++; else off = 0;
      if (off >= 4 || onset) { const back = onset ? 0 : off - 1; const keep = cur.slice(0, cur.length - back); const end = i - back; cur = keep; close(end); st = end; cur = pitch.slice(end, i + 1).filter(z => !isNaN(z)); gap = 0; continue; } }
    if (!cur.length) st = i; cur.push(v); gap = 0; }
  if (cur.length) close(pitch.length);
  // fold short transition slivers into the contiguous neighbour (pitch glides between legato notes)
  const m: RawNote[] = out.map(n => ({ ...n }));
  for (let i = 0; i < m.length; i++) { const n = m[i]; if (n.dur >= .16) continue; const nx = m[i + 1], pv = m[i - 1];
    const cn = nx && nx.t - (n.t + n.dur) < .035 && nx.dur > n.dur, cp = pv && n.t - (pv.t + pv.dur) < .035 && pv.dur > n.dur;
    if (cn && (!cp || Math.abs(nx.m - n.m) <= Math.abs(pv.m - n.m))) { nx.dur += nx.t - n.t; nx.t = n.t; m.splice(i--, 1); }
    else if (cp) { pv.dur = n.t + n.dur - pv.t; m.splice(i--, 1); } }
  // join same-pitch pieces split only by a single dropped frame
  for (let i = 1; i < m.length; i++) { const p = m[i - 1], n = m[i]; if (Math.abs(p.m - n.m) < .5 && n.t - (p.t + p.dur) <= hop * 1.01) { p.dur = n.t + n.dur - p.t; m.splice(i--, 1); } }
  return m;
}

/** Krumhansl-Schmuckler key estimate from duration-weighted pitch classes. */
export function estimateKey(ns: RawNote[]) { const h = new Array(12).fill(0); for (const n of ns) h[pc(n.m)] += n.dur;
  const corr = (prof: number[], t: number) => { const a = h, b = prof.map((_, i) => prof[(i - t + 12) % 12]); const ma = a.reduce((s, v) => s + v, 0) / 12, mb = b.reduce((s, v) => s + v, 0) / 12;
    let num = 0, da = 0, db = 0; for (let i = 0; i < 12; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return da && db ? num / Math.sqrt(da * db) : 0; };
  let best = { tonic: 0, minor: false, r: -2 }; for (let t = 0; t < 12; t++) for (const minor of [false, true]) { const r = corr(minor ? MIN : MAJ, t); if (r > best.r) best = { tonic: t, minor, r }; }
  return { tonic: best.tonic, minor: best.minor, name: KN[best.tonic] + (best.minor ? ' minor' : ' major') }; }

/** Round to a semitone; if the pitch is ambiguous (between two semitones) or off-key by a hair, prefer the in-key neighbour. */
export function snapPitch(m: number, key: { tonic: number; minor: boolean }) { const sc = key.minor ? MIN_S : MAJ_S; const inKey = (q: number) => sc.includes(((q - key.tonic) % 12 + 12) % 12);
  const r = Math.round(m); if (inKey(r)) return r; const alt = m > r ? r + 1 : r - 1; return Math.abs(m - r) > .3 && inKey(alt) ? alt : r; }

/** Snap onsets/durations to whole beats (1-4) keeping order; rests are whole beats too. */
export function quantize(ns: RawNote[], bpm: number): { s: number; d: number }[] { if (!ns.length) return [];
  const b = 60 / bpm; const t0 = ns[0].t; const out: { s: number; d: number }[] = []; let end = 0;
  ns.forEach((n, i) => { let s = Math.max(end, Math.round((n.t - t0) / b)); const next = ns[i + 1]; const ownEnd = (n.t + n.dur - t0) / b;
    let e = next && (next.t - n.t - n.dur) < .35 * b ? Math.round((next.t - t0) / b) : Math.round(ownEnd);
    if (e <= s) e = s + 1; const d = Math.max(1, Math.min(4, e - s)); out.push({ s, d }); end = s + d; });
  return out; }

/** Comfortable range (midi lo..hi) to move the phrase into, by octaves. */
export function octaveShift(ms: number[], lo: number, hi: number) { if (!ms.length) return 0; const c = med(ms); let k = 0;
  while (c + k * 12 > hi) k--; while (c + k * 12 < lo) k++; return k * 12; }

export function analyze(x: Float32Array, sr: number, bpm: number, range: [number, number] | null = null): Phrase {
  const { pitch, rms, hop } = track(x, sr); const raw = segment(pitch, rms, hop); const key = estimateKey(raw);
  const shift = range ? octaveShift(raw.map(n => n.m), range[0], range[1]) : 0; const q = quantize(raw, bpm);
  const notes = raw.map((n, i) => ({ p: snapPitch(n.m, key) + shift, s: q[i].s, d: q[i].d, v: .85 }));
  return { notes, key, raw, shift }; }
