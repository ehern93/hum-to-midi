import './style.css';
import { Midi } from '@tonejs/midi';
import { detectPitch } from './pitch';
import { NAMES, SCALES, freqToMidiFloat, noteName, snapToScale, NoteStabilizer } from './music';
import { GM, GM_CATS, gmCat, gmLabel, loadGM, playGM, startGM, gmReady, SYNTH_GM } from './gm';
import { INSTRUMENTS, DRUMS, Inst, FX, playNote, startVoice, makeStrip, Strip, encodeWav } from './audio';
import { polish, Note } from './polish';
import { PRESETS, presetNotes, beatNotes, KITS, loadKit, playKit, kitReady } from './drums';

interface Track { id: number; name: string; inst: Inst; vol: number; pan: number; mute: boolean; solo: boolean; fx: FX; notes: Note[]; raw?: Note[] | null; parts?: Record<number, string>; gm?: number | null }
interface Project { bpm: number; root: number; scale: string; transpose: number; bars: number; loop: { on: boolean; s: number; e: number }; tracks: Track[]; beat?: { id: string | null; kit: string; fills: boolean }; polish: { on: boolean; strength: number; latency: number; grid: number } }
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const defFx = (): FX => ({ reverb: 0.15, delay: 0, filter: 1, dist: 0, chorus: 0 });
let nid = 1;
const newTrack = (inst: Inst, name?: string): Track => ({ id: nid++, name: name || inst[0].toUpperCase() + inst.slice(1), inst, vol: 0.8, pan: 0, mute: false, solo: false, fx: defFx(), notes: [], parts: inst === 'drums' ? {} : undefined });
const defPolish = () => ({ on: true, strength: 0.7, latency: 120, grid: 0.25 });
function demo(): Project {
  const drums = newTrack('drums', 'Beat'); const bn = beatNotes(PRESETS.find(p => p.id === 'pop')!, 8, true); drums.notes = bn.notes; drums.parts = bn.parts;
  return { beat: { id: 'pop', kit: 'studio', fills: true }, bpm: 100, root: 0, scale: 'major', transpose: 0, bars: 8, loop: { on: true, s: 0, e: 16 }, tracks: [{ ...newTrack('piano', 'Melody'), gm: 0 }, { ...newTrack('bass'), gm: 33 }, drums], polish: defPolish() };
}
let P: Project = load() || demo();
let sel = P.tracks[0].id;
let armed: number | null = P.tracks[0].id;
const cur = () => P.tracks.find(t => t.id === sel) || P.tracks[0];
function save() { localStorage.setItem('h2m-project-v2', JSON.stringify(P)); }
function load(): Project | null { try { const p = JSON.parse(localStorage.getItem('h2m-project-v2') || ''); p.polish ||= defPolish(); p.beat ||= { id: (p.tracks.find((t: Track) => t.inst === 'drums')?.parts?.[0]) || null, kit: 'studio', fills: true }; nid = Math.max(...p.tracks.map((t: Track) => t.id)) + 1; return p; } catch { return null; } }
function status(s: string) { $('#status').textContent = s; }

// ---------- audio
let ctx: AudioContext | null = null; let master: GainNode; let strips = new Map<number, Strip>();
function ac() {
  if (!ctx) { ctx = new AudioContext({ latencyHint: 'interactive' }); master = ctx.createGain(); const comp = ctx.createDynamicsCompressor(); master.connect(comp).connect(ctx.destination); }
  if (ctx.state === 'suspended') ctx.resume(); syncStrips(); return ctx;
}
const anySolo = () => P.tracks.some(t => t.solo);
const audible = (t: Track) => !t.mute && (!anySolo() || t.solo);
function syncStrips() { if (!ctx) return; for (const t of P.tracks) { let s = strips.get(t.id); if (!s) { s = makeStrip(ctx, master, P.bpm); strips.set(t.id, s); } s.update(t.fx, t.vol, t.pan, audible(t)); } }
const spb = () => 60 / P.bpm;
const pitchOf = (t: Track, n: Note) => t.inst === 'drums' ? n.p : n.p + P.transpose;

// ---------- web midi out
let midiOut: MIDIOutput | null = null;
async function initMidi() {
  const s = $<HTMLSelectElement>('#midiout');
  if (!navigator.requestMIDIAccess) { s.innerHTML = '<option>Web MIDI unsupported</option>'; return; }
  try { const a = await navigator.requestMIDIAccess(); const fill = () => { s.innerHTML = '<option value="">none</option>' + [...a.outputs.values()].map(o => `<option value="${o.id}">${o.name}</option>`).join(''); }; fill(); a.onstatechange = fill;
    s.onchange = () => { midiOut = a.outputs.get(s.value) || null; }; } catch { s.innerHTML = '<option>MIDI access denied</option>'; }
}
const midiSend = (on: boolean, m: number, v = 0.8, drum = false, at?: number) => midiOut?.send([(on ? 0x90 : 0x80) | (drum ? 9 : 0), m, on ? Math.round(v * 127) : 0], at);

// ---------- transport
let recStartAt = -1e9; let playing = false, recording = false, startCtxTime = 0, startBeat = 0, schedBeat = 0, timer = 0;
const posBeat = () => playing && ctx ? startBeat + (ctx.currentTime - startCtxTime) / spb() : startBeat;
function play(fromBeat = startBeat) {
  const c = ac(); halt(); playing = true; startBeat = fromBeat; startCtxTime = c.currentTime + 0.03; schedBeat = fromBeat;
  timer = window.setInterval(schedule, 25); schedule(); updBtns();
}
function halt() { if (playing) startBeat = Math.max(0, posBeat()); playing = false; clearInterval(timer); }
function stop() {
  halt(); finishHeld();
  if (recording) { recording = false; endTake(); }
  updBtns(); draw();
}
function schedule() {
  if (!ctx) return; const ahead = (ctx.currentTime + 0.12 - startCtxTime) / spb() + startBeat; const L = P.loop;
  while (schedBeat < ahead) {
    const end = Math.min(ahead, L.on && !recording && schedBeat < L.e ? L.e : Infinity);
    const toTime = (b: number) => startCtxTime + (b - startBeat) * spb();
    for (const t of P.tracks) { if (!audible(t)) continue; const st = strips.get(t.id)!;
      for (const n of t.notes) if (n.s >= schedBeat && n.s < end) { const tm = toTime(n.s); playT(t, ctx, st.input, pitchOf(t, n), tm, n.d * spb(), n.v);
        if (midiOut) { const off = performance.now() + (tm - ctx.currentTime) * 1000; midiSend(true, pitchOf(t, n), n.v, t.inst === 'drums', off); midiSend(false, pitchOf(t, n), 0, t.inst === 'drums', off + n.d * spb() * 1000); } } }
    if ((recording && $<HTMLInputElement>('#metro').checked) || $<HTMLInputElement>('#metroplay').checked) for (let b = Math.ceil(schedBeat); b < end; b++) if (b < 0 || b < recStartAt || !beatOn()) click(toTime(b), ((b % 4) + 4) % 4 === 0);
    if (end === L.e && L.on && !recording && end < ahead) { startCtxTime = toTime(L.e); startBeat = L.s; schedBeat = L.s; continue; }
    schedBeat = end; if (end === ahead) break;
  }
  if (!recording && !L.on && posBeat() > Math.max(P.bars * 4, songEnd(P.tracks))) { stop(); startBeat = 0; draw(); }
}
function click(t: number, accent: boolean) { const c = ctx!; const o = c.createOscillator(); const g = c.createGain(); o.frequency.value = accent ? 1600 : 1000; g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); o.connect(g).connect(master); o.start(t); o.stop(t + 0.06); }
function updBtns() { const bp = document.querySelector('#beatplay'); if (bp) { bp.classList.toggle('on', playing); bp.innerHTML = playing ? '■ Stop' : '▶ Play beat'; } const mc = melodic(); $("#instcount").textContent = `${mc}/${MAX_INST} instruments`; $<HTMLButtonElement>("#addtrack").disabled = mc >= MAX_INST;
  $('#rec').classList.toggle('live', recording); $('#rec').querySelector('b')!.textContent = recording ? 'Stop rec' : 'Record';
  $('#play').querySelector('b')!.textContent = playing && !recording ? 'Stop' : 'Play'; $('#play').querySelector('i')!.textContent = playing && !recording ? '■' : '▶';
  const t = cur(); $('#polish').classList.toggle('done', !!t.raw); $('#revert').style.display = t.raw ? '' : 'none';
}

