// Template gallery: "Start from a template" under New Project opens a gallery of complete
// example videos (features/template-library.js). Picking one creates a new project and
// builds every scene with real layers, text, backgrounds, camera and transitions, so it can
// be played, exported or edited like any project.
(() => {
  const TEMPLATES = window.INK_TEMPLATES || [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const svgURL = (s) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load a template image"));
      img.src = src;
    });

  // ── Building a project ────────────────────────────────────────────────────
  async function addText(def, hand) {
    const font = def.font || "Caveat";
    const size = def.size || 72;
    await document.fonts.load(`${def.bold ? "700 " : ""}${size}px "${font}"`).catch(() => {});
    Object.assign(_ts, {
      font,
      size,
      bold: !!def.bold,
      italic: false,
      align: "left",
      color: def.color || "#1a1a1a",
      lineHeight: 1.2,
      spacing: 0,
    });
    const before = new Set(state.layers);
    openTextEditor(def.x, def.y, null);
    document.getElementById("text-editor-ta").value = def.text;
    closeTextEditor(true);
    // The text tool adds the layer once its rendered image has loaded.
    let layer = null;
    for (let i = 0; i < 200 && !layer; i++) {
      layer = state.layers.find((l) => l && !before.has(l) && l.kind === "text");
      if (!layer) await wait(10);
    }
    if (!layer) throw new Error(`text "${def.text}" was not added`);
    layer.name = def.text.slice(0, 40);
    applyLayerSettings(layer, def, hand, "spec-text");
  }

  async function addImage(def, hand, index) {
    const img = await loadImage(svgURL(def.art));
    addLayer(img, def.name || `Illustration ${index + 1}`);
    const layer = state.layers[state.layers.length - 1];
    Object.assign(layer, { x: def.x, y: def.y, w: def.w, h: def.h, baseW: def.w, baseH: def.h, resizePct: 100 });
    layer.svgSource = def.art; // drawn stroke by stroke (features/svg-draw.js)
    applyLayerSettings(layer, def, hand, "svg-draw");
  }

  function applyLayerSettings(layer, def, hand, defaultAnim) {
    layer.animStyle = def.anim || defaultAnim;
    layer.speed = def.speed ?? 50;
    layer.handSpeed = def.handSpeed ?? 8;
    layer.hand = def.hand || hand || "custom1";
    for (const k of ["enterFrom", "camera", "pauseAfter", "outlineStrokeStyle", "colorStyle", "animOrder"]) {
      if (def[k] !== undefined) layer[k] = def[k];
    }
  }

  async function build(t) {
    const busy = showBusy(`Creating “${t.title}”…`);
    const savedTs = { ..._ts };
    try {
      await new Promise((resolve) => {
        window.addEventListener("inkplainer:project-loaded", resolve, { once: true });
        createNewProject();
      });
      await wait(150);
      // 1080p, 16:9 (the template coordinates).
      document.querySelector('.ratio-btn[data-ratio="16:9"]')?.click();
      document.querySelector('.res-btn[data-res="1080"]')?.click();
      await wait(350);

      for (const [i, sceneDef] of t.scenes.entries()) {
        busy.text(`Creating “${t.title}”: scene ${i + 1} of ${t.scenes.length}`);
        if (i > 0) inkScenes.add();
        const scene = inkScenes.currentScene;
        scene.name = sceneDef.name || "";
        scene.hold = sceneDef.hold ?? 1;
        if (sceneDef.transition) scene.transition = { ...scene.transition, ...sceneDef.transition };
        scene.camera = { mode: "off", zoom: 1.8, ending: "wide", ...(sceneDef.camera || {}) };
        if (sceneDef.bg) selectBgPreset(document.querySelector(`#bg-presets [data-bg-key="${sceneDef.bg}"]`), "gradient", sceneDef.bg);
        for (const [j, def] of sceneDef.layers.entries()) {
          if (def.type === "text") await addText(def, sceneDef.hand);
          else await addImage(def, sceneDef.hand, j);
        }
        state.selectedLayerId = null;
        redrawLayersOnCanvas();
      }

      inkScenes.clearHistory();
      clearUndoHistory();
      inkScenes.activate(0, { force: true });
      await renameProject(t.title);
      saveProject();
      inkScenes.render();
      showToast(`“${t.title}” is ready. Press Play movie to watch it.`);
    } catch (err) {
      console.error(err);
      showToast(`Could not create the template: ${err.message}`);
    } finally {
      Object.assign(_ts, { ...savedTs, active: false, placing: false, editingId: null });
      busy.close();
    }
  }

  function renameProject(name) {
    return new Promise((resolve) => {
      try {
        const store = db.transaction(["projects"], "readwrite").objectStore("projects");
        const req = store.get(currentProjectId);
        req.onsuccess = () => {
          const project = req.result;
          if (!project) return resolve();
          project.name = name;
          store.put(project).onsuccess = () => resolve();
        };
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
      if (typeof updateProjectNameDisplay === "function") updateProjectNameDisplay(name);
    });
  }

  function showBusy(message) {
    const el = document.createElement("div");
    el.id = "template-busy";
    el.innerHTML = '<div class="tb-card"><div class="tb-spinner"></div><div class="tb-text"></div></div>';
    el.querySelector(".tb-text").textContent = message;
    document.body.appendChild(el);
    return { text: (m) => (el.querySelector(".tb-text").textContent = m), close: () => el.remove() };
  }

  // ── Thumbnails: the first scene as it looks when finished ─────────────────
  async function thumbnail(t, w = 480) {
    const h = Math.round((w * 9) / 16);
    const k = w / 1920;
    const c = document.createElement("canvas");
    c.width = w * 2;
    c.height = h * 2;
    const x = c.getContext("2d");
    x.scale(2, 2);
    const scene = t.scenes[0];
    const bg = document.createElement("canvas");
    bg.width = 1920;
    bg.height = 1080;
    window.inkBackgrounds?.draw(scene.bg || "whiteboard", bg.getContext("2d"), 1920, 1080);
    x.drawImage(bg, 0, 0, w, h);
    x.scale(k, k);
    for (const def of scene.layers) {
      if (def.type === "text") {
        const font = def.font || "Caveat";
        const size = def.size || 72;
        await document.fonts.load(`${def.bold ? "700 " : ""}${size}px "${font}"`).catch(() => {});
        x.font = `${def.bold ? "700 " : ""}${size}px "${font}"`;
        x.fillStyle = def.color || "#1a1a1a";
        x.textBaseline = "top";
        x.fillText(def.text, def.x + size * 0.2, def.y + size * 0.15);
      } else {
        try {
          x.drawImage(await loadImage(svgURL(def.art)), def.x, def.y, def.w, def.h);
        } catch {
          /* skip */
        }
      }
    }
    return c.toDataURL("image/png");
  }

  // ── Gallery ───────────────────────────────────────────────────────────────
  const gallery = document.createElement("div");
  gallery.id = "template-gallery";
  gallery.innerHTML = `
    <div class="tg-window" role="dialog" aria-modal="true" aria-labelledby="tg-title">
      <div class="tg-head">
        <div>
          <div class="tg-title" id="tg-title">Start from a template</div>
          <div class="tg-sub">Complete example videos with scenes, camera moves and transitions. Make one yours.</div>
        </div>
        <button type="button" class="tg-close" title="Close (Esc)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="tg-grid"></div>
    </div>`;
  document.body.appendChild(gallery);
  const grid = gallery.querySelector(".tg-grid");

  for (const t of TEMPLATES) {
    const cameraScenes = t.scenes.filter((s) => s.camera?.mode === "follow").length;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "tg-card";
    card.innerHTML = `
      <div class="tg-thumb"><img alt=""></div>
      <div class="tg-body">
        <div class="tg-name"></div>
        <div class="tg-desc"></div>
        <div class="tg-meta"></div>
      </div>`;
    card.querySelector(".tg-name").textContent = t.title;
    card.querySelector(".tg-desc").textContent = t.desc;
    const meta = [`${t.scenes.length} scenes`, ...(cameraScenes ? ["camera moves"] : []), ...t.tags];
    card.querySelector(".tg-meta").innerHTML = meta.map((m) => `<span>${m}</span>`).join("");
    card.addEventListener("click", () => {
      close();
      if (typeof closeProjectsModal === "function") closeProjectsModal();
      build(t);
    });
    card.dataset.id = t.id;
    grid.appendChild(card);
  }

  let thumbsDone = false;
  async function open() {
    gallery.classList.add("show");
    if (thumbsDone) return;
    thumbsDone = true;
    for (const t of TEMPLATES) {
      const img = grid.querySelector(`[data-id="${t.id}"] img`);
      img.src = await thumbnail(t);
    }
  }
  const close = () => gallery.classList.remove("show");
  gallery.querySelector(".tg-close").addEventListener("click", close);
  gallery.addEventListener("mousedown", (e) => e.target === gallery && close());
  document.addEventListener("keydown", (e) => e.key === "Escape" && gallery.classList.contains("show") && close());

  // The button under New Project in the Projects window.
  const newBtn = document.querySelector(".projects-new-btn");
  if (newBtn) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "projects-template-btn";
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      Start from a template`;
    btn.addEventListener("click", open);
    newBtn.after(btn);
  }

  window.inkTemplates = { open, build: (id) => build(TEMPLATES.find((t) => t.id === id)), list: TEMPLATES };
})();
