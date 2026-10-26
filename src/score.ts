// Lightweight SVG music staff: key signatures, accidentals, clefs, note values (no external deps).
export type Clef = 'treble' | 'bass';
const FIFTHS: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 5: -1, 10: -2, 3: -3, 8: -4, 1: -5 };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LET = 'CDEFGAB';
/** circle-of-fifths count for a key (root pitch class + scale intervals) */
export function keyFifths(root: number, scale: number[]): number { const minorish = scale.includes(3) && !scale.includes(4); return FIFTHS[((root + (minorish ? 3 : 0)) % 12 + 12) % 12]; }
export function keyAcc(fifths: number): Record<string, number> { const a: Record<string, number> = {}; if (fifths > 0) 'FCGDAEB'.slice(0, fifths).split('').forEach(l => a[l] = 1); else 'BEADGCF'.slice(0, -fifths).split('').forEach(l => a[l] = -1); return a; }
/** spell a midi note in a key: letter, accidental (-1,0,1), diatonic step (C0=0), and the accidental to print (null = none) */
export function spell(m: number, fifths: number) { const pc = ((m % 12) + 12) % 12; const oct = Math.floor(m / 12) - 1; const nm = (fifths < 0 ? FLAT : SHARP)[pc];
  const letter = nm[0]; const acc = nm.length > 1 ? (nm[1] === '#' ? 1 : -1) : 0; const ka = keyAcc(fifths)[letter] || 0;
  return { letter, acc, step: oct * 7 + LET.indexOf(letter), show: acc === ka ? null : acc === 1 ? '♯' : acc === -1 ? '♭' : '♮', name: nm.replace('#', '♯').replace('b', '♭') + oct }; }
