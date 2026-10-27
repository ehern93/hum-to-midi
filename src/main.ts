import './style.css';
import { plan } from './sched';
import { splitByInstrument } from './group';
import { renderStaff, keyFifths, spell, autoClef } from './score';
import { detectPitch } from './pitch';
import { SCALES, freqToMidiFloat, NoteStabilizer } from './music';
import { GM, GM_CATS, gmCat, gmLabel, loadGM, playGM } from './gm';
import { playNote, makeStrip, Strip, encodeWav } from './audio';
import { PRESETS, presetNotes, beatNotes, loadKit, playKit } from './drums';
import { MAX_SOUNDS, soundsInUse, pickExceeds, swapSound } from './limit';

interface Note { p: number; s: number; d: number; v: number; gm: number }
interface Song { bpm: number; bars: number; notes: Note[]; beat: string | null; kit: string; brush: number }
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const KEY = 'hum-studio-v1';
const FAV = [{ gm: 0, i: '🎹', n: 'Piano' }, { gm: 24, i: '🎸', n: 'Guitar' }, { gm: 73, i: '🪈', n: 'Flute' }, { gm: 40, i: '🎻', n: 'Violin' }, { gm: 56, i: '🎺', n: 'Trumpet' }, { gm: 80, i: '🎛️', n: 'Synth' }, { gm: 14, i: '🔔', n: 'Bells' }, { gm: 33, i: '🎸', n: 'Bass' }, { gm: 65, i: '🎷', n: 'Sax' }, { gm: 11, i: '🎶', n: 'Vibes' }];
const TEMPOS = [{ n: 'Slow', b: 80 }, { n: 'Medium', b: 100 }, { n: 'Fast', b: 130 }];
const GROOVES = PRESETS.filter(p => p.group === 'Grooves');

function migrate(): Song | null { try { const p = JSON.parse(localStorage.getItem('h2m-project-v2') || ''); const t = p.tracks.find((x: any) => x.inst !== 'drums');
  return { bpm: p.bpm || 100, bars: p.bars || 2, notes: (t?.notes || []).map((n: any) => ({ p: n.p, s: n.s, d: n.d, v: n.v ?? .85, gm: n.gm ?? t.gm ?? 0 })), beat: p.beat?.id ?? null, kit: p.beat?.kit || 'studio', brush: 0 }; } catch { return null; } }
function load(): Song { try { const s = JSON.parse(localStorage.getItem(KEY) || ''); if (s && Array.isArray(s.notes)) return s; } catch { /* */ } return migrate() || { bpm: 100, bars: 2, notes: [], beat: null, kit: 'studio', brush: 0 }; }
let S = load();
let saveT = 0; const save = () => { clearTimeout(saveT); saveT = window.setTimeout(saveNow, 400); };
const saveNow = () => { clearTimeout(saveT); localStorage.setItem(KEY, JSON.stringify(S)); };
addEventListener('pagehide', saveNow); document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
const buzz = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* */ } };
const toast = (s: string) => { const t = $('#toast'); t.textContent = s; t.hidden = false; clearTimeout((t as any)._t); (t as any)._t = setTimeout(() => t.hidden = true, 2500); };

// ---------- audio
let ctx: AudioContext | null = null; let mel: Strip, drm: Strip, master: GainNode;
function ac() { if (!ctx) { ctx = new AudioContext({ latencyHint: 'interactive' }); master = ctx.createGain(); master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination); mel = makeStrip(ctx, master, S.bpm); drm = makeStrip(ctx, master, S.bpm); mel.update({ reverb: .15 } as any, .8, 0, true); drm.update({ reverb: .05 } as any, .75, 0, true); }
  if (ctx.state === 'suspended') ctx.resume(); return ctx; }
const spb = () => 60 / S.bpm;
function playMel(c: BaseAudioContext, out: AudioNode, n: { p: number; gm: number; v: number }, t: number, dur: number) { if (!playGM(c, out, n.gm, n.p, t, dur, n.v)) playNote(c, out, 'piano', n.p, t, dur, n.v); }
function playDrum(c: BaseAudioContext, out: AudioNode, m: number, t: number, v: number) { if (!playKit(c, out, S.kit, m, t, v)) playNote(c, out, 'drums', m, t, .1, v); }
const notesEnd = () => Math.max(0, ...S.notes.map(n => n.s + n.d));
const songBeats = () => Math.max(S.bars * 4, Math.ceil(notesEnd() / 4) * 4);
let drumCache = { k: '', n: [] as { p: number; s: number; v: number }[] };
function drumNotes() { const k = S.beat + ':' + S.bars; if (drumCache.k !== k) { const pr = PRESETS.find(p => p.id === S.beat); drumCache = { k, n: pr ? beatNotes(pr, S.bars, true).notes : [] }; } return drumCache.n; }

