import type { AudioSettings, BeatSettings } from '../state/project';
import { BAND_CENTRES, BAND_COUNT, BAND_EDGES, RANGE_HIGH, RANGE_LOW, RANGE_MID, bandsInRange } from './bands';
import { beatIndexAfter, readBands, readEnv, type TrackAnalysis } from './analysis';

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
    f.low = env(f.low, raw.low * a.low, a.attack, a.release);
    f.mid = env(f.mid, raw.mid * a.mid, a.attack, a.release);
    f.high = env(f.high, raw.high * a.high, a.attack, a.release * 0.7);
    f.level = env(f.level, raw.level, a.attack, a.release);
    for (let b = 0; b < BAND_COUNT; b++) {
      const g = BAND_CENTRES[b] < RANGE_LOW[1] ? a.low : BAND_CENTRES[b] < RANGE_MID[1] ? a.mid : a.high;
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
    for (let i = 0; i < WAVE_SIZE; i++) {
      const idx = start + i * span;
      raw.wave[i] = idx >= 0 && idx < this.mono.length ? this.mono[idx] : 0;
    }
    if (t1 <= t0) return 0;
    return Math.max(0, beatIndexAfter(this.beats, t1) - beatIndexAfter(this.beats, t0));
  }
}

/** Real-time features from an AnalyserNode (mic, tab or system audio). */
export class LiveFeed implements FeatureSource {
  readonly kind = 'live';
  private freq: Float32Array<ArrayBuffer>;
  private time: Float32Array<ArrayBuffer>;
  private ceil = new Float32Array(BAND_COUNT).fill(-60);
  private levelCeil = -40;
  private prevBands = new Float32Array(BAND_COUNT);
  private envPeak = { low: 0.4, mid: 0.4, high: 0.4 };
  private novHist: number[] = [];
  private novNorm = 0.2;
  private lastBeat = -1e9;
  private lastPoll = 0;
  private cached: RawFrame = makeRaw();
  private pendingBeats = 0;
  beatSettings: BeatSettings;

  constructor(
    public analyser: AnalyserNode,
    beat: BeatSettings,
  ) {
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -110;
    analyser.maxDecibels = -5;
    this.freq = new Float32Array(analyser.frequencyBinCount);
    this.time = new Float32Array(analyser.fftSize);
    this.beatSettings = beat;
  }

  /** Read the analyser once per animation frame. */
  poll(now: number): void {
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastPoll) / 1000 || 1 / 60));
    this.lastPoll = now;
    const an = this.analyser;
    an.getFloatFrequencyData(this.freq);
    an.getFloatTimeDomainData(this.time);
    const binHz = an.context.sampleRate / an.fftSize;
    const raw = this.cached;
    for (let b = 0; b < BAND_COUNT; b++) {
      const k0 = Math.max(1, Math.ceil(BAND_EDGES[b] / binHz));
      const k1 = Math.min(this.freq.length - 1, Math.floor(BAND_EDGES[b + 1] / binHz));
      let db: number;
      if (k1 < k0) {
        const pos = BAND_CENTRES[b] / binHz;
        const i = Math.floor(pos);
        const fr = pos - i;
        db = this.freq[i] * (1 - fr) + this.freq[Math.min(this.freq.length - 1, i + 1)] * fr;
      } else {
        let p = 0;
        for (let k = k0; k <= k1; k++) p += Math.pow(10, this.freq[k] / 10);
        db = 10 * Math.log10(p / (k1 - k0 + 1) + 1e-12);
      }
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
    let sq = 0;
    for (let i = 0; i < this.time.length; i++) sq += this.time[i] * this.time[i];
    const ldb = 10 * Math.log10(sq / this.time.length + 1e-12);
    this.levelCeil = Math.max(ldb, this.levelCeil - 3 * dt, -60);
    raw.level = Math.min(1.25, Math.max(0, 1 + (ldb - this.levelCeil) / 30));
    const span = Math.floor(this.time.length / WAVE_SIZE / 2);
    const off = this.time.length / 2 - (WAVE_SIZE * span) / 2;
    for (let i = 0; i < WAVE_SIZE; i++) raw.wave[i] = this.time[off + i * span];

    // Causal onset detection on the chosen frequency window.
    const bs = this.beatSettings;
    const idx = bandsInRange(bs.lo, bs.hi);
    let nov = 0;
    for (const b of idx) {
      const d = raw.bands[b] - this.prevBands[b];
      if (d > 0) nov += d;
    }
    nov /= Math.sqrt(idx.length);
    this.prevBands.set(raw.bands);
    this.novNorm = Math.max(nov, this.novNorm * Math.exp(-dt / 4), 0.05);
    const n = nov / (this.novNorm * 0.7);
    this.novHist.push(n);
    if (this.novHist.length > 30) this.novHist.shift();
    const mean = this.novHist.reduce((s, v) => s + v, 0) / this.novHist.length;
    const s = Math.min(1, Math.max(0, bs.sensitivity));
    const thr = mean * (2.1 - 1.1 * s) + (0.35 - 0.3 * s);
    if (n > thr && now - this.lastBeat >= bs.hold) {
      this.lastBeat = now;
      this.pendingBeats++;
    }
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
