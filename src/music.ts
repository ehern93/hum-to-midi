export const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const freqToMidiFloat = (f: number) => 69 + 12 * Math.log2(f / 440);
export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const noteName = (m: number) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const SCALES: Record<string, number[]> = {
  chromatic: [0,1,2,3,4,5,6,7,8,9,10,11], major: [0,2,4,5,7,9,11], minor: [0,2,3,5,7,8,10],
  'pentatonic major': [0,2,4,7,9], 'pentatonic minor': [0,3,5,7,10], blues: [0,3,5,6,7,10],
  dorian: [0,2,3,5,7,9,10], 'harmonic minor': [0,2,3,5,7,8,11],
};
export function snapToScale(mf: number, root: number, scale: number[]): number {
  let best = Math.round(mf), bd = Infinity;
  for (let m = Math.floor(mf) - 2; m <= Math.ceil(mf) + 2; m++) {
    if (!scale.includes((((m - root) % 12) + 12) % 12)) continue;
    const dd = Math.abs(m - mf); if (dd < bd) { bd = dd; best = m; }
  }
  return best;
}
// stabilizer: a note must persist N frames before it's emitted
export class NoteStabilizer {
  cur: number | null = null; cand: number | null = null; count = 0;
  constructor(public need = 3, public release = 4) {}
  silence = 0;
  push(n: number | null): number | null {
    if (n === null) { if (++this.silence >= this.release) { this.cur = null; this.cand = null; } return this.cur; }
    this.silence = 0;
    if (n === this.cur) { this.cand = null; this.count = 0; return this.cur; }
    if (n === this.cand) { if (++this.count >= this.need) { this.cur = n; this.cand = null; this.count = 0; } }
    else { this.cand = n; this.count = 1; }
    return this.cur;
  }
}
