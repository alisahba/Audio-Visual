// Declarative effect/parameter model. The UI is generated from these
// definitions and the renderer reads the resulting state every frame.

export type Drive = 'none' | 'low' | 'mid' | 'high' | 'level' | 'beat' | 'time' | 'wave';

export const DRIVES: { value: Drive; label: string }[] = [
  { value: 'none', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Mid' },
  { value: 'high', label: 'High' },
  { value: 'level', label: 'Level' },
  { value: 'beat', label: 'Beat' },
  { value: 'time', label: 'Time' },
  { value: 'wave', label: 'Wave' },
];

export type Group = 'emit' | 'motion' | 'time' | 'colour' | 'post';

export const GROUPS: { id: Group; num: string; label: string; hint: string }[] = [
  { id: 'emit', num: '03', label: 'Emit', hint: 'What paints colour into the canvas' },
  { id: 'motion', num: '04', label: 'Motion', hint: 'How the paint moves' },
  { id: 'time', num: '05', label: 'Time', hint: 'How long colour stays before it fades' },
  { id: 'colour', num: '06', label: 'Colour', hint: 'Palette, background and mapping' },
  { id: 'post', num: '07', label: 'Post', hint: 'Lens and surface effects' },
];

interface BaseParam {
  key: string;
  label: string;
}
export interface RangeParam extends BaseParam {
  type: 'range';
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
  /** Number of decimals shown in the readout. */
  dp?: number;
}
export interface SelectParam extends BaseParam {
  type: 'select';
  options: { value: string; label: string }[];
  def: string;
}
export interface ToggleParam extends BaseParam {
  type: 'toggle';
  def: boolean;
}
export type ParamDef = RangeParam | SelectParam | ToggleParam;
export type ParamValue = number | string | boolean;

export interface EffectDef {
  id: string;
  group: Group;
  label: string;
  hint: string;
  params: ParamDef[];
  /** Param modulated by the audio drive. */
  drive?: { param: string; def: Drive; depth: number };
  alwaysOn?: boolean;
  defaultOn?: boolean;
}

const r = (
  key: string,
  label: string,
  min: number,
  max: number,
  def: number,
  step = 0.01,
  unit?: string,
  dp?: number,
): RangeParam => ({ type: 'range', key, label, min, max, def, step, unit, dp });
const s = (key: string, label: string, options: [string, string][], def: string): SelectParam => ({
  type: 'select',
  key,
  label,
  options: options.map(([value, l]) => ({ value, label: l })),
  def,
});

export const EFFECTS: EffectDef[] = [
  // ── Emit ────────────────────────────────────────────────────────────────
  {
    id: 'orbs',
    group: 'emit',
    label: 'Orbs',
    hint: 'Soft luminous bodies that breathe with the low end',
    params: [
      s('shape', 'Shape', [['circle', 'Circle'], ['capsule', 'Capsule'], ['ring', 'Ring']], 'circle'),
      r('count', 'Count', 1, 6, 3, 1, '', 0),
      r('size', 'Size', 0.04, 0.8, 0.26),
      r('soft', 'Softness', 0, 1, 0.6),
      r('speed', 'Orbit', 0, 2, 0.35),
      r('spread', 'Spread', 0, 1, 0.55),
    ],
    drive: { param: 'size', def: 'low', depth: 0.55 },
  },
  {
    id: 'spectrum',
    group: 'emit',
    label: 'Spectrum',
    hint: 'Frequency bands painted as strata, columns or rings',
    params: [
      s('layout', 'Layout', [['strata', 'Strata'], ['columns', 'Columns'], ['radial', 'Radial'], ['horizon', 'Horizon']], 'strata'),
      r('position', 'Position', 0, 1, 0.5),
      r('thickness', 'Thickness', 0.01, 0.6, 0.18),
      r('gain', 'Gain', 0, 2, 1),
    ],
    drive: { param: 'gain', def: 'level', depth: 0.35 },
  },
  {
    id: 'wave',
    group: 'emit',
    label: 'Waveform',
    hint: 'The raw signal drawn as a ribbon',
    params: [
      s('orient', 'Axis', [['h', 'Horizontal'], ['v', 'Vertical'], ['circle', 'Circle']], 'h'),
      r('position', 'Position', 0, 1, 0.5),
      r('amplitude', 'Amplitude', 0, 1, 0.35),
      r('thickness', 'Thickness', 0.001, 0.06, 0.008, 0.001, '', 3),
    ],
    drive: { param: 'amplitude', def: 'level', depth: 0.4 },
  },
  {
    id: 'ink',
    group: 'emit',
    label: 'Beat Ink',
    hint: 'Each beat drops a new colour that bleeds into the image',
    defaultOn: true,
    params: [
      r('size', 'Size', 0.05, 1, 0.38),
      r('bleed', 'Spread time', 0.1, 4, 1.2, 0.05, 's', 2),
      r('push', 'Push', 0, 1, 0.5),
      r('drops', 'Drops', 1, 4, 1, 1, '', 0),
      s('every', 'Every', [['1', 'Beat'], ['2', '2 beats'], ['4', 'Bar'], ['8', '2 bars']], '1'),
      s('placement', 'Placement', [['random', 'Random'], ['centre', 'Centre'], ['edges', 'Edges'], ['rise', 'Rise']], 'random'),
    ],
    drive: { param: 'size', def: 'low', depth: 0.4 },
  },
  {
    id: 'cloud',
    group: 'emit',
    label: 'Cloud',
    hint: 'Continuous noise field that feeds colour in',
    params: [
      r('scale', 'Scale', 0.3, 8, 2.2),
      r('threshold', 'Threshold', 0, 1, 0.55),
      r('speed', 'Evolve', 0, 2, 0.3),
      r('amount', 'Amount', 0, 1, 0.35),
    ],
    drive: { param: 'amount', def: 'mid', depth: 0.5 },
  },
  {
    id: 'particles',
    group: 'emit',
    label: 'Particles',
    hint: 'Thousands of sparks that burst, rise, swarm or fall with the music and leave colour behind',
    params: [
      s('mode', 'Mode', [['burst', 'Burst on beat'], ['fountain', 'Fountain'], ['swarm', 'Swarm'], ['rain', 'Rain'], ['ring', 'Spectrum ring']], 'burst'),
      r('amount', 'Amount', 0, 1, 0.25),
      r('size', 'Size', 1, 40, 5, 0.5, 'px', 1),
      r('life', 'Life', 0.2, 8, 2.2, 0.1, 's', 1),
      r('speed', 'Speed', 0, 2, 0.7),
      r('chaos', 'Chaos', 0, 1, 0.3),
      r('gravity', 'Gravity', -1, 1, 0),
      r('follow', 'Follow motion', 0, 1, 0.6),
      r('spread', 'Spread', 0, 1, 0.5),
      r('ink', 'Ink', 0, 1, 0.8),
    ],
    drive: { param: 'amount', def: 'level', depth: 0.4 },
  },
  {
    id: 'shapes',
    group: 'emit',
    label: 'Shapes',
    hint: 'Bold geometry stamped on the beat: rings, squares, triangles, bars',
    params: [
      s('shape', 'Shape', [['ring', 'Ring'], ['disc', 'Disc'], ['square', 'Square'], ['triangle', 'Triangle'], ['bar', 'Bar'], ['cross', 'Cross'], ['mix', 'Mixed']], 'ring'),
      s('every', 'Every', [['1', 'Beat'], ['2', '2 beats'], ['4', 'Bar'], ['8', '2 bars']], '1'),
      s('place', 'Place', [['centre', 'Centre'], ['grid', 'Grid'], ['random', 'Random']], 'centre'),
      r('size', 'Size', 0.05, 1.2, 0.4),
      r('grow', 'Grow', 0, 3, 0.8),
      r('stroke', 'Line', 0.003, 0.15, 0.025, 0.001, '', 3),
      r('spin', 'Spin', -1, 1, 0),
      r('life', 'Life', 0.1, 4, 1.1, 0.05, 's', 2),
    ],
    drive: { param: 'size', def: 'low', depth: 0.3 },
  },
  {
    id: 'scope',
    group: 'emit',
    label: 'Scope',
    hint: 'The waveform drawn against itself: an oscilloscope figure that knots and loops with the sound',
    params: [
      s('style', 'Style', [['xy', 'Loops'], ['spiral', 'Spiral']], 'xy'),
      r('scale', 'Size', 0.1, 2, 1),
      r('twist', 'Twist', 1, 96, 28, 1, '', 0),
      r('thickness', 'Line', 1, 16, 3, 0.5, 'px', 1),
      r('spin', 'Spin', -1, 1, 0.1),
      r('ink', 'Ink', 0, 1, 0.7),
    ],
    drive: { param: 'scale', def: 'level', depth: 0.3 },
  },
  {
    id: 'media',
    group: 'emit',
    label: 'Media',
    hint: 'An image, video or your camera, painted in and treated like the colour',
    params: [
      s('subject', 'Subject', [['full', 'Full frame'], ['body', 'Body'], ['hands', 'Hands'], ['face', 'Face']], 'full'),
      s('look', 'Look', [['palette', 'Palette'], ['tint', 'Tint'], ['ink', 'Ink'], ['original', 'Original']], 'palette'),
      s('inject', 'Paint', [['flow', 'Always'], ['beat', 'On beat'], ['bar', 'On bar']], 'flow'),
      r('amount', 'Amount', 0, 1, 0.45),
      r('key', 'Key', 0, 1, 0.15),
      r('scale', 'Scale', 0.2, 2, 1),
      r('x', 'Offset X', -1, 1, 0),
      r('y', 'Offset Y', -1, 1, 0),
      r('speed', 'Video speed', 0.25, 2, 1, 0.05, '×', 2),
    ],
    drive: { param: 'amount', def: 'level', depth: 0.35 },
  },

  // ── Motion ──────────────────────────────────────────────────────────────
  {
    id: 'fluid',
    group: 'motion',
    label: 'Fluid',
    hint: 'Physical liquid: beats stir, colours marble',
    defaultOn: true,
    params: [
      r('force', 'Force', 0, 2, 0.9),
      r('swirl', 'Swirl', 0, 1, 0.45),
      r('viscosity', 'Viscosity', 0, 1, 0.35),
      r('stir', 'Stir', 0, 1, 0.3),
      r('gravity', 'Gravity', -1, 1, 0),
      r('splat', 'Splat size', 0.2, 3, 1),
    ],
    drive: { param: 'force', def: 'beat', depth: 0.6 },
  },
  {
    id: 'flow',
    group: 'motion',
    label: 'Flow Field',
    hint: 'Curl-noise currents, like smoke',
    params: [
      r('scale', 'Scale', 0.3, 6, 1.8),
      r('speed', 'Speed', 0, 1, 0.22),
      r('evolve', 'Evolve', 0, 1, 0.2),
      r('detail', 'Detail', 0, 1, 0.3),
      r('bias', 'Lean', 0, 1, 0),
      r('angle', 'Lean angle', 0, 360, 90, 1, '°', 0),
    ],
    drive: { param: 'speed', def: 'mid', depth: 0.5 },
  },
  {
    id: 'drift',
    group: 'motion',
    label: 'Drift',
    hint: 'Directional smear, drips and streaks',
    params: [
      r('angle', 'Direction', 0, 360, 270, 1, '°', 0),
      r('speed', 'Speed', 0, 1, 0.18),
      r('streak', 'Streak', 0, 1, 0.65),
      r('columns', 'Columns', 4, 200, 60, 1, '', 0),
      r('hardness', 'Hardness', 0, 1, 0.8),
      r('wobble', 'Wobble', 0, 1, 0),
    ],
    drive: { param: 'speed', def: 'low', depth: 0.5 },
  },
  {
    id: 'warp',
    group: 'motion',
    label: 'Zoom / Spin',
    hint: 'Feedback tunnel: everything flows toward or away from a centre',
    params: [
      r('zoom', 'Zoom', -1, 1, 0.12),
      r('spin', 'Spin', -1, 1, 0.0),
      r('twist', 'Twist', -1, 1, 0),
      r('cx', 'Centre X', -0.5, 0.5, 0),
      r('cy', 'Centre Y', -0.5, 0.5, 0),
    ],
    drive: { param: 'zoom', def: 'beat', depth: 0.3 },
  },
  {
    id: 'melt',
    group: 'motion',
    label: 'Melt',
    hint: 'Dense paint drips downward in uneven columns',
    params: [
      r('speed', 'Speed', 0, 1, 0.35),
      r('threshold', 'Weight', 0, 1, 0.35),
      r('columns', 'Drips', 4, 160, 48, 1, '', 0),
      r('wobble', 'Wobble', 0, 1, 0.25),
      r('angle', 'Direction', 0, 360, 270, 1, '°', 0),
    ],
    drive: { param: 'speed', def: 'low', depth: 0.4 },
  },
  {
    id: 'ripple',
    group: 'motion',
    label: 'Ripple',
    hint: 'Each beat sends a ring wave through the paint',
    params: [
      r('strength', 'Strength', 0, 1, 0.45),
      r('speed', 'Speed', 0.1, 2, 0.6),
      r('width', 'Width', 0.02, 0.5, 0.12),
      s('origin', 'Origin', [['centre', 'Centre'], ['random', 'Random'], ['ink', 'Ink']], 'centre'),
    ],
  },

  // ── Time ────────────────────────────────────────────────────────────────
  {
    id: 'time',
    group: 'time',
    label: 'Persistence',
    hint: 'Hold keeps colour at full strength, then it fades out',
    alwaysOn: true,
    params: [
      r('hold', 'Hold', 0, 20, 1.5, 0.1, 's', 1),
      r('fade', 'Fade out', 0.1, 30, 5, 0.1, 's', 1),
      r('bleed', 'Bleed', 0, 1, 0.25),
      r('intro', 'Fade in', 0, 10, 0, 0.1, 's', 1),
    ],
    drive: { param: 'bleed', def: 'none', depth: 0.3 },
  },

  // ── Colour ──────────────────────────────────────────────────────────────
  {
    id: 'colour',
    group: 'colour',
    label: 'Mapping',
    hint: 'How paint meets the background',
    alwaysOn: true,
    params: [
      s('mode', 'Mode', [['direct', 'Direct'], ['gradient', 'Gradient'], ['spectral', 'Spectral']], 'direct'),
      s('blend', 'Blend', [['normal', 'Normal'], ['add', 'Add'], ['multiply', 'Multiply'], ['screen', 'Screen']], 'normal'),
      s('cycle', 'Cycle on', [['beat', 'Beat'], ['bar', 'Bar'], ['time', 'Time'], ['off', 'Off']], 'beat'),
      r('hue', 'Hue shift', -180, 180, 0, 1, '°', 0),
      r('saturation', 'Saturation', 0, 2, 1),
      r('contrast', 'Contrast', 0.5, 2, 1),
      r('exposure', 'Exposure', -1, 1, 0),
    ],
    drive: { param: 'hue', def: 'none', depth: 0.25 },
  },

  // ── Post ────────────────────────────────────────────────────────────────
  {
    id: 'mirror',
    group: 'post',
    label: 'Mirror',
    hint: 'Symmetry and kaleidoscope',
    params: [
      s('mode', 'Mode', [['h', 'Left|Right'], ['v', 'Top|Bottom'], ['quad', 'Quad'], ['kaleido', 'Kaleido']], 'h'),
      r('segments', 'Segments', 3, 12, 6, 1, '', 0),
      r('rotate', 'Rotate', 0, 1, 0),
    ],
    drive: { param: 'rotate', def: 'none', depth: 0.2 },
  },
  {
    id: 'stretch',
    group: 'post',
    label: 'Pixel Stretch',
    hint: 'Pixels past a cut line are dragged into streaks',
    params: [
      s('direction', 'Direction', [['down', 'Down'], ['up', 'Up'], ['left', 'Left'], ['right', 'Right']], 'down'),
      r('cut', 'Cut', 0, 1, 0.62),
      r('jitter', 'Jitter', 0, 1, 0.35),
      r('columns', 'Columns', 8, 400, 140, 1, '', 0),
    ],
    drive: { param: 'cut', def: 'low', depth: -0.15 },
  },
  {
    id: 'glitch',
    group: 'post',
    label: 'Glitch',
    hint: 'Block displacement that snaps on the beat',
    params: [r('blocks', 'Blocks', 2, 48, 14, 1, '', 0), r('amount', 'Amount', 0, 1, 0.25), r('shift', 'Shift', 0, 1, 0.3)],
    drive: { param: 'amount', def: 'beat', depth: 0.6 },
  },
  {
    id: 'slices',
    group: 'post',
    label: 'Slices',
    hint: 'The image cut into strips that slide against each other',
    params: [
      s('axis', 'Cut', [['v', 'Vertical'], ['h', 'Horizontal']], 'v'),
      r('count', 'Strips', 2, 40, 6, 1, '', 0),
      r('offset', 'Offset', 0, 1, 0.12),
      r('gap', 'Seam', 0, 1, 0.2),
    ],
    drive: { param: 'offset', def: 'beat', depth: 0.3 },
  },
  {
    id: 'pixelate',
    group: 'post',
    label: 'Pixelate',
    hint: 'Coarse mosaic, like a low-res capture',
    params: [r('size', 'Block', 1, 64, 6, 1, 'px', 0), r('mix', 'Mix', 0, 1, 1)],
    drive: { param: 'size', def: 'none', depth: 0.2 },
  },
  {
    id: 'chroma',
    group: 'post',
    label: 'RGB Split',
    hint: 'Chromatic aberration',
    params: [r('amount', 'Amount', 0, 1, 0.18), r('angle', 'Angle', 0, 360, 0, 1, '°', 0), r('radial', 'Radial', 0, 1, 0.5)],
    drive: { param: 'amount', def: 'beat', depth: 0.4 },
  },
  {
    id: 'blur',
    group: 'post',
    label: 'Soft Focus',
    hint: 'Gaussian blur, from haze to fog',
    params: [r('radius', 'Radius', 0, 1, 0.25), r('mix', 'Mix', 0, 1, 1)],
    drive: { param: 'radius', def: 'none', depth: 0.3 },
  },
  {
    id: 'liquid',
    group: 'post',
    label: 'Liquid',
    hint: 'Turns soft paint into solid shapes with crisp liquid edges',
    params: [
      r('edge', 'Edge', 0, 1, 0.4),
      r('softness', 'Softness', 0, 1, 0.15),
      r('holes', 'Bubbles', 0, 1, 0.2),
      r('shine', 'Shine', 0, 1, 0.25),
    ],
    drive: { param: 'edge', def: 'none', depth: 0.2 },
  },
  {
    id: 'sheen',
    group: 'post',
    label: 'Sheen',
    hint: 'Iridescent film with glowing ridge lines',
    params: [r('amount', 'Iridescence', 0, 1, 0.6), r('ridges', 'Ridges', 0, 1, 0.6), r('scale', 'Bands', 0.5, 8, 2.5)],
    drive: { param: 'ridges', def: 'level', depth: 0.25 },
  },
  {
    id: 'glow',
    group: 'post',
    label: 'Glow',
    hint: 'Bloom around bright colour',
    defaultOn: true,
    params: [r('intensity', 'Intensity', 0, 2, 0.55), r('threshold', 'Threshold', 0, 1, 0.55), r('radius', 'Radius', 0, 1, 0.6)],
    drive: { param: 'intensity', def: 'level', depth: 0.35 },
  },
  {
    id: 'contour',
    group: 'post',
    label: 'Contour',
    hint: 'Iso-lines traced through the colour field',
    params: [
      r('lines', 'Lines', 1, 24, 4, 1, '', 0),
      r('width', 'Width', 0, 1, 0.3),
      r('mix', 'Mix', 0, 1, 0.85),
      s('ink', 'Ink', [['accent', 'Accent'], ['dark', 'Dark'], ['light', 'Light'], ['invert', 'Invert']], 'accent'),
    ],
    drive: { param: 'width', def: 'none', depth: 0.3 },
  },
  {
    id: 'dither',
    group: 'post',
    label: 'Dither',
    hint: 'Ordered dots, noise or halftone screen',
    params: [
      s('style', 'Style', [['bayer', 'Bayer'], ['noise', 'Noise'], ['halftone', 'Halftone']], 'noise'),
      r('levels', 'Levels', 2, 32, 10, 1, '', 0),
      r('scale', 'Scale', 1, 8, 1.5, 0.5, '', 1),
      r('mix', 'Mix', 0, 1, 1),
    ],
  },
  {
    id: 'grain',
    group: 'post',
    label: 'Grain',
    hint: 'Film grain over everything',
    defaultOn: true,
    params: [r('amount', 'Amount', 0, 1, 0.22), r('size', 'Size', 1, 4, 1.4, 0.1, '', 1), r('colour', 'Colour', 0, 1, 0.3)],
    drive: { param: 'amount', def: 'high', depth: 0.25 },
  },
  {
    id: 'vignette',
    group: 'post',
    label: 'Vignette',
    hint: 'Darken toward the frame edge',
    params: [r('amount', 'Amount', 0, 1, 0.3), r('softness', 'Softness', 0, 1, 0.6)],
  },
];

export const EFFECT_BY_ID: Record<string, EffectDef> = Object.fromEntries(EFFECTS.map((e) => [e.id, e]));

export function paramDef(fx: string, key: string): ParamDef | undefined {
  return EFFECT_BY_ID[fx]?.params.find((p) => p.key === key);
}
