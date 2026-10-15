// AudioWorklet: analyses live input (mic, tab, system audio) on the audio
// thread with the same filterbanks as the offline analysis, and posts one
// frame every ~11 ms to the main thread.

import { BAND_COUNT } from './bands';
import { applyFilterbank, bandsDb, hann, makeBandMap, makeFilterbank } from './dsp';
import { FFT } from './fft';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const WAVE = 256;

class LiveAnalyser extends AudioWorkletProcessor {
  private n: number;
  private hop: number;
  private ring: Float32Array;
  private write = 0;
  private sinceHop = 0;
  private fft: FFT;
  private win: Float64Array;
  private re: Float64Array;
  private im: Float64Array;
  private mag: Float64Array;
  private map: ReturnType<typeof makeBandMap>;
  private fb: ReturnType<typeof makeFilterbank>;

  constructor() {
    super();
    // ~46 ms window and ~11 ms hop at 44.1/48 kHz, matching the offline analysis.
    this.n = sampleRate > 30000 ? 2048 : 1024;
    this.hop = this.n / 4;
    this.map = makeBandMap(sampleRate, this.n);
    this.fb = makeFilterbank(sampleRate, this.n);
    this.ring = new Float32Array(this.n);
    this.fft = new FFT(this.n);
    this.win = hann(this.n);
    this.re = new Float64Array(this.n);
    this.im = new Float64Array(this.n);
    this.mag = new Float64Array(this.n / 2 + 1);
    this.port.postMessage({ type: 'init', fineCount: this.fb.count, centres: this.fb.centres, hopSec: this.hop / sampleRate });
  }

  process(inputs: Float32Array[][]): boolean {
    const chans = inputs[0];
    if (!chans || !chans.length) return true;
    const len = chans[0].length;
    for (let i = 0; i < len; i++) {
      let v = 0;
      for (let c = 0; c < chans.length; c++) v += chans[c][i];
      this.ring[this.write] = v / chans.length;
      this.write = (this.write + 1) % this.n;
      if (++this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        this.frame();
      }
    }
    return true;
  }

  private frame(): void {
    const n = this.n;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const v = this.ring[(this.write + i) % n];
      this.re[i] = v * this.win[i];
      this.im[i] = 0;
      if (i >= n - this.hop) sq += v * v;
    }
    this.fft.transform(this.re, this.im);
    for (let k = 0; k <= n / 2; k++) this.mag[k] = Math.hypot(this.re[k], this.im[k]) / (n / 4);
    const bands = new Float32Array(BAND_COUNT);
    const fine = new Float32Array(this.fb.count);
    bandsDb(this.map, this.mag, bands);
    applyFilterbank(this.fb, this.mag, fine);
    const wave = new Float32Array(WAVE);
    const span = Math.max(1, Math.floor(n / 2 / WAVE));
    const off = n - WAVE * span;
    for (let i = 0; i < WAVE; i++) wave[i] = this.ring[(this.write + off + i * span) % n];
    const levelDb = 10 * Math.log10(sq / this.hop + 1e-12);
    this.port.postMessage({ type: 'frame', bands, fine, wave, levelDb }, [bands.buffer, fine.buffer, wave.buffer]);
  }
}

registerProcessor('klangbild-live', LiveAnalyser);
