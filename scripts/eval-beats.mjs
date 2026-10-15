// Evaluates onset detection and beat tracking against signals with known hit times.
// Usage: node scripts/eval-beats.mjs <compiled-dir>   (see scripts/eval-beats.sh)
const dir = process.argv[2];

// Minimal AudioBuffer for the demo synth.
globalThis.AudioBuffer = class {
  constructor({ numberOfChannels, length, sampleRate }) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.ch = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  copyToChannel(src, c) { this.ch[c].set(src); }
  getChannelData(c) { return this.ch[c]; }
};

const { analyse } = await import(`${dir}/audio/analysis-core.js`);
const { detectBeats } = await import(`${dir}/audio/beats.js`);
const { renderDemo } = await import(`${dir}/audio/demo.js`);

let seed = 3;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function synth(sr, dur, opts) {
  const n = Math.floor(sr * dur);
  const x = new Float32Array(n);
  const kicks = [], snares = [], beats = [];
  const add = (t, len, fn) => { const i0 = Math.floor(t * sr); for (let i = 0; i < len * sr && i0 + i < n; i++) x[i0 + i] += fn(i / sr); };
  let t = 0.5, bpm = opts.bpm, k = 0;
  while (t < dur - 1) {
    beats.push(t);
    const beat = 60 / bpm;
    const bar = k % 4;
    const kickHere = bar === 0 || bar === 2 || (opts.syncopate && rand() < 0.3);
    if (kickHere) { kicks.push(t); let ph = 0; add(t, 0.4, (tt) => { ph += (50 + 110 * Math.exp(-tt / 0.03)) / sr; return Math.sin(2 * Math.PI * ph) * Math.exp(-tt / 0.12) * 0.8; }); }
    if (opts.syncopate && rand() < 0.35) { const t2 = t + beat * 0.75; kicks.push(t2); let ph = 0; add(t2, 0.3, (tt) => { ph += (50 + 110 * Math.exp(-tt / 0.03)) / sr; return Math.sin(2 * Math.PI * ph) * Math.exp(-tt / 0.1) * 0.6; }); }
    if (bar === 1 || bar === 3) {
      // Snare: high-passed noise (≈ 300 Hz up) plus a short body tone.
      snares.push(t);
      let lp = 0;
      add(t, 0.25, (tt) => { const v = rand() * 2 - 1; lp += 0.04 * (v - lp); return (v - lp) * Math.exp(-tt / 0.06) * 0.35 + Math.sin(2 * Math.PI * 200 * tt) * Math.exp(-tt / 0.03) * 0.3; });
    }
    for (let e = 0; e < 2; e++) { let prev = 0; add(t + (e * beat) / 2, 0.05, (tt) => { const v = rand() * 2 - 1; const hp = v - prev; prev = v; return hp * Math.exp(-tt / 0.012) * 0.08; }); }
    t += beat;
    bpm += opts.drift / 4;
    k++;
  }
  // Pad and noise floor.
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    x[i] += 0.08 * (Math.sin(2 * Math.PI * 220 * tt) + Math.sin(2 * Math.PI * 277.2 * tt) + Math.sin(2 * Math.PI * 329.6 * tt)) * (0.6 + 0.4 * Math.sin(tt * 0.7));
    x[i] += (rand() * 2 - 1) * opts.noise;
  }
  return { x, kicks, snares, beats };
}

function score(det, truth, tol = 0.05) {
  const used = new Uint8Array(det.length);
  let tp = 0; const errs = [];
  for (const g of truth) {
    let best = -1, bd = tol;
    for (let i = 0; i < det.length; i++) { if (used[i]) continue; const d = Math.abs(det[i] - g); if (d <= bd) { bd = d; best = i; } }
    if (best >= 0) { used[best] = 1; tp++; errs.push(det[best] - g); }
  }
  const p = det.length ? tp / det.length : 0, r = truth.length ? tp / truth.length : 0;
  const f = p + r ? (2 * p * r) / (p + r) : 0;
  const mean = errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length);
  const mae = errs.reduce((a, b) => a + Math.abs(b), 0) / Math.max(1, errs.length);
  return { F: +f.toFixed(3), P: +p.toFixed(3), R: +r.toFixed(3), meanMs: +(mean * 1000).toFixed(1), maeMs: +(mae * 1000).toFixed(1), n: det.length, truth: truth.length };
}

