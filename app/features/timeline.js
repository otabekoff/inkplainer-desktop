// Timeline for the current scene: the order things are drawn in, as a row of steps.
// Each step is one or more layers that play at the same time (same "Order" number).
//  - drag a step between others to move it; drop it onto another step to play together
//  - drag a single layer out of a step to give it a step of its own
//  - the chip after each step sets a pause before the next one (layer.pauseAfter)
//  - "Measure timing" renders the scene quickly to show how long each step takes
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

  // ── Measured durations (per layer id, seconds), from a quick render ───────
  const measured = new Map();
  let measuring = false;
  async function measure() {
    if (measuring || state.recording || !state.layers.length) return;
    measuring = true;
    measuredScene = inkScenes.currentScene;
    measured.clear();
    measureBtn.textContent = "Measuring…";
    const cur = inkScenes.current;
    // A layer's time runs from the first frame it is drawing to the first frame it is not
    // (finished, or its slot gone: the engine clears the slots after the last step).
    const startOf = new Map();
    const endOf = new Map();
    let now = 0;
    try {
      await inkMovie.render({
        fps: 30,
        width: 64,
        height: 36,
        from: cur,
        to: cur,
        onFrame: (_f, { time }) => {
          now = time;
          const active = new Set((state._activeSlots || []).filter((s) => !s.done).map((s) => s.layer.id));
          for (const id of active) if (!startOf.has(id)) startOf.set(id, time);
          for (const id of startOf.keys()) if (!active.has(id) && !endOf.has(id)) endOf.set(id, time);
        },
      });
      for (const [id, start] of startOf) measured.set(id, Math.max(0.05, (endOf.get(id) ?? now) - start));
    } finally {
      measuring = false;
      measureBtn.textContent = "Measure timing";
      render();
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
  const measureBtn = document.createElement("button");
  measureBtn.type = "button";
  measureBtn.className = "tl-measure";
  measureBtn.textContent = "Measure timing";
  measureBtn.title = "Render this scene quickly to see how long each step takes";
  measureBtn.addEventListener("click", measure);
  board.querySelector(".sb-actions").prepend(measureBtn);

  tabs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    tabs.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    board.classList.toggle("show-timeline", b.dataset.view === "timeline");
    if (b.dataset.view === "timeline") render();
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
      const secs = Math.max(...group.map((l) => measured.get(l.id) || 0));
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
  // Measurements belong to a scene; the movie renderer re-activates the same scene when it
  // finishes, which must not clear them.
  let measuredScene = null;
  window.addEventListener("inkplainer:scene-changed", () => {
    const scene = inkScenes.currentScene;
    if (scene !== measuredScene) {
      measured.clear();
      measuredScene = scene;
    }
    render();
  });

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

  window.inkTimeline = { pauseAfter, steps, render, measure };
})();
