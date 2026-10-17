import './styles.css';
import { findHighlights } from './audio/analysis';
import { AudioEngine } from './audio/engine';
import { DEMO_ARTIST, DEMO_TITLE, renderDemo } from './audio/demo';
import { METRONOME_TITLE, clampBpm, renderMetronome, type MetronomeSettings } from './audio/metronome';
import { Recorder } from './export/exporter';
import { Renderer } from './render/renderer';
import { SimDriver } from './render/sim';
import { MediaManager } from './media/media';
import * as scApi from './sources/soundcloud-api';
import * as soundcloud from './sources/soundcloud';
import { ASPECTS, aspectRatio, defaultProject } from './state/project';
import { PRESETS, applyPreset } from './state/presets';
import { store } from './state/store';
import { segmented } from './ui/controls';
import { download, fmtTime, h, icon, toast } from './ui/dom';
import { EffectsPanel } from './ui/effects-panel';
import { ExportDialog } from './ui/export-dialog';
import { UI_SCALES, installLayout } from './ui/layout';
import { showRecordDialog } from './ui/record-dialog';
import { CommandPalette, type Command } from './ui/command';
import { installTooltips } from './ui/tooltip';
import { Section } from './ui/section';
import { surprise } from './state/surprise';
import { EFFECTS, GROUPS } from './state/defs';
import { mediaPanel } from './ui/media-panel';
import { paletteFromImage } from './ui/palette';
import { PresetsMenu } from './ui/presets-menu';
import { ResponsePanel } from './ui/response-panel';
import { SourcePanel } from './ui/source-panel';
import { Timeline } from './ui/timeline';

const PREVIEW_PREROLL = 1;
let needsRender = true;
const QUALITIES = [
  { id: 0.5, label: 'Draft' },
  { id: 0.75, label: 'Good' },
  { id: 1, label: 'Full' },
];

// First run: start from a reference look.
try {
  if (!localStorage.getItem('klangbild.project.v1')) store.update('all', (p) => applyPreset(p, PRESETS[0]), { history: false });
} catch {
  /* storage blocked */
}

const engine = new AudioEngine();
const app = document.getElementById('app')!;
installTooltips();
app.className = 'app';

// ── Stage ──────────────────────────────────────────────────────────────────

const canvas = h('canvas', { 'aria-label': 'Visual output' }) as HTMLCanvasElement;
const cornerTL = h('div', { class: 'corner tl' });
const cornerTR = h('div', { class: 'corner tr' });
const splash = h(
  'div',
  { class: 'splash show' },
  h('div', { class: 'big' }, 'Press Space'),
  h('div', { class: 'small' }, 'Plays the demo track. Drop your own audio file anywhere, or pick a song on the left.'),
);
const frame = h('div', { class: 'canvas-frame' }, canvas, h('div', { class: 'crop' }), cornerTL, cornerTR, splash);
const wrap = h('div', { class: 'canvas-wrap' }, frame, h('div', { class: 'drop-veil' }, 'Drop audio to play it, or an image or video to paint with it'));

let quality = Number(localStorage.getItem('klangbild.quality') ?? 0.75) || 0.75;
const aspectSeg = segmented<string>({
  options: ASPECTS.map((a) => ({ value: a.id, label: a.id })),
  value: store.p.aspect,
  onChange: (v) => store.update('canvas', (p) => (p.aspect = v)),
});
const qualitySeg = segmented<number>({
  options: QUALITIES.map((q) => ({ value: q.id, label: q.label, title: `Preview at ${q.id * 100}% resolution` })),
  value: quality,
  onChange: (v) => {
    quality = v;
    localStorage.setItem('klangbild.quality', String(v));
    sizeStage();
  },
});
const STAGES = [
  { id: 'auto', label: 'Auto', title: 'Follows the light / dark theme' },
  { id: 'white', label: 'White' },
  { id: 'grey', label: 'Grey' },
  { id: 'black', label: 'Black' },
];
let stageColour = localStorage.getItem('klangbild.stage') ?? 'auto';
const stageSeg = segmented<string>({
  options: STAGES.map((s) => ({ value: s.id, label: s.label, title: s.title ?? `${s.label} around the canvas` })),
  value: stageColour,
  onChange: (v) => {
    stageColour = v;
    localStorage.setItem('klangbild.stage', v);
    applyStage();
  },
});
const fpsEl = h('span', null, '');
const resEl = h('span', null, '');
let snapRequested = false;
const stageBar = h(
  'div',
  { class: 'stage-bar' },
  h('span', { class: 'label' }, 'Frame'),
  aspectSeg.el,
  h('span', { class: 'label', style: 'margin-left:8px' }, 'Preview'),
  qualitySeg.el,
  h('span', { class: 'label', style: 'margin-left:8px' }, 'Stage'),
  stageSeg.el,
  h('div', { class: 'spacer' }),
  h('div', { class: 'meta' }, resEl, fpsEl),
  h('button', { type: 'button', class: 'btn icon ghost', title: 'Clear the canvas (C)', 'aria-label': 'Clear canvas', onclick: () => resetSim(engine.time, 0) }, icon('clear')),
  h('button', { type: 'button', class: 'btn icon ghost', title: 'Save this frame as PNG (S)', 'aria-label': 'Snapshot', onclick: () => (snapRequested = true) }, icon('camera')),
  h('button', { type: 'button', class: 'btn icon ghost', title: 'Fullscreen (F)', 'aria-label': 'Fullscreen', onclick: () => toggleFullscreen() }, icon('expand')),
);
const stage = h('main', { class: 'stage' }, stageBar, wrap);
function applyStage(): void {
  if (stageColour === 'auto') delete stage.dataset.stage;
  else stage.dataset.stage = stageColour;
}
applyStage();

