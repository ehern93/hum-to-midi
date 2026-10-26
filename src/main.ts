import './style.css';
import { Midi } from '@tonejs/midi';
import { detectPitch } from './pitch';
import { NAMES, SCALES, freqToMidiFloat, noteName, snapToScale, NoteStabilizer } from './music';
import { INSTRUMENTS, DRUMS, Inst, FX, playNote, startVoice, makeStrip, Strip, encodeWav } from './audio';

interface Note { p: number; s: number; d: number; v: number }
interface Track { id: number; name: string; inst: Inst; vol: number; pan: number; mute: boolean; solo: boolean; fx: FX; notes: Note[] }
interface Project { bpm: number; root: number; scale: string; transpose: number; bars: number; loop: { on: boolean; s: number; e: number }; tracks: Track[] }
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const defFx = (): FX => ({ reverb: 0.15, delay: 0, filter: 1, dist: 0, chorus: 0 });
let nid = 1;
const newTrack = (inst: Inst, name?: string): Track => ({ id: nid++, name: name || inst[0].toUpperCase() + inst.slice(1), inst, vol: 0.8, pan: 0, mute: false, solo: false, fx: defFx(), notes: [] });
function demo(): Project {
  const drums = newTrack('drums', 'Drums');
  for (let b = 0; b < 4; b++) for (let i = 0; i < 4; i++) { const s = b * 4 + i; drums.notes.push({ p: 42, s, d: 0.25, v: 0.6 }, { p: 42, s: s + 0.5, d: 0.25, v: 0.4 }); drums.notes.push({ p: i % 2 ? 38 : 36, s, d: 0.25, v: 0.9 }); }
  return { bpm: 110, root: 0, scale: 'major', transpose: 0, bars: 8, loop: { on: true, s: 0, e: 16 }, tracks: [newTrack('piano', 'Melody (hum me)'), newTrack('bass'), drums] };
}
let P: Project = load() || demo();
let sel = P.tracks[0].id;
let armed: number | null = null;
const cur = () => P.tracks.find(t => t.id === sel) || P.tracks[0];
function save() { localStorage.setItem('h2m-project', JSON.stringify(P)); }
function load(): Project | null { try { const p = JSON.parse(localStorage.getItem('h2m-project') || ''); nid = Math.max(...p.tracks.map((t: Track) => t.id)) + 1; return p; } catch { return null; } }

// ---------- audio
let ctx: AudioContext | null = null; let master: GainNode; let strips = new Map<number, Strip>();
function ac() {
  if (!ctx) { ctx = new AudioContext(); master = ctx.createGain(); const comp = ctx.createDynamicsCompressor(); master.connect(comp).connect(ctx.destination); }
  if (ctx.state === 'suspended') ctx.resume(); syncStrips(); return ctx;
}
const anySolo = () => P.tracks.some(t => t.solo);
const audible = (t: Track) => !t.mute && (!anySolo() || t.solo);
function syncStrips() {
  if (!ctx) return;
  for (const t of P.tracks) { let s = strips.get(t.id); if (!s) { s = makeStrip(ctx, master, P.bpm); strips.set(t.id, s); } s.update(t.fx, t.vol, t.pan, audible(t)); }
}
const spb = () => 60 / P.bpm;
const pitchOf = (t: Track, n: Note) => t.inst === 'drums' ? n.p : n.p + P.transpose;

// ---------- web midi out
let midiOut: MIDIOutput | null = null;
async function initMidi() {
  const s = $<HTMLSelectElement>('#midiout');
  if (!navigator.requestMIDIAccess) { s.innerHTML = '<option>Web MIDI unsupported</option>'; return; }
  try { const a = await navigator.requestMIDIAccess(); const fill = () => { s.innerHTML = '<option value="">MIDI out: none</option>' + [...a.outputs.values()].map(o => `<option value="${o.id}">${o.name}</option>`).join(''); }; fill(); a.onstatechange = fill;
    s.onchange = () => { midiOut = a.outputs.get(s.value) || null; }; } catch { s.innerHTML = '<option>MIDI access denied</option>'; }
}
const midiSend = (on: boolean, m: number, v = 0.8, drum = false, at?: number) => midiOut?.send([(on ? 0x90 : 0x80) | (drum ? 9 : 0), m, on ? Math.round(v * 127) : 0], at);

