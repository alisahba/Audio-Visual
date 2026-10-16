// Styled tooltips for every element with a title. The native title is moved
// to data-tip so the browser's own tooltip never doubles up. Tooltips appear
// after a short pause, then instantly while you move between controls.

const DELAY = 480;
const WARM = 700;

export function installTooltips(): void {
  const tip = document.createElement('div');
  tip.className = 'tip-pop';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let target: HTMLElement | null = null;
  let timer = 0;
  let hiddenAt = 0;

  const hide = () => {
    clearTimeout(timer);
    if (tip.classList.contains('on')) hiddenAt = performance.now();
    tip.classList.remove('on');
    target = null;
  };

  const place = (el: HTMLElement) => {
    const text = el.dataset.tip;
    if (!text || !el.isConnected) return;
    tip.replaceChildren(...text.split('\n').map((line, i) => {
      const d = document.createElement('div');
      d.textContent = line;
      if (i > 0) d.className = 'sub';
      return d;
    }));
    tip.classList.add('on');
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const hgt = tip.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    let top = r.bottom + 8;
    if (top + hgt > window.innerHeight - 8) top = r.top - hgt - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = (e.target as HTMLElement | null)?.closest?.('[title], [data-tip]') as HTMLElement | null;
    if (el === target) return;
    if (!el) return hide();
    if (el.hasAttribute('title')) {
      const t = el.getAttribute('title') ?? '';
      el.removeAttribute('title');
      if (t) el.dataset.tip = t;
      if (!el.getAttribute('aria-label') && t) el.setAttribute('aria-label', t.split('\n')[0]);
    }
    if (!el.dataset.tip) return hide();
    clearTimeout(timer);
    tip.classList.remove('on');
    target = el;
    const warm = performance.now() - hiddenAt < WARM;
    timer = window.setTimeout(() => target === el && place(el), warm ? 0 : DELAY);
  });
  document.addEventListener('pointerout', (e) => {
    if (target && !target.contains(e.relatedTarget as Node)) hide();
  });
  for (const ev of ['pointerdown', 'wheel', 'keydown', 'blur']) window.addEventListener(ev, hide, { capture: true, passive: true });
  document.addEventListener('scroll', hide, { capture: true, passive: true });
}
