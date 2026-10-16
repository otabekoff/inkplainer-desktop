// Canvas backgrounds: a larger set of presets, and images as backgrounds.
//
// Presets are drawn once per canvas size into a cached canvas (fillBg runs every frame,
// and some presets are textured), with sizes scaled to the canvas so a pattern looks the
// same at 720p and 4K. Thumbnails come from the same drawing code. The original preset keys
// (notebook, graph, cream, chalk, …) are kept, so saved projects still load.
//
// Image backgrounds are stored as { type: 'image', val: dataURL, fit, wash } in
// state.canvasBg, which the project and undo snapshots already save as-is.
(() => {
  // Deterministic noise, so a textured background is identical in every frame.
  function rng(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const unit = (W, H) => Math.min(W, H) / 720;

  function linear(c, W, H, stops, angle = 90) {
    const a = (angle * Math.PI) / 180;
    const dx = Math.cos(a) * W * 0.5;
    const dy = Math.sin(a) * H * 0.5;
    const g = c.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
    stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }
  function radial(c, W, H, inner, outer, cx = 0.5, cy = 0.45) {
    const g = c.createRadialGradient(W * cx, H * cy, 0, W * cx, H * cy, Math.hypot(W, H) * 0.62);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }
  function vignette(c, W, H, alpha) {
    const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${alpha})`);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }
  function grain(c, W, H, { seed = 1, density = 1 / 70, light = 0.035, dark = 0.035, size = 1 } = {}) {
    const r = rng(seed);
    const u = unit(W, H);
    const n = Math.round(W * H * density);
    const s = Math.max(1, size * u);
    for (let i = 0; i < n; i++) {
      c.fillStyle = r() < 0.5 ? `rgba(255,255,255,${light * (0.5 + r())})` : `rgba(0,0,0,${dark * (0.5 + r())})`;
      c.fillRect(r() * W, r() * H, s, s);
    }
  }
  function fibers(c, W, H, { seed = 2, count = 1, color = "0,0,0", alpha = 0.05, length = 14 } = {}) {
    const r = rng(seed);
    const u = unit(W, H);
    const n = Math.round((W * H) / 900 * count);
    c.lineWidth = Math.max(1, 0.8 * u);
    for (let i = 0; i < n; i++) {
      const x = r() * W;
      const y = r() * H;
      const a = r() * Math.PI;
      const l = (4 + r() * length) * u;
      c.strokeStyle = `rgba(${color},${alpha * (0.4 + r())})`;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      c.stroke();
    }
  }
  function smudges(c, W, H, { seed = 3, count = 7, color = "255,255,255", alpha = 0.03 } = {}) {
    const r = rng(seed);
    for (let i = 0; i < count; i++) {
      const x = r() * W;
      const y = r() * H;
      const rad = (0.15 + r() * 0.3) * Math.max(W, H);
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(${color},${alpha})`);
      g.addColorStop(1, `rgba(${color},0)`);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
  }
  function grid(c, W, H, step, color, width, offset = 0) {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    for (let x = offset; x <= W; x += step) {
      c.moveTo(Math.round(x) + 0.5, 0);
      c.lineTo(Math.round(x) + 0.5, H);
    }
    for (let y = offset; y <= H; y += step) {
      c.moveTo(0, Math.round(y) + 0.5);
      c.lineTo(W, Math.round(y) + 0.5);
    }
    c.stroke();
  }

  const PRESETS = [
    {
      key: "whiteboard", name: "Whiteboard",
      draw(c, W, H) {
        linear(c, W, H, ["#ffffff", "#f6f8fa", "#fbfcfd"], 60);
        smudges(c, W, H, { seed: 11, count: 6, color: "120,130,140", alpha: 0.018 });
        vignette(c, W, H, 0.05);
      },
    },
    {
      key: "warmwhite", name: "Paper",
      draw(c, W, H) {
        c.fillStyle = "#fbf8f1";
        c.fillRect(0, 0, W, H);
        grain(c, W, H, { seed: 5, density: 1 / 40, light: 0.05, dark: 0.03 });
        vignette(c, W, H, 0.06);
      },
    },
    {
      key: "notebook", name: "Notebook",
      draw(c, W, H) {
        const u = unit(W, H);
        c.fillStyle = "#fdfdfb";
        c.fillRect(0, 0, W, H);
        grain(c, W, H, { seed: 7, density: 1 / 90, light: 0.03, dark: 0.02 });
        c.strokeStyle = "rgba(96,140,210,0.32)";
        c.lineWidth = Math.max(1, 1.1 * u);
        c.beginPath();
        for (let y = 96 * u; y < H; y += 30 * u) {
          c.moveTo(0, y);
          c.lineTo(W, y);
        }
        c.stroke();
        c.strokeStyle = "rgba(220,90,90,0.45)";
        c.lineWidth = Math.max(1, 1.4 * u);
        c.beginPath();
        c.moveTo(84 * u, 0);
        c.lineTo(84 * u, H);
        c.stroke();
      },
    },
    {
      key: "graph", name: "Graph paper",
      draw(c, W, H) {
        const u = unit(W, H);
        c.fillStyle = "#f8fbfd";
        c.fillRect(0, 0, W, H);
        grid(c, W, H, 20 * u, "rgba(110,150,200,0.16)", Math.max(1, 0.8 * u));
        grid(c, W, H, 100 * u, "rgba(90,130,190,0.30)", Math.max(1, 1.2 * u));
      },
    },
    {
      key: "dots", name: "Dot grid",
      draw(c, W, H) {
        const u = unit(W, H);
        c.fillStyle = "#fafbfc";
        c.fillRect(0, 0, W, H);
        c.fillStyle = "rgba(80,100,130,0.30)";
        const step = 28 * u;
        const r = Math.max(1, 1.5 * u);
        for (let y = step / 2; y < H; y += step) {
          for (let x = step / 2; x < W; x += step) {
            c.beginPath();
            c.arc(x, y, r, 0, Math.PI * 2);
            c.fill();
          }
        }
      },
    },
    {
      key: "isometric", name: "Isometric",
      draw(c, W, H) {
        const u = unit(W, H);
        c.fillStyle = "#fbfcfe";
        c.fillRect(0, 0, W, H);
        c.strokeStyle = "rgba(110,140,190,0.16)";
        c.lineWidth = Math.max(1, 0.8 * u);
        const step = 32 * u;
        const t = Math.tan(Math.PI / 6);
        c.beginPath();
        for (let x = -H / t; x < W + H / t; x += step / t) {
          c.moveTo(x, 0);
          c.lineTo(x + H / t, H);
          c.moveTo(x, 0);
          c.lineTo(x - H / t, H);
        }
        for (let x = 0; x <= W; x += step / t / 2) {
          c.moveTo(x, 0);
          c.lineTo(x, H);
        }
        c.stroke();
      },
    },
    {
      key: "cream", name: "Parchment",
      draw(c, W, H) {
        radial(c, W, H, "#f7eed6", "#e6d1a2");
        grain(c, W, H, { seed: 13, density: 1 / 35, light: 0.05, dark: 0.05 });
        fibers(c, W, H, { seed: 14, count: 0.6, color: "120,80,30", alpha: 0.05 });
        vignette(c, W, H, 0.16);
      },
    },
    {
      key: "kraft", name: "Kraft paper",
      draw(c, W, H) {
        radial(c, W, H, "#d2b183", "#b88f5e");
        fibers(c, W, H, { seed: 17, count: 2.2, color: "60,35,10", alpha: 0.08 });
        fibers(c, W, H, { seed: 18, count: 1.2, color: "255,240,210", alpha: 0.08 });
        vignette(c, W, H, 0.14);
      },
    },
    {
      key: "linen", name: "Linen",
      draw(c, W, H) {
        const u = unit(W, H);
        c.fillStyle = "#f4efe6";
        c.fillRect(0, 0, W, H);
        const r = rng(19);
        c.lineWidth = Math.max(1, 0.7 * u);
        for (let y = 0; y < H; y += 3 * u) {
          c.strokeStyle = `rgba(120,100,70,${0.03 + r() * 0.04})`;
          c.beginPath();
          c.moveTo(0, y);
          c.lineTo(W, y);
          c.stroke();
        }
        for (let x = 0; x < W; x += 3 * u) {
          c.strokeStyle = `rgba(120,100,70,${0.02 + r() * 0.03})`;
          c.beginPath();
          c.moveTo(x, 0);
          c.lineTo(x, H);
          c.stroke();
        }
      },
    },
    {
      key: "cork", name: "Corkboard",
      draw(c, W, H) {
        radial(c, W, H, "#c99d66", "#a87a45");
        grain(c, W, H, { seed: 23, density: 1 / 30, light: 0.07, dark: 0.14, size: 3 });
        vignette(c, W, H, 0.18);
      },
    },
    {
      key: "chalk", name: "Chalkboard",
      draw(c, W, H) {
        radial(c, W, H, "#2f5446", "#14291f");
        smudges(c, W, H, { seed: 29, count: 9, alpha: 0.035 });
        grain(c, W, H, { seed: 30, density: 1 / 30, light: 0.05, dark: 0.04 });
        vignette(c, W, H, 0.3);
      },
    },
    {
      key: "slate", name: "Blackboard",
      draw(c, W, H) {
        radial(c, W, H, "#33383d", "#17191c");
        smudges(c, W, H, { seed: 31, count: 9, alpha: 0.03 });
        grain(c, W, H, { seed: 32, density: 1 / 30, light: 0.045, dark: 0.04 });
        vignette(c, W, H, 0.3);
      },
    },
    {
      key: "blueprint", name: "Blueprint",
      draw(c, W, H) {
        const u = unit(W, H);
        radial(c, W, H, "#225da3", "#123a6c");
        grid(c, W, H, 24 * u, "rgba(255,255,255,0.10)", Math.max(1, 0.8 * u));
        grid(c, W, H, 96 * u, "rgba(255,255,255,0.22)", Math.max(1, 1.2 * u));
        vignette(c, W, H, 0.22);
      },
    },
    {
      key: "dark", name: "Charcoal",
      draw(c, W, H) {
        radial(c, W, H, "#23262c", "#0e1013");
        grain(c, W, H, { seed: 37, density: 1 / 60, light: 0.03, dark: 0.03 });
      },
    },
    {
      key: "softgrad", name: "Pastel",
      draw(c, W, H) {
        linear(c, W, H, ["#f5f0ff", "#e9f4ff", "#effff5"], 35);
        smudges(c, W, H, { seed: 41, count: 5, alpha: 0.25 });
      },
    },
    {
      key: "sky", name: "Sky",
      draw(c, W, H) {
        linear(c, W, H, ["#eaf6ff", "#d3ebff", "#f7fbff"], 90);
        smudges(c, W, H, { seed: 43, count: 6, alpha: 0.35 });
      },
    },
    {
      key: "mint", name: "Mint",
      draw(c, W, H) {
        linear(c, W, H, ["#f3fcf7", "#dff5ea"], 120);
        vignette(c, W, H, 0.04);
      },
    },
    {
      key: "peach", name: "Peach",
      draw(c, W, H) {
        linear(c, W, H, ["#fff6ee", "#ffe2cf"], 120);
        vignette(c, W, H, 0.05);
      },
    },
    {
      key: "sunset", name: "Sunset",
      draw(c, W, H) {
        linear(c, W, H, ["#fff1dc", "#ffd3c0", "#f7c6d9"], 100);
      },
    },
  ];
  const BY_KEY = Object.fromEntries(PRESETS.map((p) => [p.key, p]));

  // ── Cached drawing, registered into the app's BG_GRADIENTS table ─────────
  const cache = new Map();
  function rendered(key, W, H) {
    const id = `${key}@${W}x${H}`;
    let c = cache.get(id);
    if (!c) {
      for (const k of cache.keys()) if (k.startsWith(`${key}@`)) cache.delete(k);
      c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      BY_KEY[key].draw(c.getContext("2d"), W, H);
      cache.set(id, c);
    }
    return c;
  }
  for (const p of PRESETS) {
    BG_GRADIENTS[p.key] = (c) => c.drawImage(rendered(p.key, state.canvasW, state.canvasH), 0, 0);
  }

  // ── Image backgrounds ─────────────────────────────────────────────────────
  const images = new Map();
  function imageFor(src) {
    let img = images.get(src);
    if (!img) {
      images.clear(); // one background image at a time
      img = new Image();
      img.onload = () => {
        if (state.canvasBg?.type === "image" && state.canvasBg.val === src && !state.playing) redrawWithBg();
      };
      img.src = src;
      images.set(src, img);
    }
    return img;
  }

  window.drawImageBackground = function (c, bg) {
    const W = state.canvasW;
    const H = state.canvasH;
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, W, H);
    const img = imageFor(bg.val);
    if (img.complete && img.naturalWidth) {
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      c.save();
      c.imageSmoothingQuality = "high";
      if (bg.fit === "tile") {
        const s = unit(W, H) * Math.min(1, 512 / Math.max(iw, ih)) * 1.5;
        const pattern = c.createPattern(img, "repeat");
        pattern.setTransform(new DOMMatrix().scale(s));
        c.fillStyle = pattern;
        c.fillRect(0, 0, W, H);
      } else if (bg.fit === "stretch") {
        c.drawImage(img, 0, 0, W, H);
      } else {
        const s = bg.fit === "contain" ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih);
        c.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
      }
      c.restore();
    }
    if (bg.wash > 0) {
      c.fillStyle = `rgba(255,255,255,${bg.wash})`;
      c.fillRect(0, 0, W, H);
    }
  };

  // ── selectBgPreset: every type, and safe without a clicked element ───────
  // (Undo restores call it with el = null, which crashed for gradients and turned
  // custom colours white.)
  window.selectBgPreset = function (el, type, val) {
    if (!_undoRestoring) pushUndoSnapshot();
    const prev = state.canvasBg;
    if (type === "solid") {
      state.canvasBg = { type: "solid", val };
      if (val !== "transparent") {
        const hex = val === "white" ? "#ffffff" : val;
        document.getElementById("bg-custom-swatch").style.background = hex;
        document.getElementById("bg-color-input").value = hex;
      }
    } else if (type === "custom") {
      state.canvasBg = { type: "custom", val };
      document.getElementById("bg-custom-swatch").style.background = val;
    } else if (type === "image") {
      state.canvasBg = prev?.type === "image" && prev.val === val ? prev : { type: "image", val, fit: "cover", wash: 0 };
    } else {
      const key = el?.dataset?.bgKey || val;
      state.canvasBg = { type: "gradient", val: key, key };
    }
    syncBgUI();
    redrawWithBg();
    scheduleAutoSave();
  };

  // ── UI: preset grid, image tile and image options ────────────────────────
  const grid_ = document.getElementById("bg-presets");
  if (!grid_) return;

  const thumb = (p) => {
    const big = document.createElement("canvas");
    big.width = 640;
    big.height = 360;
    p.draw(big.getContext("2d"), 640, 360);
    const t = document.createElement("canvas");
    t.width = 160;
    t.height = 90;
    const tc = t.getContext("2d");
    tc.imageSmoothingQuality = "high";
    tc.drawImage(big, 0, 0, 160, 90);
    return t.toDataURL("image/png");
  };

  grid_.innerHTML = "";
  for (const p of PRESETS) {
    const tile = document.createElement("div");
    tile.className = "bg-preset";
    tile.title = p.name;
    tile.dataset.bgKey = p.key;
    // Kept as an attribute: loadProject finds the active tile by this onclick text.
    tile.setAttribute("onclick", `selectBgPreset(this,'gradient','${p.key}')`);
    tile.style.backgroundImage = `url(${thumb(p)})`;
    grid_.appendChild(tile);
  }
  const imageTile = document.createElement("div");
  imageTile.className = "bg-preset bg-image-tile";
  imageTile.title = "Image background";
  imageTile.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>';
  grid_.appendChild(imageTile);

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/*";
  picker.hidden = true;
  document.body.appendChild(picker);
  imageTile.addEventListener("click", () => {
    if (state.canvasBg?.type === "image") syncBgUI(true);
    else picker.click();
  });
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => selectBgPreset(null, "image", reader.result);
    reader.readAsDataURL(file);
  });

  const opts = document.createElement("div");
  opts.id = "bg-image-opts";
  opts.innerHTML = `
    <div class="bg-image-row">
      <span class="bg-image-label">Fit</span>
      <div class="bg-fit-pills">
        <button type="button" data-fit="cover">Cover</button>
        <button type="button" data-fit="contain">Fit</button>
        <button type="button" data-fit="stretch">Stretch</button>
        <button type="button" data-fit="tile">Tile</button>
      </div>
    </div>
    <div class="bg-image-row">
      <span class="bg-image-label" title="Lightens the image so drawings stay readable">Wash</span>
      <input type="range" min="0" max="85" step="1" id="bg-wash">
      <span class="bg-wash-val"></span>
    </div>
    <button type="button" class="bg-image-replace">Replace image…</button>`;
  grid_.after(opts);

  opts.addEventListener("click", (e) => {
    const fitBtn = e.target.closest("[data-fit]");
    if (fitBtn && state.canvasBg?.type === "image") {
      pushUndoSnapshot();
      state.canvasBg = { ...state.canvasBg, fit: fitBtn.dataset.fit };
      syncBgUI();
      redrawWithBg();
      scheduleAutoSave();
    }
    if (e.target.closest(".bg-image-replace")) picker.click();
  });
  const wash = opts.querySelector("#bg-wash");
  wash.addEventListener("pointerdown", () => pushUndoSnapshot());
  wash.addEventListener("input", () => {
    if (state.canvasBg?.type !== "image") return;
    state.canvasBg = { ...state.canvasBg, wash: Number(wash.value) / 100 };
    syncBgUI();
    redrawWithBg();
    scheduleAutoSave();
  });

  function syncBgUI() {
    const bg = state.canvasBg || {};
    document.querySelectorAll(".bg-pill, .bg-preset").forEach((p) => p.classList.remove("active"));
    if (bg.type === "gradient") grid_.querySelector(`[data-bg-key="${bg.key || bg.val}"]`)?.classList.add("active");
    else if (bg.type === "image") imageTile.classList.add("active");
    else if (bg.type === "solid") {
      const which = bg.val === "transparent" ? "transparent" : bg.val === "white" || bg.val === "#ffffff" ? "white" : bg.val === "#000000" ? "#000000" : null;
      if (which) document.querySelector(`.bg-pill[onclick*="'${which}'"]`)?.classList.add("active");
    }
    const isImage = bg.type === "image";
    opts.classList.toggle("show", isImage);
    imageTile.style.backgroundImage = isImage ? `url(${bg.val})` : "";
    imageTile.classList.toggle("has-image", isImage);
    if (isImage) {
      opts.querySelectorAll("[data-fit]").forEach((b) => b.classList.toggle("active", b.dataset.fit === (bg.fit || "cover")));
      wash.value = Math.round((bg.wash || 0) * 100);
      opts.querySelector(".bg-wash-val").textContent = `${wash.value}%`;
    }
  }
  window.syncBgUI = syncBgUI;

  // A loaded project (or undo) may have set an image or custom background directly.
  let lastBg = null;
  setInterval(() => {
    if (state.canvasBg !== lastBg) {
      lastBg = state.canvasBg;
      syncBgUI();
    }
  }, 300);
  syncBgUI();
})();