// ---------- transport
let playing = false, recording = false, startCtxTime = 0, startBeat = 0, schedBeat = 0, timer = 0, metro = true, countIn = false;
const posBeat = () => playing && ctx ? startBeat + (ctx.currentTime - startCtxTime) / spb() : startBeat;
function play(fromBeat = startBeat) {
  const c = ac(); stop(false); playing = true; startBeat = fromBeat; startCtxTime = c.currentTime + 0.05; schedBeat = fromBeat;
  timer = window.setInterval(schedule, 25); schedule(); $('#play').textContent = '■ Stop';
}
function stop(reset = true) {
  if (playing) { startBeat = posBeat(); } playing = false; clearInterval(timer); finishHeld(); if (recording && reset) { recording = false; updRec(); }
  $('#play').textContent = '▶ Play'; if (reset) {} draw();
}
function schedule() {
  if (!ctx) return; const ahead = (ctx.currentTime + 0.12 - startCtxTime) / spb() + startBeat;
  const L = P.loop;
  while (schedBeat < ahead) {
    const end = Math.min(ahead, L.on && !recording && schedBeat < L.e ? L.e : Infinity);
    const toTime = (b: number) => startCtxTime + (b - startBeat) * spb();
    for (const t of P.tracks) { if (!audible(t)) continue; const st = strips.get(t.id)!;
      for (const n of t.notes) if (n.s >= schedBeat && n.s < end) { const tm = toTime(n.s); playNote(ctx, st.input, t.inst, pitchOf(t, n), tm, n.d * spb(), n.v);
        if (midiOut) { const off = performance.now() + (tm - ctx.currentTime) * 1000; midiSend(true, pitchOf(t, n), n.v, t.inst === 'drums', off); midiSend(false, pitchOf(t, n), 0, t.inst === 'drums', off + n.d * spb() * 1000); } } }
    if (metro && (recording || $<HTMLInputElement>('#metroplay').checked)) for (let b = Math.ceil(schedBeat); b < end; b++) click(toTime(b), b % 4 === 0);
    if (end === L.e && L.on && !recording && end < ahead) { // wrap
      startCtxTime = toTime(L.e) - (L.s - L.s); startBeat = L.s; schedBeat = L.s; continue; }
    schedBeat = end; if (end === ahead) break;
  }
  if (!recording && !L.on && posBeat() > P.bars * 4) stop();
}
function click(t: number, accent: boolean) { const c = ctx!; const o = c.createOscillator(); const g = c.createGain(); o.frequency.value = accent ? 1600 : 1000; g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); o.connect(g).connect(master); o.start(t); o.stop(t + 0.06); }
function updRec() { $('#rec').classList.toggle('on', recording); $('#rec').textContent = recording ? '● Recording' : '● Rec'; }

// ---------- live note input (keyboard, mouse, hum) + recording
const held = new Map<string, { m: number; stop: () => void; startB: number; tr: number }>();
function noteOn(src: string, m: number, vel = 0.8) {
  noteOff(src); const c = ac(); const t = (armed && recording ? P.tracks.find(x => x.id === armed) : null) || cur();
  const strip = strips.get(t.id)!; const pm = t.inst === 'drums' ? m : m + P.transpose;
  held.set(src, { m, stop: startVoice(c, strip.input, t.inst, pm, vel), startB: posBeat(), tr: t.id }); midiSend(true, pm, vel, t.inst === 'drums'); lightKey(m, true);
}
function noteOff(src: string) {
  const h = held.get(src); if (!h) return; held.delete(src); h.stop(); const t = P.tracks.find(x => x.id === h.tr); lightKey(h.m, false);
  if (t) midiSend(false, t.inst === 'drums' ? h.m : h.m + P.transpose, 0, t.inst === 'drums');
  if (recording && playing && t) { let s = h.startB, d = Math.max(posBeat() - s, 0.05);
    const q = +$<HTMLSelectElement>('#recq').value; if (q) { s = Math.round(s / q) * q; d = Math.max(q, Math.round(d / q) * q); }
    if (s >= 0) { t.notes.push({ p: h.m, s, d: t.inst === 'drums' ? 0.25 : d, v: 0.8 }); save(); draw(); } }
}
function finishHeld() { for (const k of [...held.keys()]) noteOff(k); }

