import type { AudioEngine, TrackInfo } from '../audio/engine';
import * as scApi from '../sources/soundcloud-api';
import * as soundcloud from '../sources/soundcloud';
import { store } from '../state/store';
import { fmtTime, h, icon, toast } from './dom';
import { Section } from './section';

export interface SourceActions {
  loadFile(file: File): void;
  loadDemo(): void;
  /** Full mode: decode a track through the SoundCloud API. */
  pickSoundCloud(t: scApi.ScTrack): void;
  /** A pasted link: full mode when connected, otherwise the embedded player. */
  loadSoundCloudLink(link: string): void;
  startLive(kind: 'mic' | 'tab'): void;
  stopLive(): void;
  listenHere(): void;
}

type Tab = 'file' | 'soundcloud' | 'live';

const ORIGIN_LABEL: Record<string, string> = {
  demo: 'Demo',
  file: 'Local file',
  soundcloud: 'SoundCloud',
  mic: 'Microphone',
  tab: 'Shared audio',
};

export class SourcePanel {
  readonly el: HTMLElement;
  readonly embedHost: HTMLElement;
  readonly section: Section;
  private art: HTMLElement;
  private titleEl: HTMLElement;
  private artistEl: HTMLElement;
  private metaEl: HTMLElement;
  private progress: HTMLElement;
  private bar: HTMLElement;
  private progressLabel: HTMLElement;
  private tabs: Record<Tab, HTMLButtonElement> = {} as Record<Tab, HTMLButtonElement>;
  private bodies: Record<Tab, HTMLElement> = {} as Record<Tab, HTMLElement>;
  private embedWrap: HTMLElement;
  private listenBtn: HTMLButtonElement;
  private listenNote: HTMLElement;
  private liveStatus: HTMLElement;
  private stopBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;
  private renderSc: () => void = () => {};

