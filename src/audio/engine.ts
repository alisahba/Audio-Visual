import { analyseMono, detectBeats, downmix, type TrackAnalysis } from './analysis';
import { FileFeed, LiveFeed, type FeatureSource } from './features';
import liveWorkletUrl from './live.worklet.ts?worker&url';
import type { BeatSettings } from '../state/project';

export type Origin = 'demo' | 'file' | 'soundcloud' | 'mic' | 'tab';

export interface TrackInfo {
  title: string;
  artist: string;
  duration: number;
  origin: Origin;
  artwork?: string;
  link?: string;
}

/** Playback driven by something other than an AudioBuffer (e.g. an embedded player). */
export interface ExternalTransport {
  play(at: number): void;
  pause(): void;
  /** Current position in seconds. */
  time(): number;
  playing(): boolean;
  destroy(): void;
}

type Evt = 'state' | 'track' | 'analysis' | 'beats' | 'progress' | 'error';

export class AudioEngine {
  ctx: AudioContext;
  out: GainNode;
  buffer: AudioBuffer | null = null;
  mono: Float32Array | null = null;
  analysis: TrackAnalysis | null = null;
  beats: Float32Array = new Float32Array(0);
  info: TrackInfo | null = null;
  feed: FeatureSource | null = null;
  liveFeed: LiveFeed | null = null;
  external: ExternalTransport | null = null;
  /** Coarse loudness overview for sources without decoded audio (e.g. SoundCloud waveform). */
  overview: Float32Array | null = null;
  analysing = 0;

