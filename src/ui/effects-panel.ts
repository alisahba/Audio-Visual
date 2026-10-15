import type { Features } from '../audio/features';
import { DRIVES, EFFECTS, GROUPS, type Drive, type EffectDef, type RangeParam } from '../state/defs';
import { modulated } from '../state/modulate';
import { PALETTES } from '../state/presets';
import { store } from '../state/store';
import { check, rangeRow, segmented, selectRow, type RangeRow } from './controls';
import { h, icon } from './dom';
import { randomPalette } from './palette';

interface CardRefs {
  card: HTMLElement;
  check: { set: (v: boolean) => void } | null;
  drive: HTMLElement | null;
}

export class EffectsPanel {
  readonly el: HTMLElement;
  private ranges = new Map<string, RangeRow>();
  private selects = new Map<string, (v: string) => void>();
  private cards = new Map<string, CardRefs>();
  private swatches: HTMLElement[] = [];
  private bgSwatch!: HTMLElement;
  private pop: HTMLElement | null = null;
  artworkPalette: (() => void) | null = null;
  private artBtn!: HTMLButtonElement;

  constructor() {
    this.el = h('aside', { class: 'panel right', 'aria-label': 'Effects' });
    for (const g of GROUPS) {
      const sec = h(
        'section',
        { class: 'sec', id: `sec-${g.id}` },
        h('div', { class: 'sec-head' }, h('span', { class: 'num' }, g.num), h('span', { class: 'title' }, g.label), h('span', { class: 'hint' }, g.hint)),
      );
      if (g.id === 'colour') sec.appendChild(this.paletteBlock());
      for (const e of EFFECTS.filter((x) => x.group === g.id)) sec.appendChild(this.card(e));
      this.el.appendChild(sec);
    }
    document.addEventListener('pointerdown', (e) => {
      if (this.pop && !this.pop.contains(e.target as Node)) this.closePop();
    });
    store.on((topic) => {
      if (topic === 'fx' || topic === 'palette' || topic === 'all') this.sync();
    });
    this.sync();
  }

