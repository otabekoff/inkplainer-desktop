// Video export: renders the movie (features/movie.js) frame by frame and encodes it with
// WebCodecs, preferring the GPU's hardware encoder (H.264 for MP4, VP9 for WebM), falling
// back to the CPU. Frames are never dropped: rendering waits for the encoder.
(() => {
  const { native } = inkClock;
  const FPS_CHOICES = [24, 30, 60];
  const fpsOf = () => (FPS_CHOICES.includes(state.exportFps) ? state.exportFps : 60);

  // ── GPU detection ─────────────────────────────────────────────────────────
  function detectGpu() {
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      const raw = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      if (!raw) return { name: "Unknown", accelerated: false };
      // "ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Laptop GPU (0x00002F58) Direct3D11 vs_5_0 ps_5_0, D3D11)"
      const name = (raw.match(/ANGLE \([^,]+, (.+?)(?: \(0x[0-9A-Fa-f]+\))?(?: Direct3D.*)?, [^,]+\)$/)?.[1] ?? raw).trim();
      const accelerated = !/SwiftShader|Basic Render|llvmpipe|Software/i.test(raw);
      return { name, accelerated };
    } catch {
      return { name: "Unknown", accelerated: false };
    }
  }
  const gpu = detectGpu();
  window.inkplainerGpu = gpu;

  // ── Encoder choice ────────────────────────────────────────────────────────
  const QUALITY_BPP = { high: 0.16, medium: 0.09, low: 0.05 }; // bits per pixel per frame

  function bitrateFor(width, height, quality, fps) {
    const bpp = QUALITY_BPP[quality] ?? QUALITY_BPP.high;
    return Math.round(Math.max(2_000_000, width * height * fps * bpp));
  }

  // Smallest H.264 level whose macroblock rate and frame size fit (4K at 60 fps needs 5.2).
  function avcLevel(width, height, fps) {
    const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
    const levels = [
      [0x28, 245760, 8192], // 4.0
      [0x2a, 522240, 8704], // 4.2
      [0x32, 589824, 22080], // 5.0
      [0x33, 983040, 36864], // 5.1
      [0x34, 2073600, 36864], // 5.2
    ];
    const hit = levels.find(([, mbps, frame]) => mbs <= frame && mbs * fps <= mbps) ?? levels[levels.length - 1];
    return hit[0].toString(16).padStart(2, "0");
  }

  function codecsFor(format, width, height, fps) {
    if (format === "mp4") {
      const level = avcLevel(width, height, fps);
      return [
        { codec: `avc1.6400${level}`, muxer: "avc", label: "H.264" }, // High
        { codec: `avc1.4d00${level}`, muxer: "avc", label: "H.264" }, // Main
      ];
    }
    return [
      { codec: "vp09.00.51.08", muxer: "V_VP9", label: "VP9" },
      { codec: "vp8", muxer: "V_VP8", label: "VP8" },
    ];
  }

  async function pickEncoder(format, width, height, bitrate, fps, allowHardware) {
    const accels = allowHardware ? ["prefer-hardware", "no-preference"] : ["prefer-software"];
    for (const accel of accels) {
      for (const c of codecsFor(format, width, height, fps)) {
        const config = {
          codec: c.codec,
          width,
          height,
          bitrate,
          bitrateMode: "variable",
          framerate: fps,
          latencyMode: "quality",
          hardwareAcceleration: accel,
          contentHint: "detail",
          ...(c.muxer === "avc" ? { avc: { format: "avc" } } : {}),
        };
        try {
          const { supported } = await VideoEncoder.isConfigSupported(config);
          if (supported) return { config, ...c, hardware: accel === "prefer-hardware" };
        } catch {
          /* try the next one */
        }
      }
    }
    throw new Error(`This PC has no ${format.toUpperCase()} video encoder for ${width}×${height}`);
  }

  async function loadMuxer(format) {
    const mod = await import(format === "mp4" ? "../vendor/mp4-muxer.mjs" : "../vendor/webm-muxer.mjs");
    return { Muxer: mod.Muxer, ArrayBufferTarget: mod.ArrayBufferTarget };
  }

  // ── Export ────────────────────────────────────────────────────────────────
  class HardwareEncoderFailed extends Error {}

  // Output sizes: the canvas size, or a standard smaller size of the same shape. Drawing on
  // a bigger canvas than the video keeps camera close-ups sharp.
  const SIZE_NAMES = { 2160: "4K", 1440: "2K", 1080: "1080p", 720: "720p" };
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  function outputSizes() {
    const W = state.canvasW;
    const H = state.canvasH;
    const short = Math.min(W, H);
    const list = [{ key: "canvas", w: even(W), h: even(H), name: SIZE_NAMES[short] || `${W}×${H}` }];
    for (const s of [1440, 1080, 720]) {
      if (s < short) list.push({ key: String(s), w: even((W * s) / short), h: even((H * s) / short), name: SIZE_NAMES[s] });
    }
    return list;
  }
  const outputSize = () => outputSizes().find((o) => o.key === String(state.exportOutput)) || outputSizes()[0];

  async function render(format, progressText, progressBar, allowHardware) {
    const fps = fpsOf();
    const { w: W, h: H } = outputSize();
    const bitrate = bitrateFor(W, H, state.exportQuality, fps);
    const enc = await pickEncoder(format, W, H, bitrate, fps, allowHardware);
    const { Muxer, ArrayBufferTarget } = await loadMuxer(format);

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: enc.muxer, width: W, height: H, ...(format === "webm" ? { frameRate: fps } : {}) },
      ...(format === "mp4" ? { fastStart: "in-memory" } : {}),
    });

    let encoderError = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => (encoderError = e),
    });
    encoder.configure(enc.config);

    const where = enc.hardware ? `GPU (${gpu.name})` : "CPU";
    const mbps = (bitrate / 1e6).toFixed(0);
    const scenes = inkScenes.list.length;
    let progress = 0;
    let scene = 0;
    const status = () => {
      const what = scenes > 1 ? `scene ${scene + 1} of ${scenes}` : `${Math.round(progress * 100)}%`;
      progressText.textContent = `Rendering ${what} · ${enc.label} ${W}×${H} ${fps} fps, ${mbps} Mbps on ${where}`;
      progressBar.style.width = `${Math.round(progress * 95)}%`;
    };
    status();
    let lastBreath = native.perfNow();

    try {
      await inkMovie.render({
        fps,
        width: W,
        height: H,
        // Closing the export banner sets state.recording to false.
        cancelled: () => !state.recording,
        onProgress: (fraction, s) => {
          progress = fraction;
          scene = s;
        },
        onFrame: async (frameCanvas, { index }) => {
          if (encoderError) throw enc.hardware ? new HardwareEncoderFailed(encoderError.message) : encoderError;
          const frame = new VideoFrame(frameCanvas, {
            timestamp: Math.round((index * 1e6) / fps),
            duration: Math.round(1e6 / fps),
          });
          encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 });
          frame.close();
          // Wait for the encoder instead of dropping frames.
          while (encoder.encodeQueueSize > 6 && !encoderError) {
            await new Promise((resolve) => {
              encoder.addEventListener("dequeue", resolve, { once: true });
              native.setTimeout(resolve, 20);
            });
          }
          if (native.perfNow() - lastBreath > 60) {
            status();
            await inkClock.breathe();
            lastBreath = native.perfNow();
          }
        },
      });

      progressText.textContent = `Finishing ${format.toUpperCase()}…`;
      await encoder.flush();
      if (encoderError) throw encoderError;
      muxer.finalize();
      progressBar.style.width = "100%";
      return new Blob([target.buffer], { type: format === "mp4" ? "video/mp4" : "video/webm" });
    } finally {
      if (encoder.state !== "closed") encoder.close();
    }
  }

  async function exportVideo(format, progressText, progressBar) {
    let blob;
    try {
      blob = await render(format, progressText, progressBar, true);
    } catch (err) {
      if (!(err instanceof HardwareEncoderFailed)) throw err;
      console.warn("Hardware encoder failed, rendering again on the CPU:", err.message);
      blob = await render(format, progressText, progressBar, false);
    }
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    a.href = URL.createObjectURL(blob);
    a.download = `whiteboard-${stamp}.${format}`;
    a.click();
    native.setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }

  window.recordMP4 = (progressText, progressBar) => exportVideo("mp4", progressText, progressBar);
  window.recordWebM = (progressText, progressBar) => exportVideo("webm", progressText, progressBar);

  // ── Export dialog ─────────────────────────────────────────────────────────
  // MP4 always works here, so make it the default; show real bitrates and a frame-rate choice.
  if (!state.exportFormat) state.exportFormat = "mp4";
  state.exportQuality = "high";
  if (!state.exportFps) state.exportFps = 60;

  const FPS_LABELS = { 24: "Film look", 30: "Smaller file", 60: "Smoothest" };
  const setText = (sel, text) => {
    const el = document.querySelector(sel);
    if (el) el.textContent = text;
  };

  function refreshDialog() {
    const fps = fpsOf();
    const out = outputSize();
    for (const q of Object.keys(QUALITY_BPP)) {
      setText(`.quality-pill[data-quality="${q}"] .quality-pill-desc`, `${(bitrateFor(out.w, out.h, q, fps) / 1e6).toFixed(0)} Mbps`);
    }
    document.querySelectorAll(".fps-pill").forEach((p) => p.classList.toggle("selected", Number(p.dataset.fps) === fps));
    document.querySelectorAll(".size-out-pill").forEach((p) => p.classList.toggle("selected", p.dataset.size === out.key));
    const note = document.getElementById("gpu-note");
    if (note) {
      note.textContent = gpu.accelerated
        ? `${out.w}×${out.h}, frame-exact · GPU: ${gpu.name}`
        : `${out.w}×${out.h}, frame-exact · No GPU acceleration available; rendering on the CPU`;
    }
  }

  // A labelled row of pills after `after`, built from the Quality row's own markup so it matches.
  function pillSection(id, title, after) {
    let section = document.getElementById(id);
    if (section) return section.querySelector(".quality-pills");
    const model = document.querySelector(".quality-pills")?.parentElement;
    if (!model || !after) return null;
    section = model.cloneNode(false);
    section.id = id;
    const label = model.firstElementChild?.cloneNode(true);
    if (label && !label.classList.contains("quality-pills")) {
      label.textContent = title;
      section.appendChild(label);
    }
    const pills = document.createElement("div");
    pills.className = "quality-pills";
    section.appendChild(pills);
    after.after(section);
    return pills;
  }

  // Adds the GPU line under the format pills, then Frame rate and Output size rows after Quality.
  function ensureDialogControls() {
    if (!document.getElementById("gpu-note")) {
      const note = document.createElement("div");
      note.id = "gpu-note";
      document.querySelector(".format-pills")?.parentElement?.appendChild(note);
    }
    const quality = document.querySelector(".quality-pills")?.parentElement;
    const fpsPills = pillSection("fps-section", "Frame rate", quality);
    if (fpsPills && !fpsPills.childElementCount) {
      fpsPills.innerHTML = FPS_CHOICES.map(
        (f) =>
          `<div class="quality-pill fps-pill" data-fps="${f}"><div class="quality-pill-label">${f} fps</div>` +
          `<div class="quality-pill-desc">${FPS_LABELS[f]}</div></div>`,
      ).join("");
      fpsPills.addEventListener("click", (e) => {
        const pill = e.target.closest(".fps-pill");
        if (!pill) return;
        state.exportFps = Number(pill.dataset.fps);
        refreshDialog();
      });
    }
    // Output sizes depend on the canvas, so this row is rebuilt each time.
    const sizePills = pillSection("size-section", "Output size", document.getElementById("fps-section"));
    if (sizePills) {
      sizePills.innerHTML = outputSizes()
        .map(
          (o) =>
            `<div class="quality-pill size-out-pill" data-size="${o.key}"><div class="quality-pill-label">${o.name}</div>` +
            `<div class="quality-pill-desc">${o.w}×${o.h}${o.key === "canvas" ? " · canvas" : ""}</div></div>`,
        )
        .join("");
      if (!sizePills.dataset.wired) {
        sizePills.dataset.wired = "1";
        sizePills.addEventListener("click", (e) => {
          const pill = e.target.closest(".size-out-pill");
          if (!pill) return;
          state.exportOutput = pill.dataset.size;
          refreshDialog();
        });
      }
    }
  }

  // The app's selectQuality clears "selected" on every .quality-pill, the fps pills included.
  const originalSelectQuality = window.selectQuality;
  window.selectQuality = function (...args) {
    originalSelectQuality.apply(this, args);
    refreshDialog();
  };

  const originalOpen = window.openExportBanner;
  window.openExportBanner = function (...args) {
    originalOpen.apply(this, args);
    setText("#fmt-mp4 .format-pill-desc", "H.264 · plays everywhere");
    setText("#mp4-badge", "Recommended");
    setText("#fmt-webm .format-pill-desc", "VP9 · for the web");
    document.getElementById("webm-badge")?.remove();
    ensureDialogControls();
    selectQuality(state.exportQuality);
    refreshDialog();
  };
})();
