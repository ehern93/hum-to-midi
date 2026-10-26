import { plan } from './sched';
import { renderStaff, keyFifths, spell, noteValue, autoClef, yToStep, StaffOpts, Clef } from './score';
import './style.css';
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
let saveT = 0; function save() { clearTimeout(saveT); saveT = window.setTimeout(saveNow, 400); }
function saveNow() { clearTimeout(saveT); localStorage.setItem('h2m-project-v2', JSON.stringify(P)); }
addEventListener('pagehide', () => saveNow()); document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
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

// ---------- transport
let recStartAt = -1e9; let playing = false, recording = false, startCtxTime = 0, startBeat = 0, schedBeat = 0, timer = 0;
const posBeat = () => playing && ctx ? startBeat + (ctx.currentTime - startCtxTime) / spb() : startBeat;
function play(fromBeat = startBeat) {
  const c = ac(); halt(); playing = true; startBeat = fromBeat; startCtxTime = c.currentTime + 0.03; schedBeat = fromBeat;
  timer = window.setInterval(schedule, 25); schedule(); updBtns(); kickAnim();
}
function halt() { if (playing) startBeat = Math.max(0, posBeat()); playing = false; clearInterval(timer); }
function stop() {
  halt(); finishHeld();
  if (recording) { recording = false; endTake(); }
  updBtns(); draw();
}
function schedule() {
  if (!ctx) return; const L = P.loop; const loop = { on: L.on && !recording, s: L.s, e: L.e }; const now = ctx.currentTime;
  const r = plan({ schedBeat, startBeat, startCtxTime }, now, spb(), loop); ({ schedBeat, startBeat, startCtxTime } = r.clock);
  const metro = (recording && $<HTMLInputElement>('#metro').checked) || $<HTMLInputElement>('#metroplay').checked;
  for (const g of r.segs) { const toTime = (b: number) => g.t0 + (b - g.b0) * spb();
    for (const t of P.tracks) { if (!audible(t)) continue; const st = strips.get(t.id); if (!st) continue;
      for (const n of t.notes) if (n.s >= g.from && n.s < g.to) { const tm = toTime(n.s); if (tm < now - 0.03) continue; playT(t, ctx, st.input, pitchOf(t, n), Math.max(tm, now), n.d * spb(), n.v); } }
    if (metro) for (let b = Math.ceil(g.from); b < g.to; b++) if (b < 0 || b < recStartAt || !beatOn()) click(Math.max(now, toTime(b)), ((b % 4) + 4) % 4 === 0); }
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
  held.set(src, { m, stop: (t.gm != null && t.inst !== 'drums' && startGM(c, strip.input, t.gm, pm, vel)) || startVoice(c, strip.input, t.inst, pm, vel), startB: posBeat(), tr: t.id }); lightKey(m, true);
}
function noteOff(src: string) {
  const h = held.get(src); if (!h) return; held.delete(src); h.stop(); const t = P.tracks.find(x => x.id === h.tr); lightKey(h.m, false);
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
  if (micOn) { micOn = false; hvMic(false); micStream.getTracks().forEach(t => t.stop()); noteOff('hum'); $('#mic').classList.remove('on'); $('#mic').querySelector('b')!.textContent = 'Start mic'; return; }
  const c = ac();
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
  catch { alert('Microphone access denied.'); return; }
  const src = c.createMediaStreamSource(micStream); analyser = c.createAnalyser(); analyser.fftSize = 2048; src.connect(analyser);
  // estimated input→note latency: half the analysis window + stabilizer frames + device latency
  const est = Math.round(((analyser.fftSize / 2) / c.sampleRate + 3 / 60 + (c.baseLatency || 0.01)) * 1000 + 20);
  if (!localStorage.getItem('h2m-lat-set')) { P.polish.latency = est; $<HTMLInputElement>('#lat').value = String(est); $('#latv').textContent = est + ' ms'; }
  micOn = true; hvMic(true); $('#mic').classList.add('on'); $('#mic').querySelector('b')!.textContent = 'Mic on'; humLoop();
}
let humBuf: Float32Array<ArrayBuffer> | null = null; let humLast = 0;
function humLoop(now = performance.now()) {
  if (!micOn) return; requestAnimationFrame(humLoop); if (now - humLast < 30) return; humLast = now;
  if (!humBuf || humBuf.length !== analyser.fftSize) humBuf = new Float32Array(analyser.fftSize); const buf = humBuf; analyser.getFloatTimeDomainData(buf);
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
  hvLive(n);
  const s = stab.push(n);
  if (s !== humNote) { humNote = s; if (s === null) noteOff('hum'); else if ($<HTMLInputElement>('#humplay').checked || recording) noteOn('hum', s); $('#hout').textContent = s === null ? '' : '→ ' + noteName(s); if (s === null) $('#hnote').textContent = '—'; }
}

