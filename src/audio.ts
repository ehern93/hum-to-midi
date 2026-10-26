import { midiToFreq } from './music';
export const INSTRUMENTS = ['piano','e-piano','synth lead','square lead','bass','sub bass','strings','pad','pluck','bell','organ','drums'] as const;
export type Inst = typeof INSTRUMENTS[number];
export const DRUMS = [ {n:'Kick',m:36},{n:'Snare',m:38},{n:'Clap',m:39},{n:'Closed Hat',m:42},{n:'Open Hat',m:46},{n:'Low Tom',m:45},{n:'Hi Tom',m:50},{n:'Crash',m:49} ];
export interface FX { reverb: number; delay: number; filter: number; dist: number; chorus: number }
let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; return s;
}
function env(g: GainNode, t: number, a: number, d: number, s: number, dur: number, r: number, peak: number) {
  const p = g.gain; p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(Math.max(peak * s, 0.0001), t + a + d);
  const end = t + Math.max(dur, a + d); p.setValueAtTime(Math.max(peak * s, 0.0001), end);
  p.exponentialRampToValueAtTime(0.0001, end + r); return end + r;
}
function osc(ctx: BaseAudioContext, type: OscillatorType, f: number, det = 0) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det; return o; }
export function playDrum(ctx: BaseAudioContext, out: AudioNode, m: number, t: number, vel: number) {
  const g = ctx.createGain(); g.connect(out); const v = vel;
  if (m === 36) { const o = osc(ctx,'sine',150); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.4); o.connect(g); o.start(t); o.stop(t+0.45); return; }
  if (m === 38 || m === 39) { const n = noise(ctx); const f = ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value = m===38?1800:1200; n.connect(f).connect(g);
    g.gain.setValueAtTime(v*0.8,t); g.gain.exponentialRampToValueAtTime(0.001,t+(m===38?0.2:0.15)); n.start(t); n.stop(t+0.25);
    if (m===38){ const o=osc(ctx,'triangle',190); const g2=ctx.createGain(); g2.gain.setValueAtTime(v*0.5,t); g2.gain.exponentialRampToValueAtTime(0.001,t+0.1); o.connect(g2).connect(out); o.start(t); o.stop(t+0.12);} return; }
  if (m === 42 || m === 46 || m === 49) { const n = noise(ctx); const f = ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value = m===49?5000:7000; n.connect(f).connect(g);
    const len = m===42?0.05:m===46?0.3:1.2; g.gain.setValueAtTime(v*(m===49?0.5:0.4),t); g.gain.exponentialRampToValueAtTime(0.001,t+len); n.start(t); n.stop(t+len+0.05); return; }
  const o = osc(ctx,'sine', m===45?110:180); o.frequency.exponentialRampToValueAtTime(m===45?70:110,t+0.3); g.gain.setValueAtTime(v*0.8,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.35); o.connect(g); o.start(t); o.stop(t+0.4);
}
export function playNote(ctx: BaseAudioContext, out: AudioNode, inst: Inst, m: number, t: number, dur: number, vel = 0.8) {
  if (inst === 'drums') return playDrum(ctx, out, m, t, vel);
  const f = midiToFreq(m); const g = ctx.createGain(); const v = vel * 0.35; let end = t + dur;
  const oscs: OscillatorNode[] = []; let dest: AudioNode = g;
  const lp = (fr: number, q = 1) => { const b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = fr; b.Q.value = q; b.connect(g); dest = b; return b; };
  switch (inst) {
    case 'piano': { lp(Math.min(f*8,12000)); oscs.push(osc(ctx,'triangle',f), osc(ctx,'sine',f*2)); end = env(g,t,0.005,1.2,0.15,dur,0.3,v); break; }
    case 'e-piano': { oscs.push(osc(ctx,'sine',f), osc(ctx,'sine',f*4,3)); end = env(g,t,0.005,0.8,0.3,dur,0.4,v); break; }
    case 'synth lead': { const b = lp(f*6,4); oscs.push(osc(ctx,'sawtooth',f,-6), osc(ctx,'sawtooth',f,6)); b.frequency.setValueAtTime(f*10,t); b.frequency.exponentialRampToValueAtTime(f*3,t+0.3); end = env(g,t,0.01,0.2,0.7,dur,0.15,v*0.7); break; }
    case 'square lead': { lp(4000); oscs.push(osc(ctx,'square',f)); end = env(g,t,0.01,0.1,0.8,dur,0.1,v*0.5); break; }
    case 'bass': { const b = lp(f*4,6); b.frequency.setValueAtTime(f*12,t); b.frequency.exponentialRampToValueAtTime(f*2,t+0.25); oscs.push(osc(ctx,'sawtooth',f), osc(ctx,'square',f/2)); end = env(g,t,0.005,0.3,0.6,dur,0.08,v*0.8); break; }
    case 'sub bass': { oscs.push(osc(ctx,'sine',f), osc(ctx,'triangle',f)); end = env(g,t,0.01,0.1,0.9,dur,0.1,v); break; }
    case 'strings': { lp(f*5); for (const d of [-12,-4,4,12]) oscs.push(osc(ctx,'sawtooth',f,d)); end = env(g,t,0.25,0.3,0.8,dur,0.5,v*0.35); break; }
    case 'pad': { lp(f*3,0.5); for (const d of [-15,0,15]) oscs.push(osc(ctx,'sawtooth',f,d)); oscs.push(osc(ctx,'sine',f/2)); end = env(g,t,0.6,0.5,0.8,dur,1.2,v*0.35); break; }
    case 'pluck': { const b = lp(f*12,2); b.frequency.setValueAtTime(f*12,t); b.frequency.exponentialRampToValueAtTime(f,t+0.3); oscs.push(osc(ctx,'square',f), osc(ctx,'sawtooth',f,7)); end = env(g,t,0.002,0.35,0.0001,Math.min(dur,0.4),0.1,v*0.6); break; }
    case 'bell': { const mod = osc(ctx,'sine',f*3.5); const mg = ctx.createGain(); mg.gain.setValueAtTime(f*3,t); mg.gain.exponentialRampToValueAtTime(1,t+1.5); const c = osc(ctx,'sine',f); mod.connect(mg).connect(c.frequency); oscs.push(c); mod.start(t); end = env(g,t,0.002,2,0.0001,dur,0.5,v); mod.stop(end+0.1); break; }
    case 'organ': { for (const h of [1,2,3,4]) oscs.push(osc(ctx,'sine',f*h)); end = env(g,t,0.01,0.05,0.9,dur,0.08,v*0.35); break; }
  }
  g.connect(out);
  for (const o of oscs) { o.connect(dest); o.start(t); o.stop(end + 0.05); }
}
// --- live voice (sustained, for hum monitoring / held keys)
export function startVoice(ctx: AudioContext, out: AudioNode, inst: Inst, m: number, vel = 0.8) {
  if (inst === 'drums') { playDrum(ctx, out, m, ctx.currentTime, vel); return () => {}; }
  const f = midiToFreq(m); const g = ctx.createGain(); g.connect(out); const t = ctx.currentTime;
  const types: OscillatorType[] = inst==='piano'||inst==='e-piano'?['triangle','sine']:inst==='sub bass'||inst==='organ'?['sine','sine']:inst==='square lead'?['square','square']:['sawtooth','sawtooth'];
  const lp = ctx.createBiquadFilter(); lp.frequency.value = Math.min(f*6, 9000); lp.connect(g);
  const os = types.map((ty,i) => { const o = osc(ctx, ty, i ? f*(inst==='piano'?2:1) : f, i ? 8 : -8); o.connect(lp); o.start(t); return o; });
  const att = inst==='pad'||inst==='strings'?0.3:0.01; const decaying = inst==='piano'||inst==='pluck'||inst==='bell'||inst==='e-piano';
  g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(vel*0.25,t+att); if (decaying) g.gain.exponentialRampToValueAtTime(vel*0.05,t+1.5);
  return () => { const n = ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(Math.max(g.gain.value,0.0001),n); g.gain.exponentialRampToValueAtTime(0.0001,n+0.15); os.forEach(o=>o.stop(n+0.2)); };
}
// --- track channel strip
function impulse(ctx: BaseAudioContext, secs = 2.5) {
  const len = ctx.sampleRate * secs; const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * Math.pow(1 - i/len, 3); }
  return b;
}
export interface Strip { input: GainNode; gain: GainNode; pan: StereoPannerNode; update(fx: FX, vol: number, pan: number, on: boolean): void }
const verbs = new WeakMap<AudioNode, AudioNode>();
function sharedVerb(ctx: BaseAudioContext, master: AudioNode) { let v = verbs.get(master); if (!v) { const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, 1.4); conv.connect(master); v = conv; verbs.set(master, v); } return v; }
// light channel strip: volume + pan + a send to ONE shared reverb (was a full FX chain per track)
export function makeStrip(ctx: BaseAudioContext, master: AudioNode, _bpm: number): Strip {
  const input = ctx.createGain(); const gain = ctx.createGain(); const pan = ctx.createStereoPanner(); const revG = ctx.createGain();
  input.connect(gain).connect(pan).connect(master); pan.connect(revG).connect(sharedVerb(ctx, master));
  return { input, gain, pan, update(fx, vol, p, on) { revG.gain.value = (fx?.reverb ?? 0.15) * 0.6; gain.gain.value = on ? vol : 0; pan.pan.value = p; } };
}
export function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length; const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0,'RIFF'); dv.setUint32(4,36+n*ch*2,true); ws(8,'WAVE'); ws(12,'fmt '); dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,ch,true);
  dv.setUint32(24,sr,true); dv.setUint32(28,sr*ch*2,true); dv.setUint16(32,ch*2,true); dv.setUint16(34,16,true); ws(36,'data'); dv.setUint32(40,n*ch*2,true);
  const data = Array.from({length: ch}, (_, c) => buf.getChannelData(c)); let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c][i])); dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Blob([dv], { type: 'audio/wav' });
}