export const VALUES = [ { d: 4, n: 'whole' }, { d: 3, n: 'dotted half' }, { d: 2, n: 'half' }, { d: 1.5, n: 'dotted quarter' }, { d: 1, n: 'quarter' }, { d: 0.75, n: 'dotted eighth' }, { d: 0.5, n: 'eighth' }, { d: 0.375, n: 'dotted 16th' }, { d: 0.25, n: 'sixteenth' } ];
export function noteValue(d: number) { let best = VALUES[0]; for (const v of VALUES) if (Math.abs(Math.log2(v.d / d)) < Math.abs(Math.log2(best.d / d))) best = v; const base = best.n.startsWith('dotted') ? best.d / 1.5 : best.d; return { ...best, base, dotted: best.n.startsWith('dotted') }; }
export const autoClef = (pitches: number[]): Clef => pitches.length && pitches.reduce((a, b) => a + b, 0) / pitches.length < 59 ? 'bass' : 'treble';
export interface SNote { p: number; s: number; d: number; id: number; sel?: boolean; hi?: boolean }
export interface StaffOpts { clef: Clef; fifths: number; beatW: number; beats: number; beatsPerBar?: number; color?: string; height?: number; single?: boolean }
export const SP = 10; // staff space (px)
export function staffGeom(o: StaffOpts) { const top = 60; const lead = 34 + Math.abs(o.fifths) * 9 + 8; return { top, lead, bottom: top + 4 * SP, base: o.clef === 'treble' ? 30 : 18 }; }
export function stepY(step: number, o: StaffOpts) { const g = staffGeom(o); return g.bottom - (step - g.base) * SP / 2; }
export function yToStep(y: number, o: StaffOpts) { const g = staffGeom(o); return Math.round((g.bottom - y) / (SP / 2)) + g.base; }
export function noteX(s: number, o: StaffOpts) { return staffGeom(o).lead + 14 + s * o.beatW; }
export function renderStaff(notes: SNote[], o: StaffOpts): { svg: string; width: number } {
  const g = staffGeom(o); const H = o.height ?? 170; const bpb = o.beatsPerBar ?? 4; const W = o.single ? 150 : Math.ceil(noteX(o.beats, o) + 30); const ink = '#c9cfdb'; const out: string[] = [];
  for (let i = 0; i < 5; i++) out.push(`<line x1="4" x2="${W - 4}" y1="${g.top + i * SP}" y2="${g.top + i * SP}" stroke="#5b6274" stroke-width="1"/>`);
  out.push(`<text x="6" y="${o.clef === 'treble' ? g.bottom + 6 : g.top + 20}" class="clef" font-size="${o.clef === 'treble' ? 58 : 36}" fill="${ink}">${o.clef === 'treble' ? '𝄞' : '𝄢'}</text>`);
  // key signature
  const ka = keyAcc(o.fifths); const order = o.fifths > 0 ? 'FCGDAEB' : 'BEADGCF'; const sharpSteps: Record<string, number> = o.clef === 'treble' ? { F: 38, C: 35, G: 39, D: 36, A: 33, E: 37, B: 34 } : { F: 24, C: 21, G: 25, D: 22, A: 19, E: 23, B: 20 };
  const flatSteps: Record<string, number> = o.clef === 'treble' ? { B: 34, E: 37, A: 33, D: 36, G: 32, C: 35, F: 31 } : { B: 20, E: 23, A: 19, D: 22, G: 18, C: 21, F: 17 };
  order.slice(0, Math.abs(o.fifths)).split('').forEach((l, i) => { if (!ka[l]) return; const st = o.fifths > 0 ? sharpSteps[l] : flatSteps[l]; out.push(`<text x="${40 + i * 9}" y="${stepY(st, o) + 5}" font-size="17" fill="${ink}">${o.fifths > 0 ? '♯' : '♭'}</text>`); });
  if (!o.single) for (let b = bpb; b <= o.beats + 1e-6; b += bpb) { const x = noteX(b, o) - 8; out.push(`<line x1="${x}" x2="${x}" y1="${g.top}" y2="${g.bottom}" stroke="#5b6274"/><text x="${x - 2}" y="${g.top - 34}" font-size="10" fill="#6b7386" text-anchor="end">${b / bpb + 1}</text>`); }
  if (!o.single) out.push(`<text x="${noteX(0, o)}" y="${g.top - 34}" font-size="10" fill="#6b7386">1</text>`);
  const mid = g.base + 4;
  for (const n of notes) { const sp = spell(n.p, o.fifths); const v = noteValue(n.d); const x = o.single ? 100 : noteX(n.s, o); const y = stepY(sp.step, o);
    const col = n.hi ? '#f43f5e' : n.sel ? '#ffffff' : (o.color || '#e5e7eb'); const parts: string[] = [];
    // ledger lines
    for (let st = g.base - 2; st >= sp.step - (sp.step % 2 === g.base % 2 ? 0 : 1) && st >= sp.step - 1; st -= 2) {}
    if (sp.step <= g.base - 2) for (let st = g.base - 2; st >= sp.step; st -= 2) parts.push(`<line x1="${x - 9}" x2="${x + 9}" y1="${stepY(st, o)}" y2="${stepY(st, o)}" stroke="${ink}" stroke-width="1.3"/>`);
    if (sp.step >= g.base + 10) for (let st = g.base + 10; st <= sp.step; st += 2) parts.push(`<line x1="${x - 9}" x2="${x + 9}" y1="${stepY(st, o)}" y2="${stepY(st, o)}" stroke="${ink}" stroke-width="1.3"/>`);
    if (sp.show) parts.push(`<text x="${x - 19}" y="${y + 5}" font-size="16" fill="${col}">${sp.show}</text>`);
    const hollow = v.base >= 2; parts.push(`<ellipse cx="${x}" cy="${y}" rx="6.2" ry="4.4" transform="rotate(-20 ${x} ${y})" fill="${hollow ? 'none' : col}" stroke="${col}" stroke-width="${hollow ? 2 : 1}"/>`);
    if (v.base < 4) { const up = sp.step < mid; const sx = up ? x + 5.6 : x - 5.6; const sy2 = up ? y - 34 : y + 34; parts.push(`<line x1="${sx}" x2="${sx}" y1="${y}" y2="${sy2}" stroke="${col}" stroke-width="1.6"/>`);
      const flags = v.base <= 0.25 ? 2 : v.base <= 0.5 ? 1 : 0; for (let f = 0; f < flags; f++) { const fy = sy2 + (up ? f * 8 : -f * 8); parts.push(`<path d="M${sx} ${fy} q 9 ${up ? 8 : -8} 7 ${up ? 20 : -20}" fill="none" stroke="${col}" stroke-width="2"/>`); } }
    if (v.dotted) parts.push(`<circle cx="${x + 11}" cy="${y - (sp.step % 2 === g.base % 2 ? 3 : 0)}" r="2" fill="${col}"/>`);
    out.push(`<g class="sn${n.sel ? ' sel' : ''}${n.hi ? ' hi' : ''}" data-id="${n.id}">${n.sel ? `<rect x="${x - 12}" y="${y - 12}" width="24" height="24" rx="6" fill="rgba(255,255,255,.12)"/>` : ''}${parts.join('')}</g>`); }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`, width: W };
}
