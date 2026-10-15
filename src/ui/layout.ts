// Resizable side panels and interface size, remembered per browser.

import { h } from './dom';

const KEY = 'klangbild.layout.v1';

interface Layout {
  left?: number;
  right?: number;
  scale?: number;
}

export const UI_SCALES = [1, 1.15, 1.3, 1.45];

function read(): Layout {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function write(l: Layout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* ignore */
  }
}

const LIMITS = { left: [230, 620], right: [270, 720] } as const;
const MIN_STAGE = 360;

/**
 * Adds drag handles on the inner edges of both side panels. Widths are CSS
 * variables on the app grid; double-click a handle to go back to the default.
 */
export function installLayout(app: HTMLElement, left: HTMLElement, right: HTMLElement, onChange: () => void): { setScale: (s: number) => void; scale: () => number } {
  const state = read();

  const apply = () => {
    for (const side of ['left', 'right'] as const) {
      const v = state[side];
      if (v) app.style.setProperty(`--${side}-w`, `${Math.round(v)}px`);
      else app.style.removeProperty(`--${side}-w`);
    }
    const s = state.scale ?? 1;
    app.style.setProperty('--ui-zoom', String(s));
    app.classList.toggle('zoomed', s !== 1);
  };

  const handle = (side: 'left' | 'right', panel: HTMLElement) => {
    const el = h('div', {
      class: `resizer ${side}`,
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': `Resize the ${side} panel`,
      title: 'Drag to resize · double-click to reset',
      tabindex: '0',
    });
    let startX = 0;
    let startW = 0;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startW = panel.getBoundingClientRect().width;
      el.classList.add('drag');
      document.body.classList.add('resizing');
    });
    el.addEventListener('pointermove', (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - startX;
      set(side, startW + (side === 'left' ? dx : -dx));
    });
    const end = (e: PointerEvent) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      el.releasePointerCapture(e.pointerId);
      el.classList.remove('drag');
      document.body.classList.remove('resizing');
      write(state);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => {
      delete state[side];
      apply();
      write(state);
      onChange();
    });
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 40 : 10;
      const cur = panel.getBoundingClientRect().width;
      if (e.key === 'ArrowLeft') set(side, cur + (side === 'left' ? -step : step));
      else if (e.key === 'ArrowRight') set(side, cur + (side === 'left' ? step : -step));
      else return;
      e.preventDefault();
      e.stopPropagation();
      write(state);
    });
    app.appendChild(el);
  };

  const set = (side: 'left' | 'right', w: number) => {
    const [lo, hi] = LIMITS[side];
    const other = (side === 'left' ? right : left).getBoundingClientRect().width;
    const room = window.innerWidth - other - MIN_STAGE;
    state[side] = Math.max(lo, Math.min(hi, room, w));
    apply();
    onChange();
  };

  handle('left', left);
  handle('right', right);
  apply();
  return {
    setScale: (s: number) => {
      state.scale = s;
      apply();
      write(state);
      onChange();
    },
    scale: () => state.scale ?? 1,
  };
}
