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
  const FPS = 60;
  const TICK = 1000 / FPS;
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

  function bitrateFor(width, height, quality) {
    const bpp = QUALITY_BPP[quality] ?? QUALITY_BPP.high;
    return Math.round(Math.max(2_000_000, width * height * FPS * bpp));
  }

  const CODECS = {
    // H.264 High at level 5.1 covers every canvas size Inkplainer offers at 60 fps.
    mp4: [
      { codec: "avc1.640033", muxer: "avc", label: "H.264" },
      { codec: "avc1.4d0033", muxer: "avc", label: "H.264" },
    ],
    webm: [
      { codec: "vp09.00.51.08", muxer: "V_VP9", label: "VP9" },
      { codec: "vp8", muxer: "V_VP8", label: "VP8" },
    ],
  };

  async function pickEncoder(format, width, height, bitrate, allowHardware) {
    const accels = allowHardware ? ["prefer-hardware", "no-preference"] : ["prefer-software"];
    for (const accel of accels) {
      for (const c of CODECS[format]) {
        const config = {
          codec: c.codec,
          width,
          height,
          bitrate,
          bitrateMode: "variable",
          framerate: FPS,
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
    // Video codecs need even dimensions.
    const W = state.canvasW + (state.canvasW % 2);
    const H = state.canvasH + (state.canvasH % 2);
    const bitrate = bitrateFor(W, H, state.exportQuality);
    const enc = await pickEncoder(format, W, H, bitrate, allowHardware);
    const { Muxer, ArrayBufferTarget } = await loadMuxer(format);

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: enc.muxer, width: W, height: H, ...(format === "webm" ? { frameRate: FPS } : {}) },
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

    const where = enc.hardware ? `GPU (${gpu.name})` : "CPU";
    const mbps = (bitrate / 1e6).toFixed(0);
    const status = (pct) =>
      (progressText.textContent = `Rendering ${pct}% · ${enc.label} ${W}×${H} ${FPS} fps, ${mbps} Mbps on ${where}`);
    status(0);
    progressBar.style.width = "0%";

    state.recording = true;
    enterManual();
    let frames = 0;
    let holdLeft = Math.round(HOLD_END_SECONDS * FPS);
    let idleFrames = 0;
    // Restarting resets the animation a frame or two later, so until it has visibly started
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

        stepFrame();

        fctx.drawImage(mainCanvas, 0, 0, state.canvasW, state.canvasH, 0, 0, state.canvasW, state.canvasH);
        fctx.drawImage(handCanvas, 0, 0, state.canvasW, state.canvasH, 0, 0, state.canvasW, state.canvasH);
        const frame = new VideoFrame(frameCanvas, {
          timestamp: Math.round((frames * 1e6) / FPS),
          duration: Math.round(1e6 / FPS),
        });
        encoder.encode(frame, { keyFrame: frames % (FPS * 2) === 0 });
        frame.close();
        frames++;

        // Wait for the encoder instead of dropping frames.
        while (encoder.encodeQueueSize > 6 && !encoderError) {
          await new Promise((resolve) => {
            encoder.addEventListener("dequeue", resolve, { once: true });
            native.setTimeout(resolve, 20);
          });
        }

        if (!state.done) started = true;
        if (started && isExportAnimationComplete()) {
          if (--holdLeft <= 0) break;
        } else if (!state.playing && !state.done && idle()) {
          // Nothing is animating or scheduled: there is nothing to record.
          if (++idleFrames > FPS * 2) throw new Error("Nothing to export. Add a layer and generate the animation first.");
        } else {
          idleFrames = 0;
        }
        if (frames > MAX_SECONDS * FPS) throw new Error("The animation did not finish within an hour of video");

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
  // MP4 always works here, so make it the default, and show real bitrates.
  if (!state.exportFormat) state.exportFormat = "mp4";
  state.exportQuality = "high";

  const originalOpen = window.openExportBanner;
  window.openExportBanner = function (...args) {
    originalOpen.apply(this, args);
    const set = (sel, text) => {
      const el = document.querySelector(sel);
      if (el) el.textContent = text;
    };
    set("#fmt-mp4 .format-pill-desc", "H.264 · plays everywhere");
    set("#mp4-badge", "Recommended");
    set("#fmt-webm .format-pill-desc", "VP9 · for the web");
    document.getElementById("webm-badge")?.remove();
    const W = state.canvasW + (state.canvasW % 2);
    const H = state.canvasH + (state.canvasH % 2);
    for (const q of Object.keys(QUALITY_BPP)) {
      set(`.quality-pill[data-quality="${q}"] .quality-pill-desc`, `${(bitrateFor(W, H, q) / 1e6).toFixed(0)} Mbps`);
    }
    selectQuality(state.exportQuality);

    let note = document.getElementById("gpu-note");
    if (!note) {
      note = document.createElement("div");
      note.id = "gpu-note";
      document.querySelector(".format-pills")?.parentElement?.appendChild(note);
    }
    note.textContent = gpu.accelerated
      ? `${FPS} fps, frame-exact · GPU: ${gpu.name}`
      : `${FPS} fps, frame-exact · No GPU acceleration available; rendering on the CPU`;
  };
})();