// ---------- UI: tracks
const BEAT_W = 36, LANE = 44, RULER = 22;
function renderTracks() {
  queueMicrotask(renderHvTracks);
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
  const t = cur();
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
const ROLL_LO = 36, ROLL_HI = 84; const COARSE = matchMedia('(pointer: coarse)').matches; const RH = COARSE ? 24 : 14; let RZ = 1; const RW = () => BEAT_W * RZ; let rollSel: Note | null = null;
const hue = (id: number) => `hsl(${(id * 67 + 170) % 360} 75% 62%)`;
function ruler(g: CanvasRenderingContext2D, W: number, h: number, BEAT_W = 36) {
  g.fillStyle = '#12141a'; g.fillRect(0, 0, W, h); g.font = '11px ui-sans-serif,system-ui';
  if (P.loop.on) { g.fillStyle = 'rgba(99,102,241,.35)'; g.fillRect(P.loop.s * BEAT_W, 0, (P.loop.e - P.loop.s) * BEAT_W, h); }
  for (let b = 0; b <= P.bars * 4; b++) { const x = b * BEAT_W; g.fillStyle = b % 4 ? '#3a3f4b' : '#8a93a6'; g.fillRect(x, b % 4 ? h - 5 : h - 10, 1, b % 4 ? 5 : 10);
    if (b % 4 === 0) { g.fillStyle = '#c7cdd9'; g.fillText(String(b / 4 + 1), x + 3, 11); g.fillStyle = '#5d6475'; g.fillText((b * spb()).toFixed(1) + 's', x + 3, h - 2 > 20 ? 21 : 21); } }
}
let drawPend = 0; function draw() { if (!drawPend) drawPend = requestAnimationFrame(() => { drawPend = 0; drawNow(); }); }
const sz = (c: HTMLCanvasElement, w: number, h: number) => { if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } else c.getContext('2d')!.clearRect(0, 0, w, h); };
function drawNow() {
  renderScore();
  const W = Math.max(P.bars * 4, Math.ceil(songEnd(P.tracks) / 4) * 4) * BEAT_W;
  sz(tl, W, RULER + P.tracks.length * LANE); const g = tl.getContext('2d')!;
  g.fillStyle = '#0f1116'; g.fillRect(0, 0, W, tl.height); ruler(g, W, RULER);
  P.tracks.forEach((t, i) => { const y = RULER + i * LANE; g.fillStyle = t.id === sel ? '#1a1f2b' : '#14171d'; g.fillRect(0, y + 1, W, LANE - 2);
    for (let b = 0; b <= P.bars * 4; b += 4) { g.fillStyle = '#232733'; g.fillRect(b * BEAT_W, y, 1, LANE); }
    const col = audible(t) ? hue(t.id) : '#4b5060';
    if (t.inst === 'drums') { for (const [bar, id] of Object.entries(t.parts || {})) { const x = +bar * 4 * BEAT_W; g.fillStyle = col + ''; g.globalAlpha = .18; g.fillRect(x + 2, y + 4, 4 * BEAT_W - 4, LANE - 8); g.globalAlpha = 1; g.fillStyle = '#e5e7eb'; g.font = '11px ui-sans-serif'; g.fillText(PRESETS.find(p => p.id === id)?.name || 'custom', x + 6, y + 15); } }
    const ps = t.notes.map(n => n.p); const lo = Math.min(...ps, 200), hi = Math.max(...ps, 0); const rng = Math.max(hi - lo, 1);
    g.fillStyle = col; for (const n of t.notes) g.fillRect(n.s * BEAT_W, y + LANE - 8 - ((n.p - lo) / rng) * (t.inst === 'drums' ? 18 : 28) - 2, Math.max(2, n.d * BEAT_W - 1), 4); });
  // ---- piano roll
  const t = cur(); const RWd = Math.round(W * RZ); sz(roll, RWd, (ROLL_HI - ROLL_LO + 1) * RH); sz(rr, RWd, RULER); ruler(rr.getContext('2d')!, RWd, RULER, RW());
  const r = roll.getContext('2d')!; const sc = SCALES[P.scale];
  for (let m = ROLL_LO; m <= ROLL_HI; m++) { const y = (ROLL_HI - m) * RH; const inK = sc.includes(((m - P.root) % 12 + 12) % 12); r.fillStyle = inK ? '#191d26' : '#121419'; r.fillRect(0, y, RWd, RH); r.fillStyle = '#0c0d10'; r.fillRect(0, y + RH - 1, W, 1); }
  for (let b = 0; b <= P.bars * 16; b++) { r.fillStyle = b % 16 === 0 ? '#3a404c' : b % 4 === 0 ? '#262b35' : '#1a1e26'; r.fillRect(b * RW() / 4, 0, 1, roll.height); }
  const showRaw = $<HTMLInputElement>('#showraw').checked && t.raw;
  if (showRaw) { r.setLineDash([3, 2]); r.strokeStyle = '#f87171'; r.fillStyle = 'rgba(248,113,113,.18)'; r.lineWidth = 1.5; for (const n of t.raw!) { const x = n.s * RW(), y = (ROLL_HI - n.p) * RH, w = Math.max(3, n.d * RW() - 1); r.fillRect(x, y, w, RH - 1); r.strokeRect(x + .75, y + .75, w - 1.5, RH - 2.5); } r.setLineDash([]); }
  r.font = 'bold 10px ui-sans-serif,system-ui';
  for (const n of t.notes) { const x = n.s * RW(), y = (ROLL_HI - n.p) * RH, w = Math.max(3, n.d * RW() - 2);
    r.fillStyle = n === rollSel ? '#ffffff' : hue(t.id); r.globalAlpha = (showRaw ? 0.45 : 0.55) + n.v * 0.45; r.beginPath(); r.roundRect(x + 1, y + (COARSE ? 2 : 3), w, RH - (COARSE ? 4 : 6), 3); r.fill(); r.globalAlpha = 1;
    if (w > 22) { r.fillStyle = '#0b0c10'; r.fillText(noteName(pitchOf(t, n)), x + 4, y + RH - 4); } }
  // left labels (sticky)
  const lab = $<HTMLCanvasElement>('#rlabels'); sz(lab, 34, roll.height); const l = lab.getContext('2d')!; l.font = '10px ui-sans-serif';
  for (let m = ROLL_LO; m <= ROLL_HI; m++) { const y = (ROLL_HI - m) * RH; const blk = [1, 3, 6, 8, 10].includes(m % 12); l.fillStyle = blk ? '#1b1d22' : '#d9dde5'; l.fillRect(0, y, 34, RH - 1); if (m % 12 === 0 || m === held.get('hum')?.m) { l.fillStyle = '#334'; l.fillText(noteName(m), 3, y + 11); } }
  $('#legend').style.display = t.raw ? '' : 'none'; $('.lg-pol').style.background = hue(t.id);
  drawHead();
}
function scrollRollToNotes() { const t = cur(); if (!t.notes.length || t.inst === 'drums') return; const avg = t.notes.reduce((a, n) => a + n.p, 0) / t.notes.length; const sc = $('#rollscroll'); sc.scrollTop = (ROLL_HI - avg) * RH - sc.clientHeight / 2; }
function drawHead() { const x = posBeat() * BEAT_W; document.querySelectorAll<HTMLElement>('.ph').forEach(p => p.style.transform = `translateX(${p.closest('#rollscroll') ? posBeat() * RW() : x}px)`); const b = Math.max(0, posBeat());
  const pt = `${Math.floor(b / 4) + 1}.${Math.floor(b % 4) + 1}  ·  ${(b * spb()).toFixed(1)}s`; if (pt !== lastPos) { lastPos = pt; $('#pos').textContent = pt; } }