// ---------- keyboard
const KB_LO = 36, KB_HI = 84; let kbOct = 0;
function buildKeyboard() {
  const el = $('#keyboard'); el.innerHTML = ''; let wi = 0;
  for (let m = KB_LO; m <= KB_HI; m++) { const black = [1, 3, 6, 8, 10].includes(m % 12); const k = document.createElement('div');
    k.className = 'key ' + (black ? 'black' : 'white'); k.dataset.m = String(m); if (!black) { k.style.left = wi * 28 + 'px'; wi++; } else k.style.left = wi * 28 - 9 + 'px';
    if (m % 12 === 0) k.innerHTML = `<span>C${m / 12 - 1}</span>`;
    k.onpointerdown = e => { e.preventDefault(); k.setPointerCapture(e.pointerId); noteOn('mouse', m); }; k.onpointerup = k.onpointercancel = () => noteOff('mouse');
    el.appendChild(k); }
  el.style.width = wi * 28 + 'px'; markScale();
}
function markScale() { const sc = SCALES[P.scale]; document.querySelectorAll<HTMLElement>('.key').forEach(k => k.classList.toggle('inscale', sc.includes(((+k.dataset.m! - P.root) % 12 + 12) % 12))); }
function lightKey(m: number, on: boolean) { document.querySelector(`.key[data-m="${m}"]`)?.classList.toggle('active', on); }
const KEYMAP = 'awsedftgyhujkolp;'; // C..E next octave
window.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text') return;
  if (e.code === 'Space') { e.preventDefault(); playing ? stop() : play(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (rollSel) { cur().notes = cur().notes.filter(n => n !== rollSel); rollSel = null; save(); draw(); } return; }
  if (e.repeat) return; const k = e.key.toLowerCase();
  if (k === 'z') { kbOct = Math.max(-2, kbOct - 1); return; } if (k === 'x') { kbOct = Math.min(2, kbOct + 1); return; }
  if (k === 'r' && !e.ctrlKey && !e.metaKey) { toggleRec(); return; }
  const i = KEYMAP.indexOf(k); if (i >= 0) noteOn('k' + k, 60 + i + kbOct * 12);
});
window.addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (KEYMAP.includes(k)) noteOff('k' + k); });

// ---------- hum detection
let micOn = false, analyser: AnalyserNode, micStream: MediaStream; const stab = new NoteStabilizer(3, 5); let humNote: number | null = null; let smoothF = 0;
async function toggleMic() {
  if (micOn) { micOn = false; micStream.getTracks().forEach(t => t.stop()); noteOff('hum'); $('#mic').textContent = '🎤 Start mic'; $('#mic').classList.remove('on'); return; }
  const c = ac();
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
  catch { alert('Microphone access denied.'); return; }
  const src = c.createMediaStreamSource(micStream); analyser = c.createAnalyser(); analyser.fftSize = 2048; src.connect(analyser);
  micOn = true; $('#mic').textContent = '🎤 Stop mic'; $('#mic').classList.add('on'); humLoop();
}
function humLoop() {
  if (!micOn) return; requestAnimationFrame(humLoop);
  const buf = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(buf);
  const r = detectPitch(buf, ctx!.sampleRate, 0.15, 65, 1100);
  const gate = +$<HTMLInputElement>('#gate').value / 1000; const conf = +$<HTMLInputElement>('#conf').value / 100;
  $<HTMLElement>('#lvl').style.width = Math.min(100, r.rms * 400) + '%';
  let n: number | null = null;
  if (r.rms > gate && r.clarity > conf && r.freq > 0) {
    smoothF = smoothF && Math.abs(Math.log2(r.freq / smoothF)) < 0.1 ? smoothF * 0.7 + r.freq * 0.3 : r.freq;
    let mf = freqToMidiFloat(smoothF) + +$<HTMLSelectElement>('#humoct').value * 12;
    const nearest = Math.round(mf); const cents = Math.round((mf - nearest) * 100);
    n = $<HTMLInputElement>('#snap').checked ? snapToScale(mf, P.root, SCALES[P.scale]) : nearest;
    $('#hnote').textContent = noteName(nearest); $('#hfreq').textContent = smoothF.toFixed(1) + ' Hz';
    $('#hcents').textContent = (cents >= 0 ? '+' : '') + cents + '¢'; $<HTMLElement>('#needle').style.left = 50 + cents + '%';
    $('#hconf').textContent = 'clarity ' + Math.round(r.clarity * 100) + '%';
  } else { smoothF = 0; $('#hconf').textContent = r.rms > gate ? 'unclear' : 'silent'; }
  const s = stab.push(n);
  if (s !== humNote) { humNote = s; if (s === null) noteOff('hum'); else if ($<HTMLInputElement>('#humplay').checked || recording) noteOn('hum', s); $('#hout').textContent = s === null ? '—' : '→ ' + noteName(s); }
}