let renderer: Renderer;
try {
  renderer = new Renderer(canvas);
} catch (err) {
  app.replaceChildren(h('div', { style: 'padding:40px;font-size:14px' }, String((err as Error).message), h('p', null, 'Klangbild needs WebGL2 — please use a current Chrome, Edge, Firefox or Safari.')));
  throw err;
}
const sim = new SimDriver(renderer);

// ── Panels ─────────────────────────────────────────────────────────────────

const media = new MediaManager();
media.on('change', () => (needsRender = true));
const effects = new EffectsPanel({ media: mediaPanel(media) });
try {
  engine.syncMs = Number(localStorage.getItem('klangbild.syncMs') ?? 0) || 0;
} catch {
  /* ignore */
}
const response = new ResponsePanel(
  () => engine.syncMs,
  (ms) => {
    engine.syncMs = ms;
    localStorage.setItem('klangbild.syncMs', String(ms));
  },
  () => engine.latencyMs,
);
const exportDialog = new ExportDialog(engine, media, () => clipTime(), (ctx, w, hh) => {
  // The preview canvas doesn't keep its buffer, so render and copy in one task.
  sim.render(store.p);
  ctx.drawImage(canvas, 0, 0, w, hh);
});
let exporting = false;
exportDialog.onBusy = (b) => (exporting = b);
let recorder: Recorder | null = null;

const timeline = new Timeline(engine, {
  togglePlay: () => togglePlay(),
  restart: () => restart(),
  seekClip: (t) => seekClip(t),
  regionChanged: () => regionChanged(),
  toggleRecord: () => toggleRecord(),
});

const source = new SourcePanel(engine, {
  loadFile: (f) => loadFile(f),
  loadDemo: () => loadDemo(true),
  pickSoundCloud: (t) => pickSoundCloud(t),
  loadSoundCloudLink: (l) => loadSoundCloudLink(l),
  startLive: (k) => startLive(k),
  stopLive: () => engine.stopLive(),
  listenHere: () => listenHere(),
  metronome: (m) => void useMetronome(m),
  tap: () => tapTempo(),
});
const left = h('aside', { class: 'panel left', 'aria-label': 'Source and response' }, source.el, response.el);

// ── Top bar ────────────────────────────────────────────────────────────────

