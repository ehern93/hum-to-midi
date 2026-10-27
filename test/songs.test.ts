import { describe, it, expect } from 'vitest';
import * as lib from '../src/songs';
import { VOICES, midiProgram, soundKey, isSynthVoice } from '../src/gm';
import idx from '../public/sounds/index.json';
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
describe('song library', () => {
  it('saves, updates, renames, duplicates, deletes', () => { const st = mem();
    const id = lib.saveSong(st, { name: 'A', beats: 8, data: { bpm: 100 } }, 1); expect(lib.list(st)).toHaveLength(1);
    expect(lib.saveSong(st, { id, name: 'A', beats: 12, data: { bpm: 120 } }, 2)).toBe(id); expect(lib.getSong(st, id)!.beats).toBe(12);
    expect(lib.renameSong(st, id, ' B ')).toBe(true); expect(lib.getSong(st, id)!.name).toBe('B'); expect(lib.renameSong(st, id, '  ')).toBe(false);
    const d = lib.duplicateSong(st, id, 3)!; expect(d).not.toBe(id); expect(lib.getSong(st, d)!.name).toBe('B copy'); expect(lib.sorted(st)[0].id).toBe(d);
    expect(lib.uniqueName(st, 'B')).toBe('B (2)'); expect(lib.deleteSong(st, id)).toBe(true); expect(lib.list(st).map(s => s.id)).toEqual([d]); });
  it('copies data so later edits do not leak', () => { const st = mem(); const data = { lanes: [1] }; const id = lib.saveSong(st, { name: 'x', beats: 1, data }); data.lanes.push(2); expect(lib.getSong(st, id)!.data.lanes).toEqual([1]); });
  it('survives corrupt storage', () => { const st = mem(); st.setItem(lib.LIB, '{bad'); expect(lib.list(st)).toEqual([]); });
  it('formats length', () => { expect(lib.fmtLen(59.6)).toBe('1:00'); expect(lib.fmtLen(125)).toBe('2:05'); });
});
describe('voices', () => {
  it('every voice has a valid GM program and sampled voices have samples', () => { const ids = new Set<number>();
    for (const v of VOICES) { expect(v.id).toBeGreaterThanOrEqual(128); expect(ids.has(v.id)).toBe(false); ids.add(v.id); expect(midiProgram(v.id)).toBeGreaterThanOrEqual(0); expect(midiProgram(v.id)).toBeLessThan(128);
      if (!isSynthVoice(v.id)) expect(((idx as any)[soundKey(v.id)] || []).length, v.key).toBeGreaterThan(4); } });
  it('GM ids map to themselves and have samples', () => { for (let p = 0; p < 128; p++) { expect(midiProgram(p)).toBe(p); expect(((idx as any)['gm' + p] || []).length).toBeGreaterThan(0); } });
});
