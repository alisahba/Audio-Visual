// SoundCloud through the official API, using the user's own (free) app
// credentials. Everything runs in the browser: SoundCloud's token and API
// endpoints allow cross-origin requests. With a stream URL the track is decoded
// in full, so it gets the same analysis, beat detection and export as a file.

import { ALL_FORMATS, AudioBufferSink, Input, UrlSource } from 'mediabunny';

const K_ID = 'klangbild.sc.id';
const K_SECRET = 'klangbild.sc.secret';
const K_TOKEN = 'klangbild.sc.token';
const API = 'https://api.soundcloud.com';
const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';

export interface ScTrack {
  id: string;
  urn: string;
  title: string;
  artist: string;
  duration: number;
  art?: string;
  link: string;
  /** 'playable' (full track), 'preview' (30 s clip) or 'blocked'. */
  access: string;
}

interface Token {
  access: string;
  expires: number;
}

function read(k: string): string {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
}

export function credentials(): { id: string; secret: string } {
  return { id: read(K_ID), secret: read(K_SECRET) };
}

export function isConnected(): boolean {
  const c = credentials();
  return !!(c.id && c.secret);
}

export function saveCredentials(id: string, secret: string): void {
  localStorage.setItem(K_ID, id.trim());
  localStorage.setItem(K_SECRET, secret.trim());
  localStorage.removeItem(K_TOKEN);
}

export function disconnect(): void {
  for (const k of [K_ID, K_SECRET, K_TOKEN]) localStorage.removeItem(k);
}

async function token(force = false): Promise<string> {
  if (!force) {
    try {
      const t = JSON.parse(read(K_TOKEN) || 'null') as Token | null;
      if (t && Date.now() < t.expires) return t.access;
    } catch {
      /* ignore */
    }
  }
  const { id, secret } = credentials();
  if (!id || !secret) throw new Error('Connect your SoundCloud app first.');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json; charset=utf-8',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (res.status === 401 || res.status === 400) throw new Error('SoundCloud rejected the Client ID / Secret. Check them in your app settings.');
  if (!res.ok) throw new Error(`SoundCloud sign-in failed (${res.status}).`);
  const j = await res.json();
  const t: Token = { access: j.access_token, expires: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 120) * 1000 };
  localStorage.setItem(K_TOKEN, JSON.stringify(t));
  return t.access;
}

async function api(path: string, retry = true): Promise<unknown> {
  const tok = await token();
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    headers: { Accept: 'application/json; charset=utf-8', Authorization: `OAuth ${tok}` },
  });
  if (res.status === 401 && retry) {
    await token(true);
    return api(path, false);
  }
  if (res.status === 404) throw new Error('SoundCloud couldn’t find that track.');
  if (!res.ok) throw new Error(`SoundCloud request failed (${res.status}).`);
  return res.json();
}

interface ApiTrack {
  id: number | string;
  urn?: string;
  title?: string;
  duration?: number;
  artwork_url?: string | null;
  permalink_url?: string;
  access?: string;
  streamable?: boolean;
  user?: { username?: string; avatar_url?: string };
  kind?: string;
}

function toTrack(t: ApiTrack): ScTrack {
  const art = (t.artwork_url || t.user?.avatar_url || '').replace('-large', '-t500x500') || undefined;
  return {
    id: String(t.id),
    urn: t.urn ?? `soundcloud:tracks:${t.id}`,
    title: t.title ?? 'Untitled',
    artist: t.user?.username ?? 'SoundCloud',
    duration: (t.duration ?? 0) / 1000,
    art,
    link: t.permalink_url ?? '',
    access: t.access ?? (t.streamable === false ? 'blocked' : 'playable'),
  };
}

export async function search(q: string): Promise<ScTrack[]> {
  const j = (await api(`/tracks?${new URLSearchParams({ q, limit: '20', linked_partitioning: 'true', access: 'playable,preview' })}`)) as
    | ApiTrack[]
    | { collection?: ApiTrack[] };
  const list = Array.isArray(j) ? j : (j.collection ?? []);
  return list.filter((t) => !t.kind || t.kind === 'track').map(toTrack);
}

