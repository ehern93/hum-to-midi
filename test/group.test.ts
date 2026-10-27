import { describe, it, expect } from 'vitest';
import { splitByInstrument } from '../src/group';
describe('per-note instrument export', () => {
  it('groups notes by instrument', () => {
    const r = splitByInstrument([{ name: 'Melody', inst: 'piano', gm: 0, notes: [{ p: 60, s: 0, d: 1, v: 1 }, { p: 62, s: 1, d: 1, v: 1, gm: 73 }, { p: 64, s: 2, d: 1, v: 1, gm: 0 }] }, { name: 'Beat', inst: 'drums', notes: [{ p: 36, s: 0, d: .25, v: 1, gm: 5 }] }], g => 'gm' + g);
    expect(r.map(t => [t.name, t.gm, t.notes.length])).toEqual([['gm0', 0, 2], ['gm73', 73, 1], ['Beat', undefined, 1]]);
  });
  it('leaves single-instrument tracks untouched', () => { const t = { name: 'A', inst: 'piano', gm: 0, notes: [{ p: 1, s: 0, d: 1, v: 1 }] }; expect(splitByInstrument([t], String)[0]).toBe(t); });
});