// ---------- transport
let playing = false, startCtxTime = 0, startBeat = 0, schedBeat = 0, timer = 0;
const posBeat = () => playing && ctx ? startBeat + (ctx.currentTime - startCtxTime) / spb() : 0;
function play() { const c = ac(); stop(); playing = true; startBeat = 0; schedBeat = 0; startCtxTime = c.currentTime + .05; timer = window.setInterval(schedule, 25); schedule(); requestAnimationFrame(anim); syncPlay(); }
function stop() { if (!playing) return; playing = false; clearInterval(timer); hi = null; renderSong(); syncPlay(); }
function schedule() { if (!ctx) return; const now = ctx.currentTime;
  const r = plan({ schedBeat, startBeat, startCtxTime }, now, spb(), { on: false, s: 0, e: 0 }); ({ schedBeat, startBeat, startCtxTime } = r.clock);
  for (const g of r.segs) { const tt = (b: number) => Math.max(now, g.t0 + (b - g.b0) * spb());
    for (const n of S.notes) if (n.s >= g.from && n.s < g.to) playMel(ctx, mel.input, n, tt(n.s), n.d * spb());
    for (const n of drumNotes()) if (n.s >= g.from && n.s < g.to) playDrum(ctx, drm.input, n.p, tt(n.s), n.v); }
  if (posBeat() > songBeats()) stop(); }
function setBpm(b: number) { b = Math.max(60, Math.min(160, Math.round(b))); if (playing && ctx) { const pb = posBeat(); startBeat = pb; startCtxTime = ctx.currentTime; schedBeat = Math.max(schedBeat, pb); } S.bpm = b; save(); renderTempo(); }
let hi: Note | null = null;
function anim() { if (!playing) return; requestAnimationFrame(anim); const b = posBeat(); const n = S.notes.find(x => b >= x.s && b < x.s + x.d) || null;
  const ph = $('#playhead'); ph.style.transform = `translateX(${b * BW}px)`;
  if (n !== hi) { hi = n; renderSong(); if (n) { const l = $('#lane'); const x = n.s * BW; if (x > l.scrollLeft + l.clientWidth - 80 || x < l.scrollLeft) l.scrollLeft = Math.max(0, x - 40); } } }
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
  $('#pstaff').innerHTML = renderStaff([{ p, s: 0, d: 1, id: 0 }], { clef: autoClef([p]), fifths: fifths(), beatW: 40, beats: 1, single: true, height: 150, color: '#222' }).svg; }
function keep() { if (pending === null) return; const n: Note = { p: pending, s: Math.ceil(notesEnd() - 1e-6), d: 1, v: .85, gm: S.brush }; S.notes.push(n); fit();
  loadGM(S.brush, ac()).then(() => preview(n)); lock = pending; pending = null; sel = null; showPop(); buzz(); save(); renderAll(); requestAnimationFrame(() => { const l = $('#lane'); l.scrollLeft = l.scrollWidth; }); }
function discard() { lock = pending; pending = null; showPop(); }
function preview(n: { p: number; gm: number }) { const c = ac(); playMel(c, mel.input, { ...n, v: .8 }, c.currentTime, .45); }
function fit() { const need = Math.ceil(notesEnd() / 4); if (need > S.bars) S.bars = need; }
function shiftAfter(from: number, by: number, except?: Note) { for (const n of S.notes) if (n !== except && n.s >= from - 1e-6) n.s = Math.max(0, n.s + by); }
function stretch(n: Note, d: number) { d = Math.max(1, Math.min(4, Math.round(d))); if (d === n.d) return; shiftAfter(n.s + n.d, d - n.d, n); n.d = d; fit(); buzz(); save(); renderSong(); }
function del() { if (!sel) return; const n = sel; S.notes = S.notes.filter(x => x !== n); shiftAfter(n.s + n.d, -n.d); sel = null; save(); renderAll(); }

