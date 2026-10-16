import { clamp, h } from './dom';

export interface RangeOpts {
  label: string;
  /** Tooltip for the label. */
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  def: number;
  unit?: string;
  dp?: number;
  /** Display multiplier override (e.g. 100 for percent-like readouts). */
  scale?: number;
  onInput: (v: number) => void;
}

export interface RangeRow {
  row: HTMLElement;
  slider: HTMLElement;
  set: (v: number) => void;
  /** Show the live, audio-modulated value (or hide with null). */
  setMod: (v: number | null) => void;
}

function displayScale(o: RangeOpts): number {
  if (o.scale !== undefined) return o.scale;
  if (o.unit) return 1;
  if (o.step >= 1) return 1;
  if (o.min >= -1 && o.max <= 2) return 100;
  return 1;
}

function decimals(o: RangeOpts, scale: number): number {
  if (o.dp !== undefined) return o.dp;
  if (scale === 100) return 0;
  if (o.step >= 1) return 0;
  return o.step >= 0.1 ? 1 : 2;
}

// ── Label scrubbing ────────────────────────────────────────────────────────
// Drag a setting's label sideways to change it. Slow drags are precise, fast
// flicks cover the range; Shift is finer still. The default value is a soft
// detent you can feel, Esc puts the value back, and a readout follows along.

let hud: HTMLElement | null = null;
function scrubHud(): HTMLElement {
  if (!hud) {
    hud = h('div', { class: 'scrub-hud', 'aria-hidden': 'true' });
    document.body.appendChild(hud);
  }
  return hud;
}

interface ScrubOpts {
  /** Value at the start of the drag. */
  start: () => number;
  /** Value units per pixel at normal speed. */
  perPx: number;
  /** Values the drag sticks to briefly (e.g. the default), with a name for the readout. */
  detents: { v: number; name: string }[];
  apply: (v: number) => void;
  /** Readout: [value text, fraction 0..1 for the bar, note]. */
  readout: (v: number) => [string, number, string?];
  cancel: (v: number) => void;
}

function makeScrubbable(label: HTMLElement, row: () => HTMLElement, o: ScrubOpts): void {
  label.classList.add('scrubbable');
  let id = -1;
  let startX = 0;
  let lastX = 0;
  let lastT = 0;
  let raw = 0;
  let v0 = 0;
  let active = false;
  let stuck: { v: number; name: string } | null = null;
  let pull = 0;
  const show = (v: number, note?: string) => {
    const el = scrubHud();
    const [txt, frac, extra] = o.readout(v);
    el.replaceChildren(
      h('b', null, txt),
      h('i', null, h('span', { style: `width:${Math.max(0, Math.min(1, frac)) * 100}%` })),
      h('small', { class: note ? 'snap' : '' }, note ?? extra ?? 'Shift: fine · Esc: cancel'),
    );
    const r = row().getBoundingClientRect();
    el.style.left = `${r.left + r.width / 2}px`;
    el.style.top = `${r.top - 8}px`;
    el.classList.add('on');
  };
  const finish = (cancelled: boolean) => {
    if (cancelled) o.cancel(v0);
    active = false;
    id = -1;
    row().classList.remove('scrubbing');
    document.body.classList.remove('scrubbing');
    hud?.classList.remove('on');
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && active) {
      e.preventDefault();
      e.stopPropagation();
      try {
        label.releasePointerCapture(id);
      } catch {
        /* noop */
      }
      finish(true);
    }
  };
  label.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    id = e.pointerId;
    startX = lastX = e.clientX;
    lastT = performance.now();
    v0 = raw = o.start();
    stuck = null;
    active = false;
    label.setPointerCapture(id);
  });
  label.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    if (!active) {
      if (Math.abs(e.clientX - startX) < 4) return;
      active = true;
      lastX = e.clientX;
      row().classList.add('scrubbing');
      document.body.classList.add('scrubbing');
      window.addEventListener('keydown', onKey, true);
    }
    const now = performance.now();
    const dx = e.clientX - lastX;
    const dt = Math.max(1, now - lastT);
    lastX = e.clientX;
    lastT = now;
    // Pointer acceleration: up to 6× when flicking, 1× when careful.
    const speed = Math.abs(dx) / dt;
    const accel = 1 + Math.min(5, Math.max(0, speed - 0.25) * 3.5);
    const fine = e.shiftKey ? 0.1 : 1;
    const step = dx * o.perPx * accel * fine;
    if (stuck) {
      // Held at a detent until the drag pulls ~12 px away from it.
      pull += dx * fine;
      if (Math.abs(pull) < 12) {
        show(stuck.v, stuck.name);
        return;
      }
      raw = stuck.v + step;
      stuck = null;
    } else {
      const next = raw + step;
      const hit = o.detents.find((d) => (raw - d.v) * (next - d.v) < 0 || (next === d.v && raw !== d.v));
      if (hit) {
        raw = hit.v;
        stuck = hit;
        pull = 0;
        o.apply(raw);
        show(raw, hit.name);
        return;
      }
      raw = next;
    }
    o.apply(raw);
    show(raw);
  });
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    try {
      label.releasePointerCapture(id);
    } catch {
      /* noop */
    }
    if (active) finish(false);
    id = -1;
  };
  label.addEventListener('pointerup', up);
  label.addEventListener('pointercancel', (e) => {
    if (e.pointerId === id && active) finish(true);
  });
}

