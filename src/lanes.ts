// Three instrument lanes; each lane has one instrument and its own sequential notes.
export const LANES = 3;
export const DEFAULT_GM = [0, 33, 73];
export interface LNote { p: number; s: number; d: number; v: number }
export interface Lane { gm: number; notes: LNote[] }
export const emptyLanes = (): Lane[] => DEFAULT_GM.map(gm => ({ gm, notes: [] }));
/** Group old single-lane notes (each with its own gm) into lanes by instrument, first-use order. Extra instruments fold into the last lane. */
export function toLanes(notes: (LNote & { gm?: number })[], brush?: number): Lane[] {
  const gms: number[] = []; for (const n of notes) { const g = n.gm ?? 0; if (!gms.includes(g)) gms.push(g); }
  if (brush !== undefined && !gms.includes(brush) && gms.length < LANES) gms.push(brush);
  for (const g of DEFAULT_GM) if (gms.length < LANES && !gms.includes(g)) gms.push(g);
  const lanes: Lane[] = gms.slice(0, LANES).map(gm => ({ gm, notes: [] }));
  for (const n of notes) { const i = Math.min(gms.indexOf(n.gm ?? 0), LANES - 1); lanes[i].notes.push({ p: n.p, s: n.s, d: n.d, v: n.v ?? .85 }); }
  for (const l of lanes) l.notes.sort((a, b) => a.s - b.s); return lanes;
}
export const laneEnd = (l: Lane) => Math.max(0, ...l.notes.map(n => n.s + n.d));
export const songEnd = (ls: Lane[]) => Math.max(0, ...ls.map(laneEnd));
/** Next free spot in this lane (whole beat after its last note). */
export const nextSpot = (l: Lane) => Math.max(0, Math.ceil(laneEnd(l) - 1e-6)) || 0;
export function addNote(l: Lane, p: number, v = .85): LNote { const n = { p, s: nextSpot(l), d: 1, v }; l.notes.push(n); return n; }
/** Stretch a note to 1-4 beats; later notes in the SAME lane shift to keep the sequence. Returns true if changed. */
export function stretchIn(l: Lane, n: LNote, d: number): boolean { d = Math.max(1, Math.min(4, Math.round(d))); if (d === n.d) return false;
  for (const m of l.notes) if (m !== n && m.s >= n.s + n.d - 1e-6) m.s += d - n.d; n.d = d; return true; }
export function removeNote(l: Lane, n: LNote) { l.notes = l.notes.filter(x => x !== n); for (const m of l.notes) if (m.s >= n.s + n.d - 1e-6) m.s = Math.max(0, m.s - n.d); }
/** A brand-new song: default tempo, 2 bars, no beat, empty Piano/Bass/Flute lanes. */
export const freshSong = () => ({ bpm: 100, bars: 2, lanes: emptyLanes(), active: 0, beat: null as string | null, kit: 'studio' });
