import type { AudioSettings, BeatSettings } from '../state/project';
import { BAND_CENTRES, BAND_COUNT, RANGE_HIGH, RANGE_LOW, RANGE_MID, bandsInRange } from './bands';
import { beatIndexAfter, readBands, readEnv, type TrackAnalysis } from './analysis';
import { onsetDelta } from './beats';
import { applyFilterbank, bandsDb, fineRange, makeBandMap, makeFilterbank } from './dsp';

export const WAVE_SIZE = 256;

/** Instantaneous, un-smoothed analysis values. */
export interface RawFrame {
  low: number;
  mid: number;
  high: number;
  level: number;
  bands: Float32Array;
  wave: Float32Array;
}

export function makeRaw(): RawFrame {
  return { low: 0, mid: 0, high: 0, level: 0, bands: new Float32Array(BAND_COUNT), wave: new Float32Array(WAVE_SIZE) };
}

/** Smoothed values consumed by the renderer. */
export interface Features {
  low: number;
  mid: number;
  high: number;
  level: number;
  /** 1 on a beat, decaying to 0. */
  beat: number;
  beatCount: number;
  beatNow: boolean;
  barNow: boolean;
  /** 0 → 1 across the clip (the "time effector"). */
  time: number;
  /** Slow 0..1 oscillation locked to two bars of the tempo. */
  wave: number;
  spectrum: Float32Array;
  /** Waveform samples around the current time. */
  samples: Float32Array;
}

export function makeFeatures(): Features {
  return {
    low: 0,
    mid: 0,
    high: 0,
    level: 0,
    beat: 0,
    beatCount: 0,
    beatNow: false,
    barNow: false,
    time: 0,
    wave: 0,
    spectrum: new Float32Array(BAND_COUNT),
    samples: new Float32Array(WAVE_SIZE),
  };
}

export interface FeatureSource {
  readonly kind: 'file' | 'live';
  /** Fill `raw` for song time t; returns number of beats in (t0, t1]. */
  sample(t0: number, t1: number, raw: RawFrame): number;
}

/** Envelope follower turning raw frames into renderer features. */
export class FeatureFollower {
  f: Features = makeFeatures();
  private beatAge = 10;

  reset(): void {
    this.f = makeFeatures();
    this.beatAge = 10;
  }

  step(dt: number, raw: RawFrame, beats: number, a: AudioSettings): Features {
    const f = this.f;
    const env = (prev: number, x: number, att: number, rel: number) => {
      const tau = x > prev ? att : rel;
      return prev + (x - prev) * (1 - Math.exp(-dt / Math.max(0.004, tau)));
    };
    // Reactivity is the master for everything that follows loudness: emitters,
    // spectrum shapes and every drive. Beat triggers themselves don't depend on it.
    const r = a.reactivity;
    f.low = env(f.low, raw.low * a.low * r, a.attack, a.release);
    f.mid = env(f.mid, raw.mid * a.mid * r, a.attack, a.release);
    f.high = env(f.high, raw.high * a.high * r, a.attack, a.release * 0.7);
    f.level = env(f.level, raw.level * r, a.attack, a.release);
    for (let b = 0; b < BAND_COUNT; b++) {
      const g = (BAND_CENTRES[b] < RANGE_LOW[1] ? a.low : BAND_CENTRES[b] < RANGE_MID[1] ? a.mid : a.high) * r;
      f.spectrum[b] = env(f.spectrum[b], raw.bands[b] * g, a.attack * 0.5, a.release * 0.6);
    }
    f.samples.set(raw.wave);
    f.beatNow = beats > 0;
    f.barNow = false;
    if (beats > 0) {
      for (let i = 0; i < beats; i++) {
        f.beatCount++;
        if (f.beatCount % 4 === 1) f.barNow = true;
      }
      this.beatAge = 0;
    } else this.beatAge += dt;
    f.beat = Math.exp(-this.beatAge / 0.17);
    return f;
  }
}

/** Features read from a pre-analysed, decoded track. Deterministic. */
export class FileFeed implements FeatureSource {
  readonly kind = 'file';
  constructor(
    public an: TrackAnalysis,
    public mono: Float32Array,
    public sampleRate: number,
    public beats: Float32Array,
  ) {}

  sample(t0: number, t1: number, raw: RawFrame): number {
    const an = this.an;
    const t = Math.max(0, t1);
    raw.low = readEnv(an.low, an.fps, t);
    raw.mid = readEnv(an.mid, an.fps, t);
    raw.high = readEnv(an.high, an.fps, t);
    raw.level = readEnv(an.level, an.fps, t);
    readBands(an, t, raw.bands);
    const centre = Math.floor(t * this.sampleRate);
    const span = 4;
    const start = centre - (WAVE_SIZE * span) / 2;
    // Average each span rather than picking one sample, so highs don't alias into hiss.
    for (let i = 0; i < WAVE_SIZE; i++) {
      const idx = start + i * span;
      let v = 0;
      for (let k = 0; k < span; k++) {
        const j = idx + k;
        if (j >= 0 && j < this.mono.length) v += this.mono[j];
      }
      raw.wave[i] = v / span;
    }
    if (t1 <= t0) return 0;
    return Math.max(0, beatIndexAfter(this.beats, t1) - beatIndexAfter(this.beats, t0));
  }
}

