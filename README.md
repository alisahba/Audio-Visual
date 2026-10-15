# Klangbild

An audio-reactive abstract visual instrument for the web. Load a track, pick the part of the song you want, shape how the sound drives colour, motion and texture, and export MP4 or PNG/JPEG sequences.

The interface follows the International Typographic Style: a strict grid, hairline rules, one sans-serif family, numbered sections and a single red accent.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

`npm run build` writes a static site to `dist/` that can be hosted anywhere (it uses relative paths). A GitHub Pages workflow is included in `.github/workflows/pages.yml`: in the repository settings set **Pages → Source → GitHub Actions**, and every push to `main` publishes the app.

Use **Chrome or Edge** for the full feature set (H.264 MP4 export, writing image sequences straight into a folder, sharing tab/system audio). Firefox and Safari run the instrument; their export and capture options are narrower (see *Browser support*).

## How it works

The panels are numbered in signal-flow order:

| | Section | What it does |
|---|---|---|
| 01 | **Source** | A local audio file (fully analysed), a Spotify or SoundCloud track (played in their official players), or live input (microphone, a browser tab, or the whole system). |
| 02 | **Response** | Where beats come from and how strongly the sound pushes the picture. Drag the red window over the live spectrum to choose the frequencies that trigger beats (kick, snare, hats or any custom band), or lock beats to the detected tempo. Set the reactivity, low/mid/high gains, attack and release. |
| 03 | **Emit** | What paints colour in: *Orbs*, *Spectrum* (strata, columns, radial, horizon), *Waveform*, *Beat Ink* (each beat drops a new colour that bleeds outward) and *Cloud*. |
| 04 | **Motion** | How paint moves: a real *Fluid* simulation, a curl-noise *Flow Field*, directional *Drift* with per-column streaks, and *Zoom / Spin* feedback. They all mix into one velocity field. |
| 05 | **Time** | *Hold* keeps colour at full strength, then it *fades out* over the time you set, so the canvas never gets overloaded. *Bleed* lets colours diffuse into each other. *Fade in* eases the clip in. |
| 06 | **Colour** | Five-colour palette and ground colour (or take colours from the track artwork), blend mode, direct / gradient-map / spectral mapping, and when a new colour arrives (every beat, every bar, over time). |
| 07 | **Post** | Mirror and kaleidoscope, pixel stretch, glitch, RGB split, soft focus, glow, contour lines, dither/halftone, film grain, vignette. |

Every effect has an **audio drive** chip: choose Low, Mid, High, Level or Beat and a depth, and that part of the sound modulates the effect's main parameter. A red tick on the slider shows the live, modulated value.

**Presets** (keys 1–8) are starting points modelled on the reference images: *Ember, Capsule, Pastel Melt, Thermal, Marble, Paper Bleed, Halo, Pixel Rain*.

### Choosing the part of the song

The **Song** strip shows the whole track. The red window is your clip:

- drag it to move, drag its edges to change the length, or click anywhere to start the clip there;
- it snaps to detected beats (hold Alt to move freely);
- **Find the drop** jumps to the most energetic stretch, and the numbered buttons cycle through the top three highlights;
- the default length is 30 s; type any length or use 10 / 15 / 30 / 60.

The **Clip** lane below zooms into the window, with the waveform, beat markers and a playhead you can scrub.

## Export

Export renders **offline, frame by frame**, at a fixed 60 Hz simulation step, so the result does not depend on how fast your computer is and matches the preview.

- **MP4**: H.264 (or HEVC/VP9/AV1 if H.264 isn't available) via WebCodecs, with the clip's audio as AAC or Opus. 720p up to 4K, 24–60 fps, three quality levels.
- **PNG / JPEG sequence**: written straight into a folder you choose (Chrome/Edge), or as one ZIP.
- **Still**: the frame at the playhead at full resolution. `S` saves a quick snapshot of the preview.
- **Warm-up** runs the simulation for a moment before the first frame so the clip doesn't open on an empty canvas.

Live, Spotify and SoundCloud sources can't be rendered offline, because their audio only exists while it plays. For those, **Record** captures the canvas in real time to MP4 (video only).

## Spotify and SoundCloud: what is and isn't possible

Neither service lets a web page (or a desktop app) read the audio of its streams.

- **Spotify** streams are DRM-protected, and the Web API returns metadata only. Its *audio-analysis* and *preview* endpoints were also switched off for new apps in 2024. Spotify's developer terms also forbid syncing its recordings to video. So Klangbild uses Spotify for **search** (your own free developer app, Client ID only, no server needed) and plays the track in the **official Spotify embed**. The visuals then react to the sound by **capturing this browser tab's audio**. Logged out, the embed plays 30-second previews.
- **SoundCloud** API keys require an approved app and a server to hold the secret. The keyless route used here is: paste a track link, play it in the **official widget**, and capture the tab audio. Klangbild also reads SoundCloud's public waveform for the song strip when it can.

To export a finished video of a song, load the audio file itself (a track you own or have the rights to). You then get full analysis, beat markers, the drop finder and frame-accurate MP4 export with sound.

### Spotify search setup (optional, 2 minutes)

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → **Create app**, tick **Web API**.
2. Add the Redirect URI shown in the Spotify tab (the address you run Klangbild from, e.g. `http://127.0.0.1:5173/`).
3. Paste the app's **Client ID** into the Spotify tab and press **Connect**.

## Web or Windows app?

The web is the right platform for this:

- **GPU**: WebGL2 runs the whole pipeline (fluid simulation, feedback, post effects) in shaders, which is the same kind of work TouchDesigner does.
- **Analysis**: an FFT in a Web Worker analyses a full song in about a second.
- **Export**: WebCodecs encodes H.264 MP4 faster than real time, and the File System Access API writes image sequences straight to disk.
- **Reach**: it runs on any machine with a modern browser and can be shared as a link.

A native Windows build (for example the same code wrapped in Tauri or Electron) would add only these:

- system-wide audio capture without the browser's share dialog;
- ProRes or alpha-channel exports through FFmpeg;
- no browser memory limits for very long 4K exports.

It would **not** unlock Spotify or SoundCloud audio, because those limits are DRM and licensing, not the web. If those extras ever matter, the codebase can be wrapped later without a rewrite.

## Browser support

| | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| Visuals, analysis, presets | ✓ | ✓ | ✓ |
| MP4 export | ✓ H.264 + AAC | ✓ VP9/AV1 + Opus | ✓ H.264 + AAC |
| Image sequence into a folder | ✓ | ZIP only | ZIP only |
| Tab audio capture | ✓ | — | — |
| System audio capture | ✓ Windows / ChromeOS | — | — |
| Microphone | ✓ | ✓ | ✓ |

## Shortcuts

`Space` play/pause · `R` back to clip start · `C` clear canvas · `← →` seek (Shift: 5 s) · `E` export · `S` snapshot · `F` fullscreen · `1–8` presets · `Ctrl/Cmd Z` undo (Shift: redo) · Shift-drag a slider for fine control · double-click a slider to reset it.

Projects autosave in the browser. Use the save/open icons to keep `.klangbild.json` project files.

## Code map

```
src/
  audio/      analysis worker (FFT, 32 log bands, tempo), beat detection, features, engine, demo synth
  render/     WebGL2 helpers, shaders, renderer (fluid + paint + post), fixed-step simulation driver
  export/     offline exporter (mediabunny MP4, PNG/JPEG via folder or ZIP) and real-time recorder
  sources/    Spotify (PKCE search + embed) and SoundCloud (widget)
  state/      effect definitions, project model, presets, undo store
  ui/         panels, controls, timeline, export dialog
```