// ---------- takes & polish
let takeTrack: Track | null = null; let takeStartBeat = 0;
function toggleRec() {
  if (recording) { stop(); return; }
  if (!armed || !P.tracks.find(t => t.id === armed)) armed = sel;
  takeTrack = P.tracks.find(t => t.id === armed)!; sel = takeTrack.id;
  // a new take on a polished track: keep working from the raw version
  if (takeTrack.raw) { takeTrack.notes = takeTrack.raw; takeTrack.raw = null; }
  if (!micOn && takeTrack.inst !== 'drums') toggleMic();
  if (playing && beatOn()) { // beat is running: start on the next bar, no restart, no count-in
    const nb = Math.ceil((posBeat() + 0.05) / 4) * 4; recording = true; recStartAt = nb; takeStartBeat = nb; renderTracks(); updBtns();
    status(`Recording starts on bar ${nb / 4 + 1}… hum along with the beat.`); setTimeout(() => recording && status('Recording… press Record again to stop.'), (nb - posBeat()) * spb() * 1000); return; }
  recStartAt = -1e9; recording = true; takeStartBeat = startBeat; renderTracks(); updBtns();
  const pre = $<HTMLInputElement>('#countin').checked ? 4 : 0; play(Math.max(0, startBeat) - pre); status('Recording… hum or play keys. Press Record again to stop.');
}
function endTake() {
  const t = takeTrack; takeTrack = null; if (!t) return;
  startBeat = takeStartBeat;
  if (P.polish.on && t.inst !== 'drums' && t.notes.length) { doPolish(t); status(`Take polished (${Math.round(P.polish.strength * 100)}%). Press Play to hear it · "Raw" to undo.`); }
  else status('Take recorded. Press ✨ Polish to clean it up.');
  save(); renderTracks(); draw(); updBtns(); scrollRollToNotes();
}
function doPolish(t = cur()) {
  if (t.inst === 'drums') { status('Polish works on melodic tracks.'); return; }
  const raw = t.raw || t.notes.map(n => ({ ...n })); if (!raw.length) { status('Nothing to polish yet — record a take first.'); return; }
  t.raw = raw; t.notes = polish(raw, { bpm: P.bpm, latencyMs: P.polish.latency, strength: P.polish.strength, grid: P.polish.grid, root: P.root, scale: $<HTMLInputElement>('#snap').checked ? SCALES[P.scale] : null });
  save(); draw(); updBtns();
}
function revert(t = cur()) { if (!t.raw) return; t.notes = t.raw; t.raw = null; save(); draw(); updBtns(); status('Reverted to the raw take.'); }

// ---------- live note input (keyboard, mouse, hum) + recording
const held = new Map<string, { m: number; stop: () => void; startB: number; tr: number }>();
function noteOn(src: string, m: number, vel = 0.8) {
  noteOff(src); const c = ac(); const t = (recording && takeTrack) || cur();
  const strip = strips.get(t.id)!; const pm = t.inst === 'drums' ? m : m + P.transpose;
  held.set(src, { m, stop: (t.gm != null && t.inst !== 'drums' && startGM(c, strip.input, t.gm, pm, vel)) || startVoice(c, strip.input, t.inst, pm, vel), startB: posBeat(), tr: t.id }); midiSend(true, pm, vel, t.inst === 'drums'); lightKey(m, true);
}
function noteOff(src: string) {
  const h = held.get(src); if (!h) return; held.delete(src); h.stop(); const t = P.tracks.find(x => x.id === h.tr); lightKey(h.m, false);
  if (t) midiSend(false, t.inst === 'drums' ? h.m : h.m + P.transpose, 0, t.inst === 'drums');
  if (recording && playing && t && posBeat() > recStartAt) { let s = Math.max(h.startB, recStartAt), d = Math.max(posBeat() - s, 0.03);
    const q = +$<HTMLSelectElement>('#recq').value; if (q) { s = Math.round(s / q) * q; d = Math.max(q, Math.round(d / q) * q); }
    if (s + d > 0) { t.notes.push({ p: h.m, s: Math.max(0, s), d: t.inst === 'drums' ? 0.25 : d, v: vel(src) }); draw(); } }
}
const vel = (src: string) => src === 'hum' ? Math.min(1, 0.5 + humPeak * 3) : 0.8;
function finishHeld() { for (const k of [...held.keys()]) noteOff(k); }

