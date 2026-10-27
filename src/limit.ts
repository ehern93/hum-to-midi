// Song-wide instrument limit: at most MAX different instruments (counting the current "brush").
export const MAX_SOUNDS = 3;
export interface INote { gm?: number }
/** Instruments in use, in first-use order; the brush (sound for the next note) counts too. */
export function soundsInUse(notes: INote[], brush: number): number[] {
  const out: number[] = []; for (const n of notes) { const g = n.gm ?? 0; if (!out.includes(g)) out.push(g); }
  if (!out.includes(brush)) out.push(brush); return out;
}
/** Would picking `gm` (as brush, and optionally for `target`) exceed the limit? */
export function pickExceeds(notes: INote[], brush: number, gm: number, target?: INote | null, max = MAX_SOUNDS): boolean {
  const after = notes.map(n => (n === target ? { gm } : n));
  return soundsInUse(after, gm).length > max;
}
/** Replace every use of `out` with `inn` (the swap offered when the limit is hit). */
export function swapSound(notes: INote[], out: number, inn: number) { for (const n of notes) if ((n.gm ?? 0) === out) n.gm = inn; }
