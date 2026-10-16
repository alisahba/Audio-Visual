import { PRESETS, applyPreset, type Preset } from '../state/presets';
import { store } from '../state/store';
import { h, icon } from './dom';

const BASE = `${import.meta.env.BASE_URL}presets/`;

/** Painted stand-in while (or if) the rendered preview isn't available. */
function fallback(p: Preset, i: number): string {
  const c = p.palette;
  return [
    `radial-gradient(ellipse 60% 45% at ${30 + ((i * 17) % 40)}% ${35 + ((i * 23) % 30)}%, ${c[0]}, transparent 70%)`,
    `radial-gradient(ellipse 55% 50% at ${70 - ((i * 13) % 40)}% ${65 - ((i * 7) % 30)}%, ${c[2]}, transparent 70%)`,
    `radial-gradient(ellipse 70% 30% at 50% ${80 - ((i * 11) % 30)}%, ${c[1]}, transparent 70%)`,
  ].join(',');
}

export class PresetsMenu {
  private el: HTMLElement | null = null;
  constructor(
    private anchor: HTMLElement,
    private onApply: () => void,
    private onSurprise?: () => void,
  ) {}

  toggle(): void {
    if (this.el) return this.close();
    const current = store.p.name;
    const grid = h(
      'div',
      { class: 'grid' },
      PRESETS.map((p, i) => {
        const key = i < 9 ? String(i + 1) : i === 9 ? '0' : '';
        const img = h('img', { src: `${BASE}${p.id}.webp`, alt: '', loading: 'lazy', decoding: 'async' }) as HTMLImageElement;
        img.addEventListener('error', () => img.remove());
        const thumb = h('div', { class: 'swatch', style: `background:${fallback(p, i)};background-color:${p.background}` }, img);
        let video: HTMLVideoElement | null = null;
        // The loop plays while the card is hovered or focused.
        const play = () => {
          if (!video) {
            video = h('video', { src: `${BASE}${p.id}.mp4`, muted: true, loop: true, playsInline: true, preload: 'auto' }) as HTMLVideoElement;
            video.muted = true;
            video.addEventListener('error', () => video?.remove());
            thumb.appendChild(video);
          }
          video.currentTime = 0;
          void video.play().catch(() => {});
          thumb.classList.add('playing');
        };
        const stop = () => {
          video?.pause();
          thumb.classList.remove('playing');
        };
        const card = h(
          'button',
          {
            type: 'button',
            class: `preset ${p.name === current ? 'current' : ''}`,
            title: key ? `${p.name} — key ${key}` : p.name,
            onclick: () => this.apply(p),
          },
          thumb,
          h('div', { class: 'p-line' }, key ? h('span', { class: 'p-key' }, key) : null, h('span', { class: 'p-name' }, p.name)),
          h('div', { class: 'p-note' }, p.note),
        );
        card.addEventListener('pointerenter', play);
        card.addEventListener('pointerleave', stop);
        card.addEventListener('focus', play);
        card.addEventListener('blur', stop);
        return card;
      }),
    );
    this.el = h(
      'div',
      { class: 'presets', role: 'dialog', 'aria-label': 'Presets' },
      h(
        'div',
        { class: 'presets-head' },
        h('span', { class: 'title' }, 'Presets'),
        h('span', { class: 'hint' }, 'Hover to preview, click to load. Keys 1–9 and 0 load the first ten.'),
        this.onSurprise
          ? h('button', { type: 'button', class: 'btn small', title: 'A new look built from a random preset (G)', onclick: () => (this.close(), this.onSurprise?.()) }, icon('dice'), 'Surprise me')
          : null,
      ),
      grid,
    );
    document.body.appendChild(this.el);
    setTimeout(() => document.addEventListener('pointerdown', this.outside), 0);
  }

  private outside = (e: PointerEvent) => {
    if (this.el && !this.el.contains(e.target as Node) && !this.anchor.contains(e.target as Node)) this.close();
  };

  close(): void {
    this.el?.querySelectorAll('video').forEach((v) => v.pause());
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