// ---------- UI: tracks
const BEAT_W = 32;
function renderTracks() {
  const el = $('#tracks'); el.innerHTML = '';
  for (const t of P.tracks) { const d = document.createElement('div'); d.className = 'track' + (t.id === sel ? ' sel' : '');
    d.innerHTML = `<div class="trow"><button class="arm ${armed === t.id ? 'on' : ''}" title="Arm for recording">●</button><input type="text" class="tname" value="${t.name.replace(/"/g, '')}">
      <button class="m ${t.mute ? 'on' : ''}">M</button><button class="s ${t.solo ? 'on' : ''}">S</button><button class="del" title="Delete track">✕</button></div>
      <div class="trow"><select class="inst">${INSTRUMENTS.map(i => `<option ${i === t.inst ? 'selected' : ''}>${i}</option>`).join('')}</select>
      <label>Vol<input type="range" class="vol" min="0" max="1.2" step="0.01" value="${t.vol}"></label><label>Pan<input type="range" class="pan" min="-1" max="1" step="0.01" value="${t.pan}"></label></div>`;
    d.onclick = () => { if (sel !== t.id) { sel = t.id; renderTracks(); renderFx(); draw(); } };
    const q = (s: string) => d.querySelector(s) as HTMLInputElement;
    q('.arm').onclick = e => { e.stopPropagation(); armed = armed === t.id ? null : t.id; renderTracks(); };
    q('.tname').onchange = () => { t.name = q('.tname').value; save(); };
    q('.m').onclick = () => { t.mute = !t.mute; after(); }; q('.s').onclick = () => { t.solo = !t.solo; after(); };
    q('.del').onclick = e => { e.stopPropagation(); if (P.tracks.length > 1 && confirm('Delete track ' + t.name + '?')) { P.tracks = P.tracks.filter(x => x !== t); sel = P.tracks[0].id; after(); } };
    q('.inst').onchange = () => { t.inst = q('.inst').value as Inst; after(); };
    q('.vol').oninput = () => { t.vol = +q('.vol').value; syncStrips(); save(); }; q('.pan').oninput = () => { t.pan = +q('.pan').value; syncStrips(); save(); };
    el.appendChild(d); }
}
function after() { syncStrips(); save(); renderTracks(); renderFx(); draw(); }
function renderFx() {
  const t = cur(); const el = $('#fx'); el.innerHTML = `<b>FX · ${t.name}</b>` + (['reverb', 'delay', 'chorus', 'dist', 'filter'] as (keyof FX)[]).map(k => `<label>${k === 'dist' ? 'distortion' : k === 'filter' ? 'filter (tone)' : k}<input type="range" min="0" max="1" step="0.01" data-k="${k}" value="${t.fx[k]}"></label>`).join('');
  el.querySelectorAll<HTMLInputElement>('input').forEach(i => i.oninput = () => { t.fx[i.dataset.k as keyof FX] = +i.value; syncStrips(); save(); });
  $('#rollwrap').style.display = t.inst === 'drums' ? 'none' : ''; $('#stepwrap').style.display = t.inst === 'drums' ? '' : 'none'; if (t.inst === 'drums') renderSteps();
}

