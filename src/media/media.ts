// Images, videos and the camera as a visual source for the Media emitter.
// Video follows the clip time (and renders frame-accurately in export);
// the camera is live. Hands / face / body run through MediaPipe and are
// handed to the renderer as stylised masks rather than footage.

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { MediaFrame } from '../render/renderer';
import type { Project } from '../state/project';
import { Tracker, type Subject } from './tracker';

export type MediaKind = 'image' | 'video' | 'camera';
type Evt = 'change' | 'status';

export class MediaManager {
  kind: MediaKind | null = null;
  name = '';
  status = '';
  file: File | null = null;
  private image: ImageBitmap | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private tracker: Tracker | null = null;
  private trackerFor: Subject | null = null;
  private trackerLoading: Subject | null = null;
  private version = 0;
  private lastTrack = 0;
  private listeners = new Map<Evt, Set<() => void>>();
  /** Thumbnail data URL for the UI. */
  thumb = '';

  on(evt: Evt, fn: () => void): void {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt)!.add(fn);
  }
  private emit(evt: Evt): void {
    this.listeners.get(evt)?.forEach((f) => f());
  }
  private setStatus(s: string): void {
    this.status = s;
    this.emit('status');
  }

  get aspect(): number {
    if (this.image) return this.image.width / this.image.height;
    if (this.video && this.video.videoWidth) return this.video.videoWidth / this.video.videoHeight;
    return 16 / 9;
  }

  clear(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.pause();
      if (this.video.src.startsWith('blob:')) URL.revokeObjectURL(this.video.src);
      this.video.removeAttribute('src');
      this.video.srcObject = null;
    }
    this.video = null;
    this.image?.close();
    this.image = null;
    this.kind = null;
    this.file = null;
    this.name = '';
    this.thumb = '';
    this.setStatus('');
    this.emit('change');
  }

  async loadFile(file: File): Promise<void> {
    this.clear();
    this.file = file;
    this.name = file.name;
    if (file.type.startsWith('image/')) {
      this.image = await createImageBitmap(file);
      this.kind = 'image';
      this.makeThumb(this.image, this.image.width, this.image.height);
    } else {
      const v = document.createElement('video');
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = URL.createObjectURL(file);
      await new Promise<void>((res, rej) => {
        v.onloadeddata = () => res();
        v.onerror = () => rej(new Error('This video format can’t be played here. Try MP4 (H.264) or WebM.'));
      });
      this.video = v;
      this.kind = 'video';
      this.makeThumb(v, v.videoWidth, v.videoHeight);
    }
    this.version++;
    this.emit('change');
  }

  async startCamera(): Promise<void> {
    this.clear();
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    await v.play();
    this.stream = stream;
    this.video = v;
    this.kind = 'camera';
    this.name = 'Camera';
    this.makeThumb(v, v.videoWidth, v.videoHeight);
    stream.getVideoTracks()[0].addEventListener('ended', () => this.clear());
    this.emit('change');
  }

  private makeThumb(src: CanvasImageSource, w: number, h: number): void {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = Math.max(8, Math.round((96 * h) / Math.max(1, w)));
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    this.thumb = c.toDataURL('image/jpeg', 0.7);
  }

  private async ensureTracker(subject: Subject): Promise<void> {
    if (this.trackerFor === subject || this.trackerLoading === subject) return;
    this.trackerLoading = subject;
    this.setStatus(`Loading ${subject} tracking…`);
    try {
      const t = await Tracker.create(subject);
      if (this.trackerLoading !== subject) {
        t.close();
        return;
      }
      this.tracker?.close();
      this.tracker = t;
      this.trackerFor = subject;
      this.setStatus('');
    } catch (err) {
      console.error(err);
      this.setStatus(`Tracking couldn’t load (${(err as Error).message}).`);
    } finally {
      if (this.trackerLoading === subject) this.trackerLoading = null;
    }
  }

  /**
   * Preview: keep video in step with the clip, run tracking (~30 fps) and
   * return the frame for the renderer.
   */
  frame(project: Project, clipTime: number, playing: boolean, now: number): MediaFrame | null {
    if (!this.kind || !project.fx.media?.on) return null;
    const subject = project.fx.media.p.subject as string;
    const speed = project.fx.media.p.speed as number;
    if (this.video && this.kind === 'video') {
      const v = this.video;
      const target = v.duration ? (clipTime * speed) % v.duration : 0;
      v.playbackRate = speed;
      if (playing) {
        if (v.paused) void v.play().catch(() => {});
        if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target;
      }
    }
    const src: TexImageSource | null = this.image ?? this.video;
    if (!src) return null;
    const mirror = this.kind === 'camera';
    if (subject === 'full') {
      if (this.kind !== 'image') this.version++;
      return { source: src, version: this.version, aspect: this.aspect, mask: false, mirror };
    }
    void this.ensureTracker(subject as Subject);
    const t = this.trackerFor === subject ? this.tracker : null;
    if (!t) return null;
    if (now - this.lastTrack > 30 || this.kind === 'image') {
      this.lastTrack = now;
      const w = this.image ? this.image.width : (this.video?.videoWidth ?? 0);
      const h = this.image ? this.image.height : (this.video?.videoHeight ?? 0);
      if (w && h) {
        try {
          t.update(src, w, h, now);
          this.version++;
        } catch (err) {
          console.warn(err);
        }
      }
    }
    return { source: t.canvas, version: this.version, aspect: this.aspect, mask: true, mirror };
  }

  /** Frame-accurate source for offline export. */
  async exporter(project: Project): Promise<MediaExportSource | null> {
    if (!this.kind || !project.fx.media?.on) return null;
    const subject = project.fx.media.p.subject as string;
    if (subject !== 'full') await this.ensureTracker(subject as Subject);
    return new MediaExportSource(this, project, subject === 'full' ? null : this.tracker);
  }

  /** @internal */
  get raw() {
    return { image: this.image, video: this.video, file: this.file };
  }
}