// ---------- song lane
const BW = 64; let sel: Note | null = null, songKey = '';
const icon = (gm: number) => FAV.find(f => f.gm === gm)?.i ?? gmCat(gm).icon;
const sname = (gm: number) => FAV.find(f => f.gm === gm)?.n ?? gmLabel(gm);
function renderSong() { if (sel && !S.notes.includes(sel)) sel = null; const beats = songBeats(); const ps = S.notes.map(n => n.p); const lo = Math.min(...ps, 60), hiP = Math.max(...ps, 72); const H = 170, BH = 46;
  const key = JSON.stringify([S.notes, beats, sel && S.notes.indexOf(sel), hi && S.notes.indexOf(hi)]); if (key === songKey) return; songKey = key;
  const out: string[] = []; for (let b = 0; b <= beats; b++) out.push(`<div class="bl${b % 4 === 0 ? ' bar' : ''}" style="left:${b * BW}px"></div>` + (b % 4 === 0 && b < beats ? `<span class="bno" style="left:${b * BW + 6}px">${b / 4 + 1}</span>` : ''));
  S.notes.forEach((n, i) => { const y = 22 + (hiP === lo ? .5 : (hiP - n.p) / (hiP - lo)) * (H - BH - 28);
    out.push(`<div class="nb${n === sel ? ' sel' : ''}${n === hi ? ' hi' : ''}" data-i="${i}" style="left:${n.s * BW + 3}px;top:${y}px;width:${n.d * BW - 6}px;height:${BH}px;background:${color(n.p)}"><span class="ic">${icon(n.gm)}</span>${nName(n.p)}<small>${n.d}</small><span class="grip" data-grip="1">⟷</span></div>`); });
  out.push('<div id="playhead" class="ph"' + (playing ? '' : ' hidden') + '></div>');
  const k = $('#blocks'); k.style.width = (beats * BW + 2) + 'px'; k.innerHTML = out.join(''); $('#tools').hidden = !sel; if (sel) $('#tsound').innerHTML = `${icon(sel.gm)} ${sname(sel.gm)} <b>▾</b>`; }
function renderSounds() { const used = soundsInUse(S.notes, S.brush);
  $('#sounds').innerHTML = used.map(g => `<button class="slot${g === (sel ? sel.gm : S.brush) ? ' on' : ''}" data-gm="${g}"><span>${icon(g)}</span>${sname(g)}</button>`).join('') + Array.from({ length: MAX_SOUNDS - used.length }, () => '<button class="slot empty" data-gm="more"><span>＋</span>free</button>').join('') + '<button class="slot more" data-gm="more"><span>🎼</span>All sounds</button>';
  $('#scount').textContent = `${used.length}/${MAX_SOUNDS} sounds in your song`; }
function renderAll() { renderSong(); renderSounds(); }

// ---------- sound picker (curated favorites first, then all 128 GM)
let pickFor: Note | null = null, swapGm: number | null = null;
function openPicker(target: Note | null) { pickFor = target; swapGm = null; $<HTMLInputElement>('#search').value = ''; $('#picker').classList.add('open'); renderPicker(); }
function closePicker() { $('#picker').classList.remove('open'); swapGm = null; }
function renderPicker() { const q = $<HTMLInputElement>('#search').value.trim().toLowerCase(); const used = soundsInUse(S.notes, S.brush); const curG = pickFor ? pickFor.gm : S.brush;
  $('#ptitle').textContent = pickFor ? `Sound for this ${nName(pickFor.p)} note` : 'Pick a sound';
  $('#pinuse').innerHTML = `<small>In your song (${used.length}/${MAX_SOUNDS})</small>` + used.map(g => `<button class="ii use${g === curG ? ' on' : ''}" data-gm="${g}"><span>${icon(g)}</span><b>${sname(g)}</b></button>`).join('');
  const sw = $('#swap'); sw.hidden = swapGm === null;
  if (swapGm !== null) sw.innerHTML = `<p>Your song can use ${MAX_SOUNDS} sounds at a time. Swap one for <b>${icon(swapGm)} ${sname(swapGm)}</b>? Its notes will switch over.</p><div class="row">${used.map(g => `<button class="swapbtn" data-out="${g}">${icon(g)} ${sname(g)} → ${icon(swapGm!)}</button>`).join('')}<button class="swapbtn cancel" data-out="x">Keep as is</button></div>`;
  const fav = FAV.filter(f => !q || f.n.toLowerCase().includes(q) || gmLabel(f.gm).toLowerCase().includes(q));
  const all = GM.map((_, p) => p).filter(p => !q || gmLabel(p).toLowerCase().includes(q) || gmCat(p).name.toLowerCase().includes(q));
  let html = fav.length ? '<h4>Favorites</h4><div class="grid">' + fav.map(f => `<button class="ii fav${f.gm === curG ? ' on' : ''}${used.includes(f.gm) ? ' used' : ''}" data-gm="${f.gm}"><span>${f.i}</span><b>${f.n}</b></button>`).join('') + '</div>' : '';
  let cat = -1; for (const p of all) { if (p >> 3 !== cat) { if (cat >= 0) html += '</div>'; cat = p >> 3; html += `<h4>${GM_CATS[cat].icon} ${GM_CATS[cat].name}</h4><div class="list">`; }
    html += `<button class="ii${p === curG ? ' on' : ''}${used.includes(p) ? ' used' : ''}" data-gm="${p}"><span>${gmCat(p).icon}</span><b>${gmLabel(p)}</b></button>`; }
  if (cat >= 0) html += '</div>'; $('#plist').innerHTML = html || '<p class="hint">No sounds match.</p>'; }