  private node: AudioBufferSourceNode | null = null;
  private startCtx = 0;
  private startOffset = 0;
  private _playing = false;
  private pausedAt = 0;
  private stream: MediaStream | null = null;
  private streamNode: MediaStreamAudioSourceNode | null = null;
  private liveStart = 0;
  private workletLoaded = false;
  private liveNodes: AudioNode[] = [];
  /** User A/V offset in ms: positive delays the picture. Device-specific, so not part of a project. */
  syncMs = 0;
  private listeners = new Map<Evt, Set<(arg?: unknown) => void>>();
  private loadToken = 0;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
  }

  on(evt: Evt, fn: (arg?: unknown) => void): void {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt)!.add(fn);
  }
  private emit(evt: Evt, arg?: unknown): void {
    this.listeners.get(evt)?.forEach((fn) => fn(arg));
  }

  get kind(): 'none' | 'file' | 'live' | 'external' {
    if (this.external) return 'external';
    if (this.stream) return 'live';
    if (this.buffer) return 'file';
    return 'none';
  }

  get duration(): number {
    if (this.buffer) return this.buffer.duration;
    if (this.info?.duration) return this.info.duration;
    return 0;
  }

  get playing(): boolean {
    if (this.external) return this.external.playing();
    return this._playing;
  }

  /** Current song position (s). */
  get time(): number {
    if (this.external) return this.external.time();
    if (this.stream) return this._playing ? (performance.now() - this.liveStart) / 1000 : this.pausedAt;
    if (!this._playing) return this.pausedAt;
    return Math.max(this.startOffset - 0.25, this.startOffset + (this.audibleTime() - this.startCtx)) - this.syncMs / 1000;
  }

  /**
   * Context time of the sample reaching the speakers right now. currentTime runs
   * ahead of what you hear by the output latency (large on Bluetooth), so the
   * picture is synced to the output timestamp instead.
   */
  private audibleTime(): number {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
      return ts.contextTime + Math.max(0, (performance.now() - ts.performanceTime) / 1000);
    }
    return this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
  }

  /** Output latency in ms, for display. */
  get latencyMs(): number {
    return Math.round(((this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0)) * 1000);
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  // ── Sources ───────────────────────────────────────────────────────────

  private teardown(): void {
    this.stopNode();
    this._playing = false;
    this.pausedAt = 0;
    this.external?.destroy();
    this.external = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.streamNode?.disconnect();
    this.streamNode = null;
    for (const n of this.liveNodes) n.disconnect();
    this.liveNodes = [];
    this.liveFeed = null;
    this.buffer = null;
    this.mono = null;
    this.analysis = null;
    this.beats = new Float32Array(0);
    this.feed = null;
    this.overview = null;
  }

  async loadBuffer(buffer: AudioBuffer, info: TrackInfo, beat: BeatSettings): Promise<void> {
    const token = ++this.loadToken;
    this.teardown();
    this.buffer = buffer;
    this.info = { ...info, duration: buffer.duration };
    this.mono = downmix(buffer);
    this.emit('track');
    this.emit('state');
    this.analysing = 0.001;
    this.emit('progress', 0);
    try {
      const an = await analyseMono(this.mono, buffer.sampleRate, (v) => {
        if (token !== this.loadToken) return;
        this.analysing = Math.max(0.001, v);
        this.emit('progress', v);
      });
      if (token !== this.loadToken) return;
      this.analysis = an;
      this.analysing = 0;
      this.beats = detectBeats(an, beat);
      this.feed = new FileFeed(an, this.mono, buffer.sampleRate, this.beats);
      this.emit('analysis');
      this.emit('beats');
    } catch (err) {
      this.analysing = 0;
      this.emit('error', err);
    }
  }

  async loadFile(file: File, beat: BeatSettings): Promise<void> {
    await this.resume();
    const data = await file.arrayBuffer();
    const buffer = await this.ctx.decodeAudioData(data);
    const name = file.name.replace(/\.[^.]+$/, '');
    const parts = name.split(' - ');
    const info: TrackInfo =
      parts.length >= 2
        ? { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), duration: buffer.duration, origin: 'file' }
        : { artist: 'Local file', title: name, duration: buffer.duration, origin: 'file' };
    await this.loadBuffer(buffer, info, beat);
  }

  updateBeats(beat: BeatSettings): void {
    if (this.analysis) {
      this.beats = detectBeats(this.analysis, beat);
      if (this.feed instanceof FileFeed) this.feed.beats = this.beats;
      this.emit('beats');
    }
    if (this.liveFeed) this.liveFeed.beatSettings = beat;
  }

  /** Microphone, or tab/system audio via screen-share. */
  async startLive(kind: 'mic' | 'tab', beat: BeatSettings, opts: { currentTab?: boolean; info?: TrackInfo } = {}): Promise<void> {
    await this.resume();
    let stream: MediaStream;
    if (kind === 'mic') {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } else {
      const constraints: DisplayMediaStreamOptions & Record<string, unknown> = {
        video: true,
        audio: { suppressLocalAudioPlayback: false } as MediaTrackConstraints,
        systemAudio: 'include',
        selfBrowserSurface: opts.currentTab ? 'include' : 'exclude',
        preferCurrentTab: !!opts.currentTab,
        surfaceSwitching: 'include',
      };
      stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error('No audio was shared. Tick “Share tab audio” (or “Share system audio”) in the browser dialog.');
      }
      // Only the sound is needed.
      stream.getVideoTracks().forEach((t) => (t.enabled = false));
    }
    const keepExternal = opts.currentTab ? this.external : null;
    const keepInfo = this.info;
    const keepOverview = this.overview;
    if (keepExternal) this.external = null; // don't destroy the embed we're listening to
    this.teardown();
    this.external = keepExternal;
    if (keepExternal) this.overview = keepOverview;
    this.stream = stream;
    this.streamNode = this.ctx.createMediaStreamSource(stream);
    this.liveFeed = await this.makeLiveFeed(this.streamNode, beat);
    this.feed = this.liveFeed;
    this.info =
      opts.info ??
      (keepExternal && keepInfo
        ? keepInfo
        : { title: kind === 'mic' ? 'Microphone' : 'Shared audio', artist: 'Live input', duration: 0, origin: kind });
    stream.getAudioTracks()[0].addEventListener('ended', () => this.stopLive());
    if (!this.external) {
      this._playing = true;
      this.liveStart = performance.now();
    }
    this.emit('track');
    this.emit('state');
  }

  /** Live analysis on the audio thread; falls back to an AnalyserNode. */
  private async makeLiveFeed(src: AudioNode, beat: BeatSettings): Promise<LiveFeed> {
    try {
      if (!this.workletLoaded) {
        await this.ctx.audioWorklet.addModule(liveWorkletUrl);
        this.workletLoaded = true;
      }
      const node = new AudioWorkletNode(this.ctx, 'klangbild-live', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      src.connect(node);
      // A silent path to the output keeps the node processing.
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(this.ctx.destination);
      this.liveNodes = [node, mute];
      return new LiveFeed({ kind: 'worklet', port: node.port }, beat);
    } catch (err) {
      console.warn('Live analysis worklet unavailable, using AnalyserNode', err);
      const analyser = this.ctx.createAnalyser();
      src.connect(analyser);
      this.liveNodes = [analyser];
      return new LiveFeed({ kind: 'analyser', analyser }, beat);
    }
  }

  stopLive(): void {
    if (!this.stream) return;
    this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.streamNode?.disconnect();
    this.streamNode = null;
    for (const n of this.liveNodes) n.disconnect();
    this.liveNodes = [];
    this.liveFeed = null;
    this.feed = null;
    if (!this.external) {
      this.pausedAt = this.time;
      this._playing = false;
    }
    this.emit('state');
  }

  get listening(): boolean {
    return !!this.stream;
  }

  /** Attach an embedded player (SoundCloud widget) as the transport. */
  attachExternal(transport: ExternalTransport, info: TrackInfo): void {
    this.teardown();
    this.external = transport;
    this.info = info;
    this.emit('track');
    this.emit('state');
  }

  updateExternalInfo(info: Partial<TrackInfo>, overview?: Float32Array): void {
    if (!this.info) return;
    Object.assign(this.info, info);
    if (overview) this.overview = overview;
    this.emit('track');
  }

  // ── Transport ─────────────────────────────────────────────────────────

  private stopNode(): void {
    if (this.node) {
      this.node.onended = null;
      try {
        this.node.stop();
      } catch {
        /* already stopped */
      }
      this.node.disconnect();
      this.node = null;
    }
  }

  async play(at?: number): Promise<void> {
    await this.resume();
    if (this.external) {
      this.external.play(at ?? this.external.time());
      this.emit('state');
      return;
    }
    if (this.stream) {
      if (!this._playing) {
        this._playing = true;
        this.liveStart = performance.now() - this.pausedAt * 1000;
      }
      this.emit('state');
      return;
    }
    if (!this.buffer) return;
    const offset = Math.max(0, Math.min(this.buffer.duration - 0.01, at ?? this.pausedAt));
    this.stopNode();
    const node = this.ctx.createBufferSource();
    node.buffer = this.buffer;
    node.connect(this.out);
    node.start(0, offset);
    node.onended = () => {
      if (this.node === node) {
        this._playing = false;
        this.pausedAt = this.buffer?.duration ?? 0;
        this.node = null;
        this.emit('state');
      }
    };
    this.node = node;
    this.startCtx = this.ctx.currentTime;
    this.startOffset = offset;
    this._playing = true;
    this.emit('state');
  }

  pause(): void {
    if (this.external) {
      this.external.pause();
      this.emit('state');
      return;
    }
    if (!this._playing) return;
    this.pausedAt = this.time;
    this._playing = false;
    this.stopNode();
    this.emit('state');
  }

  seek(t: number): void {
    if (this.external) {
      if (this.external.playing()) this.external.play(t);
      else {
        this.external.play(t);
        this.external.pause();
      }
      this.emit('state');
      return;
    }
    if (this.stream) return;
    if (this._playing) void this.play(t);
    else {
      this.pausedAt = Math.max(0, Math.min(this.duration, t));
      this.emit('state');
    }
  }

  setVolume(v: number): void {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** Mono samples for [t0, t1) for timeline drawing (file sources only). */
  monoRange(t0: number, t1: number): Float32Array | null {
    if (!this.mono || !this.buffer) return null;
    const sr = this.buffer.sampleRate;
    const a = Math.max(0, Math.floor(t0 * sr));
    const b = Math.min(this.mono.length, Math.floor(t1 * sr));
    return this.mono.subarray(a, Math.max(a, b));
  }
}
