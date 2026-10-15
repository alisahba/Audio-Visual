import type { Features } from '../audio/features';
import { EFFECT_BY_ID, type RangeParam } from './defs';
import type { Project } from './project';

/** Value of a numeric param after its audio drive is applied. */
export function modulated(project: Project, f: Features | null, fx: string, key: string): number {
  const st = project.fx[fx];
  const base = st.p[key] as number;
  const def = EFFECT_BY_ID[fx];
  if (!f || !def.drive || def.drive.param !== key || st.drive === 'none') return base;
  const pd = def.params.find((d) => d.key === key) as RangeParam;
  const src = f[st.drive];
  const v = base + st.depth * src * (pd.max - pd.min) * project.audio.reactivity;
  return Math.min(pd.max, Math.max(pd.min, v));
}
