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

export interface SectionOpts {
  /** Adds a master switch to the header; called when it is flipped. */
  onSwitch?: (on: boolean) => void;
  switchHint?: string;
}

export class Section {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private summaryEl: HTMLElement;
  private head: HTMLElement;
  private switchEl: HTMLButtonElement | null = null;

  constructor(
    readonly id: string,
    num: string,
    title: string,
    hint: string,
    opts: SectionOpts = {},
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
    const top = h('div', { class: 'sec-top' }, this.head);
    if (opts.onSwitch) {
      const onSwitch = opts.onSwitch;
      this.switchEl = h(
        'button',
        {
          type: 'button',
          class: 'sec-switch',
          role: 'switch',
          'aria-checked': 'true',
          'aria-label': `${title} on or off`,
          title: opts.switchHint ?? `Switch every ${title} effect off at once; switching back restores the ones you had on`,
          onclick: () => onSwitch(!this.switchedOn),
        },
        h('i'),
      ) as HTMLButtonElement;
      top.appendChild(this.switchEl);
    }
    this.el = h('section', { class: 'sec', id: `sec-${id}`, 'data-sec': id }, top, this.body);
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

  get switchedOn(): boolean {
    return this.switchEl?.getAttribute('aria-checked') !== 'false';
  }

  /** Reflect the master switch; a switched-off section is dimmed but stays editable. */
  setSwitch(on: boolean): void {
    if (!this.switchEl) return;
    this.switchEl.setAttribute('aria-checked', String(on));
    this.el.classList.toggle('bypassed', !on);
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
