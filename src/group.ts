// Split tracks so every exported track has a single instrument (per-note instruments -> separate tracks).
export interface GNote { p: number; s: number; d: number; v: number; gm?: number }
export interface GTrack { name: string; inst: string; gm?: number | null; notes: GNote[] }
export function splitByInstrument<T extends GTrack>(tracks: T[], label: (gm: number) => string): T[] {
  const out: T[] = [];
  for (const t of tracks) {
    if (t.inst === 'drums' || !t.notes.some(n => n.gm != null && n.gm !== t.gm)) { out.push(t); continue; }
    const groups = new Map<number | null, GNote[]>();
    for (const n of t.notes) { const k = n.gm ?? t.gm ?? null; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(n); }
    for (const [gm, notes] of groups) out.push({ ...t, gm, name: gm == null ? t.name : label(gm), notes });
  }
  return out;
}