/** Where live frames come from: the analysis worklet (preferred) or an AnalyserNode. */
export type LiveSource = { kind: 'worklet'; port: MessagePort } | { kind: 'analyser'; analyser: AnalyserNode };

interface LiveFrame {
  bands: Float32Array;
  fine: Float32Array;
  wave: Float32Array;
  levelDb: number;
}

/**
 * Real-time features for mic, tab or system audio. Uses the same filterbanks,
 * SuperFlux onset strength and peak picking as the offline analysis, with a
 * 3-frame lookahead (~32 ms) so peaks are confirmed before a beat fires.
 */
export class LiveFeed implements FeatureSource {
  readonly kind = 'live';
  beatSettings: BeatSettings;
  /** Latest input level in dBFS (diagnostics: tells silence from a broken capture). */
  levelDb = -120;
  private queue: LiveFrame[] = [];
  private centres: Float32Array | null = null;
  private hopSec = 1 / 60;
  private ceil = new Float32Array(BAND_COUNT).fill(-60);
  private levelCeil = -40;
  private envPeak = { low: 0.4, mid: 0.4, high: 0.4 };
  private prevFine: Float32Array | null = null;
  private odf: number[] = [];
  private peakVals: { v: number; t: number }[] = [];
  private frameNo = 0;
  private lastBeatFrame = -1e9;
  private lastBeatV = 0;
  private cached: RawFrame = makeRaw();
  private pendingBeats = 0;
  private analyserBuf: Float32Array<ArrayBuffer> | null = null;
  private analyserTime: Float32Array<ArrayBuffer> | null = null;
  private fb: ReturnType<typeof makeFilterbank> | null = null;
  private map: ReturnType<typeof makeBandMap> | null = null;
  private mag: Float32Array | null = null;
  private lastPoll = 0;

