import type { Features } from '../audio/features';
import { DRIVES, EFFECTS, GROUPS, type Drive, type EffectDef, type RangeParam } from '../state/defs';
import { modulated } from '../state/modulate';
import { PALETTES } from '../state/presets';
import { defaultEffects } from '../state/project';
import { store } from '../state/store';
import { openColorPicker } from './color-picker';
import { check, rangeRow, segmented, selectRow, type RangeRow } from './controls';
import { h, icon, toast } from './dom';
import { randomPalette } from './palette';
import { Section } from './section';

interface CardRefs {
  card: HTMLElement;
  check: { set: (v: boolean) => void } | null;
  drive: HTMLElement | null;
}

interface SavedPalette {
  name: string;
  colors: string[];
  bg: string;
}

const MY_PALETTES = 'klangbild.palettes.v1';

const SWITCH_HINT: Record<string, string> = {
  emit: 'Switch all emitters off at once; switching back restores the ones you had on',
  motion: 'Freeze all motion at once; switching back restores the ones you had on',
  time: 'Switch fading off: paint stays until you clear the canvas (C)',
  colour: 'Bypass mapping and colour cycling: the palette as it is',
  post: 'Switch every post effect off at once; switching back restores the ones you had on',
};

function readMine(): SavedPalette[] {
  try {
    return JSON.parse(localStorage.getItem(MY_PALETTES) ?? '[]');
  } catch {
    return [];
  }
}

export class EffectsPanel {
  readonly el: HTMLElement;
  private ranges = new Map<string, RangeRow>();
  private selects = new Map<string, (v: string) => void>();
  private cards = new Map<string, CardRefs>();
  private sections = new Map<string, Section>();
  private navButtons = new Map<string, HTMLElement>();
  private swatches: HTMLElement[] = [];
  private bgSwatch!: HTMLElement;
  private paletteList!: HTMLElement;
  private pop: HTMLElement | null = null;
  artworkPalette: (() => void) | null = null;
  private artBtn!: HTMLButtonElement;