// ---------- keyboard
const KB_LO = 36, KB_HI = 84; let kbOct = 0;
function buildKeyboard() {
  const el = $('#keyboard'); el.innerHTML = ''; let wi = 0;
  for (let m = KB_LO; m <= KB_HI; m++) { const black = [1, 3, 6, 8, 10].includes(m % 12); const k = document.createElement('div');
    k.className = 'key ' + (black ? 'black' : 'white'); k.dataset.m = String(m);
    if (!black) { k.style.left = `calc(${wi} * var(--kw))`; wi++; } else k.style.left = `calc(${wi} * var(--kw) - var(--kw) * .32)`;
    if (m % 12 === 0) k.innerHTML = `<span>C${m / 12 - 1}</span>`;
    k.onpointerdown = e => { e.preventDefault(); k.setPointerCapture(e.pointerId); noteOn('mouse', m); }; k.onpointerup = k.onpointercancel = () => noteOff('mouse');
    el.appendChild(k); }
  el.style.width = `calc(${wi} * var(--kw))`; markScale();
}
function markScale() { const sc = SCALES[P.scale]; document.querySelectorAll<HTMLElement>('.key').forEach(k => k.classList.toggle('inscale', sc.includes(((+k.dataset.m! - P.root) % 12 + 12) % 12))); }
function lightKey(m: number, on: boolean) { document.querySelector(`.key[data-m="${m}"]`)?.classList.toggle('active', on); }
const KEYMAP = 'awsedftgyhujkolp;';
window.addEventListener('keydown', e => {
  const tg = e.target as HTMLElement; if (tg.tagName === 'INPUT' && (tg as HTMLInputElement).type !== 'range' && (tg as HTMLInputElement).type !== 'checkbox' || tg.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); playing ? stop() : play(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (rollSel) { cur().notes = cur().notes.filter(n => n !== rollSel); rollSel = null; save(); draw(); } return; }
  if (e.repeat || e.ctrlKey || e.metaKey) return; const k = e.key.toLowerCase();
  if (k === 'z') { kbOct = Math.max(-2, kbOct - 1); return; } if (k === 'x') { kbOct = Math.min(2, kbOct + 1); return; }
  if (k === 'r') { toggleRec(); return; }
  const i = KEYMAP.indexOf(k); if (i >= 0) noteOn('k' + k, 60 + i + kbOct * 12);
});
window.addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (KEYMAP.includes(k)) noteOff('k' + k); });

// ---------- hum detection
let micOn = false, analyser: AnalyserNode, micStream: MediaStream; const stab = new NoteStabilizer(3, 5); let humNote: number | null = null; let smoothF = 0; let humPeak = 0;
async function toggleMic() {
  if (micOn) { micOn = false; micStream.getTracks().forEach(t => t.stop()); noteOff('hum'); $('#mic').classList.remove('on'); $('#mic').querySelector('b')!.textContent = 'Start mic'; return; }
  const c = ac();
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
  catch { alert('Microphone access denied.'); return; }
  const src = c.createMediaStreamSource(micStream); analyser = c.createAnalyser(); analyser.fftSize = 2048; src.connect(analyser);
  // estimated input→note latency: half the analysis window + stabilizer frames + device latency
  const est = Math.round(((analyser.fftSize / 2) / c.sampleRate + 3 / 60 + (c.baseLatency || 0.01)) * 1000 + 20);
  if (!localStorage.getItem('h2m-lat-set')) { P.polish.latency = est; $<HTMLInputElement>('#lat').value = String(est); $('#latv').textContent = est + ' ms'; }
  micOn = true; $('#mic').classList.add('on'); $('#mic').querySelector('b')!.textContent = 'Mic on'; humLoop();
}
function humLoop() {
  if (!micOn) return; requestAnimationFrame(humLoop);
  const buf = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(buf);
  const r = detectPitch(buf, ctx!.sampleRate, 0.15, 65, 1100);
  const gate = +$<HTMLInputElement>('#gate').value / 1000; const conf = +$<HTMLInputElement>('#conf').value / 100;
  $<HTMLElement>('#lvl').style.width = Math.min(100, r.rms * 400) + '%'; humPeak = humPeak * 0.9 + r.rms * 0.1;
  let n: number | null = null;
  if (r.rms > gate && r.clarity > conf && r.freq > 0) {
    smoothF = smoothF && Math.abs(Math.log2(r.freq / smoothF)) < 0.1 ? smoothF * 0.7 + r.freq * 0.3 : r.freq;
    const mf = freqToMidiFloat(smoothF) + +$<HTMLSelectElement>('#humoct').value * 12;
    const nearest = Math.round(mf); const cents = Math.round((mf - nearest) * 100);
    n = $<HTMLInputElement>('#snap').checked ? snapToScale(mf, P.root, SCALES[P.scale]) : nearest;
    $('#hnote').textContent = noteName(nearest); $('#hfreq').textContent = smoothF.toFixed(1) + ' Hz';
    $('#hcents').textContent = (cents >= 0 ? '+' : '') + cents + '¢'; $<HTMLElement>('#needle').style.left = 50 + cents + '%';
  } else { smoothF = 0; }
  const s = stab.push(n);
  if (s !== humNote) { humNote = s; if (s === null) noteOff('hum'); else if ($<HTMLInputElement>('#humplay').checked || recording) noteOn('hum', s); $('#hout').textContent = s === null ? '' : '→ ' + noteName(s); if (s === null) $('#hnote').textContent = '—'; }
}

