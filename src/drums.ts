// 16-step one-bar grooves. Rows: k=kick s=snare c=clap h=closed hat o=open hat t=low tom T=hi tom x=crash
const M: Record<string, number> = { k: 36, s: 38, c: 39, h: 42, o: 46, t: 45, T: 50, x: 49 };
export interface Preset { id: string; name: string; group: string; rows: Record<string, string> }
export const PRESETS: Preset[] = [
  { id: 'rock', name: 'Rock', group: 'Grooves', rows: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' } },
  { id: 'pop', name: 'Pop', group: 'Grooves', rows: { k: 'x.....x.x.......', s: '....x.......x...', c: '............x...', h: 'x.x.x.x.x.x.x.x.' } },
  { id: 'hiphop', name: 'Hip-Hop', group: 'Grooves', rows: { k: 'x......x..x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.xx' } },
  { id: 'trap', name: 'Trap', group: 'Grooves', rows: { k: 'x.......x.....x.', s: '........x.......', h: 'x.xxx.x.x.xxx.xx', o: '..............x.' } },
  { id: 'house', name: 'House', group: 'Grooves', rows: { k: 'x...x...x...x...', c: '....x.......x...', h: '..x...x...x...x.', o: '..x.......x.....' } },
  { id: 'funk', name: 'Funk', group: 'Grooves', rows: { k: 'x..x..x...x..x..', s: '....x..x.x..x...', h: 'xxxxxxxxxxxxxxxx' } },
  { id: 'lofi', name: 'Lo-Fi', group: 'Grooves', rows: { k: 'x......x..x.....', s: '....x.......x..x', h: 'x...x.x.x...x.x.' } },
  { id: 'half', name: 'Half-Time', group: 'Grooves', rows: { k: 'x.........x.....', s: '........x.......', h: 'x.x.x.x.x.x.x.x.' } },
  { id: 'dnb', name: 'Drum & Bass', group: 'Grooves', rows: { k: 'x.........x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '.......x........' } },
  { id: 'march', name: 'Epic / March', group: 'Grooves', rows: { k: 'x...x...x...x...', s: '....x..x....xxxx', t: 'x.......x.......', x: 'x...............' } },
  { id: 'chip', name: '8-bit / Chiptune', group: 'Grooves', rows: { k: 'x...x...x...x...', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' } },
  { id: 'fill1', name: 'Snare Fill', group: 'Fills', rows: { k: 'x...............', s: '....x.x.xxxxxxxx' } },
  { id: 'fill2', name: 'Tom Fill', group: 'Fills', rows: { k: 'x...............', s: '....xx..', T: '........xx..', t: '..........xxxx' } },
  { id: 'crash', name: 'Crash Intro', group: 'Fills', rows: { k: 'x...............', x: 'x...............', h: '....x.x.x.x.x.x.' } },
];
export function presetNotes(p: Preset, bar: number) {
  const out: { p: number; s: number; d: number; v: number }[] = [];
  for (const [r, str] of Object.entries(p.rows)) for (let i = 0; i < 16; i++) if (str[i] === 'x')
    out.push({ p: M[r], s: bar * 4 + i / 4, d: 0.25, v: r === 'h' ? (i % 4 === 0 ? 0.6 : 0.42) : i % 4 === 0 ? 0.95 : 0.8 });
  return out;
}
