import type { Drive, ParamValue } from './defs';
import { EFFECTS } from './defs';
import { defaultEffects, type Project } from './project';

interface FxOverride {
  on?: boolean;
  p?: Record<string, ParamValue>;
  drive?: Drive;
  depth?: number;
}

export interface Preset {
  id: string;
  name: string;
  note: string;
  palette: string[];
  background: string;
  fx: Record<string, FxOverride>;
}

export const PRESETS: Preset[] = [
  {
    id: 'ember',
    name: 'Ember',
    note: 'Smouldering strata, smeared and grainy',
    palette: ['#ff3b2f', '#ff7a45', '#6c4dff', '#ffd2b8', '#ff2f6d'],
    background: '#0a0909',
    fx: {
      spectrum: { on: true, p: { layout: 'strata', position: 0.42, thickness: 0.1, gain: 1 } },
      cloud: { on: true, p: { scale: 1.4, threshold: 0.6, amount: 0.15, speed: 0.4 } },
      ink: { on: true, p: { size: 0.4, bleed: 1.4, push: 0.3, placement: 'rise' } },
      flow: { on: true, p: { speed: 0.08, scale: 1.4 } },
      drift: { on: true, p: { angle: 270, speed: 0.14, streak: 0.9, columns: 90 } },
      fluid: { on: false },
      time: { p: { hold: 0.6, fade: 3.5, bleed: 0.3 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'beat' } },
      chroma: { on: true, p: { amount: 0.12 } },
      glow: { on: true, p: { intensity: 0.3, threshold: 0.65 } },
      blur: { on: true, p: { radius: 0.1, mix: 0.5 } },
      grain: { on: true, p: { amount: 0.38, size: 1.6 } },
      vignette: { on: true, p: { amount: 0.25 } },
    },
  },
  {
    id: 'capsule',
    name: 'Capsule',
    note: 'A single glowing body melting downward',
    palette: ['#8fdc2a', '#ff6a1f', '#f2c12e', '#ff3b1f', '#c9f59a'],
    background: '#10272b',
    fx: {
      orbs: { on: true, p: { shape: 'capsule', count: 1, size: 0.4, soft: 0.35, speed: 0.03, spread: 0 }, drive: 'low', depth: 0.2 },
      drift: { on: true, p: { angle: 270, speed: 0.18, streak: 0.5, columns: 40 } },
      flow: { on: true, p: { speed: 0.03, scale: 1.2 } },
      ink: { on: false },
      fluid: { on: false },
      time: { p: { hold: 0.1, fade: 1.6, bleed: 0.45 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'off' } },
      glow: { on: true, p: { intensity: 0.35, threshold: 0.5, radius: 0.8 } },
      blur: { on: true, p: { radius: 0.08, mix: 0.7 } },
      dither: { on: true, p: { style: 'noise', levels: 14, scale: 1.5, mix: 0.6 } },
      grain: { on: true, p: { amount: 0.2 } },
      vignette: { on: true, p: { amount: 0.35 } },
    },
  },
  {
    id: 'pastel',
    name: 'Pastel Melt',
    note: 'Soft columns of colour sliding past each other',
    palette: ['#f6b8c8', '#c3f2bf', '#f7e7a6', '#b6c4ff', '#ff7a59'],
    background: '#f2ebe6',
    fx: {
      cloud: { on: true, p: { scale: 1.6, threshold: 0.6, amount: 0.12, speed: 0.3 } },
      ink: { on: true, p: { size: 0.5, bleed: 1.2, drops: 2, push: 0.2 } },
      drift: { on: true, p: { angle: 270, speed: 0.5, streak: 1, columns: 9 }, drive: 'low', depth: 0.3 },
      fluid: { on: false },
      time: { p: { hold: 2, fade: 6, bleed: 0.1 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'beat' } },
      glow: { on: false },
      grain: { on: true, p: { amount: 0.06 } },
    },
  },
  {
    id: 'thermal',
    name: 'Thermal',
    note: 'Blurred bodies read through a heat-map',
    palette: ['#7a12ff', '#3a2cff', '#1f6dff', '#9cc8ff', '#e2e2e2'],
    background: '#e2e2e2',
    fx: {
      orbs: { on: true, p: { shape: 'circle', count: 2, size: 0.26, soft: 0.8, speed: 0.25, spread: 0.55 }, drive: 'low', depth: 0.25 },
      fluid: { on: true, p: { force: 0.4, swirl: 0.25, viscosity: 0.4, stir: 0.1 } },
      time: { p: { hold: 0.2, fade: 1.2, bleed: 0.25 } },
      colour: { p: { mode: 'gradient', blend: 'normal', cycle: 'beat' } },
      blur: { on: true, p: { radius: 0.4, mix: 1 } },
      glow: { on: false },
      grain: { on: true, p: { amount: 0.1 } },
    },
  },
  {
    id: 'marble',
    name: 'Marble',
    note: 'Neon paint folded by a real fluid',
    palette: ['#ff2e63', '#ff9a3c', '#27e0a3', '#7b5cff', '#ff7ad9'],
    background: '#0b0610',
    fx: {
      fluid: { on: true, p: { force: 1.4, swirl: 0.85, viscosity: 0.12, stir: 0.5 }, drive: 'beat', depth: 0.5 },
      ink: { on: true, p: { size: 0.26, bleed: 0.6, push: 1, drops: 1 } },
      time: { p: { hold: 0.6, fade: 2.5, bleed: 0.02 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'beat', saturation: 1.3 } },
      contour: { on: true, p: { lines: 8, width: 0.1, mix: 0.2, ink: 'dark' } },
      glow: { on: true, p: { intensity: 0.4, threshold: 0.55 } },
      grain: { on: true, p: { amount: 0.14 } },
      vignette: { on: true, p: { amount: 0.4 } },
    },
  },
  {
    id: 'paper',
    name: 'Paper Bleed',
    note: 'Ink drops soaking slowly into paper',
    palette: ['#ff8a7a', '#ffc46b', '#8fb3ff', '#ff9ad5', '#9ee0c0'],
    background: '#efe6d2',
    fx: {
      ink: { on: true, p: { size: 0.38, bleed: 3.5, drops: 1, push: 0.25, placement: 'random', every: '4' } },
      fluid: { on: true, p: { force: 0.3, swirl: 0.2, viscosity: 0.6, stir: 0.1 } },
      time: { p: { hold: 1.5, fade: 6, bleed: 0.5 } },
      colour: { p: { mode: 'direct', blend: 'multiply', cycle: 'beat' } },
      blur: { on: true, p: { radius: 0.12, mix: 0.5 } },
      glow: { on: false },
      grain: { on: true, p: { amount: 0.16, colour: 0 } },
      vignette: { on: true, p: { amount: 0.15 } },
    },
  },
  {
    id: 'halo',
    name: 'Halo',
    note: 'Symmetric gradient-mapped glow with a traced edge',
    palette: ['#1a1a22', '#6a2cff', '#ff3b30', '#ffd21f', '#dff3f7'],
    background: '#dff3f7',
    fx: {
      orbs: { on: true, p: { shape: 'circle', count: 1, size: 0.46, soft: 1, speed: 0.06, spread: 0.2 }, drive: 'low', depth: 0.2 },
      cloud: { on: true, p: { amount: 0.15, scale: 1, threshold: 0.6 } },
      ink: { on: true, p: { size: 0.35, bleed: 1, every: '4' } },
      fluid: { on: true, p: { force: 0.3, swirl: 0.3, stir: 0.1 } },
      mirror: { on: true, p: { mode: 'h' } },
      time: { p: { hold: 0.3, fade: 1.5, bleed: 0.3 } },
      colour: { p: { mode: 'gradient', blend: 'normal', cycle: 'off' } },
      contour: { on: true, p: { lines: 3, width: 0.5, mix: 1, ink: 'accent' } },
      blur: { on: true, p: { radius: 0.35, mix: 1 } },
      glow: { on: true, p: { intensity: 0.15 } },
      grain: { on: true, p: { amount: 0.35, colour: 0.6 } },
    },
  },
  {
    id: 'rain',
    name: 'Pixel Rain',
    note: 'Spectrum strata torn into neon streaks',
    palette: ['#ff2a1f', '#ff9a2e', '#39ff6a', '#ff4fd8', '#ffd23a'],
    background: '#050505',
    fx: {
      spectrum: { on: true, p: { layout: 'strata', position: 0.7, thickness: 0.2, gain: 1.2 } },
      wave: { on: true, p: { orient: 'h', position: 0.25, amplitude: 0.5, thickness: 0.006 } },
      ink: { on: true, p: { size: 0.25, bleed: 0.5 } },
      drift: { on: true, p: { angle: 270, speed: 0.35, streak: 0.95, columns: 140 } },
      fluid: { on: false },
      stretch: { on: true, p: { direction: 'down', cut: 0.62, jitter: 0.5, columns: 220 }, drive: 'low', depth: -0.12 },
      chroma: { on: true, p: { amount: 0.3 } },
      glitch: { on: true, p: { amount: 0.15, blocks: 20 } },
      time: { p: { hold: 0.3, fade: 2.2, bleed: 0.08 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'beat' } },
      glow: { on: true, p: { intensity: 0.3 } },
      grain: { on: true, p: { amount: 0.2 } },
    },
  },
  {
    id: 'drip',
    name: 'Drip',
    note: 'Paint melting down a teal wall, low-res',
    palette: ['#e0675f', '#f08a72', '#63e3b5', '#2d8a80', '#ffb39a'],
    background: '#0f5552',
    fx: {
      spectrum: { on: true, p: { layout: 'strata', position: 0.9, thickness: 0.06, gain: 1 } },
      ink: { on: true, p: { size: 0.22, bleed: 0.8, placement: 'edges', drops: 1, every: '2' } },
      melt: { on: true, p: { speed: 0.45, threshold: 0.35, columns: 26, wobble: 0.2 } },
      drift: { on: false },
      fluid: { on: false },
      time: { p: { hold: 0.8, fade: 3.5, bleed: 0.2 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'bar' } },
      pixelate: { on: true, p: { size: 5, mix: 1 } },
      dither: { on: true, p: { style: 'noise', levels: 12, mix: 0.5 } },
      grain: { on: true, p: { amount: 0.3 } },
    },
  },
  {
    id: 'liquid',
    name: 'Liquid Slice',
    note: 'One solid body, sliced and dripping',
    palette: ['#ff3d1f', '#ff4a24', '#f2361a', '#ff5a2e', '#e8321a'],
    background: '#fbf3c4',
    fx: {
      orbs: { on: true, p: { shape: 'capsule', count: 1, size: 0.52, soft: 0.25, speed: 0.04, spread: 0 }, drive: 'low', depth: 0.1 },
      ink: { on: true, p: { size: 0.2, bleed: 0.6, every: '4', placement: 'centre' } },
      melt: { on: true, p: { speed: 0.2, threshold: 0.6, columns: 18, wobble: 0.1 } },
      fluid: { on: false },
      time: { p: { hold: 0.2, fade: 1.4, bleed: 0.3 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'off' } },
      liquid: { on: true, p: { edge: 0.35, softness: 0.08, holes: 0.35, shine: 0.15 } },
      slices: { on: true, p: { axis: 'v', count: 5, offset: 0.08, gap: 0.25 }, drive: 'beat', depth: 0.25 },
      glow: { on: false },
      grain: { on: true, p: { amount: 0.08 } },
    },
  },
  {
    id: 'opal',
    name: 'Opal',
    note: 'Soft iridescent bands with glowing ridges',
    palette: ['#1d2b55', '#6aa9c9', '#f3c6d9', '#bfe6c8', '#8a5bd6'],
    background: '#22305c',
    fx: {
      spectrum: { on: true, p: { layout: 'strata', position: 0.5, thickness: 0.42, gain: 0.95 } },
      ink: { on: true, p: { size: 0.5, bleed: 2, every: '2' } },
      drift: { on: true, p: { angle: 270, speed: 0.1, streak: 0.8, columns: 8, hardness: 0.2, wobble: 0.15 } },
      fluid: { on: false },
      time: { p: { hold: 1.5, fade: 5, bleed: 0.6 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'beat' } },
      blur: { on: true, p: { radius: 0.6, mix: 1 } },
      sheen: { on: true, p: { amount: 0.25, ridges: 0.7, scale: 1.2 } },
      grain: { on: true, p: { amount: 0.12 } },
    },
  },
];

/** Apply a preset's look (effects, palette, background) to a project. */
export function applyPreset(project: Project, preset: Preset): void {
  const fx = defaultEffects();
  for (const e of EFFECTS) if (!e.alwaysOn) fx[e.id].on = false;
  for (const [id, o] of Object.entries(preset.fx)) {
    const st = fx[id];
    if (!st) continue;
    if (o.on !== undefined) st.on = o.on;
    else if (o.p) st.on = true;
    if (o.p) Object.assign(st.p, o.p);
    if (o.drive) st.drive = o.drive;
    if (o.depth !== undefined) st.depth = o.depth;
  }
  project.fx = fx;
  project.palette = preset.palette.slice();
  project.background = preset.background;
  project.name = preset.name;
}

export const PALETTES: { name: string; colors: string[]; bg: string }[] = PRESETS.map((p) => ({
  name: p.name,
  colors: p.palette,
  bg: p.background,
}));
