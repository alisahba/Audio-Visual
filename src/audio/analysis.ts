import { BAND_COUNT } from './bands';
import { analyse, type AnalysisResult } from './analysis-core';
export { beatGrid, detectBeats, noveltyCurve, onsetDelta, pickOnsets } from './beats';
import AnalysisWorker from './analysis.worker?worker&inline';

export type TrackAnalysis = AnalysisResult;

export function downmix(buffer: AudioBuffer): Float32Array {
  const n = buffer.length;
  const out = new Float32Array(n);
  const ch = buffer.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i] / ch;
  }
  return out;
}

export function analyseMono(mono: Float32Array, sampleRate: number, onProgress?: (v: number) => void): Promise<TrackAnalysis> {
  // Fall back to the main thread where workers are unavailable (strict CSP, file://).
  const inline = () =>
    new Promise<TrackAnalysis>((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(analyse({ mono, sampleRate }, (v) => onProgress?.(v)));
        } catch (err) {
          reject(err);
        }
      }, 0),
    );
  let worker: Worker;
  try {
    worker = new AnalysisWorker();
  } catch {
    return inline();
  }
  return new Promise((resolve, reject) => {
    let heard = false;
    worker.onmessage = (e: MessageEvent) => {
      heard = true;
      const msg = e.data;
      if (msg.type === 'progress') onProgress?.(msg.value);
      else if (msg.type === 'done') {
        worker.terminate();
        resolve(msg.result as TrackAnalysis);
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      if (!heard) inline().then(resolve, reject);
      else reject(new Error(e.message || 'Analysis worker failed'));
    };
    // Send a copy; the caller keeps the original for waveform drawing.
    const copy = mono.slice();
    worker.postMessage({ mono: copy, sampleRate }, [copy.buffer]);
  });
}

/** Linear interpolated read of a per-frame envelope (frames are centred at (f + 0.5) / fps). */
export function readEnv(arr: Float32Array, fps: number, t: number): number {
  const f = t * fps - 0.5;
  if (f <= 0) return arr[0] ?? 0;
  const i = Math.floor(f);
  if (i >= arr.length - 1) return arr[arr.length - 1] ?? 0;
  const fr = f - i;
  return arr[i] * (1 - fr) + arr[i + 1] * fr;
}

export function readBands(an: TrackAnalysis, t: number, out: Float32Array): void {
  const f = t * an.fps - 0.5;
  const i = Math.max(0, Math.min(an.frames - 1, Math.floor(f)));
  const j = Math.min(an.frames - 1, i + 1);
  const fr = Math.min(1, Math.max(0, f - i));
  for (let b = 0; b < BAND_COUNT; b++) out[b] = an.bands[i * BAND_COUNT + b] * (1 - fr) + an.bands[j * BAND_COUNT + b] * fr;
}

export interface Highlight {
  start: number;
  score: number;
}

/**
 * Up to `count` non-overlapping windows of `duration` with the most energy
 * (biased toward low end), snapped to beats if any.
 */
export function findHighlights(an: TrackAnalysis, duration: number, beats: Float32Array, count = 3): Highlight[] {
  const fps = an.fps;
  const win = Math.max(1, Math.round(duration * fps));
  if (win >= an.frames) return [{ start: 0, score: 1 }];
  const e = new Float64Array(an.frames + 1);
  for (let f = 0; f < an.frames; f++) e[f + 1] = e[f] + an.level[f] * 0.6 + an.low[f] * 0.4;
  const step = Math.max(1, Math.round(fps * 0.25));
  const cands: Highlight[] = [];
  for (let f = 0; f + win <= an.frames; f += step) cands.push({ start: f / fps, score: (e[f + win] - e[f]) / win });
  cands.sort((a, b) => b.score - a.score);
  const out: Highlight[] = [];
  for (const c of cands) {
    if (out.every((o) => Math.abs(o.start - c.start) >= duration * 0.8)) {
      out.push({ start: snapToBeat(c.start, beats, 0.6), score: c.score });
      if (out.length >= count) break;
    }
  }
  return out;
}

export function snapToBeat(t: number, beats: Float32Array, maxDist = 0.35): number {
  if (!beats.length) return t;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (beats[m] < t) lo = m + 1;
    else hi = m;
  }
  let best = beats[lo];
  if (lo > 0 && Math.abs(beats[lo - 1] - t) < Math.abs(best - t)) best = beats[lo - 1];
  return Math.abs(best - t) <= maxDist ? best : t;
}

/** Index of the first beat with time > t. */
export function beatIndexAfter(beats: Float32Array, t: number): number {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (beats[m] <= t) lo = m + 1;
    else hi = m;
  }
  return lo;
}
