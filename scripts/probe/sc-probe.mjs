// Diagnostic: drive the live site's SoundCloud flow in real Chrome on a CI runner.
import { chromium } from 'playwright';

const URL = process.env.SITE || 'https://alisahba.github.io/Audio-Visual/';
const TRACK = process.env.TRACK || 'https://soundcloud.com/forss/flickermood';

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--autoplay-policy=no-user-gesture-required', '--auto-accept-this-tab-capture', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const log = (...a) => console.log('[probe]', ...a);
const seenC = new Set();
page.on('console', (m) => { const t = m.text().slice(0, 300); if (seenC.has(t)) return; seenC.add(t); log(`console.${m.type()}:`, t); });
page.on('framenavigated', (f) => log('frame:', f.url().slice(0, 140)));
const seen = new Set();
page.on('pageerror', (e) => { if (seen.has(e.message)) return; seen.add(e.message); log('pageerror:', e.message, '\n', e.stack); });
page.on('requestfailed', (r) => log('requestfailed:', r.url().slice(0, 120), r.failure()?.errorText));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.klangbild, null, { timeout: 30000 });
await page.click('.tabs >> text=SoundCloud');
await page.fill('input[aria-label="SoundCloud track link"]', TRACK);
await page.locator('button:visible', { hasText: /^Load$/ }).click();
await page.waitForTimeout(12000);
log('after load', JSON.stringify(await page.evaluate(() => ({ kind: window.klangbild.engine.kind, info: window.klangbild.engine.info, overview: !!window.klangbild.engine.overview, toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent) }))));
// Watch raw widget messages arriving in the page.
await page.evaluate(() => { window.__scmsgs = []; window.addEventListener('message', (e) => { if (window.__scmsgs.length < 15) window.__scmsgs.push(String(e.origin) + ' ' + (typeof e.data === 'string' ? e.data : JSON.stringify(e.data)).slice(0, 200)); }); });
await page.keyboard.press('Space');
await page.waitForTimeout(10000);
log('after play', JSON.stringify(await page.evaluate(() => {
  const k = window.klangbild;
  const out = { kind: k.engine.kind, listening: k.engine.listening, playing: k.engine.playing, time: k.engine.time, toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent) };
  const an = k.engine.liveFeed?.analyser;
  if (an) {
    const td = new Float32Array(2048);
    an.getFloatTimeDomainData(td);
    out.rms = Math.sqrt(td.reduce((s, v) => s + v * v, 0) / td.length);
  }
  out.level = k.sim.features.level;
  out.msgs = window.__scmsgs;
  return out;
})));
await page.screenshot({ path: 'probe.png' });
await browser.close();
// rerun 1792073398