const nameInput = h('input', { class: 'project-name', value: store.p.name, 'aria-label': 'Project name', spellcheck: false }) as HTMLInputElement;
nameInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') nameInput.blur();
});
nameInput.addEventListener('change', () => store.update('canvas', (p) => (p.name = nameInput.value.trim() || 'Untitled')));
const presetsBtn = h('button', { type: 'button', class: 'btn', 'aria-haspopup': 'dialog' }, 'Presets') as HTMLButtonElement;
const presets = new PresetsMenu(
  presetsBtn,
  () => {
    resetSim(engine.time);
    toast(`${store.p.name}`, 'info', 3200, { label: 'Undo', run: () => undoLook() });
  },
  () => surpriseMe(),
);
presetsBtn.onclick = () => presets.toggle();
const themeBtn = h('button', { type: 'button', class: 'btn icon ghost', title: 'Light / dark', 'aria-label': 'Toggle theme', onclick: () => toggleTheme() }, icon('moon'));
const fileInput = h('input', {
  type: 'file',
  accept: '.json,application/json',
  style: 'display:none',
  onchange: async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    try {
      store.replace(JSON.parse(await f.text()));
      toast(`Opened ${f.name}`);
      resetSim(engine.time);
    } catch {
      toast('That file is not a Klangbild project.', 'error');
    }
  },
}) as HTMLInputElement;
const top = h(
  'header',
  { class: 'top' },
  h('div', { class: 'brand' }, h('span', { class: 'mark' }, 'Klangbild', h('i', null, '.')), h('span', { class: 'sub' }, 'Audio-visual instrument')),
  nameInput,
  h('div', { class: 'spacer' }),
  h(
    'div',
    { class: 'top-actions' },
    h('button', { type: 'button', class: 'btn icon ghost', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: () => store.undo() }, icon('undo')),
    h('button', { type: 'button', class: 'btn icon ghost', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo', onclick: () => store.redo() }, icon('redo')),
    h('button', { type: 'button', class: 'btn ghost reset-btn', title: 'Reset settings to the preset or the defaults', onclick: (e: Event) => openResetPop(e.currentTarget as HTMLElement) }, 'Reset'),
    h('button', { type: 'button', class: 'btn icon ghost', title: 'Open project (.json)', 'aria-label': 'Open project', onclick: () => fileInput.click() }, icon('open')),
    h('button', { type: 'button', class: 'btn icon ghost', title: 'Save project (.json)', 'aria-label': 'Save project', onclick: () => saveProject() }, icon('save')),
    h('button', { type: 'button', class: 'btn icon ghost', title: 'Keyboard shortcuts (?)', 'aria-label': 'Help', onclick: () => toggleHelp() }, icon('help')),
    h('button', { type: 'button', class: 'btn icon ghost size-btn', title: 'Interface size', 'aria-label': 'Interface size', onclick: (e: Event) => openSizePop(e.currentTarget as HTMLElement) }, 'Aa'),
    themeBtn,
    presetsBtn,
    h('button', { type: 'button', class: 'btn primary', onclick: () => openExport() }, 'Export', h('span', { class: 'kbd', style: 'color:inherit;opacity:.6' }, 'E')),
  ),
  fileInput,
);

app.append(top, left, stage, effects.el, timeline.el);
const layout = installLayout(app, left, effects.el, () => timeline.refresh());

/** Undo a whole-look change (preset, reset, surprise) and redraw from it. */
function undoLook(): void {
  store.undo();
  resetSim(engine.time);
}

/** A new look from a random preset, nudged; the track, clip and frame stay. */
function surpriseMe(): void {
  let base = '';
  store.update('all', (p) => {
    const clip = { ...p.clip };
    const aspect = p.aspect;
    base = surprise(p);
    p.clip = clip;
    p.aspect = aspect;
  });
  resetSim(engine.time);
  toast(`New look, from ${base}`, 'info', 4200, { label: 'Undo', run: () => undoLook() });
}

/** Reset everything: back to the loaded preset as it shipped, or to factory defaults. Undoable. */
function openResetPop(anchor: HTMLElement): void {
  document.querySelector('.pop.reset-pop')?.remove();
  const preset = PRESETS.find((p) => p.id === store.p.preset);
  const close = () => {
    pop.remove();
    document.removeEventListener('pointerdown', outside, true);
  };
  const keepClip = (fn: (p: typeof store.p) => void) =>
    store.update('all', (p) => {
      const clip = { ...p.clip };
      const aspect = p.aspect;
      fn(p);
      p.clip = clip;
      p.aspect = aspect;
    });
  const item = (title: string, note: string, run: () => void) =>
    h('button', { type: 'button', class: 'reset-item', onclick: () => { run(); close(); resetSim(engine.time); toast(title, 'info', 4200, { label: 'Undo', run: () => undoLook() }); } }, h('b', null, title), h('span', null, note));
  const pop = h(
    'div',
    { class: 'pop reset-pop', role: 'dialog', 'aria-label': 'Reset' },
    h('div', { class: 'pop-title' }, h('span', null, 'Reset')),
    preset
      ? item(`Back to ${preset.name}`, 'Every effect, colour and response setting as the preset ships.', () => keepClip((p) => applyPreset(p, preset)))
      : null,
    item('Everything to defaults', 'All effects, palette and response settings to their factory values. Your track and clip stay.', () =>
      keepClip((p) => {
        const d = defaultProject();
        p.fx = d.fx;
        p.palette = d.palette;
        p.background = d.background;
        p.audio = d.audio;
        p.groupsOff = {};
        p.preset = undefined;
        p.name = 'Untitled';
      }),
    ),
  );
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left))}px`;
  const outside = (e: PointerEvent) => {
    if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}

function openSizePop(anchor: HTMLElement): void {
  document.querySelector('.pop.size-pop')?.remove();
  const seg = segmented<number>({
    options: UI_SCALES.map((v) => ({ value: v, label: `${Math.round(v * 100)}%` })),
    value: layout.scale(),
    onChange: (v) => layout.setScale(v),
  });
  const pop = h(
    'div',
    { class: 'pop size-pop', role: 'dialog', 'aria-label': 'Interface size' },
    h('div', { class: 'pop-title' }, h('span', null, 'Interface size')),
    seg.el,
    h('div', { class: 'note' }, 'Scales the panels, text and buttons; the canvas keeps its resolution. Drag the edge of either side panel to make it wider (double-click the edge to reset).'),
  );
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, r.right - pop.offsetWidth)}px`;
  const outside = (e: PointerEvent) => {
    if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
      pop.remove();
      document.removeEventListener('pointerdown', outside, true);
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}

// ── Sizing ─────────────────────────────────────────────────────────────────

function sizeStage(): void {
  const r = wrap.getBoundingClientRect();
  const availW = Math.max(80, r.width - 64);
  const availH = Math.max(80, r.height - 64);
  const ar = aspectRatio(store.p.aspect);
  let w = availW;
  let hh = w / ar;
  if (hh > availH) {
    hh = availH;
    w = hh * ar;
  }
  frame.style.width = `${Math.floor(w)}px`;
  frame.style.height = `${Math.floor(hh)}px`;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let pw = w * dpr * quality;
  let ph = hh * dpr * quality;
  const cap = 1920 / Math.max(pw, ph);
  if (cap < 1) {
    pw *= cap;
    ph *= cap;
  }
  renderer.resize(Math.round(pw / 2) * 2, Math.round(ph / 2) * 2, 1);
  needsRender = true;
  resEl.textContent = `Preview ${renderer.width} × ${renderer.height}`;
  cornerTL.textContent = `${store.p.aspect} — ${store.p.name}`;
}
new ResizeObserver(() => sizeStage()).observe(wrap);

// ── Theme, help, project files ─────────────────────────────────────────────

function toggleTheme(): void {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('klangbild.theme', next);
  themeBtn.replaceChildren(icon(next === 'dark' ? 'sun' : 'moon'));
  timeline.refresh();
}
if (document.documentElement.dataset.theme === 'dark') themeBtn.replaceChildren(icon('sun'));

