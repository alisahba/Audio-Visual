// Palette generation: random harmonious schemes and extraction from artwork.

function hsl(hh: number, s: number, l: number): string {
  hh = ((hh % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export function rgbHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function randomPalette(): string[] {
  const base = Math.random() * 360;
  const schemes = [
    [0, 25, 50, 180, 200], // warm + complement
    [0, 30, 60, 90, 120], // analogous sweep
    [0, 120, 240, 60, 300], // triadic
    [0, 15, -20, 160, 35], // ember
    [0, 150, 210, 30, 330], // split
  ];
  const sc = schemes[Math.floor(Math.random() * schemes.length)];
  const vivid = Math.random() < 0.65;
  return sc.map((off, i) => {
    const s = vivid ? 0.75 + Math.random() * 0.25 : 0.35 + Math.random() * 0.3;
    const l = i === 3 ? 0.85 + Math.random() * 0.1 : vivid ? 0.5 + Math.random() * 0.12 : 0.72 + Math.random() * 0.12;
    return hsl(base + off + (Math.random() - 0.5) * 12, s, l);
  });
}

/** Five dominant, distinct colours of an image (k-means in RGB), brightest last. */
export async function paletteFromImage(url: string): Promise<string[]> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Artwork could not be loaded'));
    img.src = url;
  });
  const S = 48;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, S, S);
  const data = ctx.getImageData(0, 0, S, S).data; // throws if tainted
  const px: number[][] = [];
  for (let i = 0; i < data.length; i += 4) px.push([data[i], data[i + 1], data[i + 2]]);
  const K = 7;
  let cents = Array.from({ length: K }, (_, i) => px[Math.floor((i / K) * px.length)].slice());
  const counts = new Array(K).fill(0);
  for (let it = 0; it < 12; it++) {
    const sums = Array.from({ length: K }, () => [0, 0, 0]);
    counts.fill(0);
    for (const p of px) {
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k < K; k++) {
        const d = (p[0] - cents[k][0]) ** 2 + (p[1] - cents[k][1]) ** 2 + (p[2] - cents[k][2]) ** 2;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      sums[best][0] += p[0];
      sums[best][1] += p[1];
      sums[best][2] += p[2];
      counts[best]++;
    }
    cents = cents.map((c0, k) => (counts[k] ? sums[k].map((s) => s / counts[k]) : c0));
  }
  // Prefer colourful clusters, then pick 5 distinct ones.
  const scored = cents
    .map((c0, k) => {
      const mx = Math.max(...c0);
      const mn = Math.min(...c0);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      return { c: c0, score: counts[k] * (0.4 + sat), lum: 0.2126 * c0[0] + 0.7152 * c0[1] + 0.0722 * c0[2] };
    })
    .sort((a, b) => b.score - a.score);
  const picked: typeof scored = [];
  for (const s of scored) {
    if (picked.every((p) => Math.hypot(p.c[0] - s.c[0], p.c[1] - s.c[1], p.c[2] - s.c[2]) > 40)) picked.push(s);
    if (picked.length === 5) break;
  }
  while (picked.length < 5) picked.push(scored[picked.length % scored.length]);
  picked.sort((a, b) => a.lum - b.lum);
  return picked.map((p) => rgbHex(p.c[0], p.c[1], p.c[2]));
}
