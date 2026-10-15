import type { AudioEngine, TrackInfo } from '../audio/engine';
import * as spotify from '../sources/spotify';
import * as soundcloud from '../sources/soundcloud';
import { store } from '../state/store';
import { fmtTime, h, icon, toast } from './dom';

export interface SourceActions {
  loadFile(file: File): void;
  loadDemo(): void;
  pickSpotify(t: spotify.SpotifyTrack): void;
  loadSoundCloud(link: string): void;
  startLive(kind: 'mic' | 'tab'): void;
  stopLive(): void;
  listenHere(): void;
}

type Tab = 'file' | 'spotify' | 'soundcloud' | 'live';

const ORIGIN_LABEL: Record<string, string> = {
  demo: 'Demo',
  file: 'Local file',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  mic: 'Microphone',
  tab: 'Shared audio',
};

export class SourcePanel {
  readonly el: HTMLElement;
  readonly embedHost: HTMLElement;
  private art: HTMLElement;
  private titleEl: HTMLElement;
  private artistEl: HTMLElement;
  private metaEl: HTMLElement;
  private progress: HTMLElement;
  private bar: HTMLElement;
  private tabs: Record<Tab, HTMLButtonElement> = {} as Record<Tab, HTMLButtonElement>;
  private bodies: Record<Tab, HTMLElement> = {} as Record<Tab, HTMLElement>;
  private embedWrap: HTMLElement;
  private listenBtn: HTMLButtonElement;
  private listenNote: HTMLElement;
  private liveStatus: HTMLElement;
  private stopBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;

