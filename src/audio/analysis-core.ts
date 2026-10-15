// Offline analysis of a whole track. Produces:
//  - 32 normalised log bands + low/mid/high/level envelopes (drive the visuals)
//  - a fine 12-bands-per-octave log spectrogram (onset detection, any frequency window)
//  - tempo, a dynamic-programming beat track and the downbeat phase
//  - a waveform overview for the song strip
// Runs in a worker, or inline as a fallback.

import { BAND_COUNT, RANGE_HIGH, RANGE_LOW, RANGE_MID, bandsInRange } from './bands';
import { FFT } from './fft';
import { applyFilterbank, bandsDb, decimate2, fineRange, hann, makeBandMap, makeFilterbank, superflux } from './dsp';

export interface AnalysisRequest {
  mono: Float32Array;
  sampleRate: number;
}

export interface AnalysisResult {
  /** Analysis frames per second. Frame f is centred at (f + 0.5) / fps seconds. */
  fps: number;
  frames: number;
  duration: number;
  bands: Float32Array;
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  level: Float32Array;
  /** Fine log spectrogram, frames × fineCount. */
  fine: Float32Array;
  fineCount: number;
  fineCentres: Float32Array;
  bpm: number;
  /** Tracked beat times (s). */
  beatTimes: Float32Array;
  /** Index (0–3) of the first downbeat within beatTimes. */
  downbeat: number;
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

function normaliseStd(x: Float32Array): Float32Array {
  let m = 0;
  for (const v of x) m += v;
  m /= Math.max(1, x.length);
  let s = 0;
  for (const v of x) s += (v - m) * (v - m);
  s = Math.sqrt(s / Math.max(1, x.length - 1)) || 1;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] / s;
  return out;
}

/** Tempo by autocorrelation with a log-normal prior around 120 BPM. */
export function estimateTempo(odf: Float32Array, fps: number): number {
  const frames = odf.length;
  const maxF = Math.min(frames, Math.round(fps * 240));
  // Remove the local mean so sustained energy doesn't dominate.
  const w = Math.round(fps * 0.4);
  const prefix = new Float64Array(maxF + 1);
  for (let f = 0; f < maxF; f++) prefix[f + 1] = prefix[f] + odf[f];
  const x = new Float32Array(maxF);
  for (let f = 0; f < maxF; f++) {
    const a = Math.max(0, f - w);
    const b = Math.min(maxF, f + w + 1);
    x[f] = Math.max(0, odf[f] - (prefix[b] - prefix[a]) / (b - a));
  }
  const lagMin = Math.floor((fps * 60) / 220);
  const lagMax = Math.ceil((fps * 60) / 50);
  const ac = new Float64Array(lagMax + 2);
  for (let L = lagMin - 1; L <= lagMax + 1; L++) {
    let acc = 0;
    for (let f = 0; f + L < maxF; f++) acc += x[f] * x[f + L];
    ac[L] = acc / Math.max(1, maxF - L);
  }
  let best = lagMin;
  let bestScore = -Infinity;
  for (let L = lagMin; L <= lagMax; L++) {
    const bpm = (60 * fps) / L;
    // Include the half-tempo peak so a strong backbeat supports the right tempo.
    const L2 = L * 2;
    const support = L2 <= lagMax + 1 ? ac[L2] * 0.5 : 0;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const s = (ac[L] + support) * prior;
    if (s > bestScore) {
      bestScore = s;
      best = L;
    }
  }
  let lag = best;
  const a = ac[best - 1];
  const b = ac[best];
  const c = ac[best + 1];
  const den = a - 2 * b + c;
  if (Math.abs(den) > 1e-12) lag = best + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
  const bpm = (60 * fps) / lag;
  return isFinite(bpm) && bpm > 0 ? Math.round(bpm * 10) / 10 : 120;
}

/**
 * Dynamic-programming beat tracker (Ellis 2007, as in librosa): find the
 * sequence of beats that best agrees with onsets while keeping a near-constant
 * period. Handles gentle tempo drift and syncopation better than a fixed grid.
 */