let lastPos = '';
let animOn = false; function kickAnim() { if (!animOn) { animOn = true; requestAnimationFrame(anim); } }
function anim() { if (!playing) { animOn = false; drawHead(); return; } requestAnimationFrame(anim); { drawHead(); hvAnim(); for (const id of ['#tlwrap', '#rollscroll']) { const sc = $(id); const x = posBeat() * (id === '#rollscroll' ? RW() : BEAT_W); if (x > sc.scrollLeft + sc.clientWidth - 60 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 60); } } }
// timeline: click = playhead/select; ruler drag = loop
let loopDrag: number | null = null;
tl.onpointerdown = e => { const b = e.offsetX / BEAT_W; const lane = Math.floor((e.offsetY - RULER) / LANE);
  if (e.shiftKey || e.offsetY < RULER) { loopDrag = Math.round(b); tl.setPointerCapture(e.pointerId); return; }
  if (P.tracks[lane]) { const t = P.tracks[lane]; sel = t.id; renderTracks(); renderEditor(); updBtns(); }
  startBeat = Math.max(0, Math.floor(b * 4) / 4); if (playing) play(startBeat); draw(); };
tl.onpointermove = e => { if (loopDrag === null) return; const b = Math.round(e.offsetX / BEAT_W); if (b !== loopDrag) { P.loop = { on: true, s: Math.min(loopDrag, b), e: Math.max(loopDrag, b) }; $<HTMLInputElement>('#loop').checked = true; draw(); } };
tl.onpointerup = e => { if (loopDrag !== null) { if (Math.round(e.offsetX / BEAT_W) === loopDrag) { startBeat = Math.floor(e.offsetX / BEAT_W * 4) / 4; if (playing) play(startBeat); } loopDrag = null; save(); draw(); } };
rr.onpointerdown = e => { startBeat = Math.max(0, Math.floor(e.offsetX / RW() * 4) / 4); if (playing) play(startBeat); draw(); };
// piano roll editing
let drag: { n: Note; mode: 'move' | 'size'; ox: number; os: number; od: number } | null = null;
const grid = () => +$<HTMLSelectElement>('#grid').value;
roll.oncontextmenu = e => e.preventDefault();
const hitAt = (e: PointerEvent | MouseEvent) => { const b = e.offsetX / RW(); const p = ROLL_HI - Math.floor(e.offsetY / RH); return { b, p, hit: cur().notes.find(n => n.p === p && b >= n.s && b <= n.s + n.d) }; };
roll.onpointerdown = e => { if (e.pointerType !== 'mouse') return touchDown(e); const t = cur(); const { b, p, hit } = hitAt(e);
  if (e.button === 2) { if (hit) { t.notes = t.notes.filter(n => n !== hit); save(); draw(); } return; }
  if (!hit) { const g = grid(); const n = { p, s: Math.floor(b / g) * g, d: g * 2, v: 0.8 }; t.notes.push(n); rollSel = n; drag = { n, mode: 'size', ox: e.offsetX, os: n.s, od: n.d }; }
  else { rollSel = hit; drag = { n: hit, mode: (hit.s + hit.d - b) * RW() < 7 ? 'size' : 'move', ox: e.offsetX, os: hit.s, od: hit.d }; }
  roll.setPointerCapture(e.pointerId); preview(p); draw(); };
roll.onpointermove = e => { if (e.pointerType !== 'mouse') return touchMove(e); if (!drag) { const { b, hit } = hitAt(e); roll.style.cursor = hit && (hit.s + hit.d - b) * RW() < 7 ? 'ew-resize' : hit ? 'grab' : 'crosshair'; return; }
  const g = grid(); const db = (e.offsetX - drag.ox) / RW();
  if (drag.mode === 'move') { drag.n.s = Math.max(0, Math.round((drag.os + db) / g) * g); const np = Math.max(ROLL_LO, Math.min(ROLL_HI, ROLL_HI - Math.floor(e.offsetY / RH))); if (np !== drag.n.p) { drag.n.p = np; preview(np); } }
  else drag.n.d = Math.max(g, Math.round((drag.od + db) / g) * g);
  draw(); };
