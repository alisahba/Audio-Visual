# Klangbild

An audio-reactive abstract visual instrument for the web. Load a track, pick the part of the song you want, shape how the sound drives colour, motion and texture, paint your own images, video or camera into it, and export MP4 or PNG/JPEG sequences.

The interface follows the International Typographic Style: a strict grid, hairline rules, one sans-serif family, numbered sections and a single red accent.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

`npm run build` writes a static site to `dist/` that can be hosted anywhere (it uses relative paths). Live at **https://alisahba.github.io/Audio-Visual/**. Every push to `main` rebuilds the `gh-pages` branch (`.github/workflows/pages.yml`), which GitHub Pages serves.

Use **Chrome or Edge** for the full feature set (H.264 MP4 export, writing image sequences straight into a folder, sharing tab/system audio). Firefox and Safari run the instrument; their export and capture options are narrower (see *Browser support*).

## How it works

The panels are numbered in signal-flow order:

| | Section | What it does |
|---|---|---|
| 01 | **Source** | A local audio file (fully analysed), a SoundCloud track (search or paste a link), or live input (microphone, a browser tab, or the whole system). |
| 02 | **Response** | Where beats come from and how strongly the sound pushes the picture. Drag the red window over the live spectrum to choose the frequencies that trigger beats (kick, snare, hats or any custom band), or switch to *Beat track* to lock to the detected tempo (every bar, half, beat, eighth or sixteenth). Set sensitivity, the minimum gap between hits (down to 20 ms), reactivity, low/mid/high gains, attack and release, and an A/V offset. |
| 03 | **Emit** | What paints colour in: *Orbs*, *Spectrum* (strata, columns, radial, horizon), *Waveform*, *Beat Ink* (each beat drops a new colour that bleeds outward), *Cloud*, and *Media* (your image, video or camera; see below). |
| 04 | **Motion** | How paint moves: a real *Fluid* simulation with buoyancy, a curl-noise *Flow Field* with detail and lean, directional *Drift* with per-column streaks, hardness and wobble, *Zoom / Spin* with twist around any centre, *Melt* (heavy paint drips in uneven columns) and *Ripple* (each beat sends a ring wave through the paint). They all mix into one velocity field. |
| 05 | **Time** | *Hold* keeps colour at full strength, then it *fades out* over the time you set, so the canvas never gets overloaded. *Bleed* lets colours diffuse into each other. *Fade in* eases the clip in. |
| 06 | **Colour** | Five-colour palette and ground colour, built-in palettes plus your own (see below), blend mode, direct / gradient-map / spectral mapping, and when a new colour arrives (every beat, every bar, over time). |
| 07 | **Post** | Mirror and kaleidoscope, pixel stretch, glitch, *Slices* (the image cut into sliding strips), *Pixelate*, RGB split, soft focus, *Liquid* (soft paint turned into solid shapes with crisp edges), *Sheen* (iridescent film with glowing ridges), glow, contour lines, dither/halftone, film grain, vignette. |

Each section folds away when you're not using it (click its header; Alt-click to keep only that one open), and shows a one-line summary while folded. The strip at the top of the effects column jumps to any section. Each effect card has a reset button.

Every effect has a **drive** chip. Pick Low, Mid, High, Level or Beat and a depth, and that part of the sound modulates the effect's main parameter. A red tick on the slider shows the live, modulated value. Two drives come from time rather than sound, like a time effector:

- **Time** rises steadily from the start to the end of the clip, so a look can build.
- **Wave** swings slowly every two bars of the track's tempo.

**Presets** (keys 1–9 and 0) are starting points modelled on the reference images: *Ember, Capsule, Pastel Melt, Thermal, Marble, Paper Bleed, Halo, Pixel Rain, Drip, Liquid Slice, Opal*.

### Small things

- **Double-click a slider's label** to set it to 0; double-click the slider itself to reset it to its default.
- **Custom palettes**: click a swatch to edit a colour, ⇄ reverses the order, the dice shuffles a new palette, and **Save** keeps the current one with the built-ins (right-click a saved palette to delete it).
- **Stage** (above the canvas) sets the space around the canvas to white, grey or black, or follows the light/dark theme.

### Images, video and the camera

The **Media** card in *Emit* paints your own material into the canvas, where it is advected, faded and coloured like the rest of the paint, never shown as a plain picture.

