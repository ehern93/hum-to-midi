// Instrument library: 128 GM (FluidR3_GM) + curated voices, samples served from /sounds on this deployment, lazy-loaded.
export const GM = `acoustic_grand_piano bright_acoustic_piano electric_grand_piano honkytonk_piano electric_piano_1 electric_piano_2 harpsichord clavinet
celesta glockenspiel music_box vibraphone marimba xylophone tubular_bells dulcimer
drawbar_organ percussive_organ rock_organ church_organ reed_organ accordion harmonica tango_accordion
acoustic_guitar_nylon acoustic_guitar_steel electric_guitar_jazz electric_guitar_clean electric_guitar_muted overdriven_guitar distortion_guitar guitar_harmonics
acoustic_bass electric_bass_finger electric_bass_pick fretless_bass slap_bass_1 slap_bass_2 synth_bass_1 synth_bass_2
violin viola cello contrabass tremolo_strings pizzicato_strings orchestral_harp timpani
string_ensemble_1 string_ensemble_2 synth_strings_1 synth_strings_2 choir_aahs voice_oohs synth_choir orchestra_hit
trumpet trombone tuba muted_trumpet french_horn brass_section synth_brass_1 synth_brass_2
soprano_sax alto_sax tenor_sax baritone_sax oboe english_horn bassoon clarinet
piccolo flute recorder pan_flute blown_bottle shakuhachi whistle ocarina
lead_1_square lead_2_sawtooth lead_3_calliope lead_4_chiff lead_5_charang lead_6_voice lead_7_fifths lead_8_bass__lead
pad_1_new_age pad_2_warm pad_3_polysynth pad_4_choir pad_5_bowed pad_6_metallic pad_7_halo pad_8_sweep
fx_1_rain fx_2_soundtrack fx_3_crystal fx_4_atmosphere fx_5_brightness fx_6_goblins fx_7_echoes fx_8_scifi
sitar banjo shamisen koto kalimba bagpipe fiddle shanai
tinkle_bell agogo steel_drums woodblock taiko_drum melodic_tom synth_drum reverse_cymbal
guitar_fret_noise breath_noise seashore bird_tweet telephone_ring helicopter applause gunshot`.split(/\s+/);
export const GM_CATS: { name: string; icon: string }[] = [
  { name: 'Piano', icon: '🎹' }, { name: 'Chromatic', icon: '🔔' }, { name: 'Organ', icon: '🪗' }, { name: 'Guitar', icon: '🎸' },
  { name: 'Bass', icon: '🎸' }, { name: 'Strings', icon: '🎻' }, { name: 'Ensemble', icon: '🎼' }, { name: 'Brass', icon: '🎺' },
  { name: 'Reed', icon: '🎷' }, { name: 'Pipe', icon: '🪈' }, { name: 'Synth Lead', icon: '⚡' }, { name: 'Synth Pad', icon: '🌌' },
  { name: 'Synth FX', icon: '✨' }, { name: 'Ethnic', icon: '🪕' }, { name: 'Percussive', icon: '🥁' }, { name: 'Sound FX', icon: '🌊' }];
export const gmCat = (p: number) => GM_CATS[p >> 3];
export function gmLabel(p: number) { return GM[p].replace(/__/g, ' ').replace(/_/g, ' ').replace(/^(lead|pad|fx) \d /, '$1 ').replace(/\b\w/g, c => c.toUpperCase()).replace('Honkytonk', 'Honky-tonk'); }
import VOICEDEFS from './voicedefs.json';
// All samples are served from this site's deployment (/sounds/<key>/<midi>.mp3); only normal HTTP caching applies.
export type Voice = { id: number; key: string; n: string; i: string; g: string; gm: number; src: string };
export const VOICES: Voice[] = VOICEDEFS as Voice[];
export const voice = (id: number) => VOICES.find(v => v.id === id);
/** GM program number used for MIDI export. */
export const midiProgram = (id: number) => id < 128 ? id : voice(id)?.gm ?? 0;
export const isSynthVoice = (id: number) => !!voice(id)?.src.startsWith('synth:');
export const soundKey = (id: number) => id < 128 ? 'gm' + id : voice(id)?.key ?? 'gm0';
const banks = new Map<number, Map<number, AudioBuffer>>(); const pending = new Map<number, Promise<boolean>>();
let dctx: BaseAudioContext | null = null; let idx: Promise<Record<string, number[]>> | null = null;
const index = () => idx ||= fetch('/sounds/index.json').then(r => r.json()).catch(() => { idx = null; return {}; });
/** Peak-normalise each sample so every pack plays at a similar level. */
function norm(b: AudioBuffer): AudioBuffer | null { let pk = 0; for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; } }
  if (pk < 2e-3) return null; /* silent sample (outside the instrument's range) */ { const k = Math.min(8, .8 / pk); for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; } } return b; }