roll.onpointerup = roll.onpointercancel = e => { if (e.pointerType !== 'mouse') return touchUp(e); if (drag) { drag = null; save(); } };
roll.ondblclick = e => { if (COARSE) return; const { hit } = hitAt(e); if (hit) { cur().notes = cur().notes.filter(n => n !== hit); save(); draw(); } };
// ---- touch gestures (pointer events): tap add/select, drag move/scroll, pinch resize/zoom, long-press/double-tap delete
type TP = { x: number; y: number };
const tps = new Map<number, TP>();
let tg: { mode: 'idle' | 'move' | 'scroll' | 'pinch' | 'zoom' | 'done'; x0: number; y0: number; hit?: Note; os: number; op: number; sl: number; st: number; d0: number; notes: Note[]; ods: number[]; z0: number; mid: number; timer?: number } | null = null;
let lastTap = { n: null as Note | null, t: 0 };
const buzz = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* */ } };
const rpos = (x: number, y: number) => { const r = roll.getBoundingClientRect(); const ox = x - r.left, oy = y - r.top; const b = ox / RW(); const p = ROLL_HI - Math.floor(oy / RH); return { ox, oy, b, p, hit: cur().notes.find(n => n.p === p && b >= n.s - 0.1 && b <= n.s + n.d + 0.1) }; };
function lenLabel(d: number) { const k = Math.max(1, Math.round(d * 8)); const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a; const g = gcd(k, 32); return `${k / g}/${32 / g}`; }
const tipEl = () => { let el = document.getElementById('rolltip'); if (!el) { el = document.createElement('div'); el.id = 'rolltip'; el.className = 'rolltip'; $('#rollwrap').appendChild(el); } return el; };
const tip = (s: string | null) => { const el = tipEl(); el.textContent = s || ''; el.style.display = s ? '' : 'none'; };
const delNote = (n: Note) => { cur().notes = cur().notes.filter(x => x !== n); if (rollSel === n) rollSel = null; buzz(25); save(); draw(); };
function startPinch() { if (!tg) return; clearTimeout(tg.timer); const [a, b] = [...tps.values()]; tg.d0 = Math.max(24, Math.abs(a.x - b.x)); const h = rpos(a.x, a.y).hit || rpos(b.x, b.y).hit || rpos((a.x + b.x) / 2, (a.y + b.y) / 2).hit;
  const target = h ? [h] : rollSel ? [rollSel] : []; if (h) rollSel = h;
  tg.notes = target; tg.ods = target.map(n => n.d); tg.z0 = RZ; tg.mode = target.length ? 'pinch' : 'zoom';
  const r = roll.getBoundingClientRect(); tg.mid = ((a.x + b.x) / 2 - r.left) / RW(); tg.sl = $('#rollscroll').scrollLeft; tg.x0 = (a.x + b.x) / 2; draw(); if (target.length) tip(lenLabel(target[0].d)); }
function touchDown(e: PointerEvent) { e.preventDefault(); roll.setPointerCapture(e.pointerId); tps.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (tps.size === 1) { const { hit } = rpos(e.clientX, e.clientY); const sc = $('#rollscroll');
    tg = { mode: 'idle', x0: e.clientX, y0: e.clientY, hit, os: hit?.s ?? 0, op: hit?.p ?? 0, sl: sc.scrollLeft, st: sc.scrollTop, d0: 0, notes: [], ods: [], z0: RZ, mid: 0 };
    if (hit) tg.timer = window.setTimeout(() => { if (tg && tg.mode === 'idle' && tg.hit) { delNote(tg.hit); tg.mode = 'done'; } }, 550); }
  else if (tps.size === 2 && tg && tg.mode !== 'done') { if (tg.mode === 'move' && tg.hit) { tg.hit.s = tg.os; tg.hit.p = tg.op; } startPinch(); } }
function touchMove(e: PointerEvent) { if (!tps.has(e.pointerId) || !tg) return; e.preventDefault(); tps.set(e.pointerId, { x: e.clientX, y: e.clientY }); const g = grid();
  if (tps.size >= 2 && (tg.mode === 'pinch' || tg.mode === 'zoom')) { const [a, b] = [...tps.values()]; const ratio = Math.max(24, Math.abs(a.x - b.x)) / tg.d0;
    if (tg.mode === 'pinch') { let changed = false; tg.notes.forEach((n, i) => { let d = tg!.ods[i] * ratio; d = Math.max(0.125, d >= g ? Math.round(d / g) * g : Math.round(d / 0.125) * 0.125); if (d !== n.d) { n.d = d; changed = true; } });
      if (changed) { buzz(); tip(lenLabel(tg.notes[0].d)); draw(); } }
    else { RZ = Math.max(0.35, Math.min(4, tg.z0 * ratio)); draw(); const r0 = $('#rollscroll'); const rr0 = r0.getBoundingClientRect(); r0.scrollLeft = tg.mid * RW() + 34 - ((a.x + b.x) / 2 - rr0.left); tip(`Zoom ${Math.round(RZ * 100)}%`); }
    return; }
  if (tps.size !== 1 || tg.mode === 'done') return;
  const dx = e.clientX - tg.x0, dy = e.clientY - tg.y0;
  if (tg.mode === 'idle' && Math.hypot(dx, dy) > 8) { clearTimeout(tg.timer); tg.mode = tg.hit ? 'move' : 'scroll'; if (tg.hit) rollSel = tg.hit; }
  if (tg.mode === 'move' && tg.hit) { const n = tg.hit; n.s = Math.max(0, Math.round((tg.os + dx / RW()) / g) * g); const np = Math.max(ROLL_LO, Math.min(ROLL_HI, tg.op - Math.round(dy / RH))); if (np !== n.p) { n.p = np; preview(np); buzz(4); } draw(); }
  else if (tg.mode === 'scroll') { const sc = $('#rollscroll'); sc.scrollLeft = tg.sl - dx; sc.scrollTop = tg.st - dy; } }