export function trackBeats(odf: Float32Array, fps: number, bpm: number, tightness = 100): Int32Array {
  const frames = odf.length;
  if (frames < 4) return new Int32Array(0);
  const period = (60 * fps) / bpm;
  const onset = normaliseStd(odf);
  // Local score: onsets smoothed with a narrow Gaussian.
  const K = Math.round(period);
  const win = new Float32Array(2 * K + 1);
  for (let k = -K; k <= K; k++) win[k + K] = Math.exp(-0.5 * ((k * 32) / period) ** 2);
  const local = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    for (let k = -K; k <= K; k++) {
      const i = f + k;
      if (i >= 0 && i < frames) acc += onset[i] * win[k + K];
    }
    local[f] = acc;
  }
  let maxLocal = 0;
  for (const v of local) maxLocal = Math.max(maxLocal, v);
  const thresh = 0.01 * maxLocal;

  const wStart = -Math.round(2 * period);
  const wEnd = -Math.round(period / 2);
  const txwt = new Float64Array(wEnd - wStart + 1);
  for (let o = wStart; o <= wEnd; o++) txwt[o - wStart] = -tightness * Math.log(-o / period) ** 2;

  const cum = new Float64Array(frames);
  const back = new Int32Array(frames).fill(-1);
  let first = true;
  for (let i = 0; i < frames; i++) {
    let bestV = -Infinity;
    let bestP = -1;
    for (let o = wStart; o <= wEnd; o++) {
      const p = i + o;
      const v = txwt[o - wStart] + (p >= 0 ? cum[p] : 0);
      if (v > bestV) {
        bestV = v;
        bestP = p;
      }
    }
    cum[i] = local[i] + bestV;
    if (first && local[i] < thresh) back[i] = -1;
    else {
      back[i] = bestP;
      first = false;
    }
  }

  // Last beat: the last local maximum of the cumulative score above half the median maximum.
  const maxima: number[] = [];
  for (let i = 1; i < frames - 1; i++) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) maxima.push(cum[i]);
  maxima.sort((x, y) => x - y);
  const med = maxima.length ? maxima[Math.floor(maxima.length / 2)] : 0;
  let last = frames - 1;
  for (let i = frames - 2; i > 0; i--) {
    if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1] && cum[i] * 2 > med) {
      last = i;
      break;
    }
  }
  const beats: number[] = [last];
  while (back[beats[beats.length - 1]] >= 0) beats.push(back[beats[beats.length - 1]]);
  beats.reverse();

  // Trim weak beats at the start and end (silence, fade-outs).
  const strength = beats.map((b) => local[b]);
  const sm = strength.map((_, i) => {
    let a = 0;
    let wsum = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j < 0 || j >= strength.length) continue;
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 3)) / 6);
      a += strength[j] * w;
      wsum += w;
    }
    return a / (wsum || 1);
  });
  const rmsS = Math.sqrt(sm.reduce((s, v) => s + v * v, 0) / Math.max(1, sm.length));
  let i0 = 0;
  let i1 = beats.length - 1;
  while (i0 < i1 && sm[i0] <= 0.5 * rmsS) i0++;
  while (i1 > i0 && sm[i1] <= 0.5 * rmsS) i1--;
  return Int32Array.from(beats.slice(i0, i1 + 1));
}

/** Parabolic peak position around frame f (returns f + fractional offset). */
export function refinePeak(x: Float32Array, f: number): number {
  if (f <= 0 || f >= x.length - 1) return f;
  const a = x[f - 1];
  const b = x[f];
  const c = x[f + 1];
  const den = a - 2 * b + c;
  if (Math.abs(den) < 1e-12) return f;
  return f + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
}