/** Delivers media frames for exact export times (video decoded with Mediabunny). */
export class MediaExportSource {
  private input: Input | null = null;
  private sink: CanvasSink | null = null;
  private version = 0;
  private ts = 0;

  constructor(
    private m: MediaManager,
    private project: Project,
    private tracker: Tracker | null,
  ) {}

  async frameAt(clipTime: number): Promise<MediaFrame | null> {
    const { image, video, file } = this.m.raw;
    const mirror = this.m.kind === 'camera';
    let src: TexImageSource | null = null;
    let w = 0;
    let h = 0;
    if (image) {
      src = image;
      w = image.width;
      h = image.height;
    } else if (this.m.kind === 'video' && file) {
      if (!this.sink) {
        this.input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        const track = await this.input.getPrimaryVideoTrack();
        if (!track) return null;
        this.sink = new CanvasSink(track, { width: Math.min(1280, track.displayWidth), poolSize: 2 });
      }
      const dur = (await this.input!.computeDuration()) || 1;
      const t = (clipTime * (this.project.fx.media.p.speed as number)) % dur;
      const wrapped = await this.sink.getCanvas(t);
      if (!wrapped) return null;
      src = wrapped.canvas as HTMLCanvasElement;
      w = src.width;
      h = src.height;
    } else if (video) {
      src = video;
      w = video.videoWidth;
      h = video.videoHeight;
    }
    if (!src) return null;
    this.version++;
    if (!this.tracker) return { source: src, version: this.version, aspect: w / h, mask: false, mirror };
    this.ts += 1000 / 30;
    this.tracker.update(src, w, h, this.ts);
    return { source: this.tracker.canvas, version: this.version, aspect: w / h, mask: true, mirror };
  }

  dispose(): void {
    this.input?.dispose();
  }
}
