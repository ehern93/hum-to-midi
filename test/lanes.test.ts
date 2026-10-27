import { describe, it, expect } from 'vitest';
import { toLanes, addNote, stretchIn, removeNote, nextSpot, songEnd, emptyLanes, freshSong } from '../src/lanes';
describe('lanes', () => {
  it('migrates notes into lanes by instrument', () => { const l = toLanes([{ p: 60, s: 0, d: 1, v: 1, gm: 40 }, { p: 62, s: 1, d: 1, v: 1, gm: 0 }, { p: 64, s: 2, d: 2, v: 1, gm: 40 }]);
    expect(l.map(x => x.gm)).toEqual([40, 0, 33]); expect(l[0].notes.map(n => n.p)).toEqual([60, 64]); expect(l[1].notes[0].s).toBe(1); });
  it('folds a 4th instrument into the last lane; adds brush', () => { const l = toLanes([1, 2, 3, 4].map((g, i) => ({ p: 60, s: i, d: 1, v: 1, gm: g })));
    expect(l.map(x => x.gm)).toEqual([1, 2, 3]); expect(l[2].notes.length).toBe(2); expect(toLanes([], 24).map(x => x.gm)).toEqual([24, 0, 33]); });
  it('each lane has its own next spot', () => { const ls = emptyLanes(); addNote(ls[0], 60); addNote(ls[0], 62); const n = addNote(ls[1], 48);
    expect(n.s).toBe(0); expect(nextSpot(ls[0])).toBe(2); expect(songEnd(ls)).toBe(2); });
  it('stretch clamps 1-4 and shifts only its lane', () => { const ls = emptyLanes(); const a = addNote(ls[0], 60); const b = addNote(ls[0], 62); const c = addNote(ls[1], 50);
    stretchIn(ls[0], a, 9); expect(a.d).toBe(4); expect(b.s).toBe(4); expect(c.s).toBe(0); stretchIn(ls[0], a, 0); expect(a.d).toBe(1); expect(b.s).toBe(1); });
  it('remove closes the gap', () => { const ls = emptyLanes(); const a = addNote(ls[0], 60); const b = addNote(ls[0], 62); removeNote(ls[0], a); expect(ls[0].notes).toEqual([b]); expect(b.s).toBe(0); });
  it('freshSong is a clean default and not shared', () => { const a = freshSong(), b = freshSong(); addNote(a.lanes[0], 60);
    expect(b.lanes.map(l => [l.gm, l.notes.length])).toEqual([[0, 0], [33, 0], [73, 0]]); expect([b.bpm, b.bars, b.beat, b.active]).toEqual([100, 2, null, 0]); });
});
