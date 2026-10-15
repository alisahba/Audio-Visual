// Foldable, numbered panel section. Fold state persists per section.

import { h, icon } from './dom';

const KEY = 'klangbild.folds.v1';

function readFolds(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

const all = new Map<string, Section>();

export class Section {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private summaryEl: HTMLElement;
  private head: HTMLElement;

  constructor(
    readonly id: string,
    num: string,
    title: string,
    hint: string,
  ) {
    this.summaryEl = h('span', { class: 'summary' });
    const chevron = icon('caret');
    chevron.setAttribute('class', 'chev');
    this.head = h(
      'button',
      { type: 'button', class: 'sec-head', title: `${hint} — click to fold, Alt-click to show only this section`, 'aria-expanded': 'true' },
      h('span', { class: 'num' }, num),
      h('span', { class: 'title' }, title),
      this.summaryEl,
      chevron,
    );
    this.body = h('div', { class: 'sec-body' }, h('div', { class: 'sec-hint' }, hint));
    this.el = h('section', { class: 'sec', id: `sec-${id}`, 'data-sec': id }, this.head, this.body);
    this.head.addEventListener('click', (e) => {
      if (e.altKey) {
        for (const s of all.values()) if (s.el.parentElement === this.el.parentElement) s.setOpen(s === this);
      } else this.setOpen(!this.open);
    });
    all.set(id, this);
    this.setOpen(readFolds()[id] !== false, false);
  }

  get open(): boolean {
    return !this.el.classList.contains('folded');
  }

  setOpen(v: boolean, persist = true): void {
    this.el.classList.toggle('folded', !v);
    this.head.setAttribute('aria-expanded', String(v));
    if (!persist) return;
    const f = readFolds();
    f[this.id] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(f));
    } catch {
      /* ignore */
    }
  }

  setSummary(text: string): void {
    this.summaryEl.textContent = text;
  }

  static get(id: string): Section | undefined {
    return all.get(id);
  }

  /** Open a section and scroll it into view. */
  static reveal(id: string): void {
    const s = all.get(id);
    if (!s) return;
    s.setOpen(true);
    s.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
