import { findHighlights, snapToBeat, type Highlight } from '../audio/analysis';
import type { AudioEngine } from '../audio/engine';
import type { Features } from '../audio/features';
import { store } from '../state/store';
import { check, segmented } from './controls';
import { clamp, cssVar, fitCanvas, fmtTime, h, icon } from './dom';

export interface TimelineActions {
  togglePlay(): void;
  restart(): void;
  /** Seek to a clip-relative time. */
  seekClip(t: number): void;
  /** Called after the clip region changed through the UI. */
  regionChanged(): void;
  toggleRecord(): void;
}

const MIN_LEN = 2;
const MAX_LEN = 600;

export class Timeline {
  readonly el: HTMLElement;
  private song: HTMLCanvasElement;
  private clip: HTMLCanvasElement;
  private songStatic = document.createElement('canvas');
  private clipStatic = document.createElement('canvas');
  private songDirty = true;
  private clipDirty = true;
  private playBtn: HTMLButtonElement;
  private clockEl: HTMLElement;
  private clockNow = h('span', { class: 'now' });
  private clockTotal = h('small');
  private lenInput: HTMLInputElement;
  private lenSeg: { el: HTMLElement; set: (v: number) => void };
  private hlWrap: HTMLElement;
  private infoEl: HTMLElement;
  private songTip: HTMLElement;
  private clipTip: HTMLElement;
  private songLabel: HTMLElement;
  private recBtn: HTMLButtonElement;
  private dropBtn: HTMLButtonElement;
  private snapChk: { el: HTMLElement; set: (v: boolean) => void };
  private loopChk: { el: HTMLElement; set: (v: boolean) => void };
  private highlights: Highlight[] = [];
  private drag: null | { mode: 'move' | 'l' | 'r' | 'scrub'; t0: number; s0: number; d0: number } = null;
  private history: number[] = [];
  private lastW = { song: 0, clip: 0 };

