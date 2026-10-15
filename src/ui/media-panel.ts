import type { MediaManager } from '../media/media';
import { store } from '../state/store';
import { h, icon, toast } from './dom';

/** Picker shown at the top of the Media card: file, camera, current source. */
export function mediaPanel(media: MediaManager): HTMLElement {
  const input = h('input', {
    type: 'file',
    accept: 'image/*,video/*',
    style: 'display:none',
    onchange: async () => {
      const f = input.files?.[0];
      input.value = '';
      if (!f) return;
      try {
        await media.loadFile(f);
        store.update('fx', (p) => (p.fx.media.on = true));
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    },
  }) as HTMLInputElement;
  const thumb = h('div', { class: 'media-thumb' });
  const name = h('div', { class: 'media-name' });
  const status = h('div', { class: 'note' });
  const remove = h('button', { type: 'button', class: 'btn icon ghost', title: 'Remove media', 'aria-label': 'Remove media', onclick: () => media.clear() }, icon('close'));
  const current = h('div', { class: 'media-current' }, thumb, h('div', { style: 'min-width:0;flex:1' }, name, status), remove);
  const camBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn small',
      onclick: async () => {
        try {
          await media.startCamera();
          store.update('fx', (p) => (p.fx.media.on = true));
        } catch (err) {
          const e = err as Error;
          toast(e.name === 'NotAllowedError' ? 'Camera access was blocked.' : e.message, 'error');
        }
      },
    },
    icon('camera'),
    'Camera',
  );
  const sync = () => {
    current.style.display = media.kind ? '' : 'none';
    thumb.style.backgroundImage = media.thumb ? `url(${media.thumb})` : '';
    name.textContent = media.kind === 'camera' ? 'Camera (live)' : media.name;
    status.textContent = media.status || (media.kind === 'camera' ? 'Pick a Subject below to show only hands, a face or a body.' : media.kind === 'video' ? 'Plays in step with the clip.' : '');
  };
  media.on('change', sync);
  media.on('status', sync);
  sync();
  return h(
    'div',
    { class: 'media-panel' },
    h(
      'div',
      { class: 'hstack' },
      h('button', { type: 'button', class: 'btn small', onclick: () => input.click() }, icon('open'), 'Image or video'),
      camBtn,
    ),
    current,
    h('div', { class: 'media-note' }, 'Hands, Face and Body are traced in your browser and drawn as soft shapes, never as footage. The first use downloads the tracking model (a few MB).'),
    input,
  );
}
