import { snapToScale } from './music';
export interface Note { p: number; s: number; d: number; v: number; gm?: number }
export interface PolishOpts { bpm: number; latencyMs: number; strength: number; grid: number; root: number; scale: number[] | null }
/** Turn a raw hummed take into a cleaner performance. Times are in beats. */
export function polish(raw: Note[], o: PolishOpts): Note[] {
  const lat = (o.latencyMs / 1000) / (60 / o.bpm);
  let ns = raw.map(n => ({ ...n, s: Math.max(0, n.s - lat) })).sort((a, b) => a.s - b.s);
  const mergeSame = (arr: Note[]) => { const out: Note[] = [];
    for (const n of arr) { const l = out[out.length - 1];
      if (l && l.p === n.p && n.s - (l.s + l.d) < 0.2) { l.d = Math.max(l.d, n.s + n.d - l.s); continue; } out.push({ ...n }); }
    return out; };
  ns = mergeSame(ns);
  // blips: very short notes get absorbed by the previous note (or dropped)
  const minD = Math.max(0.12, 0.08 / (60 / o.bpm));
  const kept: Note[] = [];
  for (const n of ns) { if (n.d >= minD) { kept.push(n); continue; } const l = kept[kept.length - 1]; if (l && n.s - (l.s + l.d) < 0.25) l.d = n.s + n.d - l.s; }
  ns = kept;
  if (o.scale) for (const n of ns) n.p = snapToScale(n.p, o.root, o.scale);
  ns = mergeSame(ns);
  const g = o.grid, k = Math.max(0, Math.min(1, o.strength));
  const q = (x: number) => x + (Math.round(x / g) * g - x) * k;
  const out = ns.map(n => { const s = Math.max(0, q(n.s)); let e = q(n.s + n.d); if (e - s < g * 0.5) e = s + Math.max(g * 0.5, Math.round(n.d / g) * g * k + n.d * (1 - k)); return { ...n, s, d: e - s }; });
  for (let i = 0; i < out.length - 1; i++) { const a = out[i], b = out[i + 1]; const gap = b.s - (a.s + a.d);
    if (gap < 0 || gap < g * 0.5) a.d = Math.max(0.05, b.s - a.s); } // no overlaps, close tiny gaps (legato)
  for (const n of out) { const onBeat = Math.abs(n.s - Math.round(n.s)) < 0.01; const down = onBeat && Math.round(n.s) % 4 === 0;
    n.v = Math.min(1, 0.68 + (onBeat ? 0.1 : 0) + (down ? 0.07 : 0) + Math.min(0.08, n.d * 0.04)); }
  return out.filter(n => n.d > 0.02);
}
