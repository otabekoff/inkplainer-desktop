// Frame-exact, GPU-accelerated video export for the desktop build.
//
// Inkplainer advances its animation one step per requestAnimationFrame. In a browser that
// ties the speed to the monitor (4x faster on a 240 Hz screen), and its exporter grabs
// frames in real time, so slow frames get dropped and the video stutters.
//
// Here the page runs on a clock of its own:
//  - Live: animation frames run at a fixed 60 per second whatever the refresh rate.
//  - Export: the clock is stepped by hand, exactly 1/60 s per video frame. Animation frames,
//    setTimeout and performance.now / Date.now all follow it, so every frame is rendered and
//    encoded in order, none are dropped, and the video plays exactly like the preview.
// Encoding uses WebCodecs, preferring the GPU's hardware encoder: H.264 for MP4, VP9 for WebM.
(() => {
  // The animation always advances 60 steps per second (its design rate); the video samples
  // those steps at the chosen frame rate, so playback speed is the same at any fps.
  const STEPS_PER_SECOND = 60;
  const TICK = 1000 / STEPS_PER_SECOND;
  const FPS_CHOICES = [24, 30, 60];
  const fpsOf = () => (FPS_CHOICES.includes(state.exportFps) ? state.exportFps : 60);
  const HOLD_END_SECONDS = 0.5; // keep the finished drawing on screen briefly
  const MAX_SECONDS = 60 * 60; // safety stop for an animation that never reports done

  // ── Clock ─────────────────────────────────────────────────────────────────
  const native = {
    raf: window.requestAnimationFrame.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    perfNow: performance.now.bind(performance),
    dateNow: Date.now,
  };

  let frameQueue = new Map();
  let nextFrameId = 1;
  window.requestAnimationFrame = (cb) => {
    const id = nextFrameId++;
    frameQueue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    frameQueue.delete(id);
  };

  function runFrame(time) {
    const batch = frameQueue;
    frameQueue = new Map();
    for (const cb of batch.values()) {
      try {
        cb(time);
      } catch (err) {
        reportError(err);
      }
    }
  }

  let manual = false; // true while exporting
  let virtualNow = 0;
  let virtualStart = 0;
  let dateAtStart = 0;
  let timers = []; // { id, at, fn, args } while exporting
  let nextTimerId = -1; // negative so they never collide with the browser's ids

  performance.now = () => (manual ? virtualNow : native.perfNow());
  Date.now = () => (manual ? dateAtStart + (virtualNow - virtualStart) : native.dateNow());
  window.setTimeout = (fn, ms = 0, ...args) => {
    if (!manual || typeof fn !== "function") return native.setTimeout(fn, ms, ...args);
    const id = nextTimerId--;
    timers.push({ id, at: virtualNow + Math.max(0, Number(ms) || 0), fn, args });
    return id;
  };
  window.clearTimeout = (id) => {
    if (typeof id === "number" && id < 0) timers = timers.filter((t) => t.id !== id);
    else native.clearTimeout(id);
  };

  // Live: at most one animation frame per 1/60 s, at most one per display refresh.
  let lastTick = native.perfNow();
  (function pump(now) {
    if (!manual && now - lastTick >= TICK - 1) {
      lastTick = now - lastTick > TICK * 2 ? now : lastTick + TICK;
      runFrame(now);
    }
    native.raf(pump);
  })(native.perfNow());

  function enterManual() {
    manual = true;
    virtualStart = virtualNow = native.perfNow();
    dateAtStart = native.dateNow();
    timers = [];
  }

  function leaveManual() {
    const left = timers;
    const offset = virtualNow;
    manual = false;
    timers = [];
    lastTick = native.perfNow();
    // Timers still pending go back to real time with whatever delay they had left.
    for (const t of left) native.setTimeout(t.fn, Math.max(0, t.at - offset), ...t.args);
  }

  // Advances the clock by one video frame: due timers fire first, then animation frames,
  // in the same order a browser runs them.
  function stepFrame() {
    virtualNow += TICK;
    for (let guard = 0; guard < 10000; guard++) {
      timers.sort((a, b) => a.at - b.at);
      if (!timers.length || timers[0].at > virtualNow) break;
      const t = timers.shift();
      try {
        t.fn(...t.args);
      } catch (err) {
        reportError(err);
      }
    }
    runFrame(virtualNow);
  }

  const idle = () => frameQueue.size === 0 && timers.length === 0;

  // Lets the page repaint (progress bar) without depending on rAF, which stops while
  // the window is minimized.
  const breathe = () =>
    new Promise((resolve) => {
      const done = () => resolve();
      native.raf(done);
      native.setTimeout(done, 30);
    });

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

  async function render(format, progressText, progressBar, allowHardware) {
    const fps = fpsOf();
    // Video codecs need even dimensions.
    const W = state.canvasW + (state.canvasW % 2);
    const H = state.canvasH + (state.canvasH % 2);
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

    // Composite of the drawing and the hand, on a GPU-backed canvas.
    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = W;
    frameCanvas.height = H;
    const fctx = frameCanvas.getContext("2d", { alpha: false });
    fctx.imageSmoothingQuality = "high";
    const mainCanvas = document.getElementById("main-canvas");
    // Other modules (camera, scene transitions) can take over composing a frame.
    const compose = (time) => {
      if (typeof window.inkplainerComposeFrame === "function") {
        window.inkplainerComposeFrame(fctx, { mainCanvas, handCanvas, width: W, height: H, time, fps });
      } else {
        fctx.drawImage(mainCanvas, 0, 0);
        fctx.drawImage(handCanvas, 0, 0);
      }
    };

    const where = enc.hardware ? `GPU (${gpu.name})` : "CPU";
    const mbps = (bitrate / 1e6).toFixed(0);
    const status = (pct) =>
      (progressText.textContent = `Rendering ${pct}% · ${enc.label} ${W}×${H} ${fps} fps, ${mbps} Mbps on ${where}`);
    status(0);
    progressBar.style.width = "0%";

    state.recording = true;
    enterManual();
    window.dispatchEvent(new CustomEvent("inkplainer:export-start", { detail: { fps } }));
    let frames = 0;
    let steps = 0;
    let holdLeft = Math.round(HOLD_END_SECONDS * fps);
    let idleSteps = 0;
    let complete = false;
    // Restarting resets the animation a step or two later, so until it has visibly started
    // again, "complete" still describes the previous run.
    let started = false;
    try {
      restartAnim();
      let lastBreath = native.perfNow();
      for (;;) {
        if (!state.recording) throw new Error("Export cancelled");
        if (encoderError) {
          throw enc.hardware ? new HardwareEncoderFailed(encoderError.message) : encoderError;
        }

        // Advance the animation to the end of this frame's time slot.
        const until = Math.round(((frames + 1) * STEPS_PER_SECOND) / fps);
        while (steps < until) {
          stepFrame();
          steps++;
          if (!state.done) started = true;
          complete = started && isExportAnimationComplete();
          if (!complete && !state.playing && !state.done && idle()) {
            // Nothing is animating or scheduled: there is nothing to record.
            if (++idleSteps > STEPS_PER_SECOND * 2) {
              throw new Error("Nothing to export. Add a layer and generate the animation first.");
            }
          } else {
            idleSteps = 0;
          }
        }

        compose(frames / fps);
        const frame = new VideoFrame(frameCanvas, {
          timestamp: Math.round((frames * 1e6) / fps),
          duration: Math.round(1e6 / fps),
        });
        encoder.encode(frame, { keyFrame: frames % (fps * 2) === 0 });
        frame.close();
        frames++;

        // Wait for the encoder instead of dropping frames.
        while (encoder.encodeQueueSize > 6 && !encoderError) {
          await new Promise((resolve) => {
            encoder.addEventListener("dequeue", resolve, { once: true });
            native.setTimeout(resolve, 20);
          });
        }

        if (complete && --holdLeft <= 0) break;
        if (frames > MAX_SECONDS * fps) throw new Error("The animation did not finish within an hour of video");

        if (native.perfNow() - lastBreath > 60) {
          status(Math.round(getExportAnimationProgress() * 100));
          progressBar.style.width = `${Math.round(getExportAnimationProgress() * 95)}%`;
          await breathe();
          lastBreath = native.perfNow();
        }
      }

      progressText.textContent = `Finishing ${format.toUpperCase()}…`;
      await encoder.flush();
      if (encoderError) throw encoderError;
      muxer.finalize();
      progressBar.style.width = "100%";
      return new Blob([target.buffer], { type: format === "mp4" ? "video/mp4" : "video/webm" });
    } finally {
      leaveManual();
      state.recording = false;
      window.dispatchEvent(new CustomEvent("inkplainer:export-end"));
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
    const W = state.canvasW + (state.canvasW % 2);
    const H = state.canvasH + (state.canvasH % 2);
    for (const q of Object.keys(QUALITY_BPP)) {
      setText(`.quality-pill[data-quality="${q}"] .quality-pill-desc`, `${(bitrateFor(W, H, q, fps) / 1e6).toFixed(0)} Mbps`);
    }
    document.querySelectorAll(".fps-pill").forEach((p) => p.classList.toggle("selected", Number(p.dataset.fps) === fps));
    const note = document.getElementById("gpu-note");
    if (note) {
      note.textContent = gpu.accelerated
        ? `${W}×${H}, frame-exact · GPU: ${gpu.name}`
        : `${W}×${H}, frame-exact · No GPU acceleration available; rendering on the CPU`;
    }
  }

  // Adds the GPU line under the format pills and a "Frame rate" row after Quality,
  // built from the Quality row's own markup so it matches.
  function ensureDialogControls() {
    if (!document.getElementById("gpu-note")) {
      const note = document.createElement("div");
      note.id = "gpu-note";
      document.querySelector(".format-pills")?.parentElement?.appendChild(note);
    }
    if (document.getElementById("fps-section")) return;
    const section = document.querySelector(".quality-pills")?.parentElement;
    if (!section) return;
    const fpsSection = section.cloneNode(false);
    fpsSection.id = "fps-section";
    const label = section.firstElementChild?.cloneNode(true);
    if (label && !label.classList.contains("quality-pills")) {
      label.textContent = "Frame rate";
      fpsSection.appendChild(label);
    }
    const pills = document.createElement("div");
    pills.className = "quality-pills";
    pills.innerHTML = FPS_CHOICES.map(
      (f) =>
        `<div class="quality-pill fps-pill" data-fps="${f}"><div class="quality-pill-label">${f} fps</div>` +
        `<div class="quality-pill-desc">${FPS_LABELS[f]}</div></div>`,
    ).join("");
    pills.addEventListener("click", (e) => {
      const pill = e.target.closest(".fps-pill");
      if (!pill) return;
      state.exportFps = Number(pill.dataset.fps);
      refreshDialog();
    });
    fpsSection.appendChild(pills);
    section.after(fpsSection);
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
