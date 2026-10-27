import { describe, it, expect } from 'vitest';
import { soundsInUse, pickExceeds, swapSound } from '../src/limit';
describe('3-instrument limit', () => {
  const ns = () => [{ gm: 0 }, { gm: 73 }, { gm: 0 }, { gm: 40 }];
  it('lists sounds in use incl. brush', () => { expect(soundsInUse(ns(), 40)).toEqual([0, 73, 40]); expect(soundsInUse([], 24)).toEqual([24]); });
  it('blocks a 4th sound', () => { expect(pickExceeds(ns(), 40, 56)).toBe(true); expect(pickExceeds(ns(), 40, 73)).toBe(false); });
  it('allows changing the only note of a sound', () => { const n = ns(); expect(pickExceeds(n, 0, 56, n[1])).toBe(false); });
  it('allows a new brush when the old brush is unused', () => { expect(pickExceeds([{ gm: 0 }, { gm: 73 }], 40, 56)).toBe(false); });
  it('swaps', () => { const n = ns(); swapSound(n, 0, 56); expect(soundsInUse(n, 56)).toEqual([56, 73, 40]); });
});