let helpEl: HTMLElement | null = null;
function toggleHelp(): void {
  if (helpEl) {
    helpEl.remove();
    helpEl = null;
    return;
  }
  const keys: [string, string][] = [
    ['Space', 'Play / pause'],
    ['R', 'Back to clip start, fresh canvas'],
    ['C', 'Clear canvas'],
    ['T', 'Tap tempo (metronome)'],
    ['G', 'Surprise me: a new look'],
    ['Ctrl / ⌘ K', 'Command palette'],
    ['/', 'Find an effect'],
    ['← →', 'Seek 1 s (Shift: 5 s)'],
    ['E', 'Export'],
    ['S', 'Snapshot PNG'],
    ['F', 'Fullscreen'],
    ['1 – 9, 0', 'Presets'],
    ['Ctrl Z', 'Undo (Shift: redo)'],
    ['Shift-drag', 'Fine slider control'],
    ['Drag a label', 'Change the value (Shift: fine)'],
    ['Double-click', 'Reset a slider or its label to default'],
    ['Alt-drag', 'Move clip without snapping'],
  ];
  helpEl = h(
    'div',
    { class: 'pop', style: 'top:58px;right:16px;width:300px', role: 'dialog', 'aria-label': 'Keyboard shortcuts' },
    h('div', { class: 'pop-title' }, h('span', null, 'Shortcuts'), h('button', { type: 'button', 'aria-label': 'Close', onclick: () => toggleHelp() }, '×')),
    h('div', { class: 'keys' }, keys.flatMap(([k, v]) => [h('span', null, h('kbd', null, k)), h('span', null, v)])),
  );
  document.body.appendChild(helpEl);
}

function saveProject(): void {
  const blob = new Blob([JSON.stringify(store.p, null, 2)], { type: 'application/json' });
  download(blob, `${store.p.name.replace(/[^\w-]+/g, '_') || 'klangbild'}.klangbild.json`);
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen();
  else frame.requestFullscreen?.();
}

function openExport(): void {
  if (engine.playing) engine.pause();
  exportDialog.show();
}

// ── Simulation clock ───────────────────────────────────────────────────────

function clipStart(): number {
  return engine.kind === 'live' && !engine.info?.duration ? 0 : store.p.clip.start;
}

function clipTime(): number {
  return sim.songTime - sim.clipStart;
}

/** Fresh canvas at song time t, warmed up so it isn't empty. */
function resetSim(t: number, preroll = PREVIEW_PREROLL): void {
  needsRender = true;
  sim.reset(store.p, t - preroll, engine.analysis?.bpm ?? 0);
  sim.clipStart = clipStart();
  const feed = engine.feed?.kind === 'file' ? engine.feed : null;
  sim.advanceTo(t, feed, store.p);
}

async function togglePlay(): Promise<void> {
  splash.classList.remove('show');
  if (engine.kind === 'none') {
    await loadDemo(false);
    return togglePlay();
  }
  if (engine.playing) {
    engine.pause();
    return;
  }
  if (engine.external && !engine.listening) {
    try {
      await engine.startLive('tab', store.p.audio.beat, { currentTab: true });
    } catch (err) {
      reportCaptureError(err);
    }
  }
  const c = store.p.clip;
  let t = engine.time;
  if ((engine.kind as string) !== 'live' && (t < c.start - 0.01 || t >= c.start + c.duration - 0.05)) {
    t = c.start;
    resetSim(t);
  }
  await engine.play(t);
}

function restart(): void {
  const t = clipStart();
  if (engine.kind === 'live' && !engine.external) {
    resetSim(engine.time, 0);
    return;
  }
  if (engine.playing) void engine.play(t);
  else engine.seek(t);
  resetSim(t);
}

function seekClip(ct: number): void {
  if (engine.kind === 'live') return;
  const t = store.p.clip.start + ct;
  engine.seek(t);
  resetSim(t);
}

function regionChanged(): void {
  const t = store.p.clip.start;
  if (engine.kind === 'live') return;
  if (engine.playing) void engine.play(t);
  else engine.seek(t);
  resetSim(t);
  response.setInfo(engine.analysis?.bpm ?? 0, beatsInClip(), false);
}

function beatsInClip(): number {
  const c = store.p.clip;
  let n = 0;
  for (const b of engine.beats) if (b >= c.start && b < c.start + c.duration) n++;
  return n;
}

// ── Sources ────────────────────────────────────────────────────────────────

let demoBuffer: Promise<AudioBuffer> | null = null;
async function loadDemo(autoplay: boolean): Promise<void> {
  try {
    if (!demoBuffer) demoBuffer = renderDemo(engine.ctx.sampleRate);
    const buf = await demoBuffer;
    if (engine.info?.origin === 'demo' && engine.buffer === buf) {
      if (autoplay) void togglePlay();
      return;
    }
    source.showEmbed(false);
    autoClip = true;
    await engine.loadBuffer(buf, { title: DEMO_TITLE, artist: DEMO_ARTIST, duration: buf.duration, origin: 'demo' }, store.p.audio.beat);
    afterLoad();
    if (autoplay) void togglePlay();
  } catch (err) {
    demoBuffer = null;
    toast(`Demo failed: ${(err as Error).message}`, 'error');
  }
}

async function loadFile(f: File): Promise<void> {
  try {
    source.showTab('file');
    source.showEmbed(false);
    autoClip = true;
    await engine.loadFile(f, store.p.audio.beat);
    afterLoad();
    toast(`Loaded “${engine.info?.title}”`);
  } catch (err) {
    console.error(err);
    toast(`Couldn’t read that file: ${(err as Error).message}`, 'error');
  }
}

