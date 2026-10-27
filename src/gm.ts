// General MIDI 128-instrument library with real samples (FluidR3_GM, gleitz/midi-js-soundfonts), lazy-loaded.
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
const BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/';
const banks = new Map<number, Map<number, AudioBuffer>>(); const pending = new Map<number, Promise<boolean>>();
let dctx: BaseAudioContext | null = null;
export const gmReady = (p: number) => banks.has(p);
const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function nameToMidi(n: string) { const m = /^([A-G])(b?)(-?\d)$/.exec(n); return m ? NOTE[m[1]] - (m[2] ? 1 : 0) + (+m[3] + 1) * 12 : -1; }
export function loadGM(p: number, ctx?: BaseAudioContext): Promise<boolean> {
  if (banks.has(p)) return Promise.resolve(true); if (pending.has(p)) return pending.get(p)!;
  dctx ||= ctx || new AudioContext();
  const pr = (async () => { try {
    const txt = await (await fetch(BASE + GM[p] + '-mp3.js')).text();
    const obj: Record<string, string> = JSON.parse(txt.slice(txt.indexOf('{', txt.indexOf('Soundfont.' + GM[p])), txt.lastIndexOf('}') + 1).replace(/,\s*}$/, '}'));
    const bank = new Map<number, AudioBuffer>();
    await Promise.all(Object.entries(obj).map(async ([k, v]) => { const m = nameToMidi(k); if (m < 0) return;
      const bin = new Uint8Array(await (await fetch(v)).arrayBuffer());
      try { bank.set(m, await dctx!.decodeAudioData(bin.buffer)); } catch { /* skip bad note */ } }));
    if (!bank.size) return false; banks.set(p, bank); return true;
  } catch { pending.delete(p); return false; } })();
  pending.set(p, pr); return pr;
}
function nearest(bank: Map<number, AudioBuffer>, m: number): [AudioBuffer, number] { if (bank.has(m)) return [bank.get(m)!, 0]; let best = -1, bd = 1e9; for (const k of bank.keys()) { const d = Math.abs(k - m); if (d < bd) { bd = d; best = k; } } return [bank.get(best)!, m - best]; }
const sustained = (p: number) => (p >= 16 && p < 24) || (p >= 40 && p < 46) || (p >= 48 && p < 56) || (p >= 56 && p < 96) || p === 109 || p === 110;
/** Schedules a sampled note. Returns false if samples aren't loaded (caller falls back to synth). */
export function playGM(ctx: BaseAudioContext, out: AudioNode, p: number, m: number, t: number, dur: number, vel = 0.8): boolean {
  const bank = banks.get(p); if (!bank) return false; const [buf, shift] = nearest(bank, m);
  const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = Math.pow(2, shift / 12);
  const g = ctx.createGain(); const peak = 0.25 + vel * 0.75; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.005);
  const len = buf.duration / s.playbackRate.value; const end = Math.min(t + Math.max(dur, 0.05), t + len); const rel = sustained(p) ? 0.12 : 0.3;
  g.gain.setValueAtTime(peak, end); g.gain.linearRampToValueAtTime(0, end + rel);
  s.connect(g).connect(out); s.start(t); s.stop(end + rel + 0.02); return true;
}
export function startGM(ctx: AudioContext, out: AudioNode, p: number, m: number, vel = 0.8): (() => void) | null {
  const bank = banks.get(p); if (!bank) return null; const [buf, shift] = nearest(bank, m); const t = ctx.currentTime;
  const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = Math.pow(2, shift / 12);
  const g = ctx.createGain(); const peak = 0.25 + vel * 0.75; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.005);
  s.connect(g).connect(out); s.start(t);
  return () => { const n = ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.linearRampToValueAtTime(0, n + 0.15); s.stop(n + 0.2); };
}
/** Default GM program for each built-in synth (used for MIDI export and as the sampled upgrade). */
export const SYNTH_GM: Record<string, number> = { piano: 0, 'e-piano': 4, 'synth lead': 81, 'square lead': 80, bass: 33, 'sub bass': 38, strings: 48, pad: 89, pluck: 45, bell: 14, organ: 16 };

export const hasGM = (p: number) => banks.has(p);
