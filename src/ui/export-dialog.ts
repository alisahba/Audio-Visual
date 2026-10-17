import type { AudioEngine } from '../audio/engine';
import type { MediaManager } from '../media/media';
import { pickFolder, runExport, supportsFolderPicker, videoCodecFor, type Destination, type ExportFormat } from '../export/exporter';
import { aspectRatio } from '../state/project';
import { store } from '../state/store';
import { check, rangeRow, segmented } from './controls';
import { download, fmtTime, h, icon, toast } from './dom';

const SIZES = [
  { id: 720, label: '720p' },
  { id: 1080, label: '1080p' },
  { id: 1440, label: '1440p' },
  { id: 2160, label: '4K' },
];
const QUALITY = [
  { id: 'std', label: 'Standard', bpp: 0.12 },
  { id: 'high', label: 'High', bpp: 0.22 },
  { id: 'max', label: 'Max', bpp: 0.4 },
];

interface Settings {
  format: ExportFormat;
  size: number;
  fps: number;
  quality: string;
  jpeg: number;
  audio: boolean;
  preroll: number;
  dest: Destination;
}

const KEY = 'klangbild.export.v1';

function loadSettings(): Settings {
  const d: Settings = { format: 'mp4', size: 1080, fps: 30, quality: 'high', jpeg: 0.92, audio: true, preroll: 1, dest: supportsFolderPicker() ? 'folder' : 'zip' };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return d;
  }
}

export function outputSize(aspect: string, short: number): [number, number] {
  const a = aspectRatio(aspect);
  const even = (v: number) => Math.round(v / 2) * 2;
  return a >= 1 ? [even(short * a), short] : [short, even(short / a)];
}

export class ExportDialog {
  private back: HTMLElement | null = null;
  private abort: AbortController | null = null;
  onBusy: (busy: boolean) => void = () => {};

  constructor(
    private engine: AudioEngine,
    private media: MediaManager,
    private clipTime: () => number,
    private drawCurrent: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  ) {}

  get open(): boolean {
    return !!this.back;
  }

