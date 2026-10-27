import './style.css';
import { plan } from './sched';
import { renderStaff, keyFifths, spell, autoClef } from './score';
import { detectPitch } from './pitch';
import { SCALES, freqToMidiFloat, NoteStabilizer } from './music';
import { GM, GM_CATS, gmCat, gmLabel, loadGM, playGM, hasGM, VOICES, voice, midiProgram } from './gm';
import * as lib from './songs';
import { analyze, Phrase } from './phrase';
import { playNote, makeStrip, Strip, encodeWav } from './audio';
import { PRESETS, presetNotes, beatNotes, loadKit, playKit } from './drums';
import { LANES, Lane, LNote, emptyLanes, freshSong, nextSpot, toLanes, songEnd, addNote, stretchIn, removeNote, placeAt, previewPitch } from './lanes';

type Note = LNote;
interface Song { bpm: number; bars: number; lanes: Lane[]; active: number; beat: string | null; kit: string; name?: string; sid?: string }
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const KEY = 'hum-studio-v2';
const FAVK = 'hum-studio-favs'; const DEF_FAV = [140, 143, 128, 131, 150, 160, 170, 190];
let favs: number[] = (() => { try { const a = JSON.parse(localStorage.getItem(FAVK) || ''); return Array.isArray(a) ? a : DEF_FAV; } catch { return DEF_FAV; } })();
const toggleFav = (id: number) => { favs = favs.includes(id) ? favs.filter(x => x !== id) : [...favs, id]; localStorage.setItem(FAVK, JSON.stringify(favs)); };
const TEMPOS = [{ n: 'Slow', b: 80 }, { n: 'Medium', b: 100 }, { n: 'Fast', b: 130 }];
const GROOVES = PRESETS.filter(p => p.group === 'Grooves');
const LCOL = ['#38bdf8', '#a78bfa', '#34d399'];

function migrate(): Song | null {
  try { const v1 = JSON.parse(localStorage.getItem('hum-studio-v1') || ''); if (v1 && Array.isArray(v1.notes)) return { bpm: v1.bpm || 100, bars: v1.bars || 2, lanes: toLanes(v1.notes, v1.brush), active: 0, beat: v1.beat ?? null, kit: v1.kit || 'studio' }; } catch { /* */ }
  try { const p = JSON.parse(localStorage.getItem('h2m-project-v2') || ''); const t = p.tracks.find((x: any) => x.inst !== 'drums');
    return { bpm: p.bpm || 100, bars: p.bars || 2, lanes: toLanes((t?.notes || []).map((n: any) => ({ p: n.p, s: n.s, d: n.d, v: n.v ?? .85, gm: n.gm ?? t.gm ?? 0 }))), active: 0, beat: p.beat?.id ?? null, kit: p.beat?.kit || 'studio' }; } catch { return null; } }
function load(): Song { try { const s = JSON.parse(localStorage.getItem(KEY) || ''); if (s && Array.isArray(s.lanes) && s.lanes.length === LANES) return s; } catch { /* */ } return migrate() || freshSong(); }
let S = load();
let saveT = 0; const save = () => { clearTimeout(saveT); saveT = window.setTimeout(saveNow, 400); };
const saveNow = () => { clearTimeout(saveT); localStorage.setItem(KEY, JSON.stringify(S)); };
addEventListener('pagehide', saveNow); document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
const buzz = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* */ } };
const toast = (s: string) => { const t = $('#toast'); t.textContent = s; t.hidden = false; clearTimeout((t as any)._t); (t as any)._t = setTimeout(() => t.hidden = true, 2500); };
const AL = () => S.lanes[S.active];

// ---------- audio
let ctx: AudioContext | null = null; let mel: Strip, drm: Strip, master: GainNode;
function ac() { if (!ctx) { ctx = new AudioContext({ latencyHint: 'interactive' }); master = ctx.createGain(); master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination); mel = makeStrip(ctx, master, S.bpm); drm = makeStrip(ctx, master, S.bpm); mel.update({ reverb: .15 } as any, .8, 0, true); drm.update({ reverb: .05 } as any, .75, 0, true); }
  if (ctx.state === 'suspended') ctx.resume(); return ctx; }
const spb = () => 60 / S.bpm;
function playMel(c: BaseAudioContext, out: AudioNode, n: { p: number; gm: number; v: number }, t: number, dur: number) { if (!playGM(c, out, n.gm, n.p, t, dur, n.v)) playNote(c, out, 'piano', n.p, t, dur, n.v); }
function playDrum(c: BaseAudioContext, out: AudioNode, m: number, t: number, v: number) { if (!playKit(c, out, S.kit, m, t, v)) playNote(c, out, 'drums', m, t, .1, v); }
const notesEnd = () => songEnd(S.lanes);
const songBeats = () => Math.max(S.bars * 4, Math.ceil(notesEnd() / 4) * 4);
let drumCache = { k: '', n: [] as { p: number; s: number; v: number }[] };
function drumNotes() { const k = S.beat + ':' + S.bars; if (drumCache.k !== k) { const pr = PRESETS.find(p => p.id === S.beat); drumCache = { k, n: pr ? beatNotes(pr, S.bars, true).notes : [] }; } return drumCache.n; }

