// Render the preset previews shown in the Presets panel.
//
//   npm run dev                                  # in another terminal
//   node scripts/render-previews.cjs [ids…]      # all presets, or just some
//
// Needs Playwright (with a Chromium) and ffmpeg on the PATH. Each preset is
// rendered offline over the demo track with the app's own exporter, then ffmpeg
// turns it into a seamless 4-second H.264 loop plus a WebP poster in
// public/presets/.

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL = process.env.KLANGBILD_URL || 'http://127.0.0.1:5173/';
const OUT = path.join(__dirname, '..', 'public', 'presets');
const W = 240;
const H = 300;
const FPS = 30;
const SECONDS = 5; // 4 s loop + 1 s crossfade
const CLIP_START = 31.2; // the demo's drop

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', (e) => console.error(`[page] ${e.message}`));
  await page.goto(URL);
  await page.waitForFunction(() => window.klangbild && window.klangbild.engine.analysis, null, { timeout: 120000 });
  await page.evaluate(() => (window.klangbild.debug.paused = true));
  const ids = await page.evaluate(async () => (await import('/src/state/presets.ts')).PRESETS.map((p) => p.id));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klangbild-previews-'));

  for (const id of ids) {
    if (only.length && !only.includes(id)) continue;
    const t0 = Date.now();
    const b64 = await page.evaluate(
      async ({ id, W, H, FPS, SECONDS, CLIP_START }) => {
        const { runExport } = await import('/src/export/exporter.ts');
        const { PRESETS, applyPreset } = await import('/src/state/presets.ts');
        const k = window.klangbild;
        const preset = PRESETS.find((p) => p.id === id);
        k.store.update('all', (p) => {
          applyPreset(p, preset);
          p.clip.start = CLIP_START;
          p.clip.duration = SECONDS;
          p.aspect = '4:5';
          p.seed = 7;
        });
        const res = await runExport(
          { format: 'mp4', width: W, height: H, fps: FPS, bitrate: 6e6, jpegQuality: 0.9, includeAudio: false, preroll: 2, destination: 'zip', stillTime: 0 },
          k.engine,
          k.store.p,
          () => {},
          new AbortController().signal,
        );
        const buf = new Uint8Array(await res.blob.arrayBuffer());
        let s = '';
        for (let j = 0; j < buf.length; j += 0x8000) s += String.fromCharCode(...buf.subarray(j, j + 0x8000));
        return btoa(s);
      },
      { id, W, H, FPS, SECONDS, CLIP_START },
    );
    const raw = path.join(tmp, `${id}.raw.mp4`);
    fs.writeFileSync(raw, Buffer.from(b64, 'base64'));
    const mp4 = path.join(OUT, `${id}.mp4`);
    // Crossfade the last second into the first so the loop has no seam.
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', raw,
      '-filter_complex',
      `[0:v]split[a][b];[a]trim=0:1,setpts=PTS-STARTPTS[head];[b]trim=1:${SECONDS},setpts=PTS-STARTPTS[body];[body][head]xfade=transition=fade:duration=1:offset=${SECONDS - 2},format=yuv420p[v]`,
      '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-profile:v', 'main', '-movflags', '+faststart', mp4,
    ]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1.6', '-i', mp4, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', path.join(OUT, `${id}.webp`)]);
    const kb = (f) => Math.round(fs.statSync(f).size / 1024);
    console.log(`${id.padEnd(12)} ${((Date.now() - t0) / 1000).toFixed(0)} s · ${kb(mp4)} KB mp4 · ${kb(path.join(OUT, `${id}.webp`))} KB webp`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  await browser.close();
})();
