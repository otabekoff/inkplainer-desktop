// Camera, VideoScribe style: in the movie (Play movie and export) the view zooms and pans
// to whatever is being drawn, eases between elements, and can zoom back out to show the
// whole picture at the end of the scene.
//
// Settings are per scene (scene.camera = { mode: 'off'|'follow', zoom, ending: 'wide'|'stay' })
// with a per-layer override (layer.camera = 'auto'|'wide'|'close'). The editor canvas itself
// is never moved; the camera only affects composed movie frames (features/movie.js).
(() => {
  registerLayerFields("camera");

  const MOVE_TIME = 0.55; // seconds for the camera to cover most of a move
  const PAD = 0.14; // margin around an element, as a fraction of its size

  // Where the pen is, per slot (several layers can draw at once).
  const originalDrawHand = window.drawHand;
  window.drawHand = function (c, tipX, tipY, ...rest) {
    const slot = state._currentSlot;
    if (slot) slot._camHand = { x: tipX, y: tipY };
    return originalDrawHand.call(this, c, tipX, tipY, ...rest);
  };

  const settings = () => inkScenes.currentScene?.camera || { mode: "off", zoom: 1.8, ending: "wide" };

  let cam = null; // { cx, cy, w } in canvas pixels; height follows the canvas aspect
  let lastTime = null;
  let lastTarget = null;

  const full = () => ({ cx: state.canvasW / 2, cy: state.canvasH / 2, w: state.canvasW });

  // The view the camera wants right now, or null to stay where it is.
  function target() {
    const W = state.canvasW;
    const H = state.canvasH;
    const aspect = W / H;
    const s = settings();
    if (state.done) return s.ending === "stay" ? null : full();
    const slots = (state._activeSlots || []).filter((x) => !x.done);
    if (!slots.length) return null; // between layers: hold the shot

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let zoom = s.zoom;
    let wide = false;
    let handX = 0, handY = 0, hands = 0;
    for (const slot of slots) {
      const l = slot.layer;
      if (l.camera === "wide") wide = true;
      if (l.camera === "close") zoom = Math.max(zoom, s.zoom * 1.6);
      const b = slot._state?.contentBounds;
      const r = b && b.w > 0 ? b : { x: l.x, y: l.y, w: l.w, h: l.h };
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
      if (slot._camHand) {
        handX += slot._camHand.x;
        handY += slot._camHand.y;
        hands++;
      }
    }
    if (wide) return full();
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(W, x1);
    y1 = Math.min(H, y1);
    if (!(x1 > x0 && y1 > y0)) return null;

    // Element box with a margin, widened to the frame's aspect ratio.
    let rw = (x1 - x0) * (1 + PAD * 2);
    let rh = (y1 - y0) * (1 + PAD * 2);
    if (rw / rh < aspect) rw = rh * aspect;
    const ex = (x0 + x1) / 2;
    const ey = (y0 + y1) / 2;
    const w = Math.min(W, Math.max(rw, W / Math.max(1, zoom)));
    const h = w / aspect;

    // A big element seen up close: follow the pen across it.
    let cx = ex;
    let cy = ey;
    if (hands) {
      const hx = handX / hands;
      const hy = handY / hands;
      const spanX = Math.max(0, (x1 - x0) - w * 0.7);
      const spanY = Math.max(0, (y1 - y0) - h * 0.7);
      if (spanX > 0) cx = Math.min(Math.max(hx, ex - spanX / 2), ex + spanX / 2);
      if (spanY > 0) cy = Math.min(Math.max(hy, ey - spanY / 2), ey + spanY / 2);
    }
    // Stay inside the canvas.
    cx = Math.min(Math.max(cx, w / 2), W - w / 2);
    cy = Math.min(Math.max(cy, h / 2), H - h / 2);
    return { cx, cy, w };
  }

  function update(time) {
    const dt = lastTime === null ? 0 : Math.max(0, time - lastTime);
    lastTime = time;
    const t = target() || lastTarget || full();
    lastTarget = t;
    if (!cam) cam = full();
    const k = 1 - Math.exp(-dt / (MOVE_TIME / 3));
    cam.cx += (t.cx - cam.cx) * k;
    cam.cy += (t.cy - cam.cy) * k;
    // Zoom eases in log space, so zooming in and out feel the same.
    cam.w = Math.exp(Math.log(cam.w) + (Math.log(t.w) - Math.log(cam.w)) * k);
  }

  window.inkCamera = {
    get enabled() {
      return settings().mode === "follow";
    },
    beginScene() {
      cam = full(); // each scene starts on the whole picture and moves in
      lastTime = null;
      lastTarget = null;
    },
    endScene() {},
    compose(c, main, hand, outW, outH, time) {
      update(time);
      const W = state.canvasW;
      const H = state.canvasH;
      const w = Math.min(W, cam.w);
      const h = (w * H) / W;
      const sx = Math.min(Math.max(cam.cx - w / 2, 0), W - w);
      const sy = Math.min(Math.max(cam.cy - h / 2, 0), H - h);
      c.fillStyle = "#ffffff";
      c.fillRect(0, 0, outW, outH);
      c.drawImage(main, sx, sy, w, h, 0, 0, outW, outH);
      c.drawImage(hand, sx, sy, w, h, 0, 0, outW, outH);
    },
    get view() {
      return cam && { ...cam };
    },
  };

  // ── Live preview in the editor (optional) ────────────────────────────────
  // While the editor's own Play runs, move the view like the movie camera does, with a
  // CSS transform on the canvases (the drawing itself is untouched). A per-machine choice.
  const PREVIEW_KEY = "inkplainer.cameraPreview";
  let preview = false;
  try {
    preview = localStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    /* storage unavailable */
  }
  const viewCanvases = () => [canvas, handCanvas, selectCanvas];
  let live = false;
  let liveStart = 0;
  function clearView() {
    for (const c of viewCanvases()) {
      c.style.transform = "";
      c.style.transformOrigin = "";
    }
  }
  (function previewLoop() {
    // Between steps the animation briefly stops playing (its slots stay); keep following then.
    const between = live && (state._activeSlots?.length > 0 || state.done);
    const running = preview && window.inkCamera.enabled && !inkClock.manual && (state.playing || between);
    if (running) {
      const now = inkClock.native.perfNow() / 1000;
      if (!live) {
        live = true;
        liveStart = now;
        inkCamera.beginScene();
      }
      update(now - liveStart);
      const W = state.canvasW;
      const H = state.canvasH;
      const w = Math.min(W, cam.w);
      const h = (w * H) / W;
      const sx = Math.min(Math.max(cam.cx - w / 2, 0), W - w);
      const sy = Math.min(Math.max(cam.cy - h / 2, 0), H - h);
      const k = (parseFloat(canvas.style.width) || W) / W; // CSS px per canvas px
      const z = W / w;
      for (const c of viewCanvases()) {
        c.style.transformOrigin = "0 0";
        c.style.transform = `translate(${-sx * k * z}px, ${-sy * k * z}px) scale(${z})`;
      }
    } else if (live) {
      live = false;
      clearView();
    }
    // Stop following once the animation is stopped or reset.
    if (live && !state.playing && !state.done && !state._activeSlots?.length) {
      live = false;
      clearView();
    }
    inkClock.native.raf(previewLoop);
  })();
  window.inkCamera.setPreview = (on) => {
    preview = !!on;
    try {
      localStorage.setItem(PREVIEW_KEY, preview ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    if (!preview) {
      live = false;
      clearView();
    }
  };
  Object.defineProperty(window.inkCamera, "preview", { get: () => preview });

  // ── Bottom bar: Camera section for the current scene ─────────────────────
  const speed = [...document.querySelectorAll("#bottom-bar .bb-section")].find((s) => /Speed/.test(s.textContent));
  if (speed) {
    const sec = document.createElement("div");
    sec.className = "bb-section";
    sec.id = "bb-camera";
    sec.style.cssText = "flex:2;min-width:0;";
    sec.innerHTML = `
      <div class="bb-label">Camera <span class="bb-camera-scope">this scene</span></div>
      <div class="ink-seg bb-camera-mode">
        <button type="button" data-mode="off" title="The whole canvas, no camera moves">Off</button>
        <button type="button" data-mode="follow" title="Zoom and pan to what is being drawn (Play movie / export)">Follow drawing</button>
      </div>
      <div class="bb-sliders bb-camera-opts">
        <div class="bb-slider-row">
          <span style="width:38px;flex-shrink:0;">Zoom</span>
          <input type="range" min="1.1" max="3" step="0.1" id="camera-zoom">
          <span class="slider-val" id="camera-zoom-val"></span>
        </div>
        <label class="bb-camera-end"><input type="checkbox" id="camera-ending"> Zoom out at the end</label>
        <label class="bb-camera-end" title="Move the editor view with the camera while Play runs"><input type="checkbox" id="camera-preview"> Preview in editor</label>
      </div>
      <div class="bb-camera-tip">Close-ups stay sharp on a 2K or 4K canvas exported at 1080p.</div>`;
    speed.after(sec);

    const zoom = sec.querySelector("#camera-zoom");
    const ending = sec.querySelector("#camera-ending");
    const sync = () => {
      const s = settings();
      sec.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === s.mode));
      sec.querySelector(".bb-camera-opts").classList.toggle("disabled", s.mode === "off");
      sec.querySelector(".bb-camera-tip").style.display = s.mode === "follow" && Math.min(state.canvasW, state.canvasH) <= 1080 ? "" : "none";
      zoom.value = s.zoom;
      sec.querySelector("#camera-zoom-val").textContent = `${Number(s.zoom).toFixed(1)}×`;
      ending.checked = s.ending !== "stay";
      if (typeof updateSliderFill === "function") updateSliderFill(zoom);
    };
    const edit = (patch) => {
      const scene = inkScenes.currentScene;
      if (!scene) return;
      scene.camera = { ...settings(), ...patch };
      sync();
      scheduleAutoSave();
    };
    sec.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mode]");
      if (b) edit({ mode: b.dataset.mode });
    });
    zoom.addEventListener("input", () => edit({ zoom: Number(zoom.value) }));
    ending.addEventListener("change", () => edit({ ending: ending.checked ? "wide" : "stay" }));
    const previewBox = sec.querySelector("#camera-preview");
    previewBox.checked = window.inkCamera.preview;
    previewBox.addEventListener("change", () => window.inkCamera.setPreview(previewBox.checked));

    // Follow the selected scene.
    window.addEventListener("inkplainer:scene-changed", sync);
    window.addEventListener("inkplainer:project-loaded", () => setTimeout(sync, 0));
    sync();
  }

  // ── Per-layer override ───────────────────────────────────────────────────
  inkLayerPanel.add((layer) =>
    inkLayerPanel.segmented(
      "Camera",
      [
        ["auto", "Auto", "Follow the scene's camera setting"],
        ["close", "Close-up", "Zoom in closer while this layer is drawn"],
        ["wide", "Wide", "Show the whole canvas while this layer is drawn"],
      ],
      layer.camera || "auto",
      (val) => {
        pushUndoSnapshot();
        layer.camera = val === "auto" ? undefined : val;
        scheduleAutoSave();
      },
      "Used when the scene's camera follows the drawing",
    ),
  );
})();