// ---------- UI: tracks
const BEAT_W = 36, LANE = 44, RULER = 22;
function renderTracks() {
  const el = $('#tracks'); el.innerHTML = '';
  for (const t of P.tracks) { const d = document.createElement('div'); d.className = 'track' + (t.id === sel ? ' sel' : '');
    d.style.setProperty('--c', hue(t.id));
    d.innerHTML = `<div class="trow"><button class="arm ${armed === t.id ? 'on' : ''}" title="Record on this track">●</button><input type="text" class="tname" value="${t.name.replace(/"/g, '')}">
      <button class="m ${t.mute ? 'on' : ''}" title="Mute">M</button><button class="s ${t.solo ? 'on' : ''}" title="Solo">S</button></div>
      <div class="trow"><button class="inst ibtn" title="Change instrument">${instLabel(t)}</button>
      <input type="range" class="vol adv" title="Volume" min="0" max="1.2" step="0.01" value="${t.vol}"><input type="range" class="pan adv" title="Pan" min="-1" max="1" step="0.01" value="${t.pan}"><button class="del adv" title="Delete track">✕</button></div>`;
    d.onclick = () => { if (sel !== t.id) { sel = t.id; renderTracks(); renderEditor(); draw(); updBtns(); } };
    const q = (s: string) => d.querySelector(s) as HTMLInputElement;
    q('.arm').onclick = e => { e.stopPropagation(); armed = t.id; sel = t.id; renderTracks(); renderEditor(); draw(); };
    q('.tname').onchange = () => { t.name = q('.tname').value; save(); };
    q('.m').onclick = () => { t.mute = !t.mute; after(); }; q('.s').onclick = () => { t.solo = !t.solo; after(); };
    q('.del').onclick = e => { e.stopPropagation(); if (P.tracks.length > 1 && confirm('Delete track ' + t.name + '?')) { P.tracks = P.tracks.filter(x => x !== t); sel = P.tracks[0].id; after(); } };
    q('.inst').onclick = e => { e.stopPropagation(); if (t.inst !== 'drums') openBrowser(t); };
    q('.vol').oninput = () => { t.vol = +q('.vol').value; syncStrips(); save(); }; q('.pan').oninput = () => { t.pan = +q('.pan').value; syncStrips(); save(); };
    el.appendChild(d); }
}
const MAX_INST = 4; const melodic = () => P.tracks.filter(t => t.inst !== 'drums').length;
function instLabel(t: Track) { if (t.inst === 'drums') return '🥁 Drum kit'; if (t.gm != null) return `${gmCat(t.gm).icon} ${gmLabel(t.gm)}${gmReady(t.gm) ? '' : ' …'}`; return `🎛 ${t.inst} (synth)`; }
function playT(t: Track, c: BaseAudioContext, out: AudioNode, m: number, tm: number, dur: number, v: number) { if (t.inst === 'drums' && playKit(c, out, P.beat!.kit, m, tm, v)) return; if (t.inst !== 'drums' && t.gm != null && playGM(c, out, t.gm, m, tm, dur, v)) return; playNote(c, out, t.inst, m, tm, dur, v); }
function ensureLoaded(t: Track) { if (t.gm == null || gmReady(t.gm)) return; loadGM(t.gm, ac()).then(ok => { if (!ok) status(`Couldn't load ${gmLabel(t.gm!)} samples; using built-in synth.`); renderTracks(); }); }
// ---------- instrument browser
let ibTarget: Track | null = null; let ibCat = -1;
function openBrowser(t: Track | null) { ibTarget = t; ibCat = t && t.gm != null ? t.gm >> 3 : -1; $('#ibtitle').textContent = t ? `Instrument for "${t.name}"` : 'Add an instrument track'; $<HTMLInputElement>('#ibsearch').value = ''; $('#ib').classList.add('open'); renderBrowser(); }
function renderBrowser() {
  const q = $<HTMLInputElement>('#ibsearch').value.trim().toLowerCase();
  $('#ibcats').innerHTML = [`<button class="chip ${ibCat === -1 ? 'on' : ''}" data-c="-1">All</button>`, ...GM_CATS.map((c, i) => `<button class="chip ${ibCat === i ? 'on' : ''}" data-c="${i}">${c.icon} ${c.name}</button>`), `<button class="chip ${ibCat === 16 ? 'on' : ''}" data-c="16">🎛 Built-in synths</button>`].join('');
  $('#ibcats').querySelectorAll<HTMLElement>('.chip').forEach(b => b.onclick = () => { ibCat = +b.dataset.c!; renderBrowser(); });
  const cur = ibTarget; const items: string[] = [];
  if (ibCat === 16 || q) for (const i of INSTRUMENTS) if (i !== 'drums' && (!q || i.includes(q))) items.push(`<button class="ii ${cur && cur.gm == null && cur.inst === i ? 'on' : ''}" data-s="${i}"><span>🎛</span><b>${i}</b><small>Built-in synth · instant</small></button>`);
  if (ibCat !== 16 || q) GM.forEach((_, p) => { if (!q && ibCat >= 0 && p >> 3 !== ibCat) return; const l = gmLabel(p); if (q && !l.toLowerCase().includes(q) && !gmCat(p).name.toLowerCase().includes(q)) return;
    items.push(`<button class="ii ${cur && cur.gm === p ? 'on' : ''}" data-p="${p}"><span>${gmCat(p).icon}</span><b>${l}</b><small>#${p + 1} · ${gmCat(p).name}${gmReady(p) ? ' · loaded' : ''}</small></button>`); });
  $('#iblist').innerHTML = items.join('') || '<p class="hint">No instruments match.</p>';
  $('#iblist').querySelectorAll<HTMLElement>('.ii').forEach(b => b.onclick = async () => {
    const p = b.dataset.p != null ? +b.dataset.p : null, syn = b.dataset.s as Inst | undefined;
    let t = ibTarget;
    if (!t) { if (melodic() >= MAX_INST) return; t = newTrack(syn || 'piano', p != null ? gmLabel(p) : undefined); if (syn) t.name = syn[0].toUpperCase() + syn.slice(1); P.tracks.splice(P.tracks.filter(x => x.inst !== 'drums').length, 0, t); sel = t.id; armed = t.id; ibTarget = t; $('#ibtitle').textContent = `Instrument for "${t.name}"`; }
    else if (t.name === instName(t)) t.name = p != null ? gmLabel(p) : syn![0].toUpperCase() + syn!.slice(1);
    if (syn) { t.inst = syn; t.gm = null; } else { t.gm = p; const fb = Object.entries(SYNTH_GM).find(([, v]) => v >> 3 === p! >> 3); t.inst = (fb ? fb[0] : 'piano') as Inst; }
    after(); renderBrowser(); b.classList.add('loading');
    if (p != null) { status(`Loading ${gmLabel(p)}…`); await loadGM(p, ac()); status(gmReady(p) ? `${gmLabel(p)} ready.` : `Couldn't load ${gmLabel(p)}; using synth.`); }
    renderTracks(); renderBrowser(); previewInst(t);
  });
}
function instName(t: Track) { return t.gm != null ? gmLabel(t.gm) : t.inst[0].toUpperCase() + t.inst.slice(1); }
function previewInst(t: Track) { const c = ac(); syncStrips(); const st = strips.get(t.id); if (!st) return; const base = (t.gm ?? 0) >> 3 === 4 ? 36 : 60; [0, 4, 7, 12].forEach((d, i) => playT(t, c, st.input, base + P.root + d, c.currentTime + 0.05 + i * 0.18, 0.5, 0.75)); }
// ---------- beat (beat-first drums)
const beatTrack = () => P.tracks.find(t => t.inst === 'drums');
const beatOn = () => { const b = beatTrack(); return !!b && audible(b) && b.notes.length > 0; };
function applyBeat() { const id = P.beat!.id; let bt = beatTrack(); if (!id) return;
  if (!bt) { bt = newTrack('drums', 'Beat'); P.tracks.push(bt); syncStrips(); }
  const bn = beatNotes(PRESETS.find(p => p.id === id)!, Math.max(P.bars, Math.ceil(songEnd(P.tracks.filter(t => t.inst !== 'drums')) / 4)), P.beat!.fills); bt.notes = bn.notes; bt.parts = bn.parts; bt.mute = false; }
