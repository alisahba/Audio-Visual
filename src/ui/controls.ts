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
    { class: 'label', title: `${o.hint ? `${o.hint}\n` : ''}Double-click to reset to ${fmt(o.def)}` },
    o.label,
  );
  label.addEventListener('dblclick', (e) => {
    e.preventDefault();
    commit(o.def);
  });
  const row = h('div', { class: 'row' }, label, slider, input);
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
  if (o.options.length <= 4) {
    const s = segmented(o);
    return { row: h('div', { class: 'row wide' }, h('div', { class: 'label' }, label), s.el), set: s.set };
  }
  const sel = h(
    'select',
    { class: 'select', onchange: () => o.onChange(sel.value) },
    o.options.map((opt) => h('option', { value: opt.value }, opt.label)),
  );
  sel.value = o.value;
  return { row: h('div', { class: 'row wide' }, h('div', { class: 'label' }, label), sel), set: (v) => (sel.value = v) };
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