  constructor(
    private engine: AudioEngine,
    private act: SourceActions,
  ) {
    this.art = h('div', { class: 'art' });
    this.titleEl = h('div', { class: 't-title' }, '—');
    this.artistEl = h('div', { class: 't-artist' }, '');
    this.metaEl = h('div', { class: 't-meta' }, '');
    this.bar = h('i');
    this.progressLabel = h('span', { class: 'progress-label' }, '');
    this.progress = h('div', { class: 'progress-wrap', style: 'display:none' }, h('div', { class: 'progress' }, this.bar), this.progressLabel);
    this.fileInput = h('input', {
      type: 'file',
      accept: 'audio/*,.mp3,.wav,.aif,.aiff,.flac,.ogg,.m4a,.aac,.opus,.webm',
      style: 'display:none',
      onchange: () => {
        const f = this.fileInput.files?.[0];
        if (f) act.loadFile(f);
        this.fileInput.value = '';
      },
    }) as HTMLInputElement;

    this.embedHost = h('div', { class: 'embed' });
    this.listenBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => act.listenHere() }, icon('screen'), 'Listen to this tab') as HTMLButtonElement;
    this.listenNote = h('div', { class: 'note' });
    this.embedWrap = h('div', { class: 'stack', style: 'display:none;margin-top:12px' }, this.embedHost, this.listenBtn, this.listenNote);

    this.liveStatus = h('div', { class: 'note' }, 'Not listening.');
    this.stopBtn = h('button', { type: 'button', class: 'btn', style: 'display:none', onclick: () => act.stopLive() }, icon('stop'), 'Stop listening') as HTMLButtonElement;

    const tabBar = h('div', { class: 'tabs', role: 'tablist' });
    const labels: [Tab, string][] = [
      ['file', 'File'],
      ['soundcloud', 'SoundCloud'],
      ['live', 'Live input'],
    ];
    for (const [id, label] of labels) {
      const b = h('button', { type: 'button', role: 'tab', onclick: () => this.showTab(id) }, label) as HTMLButtonElement;
      this.tabs[id] = b;
      tabBar.appendChild(b);
    }
    this.bodies.file = this.fileTab();
    this.bodies.soundcloud = this.soundcloudTab();
    this.bodies.live = this.liveTab();

    this.section = new Section('source', '01', 'Source', 'What you are listening to');
    this.section.body.append(
      h('div', { class: 'track' }, this.art, h('div', { style: 'min-width:0' }, this.titleEl, this.artistEl, this.metaEl)),
      this.progress,
      tabBar,
      ...Object.values(this.bodies),
      this.embedWrap,
      this.fileInput,
    );
    this.el = this.section.el;
    this.showTab('file');
    engine.on('track', () => this.syncTrack());
    engine.on('analysis', () => this.syncTrack());
    engine.on('state', () => this.syncLive());
    engine.on('progress', (v) => this.setProgress(v as number, 'Analysing'));
    store.on((t) => {
      if (t === 'palette' || t === 'all') this.syncArt();
    });
  }

  showTab(id: Tab): void {
    for (const k of Object.keys(this.tabs) as Tab[]) {
      this.tabs[k].classList.toggle('on', k === id);
      this.tabs[k].setAttribute('aria-selected', String(k === id));
      this.bodies[k].style.display = k === id ? '' : 'none';
    }
  }

  browse(): void {
    this.fileInput.click();
  }

  private fileTab(): HTMLElement {
    const dz = h(
      'div',
      { class: 'dropzone', role: 'button', tabindex: '0', onclick: () => this.browse(), onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && this.browse() },
      h('b', null, 'Drop an audio file'),
      'MP3, WAV, AIFF, FLAC, OGG, M4A — or click to browse',
    );
    return h(
      'div',
      { class: 'stack' },
      dz,
      h('div', { class: 'hstack' }, h('button', { type: 'button', class: 'btn small', onclick: () => this.act.loadDemo() }, 'Load demo track'), h('span', { class: 'note' }, 'Files stay on your computer.')),
    );
  }

  private soundcloudTab(): HTMLElement {
    const results = h('div', { class: 'results' });
    const q = h('input', { class: 'textin', type: 'search', placeholder: 'Search SoundCloud', 'aria-label': 'Search SoundCloud' }) as HTMLInputElement;
    const link = h('input', { class: 'textin', type: 'text', placeholder: 'Paste a soundcloud.com track link', 'aria-label': 'SoundCloud track link' }) as HTMLInputElement;
    const cid = h('input', { class: 'textin', type: 'text', placeholder: 'Client ID', autocomplete: 'off', 'aria-label': 'SoundCloud Client ID' }) as HTMLInputElement;
    const secret = h('input', { class: 'textin', type: 'password', placeholder: 'Client secret', autocomplete: 'off', 'aria-label': 'SoundCloud Client secret' }) as HTMLInputElement;
    const searchBox = h('div', { class: 'stack' });
    const connectBox = h('div', { class: 'stack' });
    for (const i of [q, link, cid, secret]) i.addEventListener('keydown', (e) => e.stopPropagation());

    const runSearch = async () => {
      const term = q.value.trim();
      if (!term) return;
      if (!scApi.isConnected()) {
        window.open(`https://soundcloud.com/search/sounds?q=${encodeURIComponent(term)}`, '_blank', 'noopener');
        return;
      }
      results.replaceChildren(h('div', { class: 'note', style: 'padding:8px 0' }, 'Searching…'));
      try {
        const items = await scApi.search(term);
        results.replaceChildren(
          ...(items.length
            ? items.map((t) =>
                h(
                  'button',
                  { type: 'button', class: `result ${t.access === 'blocked' ? 'blocked' : ''}`, title: t.access === 'blocked' ? 'Not streamable outside SoundCloud' : `Load “${t.title}”`, onclick: () => this.act.pickSoundCloud(t) },
                  h('img', { src: t.art ?? '', alt: '', loading: 'lazy' }),
                  h('div', { style: 'min-width:0' }, h('div', { class: 'r-title' }, t.title), h('div', { class: 'r-sub' }, t.artist)),
                  h('span', { class: 'r-meta' }, t.access === 'preview' ? h('em', null, 'Preview') : null, fmtTime(t.duration, 0)),
                ),
              )
            : [h('div', { class: 'note', style: 'padding:8px 0' }, 'No results.')]),
        );
      } catch (err) {
        results.replaceChildren();
        toast(String((err as Error).message ?? err), 'error', 7000);
        this.renderSc();
      }
    };
    q.addEventListener('keydown', (e) => e.key === 'Enter' && runSearch());
    const loadLink = () => {
      if (!soundcloud.isLink(link.value)) return toast('Paste a soundcloud.com track link.', 'error');
      this.act.loadSoundCloudLink(link.value);
    };
    link.addEventListener('keydown', (e) => e.key === 'Enter' && loadLink());

    const render = () => {
      const connected = scApi.isConnected();
      q.placeholder = connected ? 'Search SoundCloud' : 'Find on SoundCloud (opens a new tab)';
      connectBox.replaceChildren(
        ...(connected
          ? [
              h(
                'div',
                { class: 'hstack' },
                h('span', { class: 'note grow' }, h('b', null, 'Full mode. '), 'Tracks load in full: waveform, beats, drop finder and frame-accurate export.'),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn small ghost',
                    onclick: () => {
                      scApi.disconnect();
                      render();
                    },
                  },
                  'Disconnect',
                ),
              ),
            ]
          : [
              h('div', { class: 'sub-head', style: 'margin-top:8px' }, h('span', null, 'Full mode (recommended)')),
              h(
                'div',
                { class: 'note' },
                'Register a free app at ',
                h('a', { href: 'https://soundcloud.com/you/apps', target: '_blank', rel: 'noopener' }, 'soundcloud.com/you/apps'),
                ' and paste its Client ID and secret. Klangbild then loads the real audio, so tracks get the full waveform, beat detection and export. The keys stay in this browser only.',
              ),
              cid,
              h(
                'div',
                { class: 'hstack' },
                h('div', { class: 'grow' }, secret),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn',
                    onclick: async () => {
                      if (!cid.value.trim() || !secret.value.trim()) return toast('Paste both the Client ID and the secret.', 'error');
                      scApi.saveCredentials(cid.value, secret.value);
                      try {
                        await scApi.search('test');
                        toast('Connected to SoundCloud.');
                      } catch (err) {
                        scApi.disconnect();
                        toast(String((err as Error).message), 'error', 7000);
                      }
                      render();
                    },
                  },
                  'Connect',
                ),
              ),
              h('div', { class: 'note' }, 'Without connecting, a pasted link plays in SoundCloud’s own player and Klangbild listens to this browser tab.'),
            ]),
      );
    };
    this.renderSc = render;
    searchBox.append(h('div', { class: 'hstack' }, h('div', { class: 'grow' }, q), h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Search', onclick: runSearch }, icon('search'))), results);
    render();
    return h(
      'div',
      { class: 'stack' },
      searchBox,
      h('div', { class: 'hstack' }, h('div', { class: 'grow' }, link), h('button', { type: 'button', class: 'btn', onclick: loadLink }, 'Load')),
      connectBox,
    );
  }

  private liveTab(): HTMLElement {
    return h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'hstack' },
        h('button', { type: 'button', class: 'btn', onclick: () => this.act.startLive('tab') }, icon('screen'), 'Tab or system audio'),
        h('button', { type: 'button', class: 'btn', onclick: () => this.act.startLive('mic') }, icon('mic'), 'Microphone'),
      ),
      this.liveStatus,
      this.stopBtn,
      h(
        'div',
        { class: 'note' },
        'Play music anywhere — a music app, a YouTube tab — then share it here. In Chrome or Edge on Windows choose “Entire screen” and tick “Share system audio”; for one tab, tick “Share tab audio”.',
      ),
    );
  }

  showEmbed(on: boolean): void {
    this.embedWrap.style.display = on ? '' : 'none';
    this.syncLive();
  }

  private syncLive(): void {
    const listening = this.engine.listening;
    this.stopBtn.style.display = listening ? '' : 'none';
    this.liveStatus.textContent = listening ? `Listening to ${ORIGIN_LABEL[this.engine.info?.origin ?? 'tab']?.toLowerCase() ?? 'input'}.` : 'Not listening.';
    this.listenBtn.style.display = this.engine.external && !listening ? '' : 'none';
    this.listenNote.replaceChildren(
      ...(listening
        ? ['Listening to this tab. Use the transport below — the player follows the clip.']
        : [
            h('b', null, 'To drive the visuals: '),
            'press play (or Listen), choose ',
            h('b', null, 'This tab'),
            ' in the browser dialog and keep ',
            h('b', null, 'Share tab audio'),
            ' on. Connect a SoundCloud app above to skip this step.',
          ]),
    );
  }

  setProgress(v: number, label = 'Loading'): void {
    const on = v > 0 && v < 1;
    this.progress.style.display = on ? '' : 'none';
    this.bar.style.width = `${Math.round(v * 100)}%`;
    this.progressLabel.textContent = on ? `${label} ${Math.round(v * 100)}%` : '';
  }

  private syncArt(): void {
    const info = this.engine.info;
    if (info?.artwork) {
      this.art.style.backgroundImage = `url("${info.artwork}")`;
      this.art.style.backgroundColor = '';
    } else {
      const p = store.p.palette;
      this.art.style.backgroundImage = `radial-gradient(circle at 35% 35%, ${p[0]}, transparent 60%), radial-gradient(circle at 70% 70%, ${p[2]}, transparent 55%), linear-gradient(${p[1]}, ${p[3]})`;
      this.art.style.backgroundColor = store.p.background;
    }
  }

  syncTrack(): void {
    const info: TrackInfo | null = this.engine.info;
    this.titleEl.textContent = info?.title ?? 'No track';
    this.artistEl.textContent = info?.artist ?? 'Load a file or pick a song';
    const an = this.engine.analysis;
    const parts: string[] = [];
    if (info) parts.push(ORIGIN_LABEL[info.origin] ?? info.origin);
    const dur = this.engine.duration;
    if (dur) parts.push(fmtTime(dur, 0));
    if (an) parts.push(`${an.bpm.toFixed(0)} BPM`);
    else if (this.engine.analysing) parts.push('Analysing…');
    this.metaEl.textContent = parts.join(' · ');
    this.section.setSummary(info?.title ?? '');
    this.syncArt();
    this.syncLive();
  }
}