// ---------- transport
let playing = false, startCtxTime = 0, startBeat = 0, schedBeat = 0, timer = 0;
const posBeat = () => playing && ctx ? startBeat + (ctx.currentTime - startCtxTime) / spb() : 0;
function play() { const c = ac(); stop(); S.lanes.forEach(l => loadGM(l.gm, c)); playing = true; startBeat = 0; schedBeat = 0; startCtxTime = c.currentTime + .05; timer = window.setInterval(schedule, 25); schedule(); requestAnimationFrame(anim); syncPlay(); }
function stop() { if (!playing) return; playing = false; clearInterval(timer); hi = []; renderSong(); syncPlay(); }
function schedule() { if (!ctx) return; const now = ctx.currentTime;
  const r = plan({ schedBeat, startBeat, startCtxTime }, now, spb(), { on: false, s: 0, e: 0 }); ({ schedBeat, startBeat, startCtxTime } = r.clock);
  for (const g of r.segs) { const tt = (b: number) => Math.max(now, g.t0 + (b - g.b0) * spb());
    for (const l of S.lanes) for (const n of l.notes) if (n.s >= g.from && n.s < g.to) playMel(ctx, mel.input, { ...n, gm: l.gm }, tt(n.s), n.d * spb());
    for (const n of drumNotes()) if (n.s >= g.from && n.s < g.to) playDrum(ctx, drm.input, n.p, tt(n.s), n.v); }
  if (posBeat() > songBeats()) stop(); }
function setBpm(b: number) { b = Math.max(60, Math.min(160, Math.round(b))); if (playing && ctx) { const pb = posBeat(); startBeat = pb; startCtxTime = ctx.currentTime; schedBeat = Math.max(schedBeat, pb); } S.bpm = b; save(); renderTempo(); }
let hi: Note[] = [];
function anim() { if (!playing) return; requestAnimationFrame(anim); const b = posBeat(); const h = S.lanes.flatMap(l => l.notes.filter(x => b >= x.s && b < x.s + x.d));
  $('#playhead').style.transform = `translateX(${b * BW}px)`;
  const l = $('#lane'); const x = b * BW; if (x > l.scrollLeft + l.clientWidth - 60 || x < l.scrollLeft) l.scrollLeft = Math.max(0, x - 40);
  if (h.length !== hi.length || h.some((n, i) => n !== hi[i])) { hi = h; renderSong(); } }
function syncPlay() { const p = $('#play'); p.textContent = playing ? '■' : '▶'; p.classList.toggle('on', playing); p.setAttribute('aria-label', playing ? 'Stop' : 'Play'); $('#playhead').hidden = !playing; }

// ---------- hum
let micOn = false, analyser: AnalyserNode, micStream: MediaStream, buf: Float32Array<ArrayBuffer> | null = null, last = 0, smoothF = 0;
const stab = new NoteStabilizer(3, 5); let pending: number | null = null, lock: number | null = null, heard: number | null = null;
async function toggleMic() {
  if (micOn) { micOn = false; micStream.getTracks().forEach(t => t.stop()); $('#hum').classList.remove('on'); $('#humlbl').textContent = 'Tap to hum'; return; }
  const c = ac(); try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); } catch { toast('Microphone access was denied.'); return; }
  const src = c.createMediaStreamSource(micStream); analyser = c.createAnalyser(); analyser.fftSize = 2048; src.connect(analyser);
  micOn = true; $('#hum').classList.add('on'); $('#humlbl').textContent = 'Listening… hum a note'; humLoop(); }
function humLoop(now = performance.now()) { if (!micOn) return; requestAnimationFrame(humLoop); if (now - last < 30) return; last = now;
  if (!buf || buf.length !== analyser.fftSize) buf = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(buf);
  const r = detectPitch(buf, ctx!.sampleRate, .15, 65, 1100); let n: number | null = null;
  if (r.rms > .015 && r.clarity > .85 && r.freq > 0) { smoothF = smoothF && Math.abs(Math.log2(r.freq / smoothF)) < .1 ? smoothF * .7 + r.freq * .3 : r.freq; n = Math.round(freqToMidiFloat(smoothF)); } else smoothF = 0;
  const s = stab.push(n); if (s === heard) return; heard = s;
  if (s === null) { lock = null; return; } if (s === pending || s === lock) return; lock = null; pending = s; showPop(); }
const fifths = () => keyFifths(0, SCALES.major);
const nName = (p: number) => spell(p, fifths()).name.replace(/-?\d+$/, '');
const color = (p: number, l = 65) => `hsl(${(((p % 12) + 12) % 12) * 30},85%,${l}%)`;
function showPop() { const has = pending !== null; $('#pop').hidden = !has; $<HTMLButtonElement>('#yes').disabled = !has; $<HTMLButtonElement>('#no').disabled = !has; if (!has) return;
  const p = pending!; $('#pnote').textContent = nName(p); $('#pnote').style.color = color(p, 38); $('#pop').style.background = color(p, 92);
  $('#pstaff').innerHTML = renderStaff([{ p, s: 0, d: 1, id: 0 }], { clef: autoClef([p]), fifths: fifths(), beatW: 30, beats: 1, single: true, height: 96, color: '#222' }).svg; }
function keep() { if (pending === null) return; const lane = AL(); const n = addNote(lane, pending); fit();
  preview(n.p, lane.gm); lock = pending; pending = null; sel = null; showPop(); buzz(); save(); renderAll();
  requestAnimationFrame(() => { const l = $('#lane'); const x = (n.s + n.d) * BW; if (x > l.scrollLeft + l.clientWidth - 20) l.scrollLeft = x - l.clientWidth + 80; }); }
