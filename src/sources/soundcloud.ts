// SoundCloud: paste a track link and play it through the official widget.
// Search needs a registered API app plus a server for the secret, so this
// keyless path uses links; visuals come from capturing this tab's audio.

import type { ExternalTransport } from '../audio/engine';

interface SCSound {
  title?: string;
  duration?: number;
  artwork_url?: string;
  waveform_url?: string;
  permalink_url?: string;
  user?: { username?: string; avatar_url?: string };
}

interface SCWidget {
  bind(evt: string, cb: (e?: { currentPosition?: number }) => void): void;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  getDuration(cb: (ms: number) => void): void;
  getCurrentSound(cb: (s: SCSound) => void): void;
  setVolume(v: number): void;
}

interface SCGlobal {
  Widget: ((el: HTMLIFrameElement) => SCWidget) & { Events: Record<string, string> };
}

export function isLink(s: string): boolean {
  return /^(https?:\/\/)?(www\.|m\.|on\.)?soundcloud\.com\/\S+/i.test(s.trim()) || /snd\.sc\//.test(s);
}

let apiPromise: Promise<SCGlobal> | null = null;
function loadApi(): Promise<SCGlobal> {
  const w = window as unknown as { SC?: SCGlobal };
  if (w.SC) return Promise.resolve(w.SC);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://w.soundcloud.com/player/api.js';
    s.async = true;
    s.onload = () => (w.SC ? resolve(w.SC) : reject(new Error('SoundCloud widget failed to load.')));
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('Could not load the SoundCloud player.'));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

export interface SoundInfo {
  title: string;
  artist: string;
  duration: number;
  art?: string;
  link?: string;
  waveform?: Float32Array;
}

/** Try to read SoundCloud's public waveform JSON for the song strip. */
async function fetchWaveform(url?: string): Promise<Float32Array | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url.replace(/\.png(\?.*)?$/, '.json'));
    if (!res.ok) return undefined;
    const j = await res.json();
    const samples: number[] = j.samples ?? [];
    const max = j.height || Math.max(1, ...samples);
    return Float32Array.from(samples, (v) => v / max);
  } catch {
    return undefined;
  }
}

export async function createTransport(host: HTMLElement, link: string, onInfo: (info: SoundInfo) => void): Promise<ExternalTransport> {
  const SC = await loadApi();
  const url = link.trim().startsWith('http') ? link.trim() : `https://${link.trim()}`;
  const iframe = document.createElement('iframe');
  // Some SoundCloud streams are protected; the player needs EME as well as autoplay.
  iframe.allow = 'autoplay; encrypted-media';
  iframe.height = '120';
  iframe.title = 'SoundCloud player';
  iframe.src = `https://w.soundcloud.com/player/?${new URLSearchParams({
    url,
    color: '#ff3b1d',
    auto_play: 'false',
    hide_related: 'true',
    show_comments: 'false',
    show_reposts: 'false',
    show_teaser: 'false',
    visual: 'false',
  })}`;
  host.replaceChildren(iframe);
  const widget = SC.Widget(iframe);
  const E = SC.Widget.Events;
  let pos = 0;
  let paused = true;
  let stamp = performance.now();
  let ready = false;
  const pending: (() => void)[] = [];
  const whenReady = (fn: () => void) => (ready ? fn() : pending.push(fn));

  widget.bind(E.READY, () => {
    ready = true;
    pending.splice(0).forEach((f) => f());
    widget.getCurrentSound(async (s) => {
      const info: SoundInfo = {
        title: s?.title ?? 'SoundCloud track',
        artist: s?.user?.username ?? 'SoundCloud',
        duration: (s?.duration ?? 0) / 1000,
        art: (s?.artwork_url ?? s?.user?.avatar_url)?.replace('-large', '-t500x500'),
        link: s?.permalink_url ?? url,
      };
      onInfo(info);
      const wf = await fetchWaveform(s?.waveform_url);
      if (wf) onInfo({ ...info, waveform: wf });
    });
  });
  widget.bind(E.PLAY_PROGRESS, (e) => {
    pos = (e?.currentPosition ?? 0) / 1000;
    stamp = performance.now();
  });
  widget.bind(E.PLAY, () => {
    paused = false;
    stamp = performance.now();
  });
  widget.bind(E.PAUSE, () => (paused = true));
  widget.bind(E.FINISH, () => (paused = true));
  widget.bind(E.ERROR, () => (paused = true));

  return {
    play(at: number) {
      whenReady(() => {
        widget.seekTo(at * 1000);
        widget.play();
      });
      pos = at;
      stamp = performance.now();
      paused = false;
    },
    pause() {
      whenReady(() => widget.pause());
      paused = true;
    },
    time() {
      return paused ? pos : pos + (performance.now() - stamp) / 1000;
    },
    playing() {
      return !paused;
    },
    destroy() {
      host.replaceChildren();
    },
  };
}