export const gmReady = (p: number) => banks.has(p) || isSynthVoice(p);
export function loadGM(p: number, ctx?: BaseAudioContext): Promise<boolean> {
  if (gmReady(p)) return Promise.resolve(true); if (pending.has(p)) return pending.get(p)!;
  dctx ||= ctx || new AudioContext();
  const pr = (async () => { try {
    const key = soundKey(p); const notes = (await index())[key] || []; const bank = new Map<number, AudioBuffer>();
    await Promise.all(notes.map(async (m: number) => { try { const bin = await (await fetch(`/sounds/${key}/${m}.mp3`)).arrayBuffer(); const b = norm(await dctx!.decodeAudioData(bin)); if (b) bank.set(m, b); } catch { /* skip */ } }));
    if (!bank.size) { pending.delete(p); return false; } banks.set(p, bank); return true;
  } catch { pending.delete(p); return false; } })();
  pending.set(p, pr); return pr;
}
function nearest(bank: Map<number, AudioBuffer>, m: number): [AudioBuffer, number] { if (bank.has(m)) return [bank.get(m)!, 0]; let best = -1, bd = 1e9; for (const k of bank.keys()) { const d = Math.abs(k - m); if (d < bd) { bd = d; best = k; } } return [bank.get(best)!, m - best]; }
const sustained0 = (p: number) => (p >= 16 && p < 24) || (p >= 40 && p < 46) || (p >= 48 && p < 56) || (p >= 56 && p < 96) || p === 109 || p === 110;
const sustained = (id: number) => sustained0(midiProgram(id));
/** Schedules a sampled note. Returns false if samples aren't loaded (caller falls back to synth). */
export function playGM(ctx: BaseAudioContext, out: AudioNode, p: number, m: number, t: number, dur: number, vel = 0.8): boolean {
  if (isSynthVoice(p)) { playSynth(ctx, out, voice(p)!.src.slice(6), m, t, dur, vel); return true; }
  const bank = banks.get(p); if (!bank) return false; const [buf, shift] = nearest(bank, m);
  const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = Math.pow(2, shift / 12);
  const g = ctx.createGain(); const peak = 0.25 + vel * 0.75; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.005);
  const len = buf.duration / s.playbackRate.value; const end = Math.min(t + Math.max(dur, 0.05), t + len); const rel = sustained(p) ? 0.12 : 0.3;
  g.gain.setValueAtTime(peak, end); g.gain.linearRampToValueAtTime(0, end + rel);
  s.connect(g).connect(out); s.start(t); s.stop(end + rel + 0.02); return true;
}
export function startGM(ctx: AudioContext, out: AudioNode, p: number, m: number, vel = 0.8): (() => void) | null {
  if (isSynthVoice(p)) { playSynth(ctx, out, voice(p)!.src.slice(6), m, ctx.currentTime, .6, vel); return () => {}; }
  const bank = banks.get(p); if (!bank) return null; const [buf, shift] = nearest(bank, m); const t = ctx.currentTime;
  const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = Math.pow(2, shift / 12);
  const g = ctx.createGain(); const peak = 0.25 + vel * 0.75; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.005);
  s.connect(g).connect(out); s.start(t);
  return () => { const n = ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.linearRampToValueAtTime(0, n + 0.15); s.stop(n + 0.2); };
}
/** Default GM program for each built-in synth (used for MIDI export and as the sampled upgrade). */
export const SYNTH_GM: Record<string, number> = { piano: 0, 'e-piano': 4, 'synth lead': 81, 'square lead': 80, bass: 33, 'sub bass': 38, strings: 48, pad: 89, pluck: 45, bell: 14, organ: 16 };

export const hasGM = (p: number) => gmReady(p);

/** Designed Web Audio synth voices (no samples needed). */
export function playSynth(ctx: BaseAudioContext, out: AudioNode, kind: string, m: number, t: number, dur: number, vel = .8) {
  const f = 440 * Math.pow(2, (m - 69) / 12); const P: Record<string, { w: OscillatorType[]; det: number[]; a: number; d: number; s: number; r: number; cut: number; env: number; q: number; sub?: boolean }> = {
    lead: { w: ['sawtooth', 'square'], det: [-6, 6], a: .01, d: .2, s: .7, r: .15, cut: 2600, env: 2500, q: 4 },
    saw: { w: ['sawtooth', 'sawtooth', 'sawtooth'], det: [-12, 0, 12], a: .01, d: .3, s: .6, r: .2, cut: 3200, env: 2000, q: 2 },
    square: { w: ['square'], det: [0], a: .005, d: .15, s: .6, r: .1, cut: 2200, env: 1500, q: 2 },
    pluck: { w: ['sawtooth', 'triangle'], det: [-4, 4], a: .002, d: .25, s: 0, r: .2, cut: 900, env: 5000, q: 6 },
    pad: { w: ['sawtooth', 'sawtooth'], det: [-9, 9], a: .45, d: .5, s: .8, r: .9, cut: 1400, env: 600, q: 1 },
    warm: { w: ['triangle', 'sawtooth'], det: [-5, 5], a: .6, d: .6, s: .85, r: 1.1, cut: 900, env: 300, q: .7 },
    bass: { w: ['sawtooth', 'square'], det: [0, -1200], a: .005, d: .25, s: .55, r: .12, cut: 500, env: 1400, q: 8, sub: true } };
  const p = P[kind] || P.lead; const end = t + Math.max(dur, .08);
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = p.q; fl.frequency.setValueAtTime(p.cut + p.env, t); fl.frequency.exponentialRampToValueAtTime(Math.max(80, p.cut), t + p.a + p.d);
  const g = ctx.createGain(); const pk = (.12 + vel * .22) / Math.sqrt(p.w.length); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + p.a);
  g.gain.linearRampToValueAtTime(pk * Math.max(p.s, .0001), t + p.a + p.d); g.gain.setValueAtTime(pk * Math.max(p.s, .0001), Math.max(end, t + p.a + p.d)); g.gain.linearRampToValueAtTime(0, Math.max(end, t + p.a + p.d) + p.r);
  fl.connect(g).connect(out); const stopAt = Math.max(end, t + p.a + p.d) + p.r + .05;
  p.w.forEach((w, i) => { const o = ctx.createOscillator(); o.type = w; o.frequency.value = f; o.detune.value = p.det[i] ?? 0; o.connect(fl); o.start(t); o.stop(stopAt); });
  if (p.sub) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f / 2; const sg = ctx.createGain(); sg.gain.value = .8; o.connect(sg).connect(g); o.start(t); o.stop(stopAt); }
}
