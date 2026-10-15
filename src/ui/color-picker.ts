// A small HSV colour picker in a popover: saturation/brightness field, hue
// strip, hex entry, eyedropper, quick tints and recently used colours.

import { h, icon } from './dom';
import { rgbHex } from './palette';

const RECENT = 'klangbild.recentColours.v1';

export function hexToHsv(hex: string): [number, number, number] {
  const m = hex.replace('#', '').padEnd(6, '0');
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let hh = 0;
  if (d > 0) {
    if (max === r) hh = ((g - b) / d) % 6;
    else if (max === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
  }
  return [((hh * 60) + 360) % 360, max === 0 ? 0 : d / max, max];
}

export function hsvToHex(hh: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + hh / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbHex(f(5) * 255, f(3) * 255, f(1) * 255);
}

function normHex(s: string): string | null {
  let v = s.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) v = v.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null;
}

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 10) : [];
  } catch {
    return [];
  }
}

function pushRecent(c: string): void {
  try {
    const list = [c, ...readRecent().filter((x) => x !== c)].slice(0, 10);
    localStorage.setItem(RECENT, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

interface EyeDropperCtor {
  new (): { open(): Promise<{ sRGBHex: string }> };
}

let current: { close: () => void } | null = null;

export function closeColorPicker(): void {
  current?.close();
}

/**
 * Open the picker beside `anchor`. `onInput` fires continuously while dragging;
 * the colour joins the recent list when the picker closes.
 */
export function openColorPicker(anchor: HTMLElement, title: string, value: string, onInput: (hex: string) => void): void {
  closeColorPicker();
  let [hu, sa, va] = hexToHsv(value);
  let hex = value.toLowerCase();
  const start = hex;

  const field = h('div', { class: 'cp-field', tabindex: '0', 'aria-label': 'Saturation and brightness' });
  const fieldDot = h('i', { class: 'cp-dot' });
  field.appendChild(fieldDot);
  const hue = h('div', { class: 'cp-hue', tabindex: '0', 'aria-label': 'Hue' });
  const hueDot = h('i', { class: 'cp-knob' });
  hue.appendChild(hueDot);
  const hexIn = h('input', { class: 'textin cp-hex', type: 'text', spellcheck: 'false', 'aria-label': 'Hex colour', maxlength: '7' }) as HTMLInputElement;
  const before = h('button', { type: 'button', class: 'cp-before', title: 'Back to the colour you started with', onclick: () => set(start, true) });
  const after = h('span', { class: 'cp-after' });
  const tints = h('div', { class: 'cp-row' });
  const recent = h('div', { class: 'cp-row' });

  const chip = (c: string, label: string) => h('button', { type: 'button', class: 'cp-chip', title: `${label} ${c}`, style: `background:${c}`, onclick: () => set(c, true) });

  const paint = (fromText = false) => {
    field.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(hu, 1, 1)})`;
    fieldDot.style.left = `${sa * 100}%`;
    fieldDot.style.top = `${(1 - va) * 100}%`;
    fieldDot.style.background = hex;
    hueDot.style.left = `${(hu / 360) * 100}%`;
    hueDot.style.background = hsvToHex(hu, 1, 1);
    after.style.background = hex;
    before.style.background = start;
    if (!fromText) hexIn.value = hex.toUpperCase();
    // Lighter and darker steps of the current hue.
    const steps = [
      [Math.max(0, sa - 0.45), Math.min(1, va + 0.25)],
      [Math.max(0, sa - 0.22), Math.min(1, va + 0.12)],
      [sa, va],
      [Math.min(1, sa + 0.1), va * 0.72],
      [Math.min(1, sa + 0.15), va * 0.45],
    ];
    tints.replaceChildren(h('span', { class: 'cp-cap' }, 'Shades'), ...steps.map(([s, v]) => chip(hsvToHex(hu, s, v), 'Use')));
  };

  const emit = () => {
    hex = hsvToHex(hu, sa, va);
    paint();
    onInput(hex);
  };

  const set = (c: string, commit = false) => {
    const n = normHex(c);
    if (!n) return;
    [hu, sa, va] = hexToHsv(n);
    hex = n;
    paint();
    onInput(hex);
    if (commit) pushRecent(hex);
  };

  const drag = (el: HTMLElement, move: (x: number, y: number) => void) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.focus();
      el.setPointerCapture(e.pointerId);
      const at = (ev: PointerEvent) => {
        const r = el.getBoundingClientRect();
        move(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
      };
      at(e);
      const mv = (ev: PointerEvent) => at(ev);
      const up = () => {
        el.removeEventListener('pointermove', mv);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  };
  drag(field, (x, y) => {
    sa = x;
    va = 1 - y;
    emit();
  });
  drag(hue, (x) => {
    hu = Math.min(359.9, x * 360);
    emit();
  });
  field.addEventListener('keydown', (e) => {
    const k = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') sa = Math.max(0, sa - k);
    else if (e.key === 'ArrowRight') sa = Math.min(1, sa + k);
    else if (e.key === 'ArrowUp') va = Math.min(1, va + k);
    else if (e.key === 'ArrowDown') va = Math.max(0, va - k);
    else return;
    e.preventDefault();
    e.stopPropagation();
    emit();
  });
  hue.addEventListener('keydown', (e) => {
    const k = e.shiftKey ? 15 : 2;
    if (e.key === 'ArrowLeft') hu = (hu - k + 360) % 360;
    else if (e.key === 'ArrowRight') hu = (hu + k) % 360;
    else return;
    e.preventDefault();
    e.stopPropagation();
    emit();
  });
  hexIn.addEventListener('input', () => {
    const n = normHex(hexIn.value);
    if (!n) return;
    [hu, sa, va] = hexToHsv(n);
    hex = n;
    paint(true);
    onInput(hex);
  });
  hexIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') close();
  });

  const ED = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  const dropper = ED
    ? h(
        'button',
        {
          type: 'button',
          class: 'btn icon ghost',
          title: 'Pick a colour from anywhere on screen',
          'aria-label': 'Eyedropper',
          onclick: async () => {
            try {
              const r = await new ED().open();
              set(r.sRGBHex, true);
            } catch {
              /* cancelled */
            }
          },
        },
        icon('dropper'),
      )
    : null;

  const rec = readRecent();
  if (rec.length) recent.append(h('span', { class: 'cp-cap' }, 'Recent'), ...rec.map((c) => chip(c, 'Use')));

  const pop = h(
    'div',
    { class: 'pop cp', role: 'dialog', 'aria-label': `${title} colour` },
    h('div', { class: 'pop-title' }, h('span', null, title), h('span', { class: 'cp-compare' }, before, after)),
    field,
    hue,
    h('div', { class: 'cp-line' }, h('span', { class: 'cp-cap' }, 'Hex'), hexIn, dropper),
    tints,
    recent,
  );
  document.body.appendChild(pop);
  paint();

  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const hgt = pop.offsetHeight;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
  let top = r.bottom + 8;
  if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  const outside = (e: PointerEvent) => {
    if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  function close() {
    if (!pop.isConnected) return;
    pop.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', esc, true);
    if (hex !== start) pushRecent(hex);
    current = null;
  }
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
  }, 0);
  current = { close };
  field.focus();
}
