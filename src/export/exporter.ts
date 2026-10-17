import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Conversion,
  Input,
  EncodedPacketSink,
  EncodedVideoPacketSource,
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
import type { MediaExportSource } from '../media/media';
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
  mediaSrc?: MediaExportSource | null,
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

  const setMedia = async (clipTime: number) => {
    if (mediaSrc) renderer.media = await mediaSrc.frameAt(Math.max(0, clipTime));
  };
  try {
    await setMedia(0);
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
        if (mediaSrc && n % 2 === 0) await setMedia(sim.songTime - clipStart);
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
          await setMedia(i / opts.fps);
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
      await setMedia(i / opts.fps);
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
    mediaSrc?.dispose();
    renderer.dispose();
  }
}

// Collects what the speakers play (or the live input) as raw stereo samples.
const TAP_WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const i = inputs[0];
    if (i && i.length) {
      const l = i[0];
      const r = i[1] || i[0];
      this.port.postMessage({ t: currentTime, l: l.slice(), r: r.slice() });
    }
    return true;
  }
}
registerProcessor('klangbild-tap', Tap);`;

class SoundTap {
  private chunks: { t: number; l: Float32Array; r: Float32Array }[] = [];
  private node: AudioWorkletNode | null = null;
  private mute: GainNode | null = null;

  constructor(private ctx: AudioContext) {}

  async start(src: AudioNode[]): Promise<void> {
    const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'text/javascript' }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    this.node = new AudioWorkletNode(this.ctx, 'klangbild-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    this.node.port.onmessage = (e) => this.chunks.push(e.data);
    for (const n of src) n.connect(this.node);
    // A silent path to the output keeps the node running.
    this.mute = this.ctx.createGain();
    this.mute.gain.value = 0;
    this.node.connect(this.mute).connect(this.ctx.destination);
  }

  /** Stop and return the sound from context time `t0` on, as an AudioBuffer. */
  finish(src: AudioNode[], t0: number, seconds: number): AudioBuffer | null {
    if (this.node) {
      for (const n of src) {
        try {
          n.disconnect(this.node);
        } catch {
          /* gone */
        }
      }
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.mute?.disconnect();
    }
    if (!this.chunks.length) return null;
    const sr = this.ctx.sampleRate;
    const len = Math.max(1, Math.round(seconds * sr));
    const buf = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: sr });
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    for (const c of this.chunks) {
      const at = Math.round((c.t - t0) * sr);
      for (let i = 0; i < c.l.length; i++) {
        const j = at + i;
        if (j < 0 || j >= len) continue;
        L[j] = c.l[i];
        R[j] = c.r[i];
      }
    }
    return buf;
  }
}

/**
 * Real-time recording of the preview canvas plus the sound (what you hear, or
 * the live input). Video is encoded as it plays; the sound is captured raw and
 * joined to it when recording stops, so one can never stall the other. The
 * result is a high-bitrate master; `transcodeRecording` makes the final file.
 */
export class Recorder {
  private start = 0;
  private startCtx = 0;
  private last = -1;
  private busy = false;
  frames = 0;

  private constructor(
    private output: Output,
    private source: CanvasSource,
    private fps: number,
    private tap: SoundTap | null,
    private sound: AudioNode[],
  ) {}

  get hasAudio(): boolean {
    return !!this.tap;
  }

  /** `sound` are the nodes to record from (their output is tapped, not changed). */
  static async create(canvas: HTMLCanvasElement, fps = 30, ctx: AudioContext | null = null, sound: AudioNode[] = [], bitrate = 24_000_000): Promise<Recorder> {
    const codec = await videoCodecFor(canvas.width, canvas.height, bitrate);
    if (!codec) throw new Error('This browser cannot encode video. Use Chrome or Edge.');
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const source = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 2, sizeChangeBehavior: 'contain' });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    let tap: SoundTap | null = null;
    if (ctx && sound.length) {
      try {
        tap = new SoundTap(ctx);
        await tap.start(sound);
      } catch (err) {
        console.warn('Sound capture unavailable', err);
        tap = null;
      }
    }
    const r = new Recorder(output, source, fps, tap, sound);
    r.start = performance.now();
    r.startCtx = ctx?.currentTime ?? 0;
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
    const seconds = this.elapsed;
    this.source.close();
    await this.output.finalize();
    const video = new Blob([(this.output.target as BufferTarget).buffer!], { type: 'video/mp4' });
    const pcm = this.tap?.finish(this.sound, this.startCtx, seconds) ?? null;
    if (!pcm) return video;
    try {
      return await joinSound(video, pcm);
    } catch (err) {
      console.warn('Could not add the sound to the recording', err);
      return video;
    }
  }

  async cancel(): Promise<void> {
    this.tap?.finish(this.sound, this.startCtx, 0);
    await this.output.cancel();
  }
}

/** Copy the encoded video as-is and encode the captured sound next to it. */
async function joinSound(video: Blob, pcm: AudioBuffer): Promise<Blob> {
  const input = new Input({ source: new BlobSource(video), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track || !track.codec) throw new Error('No video in the recording');
  const config = await track.getDecoderConfig();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const vsrc = new EncodedVideoPacketSource(track.codec);
  output.addVideoTrack(vsrc, { frameRate: 30 });
  const ac = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: pcm.sampleRate, bitrate: 256_000 });
  if (!ac) throw new Error('This browser cannot encode audio');
  const asrc = new AudioBufferSource({ codec: ac, bitrate: 256_000 });
  output.addAudioTrack(asrc);
  await output.start();
  let first = true;
  for await (const packet of new EncodedPacketSink(track).packets()) {
    await vsrc.add(packet, first && config ? { decoderConfig: config } : undefined);
    first = false;
  }
  vsrc.close();
  await asrc.add(pcm);
  asrc.close();
  await output.finalize();
  return new Blob([(output.target as BufferTarget).buffer!], { type: 'video/mp4' });
}

export interface TranscodeOptions {
  /** Shorter side in pixels; 0 keeps the recorded size. */
  short: number;
  bitrate: number;
  audio: boolean;
}

/** Re-encode a recording at the chosen size, bitrate and with or without sound. */
export async function transcodeRecording(blob: Blob, o: TranscodeOptions, onProgress: (v: number) => void, signal: AbortSignal): Promise<Blob> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const vt = await input.getPrimaryVideoTrack();
  let width: number | undefined;
  let height: number | undefined;
  if (vt && o.short) {
    const w = vt.displayWidth;
    const hh = vt.displayHeight;
    const k = o.short / Math.min(w, hh);
    if (k < 1) {
      width = Math.round((w * k) / 2) * 2;
      height = Math.round((hh * k) / 2) * 2;
    }
  }
  const conversion = await Conversion.init({
    input,
    output,
    video: { width, height, fit: width ? 'fill' : undefined, bitrate: o.bitrate, keyFrameInterval: 2, forceTranscode: true },
    audio: o.audio ? { bitrate: 192_000 } : { discard: true },
  });
  if (!conversion.isValid) throw new Error('This recording can’t be converted in this browser.');
  conversion.onProgress = (v) => onProgress(v);
  const stop = () => void conversion.cancel();
  signal.addEventListener('abort', stop);
  try {
    await conversion.execute();
  } finally {
    signal.removeEventListener('abort', stop);
  }
  return new Blob([(output.target as BufferTarget).buffer!], { type: 'video/mp4' });
}