function discard() { lock = pending; pending = null; showPop(); }
const pvLog: { p: number; gm: number; how: string }[] = [];
function preview(p: number, gm: number) { const c = ac(); if (c.state !== 'running') c.resume(); const q = previewPitch(p);
  const go = (how: string) => { pvLog.push({ p: q, gm, how }); if (pvLog.length > 50) pvLog.shift(); if (!playGM(c, master, gm, q, c.currentTime + .01, .45, .9)) playNote(c, master, 'piano', q, c.currentTime + .01, .45, .9); };
  if (hasGM(gm)) go('sample'); else { go('synth'); loadGM(gm, c); } }
function fit() { const need = Math.ceil(notesEnd() / 4); if (need > S.bars) S.bars = need; }
const laneOf = (n: Note) => S.lanes.find(l => l.notes.includes(n))!;
function stretch(n: Note, d: number) { if (!stretchIn(laneOf(n), n, d)) return; fit(); buzz(); save(); renderSong(); }
function del() { if (!sel) return; removeNote(laneOf(sel), sel); sel = null; save(); renderAll(); }

// ---------- lanes
const BW = 64; let sel: Note | null = null, songKey = '';
const icon = (gm: number) => voice(gm)?.i ?? gmCat(gm).icon;
const sname = (gm: number) => voice(gm)?.n ?? gmLabel(gm);
function setActive(i: number) { if (i === S.active) return; S.active = i; sel = null; save(); renderAll(); loadGM(AL().gm, ac()); }
function renderSong() { if (sel && !S.lanes.some(l => l.notes.includes(sel!))) sel = null; const beats = songBeats();
  const key = JSON.stringify([S.lanes, S.active, beats, sel && [S.lanes.indexOf(laneOf(sel)), laneOf(sel).notes.indexOf(sel)], hi.map(n => n.s + ':' + n.p)]); if (key === songKey) return; songKey = key;
  const out: string[] = []; const RH = 100 / LANES;
  S.lanes.forEach((l, li) => out.push(`<div class="row${li === S.active ? ' act' : ''}" data-l="${li}" style="top:${li * RH}%;height:${RH}%;--lc:${LCOL[li]}"></div>`));
  for (let b = 0; b <= beats; b++) out.push(`<div class="bl${b % 4 === 0 ? ' bar' : ''}" style="left:${b * BW}px"></div>` + (b % 4 === 0 && b < beats ? `<span class="bno" style="left:${b * BW + 5}px">${b / 4 + 1}</span>` : ''));
  S.lanes.forEach((l, li) => { const ps = l.notes.map(n => n.p); const lo = Math.min(...ps), hp = Math.max(...ps);
    l.notes.forEach((n, i) => { const f = hp === lo ? .5 : (hp - n.p) / (hp - lo); const top = li * RH + RH * (.1 + f * .3);
      out.push(`<div class="nb${n === sel ? ' sel' : ''}${hi.includes(n) ? ' hi' : ''}" data-l="${li}" data-i="${i}" style="left:${n.s * BW + 3}px;top:${top}%;width:${n.d * BW - 6}px;height:${RH * .5}%;background:${color(n.p)}">${nName(n.p)}<small>${n.d}</small><span class="grip" data-grip="1">⟷</span></div>`); }); });
  out.push('<div id="playhead" class="ph"' + (playing ? '' : ' hidden') + '></div>');
  const k = $('#blocks'); k.style.width = (beats * BW + 2) + 'px'; k.innerHTML = out.join(''); }
function renderSounds() {
  const h = S.lanes.map((l, i) => `<button class="slot${i === S.active ? ' on' : ''}" data-l="${i}" style="--lc:${LCOL[i]}"><b>${i + 1}</b><span>${icon(l.gm)}</span><em>${sname(l.gm)}</em></button>`).join('');
  $('#sounds').innerHTML = h + '<button class="slot more" data-gm="more"><span>🎼</span><em>All sounds</em></button>';
  $('#labels').innerHTML = S.lanes.map((l, i) => `<button class="lab${i === S.active ? ' on' : ''}" data-l="${i}" style="--lc:${LCOL[i]}"><span>${icon(l.gm)}</span><em>${sname(l.gm)}</em></button>`).join(''); }
function renderAll() { renderSong(); renderSounds(); renderTools(); }

// ---------- sound picker: sets the active lane's instrument (whole lane)
function openPicker() { $<HTMLInputElement>('#search').value = ''; $('#picker').classList.add('open'); renderPicker(); }
function closePicker() { $('#picker').classList.remove('open'); }
function renderPicker() { const q = $<HTMLInputElement>('#search').value.trim().toLowerCase(); const used = S.lanes.map(l => l.gm); const curG = AL().gm;
  $('#ptitle').textContent = `Sound for lane ${S.active + 1}`;
  $('#pinuse').innerHTML = '<small>Lanes — tap to choose which one to change</small>' + S.lanes.map((l, i) => `<button class="ii use${i === S.active ? ' on' : ''}" data-pl="${i}" style="--lc:${LCOL[i]}"><span>${icon(l.gm)}</span><b>${i + 1}. ${sname(l.gm)}</b></button>`).join('');
  const item = (p: number) => `<button class="ii${p === curG ? ' on' : ''}${used.includes(p) ? ' used' : ''}" data-gm="${p}"><span>${icon(p)}</span><b>${sname(p)}</b><i class="star${favs.includes(p) ? ' on' : ''}" data-star="${p}" aria-label="Favorite">${favs.includes(p) ? '★' : '☆'}</i></button>`;
  const hit = (p: number) => !q || sname(p).toLowerCase().includes(q) || (voice(p)?.g ?? gmCat(p).name).toLowerCase().includes(q) || gmLabel(midiProgram(p)).toLowerCase().includes(q);
  const fv = favs.filter(hit); let html = fv.length ? '<h4>★ Favorites</h4><div class="grid">' + fv.map(item).join('') + '</div>' : '';
  for (const g of [...new Set(VOICES.map(v => v.g))]) { const vs = VOICES.filter(v => v.g === g && hit(v.id)); if (vs.length) html += `<h4>${vs[0].i} ${g}</h4><div class="grid">` + vs.map(v => item(v.id)).join('') + '</div>'; }
  const all = GM.map((_, p) => p).filter(hit); if (all.length) html += '<h4 class="gmh">All 128 General MIDI sounds</h4>';
  let cat = -1; for (const p of all) { if (p >> 3 !== cat) { if (cat >= 0) html += '</div>'; cat = p >> 3; html += `<h4>${GM_CATS[cat].icon} ${GM_CATS[cat].name}</h4><div class="list">`; }
    html += item(p); }
  if (cat >= 0) html += '</div>'; $('#plist').innerHTML = html || '<p class="hint">No sounds match.</p>'; }
