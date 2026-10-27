import { writeFileSync } from 'fs';
import { synthMelody, ODE } from './hum-synth';
const sr = 48000; const x = synthMelody(ODE, 100, { sr, jitter: .08, vib: .4, detune: .2, noise: .005, seed: 5, lead: 1.2 });
const b = Buffer.alloc(44 + x.length * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
writeFileSync(process.argv[2], b); console.log('seconds', x.length / sr);
