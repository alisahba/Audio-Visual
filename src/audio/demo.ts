// A synthesised demo track so the instrument works before any music is loaded.
// 124 BPM: intro → build → drop → break → drop. Rendered with plain DSP
// (oscillators, state-variable filters, a small Freeverb) in well under a second.

const BPM = 124;
const BARS = 32;

export const DEMO_TITLE = 'Test Pattern No. 1';
export const DEMO_ARTIST = 'Klangbild';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function polyblep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** Topology-preserving state-variable filter. */
class SVF {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  constructor(private sr: number) {}
  set(fc: number, q: number): void {
    const g = Math.tan((Math.PI * Math.min(fc, this.sr * 0.45)) / this.sr);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  /** Returns [low, band, high]. */
  run(v0: number, out: Float64Array): void {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    out[0] = v2;
    out[1] = v1;
    out[2] = v0 - this.k * v1 - v2;
  }
}

export async function renderDemo(sampleRate = 44100): Promise<AudioBuffer> {
  const sr = sampleRate;
  const beat = 60 / BPM;
  const bar = beat * 4;
  const duration = BARS * bar + 2;
  const n = Math.ceil(duration * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const send = new Float32Array(n);
  const rand = rng(11);
  const fo = new Float64Array(3);
  const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

  const put = (i: number, v: number, pan: number, rev: number) => {
    if (i < 0 || i >= n) return;
    L[i] += v * (1 - Math.max(0, pan));
    R[i] += v * (1 + Math.min(0, pan));
    send[i] += v * rev;
  };

  const kick = (t: number, vel = 1) => {
    const i0 = Math.floor(t * sr);
    const len = Math.floor(0.45 * sr);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      const f = 48 + 107 * Math.exp(-tt / 0.03);
      ph += f / sr;
      const env = Math.min(1, tt / 0.003) * Math.exp(-tt / 0.13);
      const click = i < 60 ? (rand() * 2 - 1) * 0.3 * (1 - i / 60) : 0;
      put(i0 + i, (Math.sin(2 * Math.PI * ph) * env + click) * 0.95 * vel, 0, 0);
    }
  };

  const noiseHit = (t: number, dur: number, mode: 0 | 1 | 2, freq: number, q: number, vel: number, rev: number, pan = 0) => {
    const i0 = Math.floor(t * sr);
    const len = Math.floor(dur * sr);
    const f = new SVF(sr);
    f.set(freq, q);
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      const env = Math.min(1, tt / 0.0015) * Math.exp(-tt / (dur * 0.28));
      f.run(rand() * 2 - 1, fo);
      put(i0 + i, fo[mode] * env * vel, pan, rev);
    }
  };

  const snare = (t: number) => {
    noiseHit(t, 0.26, 1, 1900, 0.9, 0.9, 0.35);
    const i0 = Math.floor(t * sr);
    let ph = 0;
    for (let i = 0; i < Math.floor(0.14 * sr); i++) {
      const tt = i / sr;
      ph += (240 - 80 * Math.min(1, tt / 0.08)) / sr;
      const tri = 1 - 4 * Math.abs((ph % 1) - 0.5);
      put(i0 + i, tri * 0.35 * Math.exp(-tt / 0.04), 0, 0.1);
    }
  };

  const hat = (t: number, open: boolean, vel: number) => noiseHit(t, open ? 0.24 : 0.05, 2, 7500, 0.7, vel, 0.05, 0.25);