function pickSound(gm: number) { AL().gm = gm; save(); renderAll(); loadGM(gm, ac()).then(() => preview(AL().notes[0]?.p ?? 60, gm)); toast(`Lane ${S.active + 1}: ${sname(gm)}`); }

// ---------- beats + tempo
function renderBeats() { $('#beats').innerHTML = [`<button data-id="" class="${!S.beat ? 'on' : ''}">🚫 None</button>`, ...GROOVES.map(p => `<button data-id="${p.id}" class="${S.beat === p.id ? 'on' : ''}">${p.name}</button>`)].join('');
  const pr = PRESETS.find(p => p.id === S.beat); $('#beatbtn').innerHTML = `🥁 ${pr ? pr.name : 'Beat'}`; $('#beatbtn').classList.toggle('on', !!pr); }
function pickBeat(id: string | null) { S.beat = id; const pr = PRESETS.find(p => p.id === id); if (pr?.kit) { S.kit = pr.kit; loadKit(pr.kit, ac()); } save(); renderBeats();
  if (pr && !playing) { const c = ac(); const t0 = c.currentTime + .05; for (const n of presetNotes(pr, 0)) playDrum(c, drm.input, n.p, t0 + n.s * spb(), n.v); } }
function renderTempo() { $<HTMLInputElement>('#bpm').value = String(S.bpm); $('#bpmv').textContent = S.bpm + ' BPM';
  $('#tempos').querySelectorAll<HTMLElement>('button').forEach(b => b.classList.toggle('on', +b.dataset.b! === S.bpm)); }

// ---------- export
const dl = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
export async function buildMidi() { const { Midi } = await import('@tonejs/midi'); const m = new Midi(); m.header.setTempo(S.bpm);
  S.lanes.forEach((l, i) => { if (!l.notes.length) return; const mt = m.addTrack(); mt.name = `Lane ${i + 1} - ${sname(l.gm)}`; mt.channel = i; mt.instrument.number = midiProgram(l.gm);
    for (const n of l.notes) mt.addNote({ midi: n.p, time: n.s * spb(), duration: n.d * spb(), velocity: n.v }); });
  const dn = drumNotes(); if (dn.length) { const dt = m.addTrack(); dt.name = 'Drums'; dt.channel = 9; for (const n of dn) dt.addNote({ midi: n.p, time: n.s * spb(), duration: .25 * spb(), velocity: n.v }); }
  return new Blob([m.toArray() as BlobPart], { type: 'audio/midi' }); }
async function renderWav() { const c = ac(); toast('Preparing sounds…'); await Promise.all([loadKit(S.kit, c), ...S.lanes.map(l => loadGM(l.gm, c))]);
  const beats = notesEnd() ? Math.max(notesEnd(), S.beat ? songBeats() : 0) : S.beat ? songBeats() : 0; if (!beats) { toast('Nothing to export yet — hum a note first.'); return; }
  const sr = 44100; const oc = new OfflineAudioContext(2, Math.ceil((beats * spb() + 2.5) * sr), sr); const mg = oc.createGain(); mg.connect(oc.createDynamicsCompressor()).connect(oc.destination);
  const ms = makeStrip(oc, mg, S.bpm), ds = makeStrip(oc, mg, S.bpm); ms.update({ reverb: .15 } as any, .8, 0, true); ds.update({ reverb: .05 } as any, .75, 0, true);
  for (const l of S.lanes) for (const n of l.notes) playMel(oc, ms.input, { ...n, gm: l.gm }, n.s * spb() + .05, n.d * spb());
  for (const n of drumNotes()) if (n.s < beats) playDrum(oc, ds.input, n.p, n.s * spb() + .05, n.v);
  dl(encodeWav(await oc.startRendering()), 'hum-studio.wav'); toast('Saved hum-studio.wav'); }

// ---------- copy / place (long-press)
let clip: { p: number; d: number } | null = null; let lpCtx: { l: number; beat: number; note: Note | null } | null = null;
const fullName = (p: number) => spell(p, fifths()).name;
function renderTools() { const c = $('#clip'); c.hidden = !clip; if (clip) $('#cliptxt').textContent = `Copied ${fullName(clip.p)} (${clip.d} beat${clip.d > 1 ? 's' : ''})`;
  $('#del').hidden = !sel || !!clip; $('#hint').hidden = !!sel || !!clip; }