  constructor(
    private engine: AudioEngine,
    private act: TimelineActions,
  ) {
    this.song = h('canvas');
    this.clip = h('canvas');
    this.songTip = h('div', { class: 'tip' });
    this.clipTip = h('div', { class: 'tip' });
    this.playBtn = h('button', { type: 'button', class: 'play', title: 'Play / pause (Space)', 'aria-label': 'Play', onclick: () => act.togglePlay() }, icon('play')) as HTMLButtonElement;
    this.clockEl = h('div', { class: 'clock', 'aria-live': 'off' }, this.clockNow, this.clockTotal);
    this.lenInput = h('input', { class: 'len-input', type: 'text', 'aria-label': 'Clip length in seconds' }) as HTMLInputElement;
    this.lenSeg = segmented<number>({
      options: [10, 15, 30, 60].map((v) => ({ value: v, label: String(v) })),
      value: store.p.clip.duration,
      onChange: (v) => this.setDuration(v),
    });
    this.hlWrap = h('span', { class: 'hl' });
    this.infoEl = h('span', { class: 'muted' });
    this.songLabel = h('span', { class: 'muted' }, 'Drag the window');
    this.recBtn = h('button', { type: 'button', class: 'btn small', style: 'display:none', onclick: () => act.toggleRecord() }, icon('rec'), 'Record') as HTMLButtonElement;
    this.dropBtn = h(
      'button',
      { type: 'button', class: 'btn small', title: 'Move the clip to the most energetic part of the track', onclick: () => this.jumpHighlight(0) },
      'Find the drop',
    ) as HTMLButtonElement;
    this.snapChk = check(store.p.clip.snap, (v) => store.update('clip', (p) => (p.clip.snap = v)), 'Snap');
    this.loopChk = check(store.p.clip.loop, (v) => store.update('clip', (p) => (p.clip.loop = v)), 'Loop');

    this.lenInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.lenInput.blur();
    });
    this.lenInput.addEventListener('blur', () => {
      const v = parseFloat(this.lenInput.value);
      if (isFinite(v)) this.setDuration(v);
      else this.syncLen();
    });

    const transport = h(
      'div',
      { class: 'transport' },
      this.playBtn,
      h('button', { type: 'button', class: 'btn icon ghost', title: 'Back to clip start and clear the canvas (R)', 'aria-label': 'Restart', onclick: () => act.restart() }, icon('restart')),
      this.clockEl,
      h('div', { class: 'group' }, h('span', { class: 'label' }, 'Length'), this.lenInput, h('span', { class: 'muted' }, 's'), this.lenSeg.el),
      h('div', { class: 'group' }, this.dropBtn, this.hlWrap),
      h('div', { class: 'group' }, this.snapChk.el, this.loopChk.el),
      h('div', { class: 'spacer' }),
      this.infoEl,
      this.recBtn,
    );

    const songLane = h('div', { class: 'lane song' }, this.song, this.songTip);
    const clipLane = h('div', { class: 'lane clip' }, this.clip, this.clipTip);

    this.el = h(
      'footer',
      { class: 'timeline' },
      transport,
      h('div', { class: 'lane-label' }, h('span', { class: 'label' }, 'Song'), this.songLabel),
      songLane,
      h('div', { class: 'lane-label' }, h('span', { class: 'label' }, 'Clip'), h('span', { class: 'muted' }, 'Click to scrub')),
      clipLane,
    );

    songLane.addEventListener('pointerdown', (e) => this.songDown(e, songLane));
    songLane.addEventListener('pointermove', (e) => this.songMove(e, songLane));
    songLane.addEventListener('pointerup', (e) => this.songUp(e, songLane));
    songLane.addEventListener('pointercancel', () => (this.drag = null));
    songLane.addEventListener('dblclick', (e) => {
      const t = this.timeAt(e.clientX, songLane);
      this.setStart(t - store.p.clip.duration / 2);
      act.regionChanged();
    });
    clipLane.addEventListener('pointerdown', (e) => {
      clipLane.setPointerCapture(e.pointerId);
      this.drag = { mode: 'scrub', t0: 0, s0: 0, d0: 0 };
      act.seekClip(this.clipTimeAt(e.clientX, clipLane));
    });
    clipLane.addEventListener('pointermove', (e) => {
      const t = this.clipTimeAt(e.clientX, clipLane);
      this.clipTip.textContent = fmtTime(t);
      this.clipTip.style.left = `${e.clientX - clipLane.getBoundingClientRect().left}px`;
      if (this.drag?.mode === 'scrub') act.seekClip(t);
    });
    clipLane.addEventListener('pointerup', () => (this.drag = null));

    engine.on('analysis', () => this.refresh());
    engine.on('beats', () => this.refresh());
    engine.on('track', () => this.refresh());
    engine.on('state', () => this.syncPlay());
    store.on((t) => {
      if (t === 'clip' || t === 'all') {
        this.syncLen();
        this.snapChk.set(store.p.clip.snap);
        this.loopChk.set(store.p.clip.loop);
        this.songDirty = this.clipDirty = true;
        this.computeHighlights();
      }
    });
    window.addEventListener('resize', () => (this.songDirty = this.clipDirty = true));
    this.syncLen();
  }

  // ── Region model ──────────────────────────────────────────────────────

  get songDuration(): number {
    return this.engine.duration;
  }

  /** Keep the clip inside the song. */
  clampRegion(): void {
    const D = this.songDuration;
    if (!D) return;
    store.update(
      'clip',
      (p) => {
        p.clip.duration = clamp(p.clip.duration, MIN_LEN, Math.max(MIN_LEN, Math.min(MAX_LEN, D)));
        p.clip.start = clamp(p.clip.start, 0, Math.max(0, D - p.clip.duration));
      },
      { history: false },
    );
  }

  private snap(t: number): number {
    if (!store.p.clip.snap || !this.engine.beats.length) return t;
    return snapToBeat(t, this.engine.beats, 0.4);
  }

  setStart(t: number): void {
    const D = this.songDuration || Infinity;
    store.update('clip', (p) => (p.clip.start = clamp(this.snap(t), 0, Math.max(0, D - p.clip.duration))));
  }

  setDuration(v: number): void {
    const D = this.songDuration || MAX_LEN;
    v = clamp(Math.round(v * 10) / 10, MIN_LEN, Math.min(MAX_LEN, D));
    store.update('clip', (p) => {
      p.clip.duration = v;
      p.clip.start = clamp(p.clip.start, 0, Math.max(0, D - v));
    });
    this.act.regionChanged();
  }

  private syncLen(): void {
    if (document.activeElement !== this.lenInput) this.lenInput.value = store.p.clip.duration.toFixed(store.p.clip.duration % 1 ? 1 : 0);
    this.lenSeg.set(store.p.clip.duration);
  }

  private computeHighlights(): void {
    const an = this.engine.analysis;
    this.highlights = an ? findHighlights(an, store.p.clip.duration, this.engine.beats, 3) : [];
    this.hlWrap.replaceChildren(
      ...this.highlights.map((hl, i) =>
        h('button', { type: 'button', title: `Highlight ${i + 1} · ${fmtTime(hl.start, 1)}`, onclick: () => this.jumpHighlight(i) }, String(i + 1)),
      ),
    );
    this.dropBtn.disabled = !this.highlights.length;
  }

  private jumpHighlight(i: number): void {
    const hl = this.highlights[i];
    if (!hl) return;
    store.update('clip', (p) => (p.clip.start = clamp(hl.start, 0, Math.max(0, this.songDuration - p.clip.duration))));
    this.act.regionChanged();
  }

  refresh(): void {
    this.clampRegion();
    this.computeHighlights();
    this.songDirty = this.clipDirty = true;
    const kind = this.engine.kind;
    const live = kind === 'live' && !this.engine.info?.duration;
    this.songLabel.textContent = live ? 'Live input' : this.engine.analysis ? 'Drag the window' : this.songDuration ? 'Drag the window' : '—';
    this.recBtn.style.display = this.engine.kind === 'live' || this.engine.kind === 'external' ? '' : 'none';
    const an = this.engine.analysis;
    this.infoEl.textContent = an ? `${an.bpm.toFixed(1)} BPM · ${fmtTime(this.songDuration, 0)}` : this.songDuration ? fmtTime(this.songDuration, 0) : '';
    this.history = [];
  }

  setRecording(on: boolean): void {
    this.recBtn.classList.toggle('primary', on);
    this.recBtn.lastChild!.textContent = on ? 'Stop' : 'Record';
  }

  private syncPlay(): void {
    const playing = this.engine.playing;
    this.playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
    this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  // ── Pointer: song lane ────────────────────────────────────────────────

  private timeAt(clientX: number, el: HTMLElement): number {
    const r = el.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1) * (this.songDuration || 1);
  }

  private clipTimeAt(clientX: number, el: HTMLElement): number {
    const r = el.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1) * store.p.clip.duration;
  }

  private hit(clientX: number, el: HTMLElement): 'l' | 'r' | 'move' | 'out' {
    const D = this.songDuration;
    if (!D) return 'out';
    const r = el.getBoundingClientRect();
    const x = clientX - r.left;
    const xs = (store.p.clip.start / D) * r.width;
    const xe = ((store.p.clip.start + store.p.clip.duration) / D) * r.width;
    if (Math.abs(x - xs) < 6) return 'l';
    if (Math.abs(x - xe) < 6) return 'r';
    if (x > xs && x < xe) return 'move';
    return 'out';
  }

  private songDown(e: PointerEvent, el: HTMLElement): void {
    if (!this.songDuration) return;
    el.setPointerCapture(e.pointerId);
    const t = this.timeAt(e.clientX, el);
    let mode = this.hit(e.clientX, el);
    if (mode === 'out') {
      this.setStart(t);
      mode = 'move';
    }
    this.drag = { mode, t0: t, s0: store.p.clip.start, d0: store.p.clip.duration };
  }

  private songMove(e: PointerEvent, el: HTMLElement): void {
    const t = this.timeAt(e.clientX, el);
    this.songTip.textContent = fmtTime(t, 1);
    this.songTip.style.left = `${e.clientX - el.getBoundingClientRect().left}px`;
    const d = this.drag;
    if (!d) {
      const m = this.hit(e.clientX, el);
      el.style.cursor = m === 'l' || m === 'r' ? 'ew-resize' : m === 'move' ? 'grab' : 'pointer';
      return;
    }
    const D = this.songDuration;
    const free = e.altKey;
    const sn = (v: number) => (free ? v : this.snap(v));
    if (d.mode === 'move') {
      const s = clamp(sn(d.s0 + (t - d.t0)), 0, Math.max(0, D - d.d0));
      store.update('clip', (p) => (p.clip.start = s), { history: false });
    } else if (d.mode === 'l') {
      const end = d.s0 + d.d0;
      const s = clamp(sn(t), Math.max(0, end - MAX_LEN), end - MIN_LEN);
      store.update('clip', (p) => {
        p.clip.start = s;
        p.clip.duration = Math.round((end - s) * 10) / 10;
      }, { history: false });
    } else if (d.mode === 'r') {
      const e2 = clamp(sn(t), d.s0 + MIN_LEN, Math.min(D, d.s0 + MAX_LEN));
      store.update('clip', (p) => (p.clip.duration = Math.round((e2 - d.s0) * 10) / 10), { history: false });
    }
  }

  private songUp(e: PointerEvent, el: HTMLElement): void {
    if (!this.drag) return;
    this.drag = null;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    store.update('clip', () => {});
    this.act.regionChanged();
  }

  // ── Drawing ───────────────────────────────────────────────────────────

  tick(clipTime: number, f: Features): void {
    const dur = store.p.clip.duration;
    const live = this.engine.kind === 'live' && !this.engine.info?.duration;
    // Update text in place; fixed-width spans keep the transport from shifting.
    const now = fmtTime(Math.max(0, clipTime));
    const total = live ? 'live' : `/ ${fmtTime(dur)}`;
    if (this.clockNow.textContent !== now) this.clockNow.textContent = now;
    if (this.clockTotal.textContent !== total) this.clockTotal.textContent = total;
    if (live || (!this.engine.analysis && this.engine.playing)) {
      this.history.push(f.level);
      if (this.history.length > 2400) this.history.shift();
      this.clipDirty = true;
    }
    this.drawSong();
    this.drawClip(clipTime);
  }

  private colors() {
    return {
      ink: cssVar('--ink'),
      ink2: cssVar('--ink-2'),
      ink3: cssVar('--ink-3'),
      rule: cssVar('--rule'),
      rule2: cssVar('--rule-2'),
      panel2: cssVar('--panel-2'),
      accent: cssVar('--accent'),
      soft: cssVar('--accent-soft'),
    };
  }

  private drawSong(): void {
    const c = this.song;
    const ctx = fitCanvas(c);
    const w = c.clientWidth;
    const hh = c.clientHeight;
    if (w !== this.lastW.song) this.songDirty = true;
    this.lastW.song = w;
    const C = this.colors();
    const D = this.songDuration;
    const an = this.engine.analysis;
    const st = this.songStatic;
    if (this.songDirty) {
      this.songDirty = false;
      st.width = c.width;
      st.height = c.height;
      const s = st.getContext('2d')!;
      s.setTransform(c.width / w, 0, 0, c.height / hh, 0, 0);
      s.fillStyle = C.panel2;
      s.fillRect(0, 0, w, hh);
      const x0 = D ? (store.p.clip.start / D) * w : 0;
      const x1 = D ? ((store.p.clip.start + store.p.clip.duration) / D) * w : 0;
      const ov = an ? an.rms : this.engine.overview;
      if (ov && D) {
        const n = ov.length;
        const mid = hh / 2;
        let maxR = 1e-6;
        for (let i = 0; i < n; i++) maxR = Math.max(maxR, ov[i]);
        for (let x = 0; x < w; x += 2) {
          const a = Math.floor((x / w) * n);
          const b = Math.max(a + 1, Math.floor(((x + 2) / w) * n));
          let r = 0;
          for (let i = a; i < b; i++) r = Math.max(r, ov[i]);
          const v = Math.pow(r / maxR, 0.8);
          const bh = Math.max(1, v * (hh - 6));
          s.fillStyle = x >= x0 && x <= x1 ? C.ink : C.ink3;
          s.fillRect(x, mid - bh / 2, 1.5, bh);
        }
      } else if (D) {
        s.fillStyle = C.rule2;
        s.fillRect(0, hh / 2, w, 1);
      } else {
        s.fillStyle = C.ink3;
        s.font = '500 10px Inter, sans-serif';
        s.fillText(this.engine.kind === 'live' ? 'Live input — no fixed song length. Visuals follow the sound as it plays.' : 'Load a track to choose a section of it.', 8, hh / 2 + 3);
      }
      if (D) {
        s.fillStyle = C.soft;
        s.fillRect(x0, 0, x1 - x0, hh);
        s.strokeStyle = C.accent;
        s.lineWidth = 1.5;
        s.strokeRect(x0 + 0.75, 0.75, Math.max(2, x1 - x0 - 1.5), hh - 1.5);
        s.fillStyle = C.accent;
        s.fillRect(x0 - 2, hh / 2 - 7, 4, 14);
        s.fillRect(x1 - 2, hh / 2 - 7, 4, 14);
        // highlight markers
        s.font = '600 9px Inter, sans-serif';
        this.highlights.forEach((hl, i) => {
          const x = (hl.start / D) * w;
          s.fillStyle = C.accent;
          s.beginPath();
          s.moveTo(x - 4, 0);
          s.lineTo(x + 4, 0);
          s.lineTo(x, 5);
          s.fill();
          s.fillStyle = C.ink2;
          s.fillText(String(i + 1), x + 4, 11);
        });
      }
    }
    ctx.clearRect(0, 0, w, hh);
    ctx.drawImage(st, 0, 0, w, hh);
    if (D) {
      const x = (this.engine.time / D) * w;
      ctx.fillStyle = C.ink;
      ctx.fillRect(x - 0.5, 0, 1, hh);
    }
  }

  private drawClip(clipTime: number): void {
    const c = this.clip;
    const ctx = fitCanvas(c);
    const w = c.clientWidth;
    const hh = c.clientHeight;
    if (w !== this.lastW.clip) this.clipDirty = true;
    this.lastW.clip = w;
    const C = this.colors();
    const dur = store.p.clip.duration;
    const start = store.p.clip.start;
    const st = this.clipStatic;
    if (this.clipDirty) {
      this.clipDirty = false;
      st.width = c.width;
      st.height = c.height;
      const s = st.getContext('2d')!;
      s.setTransform(c.width / w, 0, 0, c.height / hh, 0, 0);
      s.fillStyle = C.panel2;
      s.fillRect(0, 0, w, hh);
      const waveH = hh - 14;
      const mid = waveH / 2 + 1;
      const mono = this.engine.monoRange(start, start + dur);
      if (mono && mono.length) {
        s.fillStyle = C.ink;
        const per = mono.length / w;
        let gmax = 1e-4;
        for (let i = 0; i < mono.length; i += 64) gmax = Math.max(gmax, Math.abs(mono[i]));
        const norm = Math.min(4, 0.9 / gmax);
        for (let x = 0; x < w; x++) {
          const a = Math.floor(x * per);
          const b = Math.min(mono.length, Math.floor((x + 1) * per));
          let mn = 0;
          let mx = 0;
          for (let i = a; i < b; i += Math.max(1, Math.floor((b - a) / 64))) {
            const v = mono[i];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
          const y0 = mid - mx * norm * (waveH / 2);
          const y1 = mid - mn * norm * (waveH / 2);
          s.fillRect(x, y0, 1, Math.max(1, y1 - y0));
        }
      } else if (this.history.length) {
        s.fillStyle = C.ink;
        const n = this.history.length;
        const span = Math.min(n, w);
        for (let i = 0; i < span; i++) {
          const v = clamp(this.history[n - span + i], 0, 1.2) / 1.2;
          const bh = Math.max(1, v * waveH);
          s.fillRect(w - span + i, mid - bh / 2, 1, bh);
        }
      } else {
        s.fillStyle = C.rule2;
        s.fillRect(0, mid, w, 1);
      }
      // beats
      const beats = this.engine.beats;
      s.fillStyle = C.accent;
      for (let i = 0; i < beats.length; i++) {
        const t = beats[i] - start;
        if (t < 0) continue;
        if (t > dur) break;
        const x = Math.round((t / dur) * w);
        s.globalAlpha = 0.25;
        s.fillRect(x, 0, 1, waveH + 2);
        s.globalAlpha = 1;
        s.fillRect(x - 1, 0, 2, 4);
      }
      // ruler
      s.fillStyle = C.ink3;
      s.font = '500 9px Inter, sans-serif';
      const stepS = dur <= 12 ? 1 : dur <= 40 ? 5 : dur <= 120 ? 10 : 30;
      for (let t = 0; t <= dur + 1e-6; t += stepS / (stepS === 1 ? 1 : 5)) {
        const x = Math.round((t / dur) * w);
        const major = Math.abs(t / stepS - Math.round(t / stepS)) < 1e-6;
        s.fillRect(x, hh - (major ? 9 : 5), 1, major ? 9 : 5);
        if (major && x < w - 30) s.fillText(fmtTime(t, 0), x + 3, hh - 1);
      }
    }
    ctx.clearRect(0, 0, w, hh);
    ctx.drawImage(st, 0, 0, w, hh);
    const live = this.engine.kind === 'live' && !this.engine.info?.duration;
    const x = live ? w - 1 : clamp(clipTime / dur, 0, 1) * w;
    ctx.fillStyle = C.accent;
    ctx.fillRect(x - 1, 0, 2, hh);
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 6);
    ctx.fill();
  }
}
