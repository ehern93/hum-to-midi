// Downloads licensed samples into public/sounds/<key>/<midi>.mp3 (served from the Vercel deployment).
import fs from 'fs'; import path from 'path';
const OUT = 'public/sounds'; const defs = JSON.parse(fs.readFileSync('src/voicedefs.json'));
const GM = fs.readFileSync('src/gm.ts', 'utf8').match(/export const GM = `([^`]+)`/)[1].split(/\s+/);
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midi = n => { const m = /^([A-G])(b|s|#)?(-?\d)$/.exec(n); if (!m) return -1; return NOTE[m[1]] + (m[2] === 'b' ? -1 : m[2] ? 1 : 0) + (+m[3] + 1) * 12; };
const index = {};
async function get(u) { for (let i = 0; i < 4; i++) { try { const r = await fetch(u); if (r.ok) return Buffer.from(await r.arrayBuffer()); if (r.status === 404) return null; } catch {} await new Promise(r => setTimeout(r, 500 * (i + 1))); } return null; }
async function bundle(key, font, name, step, lo = 21, hi = 108) {
  const dir = path.join(OUT, key); if (fs.existsSync(path.join(dir, '.done'))) { index[key] = JSON.parse(fs.readFileSync(path.join(dir, '.done'))); return; }
  const txt = (await get(`https://gleitz.github.io/midi-js-soundfonts/${font}/${name}-mp3.js`)).toString();
  const obj = JSON.parse(txt.slice(txt.indexOf('{', txt.indexOf('Soundfont.')), txt.lastIndexOf('}') + 1).replace(/,\s*}$/, '}'));
  const all = Object.keys(obj).map(k => [midi(k), k]).filter(([m]) => m >= lo && m <= hi).sort((a, b) => a[0] - b[0]);
  const keep = all.filter(([m], i) => (m - all[0][0]) % step === 0 || i === all.length - 1);
  fs.mkdirSync(dir, { recursive: true }); const ms = [];
  for (const [m, k] of keep) { fs.writeFileSync(path.join(dir, m + '.mp3'), Buffer.from(obj[k].split(',')[1], 'base64')); ms.push(m); }
  fs.writeFileSync(path.join(dir, '.done'), JSON.stringify(ms)); index[key] = ms;
}
async function files(key, base, names) {
  const dir = path.join(OUT, key); if (fs.existsSync(path.join(dir, '.done'))) { index[key] = JSON.parse(fs.readFileSync(path.join(dir, '.done'))); return; }
  fs.mkdirSync(dir, { recursive: true }); const ms = [];
  await Promise.all(names.map(async n => { const m = midi(n); const b = await get(base + n + '.mp3'); if (b && m >= 0) { fs.writeFileSync(path.join(dir, m + '.mp3'), b); ms.push(m); } }));
  ms.sort((a, b) => a - b); fs.writeFileSync(path.join(dir, '.done'), JSON.stringify(ms)); index[key] = ms;
}
const TI = (await (await fetch('https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/Tonejs-Instruments.js')).text());
const tiNotes = inst => { const s = TI.slice(TI.indexOf(`'${inst}': {`)); return [...new Set([...s.slice(0, s.indexOf('}')).matchAll(/'([A-G]s?\d)'/g)].map(x => x[1]))]; };
const SAL = []; for (let o = 0; o <= 7; o++) for (const n of ['C', 'Ds', 'Fs', 'A']) SAL.push(n + o); SAL.push('A0', 'C8');
for (const d of defs) {
  const [kind, arg] = d.src.split(':');
  if (kind === 'salamander') await files(d.key, 'https://tonejs.github.io/audio/salamander/', [...new Set(SAL)]);
  else if (kind === 'ti') await files(d.key, `https://nbrosowsky.github.io/tonejs-instruments/samples/${arg}/`, tiNotes(arg));
  else if (kind === 'mk') await bundle(d.key, 'MusyngKite', arg, 3);
  console.log(d.key, index[d.key]?.length ?? 'synth');
}
for (let p = 0; p < 128; p++) { await bundle('gm' + p, 'FluidR3_GM', GM[p], 6, 24, 102); }
console.log('gm done');
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