function applyPick(gm: number) { if (pickFor) pickFor.gm = gm; S.brush = gm; save(); renderAll(); loadGM(gm, ac()).then(() => preview({ p: pickFor?.p ?? 60, gm })); }
function tryPick(gm: number) { if (pickExceeds(S.notes, S.brush, gm, pickFor)) { swapGm = gm; renderPicker(); $('#swap').scrollIntoView({ block: 'nearest' }); toast(`Up to ${MAX_SOUNDS} sounds at once — swap one?`); return false; } applyPick(gm); return true; }

// ---------- beats + tempo
function renderBeats() { $('#beats').innerHTML = [`<button data-id="" class="${!S.beat ? 'on' : ''}">🚫 None</button>`, ...GROOVES.map(p => `<button data-id="${p.id}" class="${S.beat === p.id ? 'on' : ''}">${p.name}</button>`)].join('');
  const pr = PRESETS.find(p => p.id === S.beat); $('#beatbtn').innerHTML = `🥁 ${pr ? pr.name : 'Beat'}`; $('#beatbtn').classList.toggle('on', !!pr); }
function pickBeat(id: string | null) { S.beat = id; const pr = PRESETS.find(p => p.id === id); if (pr?.kit) { S.kit = pr.kit; loadKit(pr.kit, ac()); } save(); renderBeats();
  if (pr && !playing) { const c = ac(); const t0 = c.currentTime + .05; for (const n of presetNotes(pr, 0)) playDrum(c, drm.input, n.p, t0 + n.s * spb(), n.v); } }
function renderTempo() { $<HTMLInputElement>('#bpm').value = String(S.bpm); $('#bpmv').textContent = S.bpm + ' BPM';
  $('#tempos').querySelectorAll<HTMLElement>('button').forEach(b => b.classList.toggle('on', +b.dataset.b! === S.bpm)); }

// ---------- export
const dl = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
export async function buildMidi() { const { Midi } = await import('@tonejs/midi'); const m = new Midi(); m.header.setTempo(S.bpm); let ch = 0;
  const tracks = splitByInstrument([{ name: 'Melody', inst: 'melody', gm: null as number | null, notes: S.notes }, { name: 'Drums', inst: 'drums', notes: drumNotes().map(n => ({ ...n, d: .25 })) }], gmLabel);
  for (const t of tracks) { if (!t.notes.length) continue; const mt = m.addTrack(); mt.name = t.name; const drum = t.inst === 'drums'; if (!drum && ch === 9) ch++; mt.channel = drum ? 9 : ch++; if (!drum) mt.instrument.number = t.gm ?? 0;
    for (const n of t.notes) mt.addNote({ midi: n.p, time: n.s * spb(), duration: n.d * spb(), velocity: n.v }); }
  return new Blob([m.toArray() as BlobPart], { type: 'audio/midi' }); }
async function renderWav() { const c = ac(); toast('Preparing sounds…'); await Promise.all([loadKit(S.kit, c), ...[...new Set(S.notes.map(n => n.gm))].map(g => loadGM(g, c))]);
  const beats = S.notes.length ? Math.max(notesEnd(), S.beat ? songBeats() : 0) : S.beat ? songBeats() : 0; if (!beats) { toast('Nothing to export yet — hum a note first.'); return; }
  const sr = 44100; const oc = new OfflineAudioContext(2, Math.ceil((beats * spb() + 2.5) * sr), sr); const mg = oc.createGain(); mg.connect(oc.createDynamicsCompressor()).connect(oc.destination);
  const ms = makeStrip(oc, mg, S.bpm), ds = makeStrip(oc, mg, S.bpm); ms.update({ reverb: .15 } as any, .8, 0, true); ds.update({ reverb: .05 } as any, .75, 0, true);
  for (const n of S.notes) playMel(oc, ms.input, n, n.s * spb() + .05, n.d * spb());
  for (const n of drumNotes()) if (n.s < beats) playDrum(oc, ds.input, n.p, n.s * spb() + .05, n.v);
  dl(encodeWav(await oc.startRendering()), 'hum-studio.wav'); toast('Saved hum-studio.wav'); }