function renderBeats() {
  const g = $('#beats'); const cur = P.beat!.id;
  g.innerHTML = PRESETS.filter(p => p.group === 'Grooves').map(p => `<button class="beat ${p.id === cur ? 'on' : ''}" data-id="${p.id}"><b>${p.name}</b><small>${p.genre} · ${p.bpm} BPM</small></button>`).join('') + `<button class="beat none ${!cur ? 'on' : ''}" data-id=""><b>No beat</b><small>metronome only</small></button>`;
  g.querySelectorAll<HTMLElement>('.beat').forEach(b => b.onclick = () => pickBeat(b.dataset.id || null));
  $<HTMLSelectElement>('#beatkit').value = P.beat!.kit; $<HTMLInputElement>('#beatfill').checked = P.beat!.fills;
  const bt = beatTrack(); $<HTMLInputElement>('#beatvol').value = String(bt ? bt.vol : 0.8);
  const pr = PRESETS.find(p => p.id === cur); $('#beatbpm').textContent = pr ? (pr.bpm !== P.bpm ? `Use ${pr.bpm} BPM` : `${pr.bpm} BPM ✓`) : ''; $('#beatbpm').style.visibility = pr ? '' : 'hidden';
}
function pickBeat(id: string | null) {
  P.beat!.id = id; const bt = beatTrack();
  if (!id) { if (bt) { bt.notes = []; bt.parts = {}; } }
  else { const pr = PRESETS.find(p => p.id === id)!; const fresh = !P.tracks.some(t => t.inst !== 'drums' && t.notes.length);
    if (fresh && pr.bpm) { setBpm(pr.bpm); } if (pr.kit) { P.beat!.kit = pr.kit; loadKit(pr.kit, ac()); } applyBeat(); }
  save(); renderBeats(); renderTracks(); renderEditor(); draw(); updBtns();
  status(id ? `${PRESETS.find(p => p.id === id)!.name} beat${playing ? ' — swapped live' : ' — press ▶ Play beat'}.` : 'Beat removed.');
}
function setBpm(v: number) { const pb = posBeat(); P.bpm = v; $<HTMLInputElement>('#bpm').value = String(v); if (playing && ctx) { startBeat = pb; startCtxTime = ctx.currentTime; schedBeat = Math.max(schedBeat, pb); } strips.clear(); syncStrips(); }
function bindBeat() {
  $('#beatkit').innerHTML = KITS.map(k => `<option value="${k.id}">${k.name}</option>`).join('');
  $('#beatkit').onchange = () => { P.beat!.kit = $<HTMLSelectElement>('#beatkit').value; loadKit(P.beat!.kit, ac()).then(ok => status(ok ? `${KITS.find(k => k.id === P.beat!.kit)!.name} kit ready.` : 'Using built-in synth drums.')); save(); };
  $('#beatfill').onchange = () => { P.beat!.fills = $<HTMLInputElement>('#beatfill').checked; applyBeat(); save(); draw(); renderEditor(); };
  $('#beatvol').oninput = () => { const bt = beatTrack(); if (bt) { bt.vol = +$<HTMLInputElement>('#beatvol').value; syncStrips(); save(); } };
  $('#beatbpm').onclick = () => { const pr = PRESETS.find(p => p.id === P.beat!.id); if (pr?.bpm) { setBpm(pr.bpm); save(); draw(); renderBeats(); } };
  $('#beatplay').onclick = () => { if (playing) { stop(); } else { if (!beatOn() && !P.beat!.id) pickBeat('pop'); else if (!beatOn()) { applyBeat(); after(); } play(P.loop.on ? P.loop.s : startBeat); } updBtns(); };
}
function after() { syncStrips(); save(); renderTracks(); renderEditor(); draw(); updBtns(); }
function renderEditor() { requestAnimationFrame(scrollRollToNotes);
  const t = cur(); const el = $('#fx'); el.innerHTML = `<h3>Effects · ${t.name}</h3>` + (['reverb', 'delay', 'chorus', 'dist', 'filter'] as (keyof FX)[]).map(k => `<label>${k === 'dist' ? 'distortion' : k === 'filter' ? 'tone' : k}<input type="range" min="0" max="1" step="0.01" data-k="${k}" value="${t.fx[k]}"></label>`).join('');
  el.querySelectorAll<HTMLInputElement>('input').forEach(i => i.oninput = () => { t.fx[i.dataset.k as keyof FX] = +i.value; syncStrips(); save(); });
  const drum = t.inst === 'drums'; $('#rollwrap').style.display = drum ? 'none' : ''; $('#drumwrap').style.display = drum ? '' : 'none'; $('#edtitle').textContent = drum ? `Drums · ${t.name}` : `Notes · ${t.name}`;
  if (drum) { renderPresets(); renderSteps(); }
}

// ---------- drum presets
let pickPreset = PRESETS[0].id;
function renderPresets() {
  const t = cur(); const lib = $('#presets'); lib.innerHTML = '';
  let grp = ''; for (const p of PRESETS) { if (p.group !== grp) { grp = p.group; lib.insertAdjacentHTML('beforeend', `<span class="grp">${grp}</span>`); }
    const b = document.createElement('button'); b.className = 'chip' + (p.id === pickPreset ? ' on' : ''); b.textContent = p.name;
    b.onclick = () => { pickPreset = p.id; previewPreset(p.id); renderPresets(); }; lib.appendChild(b); }
  const bars = $('#bars-strip'); bars.innerHTML = '';
  for (let b = 0; b < P.bars; b++) { const id = t.parts?.[b]; const el = document.createElement('button'); el.className = 'bar' + (id ? ' filled' : '');
    el.innerHTML = `<small>${b + 1}</small>${id ? PRESETS.find(p => p.id === id)?.name || 'custom' : '+'}`; el.title = id ? 'Click: replace with selected · right-click: remove' : 'Click to place the selected groove';
    el.onclick = () => { setPart(t, b, t.parts?.[b] === pickPreset ? null : pickPreset); }; el.oncontextmenu = e => { e.preventDefault(); setPart(t, b, null); };
    bars.appendChild(el); }
}
function setPart(t: Track, bar: number, id: string | null) {
  t.parts ||= {}; t.notes = t.notes.filter(n => !(n.s >= bar * 4 && n.s < bar * 4 + 4));
  if (id) { t.parts[bar] = id; t.notes.push(...presetNotes(PRESETS.find(p => p.id === id)!, bar)); } else delete t.parts[bar];
  save(); renderPresets(); renderSteps(); draw();
}
function previewPreset(id: string) {
  const c = ac(); const t = cur(); const st = strips.get(t.id)!; const t0 = c.currentTime + 0.05;
  for (let rep = 0; rep < 2; rep++) for (const n of presetNotes(PRESETS.find(p => p.id === id)!, rep)) playT(t, c, st.input, n.p, t0 + n.s * spb(), 0.1, n.v);
}
$('#fillall').onclick = () => { const t = cur(); for (let b = 0; b < P.bars; b++) setPart(t, b, pickPreset); };
$('#clearall').onclick = () => { const t = cur(); for (let b = 0; b < P.bars; b++) setPart(t, b, null); };

// ---------- step sequencer (advanced)
let stepBar = 0;
function renderSteps() {
  const t = cur(); const g = $('#steps'); g.innerHTML = ''; stepBar = Math.min(stepBar, P.bars - 1); $('#stepbar').textContent = `Bar ${stepBar + 1}`;
  for (const dr of [...DRUMS].reverse()) { const row = document.createElement('div'); row.className = 'srow'; row.innerHTML = `<span>${dr.n}</span>`;
    for (let i = 0; i < 16; i++) { const s = stepBar * 4 + i / 4; const b = document.createElement('button'); b.className = 'step' + (i % 4 === 0 ? ' beat' : '');
      const has = () => t.notes.find(n => n.p === dr.m && Math.abs(n.s - s) < 0.01); if (has()) b.classList.add('on');
      b.onclick = () => { const h = has(); if (h) t.notes = t.notes.filter(n => n !== h); else { t.notes.push({ p: dr.m, s, d: 0.25, v: 0.85 }); playT(t, ac(), strips.get(t.id)!.input, dr.m, ctx!.currentTime, 0.1, 0.85); }
        t.parts ||= {}; t.parts[stepBar] = 'custom'; save(); renderSteps(); renderPresets(); draw(); };
      row.appendChild(b); }
    g.appendChild(row); }
}

