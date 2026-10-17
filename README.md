# Inkplainer Desktop

A whiteboard animation maker for Windows: turn images and text into hand-drawn explainer
videos. It runs fully offline, renders on the GPU and exports smooth, frame-exact video.

It started as a desktop build of [Inkplainer](https://github.com/NadirWeb-App/Inkplainer-OS)
by NadirWeb-App and is now a fork that grows VideoScribe-style features on top of it.

**Download:** [latest release](https://github.com/otabekoff/inkplainer-desktop/releases/latest)
(setup `.exe` or `.msi`, Windows 10/11 x64).

## Features

**Making the video**
- **Templates:** start from a complete example video (Loops in TypeScript, A Book Explained, The
  Water Cycle, Startup Pitch) and make it yours.
- Drawing styles: scanner, contour, chunks, outline + fill (several stroke and colour styles),
  subject-aware orders (human, animal, portrait, vehicle, building, landscape, spiral).
- Entrances: move in (the hand carries the element in), fade in, pop in, drop in.
- 12 built-in presets (Marker Pro, Pencil Sketch, Watercolor, Chalk Talk, Blueprint Ink, …);
  a preset can set the background too.
- **Scenes** with transitions: cut, crossfade, dip to white/black, push, wipe, zoom, circle
  reveal; each scene has its own layers, background, hold time and undo history.
- **Camera** that follows the drawing: zooms and pans to each element, follows the pen across
  big ones, zooms out at the end. Per layer: auto, close-up or wide. Can be previewed in the editor.
- **Timeline** of each scene: reorder steps, make layers play together, add pauses; each step
  shows how long it takes, timed automatically.
- 19 background presets (whiteboard, paper, notebook, graph, dot grid, chalkboard, blueprint,
  kraft, cork, gradients, …) and image backgrounds (cover, fit, stretch, tile, with a wash).

**Editing**
- Zoom (Ctrl+wheel, Ctrl +/−/0/1) and pan (Hand tool, H, or middle mouse button); Select tool (V).
- Paste images or text with Ctrl+V; drop images anywhere, they land where dropped.
- Layer actions: edit text, replace image, flip, duplicate.

**Output**
- MP4 (H.264) or WebM (VP9) at 24, 30 or 60 fps; canvas sizes 720p, 1080p, 2K and 4K in
  16:9, 9:16 and 1:1; export at the canvas size or smaller (a 4K canvas exported at 1080p keeps
  camera close-ups sharp).
- Frame-exact: the movie is rendered frame by frame on a virtual clock, so no frame is dropped
  and the video plays exactly like the preview, at the same speed on any monitor.
- GPU: uses the discrete GPU on laptops with two, and the hardware video encoder, falling back
  to the CPU only when there is none.
- Play movie previews every scene with transitions and camera, from the same renderer; or play
  from any scene.
- After saving, a dialog offers Play video and Show in folder.

## Building

Needs [Rust](https://rustup.rs), [Bun](https://bun.sh) and Node.js.

```sh
git clone https://github.com/otabekoff/inkplainer-desktop.git
cd inkplainer-desktop
bun install
bun run app      # run in dev mode
bun run build    # installers in src-tauri/target/release/bundle/{nsis,msi}
```

`bun run vendor` re-downloads the fonts and muxers in `vendor/` (only needed when changing them).

## Layout

| Path | What |
| --- | --- |
| `app/` | The web app: Inkplainer's page and engine (`index.html`, `animations.js`) |
| `app/features/` | Everything added in the fork, one module per feature (scenes, camera, timeline, export, …) |
| `vendor/` | Offline copies of the fonts and the mp4/webm muxers |
| `desktop/` | The window chrome: title bar and Save dialog |
| `scripts/` | `build-web.mjs` assembles `dist/` and checks nothing is loaded online; `vendor.mjs` |
| `src-tauri/` | The Tauri shell: window, GPU switches, Save dialog, single instance |

Projects are stored in the app's WebView storage (`%LOCALAPPDATA%\uz.nurafshon.inkplainer`); keep
the identifier in `tauri.conf.json` unchanged or saved projects will not be found.

## License

Apache 2.0, like Inkplainer. Inkplainer is by [NadirWeb-App](https://github.com/NadirWeb-App);
fonts are from Google Fonts (SIL Open Font License / Apache 2.0); mp4-muxer and webm-muxer are MIT.