  /** `extras` adds custom UI at the top of an effect card (e.g. the media picker). */
  constructor(private extras: Record<string, HTMLElement> = {}) {
    const nav = h(
      'nav',
      { class: 'sec-nav', 'aria-label': 'Sections' },
      GROUPS.map((g) => {
        const b = h('button', { type: 'button', title: g.hint, onclick: () => Section.reveal(g.id) }, h('b', null, g.num), ` ${g.label}`);
        this.navButtons.set(g.id, b);
        return b;
      }),
    );
    this.el = h('aside', { class: 'panel right', 'aria-label': 'Effects' }, nav);
    for (const g of GROUPS) {
      const sec = new Section(g.id, g.num, g.label, g.hint, {
        switchHint: SWITCH_HINT[g.id],
        onSwitch: (on) =>
          store.update('fx', (p) => {
            if (on) delete p.groupsOff[g.id];
            else p.groupsOff[g.id] = true;
          }),
      });
      this.sections.set(g.id, sec);
      if (g.id === 'colour') sec.body.appendChild(this.paletteBlock());
      for (const e of EFFECTS.filter((x) => x.group === g.id)) sec.body.appendChild(this.card(e));
      this.el.appendChild(sec.el);
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
    if (this.extras[e.id]) body.appendChild(this.extras[e.id]);
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
      driveBtn = h('button', { type: 'button', class: 'drive', title: 'What drives this effect (sound or time)' }, h('i', { class: 'lamp' }), h('span', { class: 'drive-label' }, 'Off'));
      driveBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.openDrive(e, driveBtn!);
      });
    }
    const reset = h(
      'button',
      {
        type: 'button',
        class: 'reset',
        title: `Reset ${e.label} to its defaults`,
        'aria-label': `Reset ${e.label}`,
        onclick: (ev: Event) => {
          ev.stopPropagation();
          const def = defaultEffects()[e.id];
          store.update('fx', (p) => {
            p.fx[e.id].p = def.p;
            p.fx[e.id].drive = def.drive;
            p.fx[e.id].depth = def.depth;
          });
        },
      },
      icon('restart'),
    );
    const head = h(
      'div',
      { class: 'card-head', title: e.hint, onclick: () => card.classList.toggle('open') },
      toggle ? toggle.el : h('span', { class: 'check-spacer' }),
      h('span', { class: 'name' }, e.label),
      reset,
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
      { class: 'pop', role: 'dialog', 'aria-label': `${e.label} drive` },
      h('div', { class: 'pop-title' }, h('span', null, `${e.label} — drive`), h('span', { class: 'muted' }, target.label)),
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
    const wrap = h('div', { class: 'palette-block' });
    const head = h('div', { class: 'sub-head' }, h('span', null, 'Palette'));
    const actions = h('span', { class: 'hstack' });
    this.artBtn = h('button', { type: 'button', class: 'btn small ghost', title: 'Take colours from the track artwork', onclick: () => this.artworkPalette?.() }, 'From artwork') as HTMLButtonElement;
    this.artBtn.style.display = 'none';
    const reverse = h(
      'button',
      { type: 'button', class: 'btn small ghost', title: 'Reverse the order (changes gradient maps and colour cycling)', onclick: () => store.update('palette', (p) => p.palette.reverse()) },
      '⇄',
    );
    const dice = h('button', { type: 'button', class: 'btn small ghost', title: 'Random palette', onclick: () => store.update('palette', (p) => (p.palette = randomPalette())) }, icon('dice'));
    const save = h('button', { type: 'button', class: 'btn small', title: 'Save these colours as your own palette', onclick: () => this.savePalette() }, 'Save');
    actions.append(this.artBtn, reverse, dice, save);
    head.appendChild(actions);
    const pal = h('div', { class: 'palette' });
    for (let i = 0; i < 5; i++) {
      const name = `Colour ${String(i + 1).padStart(2, '0')}`;
      const sw: HTMLButtonElement = h('button', {
        type: 'button',
        class: 'sw',
        title: `${name}: click to make your own colour`,
        'aria-label': name,
        onclick: () => openColorPicker(sw, name, store.p.palette[i], (c) => store.update('palette', (p) => (p.palette[i] = c))),
      });
      this.swatches.push(sw);
      pal.appendChild(h('div', null, sw, h('div', { class: 'cap' }, String(i + 1).padStart(2, '0'))));
    }
    pal.appendChild(h('div'));
    const bg: HTMLButtonElement = h('button', {
      type: 'button',
      class: 'sw',
      title: 'Ground: the canvas colour under the paint',
      'aria-label': 'Ground colour',
      onclick: () => openColorPicker(bg, 'Ground', store.p.background, (c) => store.update('palette', (p) => (p.background = c))),
    });
    this.bgSwatch = bg;
    pal.appendChild(h('div', null, this.bgSwatch, h('div', { class: 'cap' }, 'Ground')));
    this.paletteList = h('div', { class: 'palette-list' });
    this.renderPaletteList();
    wrap.append(head, pal, this.paletteList);
    return wrap;
  }

  private savePalette(): void {
    const mine = readMine();
    const name = `Mine ${String(mine.length + 1).padStart(2, '0')}`;
    mine.push({ name, colors: store.p.palette.slice(), bg: store.p.background });
    localStorage.setItem(MY_PALETTES, JSON.stringify(mine));
    this.renderPaletteList();
    toast(`Saved “${name}”. It’s in the list below the colours.`);
  }

  private renderPaletteList(): void {
    const mine = readMine();
    const item = (pp: SavedPalette, removable: number | null) => {
      const b = h(
        'button',
        {
          type: 'button',
          class: 'pal-chip',
          title: removable === null ? pp.name : `${pp.name} — right-click to delete`,
          'aria-label': `${pp.name} palette`,
          onclick: () =>
            store.update('palette', (p) => {
              p.palette = pp.colors.slice();
              p.background = pp.bg;
            }),
        },
        h('span', { style: `background:${pp.bg}` }),
        pp.colors.map((c) => h('span', { style: `background:${c}` })),
      );
      if (removable !== null) {
        b.classList.add('mine');
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const list = readMine();
          list.splice(removable, 1);
          localStorage.setItem(MY_PALETTES, JSON.stringify(list));
          this.renderPaletteList();
        });
      }
      return b;
    };
    this.paletteList.replaceChildren(
      ...PALETTES.map((pp) => item(pp, null)),
      ...mine.map((pp, i) => item(pp, i)),
    );
  }

  setArtworkAvailable(v: boolean): void {
    this.artBtn.style.display = v ? '' : 'none';
  }

  sync(): void {
    const p = store.p;
    const onNames = new Map<string, string[]>();
    for (const e of EFFECTS) {
      const st = p.fx[e.id];
      const refs = this.cards.get(e.id)!;
      refs.check?.set(st.on);
      refs.card.classList.toggle('off', !st.on && !e.alwaysOn);
      if (st.on && !e.alwaysOn) onNames.set(e.group, [...(onNames.get(e.group) ?? []), e.label]);
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
    for (const g of GROUPS) {
      const names = onNames.get(g.id) ?? [];
      let summary = names.length ? names.join(' · ') : 'All off';
      if (g.id === 'time') summary = `Hold ${(p.fx.time.p.hold as number).toFixed(1)} s · Fade ${(p.fx.time.p.fade as number).toFixed(1)} s`;
      if (g.id === 'colour') summary = String(p.fx.colour.p.mode) === 'direct' ? 'Direct' : String(p.fx.colour.p.mode) === 'gradient' ? 'Gradient map' : 'Spectral';
      const off = !!p.groupsOff[g.id];
      if (off) summary = g.id === 'time' ? 'Off · paint stays' : g.id === 'colour' ? 'Off · raw palette' : 'Off';
      const sec = this.sections.get(g.id)!;
      sec.setSummary(summary);
      sec.setSwitch(!off);
      this.navButtons.get(g.id)?.classList.toggle('off', off);
    }
    for (let i = 0; i < 5; i++) this.swatches[i].style.background = p.palette[i];
    this.bgSwatch.style.background = p.background;
    // Colour summary shows the palette itself.
    const colSec = this.sections.get('colour')!;
    colSec.el.style.setProperty('--sw', `linear-gradient(90deg, ${p.palette.join(',')})`);
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
