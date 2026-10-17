// Shapes: a third input tab (Image · Text · Shapes) with ready shapes for explainer videos:
// boxes, circles, arrows, stars, speech bubbles, check marks, underlines, braces, a circled
// highlight. Each is SVG generated at the layer's own size (strokes never stretch) and drawn
// stroke by stroke (features/svg-draw.js). Colours, line width and a hand-drawn wobble stay
// editable on the selected shape.
(() => {
  registerLayerFields("shape");

  // ── Geometry: each returns SVG markup for a W×H box, inset by the stroke ──
  // A small seeded random, so a hand-drawn shape keeps its wobble when it is regenerated.
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  // Straight segments through the points, nudged when rough (closed = back to the start).
  function polyPath(pts, closed, rough, rand) {
    const j = (v) => v + (rough ? (rand() - 0.5) * rough : 0);
    let d = `M${j(pts[0][0])} ${j(pts[0][1])}`;
    const all = closed ? [...pts.slice(1), pts[0]] : pts.slice(1);
    let prev = pts[0];
    for (const p of all) {
      if (rough) {
        // A slight bow in the middle of each edge, like a hand-drawn line.
        const mx = (prev[0] + p[0]) / 2 + (rand() - 0.5) * rough * 2;
        const my = (prev[1] + p[1]) / 2 + (rand() - 0.5) * rough * 2;
        d += ` Q${mx} ${my} ${j(p[0])} ${j(p[1])}`;
      } else d += ` L${p[0]} ${p[1]}`;
      prev = p;
    }
    return d + (closed && !rough ? "Z" : "");
  }

  function arrowHead(x, y, angle, size) {
    const a1 = angle + Math.PI - 0.5;
    const a2 = angle + Math.PI + 0.5;
    return `M${x + Math.cos(a1) * size} ${y + Math.sin(a1) * size} L${x} ${y} L${x + Math.cos(a2) * size} ${y + Math.sin(a2) * size}`;
  }

  const SHAPES = {
    rect: { name: "Box", size: [420, 260], closed: true, pts: (W, H, p) => [[p, p], [W - p, p], [W - p, H - p], [p, H - p]] },
    rounded: {
      name: "Rounded box", size: [420, 260],
      d: (W, H, p) => {
        const r = Math.min(W, H) * 0.16;
        return `M${p + r} ${p}H${W - p - r}Q${W - p} ${p} ${W - p} ${p + r}V${H - p - r}Q${W - p} ${H - p} ${W - p - r} ${H - p}H${p + r}Q${p} ${H - p} ${p} ${H - p - r}V${p + r}Q${p} ${p} ${p + r} ${p}Z`;
      },
    },
    circle: {
      name: "Circle", size: [320, 320],
      d: (W, H, p) => `M${p} ${H / 2}A${W / 2 - p} ${H / 2 - p} 0 1 1 ${W - p} ${H / 2}A${W / 2 - p} ${H / 2 - p} 0 1 1 ${p} ${H / 2}Z`,
    },
    triangle: { name: "Triangle", size: [340, 300], closed: true, pts: (W, H, p) => [[W / 2, p], [W - p, H - p], [p, H - p]] },
    diamond: { name: "Diamond", size: [320, 320], closed: true, pts: (W, H, p) => [[W / 2, p], [W - p, H / 2], [W / 2, H - p], [p, H / 2]] },
    hexagon: {
      name: "Hexagon", size: [340, 300], closed: true,
      pts: (W, H, p) => [[W * 0.25, p], [W * 0.75, p], [W - p, H / 2], [W * 0.75, H - p], [W * 0.25, H - p], [p, H / 2]],
    },
    star: {
      name: "Star", size: [340, 330], closed: true,
      pts: (W, H, p) => Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.42 : 1;
        return [W / 2 + Math.cos(a) * (W / 2 - p) * r, H * 0.53 + Math.sin(a) * (H / 2 - p) * r];
      }),
    },
    heart: {
      name: "Heart", size: [340, 310],
      d: (W, H, p) => `M${W / 2} ${H - p}C${W * 0.15} ${H * 0.7} ${p} ${H * 0.45} ${p} ${H * 0.28}C${p} ${p} ${W * 0.45} ${p * 0.6} ${W / 2} ${H * 0.3}C${W * 0.55} ${p * 0.6} ${W - p} ${p} ${W - p} ${H * 0.28}C${W - p} ${H * 0.45} ${W * 0.85} ${H * 0.7} ${W / 2} ${H - p}Z`,
    },
    line: { name: "Line", size: [520, 60], open: true, pts: (W, H, p) => [[p, H / 2], [W - p, H / 2]] },
    arrow: {
      name: "Arrow", size: [520, 140], open: true,
      d: (W, H, p, sw) => `M${p} ${H / 2}L${W - p} ${H / 2} ${arrowHead(W - p, H / 2, 0, Math.min(H / 2 - p, 60 + sw))}`,
    },
    double: {
      name: "Double arrow", size: [520, 140], open: true,
      d: (W, H, p, sw) => {
        const s = Math.min(H / 2 - p, 60 + sw);
        return `M${p} ${H / 2}L${W - p} ${H / 2} ${arrowHead(W - p, H / 2, 0, s)} ${arrowHead(p, H / 2, Math.PI, s)}`;
      },
    },
    curved: {
      name: "Curved arrow", size: [480, 280], open: true,
      d: (W, H, p, sw) => {
        const x2 = W - p, y2 = H * 0.62;
        const cx = W * 0.5, cy = p - H * 0.25;
        const a = Math.atan2(y2 - cy, x2 - cx);
        return `M${p} ${H * 0.62}Q${cx} ${cy} ${x2} ${y2} ${arrowHead(x2, y2, a, Math.min(70, 40 + sw * 2))}`;
      },
    },
    speech: {
      name: "Speech bubble", size: [440, 320],
      d: (W, H, p) => {
        const b = H * 0.74, r = Math.min(W, b) * 0.18;
        return `M${p + r} ${p}H${W - p - r}Q${W - p} ${p} ${W - p} ${p + r}V${b - r}Q${W - p} ${b} ${W - p - r} ${b}H${W * 0.42}L${W * 0.22} ${H - p}L${W * 0.27} ${b}H${p + r}Q${p} ${b} ${p} ${b - r}V${p + r}Q${p} ${p} ${p + r} ${p}Z`;
      },
    },
    thought: {
      name: "Thought bubble", size: [440, 340],
      d: (W, H, p) => {
        const cy = H * 0.4, rx = W / 2 - p, ry = H * 0.36;
        let d = "";
        const n = 9;
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const x = W / 2 + Math.cos(a) * rx * 0.86, y = cy + Math.sin(a) * ry * 0.82;
          if (i === 0) d += `M${x} ${y}`;
          else {
            const am = ((i - 0.5) / n) * Math.PI * 2;
            d += ` Q${W / 2 + Math.cos(am) * rx * 1.12} ${cy + Math.sin(am) * ry * 1.12} ${x} ${y}`;
          }
        }
        const c = (x, y, r) => ` M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
        return d + "Z" + c(W * 0.3, H * 0.85, Math.min(W, H) * 0.06) + c(W * 0.2, H - p - Math.min(W, H) * 0.035, Math.min(W, H) * 0.035);
      },
    },
    check: { name: "Check mark", size: [240, 200], open: true, pts: (W, H, p) => [[p, H * 0.55], [W * 0.38, H - p], [W - p, p]] },
    cross: { name: "Cross", size: [220, 220], open: true, d: (W, H, p) => `M${p} ${p}L${W - p} ${H - p}M${W - p} ${p}L${p} ${H - p}` },
    underline: {
      name: "Squiggle", size: [520, 80], open: true,
      d: (W, H, p) => {
        const n = 6, step = (W - p * 2) / n;
        let d = `M${p} ${H / 2}`;
        for (let i = 0; i < n; i++) d += ` q${step / 2} ${i % 2 ? H * 0.38 : -H * 0.38} ${step} 0`;
        return d;
      },
    },
    brace: {
      name: "Brace", size: [120, 420], open: true,
      d: (W, H, p) => `M${W - p} ${p}C${W * 0.35} ${p} ${W * 0.6} ${H * 0.45} ${p} ${H / 2}C${W * 0.6} ${H * 0.55} ${W * 0.35} ${H - p} ${W - p} ${H - p}`,
    },
    circled: {
      name: "Circle around", size: [480, 260], open: true,
      d: (W, H, p) => {
        // An oval drawn round something, overshooting where the pen started.
        const cx = W / 2, cy = H / 2, rx = W / 2 - p, ry = H / 2 - p;
        let d = "";
        const turns = 1.12, n = 48;
        for (let i = 0; i <= n; i++) {
          const a = -Math.PI * 0.85 + (i / n) * Math.PI * 2 * turns;
          const k = 1 - 0.06 * (i / n);
          d += `${i ? "L" : "M"}${cx + Math.cos(a) * rx * k} ${cy + Math.sin(a) * ry * (0.94 + 0.06 * k)}`;
        }
        return d;
      },
    },
  };

  // Hand-drawn wobble for curved shapes: sample each sub-path and redraw it through slightly
  // displaced points (smooth noise across the normal), keeping the same overall shape.
  const probe = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  probe.style.cssText = "position:fixed;left:-20000px;top:0;visibility:hidden";
  document.body.appendChild(probe);
  function roughenPath(d, amount, rand) {
    return d
      .split(/(?=M)/)
      .map((sub) => {
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", sub);
        probe.appendChild(p);
        const L = p.getTotalLength();
        const n = Math.max(4, Math.round(L / 28));
        const phase = rand() * 10;
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const a = p.getPointAtLength((i / n) * L);
          const b = p.getPointAtLength(Math.min(L, (i / n) * L + 1));
          const nx = -(b.y - a.y), ny = b.x - a.x, len = Math.hypot(nx, ny) || 1;
          const off = Math.sin(i * 0.9 + phase) * amount * 0.6 + (rand() - 0.5) * amount * 0.5;
          pts.push([a.x + (nx / len) * off, a.y + (ny / len) * off]);
        }
        p.remove();
        let out = `M${pts[0][0]} ${pts[0][1]}`;
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
          out += ` Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
        }
        const last = pts[pts.length - 1];
        return out + ` L${last[0]} ${last[1]}`;
      })
      .join(" ");
  }

  function makeSVG(spec, W, H) {
    const def = SHAPES[spec.type];
    const sw = spec.width;
    const pad = sw / 2 + 4 + (spec.rough ? sw : 0);
    const rand = rng(spec.seed || 1);
    const rough = spec.rough ? Math.max(2, sw * 0.55) : 0;
    let d = def.pts ? polyPath(def.pts(W, H, pad), !!def.closed, rough, rand) : def.d(W, H, pad, sw);
    const smoothD = d;
    if (rough && !def.pts) d = roughenPath(d, rough, rand);
    const fill = def.open || !spec.fill ? "none" : spec.fill;
    let body = `<path d="${d}" fill="${fill}" stroke="${spec.stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    // Hand-drawn: a second, offset pass of the outline, like a real marker.
    if (spec.rough) {
      const second = def.pts ? polyPath(def.pts(W, H, pad), !!def.closed, rough, rand) : roughenPath(smoothD, rough, rand);
      body += `<path d="${second}" fill="none" stroke="${spec.stroke}" stroke-width="${Math.max(1, sw * 0.45)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
  }

  const loadSVG = (svg) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not draw the shape"));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });

  // ── Current tool settings ─────────────────────────────────────────────────
  const STROKES = ["#1f2937", "#e5484d", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#ffffff"];
  const FILLS = [null, "#fee2e2", "#dbeafe", "#dcfce7", "#fef3c7", "#ede9fe", "#f3f4f6", "#e5484d", "#2563eb", "#16a34a", "#f59e0b", "#1f2937"];
  const tool = { stroke: STROKES[0], fill: null, width: 8, rough: false };

  async function addShape(type) {
    const def = SHAPES[type];
    const k = Math.max(0.6, Math.min(state.canvasW / 1920, state.canvasH / 1080) * 1.6);
    const W = Math.round(def.size[0] * k);
    const H = Math.round(def.size[1] * k);
    const spec = { type, stroke: tool.stroke, fill: tool.fill, width: Math.round(tool.width * k), rough: tool.rough, seed: Math.floor(Math.random() * 1e9) };
    const svg = makeSVG(spec, W, H);
    const img = await loadSVG(svg);
    addLayer(img, def.name);
    const layer = state.layers[state.layers.length - 1];
    Object.assign(layer, {
      w: W, h: H, baseW: W, baseH: H, resizePct: 100,
      x: Math.round((state.canvasW - W) / 2), y: Math.round((state.canvasH - H) / 2),
      shape: spec, svgSource: svg, animStyle: "svg-draw", speed: 28,
    });
    redrawLayersOnCanvas();
    renderLayerList();
    selectLayer(layer.id);
    scheduleAutoSave();
  }

  // Rebuilds a shape layer's image at its current size (after a resize or style change).
  async function regenerate(layer, patch = {}) {
    if (!layer?.shape) return;
    layer.shape = { ...layer.shape, ...patch };
    const W = Math.max(8, Math.round(layer.w));
    const H = Math.max(8, Math.round(layer.h));
    const svg = makeSVG(layer.shape, W, H);
    layer.img = await loadSVG(svg);
    layer.svgSource = svg;
    redrawLayersOnCanvas();
    drawSelectionHandles();
    renderLayerList();
    scheduleAutoSave();
  }

  // A resize by dragging stretches the image; redraw the shape at the new size instead.
  const originalSyncResize = window.syncLayerResizeFromCurrentSize;
  window.syncLayerResizeFromCurrentSize = function (layer, ...rest) {
    const r = originalSyncResize.call(this, layer, ...rest);
    if (layer?.shape) regenerate(layer);
    return r;
  };

  // ── Panel ─────────────────────────────────────────────────────────────────
  const tabs = document.querySelector(".tab-group");
  const textPanel = document.getElementById("text-panel");
  if (!tabs || !textPanel) return;
  const tabBtn = document.createElement("button");
  tabBtn.className = "tab-btn";
  tabBtn.textContent = "Shapes";
  tabBtn.setAttribute("onclick", "switchTab('shapes')");
  tabs.appendChild(tabBtn);

  const icon = (type) => {
    const svg = makeSVG({ type, stroke: "currentColor", fill: null, width: 10, rough: false }, ...SHAPES[type].size);
    return svg.replace("<svg ", '<svg class="sh-ico" preserveAspectRatio="xMidYMid meet" ').replace(/ width="\d+" height="\d+"/, "");
  };
  const panel = document.createElement("div");
  panel.id = "shape-panel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="section-label">Shapes</div>
    <div class="sh-grid">${Object.entries(SHAPES).map(([k, s]) => `<button type="button" data-shape="${k}" title="${s.name}">${icon(k)}</button>`).join("")}</div>
    <div class="section-label" style="margin-top:12px">Line colour</div>
    <div class="sh-swatches" data-role="stroke">${STROKES.map((c) => `<button type="button" data-color="${c}" style="--c:${c}"></button>`).join("")}</div>
    <div class="section-label" style="margin-top:10px">Fill</div>
    <div class="sh-swatches" data-role="fill">${FILLS.map((c) => `<button type="button" data-color="${c ?? ""}" ${c ? `style="--c:${c}"` : 'class="none" title="No fill"'}></button>`).join("")}</div>
    <div class="section-label" style="margin-top:10px">Line width</div>
    <div class="slider-row"><input type="range" min="2" max="28" step="1" id="sh-width"><span class="slider-val" id="sh-width-val"></span></div>
    <div class="toggle-row" style="margin-top:8px"><span class="toggle-label">Hand-drawn look</span><button class="toggle off" id="sh-rough"></button></div>
    <div class="sh-hint">Click a shape to add it. Select a shape on the canvas to change it.</div>`;
  textPanel.after(panel);

  const widthIn = panel.querySelector("#sh-width");
  const roughBtn = panel.querySelector("#sh-rough");

  // The panel edits the selected shape when there is one, otherwise the next new shape.
  const selectedShape = () => {
    const l = getSelectedLayer();
    return l?.shape ? l : null;
  };
  function syncPanel() {
    const l = selectedShape();
    const s = l ? l.shape : tool;
    panel.querySelectorAll('[data-role="stroke"] button').forEach((b) => b.classList.toggle("active", b.dataset.color === s.stroke));
    panel.querySelectorAll('[data-role="fill"] button').forEach((b) => b.classList.toggle("active", (b.dataset.color || null) === (s.fill || null)));
    widthIn.value = l ? Math.round(s.width / Math.max(0.6, Math.min(state.canvasW / 1920, state.canvasH / 1080) * 1.6)) : s.width;
    panel.querySelector("#sh-width-val").textContent = widthIn.value;
    roughBtn.classList.toggle("on", !!s.rough);
    roughBtn.classList.toggle("off", !s.rough);
    if (typeof updateSliderFill === "function") updateSliderFill(widthIn);
  }
  function change(patch) {
    const l = selectedShape();
    if (l) {
      pushUndoSnapshot();
      const k = Math.max(0.6, Math.min(state.canvasW / 1920, state.canvasH / 1080) * 1.6);
      if (patch.width != null) patch.width = Math.round(patch.width * k);
      regenerate(l, patch);
    }
    // Either way, the next new shape uses the latest choice too.
    Object.assign(tool, { ...patch, ...(patch.width != null && l ? { width: Number(widthIn.value) } : {}) });
    syncPanel();
  }

  panel.addEventListener("click", (e) => {
    const shapeBtn = e.target.closest("[data-shape]");
    if (shapeBtn) return addShape(shapeBtn.dataset.shape);
    const sw = e.target.closest(".sh-swatches button");
    if (sw) {
      const role = sw.parentElement.dataset.role;
      change({ [role]: sw.dataset.color || null });
    }
    if (e.target === roughBtn) change({ rough: !(selectedShape()?.shape.rough ?? tool.rough) });
  });
  widthIn.addEventListener("input", () => {
    panel.querySelector("#sh-width-val").textContent = widthIn.value;
    if (typeof updateSliderFill === "function") updateSliderFill(widthIn);
  });
  widthIn.addEventListener("change", () => change({ width: Number(widthIn.value) }));

  const originalSwitch = window.switchTab;
  window.switchTab = function (m) {
    originalSwitch.call(this, m === "shapes" ? "none" : m);
    state.mode = m;
    panel.style.display = m === "shapes" ? "block" : "none";
    document.querySelectorAll(".tab-group .tab-btn").forEach((b) => b.classList.toggle("active", b.getAttribute("onclick")?.includes(`'${m}'`)));
    if (m === "shapes") syncPanel();
  };
  const originalSelect = window.selectLayer;
  window.selectLayer = function (...args) {
    const r = originalSelect.apply(this, args);
    if (state.mode === "shapes") syncPanel();
    return r;
  };
  syncPanel();

  window.inkShapes = { SHAPES, makeSVG, addShape, regenerate };
})();