// ---------- timeline + piano roll (canvas)
const tl = $<HTMLCanvasElement>('#timeline'); const roll = $<HTMLCanvasElement>('#roll'); const rr = $<HTMLCanvasElement>('#rruler');
const ROLL_LO = 36, ROLL_HI = 84, RH = 14; let rollSel: Note | null = null;
const hue = (id: number) => `hsl(${(id * 67 + 170) % 360} 75% 62%)`;
function ruler(g: CanvasRenderingContext2D, W: number, h: number) {
  g.fillStyle = '#12141a'; g.fillRect(0, 0, W, h); g.font = '11px ui-sans-serif,system-ui';
  if (P.loop.on) { g.fillStyle = 'rgba(99,102,241,.35)'; g.fillRect(P.loop.s * BEAT_W, 0, (P.loop.e - P.loop.s) * BEAT_W, h); }
  for (let b = 0; b <= P.bars * 4; b++) { const x = b * BEAT_W; g.fillStyle = b % 4 ? '#3a3f4b' : '#8a93a6'; g.fillRect(x, b % 4 ? h - 5 : h - 10, 1, b % 4 ? 5 : 10);
    if (b % 4 === 0) { g.fillStyle = '#c7cdd9'; g.fillText(String(b / 4 + 1), x + 3, 11); g.fillStyle = '#5d6475'; g.fillText((b * spb()).toFixed(1) + 's', x + 3, h - 2 > 20 ? 21 : 21); } }
}
function draw() {
  const W = Math.max(P.bars * 4, Math.ceil(songEnd(P.tracks) / 4) * 4) * BEAT_W;
  tl.width = W; tl.height = RULER + P.tracks.length * LANE; const g = tl.getContext('2d')!;
  g.fillStyle = '#0f1116'; g.fillRect(0, 0, W, tl.height); ruler(g, W, RULER);
  P.tracks.forEach((t, i) => { const y = RULER + i * LANE; g.fillStyle = t.id === sel ? '#1a1f2b' : '#14171d'; g.fillRect(0, y + 1, W, LANE - 2);
    for (let b = 0; b <= P.bars * 4; b += 4) { g.fillStyle = '#232733'; g.fillRect(b * BEAT_W, y, 1, LANE); }
    const col = audible(t) ? hue(t.id) : '#4b5060';
    if (t.inst === 'drums') { for (const [bar, id] of Object.entries(t.parts || {})) { const x = +bar * 4 * BEAT_W; g.fillStyle = col + ''; g.globalAlpha = .18; g.fillRect(x + 2, y + 4, 4 * BEAT_W - 4, LANE - 8); g.globalAlpha = 1; g.fillStyle = '#e5e7eb'; g.font = '11px ui-sans-serif'; g.fillText(PRESETS.find(p => p.id === id)?.name || 'custom', x + 6, y + 15); } }
    const ps = t.notes.map(n => n.p); const lo = Math.min(...ps, 200), hi = Math.max(...ps, 0); const rng = Math.max(hi - lo, 1);
    g.fillStyle = col; for (const n of t.notes) g.fillRect(n.s * BEAT_W, y + LANE - 8 - ((n.p - lo) / rng) * (t.inst === 'drums' ? 18 : 28) - 2, Math.max(2, n.d * BEAT_W - 1), 4); });
  // ---- piano roll
  const t = cur(); roll.width = W; roll.height = (ROLL_HI - ROLL_LO + 1) * RH; rr.width = W; rr.height = RULER; ruler(rr.getContext('2d')!, W, RULER);
  const r = roll.getContext('2d')!; const sc = SCALES[P.scale];
  for (let m = ROLL_LO; m <= ROLL_HI; m++) { const y = (ROLL_HI - m) * RH; const inK = sc.includes(((m - P.root) % 12 + 12) % 12); r.fillStyle = inK ? '#191d26' : '#121419'; r.fillRect(0, y, W, RH); r.fillStyle = '#0c0d10'; r.fillRect(0, y + RH - 1, W, 1); }
  for (let b = 0; b <= P.bars * 16; b++) { r.fillStyle = b % 16 === 0 ? '#3a404c' : b % 4 === 0 ? '#262b35' : '#1a1e26'; r.fillRect(b * BEAT_W / 4, 0, 1, roll.height); }
  const showRaw = $<HTMLInputElement>('#showraw').checked && t.raw;
  if (showRaw) { r.setLineDash([3, 2]); r.strokeStyle = '#f87171'; r.fillStyle = 'rgba(248,113,113,.18)'; r.lineWidth = 1.5; for (const n of t.raw!) { const x = n.s * BEAT_W, y = (ROLL_HI - n.p) * RH, w = Math.max(3, n.d * BEAT_W - 1); r.fillRect(x, y, w, RH - 1); r.strokeRect(x + .75, y + .75, w - 1.5, RH - 2.5); } r.setLineDash([]); }
  r.font = 'bold 10px ui-sans-serif,system-ui';
  for (const n of t.notes) { const x = n.s * BEAT_W, y = (ROLL_HI - n.p) * RH, w = Math.max(3, n.d * BEAT_W - 2);
    r.fillStyle = n === rollSel ? '#ffffff' : hue(t.id); r.globalAlpha = (showRaw ? 0.45 : 0.55) + n.v * 0.45; r.beginPath(); r.roundRect(x + 1, y + 3, w, RH - 6, 3); r.fill(); r.globalAlpha = 1;
    if (w > 22) { r.fillStyle = '#0b0c10'; r.fillText(noteName(pitchOf(t, n)), x + 4, y + RH - 4); } }
  // left labels (sticky)
  const lab = $<HTMLCanvasElement>('#rlabels'); lab.width = 34; lab.height = roll.height; const l = lab.getContext('2d')!; l.font = '10px ui-sans-serif';
  for (let m = ROLL_LO; m <= ROLL_HI; m++) { const y = (ROLL_HI - m) * RH; const blk = [1, 3, 6, 8, 10].includes(m % 12); l.fillStyle = blk ? '#1b1d22' : '#d9dde5'; l.fillRect(0, y, 34, RH - 1); if (m % 12 === 0 || m === held.get('hum')?.m) { l.fillStyle = '#334'; l.fillText(noteName(m), 3, y + 11); } }
  $('#legend').style.display = t.raw ? '' : 'none'; $('.lg-pol').style.background = hue(t.id);
  drawHead();
}
function scrollRollToNotes() { const t = cur(); if (!t.notes.length || t.inst === 'drums') return; const avg = t.notes.reduce((a, n) => a + n.p, 0) / t.notes.length; const sc = $('#rollscroll'); sc.scrollTop = (ROLL_HI - avg) * RH - sc.clientHeight / 2; }
function drawHead() { const x = posBeat() * BEAT_W; document.querySelectorAll<HTMLElement>('.ph').forEach(p => p.style.left = x + 'px'); const b = Math.max(0, posBeat());
  $('#pos').textContent = `${Math.floor(b / 4) + 1}.${Math.floor(b % 4) + 1}  ·  ${(b * spb()).toFixed(1)}s`; }
