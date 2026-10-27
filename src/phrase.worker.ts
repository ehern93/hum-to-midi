import { analyze } from './phrase';
self.onmessage = (e: MessageEvent) => { const { x, sr, bpm, range } = e.data; (self as any).postMessage(analyze(x, sr, bpm, range)); };