function touchUp(e: PointerEvent) { if (!tps.has(e.pointerId)) return; tps.delete(e.pointerId); if (!tg) return; clearTimeout(tg.timer);
  if (tg.mode === 'pinch' || tg.mode === 'zoom') { if (tg.mode === 'pinch') save(); tip(null); tg = tps.size ? { ...tg, mode: 'done' } : null; return; }
  if (tg.mode === 'done') { if (!tps.size) tg = null; return; }
  if (tps.size) return;
  if (tg.mode === 'idle' && e.type !== 'pointercancel') { const { b, p, hit } = rpos(tg.x0, tg.y0); const now = performance.now();
    if (hit) { if (lastTap.n === hit && now - lastTap.t < 350) { delNote(hit); lastTap = { n: null, t: 0 }; } else { rollSel = hit; lastTap = { n: hit, t: now }; preview(hit.p); buzz(); draw(); } }
    else if (p >= ROLL_LO && p <= ROLL_HI) { const g = grid(); const n = { p, s: Math.floor(b / g) * g, d: Math.max(g, 0.5), v: 0.8 }; cur().notes.push(n); rollSel = n; lastTap = { n, t: now }; preview(p); buzz(); save(); draw(); } }
  else if (tg.mode === 'move') save();
  tg = null; }

function preview(p: number) { const c = ac(); const t = cur(); playT(t, c, strips.get(t.id)!.input, p + P.transpose, c.currentTime, 0.35, 0.7); }

// ---------- export
const dl = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const fname = (s: string) => s.replace(/[^\w-]+/g, '_');
async function buildMidi(tracks: Track[]) {
  const { Midi } = await import('@tonejs/midi'); const m = new Midi(); m.header.setTempo(P.bpm); let ch = 0;
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
  $('#xwav').onclick = () => renderWav(P.tracks, 'mix');
  $('#xmid').onclick = async () => dl(await buildMidi(P.tracks), 'song.mid');
  $('#xjson').onclick = () => dl(new Blob([JSON.stringify(P)], { type: 'application/json' }), 'project.json');
  $<HTMLInputElement>('#ijson').onchange = async e => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; try { P = JSON.parse(await f.text()); P.polish ||= defPolish(); nid = Math.max(...P.tracks.map(t => t.id)) + 1; sel = P.tracks[0].id; strips.clear(); fill(); after(); markScale(); } catch { alert('Invalid project file'); } };
  $('#new').onclick = () => { if (confirm('Start a new project? (current work is lost)')) { P = demo(); sel = armed = P.tracks[0].id; strips.clear(); fill(); after(); } };
  const advBtn = $('#advtoggle'); const setAdv = (on: boolean) => { document.body.classList.toggle('adv-on', on); advBtn.classList.toggle('on', on); localStorage.setItem('h2m-adv', on ? '1' : ''); };
  advBtn.onclick = () => setAdv(!document.body.classList.contains('adv-on')); setAdv(!!localStorage.getItem('h2m-adv'));
  document.addEventListener('click', e => { const m = $('#exportmenu') as HTMLDetailsElement; if (m.open && !m.contains(e.target as Node)) m.open = false; });
}
P.tracks.forEach(ensureLoaded); bindBeat(); renderBeats(); setTimeout(() => loadKit(P.beat!.kit, ac()), 0); bind(); buildKeyboard(); renderTracks(); renderEditor(); draw(); updBtns();
status('Tip: 1) Start mic  2) Record and hum  3) Polish  4) Play  5) Export');

