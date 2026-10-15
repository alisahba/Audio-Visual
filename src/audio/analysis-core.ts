// Offline analysis of a whole track: log-band spectrogram, envelopes,
// tempo/phase estimate and waveform overview. Runs in a worker (or inline as a fallback).

import { BAND_CENTRES, BAND_COUNT, BAND_EDGES, RANGE_HIGH, RANGE_LOW, RANGE_MID, bandsInRange } from './bands';
import { FFT } from './fft';

export interface AnalysisRequest {
  mono: Float32Array;
  sampleRate: number;
}

export interface AnalysisResult {
  fps: number;
  frames: number;
  duration: number;
  bands: Float32Array;
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  level: Float32Array;
  bpm: number;
  phase: number;
  peaks: Float32Array;
  rms: Float32Array;
}

const N = 1024;
const HOP = 256;
const OVERVIEW = 2400;

function percentile(values: Float32Array, q: number): number {
  const sorted = Float32Array.from(values).sort();
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

export function analyse(req: AnalysisRequest, progress: (v: number) => void): AnalysisResult {
  const { mono, sampleRate } = req;
  const dec = sampleRate > 30000 ? 2 : 1;
  const sr = sampleRate / dec;
  const len = Math.floor(mono.length / dec);
  const x = new Float32Array(len);
  if (dec === 2) {
    for (let i = 0; i < len; i++) {
      const j = i * 2;
      x[i] = 0.25 * (mono[j - 1] ?? 0) + 0.5 * mono[j] + 0.25 * (mono[j + 1] ?? 0);
    }
  } else x.set(mono.subarray(0, len));

  const fps = sr / HOP;
  const frames = Math.max(1, Math.floor(len / HOP));
  const fft = new FFT(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const binHz = sr / N;
  const mag = new Float64Array(N / 2 + 1);

  // Precompute band bin ranges.
  const bandLo: number[] = [];
  const bandHi: number[] = [];
  const bandInterp: boolean[] = [];
  for (let b = 0; b < BAND_COUNT; b++) {
    const lo = Math.ceil(BAND_EDGES[b] / binHz);
    const hi = Math.min(N / 2, Math.floor(BAND_EDGES[b + 1] / binHz));
    bandLo.push(lo);
    bandHi.push(hi);
    bandInterp.push(hi - lo < 1);
  }

  const bandsDb = new Float32Array(frames * BAND_COUNT);
  const levelDb = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    const start = f * HOP - N / 2 + HOP / 2;
    let sumSq = 0;
    for (let i = 0; i < N; i++) {
      const idx = start + i;
      const v = idx >= 0 && idx < len ? x[idx] : 0;
      re[i] = v * win[i];
      im[i] = 0;
    }
    for (let i = 0; i < HOP; i++) {
      const v = x[f * HOP + i] ?? 0;
      sumSq += v * v;
    }
    fft.transform(re, im);
    for (let k = 0; k <= N / 2; k++) mag[k] = Math.hypot(re[k], im[k]) / (N / 4);
    for (let b = 0; b < BAND_COUNT; b++) {
      let e: number;
      if (bandInterp[b]) {
        const pos = BAND_CENTRES[b] / binHz;
        const k0 = Math.floor(pos);
        const fr = pos - k0;
        e = mag[k0] * (1 - fr) + mag[Math.min(N / 2, k0 + 1)] * fr;
      } else {
        let acc = 0;
        for (let k = bandLo[b]; k <= bandHi[b]; k++) acc += mag[k] * mag[k];
        e = Math.sqrt(acc / (bandHi[b] - bandLo[b] + 1));
      }
      bandsDb[f * BAND_COUNT + b] = 20 * Math.log10(e + 1e-7);
    }
    levelDb[f] = 10 * Math.log10(sumSq / HOP + 1e-12);
    if ((f & 1023) === 0) progress((0.85 * f) / frames);
  }

  // Normalise each band in dB relative to its own loud percentile.
  const RANGE = 42;
  const bands = new Float32Array(frames * BAND_COUNT);
  const col = new Float32Array(frames);
  for (let b = 0; b < BAND_COUNT; b++) {
    for (let f = 0; f < frames; f++) col[f] = bandsDb[f * BAND_COUNT + b];
    const ceil = percentile(col, 0.985);
    for (let f = 0; f < frames; f++) {
      const v = 1 + (col[f] - ceil) / RANGE;
      bands[f * BAND_COUNT + b] = Math.min(1.25, Math.max(0, v));
    }
  }

  const envelope = (range: [number, number]): Float32Array => {
    const idx = bandsInRange(range[0], range[1]);
    const out = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let a = 0;
      for (const b of idx) a += bands[f * BAND_COUNT + b];
      out[f] = a / idx.length;
    }
    const p = percentile(out, 0.98) || 1;
    const floor = percentile(out, 0.1);
    for (let f = 0; f < frames; f++) out[f] = Math.min(1.25, Math.max(0, (out[f] - floor) / Math.max(1e-3, p - floor)));
    return out;
  };
  const low = envelope(RANGE_LOW);
  const mid = envelope(RANGE_MID);
  const high = envelope(RANGE_HIGH);

  const level = new Float32Array(frames);
  {
    const ceil = percentile(levelDb, 0.985);
    for (let f = 0; f < frames; f++) level[f] = Math.min(1.25, Math.max(0, 1 + (levelDb[f] - ceil) / 30));
  }
  progress(0.9);

  // Tempo: autocorrelation of an onset novelty curve.
  const nov = new Float32Array(frames);
  const novLow = new Float32Array(frames);
  const lowIdx = bandsInRange(40, 160);
  for (let f = 1; f < frames; f++) {
    let a = 0;
    for (let b = 0; b < BAND_COUNT; b++) {
      const d = bands[f * BAND_COUNT + b] - bands[(f - 1) * BAND_COUNT + b];
      if (d > 0) a += d * (b < 20 ? 1.5 : 1);
    }
    nov[f] = a;
    let l = 0;
    for (const b of lowIdx) {
      const d = bands[f * BAND_COUNT + b] - bands[(f - 1) * BAND_COUNT + b];
      if (d > 0) l += d;
    }
    novLow[f] = l;
  }
  // Subtract a centred moving average so only sharp onsets remain.
  const hp = (src: Float32Array): Float32Array => {
    const w = Math.round(fps * 0.5);
    const prefix = new Float64Array(frames + 1);
    for (let f = 0; f < frames; f++) prefix[f + 1] = prefix[f] + src[f];
    const out = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      const a = Math.max(0, f - w);
      const b = Math.min(frames, f + w + 1);
      out[f] = Math.max(0, src[f] - (prefix[b] - prefix[a]) / (b - a));
    }
    return out;
  };
  const novH = hp(nov);
  const novLowH = hp(novLow);

  const maxF = Math.min(frames, Math.round(fps * 180));
  const lagMin = Math.floor((fps * 60) / 200);
  const lagMax = Math.ceil((fps * 60) / 60);
  const scores = new Float32Array(lagMax + 2);
  for (let L = lagMin; L <= lagMax; L++) {
    let acc = 0;
    for (let f = 0; f + L < maxF; f++) acc += novH[f] * novH[f + L];
    scores[L] = acc / Math.max(1, maxF - L);
  }
  let best = lagMin;
  let bestScore = -1;
  for (let L = lagMin; L <= lagMax; L++) {
    const bpm = (60 * fps) / L;
    const w = Math.exp(-0.5 * (Math.log2(bpm / 122) / 0.75) ** 2);
    const s = scores[L] * w;
    if (s > bestScore) {
      bestScore = s;
      best = L;
    }
  }
  let lag = best;
  if (best > lagMin && best < lagMax) {
    const a = scores[best - 1];
    const b = scores[best];
    const c = scores[best + 1];
    const den = a - 2 * b + c;
    if (Math.abs(den) > 1e-9) lag = best + (0.5 * (a - c)) / den;
  }
  let bpm = (60 * fps) / lag;
  if (!isFinite(bpm) || bpm <= 0) bpm = 120;
  bpm = Math.round(bpm * 10) / 10;

  const period = (60 * fps) / bpm;
  let bestPhase = 0;
  let bestPhaseScore = -1;
  const phaseSrc = novLowH.some((v) => v > 0) ? novLowH : novH;
  for (let ph = 0; ph < period; ph += 0.5) {
    let acc = 0;
    for (let t = ph; t < frames; t += period) {
      const i = Math.round(t);
      acc += phaseSrc[i] ?? 0;
    }
    if (acc > bestPhaseScore) {
      bestPhaseScore = acc;
      bestPhase = ph;
    }
  }

  // Waveform overview.
  const peaks = new Float32Array(OVERVIEW * 2);
  const rms = new Float32Array(OVERVIEW);
  const per = len / OVERVIEW;
  for (let i = 0; i < OVERVIEW; i++) {
    const a = Math.floor(i * per);
    const b = Math.max(a + 1, Math.floor((i + 1) * per));
    let mn = 0;
    let mx = 0;
    let sq = 0;
    for (let j = a; j < b && j < len; j++) {
      const v = x[j];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      sq += v * v;
    }
    peaks[i * 2] = mn;
    peaks[i * 2 + 1] = mx;
    rms[i] = Math.sqrt(sq / Math.max(1, b - a));
  }
  progress(1);

  return {
    fps,
    frames,
    duration: mono.length / sampleRate,
    bands,
    low,
    mid,
    high,
    level,
    bpm,
    phase: bestPhase / fps,
    peaks,
    rms,
  };
}

