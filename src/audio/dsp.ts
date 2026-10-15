// DSP shared by the offline analysis worker and the live AudioWorklet, so both
// produce the same features and detect beats the same way.

import { BAND_CENTRES, BAND_COUNT, BAND_EDGES } from './bands';

/** Fine log-frequency filterbank used for onset detection (12 bands / octave). */
export interface Filterbank {
  count: number;
  /** Centre frequency of each band (Hz). */
  centres: Float32Array;
  starts: Int32Array;
  weights: Float32Array[];
}

export const FINE_MIN_HZ = 30;
export const FINE_MAX_HZ = 11000;
export const FINE_PER_OCTAVE = 12;
/** Log compression constant for the onset spectrogram. */
export const LOG_LAMBDA = 100;

/**
 * Triangular filters on a log axis. Centre frequencies that land on the same FFT
 * bin are merged, so low bands are as fine as the FFT allows and no finer.
 */
export function makeFilterbank(sampleRate: number, fftSize: number): Filterbank {
  const binHz = sampleRate / fftSize;
  const maxHz = Math.min(FINE_MAX_HZ, sampleRate * 0.47);
  const bins: number[] = [];
  const octaves = Math.log2(maxHz / FINE_MIN_HZ);
  const n = Math.ceil(octaves * FINE_PER_OCTAVE) + 2;
  for (let i = 0; i < n; i++) {
    const f = FINE_MIN_HZ * Math.pow(2, (i - 1) / FINE_PER_OCTAVE);
    const b = Math.round(f / binHz);
    if (b < 1 || b >= fftSize / 2) continue;
    if (!bins.length || bins[bins.length - 1] !== b) bins.push(b);
  }
  const count = Math.max(1, bins.length - 2);
  const centres = new Float32Array(count);
  const starts = new Int32Array(count);
  const weights: Float32Array[] = [];
  for (let k = 0; k < count; k++) {
    const lo = bins[k];
    const mid = bins[k + 1];
    const hi = bins[k + 2];
    centres[k] = mid * binHz;
    starts[k] = lo;
    const w = new Float32Array(hi - lo + 1);
    for (let b = lo; b <= hi; b++) {
      w[b - lo] = b <= mid ? (b - lo + 1) / (mid - lo + 1) : (hi - b + 1) / (hi - mid + 1);
    }
    // Normalise so wide and narrow bands are comparable.
    let s = 0;
    for (const v of w) s += v;
    for (let i = 0; i < w.length; i++) w[i] /= s;
    weights.push(w);
  }
  return { count, centres, starts, weights };
}

export function applyFilterbank(fb: Filterbank, mag: Float64Array | Float32Array, out: Float32Array, offset = 0): void {
  for (let k = 0; k < fb.count; k++) {
    const w = fb.weights[k];
    const s0 = fb.starts[k];
    let e = 0;
    for (let i = 0; i < w.length; i++) e += mag[s0 + i] * w[i];
    out[offset + k] = Math.log1p(LOG_LAMBDA * e);
  }
}

/** Precomputed bin ranges for the 32 visual bands. */
export interface BandMap {
  lo: Int32Array;
  hi: Int32Array;
  interp: Uint8Array;
  binHz: number;
  half: number;
}

export function makeBandMap(sampleRate: number, fftSize: number): BandMap {
  const binHz = sampleRate / fftSize;
  const half = fftSize / 2;
  const lo = new Int32Array(BAND_COUNT);
  const hi = new Int32Array(BAND_COUNT);
  const interp = new Uint8Array(BAND_COUNT);
  for (let b = 0; b < BAND_COUNT; b++) {
    lo[b] = Math.max(1, Math.ceil(BAND_EDGES[b] / binHz));
    hi[b] = Math.min(half, Math.floor(BAND_EDGES[b + 1] / binHz));
    interp[b] = hi[b] - lo[b] < 1 ? 1 : 0;
  }
  return { lo, hi, interp, binHz, half };
}

/** 32-band energies in dB. */
export function bandsDb(map: BandMap, mag: Float64Array | Float32Array, out: Float32Array, offset = 0): void {
  for (let b = 0; b < BAND_COUNT; b++) {
    let e: number;
    if (map.interp[b]) {
      const pos = BAND_CENTRES[b] / map.binHz;
      const k0 = Math.floor(pos);
      const fr = pos - k0;
      e = mag[k0] * (1 - fr) + mag[Math.min(map.half, k0 + 1)] * fr;
    } else {
      let acc = 0;
      for (let k = map.lo[b]; k <= map.hi[b]; k++) acc += mag[k] * mag[k];
      e = Math.sqrt(acc / (map.hi[b] - map.lo[b] + 1));
    }
    out[offset + b] = 20 * Math.log10(e + 1e-7);
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Half-band low-pass FIR for clean 2:1 decimation (windowed sinc, 31 taps). */
export function decimate2(x: Float32Array): Float32Array {
  const taps = 31;
  const h = new Float64Array(taps);
  const m = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const k = i - m;
    const sinc = k === 0 ? 0.5 : Math.sin(0.5 * Math.PI * k) / (Math.PI * k);
    const win = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    h[i] = sinc * win;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  const len = Math.floor(x.length / 2);
  const y = new Float32Array(len);
  const n = x.length;
  for (let o = 0; o < len; o++) {
    const c = o * 2;
    let acc = 0;
    // Half-band filters are zero at even offsets from the centre (except the centre).
    acc += h[m] * x[c];
    for (let k = 1; k <= m; k += 2) {
      const a = c - k;
      const b = c + k;
      acc += h[m + k] * ((a >= 0 ? x[a] : 0) + (b < n ? x[b] : 0));
    }
    y[o] = acc;
  }
  return y;
}

/**
 * SuperFlux onset strength (Böck & Widmer 2013): positive spectral difference
 * against a frequency-max-filtered previous frame, which suppresses vibrato and
 * slow sweeps so only real attacks remain.
 */
export function superflux(
  fine: Float32Array,
  frames: number,
  count: number,
  b0: number,
  b1: number,
  lag = 1,
): Float32Array {
  const out = new Float32Array(frames);
  const lo = Math.max(0, b0);
  const hi = Math.min(count - 1, b1);
  for (let f = lag; f < frames; f++) {
    const cur = f * count;
    const prev = (f - lag) * count;
    let acc = 0;
    for (let b = lo; b <= hi; b++) {
      const p0 = fine[prev + b];
      const pl = b > 0 ? fine[prev + b - 1] : p0;
      const pr = b < count - 1 ? fine[prev + b + 1] : p0;
      const d = fine[cur + b] - Math.max(p0, pl, pr);
      if (d > 0) acc += d;
    }
    out[f] = acc;
  }
  return out;
}

/** Index range of fine bands whose centres fall within [lo, hi] Hz (at least one band). */
export function fineRange(centres: Float32Array, lo: number, hi: number): [number, number] {
  let a = -1;
  let b = -1;
  for (let i = 0; i < centres.length; i++) {
    if (centres[i] >= lo && centres[i] <= hi) {
      if (a < 0) a = i;
      b = i;
    }
  }
  if (a < 0) {
    const c = Math.sqrt(lo * hi);
    let best = 0;
    for (let i = 1; i < centres.length; i++) if (Math.abs(centres[i] - c) < Math.abs(centres[best] - c)) best = i;
    a = b = best;
  }
  return [a, b];
}