export function rangeRow(o: RangeOpts): RangeRow {
  const scale = displayScale(o);
  const dp = decimals(o, scale);
  let value = o.value;
  const fill = h('div', { class: 'fill' });
  const knob = h('div', { class: 'knob' });
  const mod = h('div', { class: 'mod' });
  const zero = o.min < 0 && o.max > 0 ? h('div', { class: 'zero' }) : null;
  const slider = h('div', { class: 'slider', role: 'slider', tabindex: '0', 'aria-label': o.label }, h('div', { class: 'track' }), zero, fill, mod, knob);
  const input = h('input', { class: 'value', type: 'text', spellcheck: false, 'aria-label': `${o.label} value` });

  const frac = (v: number) => (v - o.min) / (o.max - o.min);
  const origin = o.min < 0 && o.max > 0 ? frac(0) : 0;
  if (zero) zero.style.left = `${origin * 100}%`;

  const fmt = (v: number) => {
    const s = (v * scale).toFixed(dp);
    return o.unit ? `${s}${o.unit === '°' ? '°' : ` ${o.unit}`}` : s;
  };

  const render = () => {
    const f = clamp(frac(value), 0, 1);
    knob.style.left = `${f * 100}%`;
    const a = Math.min(origin, f);
    const b = Math.max(origin, f);
    fill.style.left = `${a * 100}%`;
    fill.style.width = `${(b - a) * 100}%`;
    if (document.activeElement !== input) input.value = fmt(value);
    slider.setAttribute('aria-valuenow', String(value));
  };

  const quant = (v: number) => {
    v = clamp(v, o.min, o.max);
    const q = Math.round((v - o.min) / o.step) * o.step + o.min;
    return Number(q.toFixed(6));
  };

  const commit = (v: number) => {
    v = quant(v);
    if (v === value) return;
    value = v;
    render();
    o.onInput(v);
  };

  let dragging = false;
  let startX = 0;
  let startV = 0;
  slider.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    slider.focus();
    dragging = true;
    slider.setPointerCapture(e.pointerId);
    slider.classList.add('drag');
    const r = slider.getBoundingClientRect();
    if (e.shiftKey) {
      startX = e.clientX;
      startV = value;
    } else {
      commit(o.min + ((e.clientX - r.left) / r.width) * (o.max - o.min));
      startX = e.clientX;
      startV = value;
    }
  });
  slider.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = slider.getBoundingClientRect();
    const k = e.shiftKey ? 0.1 : 1;
    commit(startV + ((e.clientX - startX) / r.width) * (o.max - o.min) * k);
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    slider.classList.remove('drag');
    try {
      slider.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };
  slider.addEventListener('pointerup', end);
  slider.addEventListener('pointercancel', end);
  slider.addEventListener('dblclick', () => commit(o.def));
  slider.addEventListener('keydown', (e) => {
    const big = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') commit(value + o.step * big);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') commit(value - o.step * big);
    else if (e.key === 'Home') commit(o.min);
    else if (e.key === 'End') commit(o.max);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  slider.addEventListener(
    'wheel',
    (e) => {
      if (!e.altKey) return;
      e.preventDefault();
      commit(value - Math.sign(e.deltaY) * o.step);
    },
    { passive: false },
  );

  input.addEventListener('focus', () => input.select());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = fmt(value);
      input.blur();
    }
  });
  input.addEventListener('blur', () => {
    const n = parseFloat(input.value.replace(',', '.').replace('−', '-'));
    if (isFinite(n)) commit(n / scale);
    input.value = fmt(value);
  });

  render();
  const label = h(
    'div',
    { class: 'label', title: `${o.hint ? `${o.hint}\n` : ''}Drag sideways to change · double-click to reset to ${fmt(o.def)}` },
    o.label,
  );
  label.addEventListener('dblclick', (e) => {
    e.preventDefault();
    commit(o.def);
  });
  const row = h('div', { class: 'row' }, label, slider, input);
  // Raw (unquantised) value while scrubbing, so slow drags still accumulate.
  makeScrubbable(label, () => row, {
    start: () => value,
    perPx: (o.max - o.min) / 320,
    detents: o.min < 0 && o.max > 0 && o.def !== 0 ? [{ v: o.def, name: 'Default' }, { v: 0, name: 'Zero' }] : [{ v: o.def, name: 'Default' }],
    apply: (v) => commit(clamp(v, o.min, o.max)),
    readout: (v) => {
      const c = clamp(v, o.min, o.max);
      return [fmt(quant(c)), frac(c), c <= o.min || c >= o.max ? (c <= o.min ? 'Minimum' : 'Maximum') : undefined];
    },
    cancel: (v) => commit(v),
  });
  return {
    row,
    slider,
    set: (v: number) => {
      value = v;
      render();
    },
    setMod: (v: number | null) => {
      if (v === null || Math.abs(v - value) < (o.max - o.min) * 0.002) {
        slider.classList.remove('driven');
        return;
      }
      slider.classList.add('driven');
      mod.style.left = `${clamp(frac(v), 0, 1) * 100}%`;
    },
  };
}

