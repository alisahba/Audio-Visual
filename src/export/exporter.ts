import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny';
import { Zip, ZipPassThrough } from 'fflate';
import type { AudioEngine } from '../audio/engine';
import type { FeatureSource } from '../audio/features';
import { clone, type Project } from '../state/project';
import { Renderer } from '../render/renderer';
import { SimDriver } from '../render/sim';

export type ExportFormat = 'mp4' | 'png' | 'jpeg' | 'still';
export type Destination = 'folder' | 'zip';

export interface ExportOptions {
  format: ExportFormat;
  width: number;
  height: number;
  fps: number;
  /** Video bitrate in bits/s. */
  bitrate: number;
  jpegQuality: number;
  includeAudio: boolean;
  preroll: number;
  destination: Destination;
  /** For stills: clip-relative time of the frame. */
  stillTime?: number;
}

export interface ExportProgress {
  frame: number;
  total: number;
  phase: 'warmup' | 'render' | 'finalise';
  canvas: HTMLCanvasElement;
}

export interface ExportResult {
  blob?: Blob;
  name: string;
  savedTo?: string;
  frames: number;
  seconds: number;
}

interface DirHandle {
  name: string;
  getFileHandle(name: string, opts: { create: boolean }): Promise<{ createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> }>;
}

export function supportsFolderPicker(): boolean {
  return 'showDirectoryPicker' in window;
}

export async function pickFolder(): Promise<DirHandle> {
  return (window as unknown as { showDirectoryPicker(o?: object): Promise<DirHandle> }).showDirectoryPicker({ mode: 'readwrite', id: 'klangbild-export' });
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'klangbild'
  );
}

/** A yield that isn't throttled like setTimeout. */
const channel = new MessageChannel();
const queue: (() => void)[] = [];
channel.port1.onmessage = () => queue.shift()?.();
function yieldTask(): Promise<void> {
  return new Promise((r) => {
    queue.push(r);
    channel.port2.postMessage(0);
  });
}

function sliceAudio(buffer: AudioBuffer, start: number, duration: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const a = Math.max(0, Math.floor(start * sr));
  const len = Math.max(1, Math.floor(duration * sr));
  const out = new AudioBuffer({ length: len, numberOfChannels: buffer.numberOfChannels, sampleRate: sr });
  const fade = Math.min(len / 2, Math.floor(sr * 0.012));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const v = src[a + i] ?? 0;
      const g = i < fade ? i / fade : i > len - fade ? (len - i) / fade : 1;
      dst[i] = v * g;
    }
  }
  return out;
}

export async function videoCodecFor(w: number, h: number, bitrate: number): Promise<VideoCodec | null> {
  return getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: w, height: h, bitrate });
}