// ================= Hum-first view =================
const DURS = [{ d: 4, sym: '𝅝', n: 'Whole' }, { d: 2, sym: '𝅗𝅥', n: 'Half' }, { d: 1, sym: '♩', n: 'Quarter' }, { d: 0.5, sym: '♪', n: 'Eighth' }, { d: 0.25, sym: '𝅘𝅥𝅯', n: '16th' }];
let hvDur = 1, hvDot = false, hvHeld: number | null = null, hvLast: number | null = null, hvSel: Note | null = null, hvCursor: number | null = null, SZ = 1, hvClef: 'auto' | Clef = 'auto', hvHi: Note | null = null;
const fifths = () => keyFifths(P.root, SCALES[P.scale]);
const capDur = () => hvDur * (hvDot ? 1.5 : 1);
function hvMic(on: boolean) { const b = $('#humbtn'); b.classList.toggle('on', on); b.querySelector('b')!.textContent = on ? 'Listening' : 'Hum'; if (!on) hvLive(null); }
function hvShown() { return hvHeld ?? hvLast; }
let hvLiveLast: number | null | undefined;
function hvLive(n: number | null) { if (n !== null) hvLast = n; const shown = hvHeld ?? n ?? hvLast; if (shown === hvLiveLast && n !== null) return; hvLiveLast = shown; paintLive(n !== null || hvHeld !== null); }
function paintLive(active = true) { const m = hvShown(); const el = $('#hvnote'); el.classList.toggle('held', hvHeld !== null);
  if (m === null) { el.textContent = '—'; $('#hvsub').textContent = micOn ? 'Hum a steady note…' : 'Tap Hum and sing a note'; $('#hvstaff').innerHTML = renderStaff([], { clef: 'treble', fifths: fifths(), beatW: 40, beats: 1, single: true, height: 150 }).svg; return; }
  const sp = spell(m, fifths()); el.textContent = sp.name; $('#hvsub').textContent = hvHeld !== null ? 'Held — pick instrument & length, then add' : active ? 'Hearing ' + sp.name + ' · tap Hold to keep it' : 'Last heard ' + sp.name;
  const clef = hvClef === 'auto' ? autoClef([m]) : hvClef; $('#hvstaff').innerHTML = renderStaff([{ p: m, s: 0, d: capDur(), id: 0 }], { clef, fifths: fifths(), beatW: 40, beats: 1, single: true, height: 150 }).svg; }
function renderHvTracks() { const h = document.getElementById('hvtracks'); if (!h) return; const ms = P.tracks.filter(t => t.inst !== 'drums');
  h.innerHTML = ms.map(t => `<button class="pill${t.id === sel ? ' on' : ''}" data-t="${t.id}">${t.name}</button>`).join('') + (ms.length < MAX_INST ? '<button class="pill" data-t="new">＋ Add</button>' : '') + (cur().inst !== 'drums' ? '<button class="pill" data-t="change">🎹 Change sound</button>' : ''); }
function renderDurs() { const mk = (cur: number, sm = false) => DURS.map(x => `<button class="pill${Math.abs(x.d - cur) < 1e-6 ? ' on' : ''}" data-d="${x.d}" title="${x.n}"><span class="sym">${x.sym}</span>${sm ? '' : x.n}</button>`).join('');
  $('#hvdur').innerHTML = mk(hvDur); const sd = $('#seldurs'); if (hvSel) { const v = noteValue(hvSel.d); sd.innerHTML = mk(v.base, true) + `<button class="pill${v.dotted ? ' on' : ''}" data-d="dot">•</button>`; } else sd.innerHTML = ''; }
function sortNotes(t: Track) { t.notes.sort((a, b) => a.s - b.s || a.p - b.p); }
function shiftAfter(t: Track, from: number, by: number, except?: Note) { for (const n of t.notes) if (n !== except && n.s >= from - 1e-6) n.s = Math.max(0, n.s + by); }
function fitBars(t: Track) { const end = Math.max(...t.notes.map(n => n.s + n.d), 0); const need = Math.ceil(end / 4); if (need > P.bars) { P.bars = need; const b = document.getElementById('bars') as HTMLInputElement | null; if (b) b.value = String(P.bars); } }
function insertPos(t: Track) { if (hvSel && t.notes.includes(hvSel)) return hvSel.s + hvSel.d; if (hvCursor !== null) return hvCursor; return Math.max(0, ...t.notes.map(n => n.s + n.d)); }
function capture() { const m = hvShown(); if (m === null) { $('#hvsub').textContent = 'Hum a note first (or tap Rest)'; return; } let t = cur(); if (t.inst === 'drums') { const mt = P.tracks.find(x => x.inst !== 'drums'); if (!mt) return; sel = mt.id; t = mt; }
  const d = capDur(); const at = insertPos(t); shiftAfter(t, at, d); const n: Note = { p: m, s: at, d, v: 0.85 }; t.notes.push(n); t.raw = null; sortNotes(t); hvSel = n; hvCursor = null; fitBars(t); ensureLoaded(t); preview(m); after(); scrollToNote(n); }
function addRest() { const t = cur(); const d = capDur(); const at = insertPos(t); shiftAfter(t, at, d); hvSel = null; hvCursor = at + d; after(); }
function scoreOpts(t: Track): StaffOpts { const clef = hvClef === 'auto' ? autoClef(t.notes.map(n => n.p)) : hvClef; const end = Math.max(P.bars * 4, Math.ceil((Math.max(0, ...t.notes.map(n => n.s + n.d)) + 0.01) / 4) * 4 + 4); return { clef, fifths: fifths(), beatW: 44 * SZ, beats: end, height: 180 }; }
let lastSvgKey = '';
function renderScore() { const host = document.getElementById('staff'); if (!host) return; const t = cur(); if (hvSel && !t.notes.includes(hvSel)) hvSel = null;
  if (t.inst === 'drums') { host.innerHTML = '<p class="hint" style="padding:16px">This is a drum track — pick an instrument above to see its notes.</p>'; lastSvgKey = ''; return; }
  const o = scoreOpts(t); const sn = t.notes.map((n, i) => ({ p: n.p, s: n.s, d: n.d, id: i, sel: n === hvSel, hi: n === hvHi }));
  const key = JSON.stringify([sn, o]); if (key === lastSvgKey) return; lastSvgKey = key; host.innerHTML = renderStaff(sn, o).svg;
  const cs = document.getElementById('clefsel') as HTMLSelectElement; cs.options[0].text = 'Auto clef (' + (o.clef === 'treble' ? '𝄞' : '𝄢') + ')';
  $('#selname').textContent = hvSel ? `${spell(hvSel.p, o.fifths).name} · ${noteValue(hvSel.d).n} · beat ${(hvSel.s + 1).toFixed(2).replace(/\.00$/, '')}` : t.notes.length ? 'Tap a note to edit it' : 'No notes yet — hum one and tap “Add note”';
  ['#seldn', '#selup', '#seldel'].forEach(id => ($(id) as HTMLButtonElement).disabled = !hvSel); renderDurs(); }