(function anim() { requestAnimationFrame(anim); if (playing) { drawHead(); for (const id of ['#tlwrap', '#rollscroll']) { const sc = $(id); const x = posBeat() * BEAT_W; if (x > sc.scrollLeft + sc.clientWidth - 60 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 60); } } })();
// timeline: click = playhead/select; ruler drag = loop
let loopDrag: number | null = null;
tl.onpointerdown = e => { const b = e.offsetX / BEAT_W; const lane = Math.floor((e.offsetY - RULER) / LANE);
  if (e.shiftKey || e.offsetY < RULER) { loopDrag = Math.round(b); tl.setPointerCapture(e.pointerId); return; }
  if (P.tracks[lane]) { const t = P.tracks[lane]; sel = t.id; renderTracks(); renderEditor(); updBtns(); }
  startBeat = Math.max(0, Math.floor(b * 4) / 4); if (playing) play(startBeat); draw(); };
tl.onpointermove = e => { if (loopDrag === null) return; const b = Math.round(e.offsetX / BEAT_W); if (b !== loopDrag) { P.loop = { on: true, s: Math.min(loopDrag, b), e: Math.max(loopDrag, b) }; $<HTMLInputElement>('#loop').checked = true; draw(); } };
tl.onpointerup = e => { if (loopDrag !== null) { if (Math.round(e.offsetX / BEAT_W) === loopDrag) { startBeat = Math.floor(e.offsetX / BEAT_W * 4) / 4; if (playing) play(startBeat); } loopDrag = null; save(); draw(); } };
rr.onpointerdown = e => { startBeat = Math.max(0, Math.floor(e.offsetX / BEAT_W * 4) / 4); if (playing) play(startBeat); draw(); };
// piano roll editing
let drag: { n: Note; mode: 'move' | 'size'; ox: number; os: number; od: number } | null = null;
const grid = () => +$<HTMLSelectElement>('#grid').value;
roll.oncontextmenu = e => e.preventDefault();
const hitAt = (e: PointerEvent | MouseEvent) => { const b = e.offsetX / BEAT_W; const p = ROLL_HI - Math.floor(e.offsetY / RH); return { b, p, hit: cur().notes.find(n => n.p === p && b >= n.s && b <= n.s + n.d) }; };
roll.onpointerdown = e => { const t = cur(); const { b, p, hit } = hitAt(e);
  if (e.button === 2) { if (hit) { t.notes = t.notes.filter(n => n !== hit); save(); draw(); } return; }
  if (!hit) { const g = grid(); const n = { p, s: Math.floor(b / g) * g, d: g * 2, v: 0.8 }; t.notes.push(n); rollSel = n; drag = { n, mode: 'size', ox: e.offsetX, os: n.s, od: n.d }; }
  else { rollSel = hit; drag = { n: hit, mode: (hit.s + hit.d - b) * BEAT_W < 7 ? 'size' : 'move', ox: e.offsetX, os: hit.s, od: hit.d }; }
  roll.setPointerCapture(e.pointerId); preview(p); draw(); };
roll.onpointermove = e => { if (!drag) { const { b, hit } = hitAt(e); roll.style.cursor = hit && (hit.s + hit.d - b) * BEAT_W < 7 ? 'ew-resize' : hit ? 'grab' : 'crosshair'; return; }
  const g = grid(); const db = (e.offsetX - drag.ox) / BEAT_W;
  if (drag.mode === 'move') { drag.n.s = Math.max(0, Math.round((drag.os + db) / g) * g); const np = Math.max(ROLL_LO, Math.min(ROLL_HI, ROLL_HI - Math.floor(e.offsetY / RH))); if (np !== drag.n.p) { drag.n.p = np; preview(np); } }
  else drag.n.d = Math.max(g, Math.round((drag.od + db) / g) * g);
  draw(); };
roll.onpointerup = () => { if (drag) { drag = null; save(); } };
roll.ondblclick = e => { const { hit } = hitAt(e); if (hit) { cur().notes = cur().notes.filter(n => n !== hit); save(); draw(); } };
function preview(p: number) { const c = ac(); const t = cur(); playT(t, c, strips.get(t.id)!.input, p + P.transpose, c.currentTime, 0.35, 0.7); }

// ---------- export
const dl = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const fname = (s: string) => s.replace(/[^\w-]+/g, '_');
function buildMidi(tracks: Track[]) {
  const m = new Midi(); m.header.setTempo(P.bpm); let ch = 0;
  for (const t of tracks) { const mt = m.addTrack(); mt.name = t.name; const drum = t.inst === 'drums'; if (!drum && ch === 9) ch++; mt.channel = drum ? 9 : ch++ % 16; if (!drum) mt.instrument.number = t.gm ?? SYNTH_GM[t.inst] ?? 0;
    for (const n of t.notes) mt.addNote({ midi: pitchOf(t, n), time: n.s * spb(), duration: n.d * spb(), velocity: n.v }); }
  return new Blob([m.toArray() as BlobPart], { type: 'audio/midi' });
}
function songEnd(tracks: Track[]) { const e = Math.max(0, ...tracks.flatMap(t => t.notes.map(n => n.s + n.d))); return P.loop.on ? Math.max(P.loop.e, e) : e; }
async function renderWav(tracks: Track[], name: string) {
  status('Loading instrument samples…'); await loadKit(P.beat!.kit, ac()); await Promise.all(tracks.filter(t => t.gm != null && t.inst !== 'drums').map(t => loadGM(t.gm!, ac())));
  const beats = songEnd(tracks); if (!beats) { alert('Nothing to render yet.'); return; }
  status('Rendering WAV…'); const secs = beats * spb() + 2.5; const sr = 44100;
  const oc = new OfflineAudioContext(2, Math.ceil(secs * sr), sr); const mg = oc.createGain(); const comp = oc.createDynamicsCompressor(); mg.connect(comp).connect(oc.destination);
  for (const t of tracks) { if (!audible(t) && tracks.length > 1) continue; const s = makeStrip(oc, mg, P.bpm); s.update(t.fx, t.vol, t.pan, true); for (const n of t.notes) playT(t, oc, s.input, pitchOf(t, n), n.s * spb() + 0.05, n.d * spb(), n.v); }
  const buf = await oc.startRendering(); dl(encodeWav(buf), name + '.wav'); status('Exported ' + name + '.wav');
}

