// YIN monophonic pitch detector
export interface PitchResult { freq: number; clarity: number; rms: number }
export function detectPitch(buf: Float32Array, sampleRate: number, threshold = 0.15, minF = 60, maxF = 1500): PitchResult {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  const maxTau = Math.min(Math.floor(sampleRate / minF), Math.floor(buf.length / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxF));
  const W = buf.length - maxTau;
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
    d[tau] = s;
  }
  // cumulative mean normalized difference
  const c = new Float32Array(maxTau + 1); c[0] = 1; let run = 0;
  for (let tau = 1; tau <= maxTau; tau++) { run += d[tau]; c[tau] = run ? (d[tau] * tau) / run : 1; }
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (c[t] < threshold) { while (t + 1 <= maxTau && c[t + 1] < c[t]) t++; tau = t; break; }
  }
  if (tau < 0) return { freq: 0, clarity: 0, rms };
  let better = tau;
  if (tau > 1 && tau < maxTau) {
    const a = c[tau - 1], b = c[tau], g = c[tau + 1];
    const den = a + g - 2 * b;
    if (den !== 0) better = tau + (a - g) / (2 * den);
  }
  return { freq: sampleRate / better, clarity: 1 - c[tau], rms };
}
