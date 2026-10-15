// Spotify: search via the Web API (Authorization Code + PKCE, client ID only)
// and playback through the official Embed IFrame API. Spotify does not expose
// raw audio, so visuals are driven by capturing this tab's sound.

import type { ExternalTransport } from '../audio/engine';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const K_CLIENT = 'klangbild.spotify.client';
const K_TOKEN = 'klangbild.spotify.token';
const K_VERIFIER = 'klangbild.spotify.verifier';
const K_STATE = 'klangbild.spotify.state';

interface TokenSet {
  access: string;
  refresh?: string;
  expires: number;
}

export interface SpotifyTrack {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  art?: string;
  artSmall?: string;
  link: string;
}

export function redirectUri(): string {
  return location.origin + location.pathname;
}

export function clientId(): string {
  try {
    return localStorage.getItem(K_CLIENT) ?? '';
  } catch {
    return '';
  }
}

export function setClientId(id: string): void {
  localStorage.setItem(K_CLIENT, id.trim());
}

function readToken(): TokenSet | null {
  try {
    const raw = localStorage.getItem(K_TOKEN);
    return raw ? (JSON.parse(raw) as TokenSet) : null;
  } catch {
    return null;
  }
}

function saveToken(t: TokenSet | null): void {
  if (t) localStorage.setItem(K_TOKEN, JSON.stringify(t));
  else localStorage.removeItem(K_TOKEN);
}

export function isConnected(): boolean {
  return !!readToken();
}

export function disconnect(): void {
  saveToken(null);
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(n: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const v = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(v, (x) => chars[x % chars.length]).join('');
}

export async function login(): Promise<void> {
  const id = clientId();
  if (!id) throw new Error('Add your Spotify Client ID first.');
  const verifier = randomString(64);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = randomString(16);
  sessionStorage.setItem(K_VERIFIER, verifier);
  sessionStorage.setItem(K_STATE, state);
  const q = new URLSearchParams({
    client_id: id,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  location.href = `${AUTH_URL}?${q}`;
}

/** Finish the OAuth redirect if the URL carries a code. Returns true if a login completed. */
export async function handleRedirect(): Promise<boolean> {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (!code && !error) return false;
  const expected = sessionStorage.getItem(K_STATE);
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('error');
  history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
  if (error) throw new Error(`Spotify login was cancelled (${error}).`);
  if (!expected || expected !== state) throw new Error('Spotify login state mismatch — please try again.');
  const verifier = sessionStorage.getItem(K_VERIFIER) ?? '';
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Spotify token exchange failed (${res.status}).`);
  const j = await res.json();
  saveToken({ access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in - 60) * 1000 });
  sessionStorage.removeItem(K_VERIFIER);
  sessionStorage.removeItem(K_STATE);
  return true;
}

async function accessToken(): Promise<string> {
  const t = readToken();
  if (!t) throw new Error('Not connected to Spotify.');
  if (Date.now() < t.expires) return t.access;
  if (!t.refresh) {
    saveToken(null);
    throw new Error('Spotify session expired — connect again.');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: clientId() }),
  });
  if (!res.ok) {
    saveToken(null);
    throw new Error('Spotify session expired — connect again.');
  }
  const j = await res.json();
  const next = { access: j.access_token, refresh: j.refresh_token ?? t.refresh, expires: Date.now() + (j.expires_in - 60) * 1000 };
  saveToken(next);
  return next.access;
}

interface ApiTrack {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album: { name: string; images: { url: string; width: number }[] };
  external_urls: { spotify: string };
}

export async function search(q: string): Promise<SpotifyTrack[]> {
  const tok = await accessToken();
  const res = await fetch(`https://api.spotify.com/v1/search?${new URLSearchParams({ q, type: 'track', limit: '10' })}`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  if (res.status === 401) {
    saveToken(null);
    throw new Error('Spotify session expired — connect again.');
  }
  if (!res.ok) throw new Error(`Spotify search failed (${res.status}).`);
  const j = await res.json();
  return (j.tracks?.items ?? []).map((t: ApiTrack) => {
    const imgs = [...(t.album?.images ?? [])].sort((a, b) => a.width - b.width);
    return {
      id: t.id,
      uri: t.uri,
      title: t.name,
      artist: t.artists.map((a) => a.name).join(', '),
      album: t.album?.name ?? '',
      duration: t.duration_ms / 1000,
      art: imgs[imgs.length - 1]?.url,
      artSmall: imgs.find((i) => i.width >= 64)?.url ?? imgs[0]?.url,
      link: t.external_urls.spotify,
    };
  });
}

export function parseLink(s: string): string | null {
  const m = s.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]{10,})/) ?? s.match(/spotify:track:([A-Za-z0-9]{10,})/);
  return m ? m[1] : null;
}

export async function oembed(id: string): Promise<{ title: string; art?: string }> {
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${id}`)}`);
    if (!res.ok) throw new Error();
    const j = await res.json();
    return { title: j.title ?? 'Spotify track', art: j.thumbnail_url };
  } catch {
    return { title: 'Spotify track' };
  }
}

// ── Embed IFrame API ────────────────────────────────────────────────────

interface EmbedController {
  loadUri(uri: string): void;
  play(): void;
  pause(): void;
  resume(): void;
  seek(sec: number): void;
  destroy(): void;
  addListener(evt: string, cb: (e: { data: { position: number; duration: number; isPaused: boolean; isBuffering?: boolean } }) => void): void;
}
interface IFrameAPI {
  createController(el: HTMLElement, opts: Record<string, unknown>, cb: (c: EmbedController) => void): void;
}

let apiPromise: Promise<IFrameAPI> | null = null;
function loadApi(): Promise<IFrameAPI> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    (window as unknown as { onSpotifyIframeApiReady: (api: IFrameAPI) => void }).onSpotifyIframeApiReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://open.spotify.com/embed/iframe-api/v1';
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('Could not load the Spotify player.'));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

export async function createTransport(host: HTMLElement, uri: string, onUpdate: (duration: number) => void): Promise<ExternalTransport> {
  const api = await loadApi();
  const el = document.createElement('div');
  host.replaceChildren(el);
  const ctrl = await new Promise<EmbedController>((res) => api.createController(el, { uri, width: '100%', height: 152 }, res));
  let pos = 0;
  let paused = true;
  let stamp = performance.now();
  let started = false;
  ctrl.addListener('playback_update', (e) => {
    pos = e.data.position / 1000;
    paused = e.data.isPaused || !!e.data.isBuffering;
    stamp = performance.now();
    if (e.data.duration) onUpdate(e.data.duration / 1000);
  });
  return {
    play(at: number) {
      if (!started) {
        ctrl.play();
        started = true;
      } else ctrl.resume();
      ctrl.seek(at);
      pos = at;
      stamp = performance.now();
      paused = false;
    },
    pause() {
      ctrl.pause();
      paused = true;
    },
    time() {
      return paused ? pos : pos + (performance.now() - stamp) / 1000;
    },
    playing() {
      return !paused;
    },
    destroy() {
      try {
        ctrl.destroy();
      } catch {
        /* noop */
      }
      host.replaceChildren();
    },
  };
}
