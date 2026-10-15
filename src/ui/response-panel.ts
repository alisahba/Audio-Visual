import { BAND_COUNT, BEAT_PRESETS, formatHz, freqToX, xToFreq } from '../audio/bands';
import type { Features } from '../audio/features';
import type { BeatMode } from '../state/project';
import { store } from '../state/store';
import { rangeRow, segmented, type RangeRow } from './controls';
import { clamp, cssVar, fitCanvas, h } from './dom';

/** Section 02: where beats come from, and how hard the sound pushes the picture. */
export class ResponsePanel {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private lamp: HTMLElement;
  private bpmEl: HTMLElement;
  private countEl: HTMLElement;
  private peak = new Float32Array(BAND_COUNT);
  private presetSeg: { el: HTMLElement; set: (v: string) => void };
  private modeSeg: { el: HTMLElement; set: (v: BeatMode) => void };
  private divSeg: { el: HTMLElement; set: (v: number) => void };
  private divRow: HTMLElement;
  private onsetRows: HTMLElement;
  private ranges: Record<string, RangeRow> = {};
  private lvls: Record<string, HTMLElement> = {};
  private drag: null | { mode: 'lo' | 'hi' | 'move'; x0: number; lo0: number; hi0: number } = null;
  beatsInClip = 0;
  bpm = 0;

  constructor() {
    this.canvas = h('canvas');
    const pick = h('div', { class: 'bandpick', title: 'Drag the red window to choose which frequencies trigger beats' }, this.canvas);
    this.lamp = h('i');
    this.bpmEl = h('span', null, '— BPM');
    this.countEl = h('span', { class: 'muted' }, '');

    const b = store.p.audio.beat;
    this.presetSeg = segmented<string>({
      options: BEAT_PRESETS.map((p) => ({ value: p.id, label: p.label, title: `${formatHz(p.lo)}–${formatHz(p.hi)} Hz` })),
      value: this.matchPreset(),
      onChange: (id) => {
        const pr = BEAT_PRESETS.find((x) => x.id === id)!;
        store.update('beat', (p) => {
          p.audio.beat.lo = pr.lo;
          p.audio.beat.hi = pr.hi;
          p.audio.beat.mode = 'onset';
        });
      },
    });
    this.modeSeg = segmented<BeatMode>({
      options: [
        { value: 'onset', label: 'Detect hits', title: 'Find transients in the chosen frequency window' },
        { value: 'grid', label: 'Tempo grid', title: 'Lock beats to the detected tempo' },
      ],
      value: b.mode,
      onChange: (v) => store.update('beat', (p) => (p.audio.beat.mode = v)),
    });
    this.divSeg = segmented<number>({
      options: [
        { value: 0.25, label: 'Bar' },
        { value: 0.5, label: '½' },
        { value: 1, label: 'Beat' },
        { value: 2, label: '⅛' },
      ],
      value: b.division,
      onChange: (v) => store.update('beat', (p) => (p.audio.beat.division = v)),
    });
    this.divRow = h('div', { class: 'row wide' }, h('div', { class: 'label' }, 'Every'), this.divSeg.el);

    const R = (key: string, label: string, min: number, max: number, step: number, def: number, get: () => number, set: (v: number) => void, unit?: string, scale?: number) => {
      const r = rangeRow({ label, min, max, step, def, value: get(), unit, scale, onInput: set });
      this.ranges[key] = r;
      return r;
    };
    const sens = R('sens', 'Sensitivity', 0, 1, 0.01, 0.55, () => store.p.audio.beat.sensitivity, (v) => store.update('beat', (p) => (p.audio.beat.sensitivity = v)));
    const hold = R('hold', 'Min gap', 60, 1000, 10, 220, () => store.p.audio.beat.hold, (v) => store.update('beat', (p) => (p.audio.beat.hold = v)), 'ms');
    this.onsetRows = h('div', null, sens.row, hold.row);

    const react = R('react', 'Reactivity', 0, 2, 0.01, 1, () => store.p.audio.reactivity, (v) => store.update('audio', (p) => (p.audio.reactivity = v)));
    const gain = (k: 'low' | 'mid' | 'high', label: string) => {
      const r = R(k, label, 0, 2, 0.01, 1, () => store.p.audio[k], (v) => store.update('audio', (p) => (p.audio[k] = v)));
      const lvl = h('div', { class: 'lvl', style: 'position:absolute;left:0;top:50%;margin-top:4px;height:3px;background:var(--accent);width:0' });
      r.slider.appendChild(lvl);
      this.lvls[k] = lvl;
      return r.row;
    };
    const atk = R('atk', 'Attack', 0.005, 0.5, 0.005, 0.02, () => store.p.audio.attack, (v) => store.update('audio', (p) => (p.audio.attack = v)), 's', 1);
    const rel = R('rel', 'Release', 0.02, 2, 0.01, 0.25, () => store.p.audio.release, (v) => store.update('audio', (p) => (p.audio.release = v)), 's', 1);

    this.el = h(
      'section',
      { class: 'sec', id: 'sec-response' },
      h('div', { class: 'sec-head' }, h('span', { class: 'num' }, '02'), h('span', { class: 'title' }, 'Response'), h('span', { class: 'hint' }, 'How sound drives the image')),
      h('div', { class: 'sub-head' }, h('span', null, 'Beat source'), h('span', { class: 'beatlamp' }, this.lamp, this.bpmEl)),
      this.modeSeg.el,
      h('div', { style: 'height:10px' }),
      pick,
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
      h('div', { class: 'sub-head', style: 'margin-top:18px' }, h('span', null, 'Smoothing')),
      atk.row,
      rel.row,
    );

    pick.addEventListener('pointerdown', (e) => this.down(e, pick));
    pick.addEventListener('pointermove', (e) => this.move(e, pick));
    pick.addEventListener('pointerup', () => (this.drag = null));
    pick.addEventListener('pointercancel', () => (this.drag = null));

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
    this.canvas.parentElement!.style.opacity = grid ? '0.45' : '1';
    this.ranges.sens.set(a.beat.sensitivity);
    this.ranges.hold.set(a.beat.hold);
    this.ranges.react.set(a.reactivity);
    this.ranges.low.set(a.low);
    this.ranges.mid.set(a.mid);
    this.ranges.high.set(a.high);
    this.ranges.atk.set(a.attack);
    this.ranges.rel.set(a.release);
  }

