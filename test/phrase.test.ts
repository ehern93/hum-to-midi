import { describe, it, expect } from 'vitest';
import { analyze, estimateKey, snapPitch, quantize, octaveShift } from '../src/phrase';
import { synthMelody, TWINKLE, ODE, MINOR, Spec } from '../tools/hum-synth';
const exp = (m: Spec[]) => { let s = 0; return m.map(n => { const r = { p: n.p, s, d: n.beats }; s += n.beats; return r; }); };
const got = (x: Float32Array, bpm: number) => analyze(x, 44100, bpm).notes.map(({ p, s, d }) => ({ p, s, d }));
describe('hum a song', () => {
  it('clean twinkle at 100 bpm', () => expect(got(synthMelody(TWINKLE, 100), 100)).toEqual(exp(TWINKLE)));
  it('ode with timing jitter, vibrato, detune and noise at 90 bpm', () => expect(got(synthMelody(ODE, 90, { jitter: .12, vib: .4, detune: .25, noise: .01, seed: 7 }), 90)).toEqual(exp(ODE)));
  it('minor melody with long notes, wide vibrato, legato', () => expect(got(synthMelody(MINOR, 110, { vib: .6, gap: .015, jitter: .08, seed: 3 }), 110)).toEqual(exp(MINOR)));
  it('finds the key', () => { expect(analyze(synthMelody(TWINKLE, 100), 44100, 100).key.name).toBe('C major'); expect(analyze(synthMelody(MINOR, 110), 44100, 110).key.name).toBe('A minor'); });
  it('drops short blips and ignores silence', () => { const x = synthMelody([{ p: 60, beats: 2 }, { p: 64, beats: 2 }], 100); const sr = 44100;
    for (let i = 0; i < .04 * sr; i++) x[Math.floor(.15 * sr) + i] = .3 * Math.sin(2 * Math.PI * 900 * i / sr); expect(got(x, 100)).toEqual([{ p: 60, s: 0, d: 2 }, { p: 64, s: 2, d: 2 }]);
    expect(analyze(new Float32Array(44100), 44100, 100).notes).toEqual([]); });
  it('snaps ambiguous pitches into the key', () => { const C = { tonic: 0, minor: false }; expect(snapPitch(63.55, C)).toBe(64); expect(snapPitch(60.6, C)).toBe(60); expect(snapPitch(61.4, C)).toBe(62); expect(snapPitch(61.1, C)).toBe(61); expect(snapPitch(64.2, C)).toBe(64); });
  it('quantizes to whole beats 1-4 with rests', () => expect(quantize([{ t: 0, dur: .55, m: 60 }, { t: .62, dur: 1.1, m: 62 }, { t: 3.05, dur: 4, m: 64 }], 100)).toEqual([{ s: 0, d: 1 }, { s: 1, d: 2 }, { s: 5, d: 4 }]));
  it('octave-shifts into a range', () => { expect(octaveShift([60, 64, 67], 36, 52)).toBe(-12); expect(octaveShift([48, 50], 60, 84)).toBe(12); expect(octaveShift([60], 50, 70)).toBe(0); });
  it('estimateKey on simple scale', () => expect(estimateKey([0, 2, 4, 5, 7, 9, 11, 0].map((p, i) => ({ t: i, dur: i === 0 || i === 7 ? 2 : 1, m: 67 + p - 7 + 0 }))).name).toBe('C major'));
});