// ---------- step sequencer
let stepBar = 0;
function renderSteps() {
  const t = cur(); const g = $('#steps'); g.innerHTML = ''; $('#stepbar').textContent = `Bar ${stepBar + 1}/${P.bars}`;
  for (const dr of [...DRUMS].reverse()) { const row = document.createElement('div'); row.className = 'srow'; row.innerHTML = `<span>${dr.n}</span>`;
    for (let i = 0; i < 16; i++) { const s = stepBar * 4 + i / 4; const b = document.createElement('button'); b.className = 'step' + (i % 4 === 0 ? ' beat' : '');
      const has = () => t.notes.find(n => n.p === dr.m && Math.abs(n.s - s) < 0.01); if (has()) b.classList.add('on');
      b.onclick = () => { const h = has(); if (h) t.notes = t.notes.filter(n => n !== h); else { t.notes.push({ p: dr.m, s, d: 0.25, v: 0.85 }); if (ctx) playNote(ac(), strips.get(t.id)!.input, 'drums', dr.m, ctx.currentTime, 0.1, 0.85); } save(); renderSteps(); draw(); };
      row.appendChild(b); }
    g.appendChild(row); }
}

// ---------- timeline + piano roll (canvas)
const tl = $<HTMLCanvasElement>('#timeline'); const roll = $<HTMLCanvasElement>('#roll');
const ROLL_LO = 24, ROLL_HI = 96, RH = 12; let rollSel: Note | null = null;
function draw() {
  const W = P.bars * 4 * BEAT_W; const lanes = P.tracks.length; tl.width = W; tl.height = 20 + lanes * 34;
  const g = tl.getContext('2d')!; g.fillStyle = '#15171c'; g.fillRect(0, 0, W, tl.height);
  if (P.loop.on) { g.fillStyle = 'rgba(80,160,255,.12)'; g.fillRect(P.loop.s * BEAT_W, 0, (P.loop.e - P.loop.s) * BEAT_W, tl.height); g.fillStyle = '#3b82f6'; g.fillRect(P.loop.s * BEAT_W, 0, (P.loop.e - P.loop.s) * BEAT_W, 4); }
  for (let b = 0; b <= P.bars * 4; b++) { g.fillStyle = b % 4 ? '#22252c' : '#353a45'; g.fillRect(b * BEAT_W, 0, 1, tl.height); if (b % 4 === 0) { g.fillStyle = '#8a93a6'; g.font = '11px sans-serif'; g.fillText(String(b / 4 + 1), b * BEAT_W + 3, 15); } }
  P.tracks.forEach((t, i) => { const y = 20 + i * 34; g.fillStyle = t.id === sel ? '#1f2633' : '#181b21'; g.fillRect(0, y + 1, W, 32);
    const ps = t.notes.map(n => n.p); const lo = Math.min(...ps, 200), hi = Math.max(...ps, 0); const rng = Math.max(hi - lo, 1);
    g.fillStyle = audible(t) ? hue(t.id) : '#555';
    for (const n of t.notes) g.fillRect(n.s * BEAT_W, y + 28 - ((n.p - lo) / rng) * 24 - 3, Math.max(2, n.d * BEAT_W - 1), 4); });
  // roll
  const t = cur(); roll.width = W; roll.height = (ROLL_HI - ROLL_LO + 1) * RH; const r = roll.getContext('2d')!; const sc = SCALES[P.scale];
  for (let m = ROLL_LO; m <= ROLL_HI; m++) { const y = (ROLL_HI - m) * RH; const blk = [1, 3, 6, 8, 10].includes(m % 12); r.fillStyle = sc.includes(((m - P.root) % 12 + 12) % 12) ? (blk ? '#1b1f27' : '#20252f') : '#14161b'; r.fillRect(0, y, W, RH); r.fillStyle = '#0e0f12'; r.fillRect(0, y + RH - 1, W, 1); if (m % 12 === 0) { r.fillStyle = '#6b7385'; r.font = '10px sans-serif'; r.fillText(noteName(m), 2, y + 10); } }
  for (let b = 0; b <= P.bars * 16; b++) { r.fillStyle = b % 16 === 0 ? '#3a404c' : b % 4 === 0 ? '#2a2f39' : '#1c2028'; r.fillRect(b * BEAT_W / 4, 0, 1, roll.height); }
  for (const n of t.notes) { const x = n.s * BEAT_W, y = (ROLL_HI - n.p) * RH; r.fillStyle = n === rollSel ? '#fff' : hue(t.id); r.fillRect(x + 1, y + 1, Math.max(3, n.d * BEAT_W - 2), RH - 2); r.fillStyle = 'rgba(0,0,0,.35)'; r.fillRect(x + n.d * BEAT_W - 4, y + 1, 3, RH - 2); }
  drawHead();
}
const hue = (id: number) => `hsl(${(id * 67) % 360} 70% 60%)`;
const ph1 = $('#ph1'), ph2 = $('#ph2');
function drawHead() { const x = posBeat() * BEAT_W; ph1.style.left = ph2.style.left = x + 'px'; const b = posBeat(); $('#pos').textContent = `${Math.floor(b / 4) + 1}.${Math.floor(b % 4) + 1}.${Math.floor((b % 1) * 4) + 1}`; }
(function anim() { requestAnimationFrame(anim); if (playing) { drawHead(); if (recording) { /* follow */ const sc = $('#tlwrap'); const x = posBeat() * BEAT_W; if (x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = x - 40; } } })();
// timeline interactions: click = set playhead/select track; shift-drag = loop region
let loopDrag: number | null = null;
tl.onpointerdown = e => { const b = e.offsetX / BEAT_W; const lane = Math.floor((e.offsetY - 20) / 34);
  if (e.shiftKey || e.offsetY < 20) { loopDrag = Math.round(b); P.loop = { on: true, s: loopDrag, e: loopDrag + 1 }; tl.setPointerCapture(e.pointerId); draw(); return; }
  if (P.tracks[lane]) { sel = P.tracks[lane].id; renderTracks(); renderFx(); } startBeat = Math.max(0, Math.floor(b * 4) / 4); if (playing) play(startBeat); draw(); };
tl.onpointermove = e => { if (loopDrag === null) return; const b = Math.round(e.offsetX / BEAT_W); P.loop.s = Math.min(loopDrag, b); P.loop.e = Math.max(loopDrag + 1, b); $<HTMLInputElement>('#loop').checked = true; draw(); };
tl.onpointerup = () => { if (loopDrag !== null) { loopDrag = null; if (P.loop.e - P.loop.s < 1) P.loop.e = P.loop.s + 4; save(); } };
// piano roll: click empty = add, drag note = move, drag right edge = resize, right-click/dbl = delete
let drag: { n: Note; mode: 'move' | 'size'; ox: number; os: number; op: number; od: number } | null = null;
const grid = () => +$<HTMLSelectElement>('#grid').value;
roll.oncontextmenu = e => e.preventDefault();
roll.onpointerdown = e => { const t = cur(); const b = e.offsetX / BEAT_W; const p = ROLL_HI - Math.floor(e.offsetY / RH);
  const hit = t.notes.find(n => n.p === p && b >= n.s && b <= n.s + n.d);
  if (e.button === 2) { if (hit) { t.notes = t.notes.filter(n => n !== hit); save(); draw(); } return; }
  if (!hit) { const g = grid(); const n = { p, s: Math.floor(b / g) * g, d: g, v: 0.8 }; t.notes.push(n); rollSel = n; drag = { n, mode: 'size', ox: e.offsetX, os: n.s, op: p, od: n.d }; }
  else { rollSel = hit; drag = { n: hit, mode: (hit.s + hit.d - b) * BEAT_W < 6 ? 'size' : 'move', ox: e.offsetX, os: hit.s, op: hit.p, od: hit.d }; }
  roll.setPointerCapture(e.pointerId); preview(p); draw(); };
roll.onpointermove = e => { if (!drag) { const t = cur(); const b = e.offsetX / BEAT_W; const p = ROLL_HI - Math.floor(e.offsetY / RH); const h = t.notes.find(n => n.p === p && b >= n.s && b <= n.s + n.d); roll.style.cursor = h && (h.s + h.d - b) * BEAT_W < 6 ? 'ew-resize' : h ? 'move' : 'crosshair'; return; }
  const g = grid(); const db = (e.offsetX - drag.ox) / BEAT_W;
  if (drag.mode === 'move') { drag.n.s = Math.max(0, Math.round((drag.os + db) / g) * g); const np = ROLL_HI - Math.floor(e.offsetY / RH); if (np !== drag.n.p) { drag.n.p = Math.max(ROLL_LO, Math.min(ROLL_HI, np)); preview(drag.n.p); } }
  else drag.n.d = Math.max(g, Math.round((drag.od + db) / g) * g);
  draw(); };
roll.onpointerup = () => { if (drag) { drag = null; save(); } };
roll.ondblclick = e => { const t = cur(); const b = e.offsetX / BEAT_W; const p = ROLL_HI - Math.floor(e.offsetY / RH); t.notes = t.notes.filter(n => !(n.p === p && b >= n.s && b <= n.s + n.d)); save(); draw(); };
function preview(p: number) { const c = ac(); const t = cur(); playNote(c, strips.get(t.id)!.input, t.inst, p + P.transpose, c.currentTime, 0.25, 0.7); }

// ---------- export
const dl = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const fname = (s: string) => s.replace(/[^\w-]+/g, '_');
function buildMidi(tracks: Track[]) {
  const m = new Midi(); m.header.setTempo(P.bpm); let ch = 0;
  for (const t of tracks) { const mt = m.addTrack(); mt.name = t.name; const drum = t.inst === 'drums'; mt.channel = drum ? 9 : (ch === 9 ? ++ch : ch++) % 16;
    for (const n of t.notes) mt.addNote({ midi: pitchOf(t, n), time: n.s * spb(), duration: n.d * spb(), velocity: n.v }); }
  return new Blob([m.toArray() as BlobPart], { type: 'audio/midi' });
}
const songEnd = (tracks: Track[]) => { const e = Math.max(0, ...tracks.flatMap(t => t.notes.map(n => n.s + n.d))); return P.loop.on ? Math.max(P.loop.e, e) : e; };
async function renderWav(tracks: Track[], name: string) {
  const beats = songEnd(tracks); if (!beats) { alert('Nothing to render yet.'); return; }
  $('#status').textContent = 'Rendering WAV…'; const secs = beats * spb() + 2.5; const sr = 44100;
  const oc = new OfflineAudioContext(2, Math.ceil(secs * sr), sr); const mg = oc.createGain(); const comp = oc.createDynamicsCompressor(); mg.connect(comp).connect(oc.destination);
  for (const t of tracks) { if (!audible(t) && tracks.length > 1) continue; const s = makeStrip(oc, mg, P.bpm); s.update(t.fx, t.vol, t.pan, true); for (const n of t.notes) playNote(oc, s.input, t.inst, pitchOf(t, n), n.s * spb() + 0.05, n.d * spb(), n.v); }
  const buf = await oc.startRendering(); dl(encodeWav(buf), name + '.wav'); $('#status').textContent = 'Exported ' + name + '.wav';
}

// ---------- controls
function bind() {
  const bpm = $<HTMLInputElement>('#bpm'), key = $<HTMLSelectElement>('#key'), scale = $<HTMLSelectElement>('#scale'), tr = $<HTMLInputElement>('#transpose'), bars = $<HTMLInputElement>('#bars');
  key.innerHTML = NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join(''); scale.innerHTML = Object.keys(SCALES).map(s => `<option>${s}</option>`).join('');
  const fill = () => { bpm.value = String(P.bpm); key.value = String(P.root); scale.value = P.scale; tr.value = String(P.transpose); bars.value = String(P.bars); $<HTMLInputElement>('#loop').checked = P.loop.on; };
  fill();
  bpm.onchange = () => { P.bpm = Math.max(40, Math.min(240, +bpm.value || 120)); strips.clear(); syncStrips(); save(); };
  key.onchange = () => { P.root = +key.value; markScale(); save(); draw(); }; scale.onchange = () => { P.scale = scale.value; markScale(); save(); draw(); };
  tr.onchange = () => { P.transpose = +tr.value; save(); }; bars.onchange = () => { P.bars = Math.max(1, Math.min(128, +bars.value)); save(); draw(); };
  $<HTMLInputElement>('#loop').onchange = e => { P.loop.on = (e.target as HTMLInputElement).checked; save(); draw(); };
  $<HTMLInputElement>('#metro').onchange = e => metro = (e.target as HTMLInputElement).checked;
  $('#play').onclick = () => playing ? stop() : play(); $('#rewind').onclick = () => { stop(); startBeat = P.loop.on ? P.loop.s : 0; draw(); };
  $('#rec').onclick = toggleRec; $('#mic').onclick = toggleMic;
  $('#addtrack').onclick = () => { const t = newTrack($<HTMLSelectElement>('#newinst').value as Inst); P.tracks.push(t); sel = t.id; after(); };
  $('#quant').onclick = () => { const g = grid(); for (const n of cur().notes) { n.s = Math.round(n.s / g) * g; n.d = Math.max(g, Math.round(n.d / g) * g); } save(); draw(); };
  $('#clear').onclick = () => { if (confirm('Clear all notes on ' + cur().name + '?')) { cur().notes = []; save(); draw(); renderFx(); } };
  $('#tup').onclick = () => { cur().notes.forEach(n => n.p++); save(); draw(); }; $('#tdn').onclick = () => { cur().notes.forEach(n => n.p--); save(); draw(); };
  $('#snapall').onclick = () => { const sc = SCALES[P.scale]; cur().notes.forEach(n => n.p = snapToScale(n.p, P.root, sc)); save(); draw(); };
  $('#sprev').onclick = () => { stepBar = (stepBar + P.bars - 1) % P.bars; renderSteps(); }; $('#snext').onclick = () => { stepBar = (stepBar + 1) % P.bars; renderSteps(); };
  $('#scopy').onclick = () => { const t = cur(); const src = t.notes.filter(n => n.s >= stepBar * 4 && n.s < stepBar * 4 + 4); t.notes = t.notes.filter(n => n.s >= stepBar * 4 && n.s < stepBar * 4 + 4);
    for (let b = 0; b < P.bars; b++) if (b !== stepBar) for (const n of src) t.notes.push({ ...n, s: n.s - stepBar * 4 + b * 4 }); t.notes.push(); save(); draw(); };
  $('#xwav').onclick = () => renderWav(P.tracks, 'mix'); $('#xtwav').onclick = () => renderWav([cur()], fname(cur().name));
  $('#xmid').onclick = () => dl(buildMidi(P.tracks), 'song.mid'); $('#xtmid').onclick = () => dl(buildMidi([cur()]), fname(cur().name) + '.mid');
  $('#xall').onclick = () => P.tracks.forEach((t, i) => setTimeout(() => dl(buildMidi([t]), `${i + 1}_${fname(t.name)}.mid`), i * 300));
  $('#xjson').onclick = () => dl(new Blob([JSON.stringify(P)], { type: 'application/json' }), 'project.json');
  $<HTMLInputElement>('#ijson').onchange = async e => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; try { P = JSON.parse(await f.text()); nid = Math.max(...P.tracks.map(t => t.id)) + 1; sel = P.tracks[0].id; strips.clear(); fill(); after(); markScale(); } catch { alert('Invalid project file'); } };
  $('#new').onclick = () => { if (confirm('Start a new project? (unsaved work is lost)')) { P = demo(); P.tracks.forEach(t => t.notes = []); sel = P.tracks[0].id; strips.clear(); fill(); after(); } };
}
function toggleRec() {
  if (recording) { recording = false; stop(); updRec(); return; }
  if (!armed) { armed = sel; renderTracks(); }
  recording = true; updRec(); const pre = $<HTMLInputElement>('#countin').checked ? 4 : 0; play(Math.max(0, startBeat) - pre);
}
bind(); buildKeyboard(); renderTracks(); renderFx(); draw(); initMidi();
