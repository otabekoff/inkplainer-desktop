// Preview player: plays the whole movie (every scene, transitions, camera) in a modal
// overlay, from the same frame renderer the exporter uses, paced to real time.
(() => {
  const { native } = inkClock;
  const FPS = 60;

  const el = document.createElement("div");
  el.id = "movie-player";
  el.innerHTML = `
    <div class="mp-stage"><canvas></canvas></div>
    <div class="mp-bar">
      <button type="button" class="mp-close" title="Close (Esc)">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
      <div class="mp-track"><div class="mp-fill"></div></div>
      <span class="mp-info"></span>
    </div>`;
  document.body.appendChild(el);
  const view = el.querySelector("canvas");
  const vctx = view.getContext("2d");
  const fill = el.querySelector(".mp-fill");
  const info = el.querySelector(".mp-info");

  let playing = false;
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  el.querySelector(".mp-close").addEventListener("click", stop);
  document.addEventListener(
    "keydown",
    (e) => {
      if (!playing) return;
      if (e.key === "Escape" || e.key === " ") {
        e.preventDefault();
        e.stopImmediatePropagation();
        stop();
      }
    },
    true,
  );

  function layout() {
    const stage = el.querySelector(".mp-stage").getBoundingClientRect();
    const s = Math.min(stage.width / state.canvasW, stage.height / state.canvasH);
    const w = Math.max(1, Math.floor(state.canvasW * s));
    const h = Math.max(1, Math.floor(state.canvasH * s));
    const dpr = window.devicePixelRatio || 1;
    view.style.width = `${w}px`;
    view.style.height = `${h}px`;
    view.width = Math.round(w * dpr);
    view.height = Math.round(h * dpr);
    vctx.imageSmoothingQuality = "high";
  }

  // opts.from: start at that scene (with its transition in).
  async function play(opts = {}) {
    if (playing || state.recording) return;
    if (!inkScenes.list.some((s) => s.layers.length)) {
      showToast("Add something to a scene first");
      return;
    }
    if (typeof _ts !== "undefined" && _ts.active) closeTextEditor(true);
    playing = true;
    stopped = false;
    el.classList.add("show");
    layout();
    const sceneCount = inkScenes.list.length;
    let t0 = 0;
    try {
      await window.inkAudio?.prepare();
      await inkMovie.render({
        fps: FPS,
        from: opts.from ?? 0,
        onSceneStart: (scene, time) => window.inkAudio?.sceneStarted(scene, time),
        cancelled: () => stopped,
        onProgress: (f, s) => {
          fill.style.width = `${(f * 100).toFixed(1)}%`;
          info.textContent = sceneCount > 1 ? `Scene ${s + 1} of ${sceneCount}` : "";
        },
        onFrame: async (frame, { index, time }) => {
          if (index === 0) {
            t0 = native.perfNow();
            window.inkAudio?.startPlayback(); // audio starts with the first frame
          }
          // Never run ahead of real time.
          const wait = t0 + (index * 1000) / FPS - native.perfNow();
          if (wait > 1) await new Promise((r) => native.setTimeout(r, wait));
          else if (index % 8 === 0) await new Promise((r) => native.setTimeout(r, 0)); // let input through
          vctx.drawImage(frame, 0, 0, view.width, view.height);
          void time;
        },
      });
      // Keep the last frame up for a moment before closing.
      if (!stopped) await new Promise((r) => native.setTimeout(r, 400));
    } catch (err) {
      if (!stopped) {
        console.error(err);
        showToast(`Preview stopped: ${err.message}`);
      }
    } finally {
      window.inkAudio?.stopPlayback();
      playing = false;
      el.classList.remove("show");
      fill.style.width = "0%";
    }
  }

  window.addEventListener("resize", () => playing && layout());
  window.inkPlayer = { play, get playing() { return playing; } };
})();
