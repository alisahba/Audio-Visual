import { BAND_COUNT, BEAT_PRESETS, formatHz, freqToX, xToFreq } from '../audio/bands';
import type { Features } from '../audio/features';
import type { BeatMode } from '../state/project';
import { store } from '../state/store';
import { rangeRow, segmented, type RangeRow } from './controls';
import { clamp, cssVar, fitCanvas, h } from './dom';
import { Section } from './section';

type DragMode = 'lo' | 'hi' | 'move';

/** Section 02: where beats come from, how hard the sound pushes the picture, and sync. */
export class ResponsePanel {
  readonly el: HTMLElement;
  readonly section: Section;
  private canvas: HTMLCanvasElement;
  private bar: HTMLElement;
  private pill: HTMLElement;
  private lamp: HTMLElement;
  private bpmEl: HTMLElement;
  private countEl: HTMLElement;
  private latencyEl: HTMLElement;
  private peak = new Float32Array(BAND_COUNT);
  private presetSeg: { el: HTMLElement; set: (v: string) => void };
  private modeSeg: { el: HTMLElement; set: (v: BeatMode) => void };
  private divSeg: { el: HTMLElement; set: (v: number) => void };
  private divRow: HTMLElement;
  private onsetRows: HTMLElement;
  private pickWrap: HTMLElement;
  private ranges: Record<string, RangeRow> = {};
  private lvls: Record<string, HTMLElement> = {};
  private drag: null | { mode: DragMode; x0: number; lo0: number; hi0: number } = null;
  bpm = 0;

