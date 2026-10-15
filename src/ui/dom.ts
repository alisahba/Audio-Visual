type Attrs = Record<string, unknown> & {
  class?: string;
  style?: Partial<CSSStyleDeclaration> | string;
};
type Child = Node | string | number | null | undefined | false | Child[];

/** Tiny hyperscript helper. `on*` attributes become listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k in el && typeof v !== 'string') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function svg(markup: string, cls = ''): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  const s = t.content.firstChild as SVGSVGElement;
  if (cls) s.setAttribute('class', cls);
  return s;
}

const I = (body: string, vb = '0 0 16 16') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter">${body}</svg>`;

export const icons = {
  play: `<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor"/></svg>`,
  pause: `<svg viewBox="0 0 16 16"><path d="M4 2.5h3v11H4zM9.5 2.5h3v11h-3z" fill="currentColor"/></svg>`,
  restart: I('<path d="M3 3v10M13 3 6 8l7 5z"/>'),
  loop: I('<path d="M2.5 7V5.5h9.5M10 3l2.5 2.5L10 8M13.5 9v1.5H4M6 13l-2.5-2.5L6 8"/>'),
  camera: I('<path d="M2 5h3l1.2-1.8h3.6L11 5h3v8H2z"/><circle cx="8" cy="9" r="2.2"/>'),
  undo: I('<path d="M5 3 2 6l3 3M2.5 6H10a3.5 3.5 0 0 1 0 7H6"/>'),
  redo: I('<path d="m11 3 3 3-3 3M13.5 6H6a3.5 3.5 0 0 0 0 7h4"/>'),
  moon: I('<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3 4.5 4.5 0 0 0 13 9.5z"/>'),
  sun: I('<circle cx="8" cy="8" r="2.8"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3"/>'),
  caret: I('<path d="m6 3 5 5-5 5"/>'),
  close: I('<path d="m3 3 10 10M13 3 3 13"/>'),
  dice: I('<rect x="2.5" y="2.5" width="11" height="11"/><circle cx="5.5" cy="5.5" r=".6" fill="currentColor"/><circle cx="10.5" cy="10.5" r=".6" fill="currentColor"/><circle cx="8" cy="8" r=".6" fill="currentColor"/>'),
  clear: I('<path d="M3 13h10M5 10l6-6 2 2-6 6H5z"/>'),
  expand: I('<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>'),
  volume: I('<path d="M2 6h3l4-3v10l-4-3H2zM11.5 5.5a3.5 3.5 0 0 1 0 5"/>'),
  mute: I('<path d="M2 6h3l4-3v10l-4-3H2zM11 6l4 4M15 6l-4 4"/>'),
  folder: I('<path d="M2 4h4l1.5 1.5H14V13H2z"/>'),
  file: I('<path d="M4 2h5l3 3v9H4z"/>'),
  mic: I('<rect x="6" y="2" width="4" height="8" rx="2"/><path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V15"/>'),
  screen: I('<rect x="1.5" y="2.5" width="13" height="9"/><path d="M5 14h6"/>'),
  stop: `<svg viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" fill="currentColor"/></svg>`,
  rec: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="currentColor"/></svg>`,
  search: I('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>'),
  help: I('<circle cx="8" cy="8" r="6.5"/><path d="M6.2 6.2A1.9 1.9 0 1 1 8 8.6V10M8 11.6v.8"/>'),
  save: I('<path d="M2.5 2.5h9l2 2v9h-11z"/><path d="M5 2.5v3.5h5V2.5M5 13.5V9.5h6v4"/>'),
  open: I('<path d="M2 4h4l1.5 1.5H14V13H2z"/><path d="M8 11V7M6 9l2-2 2 2"/>'),
};

export type IconName = keyof typeof icons;

export function icon(name: IconName): SVGSVGElement {
  return svg(icons[name]);
}

export function fmtTime(t: number, dp = 2): string {
  if (!isFinite(t)) t = 0;
  const neg = t < 0;
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const ss = dp > 0 ? s.toFixed(dp).padStart(3 + dp, '0') : String(Math.floor(s)).padStart(2, '0');
  return `${neg ? '−' : ''}${String(m).padStart(2, '0')}:${ss}`;
}

export function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

/** Canvas sized to its CSS box at device pixel ratio. Returns the 2D context. */
export function fitCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const r = c.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr));
  const hh = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w) c.width = w;
  if (c.height !== hh) c.height = hh;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let toastHost: HTMLElement | null = null;
export function toast(msg: string, kind: 'info' | 'error' = 'info', ms = 4200): void {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts' });
    document.body.appendChild(toastHost);
  }
  const t = h('div', { class: `toast ${kind === 'error' ? 'error' : ''}` }, msg);
  toastHost.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