function openLp(x: number, y: number, l: number, beat: number, note: Note | null) { lpCtx = { l, beat, note }; buzz(15);
  const mnu = $('#lpm'); mnu.innerHTML = (clip ? `<button data-a="place">📌 Place ${fullName(clip.p)} here</button>` : '') + (note ? '<button data-a="copy">📋 Copy</button><button data-a="del" class="d">🗑 Delete</button>' : '') + '<button data-a="x" class="x">Cancel</button>';
  if (!clip && !note) { lpCtx = null; return; } mnu.hidden = false; const r = mnu.getBoundingClientRect();
  mnu.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2)) + 'px'; mnu.style.top = Math.max(8, y - r.height - 16) + 'px'; }
function closeLp() { $('#lpm').hidden = true; lpCtx = null; }
$('#lpm').onclick = e => { const b = (e.target as Element).closest('[data-a]') as HTMLElement | null; if (!b || !lpCtx) return; const { l, beat, note } = lpCtx; closeLp();
  if (b.dataset.a === 'copy' && note) { clip = { p: note.p, d: note.d }; sel = null; renderAll(); toast('Copied — long-press any spot in a lane to place it'); }
  else if (b.dataset.a === 'del' && note) { sel = note; del(); }
  else if (b.dataset.a === 'place' && clip) { const lane = S.lanes[l]; const n = placeAt(lane, clip.p, clip.d, beat); S.active = l; sel = null; fit(); save(); renderAll(); buzz(); preview(n.p, lane.gm); } };
$('#clipx').onclick = () => { clip = null; renderAll(); };
document.addEventListener('pointerdown', e => { if (!$('#lpm').hidden && !(e.target as Element).closest('#lpm')) closeLp(); }, true);

// ---------- wiring
{ const lane = $('#lane'); const pts = new Map<number, number>(); let lpT = 0; let tgt: Note | null = null, tl = 0, mode = '', x0 = 0, d0 = 1, pd0 = 0, moved = false;
  lane.addEventListener('pointerdown', e => { const t = e.target as Element; const el = t.closest('.nb') as HTMLElement | null; pts.set(e.pointerId, e.clientX); clearTimeout(lpT);
    if (pts.size === 2 && sel) { mode = 'pinch'; tgt = sel; d0 = sel.d; const a = [...pts.values()]; pd0 = Math.abs(a[0] - a[1]) || 1; return; }
    if (pts.size > 1) { mode = ''; return; } lane.setPointerCapture(e.pointerId); x0 = e.clientX; moved = false;
    const r0 = $('#blocks').getBoundingClientRect(); const cx = e.clientX, cy = e.clientY; const beat = Math.floor((cx - r0.left) / BW);
    const arm = () => { lpT = window.setTimeout(() => { if (moved || pts.size !== 1) return; mode = 'lp'; openLp(cx, cy, tl, beat, tgt); }, 450); };
    if (!el) { const r = $('#blocks').getBoundingClientRect(); tl = Math.max(0, Math.min(LANES - 1, Math.floor((e.clientY - r.top) / r.height * LANES))); tgt = null; mode = 'row'; arm(); return; }
    tl = +el.dataset.l!; tgt = S.lanes[tl].notes[+el.dataset.i!]; d0 = tgt.d; mode = t.closest('[data-grip]') ? 'grip' : 'tap'; if (mode === 'tap') arm(); e.preventDefault(); });
  lane.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e.clientX);
    if (mode === 'pinch' && tgt && pts.size === 2) { const a = [...pts.values()]; stretch(tgt, d0 * Math.abs(a[0] - a[1]) / pd0); return; }
    if (mode === 'grip' && tgt) { moved = true; stretch(tgt, d0 + (e.clientX - x0) / BW); } else if ((mode === 'tap' || mode === 'row') && (moved || Math.abs(e.clientX - x0) > 8)) { moved = true; clearTimeout(lpT); lane.scrollLeft -= e.clientX - x0; x0 = e.clientX; } });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); clearTimeout(lpT); if (pts.size) return;
    if (!moved && mode === 'row') { sel = null; if (tl !== S.active) setActive(tl); else renderAll(); }
    if (!moved && mode === 'tap' && tgt) { const n = tgt; if (tl !== S.active) { S.active = tl; save(); } sel = sel === n ? null : n; preview(n.p, S.lanes[tl].gm); renderAll(); }
    tgt = null; mode = ''; };
  lane.addEventListener('pointerup', up); lane.addEventListener('pointercancel', up); lane.addEventListener('contextmenu', e => e.preventDefault()); }