  constructor(
    private syncMs: () => number,
    private setSyncMs: (ms: number) => void,
    private latencyMs: () => number,
  ) {
    this.canvas = h('canvas');
    this.pill = h('div', { class: 'band-pill' }, h('i', { class: 'grip' }));
    this.bar = h('div', { class: 'band-bar', title: 'Drag to move the beat window; drag its ends to resize' }, this.pill);
    const pick = h('div', { class: 'bandpick', title: 'Drag the window, its edges or the bar below. Scroll to resize, double-click to reset.' }, this.canvas);
    this.pickWrap = h('div', { class: 'pick-wrap' }, pick, this.bar);
    this.lamp = h('i');
    this.bpmEl = h('span', null, '— BPM');
    this.countEl = h('span', null, '');
    this.latencyEl = h('span', null, '');

    const b = store.p.audio.beat;
    this.presetSeg = segmented<string>({
      options: BEAT_PRESETS.map((p) => ({ value: p.id, label: p.label, title: `${formatHz(p.lo)}–${formatHz(p.hi)} Hz` })),
      value: this.matchPreset(),
      onChange: (id) => {
        const pr = BEAT_PRESETS.find((x) => x.id === id)!;
        store.update('beat', (p) => {
          p.audio.beat.lo = pr.lo;
          p.audio.beat.hi = pr.hi;
          p.audio.beat.hold = pr.hold;
          p.audio.beat.mode = 'onset';
        });
      },
    });
    this.modeSeg = segmented<BeatMode>({
      options: [
        { value: 'onset', label: 'Hits', title: 'Find attacks (kicks, snares, hats…) in the chosen frequency window' },
        { value: 'grid', label: 'Beat track', title: 'Follow the musical beat, tracked across the whole song (handles tempo drift)' },
      ],
      value: b.mode,
      onChange: (v) => store.update('beat', (p) => (p.audio.beat.mode = v)),
    });
    this.divSeg = segmented<number>({
      options: [
        { value: 0.25, label: 'Bar', title: 'Once per bar, on the downbeat' },
        { value: 0.5, label: '½', title: 'Every second beat' },
        { value: 1, label: 'Beat', title: 'Every beat' },
        { value: 2, label: '⅛', title: 'Eighth notes' },
        { value: 4, label: '1⁄16', title: 'Sixteenth notes' },
      ],
      value: b.division,
      onChange: (v) => store.update('beat', (p) => (p.audio.beat.division = v)),
    });
    this.divRow = h('div', { class: 'row wide' }, h('div', { class: 'label' }, 'Every'), this.divSeg.el);

    const R = (key: string, label: string, min: number, max: number, step: number, def: number, get: () => number, set: (v: number) => void, unit?: string, scale?: number, hint?: string) => {
      const r = rangeRow({ label, min, max, step, def, value: get(), unit, scale, hint, onInput: set });
      this.ranges[key] = r;
      return r;
    };
    const sens = R('sens', 'Sensitivity', 0, 1, 0.01, 0.5, () => store.p.audio.beat.sensitivity, (v) => store.update('beat', (p) => (p.audio.beat.sensitivity = v)), undefined, undefined, 'Higher finds quieter hits');
    const hold = R('hold', 'Min gap', 20, 1000, 5, 120, () => store.p.audio.beat.hold, (v) => store.update('beat', (p) => (p.audio.beat.hold = v)), 'ms', undefined, 'Shortest time between two beats; within it the stronger hit wins');
    this.onsetRows = h('div', null, sens.row, hold.row);

    const react = R('react', 'Reactivity', 0, 2, 0.01, 1, () => store.p.audio.reactivity, (v) => store.update('audio', (p) => (p.audio.reactivity = v)), undefined, undefined, 'Master amount for every audio drive');
    const gain = (k: 'low' | 'mid' | 'high', label: string) => {
      const r = R(k, label, 0, 2, 0.01, 1, () => store.p.audio[k], (v) => store.update('audio', (p) => (p.audio[k] = v)));
      const lvl = h('div', { class: 'lvl' });
      r.slider.appendChild(lvl);
      this.lvls[k] = lvl;
      return r.row;
    };
    const atk = R('atk', 'Attack', 0.005, 0.5, 0.005, 0.02, () => store.p.audio.attack, (v) => store.update('audio', (p) => (p.audio.attack = v)), 's', 1, 'How fast the picture reacts to a rise');
    const rel = R('rel', 'Release', 0.02, 2, 0.01, 0.25, () => store.p.audio.release, (v) => store.update('audio', (p) => (p.audio.release = v)), 's', 1, 'How slowly it settles afterwards');
    const sync = R('sync', 'A/V offset', -200, 200, 5, 0, () => this.syncMs(), (v) => this.setSyncMs(v), 'ms', 1, 'Positive delays the picture. Use it if visuals land early on Bluetooth speakers.');

    this.section = new Section('response', '02', 'Response', 'How sound drives the image');
    this.section.body.append(
      h('div', { class: 'sub-head' }, h('span', null, 'Beat source'), h('span', { class: 'beatlamp' }, this.lamp, this.bpmEl)),
      this.modeSeg.el,
      h('div', { style: 'height:10px' }),
      this.pickWrap,
      h('div', { class: 'axis' }, ['30', '100', '300', '1k', '3k', '10k'].map((s) => h('span', null, s))),
      this.presetSeg.el,
      h('div', { style: 'height:8px' }),
      this.onsetRows,
      this.divRow,
      h('div', { class: 'note', style: 'margin-top:6px' }, this.countEl),
      h('div', { class: 'sub-head', style: 'margin-top:18px' }, h('span', null, 'Amount')),
      react.row,
      gain('low', 'Low'),
      gain('mid', 'Mid'),
      gain('high', 'High'),
      h('div', { class: 'sub-head', style: 'margin-top:18px' }, h('span', null, 'Smoothing & sync')),
      atk.row,
      rel.row,
      sync.row,
      h('div', { class: 'note', style: 'margin-top:4px' }, this.latencyEl),
    );
    this.el = this.section.el;

    pick.addEventListener('pointerdown', (e) => this.down(e, pick, 'canvas'));
    this.bar.addEventListener('pointerdown', (e) => this.down(e, this.bar, 'bar'));
    for (const el of [pick, this.bar]) {
      el.addEventListener('pointermove', (e) => this.move(e, el));
      el.addEventListener('pointerup', () => (this.drag = null));
      el.addEventListener('pointercancel', () => (this.drag = null));
    }
    pick.addEventListener('dblclick', () => this.presetSeg.el.querySelector('button')?.click());
    pick.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const bb = store.p.audio.beat;
        const c = (freqToX(bb.lo) + freqToX(bb.hi)) / 2;
        const w = clamp(freqToX(bb.hi) - freqToX(bb.lo) + Math.sign(e.deltaY) * 0.02, 0.03, 1);
        this.setWindow(c - w / 2, c + w / 2);
      },
      { passive: false },
    );

    store.on((t) => {
      if (t === 'beat' || t === 'audio' || t === 'all') this.sync();
    });
    this.sync();
  }

  private matchPreset(): string {
    const b = store.p.audio.beat;
    return BEAT_PRESETS.find((p) => Math.abs(p.lo - b.lo) < 1 && Math.abs(p.hi - b.hi) < 1)?.id ?? '';
  }

  private sync(): void {
    const a = store.p.audio;
    this.presetSeg.set(this.matchPreset());
    this.modeSeg.set(a.beat.mode);
    this.divSeg.set(a.beat.division);
    const grid = a.beat.mode === 'grid';
    this.onsetRows.style.display = grid ? 'none' : '';
    this.divRow.style.display = grid ? '' : 'none';
    this.pickWrap.style.opacity = grid ? '0.45' : '1';
    this.ranges.sens.set(a.beat.sensitivity);
    this.ranges.hold.set(a.beat.hold);
    this.ranges.react.set(a.reactivity);
    this.ranges.low.set(a.low);
    this.ranges.mid.set(a.mid);
    this.ranges.high.set(a.high);
    this.ranges.atk.set(a.attack);
    this.ranges.rel.set(a.release);
    this.ranges.sync.set(this.syncMs());
    const xl = freqToX(a.beat.lo);
    const xh = freqToX(a.beat.hi);
    this.pill.style.left = `${xl * 100}%`;
    this.pill.style.width = `${(xh - xl) * 100}%`;
    const preset = BEAT_PRESETS.find((p) => p.id === this.matchPreset());
    this.section.setSummary(`${grid ? 'Beat track' : (preset?.label ?? `${formatHz(a.beat.lo)}–${formatHz(a.beat.hi)} Hz`)}${this.bpm ? ` · ${this.bpm.toFixed(0)} BPM` : ''}`);
  }

  setInfo(bpm: number, beatsInClip: number, live: boolean): void {
    this.bpm = bpm;
    this.bpmEl.textContent = bpm > 0 ? `${bpm.toFixed(1)} BPM` : live ? 'Live' : '— BPM';
    this.countEl.textContent = live
      ? 'Live input: hits are detected as they happen (about 30 ms behind the sound).'
      : beatsInClip > 0
        ? `${beatsInClip} beats in the clip. Each one can drop new colour, kick the fluid, send a ripple or snap a glitch.`
        : 'No beats found in the clip — widen the window or raise sensitivity.';
    const lat = this.latencyMs();
    this.latencyEl.textContent = lat > 0 ? `Your output latency (${lat} ms) is compensated automatically.` : '';
    this.sync();
  }

  private setWindow(lo: number, hi: number): void {
    const w = hi - lo;
    lo = clamp(lo, 0, 1 - w);
    store.update('beat', (p) => {
      p.audio.beat.lo = Math.round(xToFreq(lo));
      p.audio.beat.hi = Math.round(xToFreq(lo + w));
      p.audio.beat.mode = 'onset';
    });
  }

  private xFromEvent(e: PointerEvent, el: HTMLElement): number {
    const r = el.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1);
  }

  /** Edge tolerance in 0..1 units: generous, but never more than a third of the window. */
  private tol(el: HTMLElement, xl: number, xh: number): number {
    const px = el.getBoundingClientRect().width || 1;
    return Math.min(9 / px, (xh - xl) / 3);
  }

  private down(e: PointerEvent, el: HTMLElement, where: 'canvas' | 'bar'): void {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const x = this.xFromEvent(e, el);
    const b = store.p.audio.beat;
    const xl = freqToX(b.lo);
    const xh = freqToX(b.hi);
    const tol = this.tol(el, xl, xh);
    let mode: DragMode;
    if (Math.abs(x - xl) < tol) mode = 'lo';
    else if (Math.abs(x - xh) < tol) mode = 'hi';
    else if (x > xl && x < xh) mode = 'move';
    else if (where === 'bar') {
      // On the bar, clicking outside slides the window there.
      this.setWindow(x - (xh - xl) / 2, x + (xh - xl) / 2);
      mode = 'move';
    } else {
      this.setWindow(x - (xh - xl) / 2, x + (xh - xl) / 2);
      mode = 'move';
    }
    const nb = store.p.audio.beat;
    this.drag = { mode, x0: x, lo0: freqToX(nb.lo), hi0: freqToX(nb.hi) };
  }

  private move(e: PointerEvent, el: HTMLElement): void {
    const x = this.xFromEvent(e, el);
    if (!this.drag) {
      const b = store.p.audio.beat;
      const xl = freqToX(b.lo);
      const xh = freqToX(b.hi);
      const tol = this.tol(el, xl, xh);
      const near = Math.abs(x - xl) < tol || Math.abs(x - xh) < tol;
      el.style.cursor = near ? 'ew-resize' : x > xl && x < xh ? 'grab' : 'pointer';
      return;
    }
    const d = this.drag;
    const minW = 0.03;
    let lo = d.lo0;
    let hi = d.hi0;
    if (d.mode === 'lo') lo = clamp(x, 0, hi - minW);
    else if (d.mode === 'hi') hi = clamp(x, lo + minW, 1);
    else {
      const w = d.hi0 - d.lo0;
      lo = clamp(d.lo0 + (x - d.x0), 0, 1 - w);
      hi = lo + w;
    }
    this.setWindow(lo, hi);
  }

  tick(f: Features): void {
    this.lamp.style.opacity = String(0.15 + f.beat * 0.85);
    for (const k of ['low', 'mid', 'high'] as const) this.lvls[k].style.width = `${clamp(f[k] / 2, 0, 1) * 100}%`;
    if (this.section.open) this.draw(f);
  }

  private draw(f: Features): void {
    const ctx = fitCanvas(this.canvas);
    const w = this.canvas.clientWidth;
    const hh = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, hh);
    const ink = cssVar('--ink');
    const ink3 = cssVar('--ink-3');
    const accent = cssVar('--accent');
    const b = store.p.audio.beat;
    const xl = freqToX(b.lo) * w;
    const xh = freqToX(b.hi) * w;

    ctx.fillStyle = cssVar('--accent-soft');
    ctx.fillRect(xl, 0, xh - xl, hh);

    const bw = w / BAND_COUNT;
    for (let i = 0; i < BAND_COUNT; i++) {
      const v = clamp(f.spectrum[i], 0, 1.3) / 1.3;
      this.peak[i] = Math.max(v, this.peak[i] - 0.008);
      const x = i * bw;
      const inside = x + bw / 2 > xl && x + bw / 2 < xh;
      ctx.fillStyle = inside ? accent : ink;
      ctx.globalAlpha = inside ? 0.9 : 0.7;
      const bh = v * (hh - 16);
      ctx.fillRect(x + 1, hh - bh, bw - 2, bh);
      ctx.globalAlpha = 1;
      ctx.fillStyle = ink3;
      ctx.fillRect(x + 1, hh - this.peak[i] * (hh - 16) - 1, bw - 2, 1);
    }
    ctx.fillStyle = accent;
    ctx.fillRect(xl - 1, 0, 2, hh);
    ctx.fillRect(xh - 1, 0, 2, hh);
    ctx.fillRect(xl - 3, hh / 2 - 7, 6, 14);
    ctx.fillRect(xh - 3, hh / 2 - 7, 6, 14);
    ctx.font = '500 9.5px Inter, sans-serif';
    ctx.fillStyle = ink;
    const label = `${formatHz(b.lo)}–${formatHz(b.hi)} Hz`;
    const tw = ctx.measureText(label).width;
    ctx.fillText(label, clamp((xl + xh) / 2 - tw / 2, 4, w - tw - 4), 12);
    if (f.beat > 0.02) {
      ctx.globalAlpha = f.beat * 0.5;
      ctx.fillStyle = accent;
      ctx.fillRect(xl, 0, xh - xl, 3);
      ctx.globalAlpha = 1;
    }
  }
}
