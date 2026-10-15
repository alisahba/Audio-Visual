import { FeatureFollower, makeRaw, type FeatureSource } from '../audio/features';
import type { Project } from '../state/project';
import type { Renderer } from './renderer';

/** Internal simulation rate. Preview and export both step at this rate, so they match. */
export const SIM_HZ = 60;
const DT = 1 / SIM_HZ;

/** Drives a renderer through song time with a fixed timestep. */
export class SimDriver {
  readonly follower = new FeatureFollower();
  private raw = makeRaw();
  /** Song time of the last simulated step. */
  songTime = 0;
  /** Song time at which the clip starts (for fade-in and the Time drive). */
  clipStart = 0;
  clipDuration = 30;
  /** Period of the Wave drive in seconds. */
  wavePeriod = 4;

  constructor(public renderer: Renderer) {}

  get features() {
    return this.follower.f;
  }

  reset(project: Project, songTime: number, bpm = 0): void {
    this.clipDuration = project.clip.duration;
    this.wavePeriod = bpm > 0 ? (8 * 60) / bpm : 4;
    this.renderer.reset(project.seed);
    this.follower.reset();
    this.songTime = songTime;
  }

  /** Step until `target` song time. Returns the number of steps taken. */
  advanceTo(target: number, feed: FeatureSource | null, project: Project, maxSteps = Infinity): number {
    let n = 0;
    while (this.songTime + DT <= target + 1e-9 && n < maxSteps) {
      this.stepOnce(feed, project);
      n++;
    }
    // Falling behind (slow GPU): drop time rather than spiral.
    if (n >= maxSteps && target - this.songTime > DT * 2) this.songTime = target - DT;
    return n;
  }

  stepOnce(feed: FeatureSource | null, project: Project): void {
    const t0 = this.songTime;
    const t1 = t0 + DT;
    let beats = 0;
    if (feed) beats = feed.sample(t0, t1, this.raw);
    else {
      this.raw.low = this.raw.mid = this.raw.high = this.raw.level = 0;
      this.raw.bands.fill(0);
      this.raw.wave.fill(0);
    }
    const f = this.follower.step(DT, this.raw, beats, project.audio);
    const ct = t1 - this.clipStart;
    f.time = Math.min(1, Math.max(0, ct / Math.max(0.1, this.clipDuration)));
    f.wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * ct) / Math.max(0.1, this.wavePeriod));
    this.renderer.step(DT, f, project);
    this.songTime = t1;
  }

  render(project: Project): void {
    this.renderer.render(project, this.follower.f, this.songTime - this.clipStart);
  }
}
