// Saved-song library, stored on the device (localStorage). Instrument sounds are NOT stored here.
export interface SavedSong { id: string; name: string; at: number; beats: number; data: any }
export const LIB = 'hum-studio-songs';
type St = Pick<Storage, 'getItem' | 'setItem'>;
export const list = (st: St): SavedSong[] => { try { const a = JSON.parse(st.getItem(LIB) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const put = (st: St, a: SavedSong[]) => st.setItem(LIB, JSON.stringify(a));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
/** Upsert by id (or create when id is missing). Returns the saved id. */
export function saveSong(st: St, s: { id?: string; name: string; beats: number; data: any }, now = Date.now()): string {
  const a = list(st); const id = s.id && a.some(x => x.id === s.id) ? s.id : uid(); const rec = { id, name: s.name.trim() || 'Untitled', at: now, beats: s.beats, data: clone(s.data) };
  const i = a.findIndex(x => x.id === id); if (i >= 0) a[i] = rec; else a.push(rec); put(st, a); return id; }
export const getSong = (st: St, id: string) => list(st).find(x => x.id === id) ?? null;
export function renameSong(st: St, id: string, name: string) { const a = list(st); const s = a.find(x => x.id === id); if (!s || !name.trim()) return false; s.name = name.trim(); put(st, a); return true; }
export function deleteSong(st: St, id: string) { const a = list(st); const b = a.filter(x => x.id !== id); put(st, b); return b.length !== a.length; }
export function uniqueName(st: St, base: string) { const names = new Set(list(st).map(x => x.name)); if (!names.has(base)) return base; let n = 2; while (names.has(`${base} (${n})`)) n++; return `${base} (${n})`; }
export function duplicateSong(st: St, id: string, now = Date.now()) { const s = getSong(st, id); if (!s) return null; return saveSong(st, { name: uniqueName(st, s.name + ' copy'), beats: s.beats, data: s.data }, now); }
export const sorted = (st: St) => list(st).sort((a, b) => b.at - a.at);
export const fmtLen = (sec: number) => { const t = Math.round(sec); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