  constructor(
    readonly source: LiveSource,
    beat: BeatSettings,
  ) {
    this.beatSettings = beat;
    if (source.kind === 'worklet') {
      source.port.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.type === 'init') {
          this.centres = m.centres;
          this.hopSec = m.hopSec;
        } else if (m.type === 'frame') {
          this.queue.push(m as LiveFrame);
          if (this.queue.length > 64) this.queue.shift();
        }
      };
    } else {
      const an = source.analyser;
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0;
      an.minDecibels = -120;
      an.maxDecibels = 0;
      this.analyserBuf = new Float32Array(an.frequencyBinCount);
      this.analyserTime = new Float32Array(an.fftSize);
      this.fb = makeFilterbank(an.context.sampleRate, an.fftSize);
      this.map = makeBandMap(an.context.sampleRate, an.fftSize);
      this.mag = new Float32Array(an.frequencyBinCount + 1);
      this.centres = this.fb.centres;
    }
  }

  /** Drain new analysis frames; call once per animation frame. */
  poll(now: number): void {
    if (this.source.kind === 'analyser') {
      const dt = Math.min(0.1, Math.max(0.005, (now - this.lastPoll) / 1000 || 1 / 60));
      this.lastPoll = now;
      this.hopSec = dt;
      const an = this.source.analyser;
      an.getFloatFrequencyData(this.analyserBuf!);
      an.getFloatTimeDomainData(this.analyserTime!);
      const mag = this.mag!;
      for (let k = 0; k < this.analyserBuf!.length; k++) mag[k] = Math.pow(10, this.analyserBuf![k] / 20) * 2;
      const bands = new Float32Array(BAND_COUNT);
      const fine = new Float32Array(this.fb!.count);
      bandsDb(this.map!, mag, bands);
      applyFilterbank(this.fb!, mag, fine);
      const t = this.analyserTime!;
      let sq = 0;
      for (let i = 0; i < t.length; i++) sq += t[i] * t[i];
      const wave = new Float32Array(WAVE_SIZE);
      const span = Math.floor(t.length / WAVE_SIZE / 2);
      const off = t.length / 2 - (WAVE_SIZE * span) / 2;
      for (let i = 0; i < WAVE_SIZE; i++) {
        let v = 0;
        for (let k = 0; k < span; k++) v += t[off + i * span + k];
        wave[i] = v / Math.max(1, span);
      }
      this.ingest({ bands, fine, wave, levelDb: 10 * Math.log10(sq / t.length + 1e-12) });
      return;
    }
    for (const fr of this.queue.splice(0)) this.ingest(fr);
  }

  private ingest(fr: LiveFrame): void {
    const dt = this.hopSec;
    const raw = this.cached;
    for (let b = 0; b < BAND_COUNT; b++) {
      let db = fr.bands[b];
      if (!isFinite(db)) db = -120;
      this.ceil[b] = Math.max(db, this.ceil[b] - 4 * dt, -75);
      raw.bands[b] = Math.min(1.25, Math.max(0, 1 + (db - this.ceil[b]) / 42));
    }
    const envOf = (range: [number, number], key: 'low' | 'mid' | 'high') => {
      const idx = bandsInRange(range[0], range[1]);
      let a = 0;
      for (const b of idx) a += raw.bands[b];
      a /= idx.length;
      this.envPeak[key] = Math.max(a, this.envPeak[key] * Math.exp(-dt / 6), 0.25);
      return Math.min(1.25, a / this.envPeak[key]);
    };
    raw.low = envOf(RANGE_LOW, 'low');
    raw.mid = envOf(RANGE_MID, 'mid');
    raw.high = envOf(RANGE_HIGH, 'high');
    this.levelDb = fr.levelDb;
    this.levelCeil = Math.max(fr.levelDb, this.levelCeil - 3 * dt, -60);
    raw.level = fr.levelDb < -80 ? 0 : Math.min(1.25, Math.max(0, 1 + (fr.levelDb - this.levelCeil) / 30));
    raw.wave.set(fr.wave);
    this.onset(fr.fine);
  }

  private onset(fine: Float32Array): void {
    const n = this.frameNo++;
    const prev = this.prevFine;
    this.prevFine = fine;
    if (!prev || !this.centres) {
      this.odf.push(0);
      return;
    }
    const bs = this.beatSettings;
    const [b0, b1] = fineRange(this.centres, bs.lo, bs.hi);
    const flux = (lo: number, hi: number) => {
      let acc = 0;
      for (let b = lo; b <= hi; b++) {
        const p0 = prev[b];
        const d = fine[b] - Math.max(p0, b > 0 ? prev[b - 1] : p0, b < fine.length - 1 ? prev[b + 1] : p0);
        if (d > 0) acc += d;
      }
      return acc;
    };
    const inside = flux(b0, b1) / Math.sqrt(b1 - b0 + 1);
    const outside = Math.max(b0 > 0 ? flux(0, b0 - 1) / Math.sqrt(b0) : 0, b1 < fine.length - 1 ? flux(b1 + 1, fine.length - 1) / Math.sqrt(fine.length - 1 - b1) : 0);
    const share = inside / (inside + outside * 0.6 + 1e-4);
    const v = inside * Math.pow(Math.min(1, share * 1.6), 0.8);
    this.odf.push(v);
    if (this.odf.length > 256) this.odf.shift();

    // Typical hit size: median of the strongest recent peaks (≈1.5 per second over 8 s).
    const L = 3;
    const h = this.odf;
    const c = h.length - 1 - L;
    if (c < 1) return;
    const cv = h[c];
    const isLocalMax = cv > 0 && cv >= h[c - 1] && cv > h[c + 1];
    const now = n * this.hopSec;
    if (isLocalMax) {
      this.peakVals.push({ v: cv, t: now });
      while (this.peakVals.length && now - this.peakVals[0].t > 8) this.peakVals.shift();
    }
    const top = this.peakVals.map((p) => p.v).sort((a, b) => b - a);
    const k = Math.max(4, Math.round(8 * 1.5));
    const slice = top.slice(0, Math.min(top.length, k));
    const scale = Math.max(1e-3, slice.length ? slice[Math.floor(slice.length / 2)] : 1);
    if (!isLocalMax) return;
    const fps = 1 / this.hopSec;
    const preMax = Math.max(1, Math.round(0.035 * fps));
    for (let j = Math.max(0, c - preMax); j <= Math.min(h.length - 1, c + L); j++) if (h[j] > cv) return;
    const preAvg = Math.round(0.1 * fps);
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, c - preAvg); j <= h.length - 1; j++) {
      sum += h[j];
      cnt++;
    }
    const norm = cv / scale;
    if (norm < 0.12) return;
    if (norm < sum / cnt / scale + onsetDelta(bs.sensitivity)) return;
    const frameC = n - L;
    const hold = (bs.hold / 1000) * fps;
    if (frameC - this.lastBeatFrame < hold) {
      // Within the minimum gap only a stronger peak may replace the last one;
      // it has already fired, so just remember the stronger level.
      this.lastBeatV = Math.max(this.lastBeatV, norm);
      return;
    }
    this.lastBeatFrame = frameC;
    this.lastBeatV = norm;
    this.pendingBeats++;
  }

  sample(_t0: number, _t1: number, raw: RawFrame): number {
    raw.low = this.cached.low;
    raw.mid = this.cached.mid;
    raw.high = this.cached.high;
    raw.level = this.cached.level;
    raw.bands.set(this.cached.bands);
    raw.wave.set(this.cached.wave);
    const b = this.pendingBeats;
    this.pendingBeats = 0;
    return b;
  }
}