export function analyse(req: AnalysisRequest, progress: (v: number) => void): AnalysisResult {
  const { mono, sampleRate } = req;
  const x = sampleRate > 30000 ? decimate2(mono) : mono;
  const sr = sampleRate > 30000 ? sampleRate / 2 : sampleRate;
  const len = x.length;
  progress(0.03);

  const fps = sr / HOP;
  const frames = Math.max(1, Math.floor(len / HOP));
  const fft = new FFT(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const win = hann(N);
  const mag = new Float64Array(N / 2 + 1);
  const map = makeBandMap(sr, N);
  const fb = makeFilterbank(sr, N);

  const bandsDbArr = new Float32Array(frames * BAND_COUNT);
  const fine = new Float32Array(frames * fb.count);
  const levelDb = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    // Frame f is centred on sample f * HOP + HOP / 2.
    const start = f * HOP - N / 2 + HOP / 2;
    for (let i = 0; i < N; i++) {
      const idx = start + i;
      re[i] = (idx >= 0 && idx < len ? x[idx] : 0) * win[i];
      im[i] = 0;
    }
    let sumSq = 0;
    for (let i = 0; i < HOP; i++) {
      const v = x[f * HOP + i] ?? 0;
      sumSq += v * v;
    }
    fft.transform(re, im);
    for (let k = 0; k <= N / 2; k++) mag[k] = Math.hypot(re[k], im[k]) / (N / 4);
    bandsDb(map, mag, bandsDbArr, f * BAND_COUNT);
    applyFilterbank(fb, mag, fine, f * fb.count);
    levelDb[f] = 10 * Math.log10(sumSq / HOP + 1e-12);
    if ((f & 1023) === 0) progress(0.03 + (0.77 * f) / frames);
  }

  // Normalise each band in dB relative to its own loud percentile.
  const RANGE = 42;
  const bands = new Float32Array(frames * BAND_COUNT);
  const col = new Float32Array(frames);
  for (let b = 0; b < BAND_COUNT; b++) {
    for (let f = 0; f < frames; f++) col[f] = bandsDbArr[f * BAND_COUNT + b];
    const ceil = percentile(col, 0.985);
    for (let f = 0; f < frames; f++) bands[f * BAND_COUNT + b] = Math.min(1.25, Math.max(0, 1 + (col[f] - ceil) / RANGE));
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
  progress(0.85);

  // Onset strength for tempo and beat tracking: full-band SuperFlux, with a
  // separate low-band curve for finding downbeats.
  // Low (kick) and mid (snare) attacks define the beat for most listeners, so
  // weight them above highs, which often sit on off-beats.
  const [l0, l1] = fineRange(fb.centres, 30, 180);
  const [m0, m1] = fineRange(fb.centres, 180, 3000);
  const [h0, h1] = fineRange(fb.centres, 3000, 11000);
  const odfLow = superflux(fine, frames, fb.count, l0, l1);
  const odfMid = normaliseStd(superflux(fine, frames, fb.count, m0, m1));
  const odfHigh = normaliseStd(superflux(fine, frames, fb.count, h0, h1));
  const odfLowN = normaliseStd(odfLow);
  const odf = new Float32Array(frames);
  for (let f = 0; f < frames; f++) odf[f] = 1.0 * odfLowN[f] + 0.6 * odfMid[f] + 0.25 * odfHigh[f];
  const bpm = estimateTempo(odf, fps);
  progress(0.9);
  const beatFrames = trackBeats(odf, fps, bpm);
  const beatTimes = new Float32Array(beatFrames.length);
  for (let i = 0; i < beatFrames.length; i++) {
    // Snap to the strongest nearby onset and refine below frame resolution.
    let f = beatFrames[i];
    for (let k = -2; k <= 2; k++) {
      const j = beatFrames[i] + k;
      if (j > 0 && j < frames && odf[j] > odf[f]) f = j;
    }
    beatTimes[i] = (refinePeak(odf, f) + 0.5) / fps;
  }
  // Downbeat phase: the beat position (of 4) with the most low-end attack and bass energy.
  let downbeat = 0;
  if (beatFrames.length >= 8) {
    let bestS = -Infinity;
    for (let k = 0; k < 4; k++) {
      let s = 0;
      let n = 0;
      for (let i = k; i < beatFrames.length; i += 4) {
        const f = beatFrames[i];
        let m = 0;
        for (let d = -1; d <= 1; d++) m = Math.max(m, odfLow[f + d] ?? 0);
        s += m + 0.5 * low[f];
        n++;
      }
      s /= Math.max(1, n);
      if (s > bestS) {
        bestS = s;
        downbeat = k;
      }
    }
  }
  progress(0.95);

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
    fine,
    fineCount: fb.count,
    fineCentres: fb.centres,
    bpm,
    beatTimes,
    downbeat,
    peaks,
    rms,
  };
}