export async function runExport(
  opts: ExportOptions,
  engine: AudioEngine,
  liveProject: Project,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
  dir?: DirHandle,
): Promise<ExportResult> {
  const t0 = performance.now();
  const project = clone(liveProject);
  const feed: FeatureSource | null = engine.feed?.kind === 'file' ? engine.feed : null;
  if (!feed) throw new Error('Offline export needs a loaded audio file. For live sources use Record.');

  const W = opts.width - (opts.width % 2);
  const H = opts.height - (opts.height % 2);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const renderer = new Renderer(canvas, { preserveDrawingBuffer: true });
  renderer.resize(W, H, 1);
  const sim = new SimDriver(renderer);
  const clipStart = project.clip.start;
  const base = `${slug(engine.info?.title ?? project.name)}`;

  try {
    sim.reset(project, clipStart - opts.preroll, engine.analysis?.bpm ?? 0);
    sim.clipStart = clipStart;
    // Warm up so the first frame isn't an empty canvas.
    const warmSteps = Math.ceil(opts.preroll * 60);
    for (let i = 0; i < warmSteps && sim.songTime + 1 / 60 <= clipStart + 1e-9; i++) {
      sim.stepOnce(feed, project);
      if (i % 30 === 0) {
        onProgress({ frame: 0, total: 1, phase: 'warmup', canvas });
        await yieldTask();
        if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      }
    }

    if (opts.format === 'still') {
      const t = clipStart + (opts.stillTime ?? 0);
      let n = 0;
      while (sim.songTime + 1 / 60 <= t + 1e-9) {
        sim.stepOnce(feed, project);
        if (++n % 30 === 0) {
          onProgress({ frame: 0, total: 1, phase: 'warmup', canvas });
          await yieldTask();
          if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        }
      }
      sim.render(project);
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
      onProgress({ frame: 1, total: 1, phase: 'finalise', canvas });
      return { blob, name: `${base}_${Math.round((opts.stillTime ?? 0) * 1000)}ms.png`, frames: 1, seconds: (performance.now() - t0) / 1000 };
    }

    const total = Math.max(1, Math.round(project.clip.duration * opts.fps));

    if (opts.format === 'mp4') {
      const codec = await videoCodecFor(W, H, opts.bitrate);
      if (!codec) throw new Error('This browser cannot encode video. Use Chrome or Edge, or export an image sequence.');
      const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
      const video = new CanvasSource(canvas, { codec, bitrate: opts.bitrate, keyFrameInterval: 2 });
      output.addVideoTrack(video, { frameRate: opts.fps });
      let audio: AudioBufferSource | null = null;
      let audioSlice: AudioBuffer | null = null;
      if (opts.includeAudio && engine.buffer) {
        const ac: AudioCodec | null = await getFirstEncodableAudioCodec(['aac', 'opus'], {
          numberOfChannels: engine.buffer.numberOfChannels,
          sampleRate: engine.buffer.sampleRate,
          bitrate: 192_000,
        });
        if (ac) {
          audio = new AudioBufferSource({ codec: ac, bitrate: 192_000 });
          output.addAudioTrack(audio);
          audioSlice = sliceAudio(engine.buffer, clipStart, project.clip.duration);
        }
      }
      await output.start();
      if (audio && audioSlice) await audio.add(audioSlice);
      try {
        for (let i = 0; i < total; i++) {
          if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
          sim.advanceTo(clipStart + i / opts.fps, feed, project);
          sim.render(project);
          await video.add(i / opts.fps, 1 / opts.fps);
          onProgress({ frame: i + 1, total, phase: 'render', canvas });
          if (i % 4 === 0) await yieldTask();
        }
        onProgress({ frame: total, total, phase: 'finalise', canvas });
        video.close();
        audio?.close();
        await output.finalize();
      } catch (err) {
        await output.cancel().catch(() => {});
        throw err;
      }
      const buf = (output.target as BufferTarget).buffer!;
      return { blob: new Blob([buf], { type: 'video/mp4' }), name: `${base}.mp4`, frames: total, seconds: (performance.now() - t0) / 1000 };
    }

    // Image sequences.
    const mime = opts.format === 'png' ? 'image/png' : 'image/jpeg';
    const ext = opts.format === 'png' ? 'png' : 'jpg';
    const chunks: Uint8Array[] = [];
    let zip: Zip | null = null;
    let zipDone: Promise<void> = Promise.resolve();
    if (!dir) {
      zip = new Zip();
      zipDone = new Promise((res, rej) => {
        zip!.ondata = (err, data, final) => {
          if (err) return rej(err);
          chunks.push(data);
          if (final) res();
        };
      });
    }
    const inflight: Promise<void>[] = [];
    const MAX_INFLIGHT = 4;
    // Encodes run in parallel; zip entries are appended strictly in order.
    let chain: Promise<void> = Promise.resolve();
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      sim.advanceTo(clipStart + i / opts.fps, feed, project);
      sim.render(project);
      const name = `${base}_${String(i).padStart(5, '0')}.${ext}`;
      const blobP = new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('Image encode failed'))), mime, opts.format === 'jpeg' ? opts.jpegQuality : undefined),
      );
      let job: Promise<void>;
      if (dir) {
        job = blobP.then(async (blob) => {
          const fh = await dir.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
        });
      } else {
        chain = chain.then(async () => {
          const blob = await blobP;
          const entry = new ZipPassThrough(name);
          zip!.add(entry);
          entry.push(new Uint8Array(await blob.arrayBuffer()), true);
        });
        job = chain;
      }
      inflight.push(job);
      if (inflight.length >= MAX_INFLIGHT) await inflight.shift();
      onProgress({ frame: i + 1, total, phase: 'render', canvas });
      if (i % 2 === 0) await yieldTask();
    }
    await Promise.all(inflight);
    onProgress({ frame: total, total, phase: 'finalise', canvas });
    if (zip) {
      zip.end();
      await zipDone;
      return { blob: new Blob(chunks as BlobPart[], { type: 'application/zip' }), name: `${base}_${ext}.zip`, frames: total, seconds: (performance.now() - t0) / 1000 };
    }
    return { name: base, savedTo: dir!.name, frames: total, seconds: (performance.now() - t0) / 1000 };
  } finally {
    renderer.dispose();
  }
}

/** Real-time recording of the preview canvas (for live and streamed sources). */
export class Recorder {
  private output: Output;
  private source: CanvasSource;
  private start = 0;
  private last = -1;
  private busy = false;
  frames = 0;

  private constructor(
    output: Output,
    source: CanvasSource,
    private fps: number,
  ) {
    this.output = output;
    this.source = source;
  }

  static async create(canvas: HTMLCanvasElement, fps = 30, bitrate = 16_000_000): Promise<Recorder> {
    const codec = await videoCodecFor(canvas.width, canvas.height, bitrate);
    if (!codec) throw new Error('This browser cannot encode video. Use Chrome or Edge.');
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const source = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 2, sizeChangeBehavior: 'contain' });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    const r = new Recorder(output, source, fps);
    r.start = performance.now();
    return r;
  }

  get elapsed(): number {
    return (performance.now() - this.start) / 1000;
  }

  /** Call right after the preview has rendered. Drops frames rather than queueing. */
  capture(): void {
    const t = this.elapsed;
    const slot = Math.floor(t * this.fps);
    if (slot === this.last || this.busy) return;
    this.last = slot;
    this.busy = true;
    this.frames++;
    this.source
      .add(slot / this.fps, 1 / this.fps)
      .catch(() => {})
      .finally(() => (this.busy = false));
  }

  async stop(): Promise<Blob> {
    this.source.close();
    await this.output.finalize();
    return new Blob([(this.output.target as BufferTarget).buffer!], { type: 'video/mp4' });
  }

  async cancel(): Promise<void> {
    await this.output.cancel();
  }
}
