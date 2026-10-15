// Shared frequency-band layout used by offline analysis, live analysis and UI.

export const BAND_COUNT = 32;
export const BAND_MIN_HZ = 30;
export const BAND_MAX_HZ = 11000;

/** Band edges (Hz), length BAND_COUNT + 1, log-spaced. */
export const BAND_EDGES: number[] = (() => {
  const out: number[] = [];
  const l0 = Math.log(BAND_MIN_HZ);
  const l1 = Math.log(BAND_MAX_HZ);
  for (let i = 0; i <= BAND_COUNT; i++) out.push(Math.exp(l0 + ((l1 - l0) * i) / BAND_COUNT));
  return out;
})();

export const BAND_CENTRES: number[] = BAND_EDGES.slice(0, BAND_COUNT).map((e, i) => Math.sqrt(e * BAND_EDGES[i + 1]));

/** 0..1 position of a frequency on the log axis used by the band picker. */
export function freqToX(hz: number): number {
  const l0 = Math.log(BAND_MIN_HZ);
  const l1 = Math.log(BAND_MAX_HZ);
  return Math.min(1, Math.max(0, (Math.log(Math.max(1, hz)) - l0) / (l1 - l0)));
}

export function xToFreq(x: number): number {
  const l0 = Math.log(BAND_MIN_HZ);
  const l1 = Math.log(BAND_MAX_HZ);
  return Math.exp(l0 + (l1 - l0) * Math.min(1, Math.max(0, x)));
}

/** Indices of bands overlapping [lo, hi] Hz. Always at least one. */
export function bandsInRange(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let b = 0; b < BAND_COUNT; b++) {
    if (BAND_EDGES[b + 1] > lo && BAND_EDGES[b] < hi) out.push(b);
  }
  if (!out.length) {
    const c = Math.sqrt(lo * hi);
    let best = 0;
    for (let b = 1; b < BAND_COUNT; b++) if (Math.abs(BAND_CENTRES[b] - c) < Math.abs(BAND_CENTRES[best] - c)) best = b;
    out.push(best);
  }
  return out;
}

export const RANGE_LOW: [number, number] = [20, 160];
export const RANGE_MID: [number, number] = [160, 2500];
export const RANGE_HIGH: [number, number] = [2500, 16000];

export const BEAT_PRESETS: { id: string; label: string; lo: number; hi: number; hold: number }[] = [
  { id: 'kick', label: 'Kick', lo: 40, hi: 140, hold: 120 },
  { id: 'snare', label: 'Snare', lo: 180, hi: 2200, hold: 100 },
  { id: 'hats', label: 'Hats', lo: 5000, hi: 11000, hold: 45 },
  { id: 'full', label: 'Full', lo: 30, hi: 11000, hold: 80 },
];

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`;
}