function scrollToNote(n: Note) { requestAnimationFrame(() => { const sc = $('#staffscroll'); const t = cur(); const x = (34 + Math.abs(fifths()) * 9 + 8 + 14) + n.s * 44 * SZ; if (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - sc.clientWidth / 2); void t; }); }
function stepPitch(n: Note, dir: number) { const sc = $<HTMLInputElement>('#snap').checked ? SCALES[P.scale] : SCALES.chromatic; let p = n.p; for (let i = 0; i < 12; i++) { p += dir; if (sc.includes(((p - P.root) % 12 + 12) % 12)) break; } n.p = Math.max(21, Math.min(108, p)); }
function setSelDur(d: number) { if (!hvSel) return; const t = cur(); const delta = d - hvSel.d; shiftAfter(t, hvSel.s + hvSel.d, delta, hvSel); hvSel.d = d; t.raw = null; fitBars(t); after(); }
const DSTEPS = [0.25, 0.375, 0.5, 0.75, 1, 1.5, 2, 3, 4];
function nudgeDur(dir: number) { if (!hvSel) return; let i = DSTEPS.findIndex(x => x >= hvSel!.d - 1e-6); if (i < 0) i = DSTEPS.length - 1; i = Math.max(0, Math.min(DSTEPS.length - 1, i + dir)); setSelDur(DSTEPS[i]); }
function delSel() { if (!hvSel) return; const t = cur(); const n = hvSel; t.notes = t.notes.filter(x => x !== n); shiftAfter(t, n.s + n.d, -n.d); const prev = t.notes.filter(x => x.s < n.s).pop() || null; hvSel = prev; t.raw = null; after(); }
function setZoom(z: number, cx?: number) { const sc = $('#staffscroll'); const old = SZ; SZ = Math.max(0.5, Math.min(3, z)); const anchor = cx ?? sc.clientWidth / 2; const left = (sc.scrollLeft + anchor) * (SZ / old) - anchor; $('#zv').textContent = Math.round(SZ * 100) + '%'; renderScore(); sc.scrollLeft = Math.max(0, left); }
let hvHiIdx = -2;
function hvAnim() { if (document.body.classList.contains('studio')) return; const t = cur(); const b = posBeat(); const n = t.notes.find(x => b >= x.s && b < x.s + x.d) || null; const idx = n ? t.notes.indexOf(n) : -1; if (idx === hvHiIdx) return; hvHiIdx = idx; hvHi = n; renderScore(); if (n) scrollToNote(n); }
// staff gestures
{ const sc = $('#staffscroll'); const pts = new Map<number, { x: number; y: number }>(); let mode: '' | 'note' | 'scroll' | 'pinch' = ''; let target: Note | null = null; let sx = 0, sy = 0, sl = 0, stepAcc = 0, moved = false, pd0 = 0, z0 = 1, durI = 0;
  const hit = (e: PointerEvent): Note | null => { const g = (e.target as Element).closest?.('.sn') as HTMLElement | null; if (g) return cur().notes[+g.dataset.id!] || null;
    const t = cur(); if (t.inst === 'drums') return null; const svg = $('#staff').querySelector('svg'); if (!svg) return null; const r = svg.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const o = scoreOpts(t);
    let best: Note | null = null, bd = 22; for (const n of t.notes) { const nx = (34 + Math.abs(o.fifths) * 9 + 8 + 14) + n.s * o.beatW; const ny = 100 - (spell(n.p, o.fifths).step - (o.clef === 'treble' ? 30 : 18)) * 5; const dd = Math.hypot(nx - x, ny - y); if (dd < bd) { bd = dd; best = n; } } return best; };
  const dist = () => { const a = [...pts.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
  sc.addEventListener('pointerdown', e => { sc.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { if (mode === 'note' && target && !moved) { mode = 'pinch'; durI = DSTEPS.findIndex(x => x >= target!.d - 1e-6); } else { mode = 'pinch'; target = null; } pd0 = dist(); z0 = SZ; return; }
    sx = e.clientX; sy = e.clientY; sl = sc.scrollLeft; stepAcc = 0; moved = false; target = hit(e); mode = target ? 'note' : 'scroll'; if (target && target !== hvSel) { hvSel = target; renderScore(); } });
  sc.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pinch' && pts.size === 2) { const ratio = dist() / (pd0 || 1); if (target) { const ni = Math.max(0, Math.min(DSTEPS.length - 1, durI + Math.round(Math.log2(ratio) * 3))); if (Math.abs(DSTEPS[ni] - target.d) > 1e-6) { hvSel = target; setSelDur(DSTEPS[ni]); buzz(); } } else setZoom(z0 * ratio); return; }
    if (mode === 'scroll') { if (Math.abs(e.clientX - sx) > 4) moved = true; sc.scrollLeft = sl - (e.clientX - sx); return; }
    if (mode === 'note' && target) { const dy = sy - e.clientY; const steps = Math.trunc(dy / 10); if (steps !== stepAcc) { moved = true; const dir = Math.sign(steps - stepAcc); for (let i = 0; i < Math.abs(steps - stepAcc); i++) stepPitch(target, dir); stepAcc = steps; cur().raw = null; preview(target.p); save(); renderScore(); } } });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size) return; if (mode === 'note' && target && !moved) preview(target.p); if (mode === 'scroll' && !moved && !target) { hvSel = null; renderScore(); } if (mode === 'note' && moved) after(); mode = ''; target = null; };
  sc.addEventListener('pointerup', up); sc.addEventListener('pointercancel', up);
  sc.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); setZoom(SZ * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX - sc.getBoundingClientRect().left); } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { sc.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false }); }