  private card(e: EffectDef): HTMLElement {
    const st = () => store.p.fx[e.id];
    const body = h('div', { class: 'card-body' });
    if (e.hint) body.appendChild(h('div', { class: 'card-hint' }, e.hint));
    for (const pd of e.params) {
      const key = `${e.id}.${pd.key}`;
      if (pd.type === 'range') {
        const r = rangeRow({
          label: pd.label,
          min: pd.min,
          max: pd.max,
          step: pd.step,
          def: pd.def,
          unit: pd.unit,
          dp: pd.dp,
          value: st().p[pd.key] as number,
          onInput: (v) => store.update('fx', (p) => (p.fx[e.id].p[pd.key] = v)),
        });
        this.ranges.set(key, r);
        body.appendChild(r.row);
      } else if (pd.type === 'select') {
        const s = selectRow(pd.label, {
          options: pd.options,
          value: st().p[pd.key] as string,
          onChange: (v) => store.update('fx', (p) => (p.fx[e.id].p[pd.key] = v)),
        });
        this.selects.set(key, s.set);
        body.appendChild(s.row);
      }
    }

    const caret = icon('caret');
    caret.setAttribute('class', 'caret');
    const toggle = e.alwaysOn
      ? null
      : check(st().on, (v) => {
          store.update('fx', (p) => (p.fx[e.id].on = v));
          card.classList.toggle('open', v);
        });
    let driveBtn: HTMLElement | null = null;
    if (e.drive) {
      driveBtn = h('button', { type: 'button', class: 'drive', title: 'Audio drive' }, h('i', { class: 'lamp' }), h('span', { class: 'drive-label' }, 'Off'));
      driveBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.openDrive(e, driveBtn!);
      });
    }
    const head = h(
      'div',
      { class: 'card-head', onclick: () => card.classList.toggle('open') },
      toggle ? toggle.el : h('span', { style: 'width:12px' }),
      h('span', { class: 'name' }, e.label),
      driveBtn,
      caret,
    );
    const card = h('div', { class: `card ${st().on ? 'open' : ''}`, 'data-fx': e.id }, head, body);
    this.cards.set(e.id, { card, check: toggle, drive: driveBtn });
    return card;
  }

  private openDrive(e: EffectDef, anchor: HTMLElement): void {
    this.closePop();
    const st = store.p.fx[e.id];
    const target = e.params.find((p) => p.key === e.drive!.param) as RangeParam;
    const seg = segmented<Drive>({
      options: DRIVES.map((d) => ({ value: d.value, label: d.label })),
      value: st.drive,
      onChange: (v) => store.update('fx', (p) => (p.fx[e.id].drive = v)),
    });
    seg.el.classList.add('grid');
    const depth = rangeRow({
      label: 'Depth',
      min: -1,
      max: 1,
      step: 0.01,
      def: e.drive!.depth,
      value: st.depth,
      onInput: (v) => store.update('fx', (p) => (p.fx[e.id].depth = v)),
    });
    const pop = h(
      'div',
      { class: 'pop', role: 'dialog', 'aria-label': `${e.label} audio drive` },
      h('div', { class: 'pop-title' }, h('span', null, `${e.label} — audio drive`), h('span', { class: 'muted' }, target.label)),
      seg.el,
      depth.row,
      h(
        'div',
        { class: 'note', style: 'margin-top:8px' },
        `Low, Mid, High, Level and Beat let that part of the sound push “${target.label}” away from its set value. Time rises steadily across the clip; Wave swings slowly every two bars. Negative depth pulls the other way.`,
      ),
    );
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6);
    pop.style.top = `${top}px`;
    pop.style.left = `${Math.max(8, r.right - pop.offsetWidth)}px`;
    this.pop = pop;
  }

  private closePop(): void {
    this.pop?.remove();
    this.pop = null;
  }

  private paletteBlock(): HTMLElement {
    const wrap = h('div', { style: 'margin-bottom:14px' });
    const head = h('div', { class: 'sub-head' }, h('span', null, 'Palette'));
    const actions = h('span', { class: 'hstack' });
    this.artBtn = h('button', { type: 'button', class: 'btn small ghost', title: 'Take colours from the track artwork', onclick: () => this.artworkPalette?.() }, 'From artwork') as HTMLButtonElement;
    this.artBtn.style.display = 'none';
    const dice = h('button', { type: 'button', class: 'btn small ghost', title: 'Random palette', onclick: () => store.update('palette', (p) => (p.palette = randomPalette())) }, icon('dice'), 'Shuffle');
    actions.append(this.artBtn, dice);
    head.appendChild(actions);
    const pal = h('div', { class: 'palette' });
    for (let i = 0; i < 5; i++) {
      const input = h('input', {
        type: 'color',
        'aria-label': `Colour ${i + 1}`,
        oninput: () => store.update('palette', (p) => (p.palette[i] = input.value)),
      });
      const sw = h('label', { class: 'sw' }, input);
      this.swatches.push(sw);
      pal.appendChild(h('div', null, sw, h('div', { class: 'cap' }, String(i + 1).padStart(2, '0'))));
    }
    pal.appendChild(h('div'));
    const bgIn = h('input', {
      type: 'color',
      'aria-label': 'Background',
      oninput: () => store.update('palette', (p) => (p.background = bgIn.value)),
    });
    this.bgSwatch = h('label', { class: 'sw' }, bgIn);
    pal.appendChild(h('div', null, this.bgSwatch, h('div', { class: 'cap' }, 'Ground')));
    const list = h(
      'div',
      { class: 'palette-list' },
      PALETTES.map((pp) =>
        h(
          'button',
          {
            type: 'button',
            title: pp.name,
            'aria-label': `${pp.name} palette`,
            onclick: () =>
              store.update('palette', (p) => {
                p.palette = pp.colors.slice();
                p.background = pp.bg;
              }),
          },
          h('span', { style: `background:${pp.bg}` }),
          pp.colors.map((c) => h('span', { style: `background:${c}` })),
        ),
      ),
    );
    wrap.append(head, pal, list);
    return wrap;
  }

  setArtworkAvailable(v: boolean): void {
    this.artBtn.style.display = v ? '' : 'none';
  }

  sync(): void {
    const p = store.p;
    for (const e of EFFECTS) {
      const st = p.fx[e.id];
      const refs = this.cards.get(e.id)!;
      refs.check?.set(st.on);
      refs.card.classList.toggle('off', !st.on && !e.alwaysOn);
      if (refs.drive) {
        const active = st.drive !== 'none' && Math.abs(st.depth) > 0.001;
        refs.drive.classList.toggle('active', active);
        refs.drive.querySelector('.drive-label')!.textContent = st.drive === 'none' ? 'Off' : `${st.drive} ${Math.round(st.depth * 100)}`;
      }
      for (const pd of e.params) {
        const key = `${e.id}.${pd.key}`;
        if (pd.type === 'range') this.ranges.get(key)?.set(st.p[pd.key] as number);
        else if (pd.type === 'select') this.selects.get(key)?.(st.p[pd.key] as string);
      }
    }
    for (let i = 0; i < 5; i++) {
      const c = p.palette[i];
      this.swatches[i].style.background = c;
      (this.swatches[i].querySelector('input') as HTMLInputElement).value = c;
    }
    this.bgSwatch.style.background = p.background;
    (this.bgSwatch.querySelector('input') as HTMLInputElement).value = p.background;
  }

  /** Called ~30×/s with live features to animate modulation markers and lamps. */
  tick(f: Features): void {
    const p = store.p;
    for (const e of EFFECTS) {
      if (!e.drive) continue;
      const st = p.fx[e.id];
      const key = `${e.id}.${e.drive.param}`;
      const row = this.ranges.get(key);
      const active = st.drive !== 'none' && st.on;
      row?.setMod(active ? modulated(p, f, e.id, e.drive.param) : null);
      const refs = this.cards.get(e.id);
      if (refs?.drive && active) {
        const v = st.drive === 'none' ? 0 : f[st.drive];
        refs.drive.style.setProperty('--lvl', String(Math.min(1, v)));
      }
    }
  }
}
