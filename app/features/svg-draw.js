// "Draw strokes": the animation for vector art (SVG images, shapes). Instead of guessing
// outlines from pixels, it draws the artwork's real strokes the way a pen would:
//  - each element's outline is traced in its own colour and width, the hand on the tip
//  - then its fill fades in (taken from the finished image, clipped to the element's shape,
//    so gradients and details are exact)
//  - text inside the art wipes in left to right
// Elements play in document order. Layers keep their SVG source in layer.svgSource.
(() => {
  registerLayerFields("svgSource");
  const STYLE = "svg-draw";
  const GEOMETRY = "path, line, rect, circle, ellipse, polyline, polygon";

  // ── Reading the SVG: geometry in the SVG's own coordinates, cached per source ──
  const host = document.createElement("div");
  // Hidden with opacity, not visibility: visibility is inherited, and hidden elements are skipped.
  host.style.cssText = "position:fixed;left:-20000px;top:0;opacity:0;pointer-events:none;";
  document.body.appendChild(host);
  const cache = new Map();

  function parse(source) {
    if (cache.has(source)) return cache.get(source);
    host.innerHTML = source;
    const root = host.querySelector("svg");
    if (!root) return null;
    const vb = root.viewBox?.baseVal;
    const width = vb?.width || root.width.baseVal.value || 100;
    const height = vb?.height || root.height.baseVal.value || 100;
    const rootInv = root.getScreenCTM()?.inverse();
    const toRoot = (el) => (rootInv && el.getScreenCTM() ? rootInv.multiply(el.getScreenCTM()) : new DOMMatrix());
    const elements = [];
    for (const el of root.querySelectorAll(`${GEOMETRY}, text`)) {
      if (el.closest("defs, clipPath, mask, pattern, symbol")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const m = toRoot(el);
      const opacity = Number(cs.opacity) || 1;
      if (el.tagName.toLowerCase() === "text") {
        const b = el.getBBox();
        const pts = [new DOMPoint(b.x, b.y), new DOMPoint(b.x + b.width, b.y + b.height)].map((p) => p.matrixTransform(m));
        elements.push({ kind: "text", box: { x: pts[0].x, y: pts[0].y, w: pts[1].x - pts[0].x, h: pts[1].y - pts[0].y }, length: b.width * 0.8 + 40 });
        continue;
      }
      let length = 0;
      try {
        length = el.getTotalLength();
      } catch {
        continue;
      }
      if (!(length > 0)) continue;
      const step = Math.max(1.5, length / 600);
      const points = [];
      for (let d = 0; d <= length + 0.01; d += step) {
        const p = el.getPointAtLength(Math.min(d, length)).matrixTransform(m);
        points.push([p.x, p.y]);
      }
      const hasStroke = cs.stroke && cs.stroke !== "none";
      const hasFill = cs.fill && cs.fill !== "none" && Number(cs.fillOpacity) !== 0;
      const scale = Math.hypot(m.a, m.b) || 1;
      elements.push({
        kind: "shape",
        points,
        length: length * scale,
        // Gradient/pattern paints have no single colour; draw the line in a neutral ink.
        stroke: hasStroke ? (cs.stroke.startsWith("url(") ? "#334155" : cs.stroke) : hasFill && !cs.fill.startsWith("url(") ? cs.fill : "#334155",
        strokeWidth: hasStroke ? parseFloat(cs.strokeWidth) * scale || 1 : Math.max(1.5, 2 * scale),
        cap: cs.strokeLinecap || "round",
        join: cs.strokeLinejoin || "round",
        alpha: opacity * (hasStroke ? Number(cs.strokeOpacity) || 1 : 1),
        fill: hasFill,
        clip: shapePath(el, m),
      });
    }
    const parsed = { width, height, elements };
    host.textContent = "";
    cache.set(source, parsed);
    return parsed;
  }

  // The element's outline as a Path2D in root SVG coordinates (for clipping its fill).
  function shapePath(el, m) {
    const tag = el.tagName.toLowerCase();
    const n = (a) => el[a]?.baseVal?.value ?? 0;
    let d = "";
    if (tag === "path") d = el.getAttribute("d") || "";
    else if (tag === "rect") {
      const x = n("x"), y = n("y"), w = n("width"), h = n("height");
      const rx = Math.min(n("rx") || n("ry"), w / 2), ry = Math.min(n("ry") || n("rx"), h / 2);
      d = rx || ry
        ? `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
        : `M${x} ${y}h${w}v${h}h${-w}Z`;
    } else if (tag === "circle" || tag === "ellipse") {
      const cx = n("cx"), cy = n("cy");
      const rx = tag === "circle" ? n("r") : n("rx"), ry = tag === "circle" ? n("r") : n("ry");
      d = `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
    } else if (tag === "polygon" || tag === "polyline") {
      const pts = [...el.points].map((p) => `${p.x} ${p.y}`);
      d = pts.length ? `M${pts.join("L")}${tag === "polygon" ? "Z" : ""}` : "";
    }
    if (!d) return null;
    const p = new Path2D();
    p.addPath(new Path2D(d), m);
    return p;
  }

  // ── Animation (runs inside the engine's per-layer slot) ──────────────────
  function setup() {
    const slot = state._currentSlot;
    if (!slot) return;
    const layer = slot.layer;
    const parsed = layer.svgSource ? parse(layer.svgSource) : null;
    // Pixels drawn per animation step, scaled with the canvas so speed looks the same at 4K.
    const speed = layer.speed ?? 50;
    const perStep = (2 + speed * 0.34) * resScale();
    const kx = layer.w / (parsed?.width || 1);
    const ky = layer.h / (parsed?.height || 1);
    const items = (parsed?.elements || []).map((e) => ({ ...e, len: Math.max(8, e.length * Math.max(kx, ky)) }));
    slot._svg = { items, index: 0, done: 0, fill: 0, kx, ky, perStep, wipe: 0, fallback: !items.length };
  }

  const FILL_STEPS = 14;

  function toCanvas(layer, s, x, y) {
    return [layer.x + x * s.kx, layer.y + y * s.ky];
  }

  function strokePartial(c, layer, s, item, upto) {
    const pts = item.points;
    const last = Math.max(1, Math.min(pts.length - 1, Math.round((pts.length - 1) * upto)));
    c.save();
    c.globalAlpha = (layer.opacity ?? 1) * item.alpha;
    c.strokeStyle = item.stroke;
    c.lineWidth = item.strokeWidth * Math.max(s.kx, s.ky);
    c.lineCap = item.cap;
    c.lineJoin = item.join;
    c.beginPath();
    for (let i = 0; i <= last; i++) {
      const [x, y] = toCanvas(layer, s, pts[i][0], pts[i][1]);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
    c.restore();
    return toCanvas(layer, s, pts[last][0], pts[last][1]);
  }

  // The finished look of an element, from the layer's own rendered image, clipped.
  function revealRegion(c, layer, s, item, alpha) {
    c.save();
    c.globalAlpha = alpha;
    c.beginPath();
    if (item.kind === "text") {
      const [x, y] = toCanvas(layer, s, item.box.x, item.box.y);
      c.rect(x - 4, y - 4, item.box.w * s.kx * item.wipe + 8, item.box.h * s.ky + 8);
      c.clip();
    } else {
      if (!item.clip) {
        c.restore();
        return;
      }
      c.setTransform(c.getTransform().translate(layer.x, layer.y).scale(s.kx, s.ky));
      c.clip(item.clip);
      c.resetTransform();
    }
    c.drawImage(offscreen, 0, 0);
    c.restore();
  }

  function tick() {
    const slot = state._currentSlot;
    if (!slot) return;
    if (!slot._svg) setup();
    const s = slot._svg;
    const layer = slot.layer;
    fillBg(ctx); // clears this layer's slot canvas

    if (s.fallback) {
      // Not vector art: reveal left to right.
      s.wipe = Math.min(1, s.wipe + s.perStep / Math.max(1, layer.w));
      ctx.save();
      ctx.beginPath();
      ctx.rect(layer.x, layer.y, layer.w * s.wipe, layer.h);
      ctx.clip();
      ctx.drawImage(offscreen, 0, 0);
      ctx.restore();
      drawHand(hctx, layer.x + layer.w * s.wipe, layer.y + layer.h * 0.6, 0, state.hand);
      setProgress(s.wipe);
      if (s.wipe >= 1) finishAnim();
      return;
    }

    // Finished elements first.
    for (let i = 0; i < s.index; i++) {
      const item = s.items[i];
      if (item.kind === "text") {
        item.wipe = 1;
        revealRegion(ctx, layer, s, item, 1);
      } else {
        if (item.fill) revealRegion(ctx, layer, s, item, 1);
        strokePartial(ctx, layer, s, item, 1);
      }
    }

    const item = s.items[s.index];
    let tip = null;
    if (item) {
      if (item.kind === "text") {
        item.wipe = Math.min(1, (item.wipe || 0) + s.perStep / Math.max(8, item.box.w * s.kx));
        revealRegion(ctx, layer, s, item, 1);
        tip = toCanvas(layer, s, item.box.x + item.box.w * item.wipe, item.box.y + item.box.h * 0.75);
        if (item.wipe >= 1) s.index++;
      } else if (s.fill === 0) {
        s.done = Math.min(item.len, s.done + s.perStep);
        tip = strokePartial(ctx, layer, s, item, s.done / item.len);
        if (s.done >= item.len) {
          if (item.fill) s.fill = 1;
          else {
            s.index++;
            s.done = 0;
          }
        }
      } else {
        // Fill fades in after the outline, the hand resting where the outline ended.
        revealRegion(ctx, layer, s, item, s.fill / FILL_STEPS);
        tip = strokePartial(ctx, layer, s, item, 1);
        if (++s.fill > FILL_STEPS) {
          s.fill = 0;
          s.done = 0;
          s.index++;
        }
      }
    }
    if (tip) drawHand(hctx, tip[0], tip[1], 0, state.hand);

    const total = s.items.reduce((t, x) => t + x.len, 0) || 1;
    const drawnSoFar = s.items.slice(0, s.index).reduce((t, x) => t + x.len, 0) + (item && item.kind !== "text" ? s.done : 0);
    setProgress(Math.min(1, drawnSoFar / total));
    if (s.index >= s.items.length) finishAnim();
  }

  window.inkSvgDraw = { STYLE, setup, tick, parse };

  // ── Animation Style card: a "Vector" group ───────────────────────────────
  const entrance = [...document.querySelectorAll(".anim-section-divider")].find((d) => /Entrance/.test(d.textContent));
  const anchor = entrance || [...document.querySelectorAll(".anim-section-divider")].find((d) => /Specialized/.test(d.textContent));
  if (anchor) {
    const divider = document.createElement("div");
    divider.className = "anim-section-divider";
    divider.textContent = "Vector";
    const hint = document.createElement("div");
    hint.style.cssText = "font-size:9px;color:var(--muted);margin-bottom:4px;line-height:1.4";
    hint.textContent = "For shapes and SVG: draws the real strokes, then the fills.";
    const grid = document.createElement("div");
    grid.className = "anim-grid";
    grid.innerHTML = `<div class="anim-opt" data-anim="${STYLE}" onclick="selectAnim(this)" title="Trace each stroke with the hand, then fade in the fills">Draw strokes</div>`;
    anchor.before(divider, hint, grid);
  }
})();
