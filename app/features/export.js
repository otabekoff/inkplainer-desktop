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

    // Video chunks are kept until the end: the soundtrack can only be mixed once the scene
    // start times are known, and both streams are then muxed in timestamp order.
    const videoChunks = [];
    const sceneStarts = [];
    let encoderError = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => videoChunks.push({ chunk, meta }),
      error: (e) => (encoderError = e),
    });
    encoder.configure(enc.config);

    const where = enc.hardware ? `GPU (${gpu.name})` : "CPU";
    const mbps = (bitrate / 1e6).toFixed(0);
    const scenes = inkScenes.list.length;
    let progress = 0;
    let scene = 0;
    // One progress line (rendering is the first 92%), with the details underneath.
    const status = () => {
      const pct = Math.round(progress * 92);
      progressText.textContent = `Exporting… ${pct}%`;
      progressBar.style.width = `${pct}%`;
      detail(progressText, `${scenes > 1 ? `Scene ${scene + 1} of ${scenes} · ` : ""}${enc.label} ${W}×${H} · ${fps} fps · ${mbps} Mbps · ${where}`);
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
        onSceneStart: (sceneObj, time) => sceneStarts.push({ scene: sceneObj, time }),
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

      progressText.textContent = "Exporting… 93%";
      progressBar.style.width = "93%";
      await encoder.flush();
      if (encoderError) throw encoderError;

      // Soundtrack: music and voiceovers mixed offline at their exact times.
      const duration = videoChunks.length ? (videoChunks.length / fps) : 0;
      const audio = window.inkAudio?.hasAudio() ? await encodeAudio(format, duration, sceneStarts, progressText) : null;

      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: { codec: enc.muxer, width: W, height: H, ...(format === "webm" ? { frameRate: fps } : {}) },
        ...(audio ? { audio: { codec: audio.muxerCodec, numberOfChannels: 2, sampleRate: audio.sampleRate } } : {}),
        ...(format === "mp4" ? { fastStart: "in-memory" } : {}),
        firstTimestampBehavior: "offset",
      });
      const all = [
        ...videoChunks.map((c) => ({ ...c, video: true })),
        ...(audio?.chunks || []).map((c) => ({ ...c, video: false })),
      ].sort((a, b) => a.chunk.timestamp - b.chunk.timestamp || (a.video ? -1 : 1));
      for (const c of all) {
        if (c.video) muxer.addVideoChunk(c.chunk, c.meta);
        else muxer.addAudioChunk(c.chunk, c.meta);
      }
      muxer.finalize();
      progressBar.style.width = "100%";
      return new Blob([target.buffer], { type: format === "mp4" ? "video/mp4" : "video/webm" });
    } finally {
      if (encoder.state !== "closed") encoder.close();
    }
  }

  // Mixes and encodes the soundtrack: AAC for MP4 (Opus if this PC has no AAC encoder),
  // Opus for WebM. Returns null when there is nothing to hear.
  async function encodeAudio(format, duration, sceneStarts, progressText) {
    const sampleRate = 48000;
    progressText.textContent = "Exporting… 95%";
    detail(progressText, "Mixing the soundtrack");
    const mixed = await window.inkAudio.mix(duration, sceneStarts, sampleRate);
    if (!mixed) return null;
    const choices = format === "mp4" ? [["mp4a.40.2", "aac"], ["opus", "opus"]] : [["opus", "A_OPUS"]];
    let picked = null;
    for (const [codec, muxerCodec] of choices) {
      const config = { codec, sampleRate, numberOfChannels: 2, bitrate: 192000 };
      try {
        if ((await AudioEncoder.isConfigSupported(config)).supported) {
          picked = { config, muxerCodec };
          break;
        }
      } catch {
        /* try the next one */
      }
    }
    if (!picked) throw new Error("This PC has no audio encoder for this format");
    const chunks = [];
    let error = null;
    const enc = new AudioEncoder({ output: (chunk, meta) => chunks.push({ chunk, meta }), error: (e) => (error = e) });
    enc.configure(picked.config);
    const step = Math.round(sampleRate / 10); // 100 ms per AudioData
    const left = mixed.getChannelData(0);
    const right = mixed.numberOfChannels > 1 ? mixed.getChannelData(1) : left;
    for (let i = 0; i < mixed.length; i += step) {
      const n = Math.min(step, mixed.length - i);
      const planes = new Float32Array(n * 2);
      planes.set(left.subarray(i, i + n), 0);
      planes.set(right.subarray(i, i + n), n);
      const data = new AudioData({ format: "f32-planar", sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / sampleRate) * 1e6), data: planes });
      enc.encode(data);
      data.close();
      if (error) throw error;
    }
    await enc.flush();
    enc.close();
    if (error) throw error;
    return { chunks, sampleRate, muxerCodec: picked.muxerCodec };
  }

  // A small second line under the progress text, for details.
  function detail(progressText, text) {
    let el = document.getElementById("export-progress-detail");
    if (!el) {
      el = document.createElement("div");
      el.id = "export-progress-detail";
      progressText.after(el);
    }
    el.textContent = text;
  }

  // Renders the movie to a video Blob (on the CPU again if the GPU encoder fails mid-way).
  async function exportBlob(format, progressText, progressBar) {
    try {
      return await render(format, progressText, progressBar, true);
    } catch (err) {
      if (!(err instanceof HardwareEncoderFailed)) throw err;
      console.warn("Hardware encoder failed, rendering again on the CPU:", err.message);
      return render(format, progressText, progressBar, false);
    }
  }

  async function exportVideo(format, progressText, progressBar) {
    const blob = await exportBlob(format, progressText, progressBar);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileBase()}.${format}`;
    a.click();
    native.setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }

  window.recordMP4 = (progressText, progressBar) => exportVideo("mp4", progressText, progressBar);
  window.recordWebM = (progressText, progressBar) => exportVideo("webm", progressText, progressBar);

  // A file name from the project name.
  function fileBase() {
    const name = (document.getElementById("project-name-display")?.textContent || "").trim();
    return name.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").slice(0, 80) || "whiteboard";
  }

  // The movie's last picture (the final scene, finished), for "Also export final frame".
  function finalFrame() {
    const pic = inkScenes.picture(inkScenes.list.length - 1, state.canvasH);
    return new Promise((resolve) => pic.toBlob(resolve, "image/png"));
  }

  // ── Export in three steps: options → where to save → progress → saved ─────
  // (The app used to render first, show a success message, then ask where to save, then show
  // the saved dialog.) Choosing the file first means the export ends where it began.
  const tauri = window.__TAURI__;
  if (tauri) {
    const { invoke } = tauri.core;
    const write = async (path, blob, ext) =>
      invoke("write_export", new Uint8Array(await blob.arrayBuffer()), {
        headers: { "x-path": encodeURIComponent(path), ...(ext ? { "x-ext": ext } : {}) },
      });
    window.startRecording = async function () {
      const format = state.exportFormat === "webm" ? "webm" : "mp4";
      const startBtn = document.getElementById("start-recording-btn");
      const controls = document.getElementById("export-banner-controls");
      const progressBox = document.getElementById("export-progress-container");
      const progressText = document.getElementById("export-progress-text");
      const progressBar = document.getElementById("export-progress-bar");
      startBtn.disabled = true;
      let path = null;
      try {
        path = await invoke("pick_export_path", { name: `${fileBase()}.${format}` });
      } finally {
        startBtn.disabled = false;
      }
      if (!path) return; // the Save dialog was cancelled: stay on the options
      controls.style.display = "none";
      progressBox.classList.add("active");
      startBtn.disabled = true;
      progressText.textContent = "Exporting… 0%";
      progressBar.style.width = "0%";
      try {
        const blob = await exportBlob(format, progressText, progressBar);
        if (window.__inkTest) window.__inkTest.blob = blob; // scripted tests read the result
        progressText.textContent = "Saving…";
        detail(progressText, "Writing the file");
        progressBar.style.width = "98%";
        const saved = await write(path, blob);
        if (state.exportPNG) await write(path, await finalFrame(), "png");
        progressBar.style.width = "100%";
        closeExportBanner();
        window.showExportSaved?.(saved);
      } catch (err) {
        if (!/cancel/i.test(err?.message || "")) {
          console.error("Export failed:", err);
          showToast(`Export failed: ${err.message || err}`, null, 5000);
        }
      } finally {
        controls.style.display = "block";
        progressBox.classList.remove("active");
        startBtn.disabled = false;
      }
    };
  }

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
