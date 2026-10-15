import { PRESETS, applyPreset, type Preset } from '../state/presets';
import { store } from '../state/store';
import { h } from './dom';

function thumb(p: Preset, i: number): string {
  const c = p.palette;
  const spots = [
    `radial-gradient(ellipse 60% 45% at ${30 + ((i * 17) % 40)}% ${35 + ((i * 23) % 30)}%, ${c[0]}, transparent 70%)`,
    `radial-gradient(ellipse 55% 50% at ${70 - ((i * 13) % 40)}% ${65 - ((i * 7) % 30)}%, ${c[2]}, transparent 70%)`,
    `radial-gradient(ellipse 70% 30% at 50% ${80 - ((i * 11) % 30)}%, ${c[1]}, transparent 70%)`,
    `linear-gradient(${180 + i * 25}deg, ${p.background} 30%, ${c[4]}33)`,
  ];
  return spots.join(',');
}

export class PresetsMenu {
  private el: HTMLElement | null = null;
  constructor(
    private anchor: HTMLElement,
    private onApply: () => void,
  ) {}

  toggle(): void {
    if (this.el) return this.close();
    const grid = h(
      'div',
      { class: 'grid' },
      PRESETS.map((p, i) =>
        h(
          'button',
          { type: 'button', class: 'preset', onclick: () => this.apply(p) },
          h('div', { class: 'swatch', style: `background:${thumb(p, i)};background-color:${p.background}` }),
          h('div', { class: 'p-num' }, String(i + 1).padStart(2, '0')),
          h('div', { class: 'p-name' }, p.name),
          h('div', { class: 'p-note' }, p.note),
        ),
      ),
    );
    this.el = h(
      'div',
      { class: 'presets', role: 'dialog', 'aria-label': 'Presets' },
      h('div', { class: 'presets-head' }, h('span', { class: 'title' }, 'Presets'), h('span', { class: 'hint' }, 'Starting points — every control stays editable. Keys 1–9, 0 for the tenth.')),
      grid,
    );
    document.body.appendChild(this.el);
    setTimeout(() => document.addEventListener('pointerdown', this.outside), 0);
  }

  private outside = (e: PointerEvent) => {
    if (this.el && !this.el.contains(e.target as Node) && !this.anchor.contains(e.target as Node)) this.close();
  };

  close(): void {
    this.el?.remove();
    this.el = null;
    document.removeEventListener('pointerdown', this.outside);
  }

  apply(p: Preset): void {
    store.update('all', (proj) => applyPreset(proj, p));
    this.onApply();
    this.close();
  }

  applyIndex(i: number): void {
    const p = PRESETS[i];
    if (p) this.apply(p);
  }
}