  show(): void {
    if (this.back) return;
    const s = loadSettings();
    const save = () => localStorage.setItem(KEY, JSON.stringify(s));
    const offline = this.engine.feed?.kind === 'file';

    const preview = h('canvas', { width: 400, height: 500 }) as HTMLCanvasElement;
    const previewBox = h('div', { class: 'preview' }, preview);
    const summary = h('dl', { class: 'summary' });
    const bar = h('i', { style: 'width:0%' });
    const bigbar = h('div', { class: 'bigbar' }, bar);
    const status = h('div', { class: 'note' }, '');
    const startBtn = h('button', { type: 'button', class: 'btn primary', style: 'height:36px' }, 'Start export') as HTMLButtonElement;
    const cancelBtn = h('button', { type: 'button', class: 'btn', style: 'height:36px;display:none' }, 'Cancel') as HTMLButtonElement;

    const fmtSeg = segmented<ExportFormat>({
      options: [
        { value: 'mp4', label: 'MP4' },
        { value: 'png', label: 'PNG seq.' },
        { value: 'jpeg', label: 'JPEG seq.' },
        { value: 'still', label: 'Still' },
      ],
      value: s.format,
      onChange: (v) => {
        s.format = v;
        refresh();
      },
    });
    const sizeSeg = segmented<number>({
      options: SIZES.map((x) => ({ value: x.id, label: x.label })),
      value: s.size,
      onChange: (v) => {
        s.size = v;
        refresh();
      },
    });
    const fpsSeg = segmented<number>({
      options: [24, 25, 30, 50, 60].map((v) => ({ value: v, label: String(v) })),
      value: s.fps,
      onChange: (v) => {
        s.fps = v;
        refresh();
      },
    });
    const qSeg = segmented<string>({
      options: QUALITY.map((q) => ({ value: q.id, label: q.label })),
      value: s.quality,
      onChange: (v) => {
        s.quality = v;
        refresh();
      },
    });
    const jpeg = rangeRow({ label: 'JPEG quality', min: 0.5, max: 1, step: 0.01, def: 0.92, value: s.jpeg, onInput: (v) => ((s.jpeg = v), refresh()) });
    const pre = rangeRow({ label: 'Warm-up', min: 0, max: 5, step: 0.5, def: 1, value: s.preroll, unit: 's', dp: 1, onInput: (v) => ((s.preroll = v), refresh()) });
    const audioChk = check(s.audio, (v) => ((s.audio = v), refresh()), 'Include the music');
    const destSeg = segmented<Destination>({
      options: [
        { value: 'folder', label: 'Into a folder' },
        { value: 'zip', label: 'As one ZIP' },
      ],
      value: s.dest,
      onChange: (v) => {
        s.dest = v;
        refresh();
      },
    });

    const field = (label: string, ...ctl: (HTMLElement | string)[]) => h('div', { class: 'field' }, h('div', { class: 'label' }, label), h('div', null, ...ctl));
    const fFormat = field('Format', fmtSeg.el);
    const fSize = field('Size', sizeSeg.el);
    const fFps = field('Frame rate', fpsSeg.el);
    const fQual = field('Quality', qSeg.el);
    const fJpeg = h('div', { class: 'field' }, h('div', { class: 'label' }, ''), jpeg.row);
    const fAudio = field('Audio', audioChk.el);
    const fPre = h('div', { class: 'field' }, h('div', { class: 'label' }, ''), pre.row);
    const fDest = field('Save', destSeg.el);

    const p = store.p;
    const main = h(
      'div',
      { class: 'm-main' },
      h('h2', null, 'Export'),
      h('p', { class: 'lede' }, `Rendered frame by frame, independent of your screen’s speed — every frame is exactly the clip from ${fmtTime(p.clip.start)} to ${fmtTime(p.clip.start + p.clip.duration)}.`),
      fFormat,
      fSize,
      fFps,
      fQual,
      fJpeg,
      fAudio,
      fDest,
      fPre,
      h('div', { class: 'note', style: 'margin-top:10px' }, 'Warm-up runs the simulation before the first frame so the clip doesn’t start on an empty canvas.'),
    );
    const side = h('div', { class: 'm-side' }, previewBox, summary, bigbar, status, h('div', { class: 'hstack' }, startBtn, cancelBtn));
    const closeBtn = h('button', { type: 'button', class: 'btn icon ghost close-x', 'aria-label': 'Close', onclick: () => this.close() }, icon('close'));
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Export', style: 'position:relative' }, main, side, closeBtn);
    this.back = h('div', { class: 'modal-back', onclick: (e: Event) => e.target === this.back && !this.abort && this.close() }, modal);
    document.body.appendChild(this.back);

    const ar = aspectRatio(p.aspect);
    previewBox.style.aspectRatio = String(ar);

    const refresh = () => {
      save();
      fmtSeg.set(s.format);
      const isSeq = s.format === 'png' || s.format === 'jpeg';
      fQual.style.display = s.format === 'mp4' ? '' : 'none';
      fJpeg.style.display = s.format === 'jpeg' ? '' : 'none';
      const fromSoundCloud = this.engine.info?.origin === 'soundcloud';
      fAudio.style.display = s.format === 'mp4' && this.engine.buffer && !fromSoundCloud ? '' : 'none';
      fDest.style.display = isSeq ? '' : 'none';
      fFps.style.display = s.format === 'still' ? 'none' : '';
      if (!supportsFolderPicker()) {
        destSeg.el.querySelector('button')!.setAttribute('disabled', '');
        s.dest = 'zip';
      }
      destSeg.set(s.dest);
      const [W, H] = outputSize(p.aspect, s.size);
      const frames = Math.round(p.clip.duration * s.fps);
      const bpp = QUALITY.find((q) => q.id === s.quality)!.bpp;
      const bitrate = Math.round(W * H * s.fps * bpp);
      const rows: [string, string][] = [
        ['Output', `${W} × ${H}`],
        ['Clip', s.format === 'still' ? `frame at ${fmtTime(this.clipTime())}` : `${p.clip.duration.toFixed(1)} s`],
      ];
      if (s.format === 'mp4') {
        rows.push(['Frames', `${frames} @ ${s.fps} fps`]);
        rows.push(['Bitrate', `${(bitrate / 1e6).toFixed(1)} Mbps`]);
        rows.push(['Est. size', `${Math.round((bitrate * p.clip.duration) / 8 / 1e6 + (s.audio ? (p.clip.duration * 24) / 1000 : 0))} MB`]);
      } else if (isSeq) {
        rows.push(['Frames', `${frames} @ ${s.fps} fps`]);
        rows.push(['Files', `${frames} × .${s.format === 'png' ? 'png' : 'jpg'}`]);
      }
      summary.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
      startBtn.disabled = !offline || !!this.abort;
      status.textContent = !offline
        ? 'Offline export needs a decoded track (a file, the demo, or SoundCloud in full mode). For live input or the SoundCloud player, use Record under the timeline.'
        : this.engine.info?.origin === 'soundcloud' && s.format === 'mp4'
          ? 'SoundCloud tracks export as picture only — add the music in your editor.'
          : this.media.kind === 'camera'
            ? 'The camera is live: offline export samples it as it renders. For a performance take, use Record.'
            : '';
      if (s.format === 'mp4') {
        videoCodecFor(W, H, bitrate).then((c) => {
          if (!c && s.format === 'mp4') status.textContent = 'This browser can’t encode video. Use Chrome or Edge, or export an image sequence.';
        });
      }
      return { W, H, bitrate };
    };
    refresh();

    const pctx = preview.getContext('2d')!;
    const drawPreview = (src: HTMLCanvasElement) => {
      preview.width = 400;
      preview.height = Math.round(400 / ar);
      pctx.drawImage(src, 0, 0, preview.width, preview.height);
    };
    preview.width = 400;
    preview.height = Math.round(400 / ar);
    this.drawCurrent(pctx, preview.width, preview.height);

    startBtn.onclick = async () => {
      const { W, H, bitrate } = refresh();
      let dir;
      if ((s.format === 'png' || s.format === 'jpeg') && s.dest === 'folder') {
        try {
          dir = await pickFolder();
        } catch {
          return;
        }
      }
      this.abort = new AbortController();
      this.onBusy(true);
      startBtn.disabled = true;
      cancelBtn.style.display = '';
      main.style.pointerEvents = 'none';
      main.style.opacity = '0.5';
      const started = performance.now();
      let lastDraw = 0;
      try {
        const res = await runExport(
          {
            format: s.format,
            width: W,
            height: H,
            fps: s.fps,
            bitrate,
            jpegQuality: s.jpeg,
            includeAudio: s.audio && this.engine.info?.origin !== 'soundcloud' && !(this.engine.info?.origin === 'metronome' && this.engine.monitor.gain.value < 0.5),
            preroll: s.preroll,
            destination: s.dest,
            stillTime: this.clipTime(),
          },
          this.engine,
          store.p,
          (pr) => {
            const k = pr.total ? pr.frame / pr.total : 0;
            bar.style.width = `${k * 100}%`;
            const el = (performance.now() - started) / 1000;
            if (pr.phase === 'warmup') status.textContent = 'Warming up the canvas…';
            else if (pr.phase === 'finalise') status.textContent = 'Finishing file…';
            else {
              const eta = k > 0.02 ? el / k - el : 0;
              status.textContent = `Frame ${pr.frame} / ${pr.total}${eta ? ` · about ${Math.ceil(eta)} s left` : ''}`;
            }
            const now = performance.now();
            if (now - lastDraw > 120) {
              lastDraw = now;
              drawPreview(pr.canvas);
            }
          },
          this.abort.signal,
          dir,
          await this.media.exporter(store.p),
        );
        bar.style.width = '100%';
        if (res.blob) {
          download(res.blob, res.name);
          status.replaceChildren(
            `Done — ${res.frames} frame${res.frames === 1 ? '' : 's'} in ${res.seconds.toFixed(1)} s. `,
            h('a', { href: '#', onclick: (e: Event) => (e.preventDefault(), download(res.blob!, res.name)) }, 'Download again'),
          );
        } else {
          status.textContent = `Done — ${res.frames} frames written to “${res.savedTo}” in ${res.seconds.toFixed(1)} s.`;
        }
        toast(`Exported ${res.name}`);
      } catch (err) {
        const e = err as Error;
        if (e.name === 'AbortError') status.textContent = 'Cancelled.';
        else {
          console.error(err);
          status.textContent = `Export failed: ${e.message}`;
          toast(`Export failed: ${e.message}`, 'error', 8000);
        }
      } finally {
        this.abort = null;
        this.onBusy(false);
        startBtn.disabled = false;
        startBtn.textContent = 'Export again';
        cancelBtn.style.display = 'none';
        main.style.pointerEvents = '';
        main.style.opacity = '';
      }
    };
    cancelBtn.onclick = () => this.abort?.abort();
  }

  close(): void {
    if (this.abort) return;
    this.back?.remove();
    this.back = null;
  }
}