export interface SegOpts<T extends string | number> {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
}

export function segmented<T extends string | number>(o: SegOpts<T>): { el: HTMLElement; set: (v: T) => void } {
  const buttons = o.options.map((opt) =>
    h(
      'button',
      {
        type: 'button',
        title: opt.title ?? opt.label,
        onclick: () => {
          set(opt.value);
          o.onChange(opt.value);
        },
      },
      opt.label,
    ),
  );
  const el = h('div', { class: 'seg', role: 'radiogroup' }, buttons);
  const set = (v: T) => {
    o.options.forEach((opt, i) => {
      buttons[i].classList.toggle('on', opt.value === v);
      buttons[i].setAttribute('aria-checked', String(opt.value === v));
    });
  };
  set(o.value);
  return { el, set };
}

export function selectRow(label: string, o: SegOpts<string>): { row: HTMLElement; set: (v: string) => void } {
  let current = o.value;
  const idx = () => Math.max(0, o.options.findIndex((x) => x.value === current));
  const lab = h('div', { class: 'label', title: 'Drag sideways to step through the options' }, label);
  const scrubOpts = (setUi: (v: string) => void): ScrubOpts => ({
    start: () => idx(),
    perPx: 1 / 34,
    detents: [],
    apply: (v) => {
      const i = Math.round(clamp(v, 0, o.options.length - 1));
      const next = o.options[i].value;
      if (next !== current) {
        current = next;
        setUi(next);
        o.onChange(next);
      }
    },
    readout: (v) => {
      const i = Math.round(clamp(v, 0, o.options.length - 1));
      return [o.options[i].label, o.options.length > 1 ? i / (o.options.length - 1) : 0];
    },
    cancel: (v) => {
      const next = o.options[Math.round(v)].value;
      current = next;
      setUi(next);
      o.onChange(next);
    },
  });
  if (o.options.length <= 4) {
    const s = segmented({ ...o, onChange: (v) => ((current = v), o.onChange(v)) });
    const row = h('div', { class: 'row wide' }, lab, s.el);
    makeScrubbable(lab, () => row, scrubOpts(s.set));
    return { row, set: (v) => ((current = v), s.set(v)) };
  }
  const sel = h(
    'select',
    { class: 'select', onchange: () => o.onChange(sel.value) },
    o.options.map((opt) => h('option', { value: opt.value }, opt.label)),
  );
  sel.value = o.value;
  sel.addEventListener('change', () => (current = sel.value));
  const row = h('div', { class: 'row wide' }, lab, sel);
  makeScrubbable(lab, () => row, scrubOpts((v) => (sel.value = v)));
  return { row, set: (v) => ((current = v), (sel.value = v)) };
}

export function check(on: boolean, onChange: (v: boolean) => void, label?: string): { el: HTMLElement; set: (v: boolean) => void } {
  const box = h('span', { class: `check ${on ? 'on' : ''}` });
  const el = h(
    'button',
    {
      type: 'button',
      class: 'hstack',
      role: 'switch',
      'aria-checked': String(on),
      'aria-label': label ?? 'toggle',
      onclick: (e: Event) => {
        e.stopPropagation();
        on = !on;
        set(on);
        onChange(on);
      },
    },
    box,
    label ? h('span', { class: 'label' }, label) : null,
  );
  const set = (v: boolean) => {
    on = v;
    box.classList.toggle('on', v);
    el.setAttribute('aria-checked', String(v));
  };
  return { el, set };
}