// ---------- wiring
{ const lane = $('#lane'); const pts = new Map<number, number>(); let tgt: Note | null = null, mode = '', x0 = 0, d0 = 1, pd0 = 0, moved = false;
  lane.addEventListener('pointerdown', e => { const el = (e.target as Element).closest('.nb') as HTMLElement | null; pts.set(e.pointerId, e.clientX);
    if (pts.size === 2 && sel) { mode = 'pinch'; tgt = sel; d0 = sel.d; const a = [...pts.values()]; pd0 = Math.abs(a[0] - a[1]) || 1; return; }
    if (!el) { mode = ''; return; } lane.setPointerCapture(e.pointerId); tgt = S.notes[+el.dataset.i!]; x0 = e.clientX; d0 = tgt.d; moved = false; mode = (e.target as Element).closest('[data-grip]') ? 'grip' : 'tap'; e.preventDefault(); });
  lane.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e.clientX); if (!tgt) return;
    if (mode === 'pinch' && pts.size === 2) { const a = [...pts.values()]; stretch(tgt, d0 * Math.abs(a[0] - a[1]) / pd0); return; }
    if (mode === 'grip') { moved = true; stretch(tgt, d0 + (e.clientX - x0) / BW); } else if (mode === 'tap' && Math.abs(e.clientX - x0) > 8) { moved = true; lane.scrollLeft -= e.clientX - x0; x0 = e.clientX; } });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size) return; if (tgt && mode !== 'pinch' && !moved) { sel = sel === tgt ? null : tgt; if (sel) { preview(sel); S.brush = sel.gm; } renderAll(); } tgt = null; mode = ''; };
  lane.addEventListener('pointerup', up); lane.addEventListener('pointercancel', up); }
$('#hum').onclick = () => toggleMic(); $('#yes').onclick = keep; $('#no').onclick = discard; $('#del').onclick = del;
$('#tsound').onclick = () => sel && openPicker(sel);
$('#sounds').onclick = e => { const b = (e.target as Element).closest('[data-gm]') as HTMLElement | null; if (!b) return; if (b.dataset.gm === 'more') openPicker(sel); else { pickFor = sel; applyPick(+b.dataset.gm!); } };
$('#plist').onclick = $('#pinuse').onclick = e => { const b = (e.target as Element).closest('[data-gm]') as HTMLElement | null; if (b && tryPick(+b.dataset.gm!)) closePicker(); };
$('#swap').onclick = e => { const b = (e.target as Element).closest('[data-out]') as HTMLElement | null; if (!b || swapGm === null) return; const g = swapGm; swapGm = null;
  if (b.dataset.out !== 'x') { swapSound(S.notes, +b.dataset.out!, g); if (S.brush === +b.dataset.out!) S.brush = g; applyPick(g); closePicker(); toast(`Swapped in ${sname(g)}`); } else renderPicker(); };
$('#search').oninput = renderPicker; $('#pclose').onclick = closePicker; $('#picker').onclick = e => { if (e.target === $('#picker')) closePicker(); };
$('#addbar').onclick = () => { S.bars++; save(); renderSong(); requestAnimationFrame(() => { const l = $('#lane'); l.scrollLeft = l.scrollWidth; }); };
$('#play').onclick = () => playing ? stop() : play();
$('#beatbtn').onclick = () => { const k = $('#beatpanel'); k.hidden = !k.hidden; };
$('#beats').onclick = e => { const b = (e.target as Element).closest('[data-id]') as HTMLElement | null; if (b) pickBeat(b.dataset.id || null); };
$('#tempos').innerHTML = TEMPOS.map(t => `<button data-b="${t.b}">${t.n}</button>`).join('');
$('#tempos').onclick = e => { const b = (e.target as Element).closest('[data-b]') as HTMLElement | null; if (b) setBpm(+b.dataset.b!); };
$<HTMLInputElement>('#bpm').oninput = e => setBpm(+(e.target as HTMLInputElement).value);
$('#export').onclick = () => { const m = $('#xmenu'); m.hidden = !m.hidden; };
$('#xwav').onclick = () => { $('#xmenu').hidden = true; renderWav(); };
$('#xmid').onclick = async () => { $('#xmenu').hidden = true; dl(await buildMidi(), 'hum-studio.mid'); toast('Saved hum-studio.mid'); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });
(window as any).__hs = { get song() { return S; }, posBeat: () => posBeat() };
showPop(); renderAll(); renderBeats(); renderTempo(); syncPlay();
