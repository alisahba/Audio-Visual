import type { BeatSettings } from '../state/project';
import { BAND_COUNT, bandsInRange } from './bands';
import { analyse, type AnalysisResult } from './analysis-core';
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

/** Onset novelty for a frequency window, normalised so its 95th percentile ≈ 1. */
export function noveltyCurve(an: TrackAnalysis, lo: number, hi: number): Float32Array {
  const idx = bandsInRange(lo, hi);
  const n = new Float32Array(an.frames);
  const B = an.bands;
  for (let f = 1; f < an.frames; f++) {
    let a = 0;
    for (const b of idx) {
      const cur = B[f * BAND_COUNT + b];
      const prev = Math.max(B[(f - 1) * BAND_COUNT + b], f > 1 ? B[(f - 2) * BAND_COUNT + b] * 0.9 : 0);
      const d = cur - prev;
      if (d > 0) a += d;
    }
    n[f] = a / Math.sqrt(idx.length);
  }
  // light smoothing
  const s = new Float32Array(an.frames);
  for (let f = 0; f < an.frames; f++) s[f] = 0.25 * (n[f - 1] ?? n[f]) + 0.5 * n[f] + 0.25 * (n[f + 1] ?? n[f]);
  const sorted = Float32Array.from(s).sort();
  const p = sorted[Math.floor(sorted.length * 0.95)] || 1;
  for (let f = 0; f < an.frames; f++) s[f] /= p;
  return s;
}

/** Beat times (s) for the whole track according to the beat settings. */
export function detectBeats(an: TrackAnalysis, bs: BeatSettings): Float32Array {
  if (bs.mode === 'grid') {
    const period = 60 / an.bpm / Math.max(0.25, bs.division);
    const out: number[] = [];
    let t0 = an.phase;
    // When thinning to bars, start on the strongest downbeat candidate.
    while (t0 - period >= 0) t0 -= period;
    for (let t = t0; t < an.duration; t += period) out.push(t);
    return Float32Array.from(out);
  }
  const nov = noveltyCurve(an, bs.lo, bs.hi);
  const fps = an.fps;
  const W = Math.max(2, Math.round(fps * 0.4));
  const prefix = new Float64Array(an.frames + 1);
  for (let f = 0; f < an.frames; f++) prefix[f + 1] = prefix[f] + nov[f];
  const s = Math.min(1, Math.max(0, bs.sensitivity));
  const k = 2.3 - 1.25 * s;
  const delta = 0.35 - 0.3 * s;
  const holdFrames = (bs.hold / 1000) * fps;
  const out: number[] = [];
  let last = -1e9;
  for (let f = 2; f < an.frames - 2; f++) {
    const v = nov[f];
    if (v < nov[f - 1] || v < nov[f + 1] || v < nov[f - 2] || v < nov[f + 2]) continue;
    const a = Math.max(0, f - W);
    const b = Math.min(an.frames, f + W + 1);
    const mean = (prefix[b] - prefix[a]) / (b - a);
    if (v > mean * k + delta && f - last >= holdFrames) {
      out.push(f / fps);
      last = f;
    }
  }
  return Float32Array.from(out);
}

/** Linear interpolated read of a per-frame envelope. */
export function readEnv(arr: Float32Array, fps: number, t: number): number {
  const f = t * fps;
  if (f <= 0) return arr[0] ?? 0;
  const i = Math.floor(f);
  if (i >= arr.length - 1) return arr[arr.length - 1] ?? 0;
  const fr = f - i;
  return arr[i] * (1 - fr) + arr[i + 1] * fr;
}

export function readBands(an: TrackAnalysis, t: number, out: Float32Array): void {
  const f = t * an.fps;
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