  constructor(
    private engine: AudioEngine,
    private act: SourceActions,
  ) {
    this.art = h('div', { class: 'art' });
    this.titleEl = h('div', { class: 't-title' }, '—');
    this.artistEl = h('div', { class: 't-artist' }, '');
    this.metaEl = h('div', { class: 't-meta' }, '');
    this.bar = h('i');
    this.progress = h('div', { class: 'progress', style: 'display:none' }, this.bar);
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
    this.listenNote = h(
      'div',
      { class: 'note' },
      'The player’s audio can’t be read directly, so Klangbild listens to this browser tab. Press play (or Listen), then choose “This tab” and keep “Share tab audio” ticked.',
    );
    this.embedWrap = h('div', { class: 'stack', style: 'display:none;margin-top:12px' }, this.embedHost, this.listenBtn, this.listenNote);

    this.liveStatus = h('div', { class: 'note' }, 'Not listening.');
    this.stopBtn = h('button', { type: 'button', class: 'btn', style: 'display:none', onclick: () => act.stopLive() }, icon('stop'), 'Stop listening') as HTMLButtonElement;

    const tabBar = h('div', { class: 'tabs', role: 'tablist' });
    const labels: [Tab, string][] = [
      ['file', 'File'],
      ['spotify', 'Spotify'],
      ['soundcloud', 'SoundCloud'],
      ['live', 'Live'],
    ];
    for (const [id, label] of labels) {
      const b = h('button', { type: 'button', role: 'tab', onclick: () => this.showTab(id) }, label) as HTMLButtonElement;
      this.tabs[id] = b;
      tabBar.appendChild(b);
    }
    this.bodies.file = this.fileTab();
    this.bodies.spotify = this.spotifyTab();
    this.bodies.soundcloud = this.soundcloudTab();
    this.bodies.live = this.liveTab();

    this.el = h(
      'section',
      { class: 'sec', id: 'sec-source' },
      h('div', { class: 'sec-head' }, h('span', { class: 'num' }, '01'), h('span', { class: 'title' }, 'Source'), h('span', { class: 'hint' }, 'What you are listening to')),
      h('div', { class: 'track' }, this.art, h('div', { style: 'min-width:0' }, this.titleEl, this.artistEl, this.metaEl)),
      this.progress,
      tabBar,
      Object.values(this.bodies),
      this.embedWrap,
      this.fileInput,
    );
    this.showTab('file');
    engine.on('track', () => this.syncTrack());
    engine.on('analysis', () => this.syncTrack());
    engine.on('state', () => this.syncLive());
    engine.on('progress', (v) => this.setProgress(v as number));
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

  private spotifyTab(): HTMLElement {
    const results = h('div', { class: 'results' });
    const q = h('input', { class: 'textin', type: 'search', placeholder: 'Search tracks or artists', 'aria-label': 'Search Spotify' }) as HTMLInputElement;
    const link = h('input', { class: 'textin', type: 'text', placeholder: 'open.spotify.com/track/…', 'aria-label': 'Spotify track link' }) as HTMLInputElement;
    const cid = h('input', { class: 'textin', type: 'text', placeholder: 'Client ID', value: spotify.clientId(), 'aria-label': 'Spotify Client ID' }) as HTMLInputElement;
    const searchBox = h('div', { class: 'stack' });
    const connectBox = h('div', { class: 'stack' });

    const runSearch = async () => {
      const term = q.value.trim();
      if (!term) return;
      results.replaceChildren(h('div', { class: 'note', style: 'padding:8px 0' }, 'Searching…'));
      try {
        const items = await spotify.search(term);
        results.replaceChildren(
          ...(items.length
            ? items.map((t) =>
                h(
                  'button',
                  { type: 'button', class: 'result', onclick: () => this.act.pickSpotify(t) },
                  h('img', { src: t.artSmall ?? '', alt: '', loading: 'lazy' }),
                  h('div', { style: 'min-width:0' }, h('div', { class: 'r-title' }, t.title), h('div', { class: 'r-sub' }, `${t.artist} — ${t.album}`)),
                  h('span', { class: 'muted' }, fmtTime(t.duration, 0)),
                ),
              )
            : [h('div', { class: 'note', style: 'padding:8px 0' }, 'No results.')]),
        );
      } catch (err) {
        results.replaceChildren();
        toast(String((err as Error).message ?? err), 'error');
        render();
      }
    };
    q.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') runSearch();
    });
    const loadLink = async () => {
      const id = spotify.parseLink(link.value);
      if (!id) return toast('That doesn’t look like a Spotify track link.', 'error');
      const meta = await spotify.oembed(id);
      this.act.pickSpotify({ id, uri: `spotify:track:${id}`, title: meta.title, artist: 'Spotify', album: '', duration: 0, art: meta.art, link: `https://open.spotify.com/track/${id}` });
    };
    link.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') loadLink();
    });
    cid.addEventListener('keydown', (e) => e.stopPropagation());

    const render = () => {
      const connected = spotify.isConnected();
      searchBox.style.display = connected ? '' : 'none';
      connectBox.replaceChildren(
        ...(connected
          ? [
              h(
                'div',
                { class: 'hstack' },
                h('span', { class: 'note grow' }, 'Connected to Spotify.'),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn small ghost',
                    onclick: () => {
                      spotify.disconnect();
                      render();
                    },
                  },
                  'Disconnect',
                ),
              ),
            ]
          : [
              h('div', { class: 'sub-head', style: 'margin-top:6px' }, h('span', null, 'Connect for search')),
              h(
                'div',
                { class: 'note' },
                'Search uses your own free Spotify developer app. Create one at ',
                h('a', { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' }, 'developer.spotify.com'),
                ', tick “Web API”, add this Redirect URI, then paste the Client ID:',
              ),
              h('div', { class: 'note' }, h('code', null, spotify.redirectUri())),
              h(
                'div',
                { class: 'hstack' },
                h('div', { class: 'grow' }, cid),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn',
                    onclick: async () => {
                      if (!cid.value.trim()) return toast('Paste your Client ID first.', 'error');
                      spotify.setClientId(cid.value);
                      try {
                        await spotify.login();
                      } catch (err) {
                        toast(String((err as Error).message), 'error');
                      }
                    },
                  },
                  'Connect',
                ),
              ),
            ]),
      );
    };
    searchBox.append(h('div', { class: 'hstack' }, h('div', { class: 'grow' }, q), h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Search', onclick: runSearch }, icon('search'))), results);
    render();
    return h(
      'div',
      { class: 'stack' },
      searchBox,
      h('div', { class: 'hstack' }, h('div', { class: 'grow' }, link), h('button', { type: 'button', class: 'btn', onclick: loadLink }, 'Load')),
      connectBox,
      h('div', { class: 'note' }, 'Logged out of Spotify in this browser, the player gives 30-second previews.'),
    );
  }

  private soundcloudTab(): HTMLElement {
    const link = h('input', { class: 'textin', type: 'text', placeholder: 'soundcloud.com/artist/track', 'aria-label': 'SoundCloud track link' }) as HTMLInputElement;
    const q = h('input', { class: 'textin', type: 'search', placeholder: 'Find on SoundCloud', 'aria-label': 'Search SoundCloud' }) as HTMLInputElement;
    const load = () => {
      if (!soundcloud.isLink(link.value)) return toast('Paste a soundcloud.com track link.', 'error');
      this.act.loadSoundCloud(link.value);
    };
    const find = () => {
      if (!q.value.trim()) return;
      window.open(`https://soundcloud.com/search/sounds?q=${encodeURIComponent(q.value.trim())}`, '_blank', 'noopener');
    };
    link.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') load();
    });
    q.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') find();
    });
    return h(
      'div',
      { class: 'stack' },
      h('div', { class: 'hstack' }, h('div', { class: 'grow' }, link), h('button', { type: 'button', class: 'btn', onclick: load }, 'Load')),
      h('div', { class: 'hstack' }, h('div', { class: 'grow' }, q), h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Open SoundCloud search', title: 'Opens SoundCloud search in a new tab', onclick: find }, icon('search'))),
      h('div', { class: 'note' }, 'Search opens SoundCloud in a new tab — copy the track link from there and paste it above.'),
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
        'Play music anywhere — the Spotify desktop app, a YouTube tab — then share it here. In Chrome or Edge on Windows, choose “Entire screen” and tick “Share system audio”; for a single tab, tick “Share tab audio”.',
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
    this.listenNote.textContent = listening
      ? 'Listening to this tab. Use the transport below — the player follows the clip.'
      : 'The player’s audio can’t be read directly, so Klangbild listens to this browser tab. Press play (or Listen), then choose “This tab” and keep “Share tab audio” ticked.';
  }

  setProgress(v: number): void {
    const on = v > 0 && v < 1;
    this.progress.style.display = on ? '' : 'none';
    this.bar.style.width = `${Math.round(v * 100)}%`;
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
    this.syncArt();
    this.syncLive();
  }
}
