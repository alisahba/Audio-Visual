// Beat and onset picking on top of the offline analysis. Pure functions (no DOM),
// shared by the app and the evaluation script.

import type { BeatSettings } from '../state/project';
import { refinePeak, type AnalysisResult as TrackAnalysis } from './analysis-core';
import { fineRange, superflux } from './dsp';

/**
 * Onset strength (SuperFlux) for a frequency window, normalised so its 95th
 * percentile ≈ 1. With `focus`, attacks that are mostly outside the window
 * (a snare's thump in the kick band, a kick's click in the snare band) are
 * attenuated by how much of the attack lies inside the window.
 */
export function noveltyCurve(an: TrackAnalysis, lo: number, hi: number, focus = 0.8): Float32Array {
  const [b0, b1] = fineRange(an.fineCentres, lo, hi);
  const inside = superflux(an.fine, an.frames, an.fineCount, b0, b1);
  normaliseHits(inside, an.fps);
  if (focus <= 0 || (b0 === 0 && b1 === an.fineCount - 1)) return inside;
  const below = b0 > 0 ? superflux(an.fine, an.frames, an.fineCount, 0, b0 - 1) : null;
  const above = b1 < an.fineCount - 1 ? superflux(an.fine, an.frames, an.fineCount, b1 + 1, an.fineCount - 1) : null;
  if (below) normaliseHits(below, an.fps);
  if (above) normaliseHits(above, an.fps);
  for (let f = 0; f < inside.length; f++) {
    const out = Math.max(below ? below[f] : 0, above ? above[f] : 0);
    const share = inside[f] / (inside[f] + out + 1e-3);
    inside[f] *= Math.pow(Math.min(1, share * 1.6), focus);
  }
  return inside;
}

/**
 * Scale so a typical hit ≈ 1: divide by the median of the strongest peaks,
 * taking roughly 1.5 hits per second as the expected density. (Percentiles of
 * all frames or all peaks fail on sparse or noisy material.)
 */
function normaliseHits(x: Float32Array, fps = 86): void {
  const peaks: number[] = [];
  for (let f = 1; f < x.length - 1; f++) if (x[f] > 1e-4 && x[f] >= x[f - 1] && x[f] > x[f + 1]) peaks.push(x[f]);
  peaks.sort((a, b) => b - a);
  const k = Math.max(8, Math.round((x.length / fps) * 1.5));
  const top = peaks.slice(0, Math.min(peaks.length, k));
  const p = top.length ? top[Math.floor(top.length / 2)] : 1;
  for (let f = 0; f < x.length; f++) x[f] /= p || 1;
}

/** Sensitivity (0..1) → peak-picking threshold above the local mean. */
export function onsetDelta(sensitivity: number): number {
  const s = Math.min(1, Math.max(0, sensitivity));
  return 0.9 * Math.pow(1 - s, 1.6) + 0.04;
}

/**
 * Peak picking after Böck et al.: a frame is an onset if it is the maximum of
 * its ±35 ms neighbourhood, exceeds the local mean (−100 / +70 ms) by a
 * sensitivity-dependent margin, and is at least `hold` after the previous onset.
 */
export function pickOnsets(nov: Float32Array, fps: number, sensitivity: number, holdMs: number): Float32Array {
  const frames = nov.length;
  const preMax = Math.max(1, Math.round(fps * 0.035));
  const postMax = preMax;
  const preAvg = Math.round(fps * 0.1);
  const postAvg = Math.round(fps * 0.07);
  const prefix = new Float64Array(frames + 1);
  for (let f = 0; f < frames; f++) prefix[f + 1] = prefix[f] + nov[f];
  const delta = onsetDelta(sensitivity);
  const hold = (holdMs / 1000) * fps;
  const out: number[] = [];
  let last = -1e9;
  let lastV = 0;
  for (let f = 1; f < frames - 1; f++) {
    const v = nov[f];
    if (v < 0.12) continue;
    let isMax = true;
    for (let k = Math.max(0, f - preMax); k <= Math.min(frames - 1, f + postMax); k++) {
      if (nov[k] > v || (nov[k] === v && k < f)) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    const a = Math.max(0, f - preAvg);
    const b = Math.min(frames, f + postAvg + 1);
    const mean = (prefix[b] - prefix[a]) / (b - a);
    if (v < mean + delta) continue;
    const t = (refinePeak(nov, f) + 0.5) / fps + ONSET_OFFSET;
    if (f - last < hold) {
      // Inside the minimum gap keep whichever peak is stronger.
      if (v > lastV && out.length) {
        out[out.length - 1] = t;
        last = f;
        lastV = v;
      }
      continue;
    }
    last = f;
    lastV = v;
    out.push(t);
  }
  return Float32Array.from(out);
}

/** Calibrated against synthetic tracks with known onset times (see scripts/eval-beats). */
export const ONSET_OFFSET = 0;


/** Beat times (s) for the whole track according to the beat settings. */
export function detectBeats(an: TrackAnalysis, bs: BeatSettings): Float32Array {
  if (bs.mode === 'grid') return beatGrid(an, bs.division);
  const nov = noveltyCurve(an, bs.lo, bs.hi);
  return pickOnsets(nov, an.fps, bs.sensitivity, bs.hold);
}

/** Tracked beats thinned to bars / half bars or subdivided into 8ths / 16ths. */
export function beatGrid(an: TrackAnalysis, division: number): Float32Array {
  let bt = an.beatTimes;
  if (bt.length < 2) {
    const period = 60 / (an.bpm || 120);
    const arr: number[] = [];
    for (let t = 0; t < an.duration; t += period) arr.push(t);
    bt = Float32Array.from(arr);
  }
  const out: number[] = [];
  if (division < 1) {
    const step = Math.round(1 / division);
    // Align bars to the detected downbeat.
    const phase = step === 4 ? an.downbeat % 4 : an.downbeat % 2;
    for (let i = phase; i < bt.length; i += step) out.push(bt[i]);
    return Float32Array.from(out);
  }
  const sub = Math.round(division);
  for (let i = 0; i < bt.length; i++) {
    const t = bt[i];
    const next = i + 1 < bt.length ? bt[i + 1] : t + (t - (bt[i - 1] ?? t - 60 / an.bpm));
    for (let k = 0; k < sub; k++) out.push(t + ((next - t) * k) / sub);
  }
  return Float32Array.from(out);
}