  setInfo(bpm: number, beatsInClip: number, live: boolean): void {
    this.bpm = bpm;
    this.bpmEl.textContent = bpm > 0 ? `${bpm.toFixed(1)} BPM` : live ? 'Live' : '— BPM';
    this.countEl.textContent = live
      ? 'Live input: beats are detected as they happen.'
      : beatsInClip > 0
        ? `${beatsInClip} beats in the clip. Each one can drop new colour, kick the fluid or snap a glitch.`
        : 'No beats found in the clip — widen the window or raise sensitivity.';
  }

  private xFromEvent(e: PointerEvent, el: HTMLElement): number {
    const r = el.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1);
  }

  private down(e: PointerEvent, el: HTMLElement): void {
    if (store.p.audio.beat.mode === 'grid') store.update('beat', (p) => (p.audio.beat.mode = 'onset'));
    el.setPointerCapture(e.pointerId);
    const x = this.xFromEvent(e, el);
    const b = store.p.audio.beat;
    const xl = freqToX(b.lo);
    const xh = freqToX(b.hi);
    const tol = 8 / el.getBoundingClientRect().width;
    let mode: 'lo' | 'hi' | 'move';
    if (Math.abs(x - xl) < tol) mode = 'lo';
    else if (Math.abs(x - xh) < tol) mode = 'hi';
    else if (x > xl && x < xh) mode = 'move';
    else {
      // Re-centre the window on the click.
      const w = xh - xl;
      const nl = clamp(x - w / 2, 0, 1 - w);
      store.update('beat', (p) => {
        p.audio.beat.lo = Math.round(xToFreq(nl));
        p.audio.beat.hi = Math.round(xToFreq(nl + w));
      });
      mode = 'move';
    }
    const nb = store.p.audio.beat;
    this.drag = { mode, x0: x, lo0: freqToX(nb.lo), hi0: freqToX(nb.hi) };
  }

  private move(e: PointerEvent, el: HTMLElement): void {
    const x = this.xFromEvent(e, el);
    if (!this.drag) {
      const b = store.p.audio.beat;
      const tol = 8 / el.getBoundingClientRect().width;
      const near = Math.abs(x - freqToX(b.lo)) < tol || Math.abs(x - freqToX(b.hi)) < tol;
      el.style.cursor = near ? 'ew-resize' : x > freqToX(b.lo) && x < freqToX(b.hi) ? 'grab' : 'crosshair';
      return;
    }
    const d = this.drag;
    const minW = 0.04;
    let lo = d.lo0;
    let hi = d.hi0;
    if (d.mode === 'lo') lo = clamp(x, 0, hi - minW);
    else if (d.mode === 'hi') hi = clamp(x, lo + minW, 1);
    else {
      const w = d.hi0 - d.lo0;
      lo = clamp(d.lo0 + (x - d.x0), 0, 1 - w);
      hi = lo + w;
    }
    store.update('beat', (p) => {
      p.audio.beat.lo = Math.round(xToFreq(lo));
      p.audio.beat.hi = Math.round(xToFreq(hi));
    });
  }

  tick(f: Features): void {
    this.lamp.style.opacity = String(0.15 + f.beat * 0.85);
    for (const k of ['low', 'mid', 'high'] as const) this.lvls[k].style.width = `${clamp(f[k] / 2, 0, 1) * 100}%`;
    this.draw(f);
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
      ctx.globalAlpha = inside ? 0.9 : 0.75;
      const bh = v * (hh - 8);
      ctx.fillRect(x + 1, hh - bh, bw - 2, bh);
      ctx.globalAlpha = 1;
      ctx.fillStyle = ink3;
      ctx.fillRect(x + 1, hh - this.peak[i] * (hh - 8) - 1, bw - 2, 1);
    }
    ctx.fillStyle = accent;
    ctx.fillRect(xl - 1, 0, 2, hh);
    ctx.fillRect(xh - 1, 0, 2, hh);
    ctx.fillRect(xl - 3, hh / 2 - 6, 6, 12);
    ctx.fillRect(xh - 3, hh / 2 - 6, 6, 12);
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
