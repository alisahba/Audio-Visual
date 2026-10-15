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
    note: 'Smouldering strata, smeared and grainy; each kick drops a new colour',
    palette: ['#ff3b2f', '#ff7a45', '#6c4dff', '#ffd2b8', '#ff2f6d'],
    background: '#0a0909',
    fx: {
      spectrum: { on: true, p: { layout: 'strata', position: 0.42, thickness: 0.1, gain: 1 }, drive: 'level', depth: 0.55 },
      cloud: { on: true, p: { scale: 1.4, threshold: 0.6, amount: 0.15, speed: 0.4 } },
      ink: { on: true, p: { size: 0.45, bleed: 1.4, push: 0.3, placement: 'rise' }, drive: 'low', depth: 0.5 },
      particles: { on: true, p: { mode: 'fountain', amount: 0.12, size: 3, life: 2.4, speed: 0.6, chaos: 0.6, gravity: -0.3, follow: 0.4, spread: 1, ink: 1 }, drive: 'beat', depth: 0.35 },
      flow: { on: true, p: { speed: 0.08, scale: 1.4 } },
      drift: { on: true, p: { angle: 270, speed: 0.1, streak: 0.9, columns: 90 }, drive: 'low', depth: 0.6 },
      ripple: { on: true, p: { strength: 0.25, speed: 0.5, width: 0.1, origin: 'ink' } },
      time: { p: { hold: 0.6, fade: 3.5, bleed: 0.3 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'beat' } },
      chroma: { on: true, p: { amount: 0.12 }, drive: 'beat', depth: 0.35 },
      glow: { on: true, p: { intensity: 0.3, threshold: 0.65 }, drive: 'beat', depth: 0.4 },
      blur: { on: true, p: { radius: 0.1, mix: 0.5 } },
      grain: { on: true, p: { amount: 0.38, size: 1.6 } },
      vignette: { on: true, p: { amount: 0.25 } },
    },
  },
  {
    id: 'supernova',
    name: 'Supernova',
    note: 'Every beat explodes into thousands of sparks that swirl away',
    palette: ['#fff4d6', '#ffb13b', '#ff2e6e', '#3ad7ff', '#8b5bff'],
    background: '#05040a',
    fx: {
      particles: { on: true, p: { mode: 'burst', amount: 0.24, size: 4, life: 1.4, speed: 1.2, chaos: 0.25, gravity: 0, follow: 0.6, spread: 0.7, ink: 0.75 }, drive: 'level', depth: 0.3 },
      fluid: { on: true, p: { force: 0.45, swirl: 0.55, viscosity: 0.2, stir: 0.08 }, drive: 'beat', depth: 0.5 },
      ripple: { on: true, p: { strength: 0.3, speed: 0.8, width: 0.12, origin: 'random' } },
      ink: { on: false },
      time: { p: { hold: 0.1, fade: 1.1, bleed: 0.03 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'beat', saturation: 1.1 } },
      glow: { on: true, p: { intensity: 0.45, threshold: 0.5, radius: 0.7 }, drive: 'beat', depth: 0.45 },
      chroma: { on: true, p: { amount: 0.18 }, drive: 'beat', depth: 0.5 },
      grain: { on: true, p: { amount: 0.18 } },
      vignette: { on: true, p: { amount: 0.45 } },
    },
  },
  {
    id: 'konstrukt',
    name: 'Konstrukt',
    note: 'Swiss geometry stamped on the beat in primary colours',
    palette: ['#e8301c', '#1d3fd6', '#f5c400', '#121212', '#e8301c'],
    background: '#f1ece2',
    fx: {
      shapes: { on: true, p: { shape: 'mix', every: '1', place: 'grid', size: 0.3, grow: 0.2, stroke: 0.028, spin: 0.15, life: 2.2 }, drive: 'low', depth: 0.3 },
      ink: { on: false },
      time: { p: { hold: 0.05, fade: 0.35, bleed: 0 } },
      colour: { p: { mode: 'direct', blend: 'multiply', cycle: 'beat' } },
      slices: { on: true, p: { axis: 'h', count: 4, offset: 0, gap: 0 }, drive: 'beat', depth: 0.12 },
      glow: { on: false },
      dither: { on: true, p: { style: 'halftone', levels: 6, scale: 1.2, mix: 0.2 } },
      grain: { on: true, p: { amount: 0.1, colour: 0 } },
    },
  },
  {
    id: 'marble',
    name: 'Marble',
    note: 'Neon paint folded by a real fluid; drops hit on the kick',
    palette: ['#ff2e63', '#ff9a3c', '#27e0a3', '#7b5cff', '#ff7ad9'],
    background: '#0b0610',
    fx: {
      fluid: { on: true, p: { force: 1.4, swirl: 0.85, viscosity: 0.12, stir: 0.5 }, drive: 'beat', depth: 0.7 },
      ink: { on: true, p: { size: 0.3, bleed: 0.6, push: 1, drops: 2 }, drive: 'low', depth: 0.5 },
      time: { p: { hold: 0.6, fade: 2.5, bleed: 0.02 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'beat', saturation: 1.3 } },
      contour: { on: true, p: { lines: 8, width: 0.1, mix: 0.2, ink: 'dark' } },
      glow: { on: true, p: { intensity: 0.4, threshold: 0.55 }, drive: 'beat', depth: 0.35 },
      grain: { on: true, p: { amount: 0.14 } },
      vignette: { on: true, p: { amount: 0.4 } },
    },
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    note: 'An oscilloscope figure knotting itself to the sound',
    palette: ['#39ff88', '#b6ffd0', '#18c964', '#eaffef', '#0f8a44'],
    background: '#020403',
    fx: {
      scope: { on: true, p: { style: 'xy', scale: 1, twist: 30, thickness: 2, spin: 0.06, ink: 0.85 }, drive: 'level', depth: 0.45 },
      ink: { on: false },
      warp: { on: true, p: { zoom: -0.03, spin: 0.04, twist: 0 } },
      time: { p: { hold: 0.02, fade: 0.6, bleed: 0.02 } },
      colour: { p: { mode: 'direct', blend: 'add', cycle: 'off' } },
      glow: { on: true, p: { intensity: 0.65, threshold: 0.35, radius: 0.6 }, drive: 'beat', depth: 0.4 },
      chroma: { on: true, p: { amount: 0.06 } },
      grain: { on: true, p: { amount: 0.3 } },
      vignette: { on: true, p: { amount: 0.55 } },
    },
  },
  {
    id: 'corona',
    name: 'Corona',
    note: 'Each frequency fires sparks from its own angle of a ring',
    palette: ['#ffcf3a', '#ff6a2b', '#ff2d6f', '#7b3cff', '#2ec5ff'],
    background: '#060714',
    fx: {
      particles: { on: true, p: { mode: 'ring', amount: 0.17, size: 3.5, life: 1.1, speed: 1.3, chaos: 0.12, gravity: 0, follow: 0.4, spread: 0.55, ink: 0.85 }, drive: 'level', depth: 0.35 },
      spectrum: { on: true, p: { layout: 'radial', position: 0.48, thickness: 0.18, gain: 1.1 }, drive: 'level', depth: 0.4 },
      ink: { on: false },
      warp: { on: true, p: { zoom: 0.02, spin: 0.05, twist: 0.1 }, drive: 'beat', depth: 0.2 },
      time: { p: { hold: 0.1, fade: 0.8, bleed: 0.05 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'beat' } },
      glow: { on: true, p: { intensity: 0.45, threshold: 0.5 }, drive: 'beat', depth: 0.4 },
      grain: { on: true, p: { amount: 0.16 } },
      vignette: { on: true, p: { amount: 0.5 } },
    },
  },
  {
    id: 'murmuration',
    name: 'Murmuration',
    note: 'A flock of ink drawn across paper by the music',
    palette: ['#141414', '#2a2622', '#5d4f45', '#c2391f', '#1d1d1d'],
    background: '#ece7dc',
    fx: {
      particles: { on: true, p: { mode: 'swarm', amount: 0.15, size: 2.5, life: 4, speed: 1.2, chaos: 0.45, gravity: 0, follow: 1, spread: 0.7, ink: 0.8 }, drive: 'level', depth: 0.3 },
      flow: { on: true, p: { speed: 0.35, scale: 1.1, evolve: 0.25 }, drive: 'low', depth: 0.6 },
      ink: { on: false },
      time: { p: { hold: 0.3, fade: 2.6, bleed: 0.05 } },
      colour: { p: { mode: 'direct', blend: 'multiply', cycle: 'off' } },
      glow: { on: false },
      grain: { on: true, p: { amount: 0.2, colour: 0 } },
      vignette: { on: true, p: { amount: 0.12 } },
    },
  },
  {
    id: 'liquid',
    name: 'Liquid Slice',
    note: 'One solid body, sliced on the beat and dripping',
    palette: ['#ff3d1f', '#ff4a24', '#f2361a', '#ff5a2e', '#e8321a'],
    background: '#fbf3c4',
    fx: {
      orbs: { on: true, p: { shape: 'capsule', count: 1, size: 0.4, soft: 0.25, speed: 0.22, spread: 0.6 }, drive: 'beat', depth: 0.3 },
      ink: { on: true, p: { size: 0.24, bleed: 0.6, every: '1', placement: 'centre' } },
      melt: { on: true, p: { speed: 0.35, threshold: 0.55, columns: 18, wobble: 0.2 }, drive: 'low', depth: 0.6 },
      fluid: { on: false },
      time: { p: { hold: 0.2, fade: 1.4, bleed: 0.3 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'off' } },
      liquid: { on: true, p: { edge: 0.35, softness: 0.08, holes: 0.35, shine: 0.15 } },
      slices: { on: true, p: { axis: 'v', count: 5, offset: 0.12, gap: 0.25 }, drive: 'beat', depth: 0.55 },
      glow: { on: false },
      grain: { on: true, p: { amount: 0.08 } },
    },
  },
  {
    id: 'opal',
    name: 'Opal',
    note: 'Soft iridescent bands with ridges that flare with the music',
    palette: ['#1d2b55', '#6aa9c9', '#f3c6d9', '#bfe6c8', '#8a5bd6'],
    background: '#22305c',
    fx: {
      spectrum: { on: true, p: { layout: 'strata', position: 0.5, thickness: 0.42, gain: 0.95 }, drive: 'level', depth: 0.5 },
      ink: { on: true, p: { size: 0.5, bleed: 2, every: '2' } },
      drift: { on: true, p: { angle: 270, speed: 0.1, streak: 0.8, columns: 8, hardness: 0.2, wobble: 0.15 }, drive: 'low', depth: 0.4 },
      ripple: { on: true, p: { strength: 0.2, speed: 0.4, width: 0.18, origin: 'centre' } },
      fluid: { on: false },
      time: { p: { hold: 1.5, fade: 5, bleed: 0.6 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'beat' } },
      blur: { on: true, p: { radius: 0.6, mix: 1 } },
      sheen: { on: true, p: { amount: 0.3, ridges: 0.7, scale: 1.2 }, drive: 'level', depth: 0.5 },
      grain: { on: true, p: { amount: 0.12 } },
    },
  },
  {
    id: 'pastel',
    name: 'Pastel Melt',
    note: 'Soft columns of colour that slide faster with the bass',
    palette: ['#f6b8c8', '#c3f2bf', '#f7e7a6', '#b6c4ff', '#ff7a59'],
    background: '#f2ebe6',
    fx: {
      cloud: { on: true, p: { scale: 1.6, threshold: 0.6, amount: 0.12, speed: 0.3 } },
      ink: { on: true, p: { size: 0.55, bleed: 1.2, drops: 2, push: 0.2, placement: 'rise' }, drive: 'low', depth: 0.4 },
      drift: { on: true, p: { angle: 270, speed: 0.55, streak: 1, columns: 7, hardness: 1, wobble: 0 }, drive: 'low', depth: 0.8 },
      fluid: { on: false },
      time: { p: { hold: 2, fade: 5, bleed: 0.05 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'beat' } },
      glow: { on: false },
      grain: { on: true, p: { amount: 0.06 } },
    },
  },
  {
    id: 'rain',
    name: 'Pixel Rain',
    note: 'Neon rain and torn strata, glitching on the kick',
    palette: ['#ff2a1f', '#ff9a2e', '#39ff6a', '#ff4fd8', '#ffd23a'],
    background: '#050505',
    fx: {
      particles: { on: true, p: { mode: 'rain', amount: 0.32, size: 3, life: 2, speed: 1.4, chaos: 0.05, gravity: 0.3, follow: 0.3, spread: 0.2, ink: 0.9 }, drive: 'high', depth: 0.4 },
      spectrum: { on: true, p: { layout: 'strata', position: 0.78, thickness: 0.16, gain: 1.2 }, drive: 'level', depth: 0.4 },
      ink: { on: false },
      drift: { on: true, p: { angle: 270, speed: 0.35, streak: 0.95, columns: 140 }, drive: 'low', depth: 0.5 },
      fluid: { on: false },
      stretch: { on: true, p: { direction: 'down', cut: 0.62, jitter: 0.5, columns: 220 }, drive: 'low', depth: -0.2 },
      chroma: { on: true, p: { amount: 0.3 } },
      glitch: { on: true, p: { amount: 0.15, blocks: 20 }, drive: 'beat', depth: 0.8 },
      pixelate: { on: true, p: { size: 3, mix: 1 } },
      time: { p: { hold: 0.3, fade: 2.2, bleed: 0.08 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'beat' } },
      glow: { on: true, p: { intensity: 0.3 } },
      grain: { on: true, p: { amount: 0.2 } },
    },
  },
  {
    id: 'paper',
    name: 'Paper Bleed',
    note: 'Ink drops soaking into paper, a new one every other beat',
    palette: ['#ff8a7a', '#ffc46b', '#8fb3ff', '#ff9ad5', '#9ee0c0'],
    background: '#efe6d2',
    fx: {
      ink: { on: true, p: { size: 0.32, bleed: 2.2, drops: 1, push: 0.35, placement: 'random', every: '2' }, drive: 'low', depth: 0.45 },
      fluid: { on: true, p: { force: 0.35, swirl: 0.25, viscosity: 0.55, stir: 0.1 }, drive: 'beat', depth: 0.4 },
      time: { p: { hold: 0.8, fade: 3.2, bleed: 0.35 } },
      colour: { p: { mode: 'direct', blend: 'multiply', cycle: 'beat' } },
      contour: { on: true, p: { lines: 4, width: 0.12, mix: 0.3, ink: 'dark' } },
      blur: { on: true, p: { radius: 0.08, mix: 0.4 } },
      glow: { on: false },
      grain: { on: true, p: { amount: 0.16, colour: 0 } },
      vignette: { on: true, p: { amount: 0.15 } },
    },
  },
  {
    id: 'drip',
    name: 'Drip',
    note: 'Paint melting down a teal wall, low-res',
    palette: ['#e0675f', '#f08a72', '#63e3b5', '#2d8a80', '#ffb39a'],
    background: '#0f5552',
    fx: {
      spectrum: { on: true, p: { layout: 'strata', position: 0.9, thickness: 0.06, gain: 1 }, drive: 'level', depth: 0.5 },
      ink: { on: true, p: { size: 0.26, bleed: 0.8, placement: 'edges', drops: 2, every: '1' }, drive: 'low', depth: 0.4 },
      melt: { on: true, p: { speed: 0.45, threshold: 0.35, columns: 26, wobble: 0.2 }, drive: 'low', depth: 0.5 },
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
    id: 'thermal',
    name: 'Thermal',
    note: 'Bodies and kicks read through a heat-map camera',
    palette: ['#120036', '#5a12ff', '#ff2d55', '#ffb21f', '#fff6c8'],
    background: '#120036',
    fx: {
      orbs: { on: true, p: { shape: 'circle', count: 3, size: 0.24, soft: 0.85, speed: 0.3, spread: 0.6 }, drive: 'low', depth: 0.55 },
      ink: { on: true, p: { size: 0.3, bleed: 0.9, push: 0.8, drops: 1 }, drive: 'low', depth: 0.5 },
      fluid: { on: true, p: { force: 0.6, swirl: 0.4, viscosity: 0.35, stir: 0.2 }, drive: 'beat', depth: 0.6 },
      time: { p: { hold: 0.2, fade: 1.3, bleed: 0.25 } },
      colour: { p: { mode: 'gradient', blend: 'normal', cycle: 'off' } },
      blur: { on: true, p: { radius: 0.35, mix: 1 } },
      contour: { on: true, p: { lines: 6, width: 0.15, mix: 0.25, ink: 'light' } },
      glow: { on: true, p: { intensity: 0.2 } },
      grain: { on: true, p: { amount: 0.14 } },
    },
  },
  {
    id: 'mandala',
    name: 'Mandala',
    note: 'A kaleidoscope that turns with the music and blooms on the beat',
    palette: ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f8f1e7'],
    background: '#0b1026',
    fx: {
      spectrum: { on: true, p: { layout: 'radial', position: 0.55, thickness: 0.22, gain: 1 }, drive: 'level', depth: 0.4 },
      shapes: { on: true, p: { shape: 'triangle', every: '2', place: 'random', size: 0.3, grow: 1.2, stroke: 0.02, spin: 0.4, life: 1.6 } },
      cloud: { on: true, p: { scale: 2.2, threshold: 0.62, amount: 0.12, speed: 0.4 } },
      ink: { on: false },
      warp: { on: true, p: { zoom: 0.1, spin: 0.08, twist: 0.2 }, drive: 'beat', depth: 0.3 },
      time: { p: { hold: 0.3, fade: 1.6, bleed: 0.15 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'beat' } },
      mirror: { on: true, p: { mode: 'kaleido', segments: 8, rotate: 0 }, drive: 'wave', depth: 0.25 },
      glow: { on: true, p: { intensity: 0.35, threshold: 0.55 }, drive: 'beat', depth: 0.3 },
      grain: { on: true, p: { amount: 0.14 } },
      vignette: { on: true, p: { amount: 0.35 } },
    },
  },
  {
    id: 'capsule',
    name: 'Capsule',
    note: 'A single glowing body that swells with the bass and melts',
    palette: ['#8fdc2a', '#ff6a1f', '#f2c12e', '#ff3b1f', '#c9f59a'],
    background: '#10272b',
    fx: {
      orbs: { on: true, p: { shape: 'capsule', count: 1, size: 0.3, soft: 0.35, speed: 0.05, spread: 0 }, drive: 'beat', depth: 0.4 },
      melt: { on: true, p: { speed: 0.35, threshold: 0.4, columns: 30, wobble: 0.25 }, drive: 'low', depth: 0.5 },
      ripple: { on: true, p: { strength: 0.3, speed: 0.5, width: 0.1, origin: 'centre' } },
      flow: { on: true, p: { speed: 0.03, scale: 1.2 } },
      ink: { on: false },
      fluid: { on: false },
      time: { p: { hold: 0.1, fade: 1.6, bleed: 0.45 } },
      colour: { p: { mode: 'direct', blend: 'normal', cycle: 'bar' } },
      glow: { on: true, p: { intensity: 0.35, threshold: 0.5, radius: 0.8 }, drive: 'beat', depth: 0.4 },
      blur: { on: true, p: { radius: 0.08, mix: 0.7 } },
      glitch: { on: true, p: { amount: 0.05, blocks: 12 }, drive: 'beat', depth: 0.3 },
      dither: { on: true, p: { style: 'noise', levels: 14, scale: 1.5, mix: 0.6 } },
      grain: { on: true, p: { amount: 0.2 } },
      vignette: { on: true, p: { amount: 0.35 } },
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
  project.groupsOff = {};
  project.palette = preset.palette.slice();
  project.background = preset.background;
  project.name = preset.name;
}

export const PALETTES: { name: string; colors: string[]; bg: string }[] = PRESETS.map((p) => ({
  name: p.name,
  colors: p.palette,
  bg: p.background,
}));