const sens = Number(process.argv[3] ?? 0.55);
const cases = [];
for (const [name, opts] of [
  ['steady-128', { bpm: 128, drift: 0, syncopate: false, noise: 0.01 }],
  ['syncopated-96-drift', { bpm: 96, drift: 0.15, syncopate: true, noise: 0.03 }],
  ['fast-174-noisy', { bpm: 174, drift: 0, syncopate: true, noise: 0.06 }],
]) {
  const sr = 44100;
  const s = synth(sr, 40, opts);
  const an = analyse({ mono: s.x, sampleRate: sr }, () => {});
  const kicks = detectBeats(an, { lo: 40, hi: 140, sensitivity: sens, hold: 100, mode: 'onset', division: 1 });
  const snares = detectBeats(an, { lo: 180, hi: 2200, sensitivity: sens, hold: 100, mode: 'onset', division: 1 });
  if (process.env.SNAREDBG && name === 'steady-128') {
    const fp = Array.from(snares).filter((t) => !s.snares.some((g) => Math.abs(g - t) < 0.05));
    const lab = fp.slice(0, 20).map((t) => (s.kicks.some((g) => Math.abs(g - t) < 0.05) ? 'K' : s.beats.some((g) => Math.abs(g - t) < 0.05) ? 'B' : 'h') + t.toFixed(2));
    console.log('snare FP', fp.length, lab.join(' '));
  }
  cases.push({ name, bpm: an.bpm, kick: score(kicks, s.kicks), snare: score(snares, s.snares), beats: score(an.beatTimes, s.beats, 0.07) });
}
{
  const buf = await renderDemo(44100);
  const mono = buf.getChannelData(0).map((v, i) => (v + buf.getChannelData(1)[i]) / 2);
  const an = analyse({ mono, sampleRate: 44100 }, () => {});
  const beat = 60 / 124, bar = beat * 4;
  const truthKicks = [], truthBeats = [];
  for (let b = 0; b < 32; b++) for (let q = 0; q < 4; q++) {
    const t = 0.25 + b * bar + q * beat;
    const sec = b < 8 ? 'intro' : b < 16 ? 'build' : b < 24 ? 'drop' : b < 26 ? 'break' : 'drop2';
    const drop = sec === 'drop' || sec === 'drop2';
    if (drop || (sec === 'build' && (q === 0 || q === 2 || b >= 12))) truthKicks.push(t);
    if (b >= 8 && sec !== 'break') truthBeats.push(t);
  }
  const kicks = detectBeats(an, { lo: 40, hi: 140, sensitivity: sens, hold: 100, mode: 'onset', division: 1 });
  // Bass notes share the kick band; count a kick as found if any detection is near.
  if (process.env.DEBUG) {
    const tb = Array.from(an.beatTimes);
    console.log('demo beats', tb.map((t) => { let d = 1e9; for (const g of truthBeats) if (Math.abs(t - g) < Math.abs(d)) d = t - g; return `${t.toFixed(2)}:${(d * 1000).toFixed(0)}`; }).join(' '));
  }
  cases.push({ name: 'demo', bpm: an.bpm, kickRecall: score(kicks, truthKicks).R, kickMeanMs: score(kicks, truthKicks).meanMs, beats: score(an.beatTimes, truthBeats, 0.07), downbeat: an.downbeat, firstBeats: Array.from(an.beatTimes.slice(0, 5)).map((v) => +v.toFixed(3)) });
}
for (const c of cases) console.log(JSON.stringify(c));