let autoClip = false;
function afterLoad(): void {
  const D = engine.duration;
  store.update('clip', (p) => {
    if (D && p.clip.duration > D) p.clip.duration = Math.max(2, Math.floor(D));
    if (D && p.clip.start + p.clip.duration > D) p.clip.start = Math.max(0, D - p.clip.duration);
  });
  timeline.refresh();
  engine.seek(store.p.clip.start);
  resetSim(store.p.clip.start);
  effects.setArtworkAvailable(!!engine.info?.artwork);
}

engine.on('analysis', () => {
  // A freshly loaded track starts on its most energetic stretch.
  if (autoClip && engine.analysis) {
    autoClip = false;
    const hl = findHighlights(engine.analysis, store.p.clip.duration, engine.beats, 1)[0];
    if (hl && engine.duration > store.p.clip.duration + 1) {
      store.update('clip', (p) => (p.clip.start = Math.max(0, Math.min(engine.duration - p.clip.duration, hl.start))), { history: false });
      if (engine.playing) void engine.play(store.p.clip.start);
      else engine.seek(store.p.clip.start);
    }
  }
  timeline.refresh();
  response.setInfo(engine.analysis?.bpm ?? 0, beatsInClip(), false);
  resetSim(engine.playing ? engine.time : store.p.clip.start);
});
engine.on('beats', () => response.setInfo(engine.analysis?.bpm ?? 0, beatsInClip(), engine.kind === 'live'));
engine.on('error', (e) => toast(`Analysis failed: ${(e as Error).message}`, 'error'));
engine.on('track', () => {
  effects.setArtworkAvailable(!!engine.info?.artwork);
  if (engine.kind === 'live' && !engine.info?.duration) response.setInfo(0, 0, true);
});

/** Full mode: fetch and decode the track through the SoundCloud API. */
async function pickSoundCloud(t: scApi.ScTrack): Promise<void> {
  source.showTab('soundcloud');
  source.showEmbed(false);
  engine.pause();
  try {
    source.setProgress(0.01, 'Loading from SoundCloud');
    const { buffer, preview } = await scApi.loadAudio(t, engine.ctx, (v) => source.setProgress(v, 'Loading from SoundCloud'));
    source.setProgress(1);
    autoClip = true;
    await engine.loadBuffer(buffer, { title: t.title, artist: t.artist, duration: buffer.duration, origin: 'soundcloud', artwork: t.art, link: t.link }, store.p.audio.beat);
    afterLoad();
    toast(preview ? `“${t.title}”: SoundCloud only allows a 30-second preview of this track.` : `Loaded “${t.title}” from SoundCloud.`);
  } catch (err) {
    source.setProgress(0);
    toast(String((err as Error).message ?? err), 'error', 9000);
  }
}

async function loadSoundCloudLink(link: string): Promise<void> {
  if (scApi.isConnected()) {
    try {
      const t = await scApi.resolve(link);
      return pickSoundCloud(t);
    } catch (err) {
      toast(`${(err as Error).message} Playing it in SoundCloud’s player instead.`, 'error', 7000);
    }
  }
  return loadSoundCloudWidget(link);
}

async function loadSoundCloudWidget(link: string): Promise<void> {
  try {
    source.showEmbed(true);
    engine.pause();
    const transport = await soundcloud.createTransport(source.embedHost, link, (info) => {
      engine.updateExternalInfo({ title: info.title, artist: info.artist, duration: info.duration, artwork: info.art, link: info.link }, info.waveform);
      timeline.refresh();
      effects.setArtworkAvailable(!!info.art);
    });
    engine.attachExternal(transport, { title: 'SoundCloud', artist: 'Loading…', duration: 0, origin: 'soundcloud', link });
    afterLoad();
  } catch (err) {
    source.showEmbed(!!engine.external);
    toast(String((err as Error).message ?? err), 'error');
  }
}

// ── Metronome ──────────────────────────────────────────────────────────────

const PATTERN_LABEL = { groove: 'Groove', pulse: 'Pulse', click: 'Click' } as const;
let metroLoading: Promise<void> | null = null;

/**
 * Make the metronome the source, or re-render it after a change. While it
 * plays, the position carries over in beats so the visuals don't restart.
 */
async function useMetronome(m: MetronomeSettings, at?: () => number): Promise<void> {
  const was = engine.info?.origin === 'metronome';
  const playing = was && engine.playing;
  const oldBpm = was ? (engine.analysis?.bpm ?? m.bpm) : m.bpm;
  const pos = engine.time;
  const job = (async () => {
    source.showTab('metro');
    source.showEmbed(false);
    const buf = renderMetronome(engine.ctx.sampleRate, m);
    await engine.loadBuffer(buf, { title: METRONOME_TITLE, artist: `${m.bpm} BPM · ${PATTERN_LABEL[m.pattern]}`, duration: buf.duration, origin: 'metronome' }, store.p.audio.beat, m.bpm);
    engine.setMonitor(m.audible);
    // Whole bars, so the loop stays in time with the beat.
    const bar = (4 * 60) / m.bpm;
    const D = engine.duration;
    store.update('clip', (p) => {
      p.clip.duration = Math.max(1, Math.round(Math.min(p.clip.duration, D) / bar)) * bar;
      p.clip.start = Math.max(0, Math.min(Math.floor((D - p.clip.duration) / bar) * bar, Math.round(p.clip.start / bar) * bar));
    }, { history: false });
    timeline.refresh();
    splash.classList.remove('show');
    const c = store.p.clip;
    let t = at ? at() : was ? (pos * oldBpm) / m.bpm : c.start;
    if (t < c.start || t >= c.start + c.duration) t = c.start + ((((t - c.start) % c.duration) + c.duration) % c.duration);
    if (playing || !was || at) {
      await engine.play(t);
      if (!was) resetSim(t);
    } else engine.seek(t);
  })();
  metroLoading = job;
  try {
    await job;
  } catch (err) {
    toast(`Metronome failed: ${(err as Error).message}`, 'error');
  } finally {
    if (metroLoading === job) metroLoading = null;
  }
}