  const bassNote = (t: number, midi: number, dur: number, cutoff: number) => {
    const i0 = Math.floor(t * sr);
    const len = Math.floor((dur + 0.02) * sr);
    const f1 = mtof(midi);
    const f2 = mtof(midi - 12);
    const dt1 = f1 / sr;
    const dt2 = f2 / sr;
    let p1 = 0;
    let p2 = 0;
    const flt = new SVF(sr);
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      if ((i & 15) === 0) flt.set(cutoff * (1 + 2.5 * Math.exp(-tt / (dur * 0.35))), 2.2);
      p1 = (p1 + dt1) % 1;
      p2 = (p2 + dt2) % 1;
      const saw = 2 * p1 - 1 - polyblep(p1, dt1);
      let sq = p2 < 0.5 ? 1 : -1;
      sq += polyblep(p2, dt2) - polyblep((p2 + 0.5) % 1, dt2);
      flt.run(saw * 0.6 + sq * 0.5, fo);
      const env = Math.min(1, tt / 0.006) * Math.exp(-tt / (dur * 0.6));
      put(i0 + i, fo[0] * env * 0.55, 0, 0);
    }
  };

  const pad = (t: number, notes: number[], dur: number, bright: number) => {
    const i0 = Math.floor(t * sr);
    const len = Math.floor(dur * sr);
    const voices = notes.flatMap((m) => [mtof(m) * Math.pow(2, -9 / 1200), mtof(m) * Math.pow(2, 7 / 1200)]);
    const ph = voices.map(() => rand());
    const fl = new SVF(sr);
    const fr = new SVF(sr);
    fl.set(400 + bright * 2400, 0.7);
    fr.set(420 + bright * 2400, 0.7);
    for (let i = 0; i < len; i++) {
      const k = i / len;
      const env = k < 0.35 ? k / 0.35 : (1 - k) / 0.65;
      let l = 0;
      let r = 0;
      for (let v = 0; v < voices.length; v++) {
        const dt = voices[v] / sr;
        ph[v] = (ph[v] + dt) % 1;
        const s = 2 * ph[v] - 1 - polyblep(ph[v], dt);
        if (v & 1) r += s;
        else l += s;
      }
      fl.run(l, fo);
      const ol = fo[0];
      fr.run(r, fo);
      const or = fo[0];
      const g = env * 0.05;
      const idx = i0 + i;
      if (idx >= n) break;
      L[idx] += ol * g;
      R[idx] += or * g;
      send[idx] += (ol + or) * g * 0.6;
    }
  };

  const pluck = (t: number, midi: number, vel: number, pan: number) => {
    const i0 = Math.floor(t * sr);
    const len = Math.floor(0.26 * sr);
    const f0 = mtof(midi);
    const dt = f0 / sr;
    let p = 0;
    const flt = new SVF(sr);
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      if ((i & 15) === 0) flt.set(700 + 4500 * Math.exp(-tt / 0.05), 1.2);
      p = (p + dt) % 1;
      let sq = p < 0.5 ? 1 : -1;
      sq += polyblep(p, dt) - polyblep((p + 0.5) % 1, dt);
      flt.run(sq, fo);
      const env = Math.min(1, tt / 0.003) * Math.exp(-tt / 0.07);
      put(i0 + i, fo[0] * env * 0.16 * vel, pan, 0.45);
    }
  };

  const section = (b: number) => (b < 8 ? 'intro' : b < 16 ? 'build' : b < 24 ? 'drop' : b < 26 ? 'break' : 'drop2');
  const roots = [45, 41, 48, 43];
  const chords = [
    [57, 60, 64, 67],
    [53, 57, 60, 64],
    [52, 55, 60, 64],
    [50, 55, 59, 62],
  ];

  for (let b = 0; b < BARS; b++) {
    const sec = section(b);
    const drop = sec === 'drop' || sec === 'drop2';
    const t0 = 0.25 + b * bar;
    const ci = b % 4;
    if (b % 2 === 0) pad(t0, chords[ci], bar * 2, drop ? 0.8 : sec === 'build' ? (b - 8) / 8 : 0.15);
    for (let q = 0; q < 4; q++) {
      const t = t0 + q * beat;
      const hasKick = drop || (sec === 'build' && (q === 0 || q === 2 || b >= 12));
      if (hasKick) kick(t);
      if ((drop || (sec === 'build' && b >= 12)) && (q === 1 || q === 3)) snare(t);
      if (sec !== 'break') {
        for (let e = 0; e < 4; e++) {
          const th = t + (e * beat) / 4;
          if (e === 2) hat(th, sec !== 'intro' && q === 3, 0.35);
          else if (sec !== 'intro' && e !== 0) hat(th, false, 0.12 + rand() * 0.08);
        }
      }
      if (drop || (sec === 'build' && b >= 12)) {
        bassNote(t + beat / 2, roots[ci], beat * 0.45, 180);
        if (q === 0) bassNote(t, roots[ci], beat * 0.3, 140);
      }
      if (drop) {
        for (let e = 0; e < 4; e++) {
          const notes = chords[ci];
          const nn = notes[(q * 4 + e * 3 + b) % notes.length] + 12;
          if (rand() < 0.8) pluck(t + (e * beat) / 4, nn, 0.6 + rand() * 0.4, (rand() - 0.5) * 0.6);
        }
      }
    }
    if (b === 14 || b === 15) {
      const div = b === 14 ? 8 : 16;
      for (let i = 0; i < div; i++) noiseHit(t0 + (i * bar) / div, 0.08, 1, 1500 + i * 120, 1.2, 0.2 + (i / div) * 0.5, 0.3);
    }
    if (b === 24) noiseHit(t0, 2.8, 2, 2000, 0.4, 0.5, 0.7);
  }

  // Freeverb-style reverb on the send bus.
  const combL = [1116, 1188, 1277, 1356].map((x) => Math.round((x * sr) / 44100));
  const combR = combL.map((x) => x + Math.round((23 * sr) / 44100));
  const apL = [556, 441].map((x) => Math.round((x * sr) / 44100));
  const apR = apL.map((x) => x + Math.round((23 * sr) / 44100));
  const reverb = (lens: number[], aps: number[], dst: Float32Array) => {
    const bufs = lens.map((l) => new Float32Array(l));
    const idx = lens.map(() => 0);
    const lp = lens.map(() => 0);
    const abufs = aps.map((l) => new Float32Array(l));
    const aidx = aps.map(() => 0);
    const fb = 0.86;
    const damp = 0.3;
    for (let i = 0; i < n; i++) {
      const x = send[i] * 0.03;
      let y = 0;
      for (let c = 0; c < bufs.length; c++) {
        const b = bufs[c];
        const o = b[idx[c]];
        lp[c] = o * (1 - damp) + lp[c] * damp;
        b[idx[c]] = x + lp[c] * fb;
        idx[c] = (idx[c] + 1) % b.length;
        y += o;
      }
      for (let a = 0; a < abufs.length; a++) {
        const b = abufs[a];
        const o = b[aidx[a]];
        b[aidx[a]] = y + o * 0.5;
        y = o - y;
        aidx[a] = (aidx[a] + 1) % b.length;
      }
      dst[i] += y;
    }
  };
  reverb(combL, apL, L);
  reverb(combR, apR, R);

  // Gentle soft-clip master.
  let peak = 1e-6;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const drive = 1.6 / peak;
  const norm = 0.92 / Math.tanh(1.6);
  for (let i = 0; i < n; i++) {
    L[i] = Math.tanh(L[i] * drive) * norm;
    R[i] = Math.tanh(R[i] * drive) * norm;
  }

  const out = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: sr });
  out.copyToChannel(L, 0);
  out.copyToChannel(R, 1);
  return out;
}