export async function resolve(link: string): Promise<ScTrack> {
  const url = link.trim().startsWith('http') ? link.trim() : `https://${link.trim()}`;
  const j = (await api(`/resolve?${new URLSearchParams({ url })}`)) as ApiTrack;
  if (j.kind && j.kind !== 'track') throw new Error('That link is a playlist or profile — paste a single track link.');
  return toTrack(j);
}

interface Streams {
  http_mp3_128_url?: string;
  hls_mp3_128_url?: string;
  hls_aac_160_url?: string;
  hls_opus_64_url?: string;
  preview_mp3_128_url?: string;
}

/**
 * Fetch and decode the whole track into an AudioBuffer. Tries the progressive
 * MP3 first, then the HLS renditions (demuxed and decoded with Mediabunny).
 */
export async function loadAudio(track: ScTrack, ctx: BaseAudioContext, onProgress?: (v: number) => void): Promise<{ buffer: AudioBuffer; preview: boolean }> {
  if (track.access === 'blocked') throw new Error('This track can’t be streamed outside SoundCloud.');
  const s = (await api(`/tracks/${encodeURIComponent(track.urn)}/streams`)) as Streams;
  const tok = await token();
  const auth = { Authorization: `OAuth ${tok}` };
  const errors: string[] = [];

  const progressive = s.http_mp3_128_url ?? (track.access === 'preview' ? s.preview_mp3_128_url : undefined);
  if (progressive) {
    try {
      const res = await fetch(progressive, { headers: auth });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await readWithProgress(res, onProgress);
      const buffer = await ctx.decodeAudioData(data);
      return { buffer, preview: track.access === 'preview' };
    } catch (err) {
      errors.push(`MP3: ${(err as Error).message}`);
    }
  }
  for (const hls of [s.hls_aac_160_url, s.hls_mp3_128_url, s.hls_opus_64_url]) {
    if (!hls) continue;
    try {
      const buffer = await decodeHls(hls, auth, ctx, onProgress);
      return { buffer, preview: track.access === 'preview' };
    } catch (err) {
      errors.push(`HLS: ${(err as Error).message}`);
    }
  }
  throw new Error(`SoundCloud didn’t provide a stream this browser can read (${errors.join('; ') || 'no stream URLs'}).`);
}

async function readWithProgress(res: Response, onProgress?: (v: number) => void): Promise<ArrayBuffer> {
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(0.99, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out.buffer;
}

async function decodeHls(url: string, headers: Record<string, string>, ctx: BaseAudioContext, onProgress?: (v: number) => void): Promise<AudioBuffer> {
  // The API URL redirects to a signed CDN playlist; resolve it once with auth.
  let target = url;
  try {
    const head = await fetch(url, { headers });
    if (head.ok) target = head.url || url;
  } catch {
    /* fall through and let Mediabunny try the API URL itself */
  }
  const input = new Input({ source: new UrlSource(target, target === url ? { requestInit: { headers } } : undefined), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('no audio track');
    const duration = await input.computeDuration();
    const sink = new AudioBufferSink(track);
    const parts: AudioBuffer[] = [];
    let len = 0;
    for await (const w of sink.buffers()) {
      parts.push(w.buffer);
      len += w.buffer.length;
      if (duration) onProgress?.(Math.min(0.99, (w.timestamp + w.duration) / duration));
    }
    if (!parts.length) throw new Error('no audio decoded');
    const sr = parts[0].sampleRate;
    const ch = parts[0].numberOfChannels;
    const out = ctx.createBuffer(ch, len, sr);
    let o = 0;
    for (const p of parts) {
      for (let c = 0; c < ch; c++) out.getChannelData(c).set(p.getChannelData(Math.min(c, p.numberOfChannels - 1)), o);
      o += p.length;
    }
    return out;
  } finally {
    input.dispose();
  }
}