$('#hum').onclick = () => toggleMic(); $('#yes').onclick = keep; $('#no').onclick = discard; $('#del').onclick = del;
$('#sounds').onclick = e => { const b = (e.target as Element).closest('button') as HTMLElement | null; if (!b) return; if (b.dataset.gm === 'more') openPicker(); else setActive(+b.dataset.l!); };
$('#labels').onclick = e => { const b = (e.target as Element).closest('[data-l]') as HTMLElement | null; if (!b) return; if (+b.dataset.l! === S.active) openPicker(); else setActive(+b.dataset.l!); };
$('#pinuse').onclick = e => { const b = (e.target as Element).closest('[data-pl]') as HTMLElement | null; if (b) { setActive(+b.dataset.pl!); renderPicker(); } };
$('#plist').onclick = e => { const st = (e.target as Element).closest('[data-star]') as HTMLElement | null; if (st) { toggleFav(+st.dataset.star!); renderPicker(); return; } const b = (e.target as Element).closest('[data-gm]') as HTMLElement | null; if (b) { pickSound(+b.dataset.gm!); closePicker(); } };
$('#search').oninput = renderPicker; $('#pclose').onclick = closePicker; $('#picker').onclick = e => { if (e.target === $('#picker')) closePicker(); };
$('#addbar').onclick = () => { S.bars++; save(); renderSong(); requestAnimationFrame(() => { const l = $('#lane'); l.scrollLeft = l.scrollWidth; }); };
// ---------- clear all (confirm + 5s undo)
const OLD_KEYS = [KEY, 'hum-studio-v1', 'h2m-project-v2']; let undoSong: Song | null = null, undoT = 0;
function clearAll() { stop(); if (micOn) toggleMic(); pending = null; lock = null; showPop(); undoSong = JSON.parse(JSON.stringify(S));
  clearTimeout(saveT); OLD_KEYS.forEach(k => localStorage.removeItem(k)); S = freshSong() as Song; sel = null; clip = null; closeLp(); hi = []; songKey = '';
  renderAll(); renderBeats(); renderTempo(); $('#lane').scrollLeft = 0; $('#beatpanel').hidden = true; renderName();
  $('#toast').hidden = true; const u = $('#undo'); u.hidden = false; clearTimeout(undoT); undoT = window.setTimeout(() => { u.hidden = true; undoSong = null; }, 5000); }
function undoClear() { if (!undoSong) return; S = undoSong; undoSong = null; clearTimeout(undoT); $('#undo').hidden = true; songKey = ''; saveNow(); renderAll(); renderName(); renderBeats(); renderTempo(); toast('Song restored'); }
$('#clear').onclick = () => { closeMenu(); $('#confirm').hidden = false; };
$('#cno').onclick = () => { $('#confirm').hidden = true; };
$('#cyes').onclick = () => { $('#confirm').hidden = true; clearAll(); };
$('#undobtn').onclick = undoClear;
$('#play').onclick = () => playing ? stop() : play();
$('#replay').onclick = () => { $('#lane').scrollTo({ left: 0, behavior: 'smooth' }); play(); };
$('#beatbtn').onclick = () => { const k = $('#beatpanel'); k.hidden = !k.hidden; };
$('#beats').onclick = e => { const b = (e.target as Element).closest('[data-id]') as HTMLElement | null; if (b) pickBeat(b.dataset.id || null); };
$('#tempos').innerHTML = TEMPOS.map(t => `<button data-b="${t.b}">${t.n}</button>`).join('');
$('#tempos').onclick = e => { const b = (e.target as Element).closest('[data-b]') as HTMLElement | null; if (b) setBpm(+b.dataset.b!); };
$<HTMLInputElement>('#bpm').oninput = e => setBpm(+(e.target as HTMLInputElement).value);
$('#xwav').onclick = () => { closeMenu(); renderWav(); };
$('#xmid').onclick = async () => { closeMenu(); dl(await buildMidi(), 'hum-studio.mid'); toast('Saved hum-studio.mid'); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });
// ---------- Hum a Song: record a phrase, analyse it off the main thread, preview, keep into the active lane
const HS_MAX = 20; let hs: { stream: MediaStream; node: AudioWorkletNode; src: MediaStreamAudioSourceNode; chunks: Float32Array[]; t0: number; raf: number; done: boolean } | null = null;
let hsRes: Phrase | null = null; let hsWorker: Worker | null = null;
const hsShow = (w: 'rec' | 'work' | 'prev') => { $('#hsong').hidden = false; $('#hsrec').hidden = w !== 'rec'; $('#hswork').hidden = w !== 'work'; $('#hsprev').hidden = w !== 'prev'; };
const WK = `registerProcessor('hs-rec',class extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}})`;
let wkReady: Promise<void> | null = null;
function laneRange(gm: number): [number, number] { const g = (voice(gm)?.g ?? gmCat(gm).name).toLowerCase();
  if (g.includes('bass')) return [36, 52]; if (/mallet|bell|wind|flute|pipe|reed/.test(g)) return [62, 84]; if (/string|brass|ensemble/.test(g)) return [55, 76]; return [55, 74]; }
async function humSong() { if (micOn) toggleMic(); stop(); const c = ac();
  let stream: MediaStream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }); } catch { toast('Microphone access was denied.'); return; }
  try { wkReady ||= c.audioWorklet.addModule(URL.createObjectURL(new Blob([WK], { type: 'text/javascript' }))); await wkReady; } catch { stream.getTracks().forEach(t => t.stop()); toast('Recording is not supported here.'); return; }
  const src = c.createMediaStreamSource(stream); const node = new AudioWorkletNode(c, 'hs-rec'); const chunks: Float32Array[] = [];
  node.port.onmessage = e => chunks.push(e.data); const sink = c.createGain(); sink.gain.value = 0; src.connect(node).connect(sink).connect(c.destination);
  hs = { stream, node, src, chunks, t0: performance.now(), raf: 0, done: false }; hsShow('rec'); buzz(15);
  const tick = () => { if (!hs || hs.done) return; const el = (performance.now() - hs.t0) / 1000; $('#hsfill').style.width = Math.min(100, el / HS_MAX * 100) + '%';
    $('#hstime').textContent = `Listening… ${Math.max(0, Math.ceil(HS_MAX - el))}s left · tap Stop when done`; if (el >= HS_MAX) { hsStop(true); return; } hs.raf = requestAnimationFrame(tick); }; tick(); }
