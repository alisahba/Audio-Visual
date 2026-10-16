// "Surprise me": a new look that stays tasteful. It starts from a random
// preset, borrows another palette, nudges every setting a little and sometimes
// adds one extra emitter and one extra post effect.

import { EFFECT_BY_ID, type RangeParam } from './defs';
import { PALETTES, PRESETS, applyPreset } from './presets';
import type { Project } from './project';

const EXTRA_EMIT = ['particles', 'shapes', 'scope', 'ridges', 'ink', 'cloud', 'orbs'];
const EXTRA_POST = ['echo', 'sway', 'chroma', 'glow', 'grain', 'slices', 'mirror', 'flash', 'sheen'];

export function surprise(p: Project, rnd: () => number = Math.random): string {
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const base = pick(PRESETS);
  applyPreset(p, base);

  if (rnd() < 0.6) {
    const pal = pick(PALETTES.filter((x) => x.name !== base.name));
    p.palette = pal.colors.slice();
    p.background = pal.bg;
  }
  // Nudge every numeric setting of the effects that are on by up to ±18% of its range.
  for (const [id, st] of Object.entries(p.fx)) {
    if (!st.on) continue;
    const def = EFFECT_BY_ID[id];
    for (const pd of def.params) {
      if (pd.type !== 'range') continue;
      const r = pd as RangeParam;
      const v = (st.p[r.key] as number) + (rnd() - 0.5) * 0.36 * (r.max - r.min);
      st.p[r.key] = Number((Math.round(Math.min(r.max, Math.max(r.min, v)) / r.step) * r.step).toFixed(4));
    }
  }
  const count = (g: string) => Object.entries(p.fx).filter(([id, st]) => st.on && EFFECT_BY_ID[id].group === g).length;
  if (rnd() < 0.55 && count('emit') < 3) {
    const id = pick(EXTRA_EMIT.filter((x) => !p.fx[x].on));
    if (id) p.fx[id].on = true;
  }
  if (rnd() < 0.55 && count('post') < 6) {
    const id = pick(EXTRA_POST.filter((x) => !p.fx[x].on));
    if (id) p.fx[id].on = true;
  }
  const cycles = ['beat', 'bar', 'beat', 'time'];
  if (rnd() < 0.3) p.fx.colour.p.cycle = pick(cycles);
  p.name = `${base.name} variation`;
  return base.name;
}