const taps: number[] = [];
let tapTimer = 0;
/**
 * Tap tempo. After four taps the tempo is set; the first tap of a run counts as
 * beat one, and the metronome is lined up so its beats land on the taps.
 */
function tapTempo(): number | null {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2200) taps.length = 0;
  taps.push(now);
  if (taps.length < 4) {
    toast(`Tap ${4 - taps.length} more…`, 'info', 900);
    return null;
  }
  // Least-squares fit of tap times against beat numbers.
  const n = taps.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += taps[i];
    sxx += i * i;
    sxy += i * taps[i];
  }
  const period = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  if (!(period > 0)) return null;
  const raw = 60000 / period;
  const bpm = clampBpm(Math.abs(raw - Math.round(raw)) < 0.35 ? Math.round(raw) : raw);
  const lastBeat = n - 1;
  const lastTap = taps[n - 1];
  const settings = { ...source.metro, bpm };
  // Song position for "now": a whole number of bars after zero, plus the beats tapped since beat one.
  const at = () => {
    const beat = 60 / bpm;
    const bar = 4 * beat;
    const since = (performance.now() - lastTap) / 1000;
    const c = store.p.clip;
    const offset = (lastBeat % 4) * beat + since;
    const bars = Math.max(0, Math.ceil((c.start - offset) / bar));
    return bars * bar + offset;
  };
  // Apply once the taps stop, so tapping isn't interrupted by re-rendering.
  clearTimeout(tapTimer);
  tapTimer = window.setTimeout(() => {
    const same = engine.info?.origin === 'metronome' && engine.analysis?.bpm === bpm && !metroLoading;
    if (same) void engine.play(at());
    else void useMetronome(settings, at);
  }, 650);
  return bpm;
}

function reportCaptureError(err: unknown): void {
  const e = err as Error;
  if (e?.name === 'NotAllowedError') toast('Sharing was cancelled — the visuals need the audio to react.', 'error');
  else toast(e?.message ?? String(err), 'error', 7000);
}

async function startLive(kind: 'mic' | 'tab'): Promise<void> {
  try {
    source.showEmbed(false);
    await engine.startLive(kind, store.p.audio.beat);
    timeline.refresh();
    sim.clipStart = 0;
    resetSim(0, 0);
    splash.classList.remove('show');
    response.setInfo(0, 0, true);
  } catch (err) {
    reportCaptureError(err);
  }
}

async function listenHere(): Promise<void> {
  try {
    await engine.startLive('tab', store.p.audio.beat, { currentTab: true });
    toast('Listening to this tab. Press play.');
  } catch (err) {
    reportCaptureError(err);
  }
}

function applyArtworkPalette(url: string, quiet = false): void {
  paletteFromImage(url)
    .then((pal) => {
      store.update('palette', (p) => (p.palette = pal));
      if (!quiet) toast('Palette taken from the artwork.');
    })
    .catch(() => !quiet && toast('The artwork’s colours can’t be read (the image host blocks it).', 'error'));
}
effects.artworkPalette = () => engine.info?.artwork && applyArtworkPalette(engine.info.artwork);

async function toggleRecord(): Promise<void> {
  if (recorder) {
    const r = recorder;
    recorder = null;
    timeline.setRecording(false);
    try {
      const seconds = r.elapsed;
      const blob = await r.stop();
      if (engine.playing) engine.pause();
      showRecordDialog(blob, { width: canvas.width, height: canvas.height, seconds, hasAudio: r.hasAudio });
    } catch (err) {
      toast(`Recording failed: ${(err as Error).message}`, 'error');
    }
    return;
  }
  try {
    if (quality < 1) {
      quality = 1;
      qualitySeg.set(1);
      sizeStage();
    }
    recorder = await Recorder.create(canvas, 30, engine.ctx, engine.soundNodes());
    timeline.setRecording(true);
    toast(recorder.hasAudio ? 'Recording picture and sound. Press Stop when you’re done.' : 'Recording the picture (sound capture isn’t available in this browser).');
    if (!engine.playing) void togglePlay();
  } catch (err) {
    recorder = null;
    toast(`Can’t record: ${(err as Error).message}`, 'error');
  }
}

// ── Store reactions ────────────────────────────────────────────────────────

store.on((topic) => {
  if (topic === 'beat' || topic === 'all') {
    engine.updateBeats(store.p.audio.beat);
  }
  if (topic === 'canvas' || topic === 'all') {
    aspectSeg.set(store.p.aspect);
    if (document.activeElement !== nameInput) nameInput.value = store.p.name;
    sizeStage();
  }
});

// ── Input ──────────────────────────────────────────────────────────────────

