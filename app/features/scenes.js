// Scenes: a project is a sequence of scenes (slides), each with its own layers, groups,
// background and undo history, plus a transition into it and a hold at its end.
//
// The scene being edited lives in the app's own state (state.layers, state.groups,
// state.canvasBg), so every existing editor feature works on it unchanged. The other
// scenes are kept here and swapped in when selected. features/movie.js plays them in order.
(() => {
  const TRANSITIONS = [
    { type: "cut", name: "Cut" },
    { type: "fade", name: "Crossfade" },
    { type: "dip-white", name: "Dip to white" },
    { type: "dip-black", name: "Dip to black" },
    { type: "slide-left", name: "Push left" },
    { type: "slide-right", name: "Push right" },
    { type: "slide-up", name: "Push up" },
    { type: "slide-down", name: "Push down" },
    { type: "wipe-left", name: "Wipe left" },
    { type: "wipe-right", name: "Wipe right" },
    { type: "zoom-in", name: "Zoom in" },
    { type: "zoom-out", name: "Zoom out" },
    { type: "iris", name: "Circle reveal" },
  ];
  const DEFAULT_TRANSITION = { type: "fade", duration: 0.8 };
  const DEFAULT_HOLD = 1.0;
  // features/camera.js: off, or follow what is being drawn (zoom = closest zoom allowed).
  const DEFAULT_CAMERA = { mode: "off", zoom: 1.8, ending: "wide" };

  let nextSceneId = 1;
  let scenes = [];
  let current = 0;

  function newScene(fields = {}) {
    return {
      id: nextSceneId++,
      name: "",
      layers: [],
      groups: [],
      canvasBg: { type: "solid", val: "#ffffff" },
      selectedLayerId: null,
      transition: { ...DEFAULT_TRANSITION },
      hold: DEFAULT_HOLD,
      camera: { ...DEFAULT_CAMERA },
      undo: [],
      redo: [],
      ...fields,
    };
  }

  // Copies the editor's state into the current scene object.
  function stash() {
    const s = scenes[current];
    if (!s) return;
    s.layers = state.layers;
    s.groups = state.groups || [];
    s.canvasBg = state.canvasBg;
    s.selectedLayerId = state.selectedLayerId;
  }

  // Puts scene i into the editor's state. With `ui`, also refreshes the editor around it.
  function load(i, { ui = true } = {}) {
    const s = scenes[i];
    current = i;
    if (state.playing || state._activeSlots?.length) resetAnim();
    state.layers = s.layers;
    state.groups = s.groups;
    state.canvasBg = s.canvasBg;
    state.selectedLayerId = s.layers.some((l) => l.id === s.selectedLayerId) ? s.selectedLayerId : null;
    state.bgCanvas = null;
    state.done = false;
    if (!ui) return;
    _undoStack = s.undo;
    _redoStack = s.redo;
    _syncUndoUI();
    hctx.clearRect(0, 0, state.canvasW, state.canvasH);
    redrawLayersOnCanvas();
    renderLayerList();
    drawSelectionHandles();
    if (typeof syncSidebarToLayer === "function") syncSidebarToLayer(state.selectedLayerId);
    if (typeof syncBgUI === "function") syncBgUI();
    render();
    window.dispatchEvent(new CustomEvent("inkplainer:scene-changed", { detail: { index: i } }));
  }

  // opts.ui: refresh the editor (default true). opts.force: reload even if already current.
  function activate(i, opts) {
    if (i < 0 || i >= scenes.length) return;
    if (i === current && opts?.ui !== false && !opts?.force) return;
    if (typeof _ts !== "undefined" && _ts.active) closeTextEditor(true);
    stash();
    const s = scenes[current];
    if (opts?.ui !== false && s) {
      s.undo = _undoStack;
      s.redo = _redoStack;
    }
    load(i, opts);
  }

  function addScene(afterIndex = current, copyFrom = null) {
    if (typeof _ts !== "undefined" && _ts.active) closeTextEditor(true);
    stash();
    const prev = scenes[current];
    prev.undo = _undoStack;
    prev.redo = _redoStack;
    let scene;
    if (copyFrom) {
      // Layer objects are shallow-copied with fresh ids; images are shared (never mutated).
      const idMap = new Map();
      const layers = copyFrom.layers.map((l) => {
        const id = ++_layerIdCounter;
        idMap.set(l.id, id);
        return { ...l, id };
      });
      scene = newScene({
        name: copyFrom.name ? `${copyFrom.name} copy` : "",
        layers,
        groups: JSON.parse(JSON.stringify(copyFrom.groups || [])),
        canvasBg: JSON.parse(JSON.stringify(copyFrom.canvasBg)),
        transition: { ...copyFrom.transition },
        hold: copyFrom.hold,
        camera: { ...copyFrom.camera },
        timing: copyFrom.timing,
      });
    } else {
      // A new scene starts with the background and camera of the one it follows.
      scene = newScene({
        canvasBg: JSON.parse(JSON.stringify(state.canvasBg || { type: "solid", val: "#ffffff" })),
        camera: { ...(prev.camera || DEFAULT_CAMERA) },
      });
    }
    scenes.splice(afterIndex + 1, 0, scene);
    current = afterIndex; // scenes[current] is still the stashed scene
    load(afterIndex + 1);
    scheduleAutoSave();
  }

  function deleteScene(i) {
    if (scenes.length <= 1) {
      showToast("A project needs at least one scene");
      return;
    }
    stash();
    scenes.splice(i, 1);
    const next = Math.min(i, scenes.length - 1);
    if (i === current) {
      load(next);
    } else {
      if (i < current) current--;
      render();
    }
    scheduleAutoSave();
  }

  function moveScene(from, to) {
    if (from === to) return;
    stash();
    const active = scenes[current];
    const [s] = scenes.splice(from, 1);
    scenes.splice(to, 0, s);
    current = scenes.indexOf(active); // the same scene stays active
    render();
    scheduleAutoSave();
  }

  // ── Persistence (called from saveProject; restored on inkplainer:project-loaded) ──
  window.serializeScenes = function () {
    stash();
    return {
      current,
      list: scenes.map((s, i) => {
        const meta = { id: s.id, name: s.name, transition: s.transition, hold: s.hold, camera: s.camera, timing: s.timing };
        // The current scene's layers are saved by the project itself (savedState.layers).
        if (i === current) return { ...meta, live: true };
        return {
          ...meta,
          layers: s.layers.map(serializeLayer),
          groups: s.groups,
          canvasBg: s.canvasBg,
          selectedLayerId: s.selectedLayerId,
        };
      }),
    };
  };

  window.addEventListener("inkplainer:project-loaded", (e) => {
    const saved = e.detail.savedState?.scenes;
    const projectId = e.detail.projectId;
    nextSceneId = 1;
    if (!saved?.list?.length) {
      scenes = [newScene()];
      current = 0;
    } else {
      nextSceneId = Math.max(0, ...saved.list.map((s) => s.id || 0)) + 1;
      current = Math.min(Math.max(0, saved.current || 0), saved.list.length - 1);
      scenes = saved.list.map((d) =>
        newScene({
          id: d.id || nextSceneId++,
          name: d.name || "",
          transition: { ...DEFAULT_TRANSITION, ...(d.transition || {}) },
          hold: Number.isFinite(d.hold) ? d.hold : DEFAULT_HOLD,
          camera: { ...DEFAULT_CAMERA, ...(d.camera || {}) },
          timing: d.timing === "tracks" ? "tracks" : "sequence",
          groups: d.groups || [],
          canvasBg: d.canvasBg || { type: "solid", val: "#ffffff" },
          selectedLayerId: d.selectedLayerId ?? null,
          _pending: d.live ? null : d.layers || [],
        }),
      );
      // Ids must stay unique across all scenes.
      for (const d of saved.list) for (const l of d.layers || []) _layerIdCounter = Math.max(_layerIdCounter, l.id || 0);
      for (const s of scenes) {
        if (!s._pending) continue;
        const pending = s._pending;
        delete s._pending;
        deserializeLayers(pending).then((layers) => {
          if (currentProjectId !== projectId) return;
          s.layers = layers;
          render();
        });
      }
    }
    // The current scene's layers load asynchronously into state.layers; stash keeps up.
    scenes[current].layers = state.layers;
    scenes[current].canvasBg = state.canvasBg;
    render();
    setTimeout(render, 400);
  });

  // ── Thumbnails ────────────────────────────────────────────────────────────
  const THUMB_H = 54;
  // The scene's finished picture (background and every visible layer) at the given height.
  function thumbFor(scene, isCurrent, height = THUMB_H) {
    const W = state.canvasW;
    const H = state.canvasH;
    const k = height / H;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(W * k));
    c.height = height;
    const t = c.getContext("2d");
    t.imageSmoothingQuality = "high";
    if (isCurrent && !state.playing && !state._activeSlots?.length) {
      t.drawImage(canvas, 0, 0, c.width, c.height);
      return c;
    }
    // Draw the scene's background and layers at canvas scale.
    const saved = { bg: state.canvasBg, bgCanvas: state.bgCanvas, slot: state._slotMode };
    state.canvasBg = scene.canvasBg;
    state.bgCanvas = null;
    state._slotMode = false;
    t.save();
    t.scale(k, k);
    try {
      fillBg(t);
    } finally {
      state.canvasBg = saved.bg;
      state.bgCanvas = saved.bgCanvas;
      state._slotMode = saved.slot;
    }
    for (const l of scene.layers) {
      if (l.visible === false || !l.img) continue;
      t.globalAlpha = l.opacity ?? 1;
      t.drawImage(l.img, l.x, l.y, l.w, l.h);
    }
    t.restore();
    return c;
  }

  // ── Storyboard UI ─────────────────────────────────────────────────────────
  const main = document.getElementById("canvas-area")?.parentElement;
  const bottomBar = document.getElementById("bottom-bar");
  if (!main || !bottomBar) return;

  const board = document.createElement("div");
  board.id = "storyboard";
  board.innerHTML = `
    <div class="sb-head">
      <span class="sb-title">Scenes</span>
      <span class="sb-count"></span>
    </div>
    <div class="sb-strip"></div>
    <div class="sb-actions">
      <button type="button" class="sb-play" title="Play the whole movie: every scene, with transitions and camera">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M7 4.5v15l12-7.5z"/></svg>
        Play movie
      </button>
    </div>`;
  main.insertBefore(board, bottomBar);
  const strip = board.querySelector(".sb-strip");

  const icons = {
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
  };
  const svg = (n, s = 12) =>
    `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[n]}</svg>`;

  const transitionName = (t) => TRANSITIONS.find((x) => x.type === t.type)?.name ?? "Cut";

  function render() {
    stash();
    strip.textContent = "";
    const count = board.querySelector(".sb-count");
    if (count) count.textContent = `${scenes.length}`;
    scenes.forEach((s, i) => {
      if (i > 0) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "sb-transition";
        chip.title = `Transition into scene ${i + 1}: ${transitionName(s.transition)}${s.transition.type === "cut" ? "" : `, ${s.transition.duration}s`}`;
        chip.textContent = s.transition.type === "cut" ? "Cut" : `${transitionName(s.transition).split(" ")[0]} ${s.transition.duration}s`;
        chip.addEventListener("click", (e) => openSettings(i, e.currentTarget));
        strip.appendChild(chip);
      }
      const card = document.createElement("div");
      card.className = `sb-scene${i === current ? " active" : ""}`;
      card.draggable = true;
      card.dataset.index = i;
      const thumb = thumbFor(s, i === current);
      thumb.className = "sb-thumb";
      card.appendChild(thumb);
      const label = document.createElement("div");
      label.className = "sb-label";
      label.innerHTML = `<span class="sb-num">${i + 1}</span><span class="sb-name"></span>`;
      label.querySelector(".sb-name").textContent = s.name || `Scene ${i + 1}`;
      card.appendChild(label);
      const tools = document.createElement("div");
      tools.className = "sb-tools";
      tools.innerHTML = `<button type="button" data-act="play" title="Play from this scene (with its transition in)">${svg("play")}</button><button type="button" data-act="dup" title="Duplicate scene">${svg("copy")}</button><button type="button" data-act="del" title="Delete scene">${svg("trash")}</button>`;
      card.appendChild(tools);
      card.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "play") return window.inkPlayer?.play({ from: i });
        if (act === "dup") return addScene(i, scenes[i]);
        if (act === "del") return deleteScene(i);
        activate(i);
      });
      card.addEventListener("dblclick", (e) => {
        if (e.target.closest("[data-act]")) return;
        openSettings(i, card);
      });
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/x-scene", String(i));
        e.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragover", (e) => {
        if ([...e.dataTransfer.types].includes("text/x-scene")) {
          e.preventDefault();
          card.classList.add("drop-target");
        }
      });
      card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
      card.addEventListener("drop", (e) => {
        card.classList.remove("drop-target");
        const from = Number(e.dataTransfer.getData("text/x-scene"));
        if (Number.isFinite(from)) {
          e.preventDefault();
          e.stopPropagation();
          moveScene(from, i);
        }
      });
      strip.appendChild(card);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "sb-add";
    add.title = "Add a scene after the current one";
    add.innerHTML = `${svg("plus", 16)}<span>Scene</span>`;
    add.addEventListener("click", () => addScene(current));
    strip.appendChild(add);
    strip.querySelector(".sb-scene.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // Thumbnails follow edits (every edit schedules an autosave).
  let thumbTimer = 0;
  const originalAutoSave = window.scheduleAutoSave;
  window.scheduleAutoSave = function (...args) {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      if (!state.playing && !inkClock.manual) render();
    }, 600);
    return originalAutoSave.apply(this, args);
  };

  // ── Scene settings popover ────────────────────────────────────────────────
  const pop = document.createElement("div");
  pop.id = "scene-popover";
  pop.innerHTML = `
    <div class="sp-title"></div>
    <label class="sp-field"><span>Name</span><input type="text" class="sp-name" maxlength="60"></label>
    <div class="sp-section">Transition in</div>
    <div class="sp-grid"></div>
    <label class="sp-field sp-dur"><span>Duration</span><input type="range" min="0.2" max="3" step="0.1" class="sp-duration"><b class="sp-duration-val"></b></label>
    <div class="sp-section">End of scene</div>
    <label class="sp-field"><span>Hold</span><input type="range" min="0" max="6" step="0.25" class="sp-hold"><b class="sp-hold-val"></b></label>`;
  document.body.appendChild(pop);
  const grid = pop.querySelector(".sp-grid");
  grid.innerHTML = TRANSITIONS.map((t) => `<button type="button" data-type="${t.type}">${t.name}</button>`).join("");
  let editing = -1;

  function syncPopover() {
    const s = scenes[editing];
    if (!s) return;
    pop.querySelector(".sp-title").textContent = `Scene ${editing + 1}`;
    pop.querySelector(".sp-name").value = s.name;
    pop.querySelector(".sp-name").placeholder = `Scene ${editing + 1}`;
    const first = editing === 0;
    pop.querySelectorAll(".sp-section")[0].style.display = first ? "none" : "";
    grid.style.display = first ? "none" : "";
    pop.querySelector(".sp-dur").style.display = first || s.transition.type === "cut" ? "none" : "";
    grid.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.type === s.transition.type));
    pop.querySelector(".sp-duration").value = s.transition.duration;
    pop.querySelector(".sp-duration-val").textContent = `${s.transition.duration.toFixed(1)}s`;
    pop.querySelector(".sp-hold").value = s.hold;
    pop.querySelector(".sp-hold-val").textContent = `${s.hold.toFixed(2).replace(/0$/, "")}s`;
  }

  function openSettings(i, anchor) {
    editing = i;
    syncPopover();
    pop.classList.add("show");
    const r = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pr.width - 8, r.left + r.width / 2 - pr.width / 2))}px`;
    pop.style.top = `${Math.max(8, r.top - pr.height - 8)}px`;
  }
  const closeSettings = () => {
    pop.classList.remove("show");
    editing = -1;
  };
  document.addEventListener("mousedown", (e) => {
    if (pop.classList.contains("show") && !pop.contains(e.target) && !e.target.closest(".sb-transition, .sb-scene")) closeSettings();
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeSettings());

  const changed = () => {
    syncPopover();
    render();
    scheduleAutoSave();
  };
  pop.querySelector(".sp-name").addEventListener("input", (e) => {
    scenes[editing].name = e.target.value.trim();
    render();
    scheduleAutoSave();
  });
  grid.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || editing < 0) return;
    scenes[editing].transition = { ...scenes[editing].transition, type: b.dataset.type };
    changed();
  });
  pop.querySelector(".sp-duration").addEventListener("input", (e) => {
    scenes[editing].transition = { ...scenes[editing].transition, duration: Number(e.target.value) };
    changed();
  });
  pop.querySelector(".sp-hold").addEventListener("input", (e) => {
    scenes[editing].hold = Number(e.target.value);
    changed();
  });

  board.querySelector(".sb-play").addEventListener("click", () => window.inkPlayer?.play());

  // ── Public API (features/movie.js, player.js, export.js) ───────────────────
  window.inkScenes = {
    TRANSITIONS,
    get list() {
      stash();
      return scenes;
    },
    get current() {
      return current;
    },
    get currentScene() {
      return scenes[current];
    },
    activate,
    render,
    /** The finished picture of scene i (background and layers) at the given height. */
    picture: (i, height) => thumbFor(scenes[i], false, height),
    /** Adds an empty scene after the current one and switches to it. */
    add: () => addScene(current),
    /** Drops every scene's undo history (after building a project from a template). */
    clearHistory() {
      for (const s of scenes) {
        s.undo = [];
        s.redo = [];
      }
    },
  };

  scenes = [newScene()];
  render();
})();
