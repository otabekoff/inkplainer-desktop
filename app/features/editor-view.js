// Editor view: zoom and pan the canvas preview, and Select / Hand tools.
//   Ctrl+wheel        zoom around the pointer        Ctrl + / Ctrl -   zoom in / out
//   Ctrl+0            fit to window                  Ctrl+1            100% (actual pixels)
//   V / H             Select tool / Hand tool        middle-drag       pan with any tool
// The canvases keep their pixel size; only their CSS size changes, so hit-testing
// (which maps through getBoundingClientRect) keeps working at any zoom.
(() => {
  const area = document.getElementById("canvas-area");
  const wrapper = document.getElementById("canvas-wrapper");
  if (!area || !wrapper) return;

  // A scroll container between the canvas area and the canvas, so the playbar and tool
  // bar (absolute children of #canvas-area) stay put while the canvas scrolls.
  const viewport = document.createElement("div");
  viewport.id = "canvas-viewport";
  wrapper.before(viewport);
  viewport.appendChild(wrapper);

  const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
  const MIN = ZOOM_STEPS[0];
  const MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];
  let mode = "fit"; // "fit" follows the window size; "fixed" keeps `scale`
  let scale = 1; // CSS pixels per canvas pixel
  let tool = "select";

  function fitScale() {
    const styles = getComputedStyle(viewport);
    const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const w = Math.max(160, viewport.clientWidth - padX - 24);
    const h = Math.max(160, viewport.clientHeight - padY - 24);
    return Math.min(w / state.canvasW, h / state.canvasH, 1);
  }

  function applySize() {
    const w = `${state.canvasW * scale}px`;
    const h = `${state.canvasH * scale}px`;
    for (const c of [canvas, handCanvas, selectCanvas]) {
      c.style.width = w;
      c.style.height = h;
    }
    const crop = document.getElementById("crop-canvas");
    if (crop) {
      crop.style.width = w;
      crop.style.height = h;
    }
    // The text editor overlay is placed in CSS pixels; move it with the canvas.
    if (typeof _ts !== "undefined" && _ts.active && typeof _positionTextOverlay === "function") {
      _positionTextOverlay(_ts.canvasX, _ts.canvasY);
      if (typeof updateTextOverlayStyle === "function") updateTextOverlayStyle();
    }
    if (typeof drawSelectionHandles === "function") drawSelectionHandles();
    label.textContent = `${Math.round(scale * 100)}%`;
    viewport.classList.toggle("zoomed", mode === "fixed" && scale > fitScale() + 1e-6);
  }

  // Replaces the app's fitCanvas (called on resize, canvas size changes and new layers).
  window.fitCanvas = function () {
    if (mode === "fit") scale = fitScale();
    applySize();
  };

  // Zooms to `next`, keeping the canvas point under (clientX, clientY) in place.
  function zoomTo(next, clientX, clientY) {
    next = Math.min(MAX, Math.max(MIN, next));
    const before = canvas.getBoundingClientRect();
    const vr = viewport.getBoundingClientRect();
    if (clientX === undefined) {
      clientX = vr.left + vr.width / 2;
      clientY = vr.top + vr.height / 2;
    }
    const cx = (clientX - before.left) / scale;
    const cy = (clientY - before.top) / scale;
    mode = "fixed";
    scale = next;
    applySize();
    const after = canvas.getBoundingClientRect();
    viewport.scrollLeft += after.left + cx * scale - clientX;
    viewport.scrollTop += after.top + cy * scale - clientY;
  }

  function step(dir, clientX, clientY) {
    const next = dir > 0 ? ZOOM_STEPS.find((z) => z > scale + 1e-6) ?? MAX : [...ZOOM_STEPS].reverse().find((z) => z < scale - 1e-6) ?? MIN;
    zoomTo(next, clientX, clientY);
  }

  function fit() {
    mode = "fit";
    window.fitCanvas();
    viewport.scrollLeft = viewport.scrollTop = 0;
  }

  // ── Tools ─────────────────────────────────────────────────────────────────
  function setTool(next) {
    tool = next;
    viewport.classList.toggle("tool-hand", tool === "hand");
    bar.querySelector('[data-tool="select"]').classList.toggle("active", tool === "select");
    bar.querySelector('[data-tool="hand"]').classList.toggle("active", tool === "hand");
  }

  let pan = null;
  viewport.addEventListener(
    "mousedown",
    (e) => {
      const middle = e.button === 1;
      if (!(middle || (e.button === 0 && tool === "hand"))) return;
      // Take the event before the canvas sees it, so the hand never moves a layer.
      e.preventDefault();
      e.stopImmediatePropagation();
      pan = { x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
      viewport.classList.add("panning");
    },
    true,
  );
  window.addEventListener("mousemove", (e) => {
    if (!pan) return;
    viewport.scrollLeft = pan.left - (e.clientX - pan.x);
    viewport.scrollTop = pan.top - (e.clientY - pan.y);
  });
  window.addEventListener("mouseup", () => {
    if (!pan) return;
    pan = null;
    viewport.classList.remove("panning");
  });
  // Middle-click would otherwise start the browser's autoscroll.
  viewport.addEventListener("auxclick", (e) => e.button === 1 && e.preventDefault());

  viewport.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // Trackpad pinches send small deltas; mouse wheels send ~100 per notch.
      const factor = Math.exp(-e.deltaY * (Math.abs(e.deltaY) < 50 ? 0.01 : 0.0025));
      zoomTo(scale * factor, e.clientX, e.clientY);
    },
    { passive: false },
  );

  document.addEventListener(
    "keydown",
    (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (typing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "=" || e.key === "+")) step(1);
      else if (mod && e.key === "-") step(-1);
      else if (mod && e.key === "0") fit();
      else if (mod && e.key === "1") zoomTo(1);
      else if (!mod && !e.altKey && (e.key === "v" || e.key === "V")) setTool("select");
      else if (!mod && !e.altKey && (e.key === "h" || e.key === "H")) setTool("hand");
      else return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  // ── View bar (bottom-left of the canvas area) ─────────────────────────────
  const icon = {
    select: '<path d="M4 3l7.5 17 2.2-6.8L20.5 11z"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    fit: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
  };
  const svg = (name) =>
    `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon[name]}</svg>`;

  const bar = document.createElement("div");
  bar.id = "view-bar";
  bar.innerHTML = `
    <button type="button" data-tool="select" class="active" title="Select (V)">${svg("select")}</button>
    <button type="button" data-tool="hand" title="Hand: drag to pan (H, or middle mouse button)">${svg("hand")}</button>
    <span class="sep"></span>
    <button type="button" data-zoom="out" title="Zoom out (Ctrl −)">${svg("minus")}</button>
    <button type="button" data-zoom="reset" class="zoom-label" title="Zoom to 100% (Ctrl 1)"></button>
    <button type="button" data-zoom="in" title="Zoom in (Ctrl +)">${svg("plus")}</button>
    <button type="button" data-zoom="fit" title="Fit to window (Ctrl 0)">${svg("fit")}</button>`;
  area.appendChild(bar);
  const label = bar.querySelector(".zoom-label");
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.tool) setTool(b.dataset.tool);
    else if (b.dataset.zoom === "in") step(1);
    else if (b.dataset.zoom === "out") step(-1);
    else if (b.dataset.zoom === "reset") zoomTo(1);
    else if (b.dataset.zoom === "fit") fit();
  });

  window.addEventListener("resize", () => mode === "fit" && window.fitCanvas());
  window.editorView = { zoomTo, fit, setTool, get scale() { return scale; } };
  window.fitCanvas();
})();
