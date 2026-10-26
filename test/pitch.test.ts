import { describe, it, expect } from 'vitest';
import { detectPitch } from '../src/pitch';
import { freqToMidiFloat, snapToScale, SCALES, noteName, NoteStabilizer } from '../src/music';
const sine = (f: number, sr = 44100, n = 2048, h = false) => Float32Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * f * i / sr) + (h ? 0.5 * Math.sin(4 * Math.PI * f * i / sr) : 0));
describe('YIN', () => {
  for (const f of [82.41, 110, 220, 261.63, 440, 659.25, 880]) it(`detects ${f}Hz`, () => {
    const r = detectPitch(sine(f), 44100); expect(Math.abs(1200 * Math.log2(r.freq / f))).toBeLessThan(5);
  });
  it('handles harmonics', () => { const r = detectPitch(sine(196, 44100, 2048, true), 44100); expect(noteName(Math.round(freqToMidiFloat(r.freq)))).toBe('G3'); });
  it('rejects noise', () => { const n = Float32Array.from({ length: 2048 }, () => Math.random() * 2 - 1); expect(detectPitch(n, 44100).clarity).toBeLessThan(0.85); });
});
describe('music', () => {
  it('snaps C#4 to C major', () => expect([60, 62]).toContain(snapToScale(61, 0, SCALES.major)));
  it('stabilizes', () => { const s = new NoteStabilizer(3); [60, 61, 60, 60, 60].forEach(n => s.push(n)); expect(s.cur).toBe(60); });
});