// wiring
{ const beat = $('.beatpanel'), editor = $('.editor'), sect = $('section.grow'), arr = $('.arr');
  const place = () => { const studio = document.body.classList.contains('studio'); const roll = document.body.classList.contains('rollmode');
    if (studio) { sect.insertBefore(beat, arr); sect.appendChild(editor); } else { $('#beathost').appendChild(beat); if (roll) $('#rollhost').appendChild(editor); else sect.appendChild(editor); } draw(); };
  place();
  $('#studiobtn').onclick = () => { document.body.classList.toggle('studio'); localStorage.setItem('h2m-studio', document.body.classList.contains('studio') ? '1' : ''); place(); };
  if (localStorage.getItem('h2m-studio')) { document.body.classList.add('studio'); place(); }
  $('#tabstaff').onclick = () => { document.body.classList.remove('rollmode'); $('#tabstaff').classList.add('on'); $('#tabroll').classList.remove('on'); place(); };
  $('#tabroll').onclick = () => { document.body.classList.add('rollmode'); $('#tabroll').classList.add('on'); $('#tabstaff').classList.remove('on'); place(); renderEditor(); };
  $('#humbtn').onclick = () => toggleMic();
  $('#holdbtn').onclick = () => { if (hvHeld !== null) hvHeld = null; else if (hvLast !== null) hvHeld = hvLast; $('#holdbtn').classList.toggle('on', hvHeld !== null); $('#holdbtn').textContent = hvHeld !== null ? '🔓 Release' : '🔒 Hold'; paintLive(); if (hvHeld !== null) preview(hvHeld); };
  const nud = (k: number) => { const m = hvShown() ?? 60 - k; hvHeld = Math.max(21, Math.min(108, m + k)); $('#holdbtn').classList.add('on'); $('#holdbtn').textContent = '🔓 Release'; paintLive(); preview(hvHeld); };
  $('#hvup').onclick = () => nud(1); $('#hvdn').onclick = () => nud(-1);
  $('#hvdur').onclick = e => { const b = (e.target as Element).closest('[data-d]') as HTMLElement | null; if (!b) return; hvDur = +b.dataset.d!; renderDurs(); paintLive(); };
  $<HTMLInputElement>('#hvdot').onchange = e => { hvDot = (e.target as HTMLInputElement).checked; paintLive(); };
  $('#seldurs').onclick = e => { const b = (e.target as Element).closest('[data-d]') as HTMLElement | null; if (!b || !hvSel) return; const v = noteValue(hvSel.d); if (b.dataset.d === 'dot') setSelDur(v.dotted ? v.base : v.base * 1.5); else setSelDur(+b.dataset.d! * (v.dotted ? 1.5 : 1)); };
  $('#hvtracks').onclick = e => { const b = (e.target as Element).closest('[data-t]') as HTMLElement | null; if (!b) return; const v = b.dataset.t!; if (v === 'new') openBrowser(null); else if (v === 'change') openBrowser(cur()); else { sel = +v; hvSel = null; hvCursor = null; previewInst(cur()); after(); } };
  $('#capture').onclick = capture; $('#hvrest').onclick = addRest; $('#hvplay').onclick = () => $('#play').click();
  $('#seldel').onclick = delSel; $('#selup').onclick = () => { if (hvSel) { stepPitch(hvSel, 1); preview(hvSel.p); after(); } }; $('#seldn').onclick = () => { if (hvSel) { stepPitch(hvSel, -1); preview(hvSel.p); after(); } };
  $('#zin').onclick = () => setZoom(SZ * 1.25); $('#zout').onclick = () => setZoom(SZ / 1.25);
  $<HTMLSelectElement>('#clefsel').onchange = e => { hvClef = (e.target as HTMLSelectElement).value as typeof hvClef; paintLive(); renderScore(); };
  document.addEventListener('keydown', e => { if (document.body.classList.contains('studio') || !hvSel || (e.target as Element).closest('input,select,textarea')) return; if (e.key === 'Delete' || e.key === 'Backspace') { delSel(); e.preventDefault(); } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { stepPitch(hvSel, e.key === 'ArrowUp' ? 1 : -1); preview(hvSel.p); after(); e.preventDefault(); } }, true);
  const playSync = () => { const p = $('#play'); const on = p.querySelector('b')!.textContent === 'Stop'; $('#hvplay').textContent = on ? '■ Stop' : '▶ Play'; $('#hvplay').classList.toggle('on', on); if (!on && hvHi) { hvHi = null; hvHiIdx = -2; renderScore(); } };
  new MutationObserver(playSync).observe($('#play'), { subtree: true, childList: true, characterData: true });
  renderHvTracks(); renderDurs(); paintLive(); renderScore(); }