function hsEnd() { if (!hs) return null; const h = hs; h.done = true; cancelAnimationFrame(h.raf); h.node.port.onmessage = null; try { h.src.disconnect(); h.node.disconnect(); } catch { /* */ } h.stream.getTracks().forEach(t => t.stop()); hs = null; return h; }
function hsStop(analyseIt: boolean) { const h = hsEnd(); if (!h) return; if (!analyseIt) { $('#hsong').hidden = true; return; }
  const n = h.chunks.reduce((s, c) => s + c.length, 0); const x = new Float32Array(n); let o = 0; for (const c of h.chunks) { x.set(c, o); o += c.length; }
  if (n < ctx!.sampleRate * .5) { $('#hsong').hidden = true; toast('That was too short — hum a little longer.'); return; }
  hsShow('work'); const msg = { x, sr: ctx!.sampleRate, bpm: S.bpm, range: laneRange(AL().gm) }; const t0 = performance.now();
  const done = (r: Phrase) => { (window as any).__hsLast = { ms: Math.round(performance.now() - t0), worker: !!hsWorker }; hsRes = r; hsPreview(); };
  try { hsWorker ||= new Worker(new URL('./phrase.worker.ts', import.meta.url), { type: 'module' }); hsWorker.onmessage = e => done(e.data); hsWorker.onerror = () => { hsWorker = null; done(analyze(x, msg.sr, msg.bpm, msg.range)); }; hsWorker.postMessage(msg, [x.buffer]); }
  catch { hsWorker = null; setTimeout(() => done(analyze(x, msg.sr, msg.bpm, msg.range)), 30); } }
function hsPreview() { const r = hsRes!; if (!r.notes.length) { $('#hsong').hidden = true; toast('No notes heard — try humming louder, “doo doo doo”.'); hsRes = null; return; }
  const ln = r.notes[r.notes.length - 1]; const beats = ln.s + ln.d; $('#hstitle').textContent = `Found ${r.notes.length} note${r.notes.length > 1 ? 's' : ''}`;
  $('#hsinfo').textContent = `${r.key.name} · ${beats} beats · for lane ${S.active + 1} (${sname(AL().gm)})${r.shift ? ` · moved ${r.shift > 0 ? 'up' : 'down'} ${Math.abs(r.shift / 12)} octave${Math.abs(r.shift) > 12 ? 's' : ''}` : ''}`;
  const W = 34; let at = 0; const out: string[] = []; for (const n of r.notes) { if (n.s > at) out.push(`<span class="rest" style="width:${(n.s - at) * W - 3}px"></span>`); out.push(`<span style="width:${n.d * W - 3}px;background:${color(n.p)}">${nName(n.p)}</span>`); at = n.s + n.d; }
  $('#hsnotes').innerHTML = out.join(''); hsShow('prev'); loadGM(AL().gm, ac()); }
let hsPlayT = 0;
function hsPlay() { if (!hsRes) return; const c = ac(); const gm = AL().gm; const go = () => { const t0 = c.currentTime + .08; for (const n of hsRes!.notes) playMel(c, master, { p: n.p, gm, v: n.v }, t0 + n.s * spb(), n.d * spb()); }; if (hasGM(gm)) go(); else loadGM(gm, c).then(go); clearTimeout(hsPlayT); }
function hsKeep() { if (!hsRes) return; const lane = AL(); const start = playing ? Math.floor(posBeat()) : nextSpot(lane);
  for (const n of hsRes.notes) placeAt(lane, n.p, n.d, start + n.s, n.v); const cnt = hsRes.notes.length; hsRes = null; $('#hsong').hidden = true; fit(); sel = null; save(); renderAll(); buzz();
  toast(`Added ${cnt} notes to lane ${S.active + 1}`); requestAnimationFrame(() => { const l = $('#lane'); l.scrollLeft = Math.max(0, start * BW - 40); }); }
$('#humsong').onclick = humSong; $('#hsstop').onclick = () => hsStop(true); $('#hscancel').onclick = () => hsStop(false);
$('#hsplay').onclick = hsPlay; $('#hsyes').onclick = hsKeep; $('#hsno').onclick = () => { hsRes = null; $('#hsong').hidden = true; };

// ---------- save system: songs saved on this device (localStorage 'hum-studio-songs')
const songSec = () => notesEnd() * spb();
function renderName() { $('#sname').textContent = (S.name || 'Untitled') + (dirty() ? ' •' : ''); }
let savedSnap = ''; const snap = () => JSON.stringify({ ...S, active: 0 });
const dirty = () => !!S.sid && snap() !== savedSnap;
function askName(title: string, def: string, ok: string): Promise<string | null> { return new Promise(res => {
  $('#ntitle').textContent = title; $('#nyes').textContent = ok; const inp = $<HTMLInputElement>('#ninput'); inp.value = def; $('#namebox').hidden = false; setTimeout(() => { inp.focus(); inp.select(); }, 30);
  const done = (v: string | null) => { $('#namebox').hidden = true; $('#nyes').onclick = $('#nno').onclick = null; inp.onkeydown = null; res(v); };
  $('#nyes').onclick = () => { const v = inp.value.trim(); if (v) done(v); else inp.focus(); }; $('#nno').onclick = () => done(null);
  inp.onkeydown = e => { if (e.key === 'Enter') ($('#nyes') as HTMLButtonElement).click(); }; }); }
