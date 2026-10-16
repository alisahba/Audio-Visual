// Command palette (Ctrl/⌘ K): type a few letters to run any action, load a
// preset, switch an effect on or off, or jump to a section.

import { h } from './dom';

export interface Command {
  id: string;
  title: string;
  group: string;
  /** Extra words that should find this command. */
  words?: string;
  keys?: string;
  run: () => void;
}

const RECENT = 'klangbild.cmd.recent.v1';

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? '[]');
    return Array.isArray(v) ? v.slice(0, 8) : [];
  } catch {
    return [];
  }
}

/** Higher is better; -1 means no match. Whole-word and prefix hits rank first. */
function score(c: Command, q: string): number {
  if (!q) return 0;
  const title = c.title.toLowerCase();
  const hay = `${title} ${c.group.toLowerCase()} ${c.words ?? ''}`;
  let total = 0;
  for (const w of q.split(/\s+/).filter(Boolean)) {
    const i = hay.indexOf(w);
    if (i >= 0) {
      total += 100 - Math.min(60, i) + (i === 0 || hay[i - 1] === ' ' ? 30 : 0) + (title.includes(w) ? 20 : 0);
      continue;
    }
    // Letters in order (e.g. "prt" → Particles).
    let j = 0;
    let gaps = 0;
    for (const ch of w) {
      const k = title.indexOf(ch, j);
      if (k < 0) return -1;
      gaps += k - j;
      j = k + 1;
    }
    total += Math.max(1, 40 - gaps * 2);
  }
  return total;
}

export class CommandPalette {
  private el: HTMLElement | null = null;
  private input!: HTMLInputElement;
  private list!: HTMLElement;
  private items: Command[] = [];
  private shown: Command[] = [];
  private sel = 0;

  constructor(private provide: () => Command[]) {}

  get open(): boolean {
    return !!this.el;
  }

  toggle(): void {
    if (this.el) this.close();
    else this.show();
  }

  show(): void {
    this.items = this.provide();
    this.input = h('input', { class: 'cmdk-input', type: 'text', placeholder: 'Type a command, preset or effect…', spellcheck: 'false', 'aria-label': 'Command' }) as HTMLInputElement;
    this.list = h('div', { class: 'cmdk-list', role: 'listbox' });
    const panel = h(
      'div',
      { class: 'cmdk', role: 'dialog', 'aria-label': 'Command palette' },
      this.input,
      this.list,
      h('div', { class: 'cmdk-foot' }, h('span', null, '↑ ↓ move'), h('span', null, '↵ run'), h('span', null, 'Esc close')),
    );
    this.el = h('div', { class: 'cmdk-veil', onpointerdown: (e: Event) => e.target === this.el && this.close() }, panel);
    document.body.appendChild(this.el);
    this.input.addEventListener('input', () => {
      this.sel = 0;
      this.render();
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.shown.length;
        if (n) this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        this.render(true);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.run(this.shown[this.sel]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.render();
    this.input.focus();
  }

  close(): void {
    this.el?.remove();
    this.el = null;
  }

  private run(c: Command | undefined): void {
    if (!c) return;
    this.close();
    try {
      localStorage.setItem(RECENT, JSON.stringify([c.id, ...readRecent().filter((x) => x !== c.id)].slice(0, 8)));
    } catch {
      /* ignore */
    }
    c.run();
  }

  private render(keepScroll = false): void {
    const q = this.input.value.trim().toLowerCase();
    if (q) {
      this.shown = this.items
        .map((c) => ({ c, s: score(c, q) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 40)
        .map((x) => x.c);
    } else {
      const recent = readRecent()
        .map((id) => this.items.find((c) => c.id === id))
        .filter((c): c is Command => !!c);
      this.shown = [...recent, ...this.items.filter((c) => !recent.includes(c))].slice(0, 40);
    }
    let lastGroup = '';
    const rows: HTMLElement[] = [];
    const recentCount = q ? 0 : readRecent().filter((id) => this.items.some((c) => c.id === id)).length;
    this.shown.forEach((c, i) => {
      const group = !q && i < recentCount ? 'Recent' : c.group;
      if (group !== lastGroup) {
        rows.push(h('div', { class: 'cmdk-group' }, group));
        lastGroup = group;
      }
      const row = h(
        'div',
        { class: `cmdk-item ${i === this.sel ? 'on' : ''}`, role: 'option', 'aria-selected': String(i === this.sel), onpointerdown: (e: Event) => (e.preventDefault(), this.run(c)) },
        h('span', null, c.title),
        c.keys ? h('kbd', null, c.keys) : null,
      );
      row.addEventListener('pointermove', () => {
        if (this.sel !== i) {
          this.sel = i;
          this.render(true);
        }
      });
      rows.push(row);
    });
    if (!rows.length) rows.push(h('div', { class: 'cmdk-empty' }, 'Nothing matches'));
    const top = this.list.scrollTop;
    this.list.replaceChildren(...rows);
    if (keepScroll) this.list.scrollTop = top;
    this.list.querySelector('.cmdk-item.on')?.scrollIntoView({ block: 'nearest' });
  }
}