// ---------- controls
function bind() {
  $('#ibsearch').oninput = () => renderBrowser(); $('#ibclose').onclick = () => $('#ib').classList.remove('open'); $('#ib').onclick = e => { if (e.target === $('#ib')) $('#ib').classList.remove('open'); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#ib').classList.remove('open'); });
  const bpm = $<HTMLInputElement>('#bpm'), key = $<HTMLSelectElement>('#key'), scale = $<HTMLSelectElement>('#scale'), tr = $<HTMLInputElement>('#transpose'), bars = $<HTMLInputElement>('#bars');
  key.innerHTML = NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join(''); scale.innerHTML = Object.keys(SCALES).map(s => `<option>${s}</option>`).join('');
  const str = $<HTMLInputElement>('#strength'), lat = $<HTMLInputElement>('#lat'), pg = $<HTMLSelectElement>('#pgrid');
  const fill = () => { bpm.value = String(P.bpm); key.value = String(P.root); scale.value = P.scale; tr.value = String(P.transpose); bars.value = String(P.bars); $<HTMLInputElement>('#loop').checked = P.loop.on;
    str.value = String(Math.round(P.polish.strength * 100)); $('#strv').textContent = str.value + '%'; lat.value = String(P.polish.latency); $('#latv').textContent = P.polish.latency + ' ms'; pg.value = String(P.polish.grid); $<HTMLInputElement>('#autopolish').checked = P.polish.on; };
  fill();
  bpm.onchange = () => { const pb = posBeat(); P.bpm = Math.max(40, Math.min(240, +bpm.value || 120)); if (playing && ctx) { startBeat = pb; startCtxTime = ctx.currentTime; schedBeat = Math.max(schedBeat, pb); } strips.clear(); syncStrips(); save(); draw(); };
  key.onchange = () => { P.root = +key.value; markScale(); save(); draw(); }; scale.onchange = () => { P.scale = scale.value; markScale(); save(); draw(); };
  tr.onchange = () => { P.transpose = +tr.value; save(); draw(); }; bars.onchange = () => { P.bars = Math.max(1, Math.min(128, +bars.value)); applyBeat(); save(); draw(); renderEditor(); };
  $<HTMLInputElement>('#loop').onchange = e => { P.loop.on = (e.target as HTMLInputElement).checked; if (P.loop.e <= P.loop.s) P.loop = { on: P.loop.on, s: 0, e: 16 }; save(); draw(); };
  str.oninput = () => { P.polish.strength = +str.value / 100; $('#strv').textContent = str.value + '%'; if (cur().raw) doPolish(); save(); };
  lat.oninput = () => { P.polish.latency = +lat.value; $('#latv').textContent = lat.value + ' ms'; localStorage.setItem('h2m-lat-set', '1'); if (cur().raw) doPolish(); save(); };
  pg.onchange = () => { P.polish.grid = +pg.value; if (cur().raw) doPolish(); save(); };
  $<HTMLInputElement>('#autopolish').onchange = e => { P.polish.on = (e.target as HTMLInputElement).checked; save(); };
  $<HTMLInputElement>('#showraw').onchange = () => draw();
  $('#play').onclick = () => { if (recording) return stop(); playing ? stop() : play(); };
  $('#rewind').onclick = () => { stop(); startBeat = P.loop.on ? P.loop.s : 0; draw(); };
  $('#rec').onclick = toggleRec; $('#mic').onclick = toggleMic; $('#polish').onclick = () => { doPolish(); if (cur().raw) status(`Polished at ${Math.round(P.polish.strength * 100)}%. Red dashed outlines = what you hummed.`); };
  $('#revert').onclick = () => revert();
  $('#addtrack').onclick = () => { if (melodic() >= MAX_INST) { status(`Up to ${MAX_INST} instrument tracks (plus drums). Delete one or change its instrument.`); return; } openBrowser(null); };
  $('#adddrums').onclick = () => { const t = newTrack('drums', 'Drums'); P.tracks.push(t); sel = t.id; after(); };
  $('#quant').onclick = () => { const g = grid(); for (const n of cur().notes) { n.s = Math.round(n.s / g) * g; n.d = Math.max(g, Math.round(n.d / g) * g); } save(); draw(); };
  $('#clear').onclick = () => { if (confirm('Clear all notes on ' + cur().name + '?')) { cur().notes = []; cur().raw = null; if (cur().parts) cur().parts = {}; save(); draw(); renderEditor(); updBtns(); } };
  $('#tup').onclick = () => { cur().notes.forEach(n => n.p++); save(); draw(); }; $('#tdn').onclick = () => { cur().notes.forEach(n => n.p--); save(); draw(); };
  $('#sprev').onclick = () => { stepBar = (stepBar + P.bars - 1) % P.bars; renderSteps(); }; $('#snext').onclick = () => { stepBar = (stepBar + 1) % P.bars; renderSteps(); };
  $('#xwav').onclick = () => renderWav(P.tracks, 'mix'); $('#xtwav').onclick = () => renderWav([cur()], fname(cur().name));
  $('#xmid').onclick = () => dl(buildMidi(P.tracks), 'song.mid'); $('#xtmid').onclick = () => dl(buildMidi([cur()]), fname(cur().name) + '.mid');
  $('#xall').onclick = () => P.tracks.forEach((t, i) => setTimeout(() => dl(buildMidi([t]), `${i + 1}_${fname(t.name)}.mid`), i * 300));
  $('#xjson').onclick = () => dl(new Blob([JSON.stringify(P)], { type: 'application/json' }), 'project.json');
  $<HTMLInputElement>('#ijson').onchange = async e => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; try { P = JSON.parse(await f.text()); P.polish ||= defPolish(); nid = Math.max(...P.tracks.map(t => t.id)) + 1; sel = P.tracks[0].id; strips.clear(); fill(); after(); markScale(); } catch { alert('Invalid project file'); } };
  $('#new').onclick = () => { if (confirm('Start a new project? (current work is lost)')) { P = demo(); sel = armed = P.tracks[0].id; strips.clear(); fill(); after(); } };
  const advBtn = $('#advtoggle'); const setAdv = (on: boolean) => { document.body.classList.toggle('adv-on', on); advBtn.classList.toggle('on', on); localStorage.setItem('h2m-adv', on ? '1' : ''); };
  advBtn.onclick = () => setAdv(!document.body.classList.contains('adv-on')); setAdv(!!localStorage.getItem('h2m-adv'));
  document.addEventListener('click', e => { const m = $('#exportmenu') as HTMLDetailsElement; if (m.open && !m.contains(e.target as Node)) m.open = false; });
}
P.tracks.forEach(ensureLoaded); bindBeat(); renderBeats(); setTimeout(() => loadKit(P.beat!.kit, ac()), 0); bind(); buildKeyboard(); renderTracks(); renderEditor(); draw(); updBtns(); initMidi();
status('Tip: 1) Start mic  2) Record and hum  3) Polish  4) Play  5) Export');