function askYes(title: string, sub: string, ok: string): Promise<boolean> { return new Promise(res => { $('#atitle').textContent = title; $('#asub').textContent = sub; $('#ayes').textContent = ok; $('#ask').hidden = false;
  const done = (v: boolean) => { $('#ask').hidden = true; res(v); }; $('#ayes').onclick = () => done(true); $('#ano').onclick = () => done(false); }); }
function storeAs(name: string, id?: string) { S.name = name; const d = { ...S }; delete d.sid; S.sid = lib.saveSong(localStorage, { id, name, beats: notesEnd(), data: { ...d, bpm: S.bpm } }); savedSnap = snap(); localStorage.setItem('hum-studio-snap', savedSnap); saveNow(); renderName(); }
async function doSave() { if (!S.name || !S.sid) { const n = await askName('Name your song', lib.uniqueName(localStorage, S.name || 'My song'), 'Save'); if (!n) return; storeAs(n); }
  else storeAs(S.name, S.sid); toast(`Saved “${S.name}”`); buzz(); }
async function doSaveAs() { closeMenu(); const n = await askName('Save a copy as…', lib.uniqueName(localStorage, (S.name || 'My song') + ' copy'), 'Save copy'); if (!n) return; storeAs(n); toast(`Saved copy “${n}”`); }
function openSong(id: string) { const s = lib.getSong(localStorage, id); if (!s) return; stop(); S = { ...JSON.parse(JSON.stringify(s.data)), name: s.name, sid: s.id, active: 0 }; savedSnap = snap(); localStorage.setItem('hum-studio-snap', savedSnap);
  sel = null; clip = null; hi = []; songKey = ''; saveNow(); renderAll(); renderBeats(); renderTempo(); renderName(); $('#lane').scrollLeft = 0; showStudio(); toast(`Opened “${s.name}”`); }
function renderList() { const a = lib.sorted(localStorage); const d = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  $('#slist').innerHTML = a.length ? a.map(s => `<div class="srow${s.id === S.sid ? ' cur' : ''}" data-id="${s.id}"><button class="sopen" data-a="open"><b>${esc(s.name)}</b><small>${d(s.at)} · ${lib.fmtLen(s.beats * 60 / (s.data?.bpm || 100))}</small></button><button class="chip" data-a="ren" aria-label="Rename">✏️</button><button class="chip" data-a="dup" aria-label="Duplicate">⧉</button><button class="chip" data-a="del" aria-label="Delete">🗑</button></div>`).join('')
    : '<p class="hint">No saved songs yet — tap 💾 Save in the Studio.</p>'; }
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function showList() { closeMenu(); renderList(); $('#songs').hidden = false; }
function showStudio() { closeMenu(); $('#songs').hidden = true; }
function closeMenu() { $('#menu').hidden = true; }
$('#slist').onclick = async e => { const b = (e.target as Element).closest('[data-a]') as HTMLElement | null; if (!b) return; const id = (b.closest('[data-id]') as HTMLElement).dataset.id!; const s = lib.getSong(localStorage, id); if (!s) return;
  if (b.dataset.a === 'open') openSong(id);
  else if (b.dataset.a === 'ren') { const n = await askName('Rename song', s.name, 'Rename'); if (n && lib.renameSong(localStorage, id, n)) { if (S.sid === id) { S.name = n; saveNow(); renderName(); } renderList(); } }
  else if (b.dataset.a === 'dup') { lib.duplicateSong(localStorage, id); renderList(); toast('Duplicated'); }
  else if (b.dataset.a === 'del') { if (await askYes(`Delete “${s.name}”?`, 'This can’t be undone.', 'Delete')) { lib.deleteSong(localStorage, id); if (S.sid === id) { delete S.sid; saveNow(); renderName(); } renderList(); toast('Deleted'); } } };
{ const sv = $('#save'); let t = 0, long = false; sv.addEventListener('pointerdown', () => { long = false; t = window.setTimeout(() => { long = true; buzz(15); doSaveAs(); }, 550); });
  const end = () => clearTimeout(t); sv.addEventListener('pointerup', end); sv.addEventListener('pointerleave', end); sv.addEventListener('pointercancel', end); sv.addEventListener('contextmenu', e => e.preventDefault());
  sv.onclick = () => { if (long) { long = false; return; } doSave(); }; }
$('#menubtn').onclick = () => { $('#menu').hidden = false; }; $('#mclose').onclick = closeMenu; $('#menu').onclick = e => { if (e.target === $('#menu')) closeMenu(); };
$('#mstudio').onclick = showStudio; $('#mlist').onclick = showList; $('#msaveas').onclick = doSaveAs; $('#sback').onclick = showStudio;
{ if (S.sid) { if (!lib.getSong(localStorage, S.sid)) delete S.sid; else savedSnap = localStorage.getItem('hum-studio-snap') || ''; } setInterval(renderName, 1500); renderName(); }
(window as any).__hs = { get song() { return S; }, ids: () => [...VOICES.map(v => v.id), ...GM.map((_, p) => p)],
  rms: async (id: number, note = 60) => { const ok = await loadGM(id, ac()); const oc = new OfflineAudioContext(1, 44100 * 1.2, 44100); const used = playGM(oc, oc.destination, id, note, 0.01, .8, .9); const d = (await oc.startRendering()).getChannelData(0); let s = 0; for (const x of d) s += x * x; return { ok, used, rms: Math.sqrt(s / d.length) }; }, get clip() { return clip; }, pv: pvLog, posBeat: () => posBeat() };
showPop(); renderAll(); renderBeats(); renderTempo(); syncPlay();
