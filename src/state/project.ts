import { EFFECTS, type Drive, type ParamValue } from './defs';

export interface EffectState {
  on: boolean;
  p: Record<string, ParamValue>;
  drive: Drive;
  depth: number;
}

export type BeatMode = 'onset' | 'grid';

export interface BeatSettings {
  /** Frequency window (Hz) used to detect beats. */
  lo: number;
  hi: number;
  /** 0..1, higher = more beats. */
  sensitivity: number;
  /** Minimum gap between beats (ms). */
  hold: number;
  mode: BeatMode;
  /** Grid mode: beats per detected tempo beat (0.25 = every bar, 2 = eighths). */
  division: number;
}

export interface AudioSettings {
  /** Master: how much the sound drives the picture (0..2). */
  reactivity: number;
  low: number;
  mid: number;
  high: number;
  /** Envelope follower, seconds. */
  attack: number;
  release: number;
  beat: BeatSettings;
}

export interface ClipSettings {
  /** Start of the clip inside the song (s). */
  start: number;
  /** Clip length (s). */
  duration: number;
  loop: boolean;
  snap: boolean;
}

export interface Project {
  v: 1;
  name: string;
  aspect: string;
  palette: string[];
  background: string;
  fx: Record<string, EffectState>;
  audio: AudioSettings;
  clip: ClipSettings;
  seed: number;
}

export const ASPECTS: { id: string; w: number; h: number }[] = [
  { id: '1:1', w: 1, h: 1 },
  { id: '4:5', w: 4, h: 5 },
  { id: '3:4', w: 3, h: 4 },
  { id: '9:16', w: 9, h: 16 },
  { id: '16:9', w: 16, h: 9 },
];

export function aspectRatio(id: string): number {
  const a = ASPECTS.find((x) => x.id === id) ?? ASPECTS[1];
  return a.w / a.h;
}

export function defaultEffects(): Record<string, EffectState> {
  const fx: Record<string, EffectState> = {};
  for (const e of EFFECTS) {
    const p: Record<string, ParamValue> = {};
    for (const d of e.params) p[d.key] = d.def;
    fx[e.id] = {
      on: !!(e.alwaysOn || e.defaultOn),
      p,
      drive: e.drive?.def ?? 'none',
      depth: e.drive?.depth ?? 0,
    };
  }
  return fx;
}

export function defaultProject(): Project {
  return {
    v: 1,
    name: 'Untitled',
    aspect: '4:5',
    palette: ['#ff3b1d', '#ff8a3d', '#7a3cff', '#f4efe6', '#ff2e7e'],
    background: '#0c0b0d',
    fx: defaultEffects(),
    audio: {
      reactivity: 1,
      low: 1,
      mid: 1,
      high: 1,
      attack: 0.02,
      release: 0.25,
      beat: { lo: 40, hi: 140, sensitivity: 0.5, hold: 120, mode: 'onset', division: 1 },
    },
    clip: { start: 0, duration: 30, loop: true, snap: true },
    seed: 7,
  };
}

/** Fill any fields missing from an older/foreign project file. */
export function normaliseProject(raw: unknown): Project {
  const base = defaultProject();
  if (!raw || typeof raw !== 'object') return base;
  const src = raw as Partial<Project>;
  const out: Project = {
    ...base,
    ...src,
    audio: { ...base.audio, ...(src.audio ?? {}), beat: { ...base.audio.beat, ...(src.audio?.beat ?? {}) } },
    clip: { ...base.clip, ...(src.clip ?? {}) },
    fx: base.fx,
    palette: Array.isArray(src.palette) && src.palette.length >= 2 ? src.palette.slice(0, 5) : base.palette,
  };
  while (out.palette.length < 5) out.palette.push(out.palette[out.palette.length - 1]);
  if (src.fx) {
    for (const id of Object.keys(base.fx)) {
      const f = src.fx[id];
      if (!f) continue;
      out.fx[id] = {
        on: typeof f.on === 'boolean' ? f.on : base.fx[id].on,
        p: { ...base.fx[id].p, ...(f.p ?? {}) },
        drive: f.drive ?? base.fx[id].drive,
        depth: typeof f.depth === 'number' ? f.depth : base.fx[id].depth,
      };
    }
  }
  return out;
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
