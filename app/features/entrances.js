// Entrance animations, alongside the drawing styles (like VideoScribe's "move in" and
// "fade in"): the element is not drawn stroke by stroke but brought onto the canvas.
//   enter-move  the hand carries it in from an edge (layer.enterFrom: auto/left/right/top/bottom)
//   enter-fade  fades in
//   enter-pop   pops in with a little overshoot
//   enter-drop  drops in from above and bounces
// They run in the same per-layer slot system as the drawing styles, so they work in
// sequence and in parallel, and the Speed slider sets their duration.
(() => {
  registerLayerFields("enterFrom");
  const STYLES = ["enter-move", "enter-fade", "enter-pop", "enter-drop"];

  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
  function easeOutBounce(t) {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  }

  // Speed 1..100 → about 3 s .. 0.35 s.
  const secondsFor = (speed) => 3 - ((Math.min(100, Math.max(1, speed)) - 1) / 99) * 2.65;

  function bounds() {
    const b = state.contentBounds;
    return b && b.w > 0 ? b : { x: 0, y: 0, w: state.canvasW, h: state.canvasH };
  }

  function nearestEdge(b) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const d = { left: cx, right: state.canvasW - cx, top: cy, bottom: state.canvasH - cy };
    return Object.entries(d).sort((a, z) => a[1] - z[1])[0][0];
  }

  function setup() {
    const slot = state._currentSlot;
    if (!slot) return;
    const speed = slot.layer.speed ?? 40;
    const b = bounds();
    slot._enter = {
      t: 0,
      steps: Math.max(8, Math.round(secondsFor(speed) * 60)),
      from: slot.layer.enterFrom && slot.layer.enterFrom !== "auto" ? slot.layer.enterFrom : nearestEdge(b),
    };
  }

  function tick() {
    const slot = state._currentSlot;
    if (!slot) return;
    if (!slot._enter) setup();
    const e = slot._enter;
    e.t++;
    const p = Math.min(1, e.t / e.steps);
    const W = state.canvasW;
    const H = state.canvasH;
    const b = bounds();
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;

    fillBg(ctx); // clears this layer's slot canvas
    ctx.save();
    switch (state.animStyle) {
      case "enter-fade":
        ctx.globalAlpha = easeInOut(p);
        ctx.drawImage(offscreen, 0, 0);
        break;
      case "enter-pop": {
        const s = Math.max(0.001, easeOutBack(p));
        ctx.globalAlpha = Math.min(1, p * 4);
        ctx.translate(cx, cy);
        ctx.scale(s, s);
        ctx.translate(-cx, -cy);
        ctx.drawImage(offscreen, 0, 0);
        break;
      }
      case "enter-drop": {
        const dy = -(b.y + b.h + 20) * (1 - easeOutBounce(p));
        ctx.drawImage(offscreen, 0, dy);
        break;
      }
      default: {
        // enter-move: start just off-canvas on the chosen side, carried by the hand.
        const k = 1 - easeInOut(p);
        const off = {
          left: [-(b.x + b.w + 30), 0],
          right: [W - b.x + 30, 0],
          top: [0, -(b.y + b.h + 30)],
          bottom: [0, H - b.y + 30],
        }[e.from] || [0, 0];
        const dx = off[0] * k;
        const dy = off[1] * k;
        ctx.drawImage(offscreen, dx, dy);
        // The hand holds the element just below its centre while it moves.
        if (p < 1) drawHand(hctx, cx + dx, cy + b.h * 0.18 + dy, 0, state.hand);
      }
    }
    ctx.restore();
    setProgress(p);
    if (p >= 1) finishAnim();
  }

  window.inkEntrances = { STYLES, setup, tick, isEntrance: (s) => STYLES.includes(s) };

  // ── Animation Style card: an "Entrance" group ─────────────────────────────
  const spec = [...document.querySelectorAll(".anim-section-divider")].find((d) => /Specialized/.test(d.textContent));
  const specGrid = spec?.nextElementSibling?.nextElementSibling; // divider, hint, grid
  if (!specGrid) return;
  const divider = document.createElement("div");
  divider.className = "anim-section-divider";
  divider.textContent = "Entrance";
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:9px;color:var(--muted);margin-bottom:4px;line-height:1.4";
  hint.textContent = "Bring the element in instead of drawing it.";
  const grid = document.createElement("div");
  grid.className = "anim-grid";
  grid.innerHTML = `
    <div class="anim-opt" data-anim="enter-move" onclick="selectAnim(this)" title="The hand carries it in from the side">Move in</div>
    <div class="anim-opt" data-anim="enter-fade" onclick="selectAnim(this)">Fade in</div>
    <div class="anim-opt" data-anim="enter-pop" onclick="selectAnim(this)">Pop in</div>
    <div class="anim-opt" data-anim="enter-drop" onclick="selectAnim(this)">Drop in</div>`;
  specGrid.after(divider, hint, grid);

  // "Move in" direction, per layer, shown while Move in is selected.
  const dirRow = document.createElement("div");
  dirRow.id = "enter-from-opts";
  dirRow.style.display = "none";
  grid.after(dirRow);
  function syncDir() {
    const layer = getSelectedLayer();
    const show = (layer?.animStyle ?? state.animStyle) === "enter-move";
    dirRow.style.display = show ? "" : "none";
    if (!show) return;
    dirRow.textContent = "";
    dirRow.appendChild(
      inkLayerPanel.segmented(
        "From",
        [["auto", "Nearest"], ["left", "Left"], ["right", "Right"], ["top", "Top"], ["bottom", "Bottom"]],
        layer?.enterFrom || "auto",
        (val) => {
          if (!layer) return;
          pushUndoSnapshot();
          layer.enterFrom = val;
          scheduleAutoSave();
        },
      ),
    );
  }
  const originalSelectAnim = window.selectAnim;
  window.selectAnim = function (...args) {
    const r = originalSelectAnim.apply(this, args);
    syncDir();
    return r;
  };
  const originalSync = window.syncSidebarToLayer;
  window.syncSidebarToLayer = function (...args) {
    const r = originalSync.apply(this, args);
    syncDir();
    return r;
  };
})();
