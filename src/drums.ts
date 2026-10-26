// 16-step one-bar grooves. Rows: k=kick s=snare c=clap h=closed hat o=open hat t=low tom m=mid tom T=hi tom x=crash r=ride
// Step chars: X = accent, x = normal, g = ghost, . = rest
export const DRUM_MAP: Record<string, number> = { k: 36, s: 38, c: 39, h: 42, o: 46, t: 45, m: 47, T: 50, x: 49, r: 51 };
export interface Preset { id: string; name: string; group: string; genre?: string; bpm?: number; kit?: string; fill?: string; rows: Record<string, string> }
export const PRESETS: Preset[] = [
  { id: 'rock', name: 'Rock', genre: 'Rock', bpm: 120, kit: 'acoustic', fill: 'fill2', group: 'Grooves', rows: { k: 'X.....x.X.x.....', s: '....X.......X..g', h: 'X.x.X.x.X.x.X.x.' } },
  { id: 'pop', name: 'Pop', genre: 'Pop', bpm: 105, kit: 'studio', fill: 'fill1', group: 'Grooves', rows: { k: 'X.....x.X.....x.', s: '....X.......X...', c: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' } },
  { id: 'boombap', name: 'Boom Bap', genre: 'Hip-Hop', bpm: 90, kit: 'breakbeat', fill: 'fill1', group: 'Grooves', rows: { k: 'X......x..X..x..', s: '....X..g....X...', h: 'x.x.x.xxx.x.x.x.', o: '.............x..' } },
  { id: 'hiphop', name: 'Modern Hip-Hop', genre: 'Hip-Hop', bpm: 95, kit: 'machine', fill: 'fill1', group: 'Grooves', rows: { k: 'X......x..x....x', s: '....X.......X...', c: '....x.......x...', h: 'x.x.x.x.x.x.x.xx' } },
  { id: 'trap', name: 'Trap', genre: 'Trap', bpm: 140, kit: 'machine', fill: 'roll', group: 'Grooves', rows: { k: 'X.......x.x...x.', c: '........X.......', s: '........x.......', h: 'x.x.xxx.x.x.xxxx', o: '......x.......x.' } },
  { id: 'house', name: 'House', genre: 'House', bpm: 124, kit: 'techno', fill: 'roll', group: 'Grooves', rows: { k: 'X...X...X...X...', c: '....x.......x...', h: '..x...x...x...x.', o: '..x...x...x...x.' } },
  { id: 'disco', name: 'Disco', genre: 'Disco / Funk', bpm: 118, kit: 'studio', fill: 'fill1', group: 'Grooves', rows: { k: 'X...X...X...X...', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.', o: '..x...x...x...x.' } },
  { id: 'funk', name: 'Funk', genre: 'Funk', bpm: 100, kit: 'acoustic', fill: 'fill2', group: 'Grooves', rows: { k: 'X..x..x...X..x..', s: '....X..g.g..X..g', h: 'xxxxxxxxxxxxxxxx', o: '..........x.....' } },
  { id: 'lofi', name: 'Lo-Fi Chill', genre: 'Lo-Fi', bpm: 80, kit: 'lofi', fill: 'fill1', group: 'Grooves', rows: { k: 'X.......x.x.....', s: '....X.......X...', h: 'x.xgx.xgx.xgx.xg' } },
  { id: 'reggaeton', name: 'Reggaeton', genre: 'Latin', bpm: 95, kit: 'machine', fill: 'roll', group: 'Grooves', rows: { k: 'X...X...X...X...', s: '...x..x....x..x.', h: 'x.x.x.x.x.x.x.x.' } },
  { id: 'afro', name: 'Afrobeats', genre: 'Afro', bpm: 108, kit: 'studio', fill: 'fill2', group: 'Grooves', rows: { k: 'X..x....X..x....', s: '......x.....x...', c: '...x......x.....', h: 'x.xxx.xxx.xxx.xx', T: '..............x.' } },
  { id: 'half', name: 'Half-Time', genre: 'Cinematic', bpm: 85, kit: 'acoustic', fill: 'fill2', group: 'Grooves', rows: { k: 'X.........x.....', s: '........X.......', h: 'x.x.x.x.x.x.x.x.' } },
  { id: 'dnb', name: 'Drum & Bass', genre: 'DnB', bpm: 172, kit: 'breakbeat', fill: 'roll', group: 'Grooves', rows: { k: 'X.........X.....', s: '....X.......X..g', h: 'x.x.x.x.x.x.x.x.', o: '.......x........' } },
  { id: 'march', name: 'Epic March', genre: 'Game / Epic', bpm: 110, kit: 'acoustic', fill: 'fill2', group: 'Grooves', rows: { k: 'X...x...X...x...', s: 'g.g.X.ggg.g.X.xx', t: 'X.......X.......' } },
  { id: 'chip', name: '8-bit Chiptune', genre: 'Game / Retro', bpm: 150, kit: 'retro', fill: 'roll', group: 'Grooves', rows: { k: 'X...x...X...x...', s: '....X.......X...', h: 'xxxxxxxxxxxxxxxx' } },
  { id: 'fill1', name: 'Snare Fill', group: 'Fills', rows: { k: 'X...............', s: 'X...x.x.xxxxXXXX', h: 'x.x.x.x.........' } },
  { id: 'fill2', name: 'Tom Fill', group: 'Fills', rows: { k: 'X.......x.......', s: 'X..x..x.........', T: '........XX......', m: '..........xx....', t: '............XXXX' } },
  { id: 'roll', name: 'Build-up Roll', group: 'Fills', rows: { k: 'X...X...X...X...', s: '..x.x.x.xxxxXXXX', o: '..............x.' } },
  { id: 'crash', name: 'Crash Intro', group: 'Fills', rows: { k: 'X.....x.X.......', x: 'X...............', s: '....X.......X...', h: '..x.x.x.x.x.x.x.' } },
];
export function presetNotes(p: Preset, bar: number) {
  const out: { p: number; s: number; d: number; v: number }[] = [];
  for (const [r, str] of Object.entries(p.rows)) for (let i = 0; i < 16; i++) { const c = str[i]; if (!c || c === '.') continue;
    const hat = r === 'h' || r === 'o' || r === 'r';
    let v = c === 'X' ? 0.95 : c === 'g' ? 0.32 : hat ? (i % 4 === 0 ? 0.62 : i % 2 === 0 ? 0.5 : 0.4) : i % 4 === 0 ? 0.85 : 0.75;
    v = Math.min(1, Math.max(0.2, v + (((i * 7 + r.charCodeAt(0)) % 5) - 2) * 0.015)); // tiny humanize, deterministic
    out.push({ p: DRUM_MAP[r], s: bar * 4 + i / 4, d: 0.25, v }); }
  return out;
}
/** Notes for the beat across bars [0,n): groove everywhere, optional fill in every 4th bar. */
export function beatNotes(p: Preset, bars: number, fills: boolean) {
  const out: { p: number; s: number; d: number; v: number }[] = []; const parts: Record<number, string> = {};
  for (let b = 0; b < bars; b++) { const f = fills && p.fill && b % 4 === 3 ? PRESETS.find(x => x.id === p.fill)! : p; parts[b] = f.id; out.push(...presetNotes(f, b)); }
  return { notes: out, parts };
}

// ---------- sampled drum kits (Tone.js drum-samples, CC/public demo kits) with synth fallback
export const KITS: { id: string; name: string; dir: string }[] = [
  { id: 'acoustic', name: 'Acoustic', dir: 'acoustic-kit' }, { id: 'studio', name: 'Studio', dir: 'Kit8' },
  { id: 'machine', name: '808-style Machine', dir: 'KPR77' }, { id: 'techno', name: 'Techno', dir: 'Techno' },
  { id: 'breakbeat', name: 'Breakbeat', dir: 'breakbeat13' }, { id: 'lofi', name: 'Lo-Fi / Vintage', dir: 'CR78' },
  { id: 'retro', name: '80s LinnDrum', dir: 'LINN' }, { id: 'synth', name: 'Synth (built-in)', dir: '' }];
const FILES = ['kick', 'snare', 'hihat', 'tom1', 'tom2', 'tom3'];
const kits = new Map<string, Record<string, AudioBuffer>>(); const kp = new Map<string, Promise<boolean>>();
export const kitReady = (id: string) => kits.has(id);
export function loadKit(id: string, ctx: BaseAudioContext): Promise<boolean> {
  const k = KITS.find(x => x.id === id); if (!k || !k.dir) return Promise.resolve(false); if (kits.has(id)) return Promise.resolve(true); if (kp.has(id)) return kp.get(id)!;
  const pr = (async () => { try { const bufs: Record<string, AudioBuffer> = {};
    await Promise.all(FILES.map(async f => { const r = await fetch(`https://tonejs.github.io/audio/drum-samples/${k.dir}/${f}.mp3`); bufs[f] = await ctx.decodeAudioData(await r.arrayBuffer()); }));
    kits.set(id, bufs); return true; } catch { kp.delete(id); return false; } })();
  kp.set(id, pr); return pr;
}
/** Plays a drum hit from a sampled kit. Returns false when the sound isn't sampled (caller uses synth). */
export function playKit(ctx: BaseAudioContext, out: AudioNode, id: string, m: number, t: number, vel: number): boolean {
  const k = kits.get(id); if (!k) return false;
  const map: Record<number, [string, number, number]> = { 36: ['kick', 1, 9], 38: ['snare', 1, 9], 42: ['hihat', 1, 0.07], 46: ['hihat', 0.94, 0.45], 51: ['hihat', 0.8, 0.6], 45: ['tom3', 1, 9], 47: ['tom2', 1, 9], 50: ['tom1', 1, 9] };
  const e = map[m]; if (!e) return false; const [f, rate, len] = e;
  const s = ctx.createBufferSource(); s.buffer = k[f]; s.playbackRate.value = rate; const g = ctx.createGain(); const v = Math.pow(vel, 1.4) * 1.1;
  g.gain.setValueAtTime(v, t); const end = t + Math.min(len, k[f].duration / rate); g.gain.setValueAtTime(v, Math.max(t, end - 0.03)); g.gain.linearRampToValueAtTime(0, end);
  s.connect(g).connect(out); s.start(t); s.stop(end + 0.01); return true;
}