/** An image or video dropped on the app goes straight into the Media emitter. */
async function addMedia(f: File): Promise<void> {
  try {
    await media.loadFile(f);
    store.update('fx', (p) => {
      p.fx.media.on = true;
      delete p.groupsOff.emit;
    });
    document.querySelector('[data-fx="media"]')?.classList.add('open');
    toast(`“${f.name}” is painting into the canvas. Its settings are under Emit › Media.`);
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

const commands = new CommandPalette(() => {
  const list: Command[] = [];
  const add = (group: string, title: string, run: () => void, keys?: string, words?: string) =>
    list.push({ id: `${group}:${title}`, group, title, run, keys, words });
  add('Playback', engine.playing ? 'Pause' : 'Play', () => void togglePlay(), 'Space');
  add('Playback', 'Back to clip start', () => restart(), 'R');
  add('Playback', 'Clear the canvas', () => resetSim(engine.time, 0), 'C', 'wipe');
  add('Look', 'Surprise me', () => surpriseMe(), 'G', 'random generate shuffle new look');
  add('Look', 'Browse presets', () => presets.toggle());
  if (store.p.preset) add('Look', `Reset to ${PRESETS.find((p) => p.id === store.p.preset)?.name ?? 'preset'}`, () => { const pr = PRESETS.find((p) => p.id === store.p.preset); if (pr) { store.update('all', (p) => { const clip = { ...p.clip }; const a = p.aspect; applyPreset(p, pr); p.clip = clip; p.aspect = a; }); resetSim(engine.time); } }, undefined, 'revert');
  add('Look', 'Undo', () => store.undo(), 'Ctrl Z');
  add('Look', 'Redo', () => store.redo(), 'Ctrl ⇧ Z');
  add('File', 'Export video or images…', () => openExport(), 'E', 'mp4 png jpeg render');
  add('File', 'Snapshot this frame', () => (snapRequested = true), 'S', 'png still screenshot');
  add('File', 'Record in real time', () => void toggleRecord(), undefined, 'capture');
  add('File', 'Save project file', () => saveProject(), undefined, 'json');
  add('File', 'Open project file…', () => fileInput.click(), undefined, 'json load');
  add('Source', 'Open an audio file…', () => source.browse(), undefined, 'mp3 wav load track');
  add('Source', 'Load the demo track', () => void loadDemo(true));
  add('Source', 'Use the metronome', () => void useMetronome({ ...source.metro }), undefined, 'bpm tempo');
  add('Source', 'Listen to the microphone', () => void startLive('mic'), undefined, 'live input');
  add('Source', 'Listen to a tab or system audio', () => void startLive('tab'), undefined, 'live share');
  for (const [i, p] of PRESETS.entries()) add('Presets', p.name, () => presets.apply(p), i < 10 ? String((i + 1) % 10) : undefined, p.note);
  for (const e of EFFECTS) {
    if (e.alwaysOn) continue;
    const on = store.p.fx[e.id].on;
    add('Effects', `${on ? 'Turn off' : 'Turn on'} ${e.label}`, () => {
      store.update('fx', (p) => {
        p.fx[e.id].on = !on;
        if (!on) delete p.groupsOff[e.group];
      });
      if (!on) {
        Section.reveal(e.group);
        const card = document.querySelector(`[data-fx="${e.id}"]`);
        card?.classList.add('open', 'flash');
        setTimeout(() => card?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
        setTimeout(() => card?.classList.remove('flash'), 1400);
      }
    }, undefined, `${e.hint} ${GROUPS.find((g) => g.id === e.group)?.label ?? ''}`);
  }
  for (const g of GROUPS) {
    add('Sections', `Go to ${g.label}`, () => Section.reveal(g.id), undefined, g.hint);
    const off = !!store.p.groupsOff[g.id];
    add('Sections', `${off ? 'Switch on' : 'Switch off'} all of ${g.label}`, () => store.update('fx', (p) => { if (off) delete p.groupsOff[g.id]; else p.groupsOff[g.id] = true; }), undefined, 'master bypass');
  }
  add('View', 'Find an effect or setting', () => effects.focusFind(), '/', 'search filter');
  add('View', 'Toggle light / dark', () => toggleTheme(), undefined, 'theme');
  add('View', 'Fullscreen', () => toggleFullscreen(), 'F');
  add('View', 'Keyboard shortcuts', () => toggleHelp(), '?');
  for (const a of ASPECTS) add('View', `Frame ${a.id}`, () => store.update('canvas', (p) => (p.aspect = a.id)), undefined, 'aspect ratio');
  for (const st of STAGES) add('View', `Stage: ${st.label}`, () => { stageColour = st.id; stageSeg.set(st.id); localStorage.setItem('klangbild.stage', st.id); applyStage(); }, undefined, 'background around canvas');
  return list;
});

window.addEventListener('keydown', (e) => {
  const tgt = e.target as HTMLElement;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    commands.toggle();
    return;
  }
  if (commands.open) return;
  if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
  if (exportDialog.open) {
    if (e.key === 'Escape') exportDialog.close();
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
    return;
  }
  if (mod) return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      void togglePlay();
      break;
    case 'r':
    case 'R':
      restart();
      break;
    case 't':
    case 'T':
      source.tapNow();
      break;
    case 'g':
    case 'G':
      surpriseMe();
      break;
    case '/':
      e.preventDefault();
      effects.focusFind();
      break;
    case 'c':
    case 'C':
      resetSim(engine.time, 0);
      break;
    case 'e':
    case 'E':
      openExport();
      break;
    case 's':
    case 'S':
      snapRequested = true;
      break;
    case 'f':
    case 'F':
      toggleFullscreen();
      break;
    case '?':
      toggleHelp();
      break;
    case 'Escape':
      presets.close();
      if (helpEl) toggleHelp();
      break;
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (engine.kind === 'live') break;
      e.preventDefault();
      const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1);
      seekClip(Math.max(0, Math.min(store.p.clip.duration - 0.05, clipTime() + d)));
      break;
    }
    default:
      if (/^[0-9]$/.test(e.key)) presets.applyIndex(e.key === '0' ? 9 : Number(e.key) - 1);
  }
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  app.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) app.classList.remove('dragging');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  app.classList.remove('dragging');
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  if (/^(image|video)\//.test(f.type)) {
    void addMedia(f);
    return;
  }
  if (f.name.endsWith('.json')) {
    f.text().then((t) => {
      try {
        store.replace(JSON.parse(t));
        resetSim(engine.time);
      } catch {
        toast('That file is not a Klangbild project.', 'error');
      }
    });
  } else void loadFile(f);
});