- **Image or video**: any image or video file. Video follows the clip, so preview and export match.
- **Camera**: your webcam, live.
- **Subject**: *Full frame*, or only the *Body*, *Hands* or *Face*. These are traced in the browser with MediaPipe and drawn as soft abstract shapes (the face with its eyes and mouth cut out, hands as palm and tapered fingers), never as footage. The tracking model (a few MB) downloads from Google the first time you use it; the frames stay on your machine.
- **Look**: mapped onto the *Palette*, *Tint*ed, a single *Ink* colour, or the *Original* colours. **Paint** sets whether it flows in all the time or lands on each beat or bar. **Key** drops dark areas, and *Scale*, *Offset* and *Video speed* place it.

Images and video export frame-accurately. The camera is sampled live while an export renders; to capture a performance in real time, use **Record**.

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

Live input and the SoundCloud player can't be rendered offline, because their audio only exists while it plays. For those, **Record** captures the canvas in real time to MP4 (video only). SoundCloud tracks loaded in full mode render offline like a file, but the exported video never includes SoundCloud's audio.

## SoundCloud

There are two ways to use SoundCloud.

**Full mode (recommended).** Register an app at [soundcloud.com/you/apps](https://soundcloud.com/you/apps), then paste its **Client ID** and **Client secret** into the SoundCloud tab and press **Connect**. Klangbild gets a token straight from SoundCloud (no server involved; the keys stay in your browser's local storage), and then:

- search works inside the app;
- tracks load as real audio, with the full waveform, beat detection, the drop finder and frame-accurate export (video only, without SoundCloud's audio).

Tracks the uploader has restricted to SoundCloud's own apps show as greyed out. Some tracks only offer a 30-second preview.

**Player mode (no keys).** Paste a track link. It plays in SoundCloud's **official widget**, and the visuals react by **listening to this browser tab** (press *Listen to this tab* and tick *Share tab audio*). If nothing comes through after a few seconds, Klangbild tells you.

### Beat detection

A file or full-mode track is analysed off the main thread:

- a fine 12-bands-per-octave filterbank;
- **SuperFlux** onset strength, which ignores vibrato and sustained notes;
- peak picking with an adaptive threshold, where the stronger hit wins inside the minimum gap;
- tempo by autocorrelation with a prior around 120 BPM, and a **dynamic-programming beat tracker** with downbeat estimation for *Beat track*.

Live input runs the same detector in an AudioWorklet. Playback compensates for the audio output latency. If your speakers or Bluetooth headphones still feel late, nudge **A/V offset**.

On synthetic test tracks, beat tracking is about 99% accurate and hits land within about 10 ms (`node scripts/eval-beats.sh`).

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

It would **not** unlock streaming-service audio such as Spotify's, because those limits are DRM and licensing, not the web. If those extras ever matter, the codebase can be wrapped later without a rewrite.

## Browser support

| | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| Visuals, analysis, presets | ✓ | ✓ | ✓ |
| MP4 export | ✓ H.264 + AAC | ✓ VP9/AV1 + Opus | ✓ H.264 + AAC |
| Image sequence into a folder | ✓ | ZIP only | ZIP only |
| Tab audio capture | ✓ | — | — |
| System audio capture | ✓ Windows / ChromeOS | — | — |
| Microphone | ✓ | ✓ | ✓ |
| Camera, hand / face / body tracking | ✓ | ✓ | ✓ |

## Shortcuts

`Space` play/pause · `R` back to clip start · `C` clear canvas · `← →` seek (Shift: 5 s) · `E` export · `S` snapshot · `F` fullscreen · `1–9`, `0` presets · `Ctrl/Cmd Z` undo (Shift: redo) · Shift-drag a slider for fine control · double-click a slider to reset it, or its label to set it to 0.

Projects autosave in the browser. Use the save/open icons to keep `.klangbild.json` project files.

## Code map

```
src/
  audio/      DSP (filterbank, SuperFlux), analysis worker (tempo, DP beat tracker), live AudioWorklet, beat picking, engine, demo synth
  render/     WebGL2 helpers, shaders, renderer (fluid + paint + post), fixed-step simulation driver
  export/     offline exporter (mediabunny MP4, PNG/JPEG via folder or ZIP) and real-time recorder
  sources/    SoundCloud API (search, resolve, stream decode) and widget player
  media/      image/video/camera input and MediaPipe hand, face and body tracking
  state/      effect definitions, project model, presets, undo store
  ui/         foldable sections, panels, controls, timeline, export dialog
```
