import { describe, it, expect } from 'vitest';
import { spell, keyFifths, noteValue, renderStaff, autoClef, stepY, yToStep } from '../src/score';
import { SCALES } from '../src/music';
describe('staff notation', () => {
  it('key signatures', () => { expect(keyFifths(7, SCALES.major)).toBe(1); expect(keyFifths(5, SCALES.major)).toBe(-1); expect(keyFifths(9, SCALES.minor)).toBe(0); expect(keyFifths(2, SCALES.minor)).toBe(-1); });
  it('accidentals follow the key', () => { expect(spell(66, 1).show).toBeNull(); expect(spell(65, 1).show).toBe('♮'); expect(spell(70, -1).show).toBeNull(); expect(spell(61, 0).show).toBe('♯'); expect(spell(60, 0).name).toBe('C4'); });
  it('note values', () => { expect(noteValue(1).n).toBe('quarter'); expect(noteValue(1.5).dotted).toBe(true); expect(noteValue(0.25).n).toBe('sixteenth'); expect(noteValue(4).n).toBe('whole'); });
  it('clef auto + y mapping roundtrip', () => { expect(autoClef([40, 45])).toBe('bass'); expect(autoClef([64, 72])).toBe('treble'); const o = { clef: 'treble' as const, fifths: 0, beatW: 40, beats: 8 }; expect(yToStep(stepY(33, o), o)).toBe(33); });
  it('renders svg', () => { const r = renderStaff([{ p: 60, s: 0, d: 1, id: 1 }, { p: 67, s: 1, d: 0.5, id: 2, sel: true }], { clef: 'treble', fifths: 0, beatW: 40, beats: 8 }); expect(r.svg).toContain('data-id="2"'); expect(r.width).toBeGreaterThan(300); });
});
