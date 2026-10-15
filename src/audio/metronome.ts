// Metronome source: a synthesised rhythm at an exact tempo, so the visuals can
// follow a BPM without any track (or along with music playing elsewhere).
// It runs through the normal analysis, then the beat grid is replaced with the
// exact one.

import type { AnalysisResult } from './analysis-core';

export type MetroPattern = 'pulse' | 'groove' | 'click';

export interface MetronomeSettings {
  bpm: number;
  pattern: MetroPattern;
  /** Play the rhythm out loud; when off it drives the visuals silently. */
  audible: boolean;
}

export const METRO_MIN = 40;
export const METRO_MAX = 220;
export const METRONOME_TITLE = 'Metronome';
const KEY = 'klangbild.metronome.v1';

export function readMetronome(): MetronomeSettings {
  const def: MetronomeSettings = { bpm: 120, pattern: 'groove', audible: true };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      bpm: typeof v.bpm === 'number' ? clampBpm(v.bpm) : def.bpm,
      pattern: ['pulse', 'groove', 'click'].includes(v.pattern) ? v.pattern : def.pattern,
      audible: typeof v.audible === 'boolean' ? v.audible : def.audible,
    };
  } catch {
    return def;
  }
}

export function saveMetronome(s: MetronomeSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function clampBpm(v: number): number {
  return Math.round(Math.min(METRO_MAX, Math.max(METRO_MIN, v)) * 10) / 10;
}

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

/** Length of the rendered loop: at least two minutes and 32 bars. */
export function metronomeLength(bpm: number): number {
  const bar = (4 * 60) / bpm;
  return Math.ceil(Math.max(120, 32 * bar) / bar) * bar;
}

/**
 * Render the rhythm. Every beat has a kick-like thump (accented on the one), so
 * Kick follows the beat; Groove adds a snare on 2 and 4 and hats on the eighths
 * so Snare and Hats pick out their own parts.
 */
export function renderMetronome(sr: number, s: MetronomeSettings): AudioBuffer {
  const beat = 60 / s.bpm;
  const dur = metronomeLength(s.bpm);
  const n = Math.ceil(dur * sr);
  const out = new Float32Array(n);
  const rnd = rng(7);
  const noise = new Float32Array(Math.ceil(sr * 0.4));
  for (let i = 0; i < noise.length; i++) noise[i] = rnd() * 2 - 1;

  const add = (t0: number, len: number, fn: (t: number, i: number) => number) => {
    const a = Math.floor(t0 * sr);
    const m = Math.min(n - a, Math.ceil(len * sr));
    for (let i = 0; i < m; i++) out[a + i] += fn(i / sr, i);
  };
  const kick = (t0: number, gain: number) =>
    add(t0, 0.35, (t) => {
      // Pitch sweeps from ~160 Hz down to 48 Hz.
      const ph = 2 * Math.PI * (48 * t + (110 / 32) * (1 - Math.exp(-t * 32)));
      return Math.sin(ph) * Math.exp(-t * 9) * gain + (t < 0.004 ? (rnd() * 2 - 1) * 0.25 * gain : 0);
    });
  const click = (t0: number, freq: number, gain: number) =>
    add(t0, 0.06, (t) => Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 90) * gain);
  // One-pole high-pass on noise for hats; band-limited noise plus a tone for the snare.
  const hat = (t0: number, gain: number, decay: number) => {
    let prev = 0;
    let hp = 0;
    add(t0, 0.25, (t, i) => {
      const x = noise[i % noise.length];
      hp = 0.86 * (hp + x - prev);
      prev = x;
      return hp * Math.exp(-t * decay) * gain;
    });
  };
  const snare = (t0: number, gain: number) => {
    let lp = 0;
    add(t0, 0.3, (t, i) => {
      const x = noise[(i * 7) % noise.length];
      lp += 0.35 * (x - lp);
      return (lp * 0.9 * Math.exp(-t * 18) + Math.sin(2 * Math.PI * 190 * t) * 0.5 * Math.exp(-t * 30)) * gain;
    });
  };

  const beats = Math.round(dur / beat);
  for (let k = 0; k < beats; k++) {
    const t = k * beat;
    const one = k % 4 === 0;
    if (s.pattern === 'click') {
      click(t, one ? 1760 : 1320, one ? 0.7 : 0.45);
      kick(t, one ? 0.35 : 0.22);
    } else if (s.pattern === 'pulse') {
      kick(t, one ? 0.95 : 0.7);
    } else {
      kick(t, one ? 0.95 : 0.8);
      if (k % 4 === 1 || k % 4 === 3) snare(t, 0.5);
      hat(t + beat / 2, 0.22, 26);
      hat(t, 0.12, 60);
    }
  }
  // Gentle limiter so stacked hits don't clip.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak > 0.95 ? 0.95 / peak : 1;
  for (let i = 0; i < n; i++) out[i] *= g;

  const buf = new AudioBuffer({ length: n, sampleRate: sr, numberOfChannels: 1 });
  buf.copyToChannel(out, 0);
  return buf;
}

/** Replace the tracked tempo with the exact grid (downbeat on the first beat). */
export function exactGrid(an: AnalysisResult, bpm: number): void {
  const beat = 60 / bpm;
  const count = Math.floor(an.duration / beat + 1e-6);
  const bt = new Float32Array(count);
  for (let k = 0; k < count; k++) bt[k] = k * beat;
  an.bpm = bpm;
  an.beatTimes = bt;
  an.downbeat = 0;
}
