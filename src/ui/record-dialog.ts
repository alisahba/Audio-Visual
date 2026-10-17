// After a real-time recording: preview it, choose size, quality and sound,
// then save. The recording itself is a high-quality master, so "Original"
// saves instantly and the other options re-encode it.

import { transcodeRecording } from '../export/exporter';
import { segmented } from './controls';
import { check } from './controls';
import { download, fmtTime, h, icon, toast } from './dom';

const KEY = 'klangbild.record.v1';
const SIZES = [
  { id: 0, label: 'As recorded' },
  { id: 2160, label: '4K' },
  { id: 1080, label: '1080p' },
  { id: 720, label: '720p' },
];
const QUALITY = [
  { id: 'std', label: 'Standard', bpp: 0.1 },
  { id: 'high', label: 'High', bpp: 0.2 },
  { id: 'max', label: 'Max', bpp: 0.38 },
];

export function showRecordDialog(blob: Blob, info: { width: number; height: number; seconds: number; hasAudio: boolean }): void {
  let s = { size: 0, quality: 'high', audio: true };
  try {
    s = { ...s, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    /* defaults */
  }
  const save = () => localStorage.setItem(KEY, JSON.stringify(s));
  const url = URL.createObjectURL(blob);
  const video = h('video', { src: url, controls: true, playsInline: true, loop: true, class: 'rec-video' }) as HTMLVideoElement;
  const bar = h('i', { style: 'width:0%' });
  const status = h('div', { class: 'note' });
  const summary = h('div', { class: 'note' });
  const abort = new AbortController();
  let busy = false;

  const dims = () => {
    const short = Math.min(info.width, info.height);
    const k = s.size && s.size < short ? s.size / short : 1;
    return [Math.round((info.width * k) / 2) * 2, Math.round((info.height * k) / 2) * 2];
  };
  const bitrate = () => {
    const [w, hh] = dims();
    const bpp = QUALITY.find((q) => q.id === s.quality)?.bpp ?? 0.2;
    return Math.round(w * hh * 30 * bpp);
  };
  const refresh = () => {
    const [w, hh] = dims();
    const mb = ((bitrate() + (s.audio && info.hasAudio ? 192_000 : 0)) * info.seconds) / 8 / 1e6;
    summary.textContent = `${w} × ${hh} · ${fmtTime(info.seconds, 1)} · about ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB${info.hasAudio ? (s.audio ? ' · with sound' : ' · silent') : ' · no sound was recorded'}`;
  };
  const sizeSeg = segmented<number>({ options: SIZES.map((x) => ({ value: x.id, label: x.label })), value: s.size, onChange: (v) => ((s.size = v), save(), refresh()) });
  const qualSeg = segmented<string>({ options: QUALITY.map((x) => ({ value: x.id, label: x.label })), value: s.quality, onChange: (v) => ((s.quality = v), save(), refresh()) });
  const audio = check(s.audio, (v) => ((s.audio = v), save(), refresh()), 'Include sound');
  const field = (label: string, el: HTMLElement) => h('div', { class: 'field' }, h('div', { class: 'label' }, label), h('div', null, el));

  const name = `klangbild-recording-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.mp4`;
  const saveBtn = h('button', { type: 'button', class: 'btn primary', style: 'height:36px' }, 'Save MP4') as HTMLButtonElement;
  const discardBtn = h('button', { type: 'button', class: 'btn', style: 'height:36px' }, 'Discard') as HTMLButtonElement;
  const close = () => {
    abort.abort();
    URL.revokeObjectURL(url);
    back.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) {
      e.stopPropagation();
      close();
    }
    e.stopPropagation();
  };
  saveBtn.onclick = async () => {
    if (busy) return;
    // As recorded with sound needs no re-encode.
    if (!s.size && s.quality === 'max' && (s.audio || !info.hasAudio)) {
      download(blob, name);
      toast('Recording saved.');
      return close();
    }
    busy = true;
    saveBtn.disabled = true;
    status.textContent = 'Encoding…';
    try {
      const out = await transcodeRecording(blob, { short: s.size, bitrate: bitrate(), audio: s.audio }, (v) => {
        bar.style.width = `${Math.round(v * 100)}%`;
        status.textContent = `Encoding ${Math.round(v * 100)}%`;
      }, abort.signal);
      download(out, name);
      toast('Recording saved.');
      close();
    } catch (err) {
      busy = false;
      saveBtn.disabled = false;
      if (abort.signal.aborted) return;
      status.textContent = '';
      toast(`Couldn’t encode: ${(err as Error).message}. Saving the original instead.`, 'error', 7000);
      download(blob, name);
    }
  };
  discardBtn.onclick = () => {
    if (busy) abort.abort();
    close();
  };

  const main = h(
    'div',
    { class: 'm-main' },
    h('h2', null, 'Save recording'),
    h('p', { class: 'lede' }, 'Recorded in real time, exactly as you saw and heard it. Choose how to save it.'),
    field('Size', sizeSeg.el),
    field('Quality', qualSeg.el),
    info.hasAudio ? field('Sound', audio.el) : h('div'),
    h('div', { class: 'note', style: 'margin-top:10px' }, '“As recorded” at Max quality saves instantly; anything else is re-encoded in your browser.'),
  );
  const side = h(
    'div',
    { class: 'm-side' },
    h('div', { class: 'preview' }, video),
    summary,
    h('div', { class: 'bigbar' }, bar),
    status,
    h('div', { class: 'hstack' }, saveBtn, discardBtn),
  );
  const closeBtn = h('button', { type: 'button', class: 'btn icon ghost close-x', 'aria-label': 'Close', onclick: () => !busy && close() }, icon('close'));
  const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Save recording', style: 'position:relative' }, main, side, closeBtn));
  document.body.appendChild(back);
  window.addEventListener('keydown', onKey, true);
  refresh();
}
