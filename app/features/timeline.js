// Timeline for the current scene: the order things are drawn in, as a row of steps.
// Each step is one or more layers that play at the same time (same "Order" number).
//  - drag a step between others to move it; drop it onto another step to play together
//  - drag a single layer out of a step to give it a step of its own
//  - the chip after each step sets a pause before the next one (layer.pauseAfter)
//  - each step shows how long it takes; layers are timed automatically in the background
(() => {
  registerLayerFields("pauseAfter");

  // Steps in play order: visible layers grouped by Order (as the animation does it).
  function steps() {
    const map = new Map();
    for (const l of getAnimOrder()) {
      const key = l.animOrder ?? `__${l.id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(l);
    }
    return [...map.values()];
  }

  // Seconds to wait after step i (the longest pause set on its layers).
  function pauseAfter(i) {
    const group = state._animGroups?.[i];
    if (!group) return 0;
    return Math.max(0, ...group.map((l) => Number(l.pauseAfter) || 0));
  }

  // Writes the given step order back as explicit Order numbers 1..n.
  function applyOrder(list) {
    pushUndoSnapshot();
    list.forEach((group, i) => group.forEach((l) => (l.animOrder = i + 1)));
    renderLayerList();
    scheduleAutoSave();
    render();
  }

  // ── Timing ────────────────────────────────────────────────────────────────
  // Each layer is timed on its own by running just its animation on the manual clock, and
  // the result is cached by everything that affects its length, so after an edit only the
  // changed layers are timed again. A snapshot covers the canvas meanwhile.
  const durations = new Map(); // signature -> seconds
  const imageIds = new WeakMap();
  let nextImageId = 1;
  const imageId = (img) => {
    if (!img) return 0;
    if (!imageIds.has(img)) imageIds.set(img, nextImageId++);
    return imageIds.get(img);
  };
  const SIG_FIELDS = [
    "w", "h", "animStyle", "speed", "handSpeed", "chunks", "specChunks", "zigzag", "hand", "enterFrom",
    "outlineDetect", "outlineAlgorithm", "outlineStrokeStyle", "colorStyle", "textAnimDir", "textDrawStyle",
  ];
  const signature = (l) => [imageId(l.img), state.canvasW, state.canvasH, ...SIG_FIELDS.map((f) => l[f])].join("|");
  const durationOf = (l) => durations.get(signature(l));

  async function timeLayer(layer) {
    const saved = { layers: state.layers, groups: state.groups, selected: state.selectedLayerId };
    let steps = 0;
    let started = false;
    inkClock.enterManual();
    try {
      state.layers = [{ ...layer, visible: true, animOrder: null, pauseAfter: undefined, startAt: 0 }];
      state.groups = [];
      restartAnim();
      let lastYield = inkClock.native.perfNow();
      for (; steps < 60 * 300; steps++) {
        inkClock.step();
        if (!state.done) started = true;
        if (started && isExportAnimationComplete()) break;
        if (!started && steps > 30 && inkClock.idle()) break;
        if (inkClock.native.perfNow() - lastYield > 50) {
          await inkClock.breathe(); // keep the window responsive on heavy layers
          lastYield = inkClock.native.perfNow();
        }
      }
    } finally {
      inkClock.leaveManual();
      resetAnim();
      state.layers = saved.layers;
      state.groups = saved.groups;
      state.selectedLayerId = saved.selected;
      state.bgCanvas = null;
    }
    return steps / inkClock.STEPS_PER_SECOND;
  }

  // While timing: a still of the canvas on top, and clicks held off.
  const cover = document.createElement("canvas");
  cover.id = "tl-cover";
  const blocker = document.createElement("div");
  blocker.id = "tl-blocker";
  blocker.innerHTML = '<span>Timing the timeline…</span>';
  function showCover() {
    cover.width = canvas.width;
    cover.height = canvas.height;
    cover.getContext("2d").drawImage(canvas, 0, 0);
    cover.style.width = canvas.style.width;
    cover.style.height = canvas.style.height;
    canvas.after(cover);
    document.body.appendChild(blocker);
  }
  function hideCover() {
    cover.remove();
    blocker.remove();
  }

  let mouseDown = false;
  document.addEventListener("mousedown", () => (mouseDown = true), true);
  document.addEventListener("mouseup", () => (mouseDown = false), true);
  const busyNow = () =>
    state.playing || state.recording || inkClock.manual || window.inkPlayer?.playing || mouseDown ||
    (typeof _ts !== "undefined" && _ts.active) || (typeof _interact !== "undefined" && _interact);

  let timer = 0;
  let running = false;
  function schedule(delay = 1200) {
    clearTimeout(timer);
    if (board.classList.contains("show-timeline")) timer = setTimeout(timePending, delay);
  }
  async function timePending() {
    if (running) return;
    if (busyNow()) return schedule(800);
    const pending = getAnimOrder().filter((l) => durationOf(l) === undefined);
    if (!pending.length) return render();
    running = true;
    status.textContent = "Timing…";
    showCover();
    try {
      for (const l of pending) durations.set(signature(l), await timeLayer(l));
    } catch (err) {
      console.error("Timing failed:", err);
    } finally {
      hideCover();
      running = false;
      redrawLayersOnCanvas();
      drawSelectionHandles();
      render();
      window.dispatchEvent(new CustomEvent("inkplainer:timing-updated"));
    }
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  const board = document.getElementById("storyboard");
  if (!board) return;
  const tabs = document.createElement("div");
  tabs.className = "sb-tabs";
  tabs.innerHTML = `<button type="button" data-view="scenes" class="active">Scenes <span class="sb-count"></span></button><button type="button" data-view="timeline">Timeline</button>`;
  board.querySelector(".sb-head").replaceWith(tabs);
  inkScenes.render(); // fills the scene count now shown in the tab

  const view = document.createElement("div");
  view.className = "tl-view";
  board.querySelector(".sb-strip").after(view);
  const status = document.createElement("span");
  status.className = "tl-status";
  status.title = "Length of this scene: steps, pauses and the hold at the end";
  board.querySelector(".sb-actions").prepend(status);

  tabs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    tabs.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    board.classList.toggle("show-timeline", b.dataset.view === "timeline");
    if (b.dataset.view === "timeline") {
      render();
      schedule(150);
    }
  });

  const PX_PER_SECOND = 70;
  const thumbOf = (l) => l.img?.src || "";
  let dragging = null; // { kind: 'step'|'layer', step, layerId }

  function render() {
    if (!board.classList.contains("show-timeline")) return;
    const list = steps();
    view.textContent = "";
    if (!list.length) {
      view.innerHTML = '<div class="tl-empty">Add layers to this scene to see their order here.</div>';
      return;
    }
    list.forEach((group, i) => {
      const step = document.createElement("div");
      step.className = "tl-step";
      step.dataset.step = i;
      step.draggable = true;
      const secs = Math.max(...group.map((l) => durationOf(l) || 0));
      if (secs) step.style.minWidth = `${Math.max(96, Math.round(secs * PX_PER_SECOND))}px`;
      step.innerHTML = `<div class="tl-step-head"><span class="tl-idx">${i + 1}</span><span class="tl-time">${secs ? `${secs.toFixed(1)}s` : ""}</span>${group.length > 1 ? '<span class="tl-together">together</span>' : ""}</div>`;
      for (const l of group) {
        const row = document.createElement("div");
        row.className = `tl-layer${l.id === state.selectedLayerId ? " selected" : ""}`;
        row.dataset.layer = l.id;
        row.draggable = group.length > 1;
        row.title = `${l.name} · ${l.animStyle}`;
        row.innerHTML = `<img alt=""><span class="tl-name"></span><span class="tl-style"></span>`;
        row.querySelector("img").src = thumbOf(l);
        row.querySelector(".tl-name").textContent = l.name;
        row.querySelector(".tl-style").textContent = (l.animStyle || "").replace(/^(spec|enter)-/, "");
        row.addEventListener("click", () => selectLayer(l.id));
        row.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          dragging = { kind: "layer", layerId: l.id, step: i };
          e.dataTransfer.effectAllowed = "move";
        });
        step.appendChild(row);
      }
      step.addEventListener("dragstart", (e) => {
        if (dragging?.kind === "layer") return;
        dragging = { kind: "step", step: i };
        e.dataTransfer.effectAllowed = "move";
      });
      // Dropping onto a step: play together.
      step.addEventListener("dragover", (e) => {
        if (!dragging || (dragging.kind === "step" && dragging.step === i)) return;
        e.preventDefault();
        step.classList.add("merge-target");
      });
      step.addEventListener("dragleave", () => step.classList.remove("merge-target"));
      step.addEventListener("drop", (e) => {
        e.preventDefault();
        step.classList.remove("merge-target");
        const d = dragging;
        dragging = null;
        if (!d) return;
        const next = steps();
        const moving = d.kind === "step" ? next[d.step] : [next[d.step].find((l) => l.id === d.layerId)];
        const rest = next.map((g) => g.filter((l) => !moving.includes(l))).filter((g) => g.length);
        const target = rest.findIndex((g) => g.includes(next[i][0]) || g.some((l) => next[i].includes(l)));
        if (target < 0) return;
        rest[target] = [...rest[target], ...moving];
        applyOrder(rest);
      });
      view.appendChild(step);

      // Gap after the step: drop here to place a step (or a layer) at this position;
      // click to set a pause.
      const gap = document.createElement("button");
      gap.type = "button";
      gap.className = "tl-gap";
      const pause = Math.max(0, ...group.map((l) => Number(l.pauseAfter) || 0));
      gap.textContent = pause ? `pause ${pause}s` : "+ pause";
      gap.title = "Pause before the next step (click to change). Drop a step here to move it.";
      gap.addEventListener("click", () => {
        const options = [0, 0.5, 1, 1.5, 2, 3, 5];
        const nextPause = options[(options.indexOf(pause) + 1) % options.length] ?? 0;
        pushUndoSnapshot();
        for (const l of group) l.pauseAfter = nextPause || undefined;
        scheduleAutoSave();
        render();
      });
      gap.addEventListener("dragover", (e) => {
        if (!dragging) return;
        e.preventDefault();
        gap.classList.add("insert-target");
      });
      gap.addEventListener("dragleave", () => gap.classList.remove("insert-target"));
      gap.addEventListener("drop", (e) => {
        e.preventDefault();
        gap.classList.remove("insert-target");
        const d = dragging;
        dragging = null;
        if (!d) return;
        const next = steps();
        const anchor = next[i];
        const moving = d.kind === "step" ? next[d.step] : [next[d.step].find((l) => l.id === d.layerId)];
        const rest = next.map((g) => g.filter((l) => !moving.includes(l))).filter((g) => g.length);
        const at = rest.findIndex((g) => g.some((l) => anchor.includes(l)));
        rest.splice(at + 1, 0, moving);
        applyOrder(rest);
      });
      view.appendChild(gap);
    });
    const known = list.every((g) => g.every((l) => durationOf(l) !== undefined));
    if (!running) {
      const total =
        list.reduce((t, g, i) => t + Math.max(...g.map((l) => durationOf(l) || 0)) + (i < list.length - 1 ? 0.2 : 0), 0) +
        list.reduce((t, g) => t + Math.max(0, ...g.map((l) => Number(l.pauseAfter) || 0)), 0) +
        (inkScenes.currentScene?.hold ?? 1);
      status.textContent = known ? `Scene ≈ ${total.toFixed(1)}s` : "";
    }
    const hidden = state.layers.filter((l) => l.visible === false).length;
    if (hidden) {
      const note = document.createElement("div");
      note.className = "tl-note";
      note.textContent = `${hidden} hidden layer${hidden > 1 ? "s" : ""} not shown`;
      view.appendChild(note);
    }
  }

  // Re-render after edits, selection and scene changes.
  const originalRender = window.renderLayerList;
  window.renderLayerList = function (...args) {
    const r = originalRender.apply(this, args);
    if (!inkClock.manual) render();
    return r;
  };
  window.addEventListener("inkplainer:scene-changed", () => {
    render();
    schedule(400);
  });
  // Every edit schedules an autosave; time what changed once editing pauses.
  const originalAutoSave = window.scheduleAutoSave;
  window.scheduleAutoSave = function (...args) {
    if (!running) schedule();
    return originalAutoSave.apply(this, args);
  };

  // Pause per layer in its settings, too.
  inkLayerPanel.add((layer) =>
    inkLayerPanel.segmented(
      "Pause after",
      [[0, "None"], [0.5, "0.5s"], [1, "1s"], [2, "2s"], [3, "3s"]],
      Number(layer.pauseAfter) || 0,
      (val) => {
        pushUndoSnapshot();
        layer.pauseAfter = val || undefined;
        scheduleAutoSave();
        render();
      },
      "Wait this long after this layer before the next step",
    ),
  );

  window.inkTimeline = { pauseAfter, steps, render, durationOf, timeNow: timePending };
})();