// ── Main loop ──────────────────────────────────────────────────────────────

let lastUi = 0;
let lastFrame = performance.now();
let frames = 0;
let slowSeconds = 0;
let slowHinted = false;
let silentSince = 0;
let silenceWarned = false;

/** Shared audio that never arrives is the usual reason visuals don't react. */
function watchSilence(now: number): void {
  const lf = engine.liveFeed;
  if (!lf || !engine.playing) {
    silentSince = 0;
    return;
  }
  if (lf.levelDb > -75) {
    silentSince = 0;
    silenceWarned = false;
    return;
  }
  if (!silentSince) silentSince = now;
  if (!silenceWarned && now - silentSince > 3500) {
    silenceWarned = true;
    toast(
      engine.external
        ? 'No sound is reaching Klangbild. Share again with “This tab” and keep “Share tab audio” switched on — or connect a SoundCloud app for full mode.'
        : 'No sound is reaching Klangbild. When sharing, tick “Share tab audio” (or “Share system audio”).',
      'error',
      9000,
    );
  }
}
let fpsStamp = performance.now();

const debug = { paused: false };
store.on(() => (needsRender = true));

function loop(now: number): void {
  requestAnimationFrame(loop);
  if (exporting || debug.paused) return; // give the GPU to the export
  if (renderer.contextLost) return;
  const p = store.p;
  engine.liveFeed?.poll(now);

  const kind = engine.kind;
  renderer.media = media.frame(p, clipTime(), engine.playing, now);
  if (renderer.media && media.kind !== 'image') needsRender = true;
  watchSilence(now);
  if (!engine.playing && media.kind === 'camera' && p.fx.media.on) {
    // Keep the canvas alive for the camera while the music is paused.
    sim.advanceTo(sim.songTime + Math.min(0.1, (now - lastFrame) / 1000), null, p, 4);
    needsRender = true;
  }
  lastFrame = now;
  if (engine.playing) {
    let t = engine.time;
    if (kind === 'file' || (kind === 'external' && engine.duration) || (kind === 'live' && engine.external)) {
      const end = p.clip.start + p.clip.duration;
      if (t >= end) {
        if (recorder && !p.clip.loop) void toggleRecord();
        if (p.clip.loop) {
          t = p.clip.start;
          void engine.play(t);
          resetSim(t);
        } else {
          engine.pause();
          engine.seek(end);
          t = end;
        }
      } else if (t < p.clip.start - 0.25) {
        t = p.clip.start;
        void engine.play(t);
        resetSim(t);
      }
    }
    // Jumps (seek, loop) start a fresh canvas; merely falling behind drops time instead.
    if (t < sim.songTime - 0.1 || t - sim.songTime > 1.5) resetSim(t);
    sim.advanceTo(t, engine.feed, p, 4);
    needsRender = true;
  }
  if (needsRender || recorder || snapRequested) {
    needsRender = false;
    sim.render(p);
  }
  recorder?.capture();
  if (snapRequested) {
    snapRequested = false;
    canvas.toBlob((b) => b && download(b, `klangbild-${fmtTime(clipTime()).replace(/[:.]/g, '-')}.png`), 'image/png');
  }

  frames++;
  if (now - fpsStamp > 1000) {
    const fps = Math.round((frames * 1000) / (now - fpsStamp));
    fpsEl.textContent = `${fps} fps`;
    fpsEl.classList.toggle('slow', engine.playing && fps < 30);
    // Offer Draft once if playback has been choppy for a few seconds.
    slowSeconds = engine.playing && fps < 26 && quality > 0.5 ? slowSeconds + 1 : 0;
    if (slowSeconds >= 4 && !slowHinted) {
      slowHinted = true;
      toast('Playback is running slowly on this computer. Draft preview keeps it smooth; exports stay full quality.', 'info', 9000, {
        label: 'Use Draft',
        run: () => {
          quality = 0.5;
          qualitySeg.set(0.5);
          localStorage.setItem('klangbild.quality', '0.5');
          sizeStage();
        },
      });
    }
    frames = 0;
    fpsStamp = now;
  }
  if (now - lastUi > 33) {
    lastUi = now;
    const f = sim.features;
    effects.tick(f);
    response.tick(f);
    timeline.tick(clipTime(), f);
    cornerTR.textContent = engine.playing ? (recorder ? `● REC ${fmtTime(recorder.elapsed, 0)}` : 'Playing') : 'Paused';
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────

sizeStage();
resetSim(store.p.clip.start);
requestAnimationFrame(loop);
source.syncTrack();
timeline.refresh();

// Prepare the demo in the background so Space plays instantly.
void loadDemo(false);

// Expose for debugging / automated checks.
(window as unknown as Record<string, unknown>).klangbild = { engine, store, sim, renderer, media, debug };
