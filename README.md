# Inkplainer Desktop

[Inkplainer](https://github.com/NadirWeb-App/Inkplainer-OS), the free whiteboard animation maker, as an
offline Windows desktop app built with Tauri. The upstream code is used unmodified (a git submodule);
a build step patches a copy of it.

**Download:** [latest release](https://github.com/otabekoff/inkplainer-desktop/releases/latest)
(setup `.exe` or `.msi`, Windows 10/11 x64).

## What the desktop build adds

- **Fully offline.** Google Fonts, mp4-muxer and webm-muxer are bundled; nothing is loaded from the internet.
- **Smooth, frame-exact video.** Exports are rendered frame by frame at 60 fps on a virtual clock instead
  of being recorded in real time, so no frame is dropped and the video plays exactly like the preview.
  The preview itself runs at 60 animation steps per second on any monitor (in a browser it runs 4× too
  fast on a 240 Hz screen).
- **GPU rendering and encoding.** Canvas work runs on the GPU (the discrete one on laptops with two), and
  video is encoded with the GPU's hardware H.264 (MP4) or VP9 (WebM) encoder, falling back to the CPU
  only if there is none. The export dialog names the GPU in use.
- **Sharp output.** Bitrates scale with the resolution (High: about 20 Mbps at 1080p, 35 Mbps at 1440p),
  H.264 High profile, a keyframe every 2 seconds.
- **Custom title bar.** Inkplainer's own top bar drags the window (double-click maximizes) and carries
  minimize / maximize / close buttons; the window has no native frame.
- **Opens at its own size**, centered, even when launched from a maximized terminal or shortcut.
- **Exports go through a Save dialog** (videos default to Videos, PNGs to Pictures).

## Layout

| Path | What |
| --- | --- |
| `upstream/` | Inkplainer-OS, as a git submodule pinned to a commit |
| `vendor/` | Offline copies of fonts and the muxers (`bun run vendor`) |
| `desktop/` | Title bar, Save-dialog hook and the frame-exact exporter, injected into the page |
| `scripts/build-web.mjs` | Builds `dist/` from the three above |
| `src-tauri/` | The Tauri shell (window, GPU switches, Save dialog) |

## Building

Needs [Rust](https://rustup.rs), [Bun](https://bun.sh) and Node.js.

```sh
git clone --recurse-submodules https://github.com/otabekoff/inkplainer-desktop.git
cd inkplainer-desktop
bun install
bun run app      # run in dev mode
bun run build    # installers in src-tauri/target/release/bundle/{nsis,msi}
```

To move to a newer Inkplainer: `bun run setup --latest`, then `bun run build`. If upstream changed the
markup the patches rely on, `build-web.mjs` stops with a message saying which patch no longer matches.

Projects live in the app's WebView storage (`%LOCALAPPDATA%\uz.nurafshon.inkplainer`); keep the
identifier in `tauri.conf.json` unchanged or saved projects will not be found.

## License

Apache 2.0, like Inkplainer itself. Inkplainer is by [NadirWeb-App](https://github.com/NadirWeb-App);
fonts are from Google Fonts (SIL Open Font License / Apache 2.0); mp4-muxer and webm-muxer are MIT.
