// Tracks: give every layer its own start time in the scene, like a video editor's timeline.
// Bars sit on a time ruler; drag them to start things earlier or later, to overlap (play at
// the same time) or to leave gaps (delays). A scene uses either steps (the default: each step
// waits for the previous one) or tracks (scene.timing === 'tracks', layer.startAt seconds).
//
// The tracks scheduler starts each layer's animation slot at its time and ticks all running
// slots together, reusing the engine's own slot code (_buildSlots, _tickAllSlots), so drawing
// styles, hands, the camera, export and timing all work the same in both modes.
(() => {
  // startAt: start time in tracks mode. duration: a length set by dragging a bar's edge; the
  // animation plays faster or slower to fit (durationBase/durationSig remember its natural
  // length, so the stretch still applies before the timeline has re-timed it after a reload).
  registerLayerFields("startAt", "duration", "durationBase", "durationSig");
  const GAP = 0.2; // the engine's pause between steps
  const isTracks = () => inkScenes.currentScene?.timing === "tracks";
  const durationOf = (l) => window.inkTimeline?.effectiveDuration(l);
  const naturalOf = (l) =>
    window.inkTimeline?.durationOf(l) ?? (l.durationSig && l.durationSig === inkTimeline.signature(l) ? l.durationBase : undefined);

  // Start times a scene in steps mode works out to (for drawing it as tracks).
  function sequenceStarts() {
    const starts = new Map();
    let t = 0;
    for (const step of inkTimeline.steps()) {
      for (const l of step) starts.set(l, t);
      const d = Math.max(...step.map((l) => durationOf(l) ?? 1));
      const pause = Math.max(0, ...step.map((l) => Number(l.pauseAfter) || 0));
      t += d + GAP + pause;
    }
    return starts;
  }
  const startOf = (l, seq) => (isTracks() ? Number(l.startAt) || 0 : seq?.get(l) ?? 0);

  function sceneLength() {
    const seq = isTracks() ? null : sequenceStarts();
    let end = 0;
    for (const l of getAnimOrder()) end = Math.max(end, startOf(l, seq) + (durationOf(l) ?? 1));
    return end;
  }

  // A layer with a set duration plays at the rate that makes its natural length fit.
  const originalBuildSlots = window._buildSlots;
  window._buildSlots = function (group, sharedBg) {
    const slots = originalBuildSlots.call(this, group, sharedBg);
    for (const slot of slots) {
      const l = slot.layer;
      const natural = l.duration > 0 ? naturalOf(l) : undefined;
      slot._rate = natural > 0 ? Math.min(10, Math.max(0.1, natural / l.duration)) : 1;
    }
    return slots;
  };

  // ── Scheduler ─────────────────────────────────────────────────────────────
  let run = null; // { start, pending, pausedAt, total }

  function startTracks() {
    closeTextEditor(true);
    deactivateTextPlacement();
    Object.assign(state, {
      bgCanvas: null, _activeSlots: [], _currentSlot: null, _slotMode: false,
      _revealFinalCanvas: null, _dissolveMap: null, _animProgress: 0, _handGX: null, _handGY: null,
    });
    ctx = _mainCtx;
    const layers = getAnimOrder();
    state._animQueue = layers;
    state._queuePos = 0;
    state._animGroups = [layers]; // one "group", so completion checks see a single run
    state._groupPos = 0;
    state.bgCanvas = _buildGroupBgCanvas(0);
    run = {
      start: performance.now(),
      pending: [...layers].sort((a, b) => (Number(a.startAt) || 0) - (Number(b.startAt) || 0)),
      pausedAt: null,
      total: Math.max(0.1, sceneLength()),
    };
    hctx.clearRect(0, 0, state.canvasW, state.canvasH);
    sctx.clearRect(0, 0, state.canvasW, state.canvasH);
    fillBg(ctx);
    document.getElementById("play-pause-btn").disabled = false;
    document.getElementById("done-badge").classList.remove("show");
    setProgress(0);
    state.playing = true;
    state.done = false;
    updatePlayIcons();
    if (!run.pending.length) return finish();
    requestAnimationFrame(loop);
  }

  function now() {
    return run ? ((run.pausedAt ?? performance.now()) - run.start) / 1000 : 0;
  }

  function loop() {
    if (!run) return;
    if (run.pausedAt != null) return void requestAnimationFrame(loop);
    const t = now();
    while (run.pending.length && (Number(run.pending[0].startAt) || 0) <= t + 1e-6) {
      const layer = run.pending.shift();
      state._activeSlots = state._activeSlots.filter((s) => !s.done);
      state._activeSlots.push(..._buildSlots([layer], state.bgCanvas));
    }
    state.playing = true;
    if (state._activeSlots.some((s) => !s.done)) AnimationEngine._tickAllSlots();
    else hctx.clearRect(0, 0, state.canvasW, state.canvasH); // a gap: nothing is being drawn
    if (!run) return; // the last layer finished inside the tick
    if (!run.pending.length && !state._activeSlots.some((s) => !s.done)) return finish();
    state.playing = true;
    requestAnimationFrame(loop);
  }

  function finish() {
    run = null;
    originalAllDone();
  }

  const originalGenerateNow = window._generateNow;
  window._generateNow = function (...args) {
    if (!isTracks()) {
      run = null;
      return originalGenerateNow.apply(this, args);
    }
    startTracks();
  };
  // The engine calls this when every running slot is done; with layers still to come,
  // that only means a gap in the tracks.
  const originalAllDone = window._allLayersDone;
  window._allLayersDone = function (...args) {
    if (run && run.pending.length) {
      state.playing = true;
      return;
    }
    run = null;
    return originalAllDone.apply(this, args);
  };
  // The scheduler drives the ticks itself.
  const originalAnimate = window.animate;
  window.animate = function (...args) {
    if (run) return;
    return originalAnimate.apply(this, args);
  };
  const originalToggle = window.togglePlay;
  window.togglePlay = function (...args) {
    if (run && !state.done) {
      if (run.pausedAt == null) {
        run.pausedAt = performance.now();
        state.playing = false;
      } else {
        run.start += performance.now() - run.pausedAt;
        run.pausedAt = null;
        state.playing = true;
        requestAnimationFrame(loop);
      }
      updatePlayIcons();
      return;
    }
    return originalToggle.apply(this, args);
  };
  const originalReset = window.resetAnim;
  window.resetAnim = function (...args) {
    run = null;
    return originalReset.apply(this, args);
  };
  const originalProgress = window.getExportAnimationProgress;
  window.getExportAnimationProgress = function (...args) {
    if (run) return Math.min(1, now() / run.total);
    return originalProgress.apply(this, args);
  };

  // One hand at a time: when several layers draw at once, only the one that started last
  // shows the hand (the others keep drawing, as if the hand had just left them).
  const originalDrawHand = window.drawHand;
  window.drawHand = function (...args) {
    const slot = state._currentSlot;
    // During a slot's steps the hand is only remembered; the engine draws it once after.
    if (slot && state._deferHand) {
      slot._lastHand = args;
      return;
    }
    if (slot && state._activeSlots?.length > 1) {
      const live = state._activeSlots.filter((s) => !s.done);
      if (live.length > 1 && live[live.length - 1] !== slot) return;
    }
    return originalDrawHand.apply(this, args);
  };

  // ── Tracks view ───────────────────────────────────────────────────────────
  const board = document.getElementById("storyboard");
  const stepsView = board?.querySelector(".tl-view");
  if (!board || !stepsView) return;

  const switcher = document.createElement("div");
  switcher.className = "ink-seg tk-switch";
  switcher.innerHTML = `<button type="button" data-tv="steps">Steps</button><button type="button" data-tv="tracks">Tracks</button>`;
  board.querySelector(".sb-actions").prepend(switcher);

  const view = document.createElement("div");
  view.className = "tk-view";
  view.innerHTML = `
    <div class="tk-bar-top">
      <span class="tk-mode"></span>
      <button type="button" class="tk-reset">Back to steps</button>
    </div>
    <div class="tk-scroll"><div class="tk-canvas"></div></div>`;
  stepsView.after(view);
  const area = view.querySelector(".tk-canvas");
  const scroller = view.querySelector(".tk-scroll");

  let shown = "steps";
  try {
    shown = localStorage.getItem("inkplainer.timelineView") || "steps";
  } catch {
    /* storage unavailable */
  }
  function show(which) {
    shown = which;
    try {
      localStorage.setItem("inkplainer.timelineView", which);
    } catch {
      /* storage unavailable */
    }
    board.classList.toggle("tl-tracks", which === "tracks");
    switcher.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.tv === which));
    render();
  }
  switcher.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tv]");
    if (b) show(b.dataset.tv);
  });

  view.querySelector(".tk-reset").addEventListener("click", () => {
    const scene = inkScenes.currentScene;
    if (!scene) return;
    pushUndoSnapshot();
    scene.timing = "sequence";
    scheduleAutoSave();
    render();
    showToast("This scene plays in steps again");
  });

  const LABEL_W = 170;
  const ROW_H = 30;
  let pps = 70; // pixels per second
  const snap = (v, free) => (free ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10);

  // Called on the first move of a drag; the drag's own undo step (taken before it) covers it.
  function convertToTracks() {
    const seq = sequenceStarts();
    for (const l of state.layers) l.startAt = Math.round((seq.get(l) ?? 0) * 100) / 100;
    inkScenes.currentScene.timing = "tracks";
    showToast("This scene now uses tracks: each layer starts at its own time");
  }

  function render() {
    if (!board.classList.contains("show-timeline") || shown !== "tracks" || drag) return;
    const tracks = isTracks();
    view.querySelector(".tk-mode").textContent = tracks
      ? "Tracks: each layer starts at its own time. Drag bars; overlapping bars play together."
      : "Steps: each step waits for the one before. Drag a bar to place layers freely.";
    view.querySelector(".tk-reset").style.display = tracks ? "" : "none";
    const seq = tracks ? null : sequenceStarts();
    const layers = getAnimOrder();
    const hold = inkScenes.currentScene?.hold ?? 1;
    const end = sceneLength();
    const seconds = Math.max(4, Math.ceil(end + hold + 2));
    const width = LABEL_W + seconds * pps;

    let html = `<div class="tk-ruler" style="width:${width}px"><div class="tk-ruler-pad" style="width:${LABEL_W}px"></div>`;
    for (let s = 0; s <= seconds; s++) {
      html += `<div class="tk-tick${s % 5 === 0 ? " major" : ""}" style="left:${LABEL_W + s * pps}px"><span>${s}s</span></div>`;
    }
    html += "</div>";
    // Audio rows: this scene's voiceover clips (drag to set when each starts) and the music.
    const clips = window.inkAudio?.clipsOf(inkScenes.currentScene) || [];
    const musicTracks = window.inkAudio?.music || [];
    const audioRows = clips.length + musicTracks.length;
    for (const c of clips) {
      html += `<div class="tk-row tk-audio" style="width:${width}px"><div class="tk-label" style="width:${LABEL_W}px"><span>🎙 Voiceover</span></div>
        <div class="tk-bar voice" data-clip="${c.id}" style="left:${LABEL_W + (c.start || 0) * pps}px;width:${Math.max(18, (c.duration || 1) * pps)}px"><span class="tk-bar-text"></span></div></div>`;
    }
    for (const m of musicTracks) {
      html += `<div class="tk-row tk-audio" style="width:${width}px"><div class="tk-label" style="width:${LABEL_W}px"><span>♪ Music</span></div>
        <div class="tk-bar music" data-music="${m.id}" style="left:${LABEL_W}px;width:${seconds * pps}px"><span class="tk-bar-text"></span></div></div>`;
    }
    for (const l of [...layers].reverse()) {
      const start = startOf(l, seq);
      const d = durationOf(l);
      html += `<div class="tk-row${l.id === state.selectedLayerId ? " selected" : ""}" data-id="${l.id}" style="width:${width}px">
        <div class="tk-label" style="width:${LABEL_W}px"><img alt=""><span></span></div>
        <div class="tk-bar${d == null ? " unknown" : ""}${l.duration > 0 ? " stretched" : ""}" data-id="${l.id}" style="left:${LABEL_W + start * pps}px;width:${Math.max(18, (d ?? 1) * pps)}px">
          <i class="tk-h l" data-edge="l"></i><span class="tk-bar-text"></span><i class="tk-h r" data-edge="r"></i>
        </div>
      </div>`;
    }
    html += `<div class="tk-end" style="left:${LABEL_W + (end + hold) * pps}px" title="End of scene (with ${hold}s hold)"></div>`;
    html += `<div class="tk-playhead" style="left:${LABEL_W}px"></div>`;
    area.innerHTML = html;
    area.style.width = `${width}px`;
    area.style.height = `${(layers.length + audioRows + 1) * ROW_H + 8}px`;
    for (const c of clips) {
      const el = area.querySelector(`.tk-bar.voice[data-clip="${c.id}"] .tk-bar-text`);
      if (el) el.textContent = `${c.name} · starts ${(c.start || 0).toFixed(1)}s`;
    }
    for (const m of musicTracks) {
      const el = area.querySelector(`.tk-bar.music[data-music="${m.id}"] .tk-bar-text`);
      if (el) el.textContent = `${m.name}${m.start ? ` · from ${m.start}s into the movie` : ""}`;
    }
    for (const l of layers) {
      const row = area.querySelector(`.tk-row[data-id="${l.id}"]`);
      row.querySelector("img").src = l.img?.src || "";
      row.querySelector(".tk-label span").textContent = l.name;
      const d = durationOf(l);
      row.querySelector(".tk-bar-text").textContent = `${(l.animStyle || "").replace(/^(spec|enter)-/, "")} · ${d == null ? "…" : `${d.toFixed(1)}s`}`;
      row.querySelector(".tk-bar").title =
        `${l.name}: starts at ${startOf(l, seq).toFixed(2)}s${d == null ? "" : `, lasts ${d.toFixed(1)}s`}` +
        (l.duration > 0 ? ` (set; natural ${(naturalOf(l) ?? 0).toFixed(1)}s). Double-click an edge to reset.` : ". Drag the edges to change when it starts and how long it takes.");
    }
    if (tracks) {
      const status = board.querySelector(".tl-status");
      if (status) status.textContent = `Scene ≈ ${(end + hold).toFixed(1)}s`;
    }
  }

  // Dragging a bar sets the layer's start time.
  let drag = null;
  area.addEventListener("pointerdown", (e) => {
    const bar = e.target.closest(".tk-bar");
    const row = e.target.closest(".tk-row");
    if (bar?.dataset.clip) {
      const voice = window.inkAudio.clipsOf(inkScenes.currentScene).find((c) => c.id === Number(bar.dataset.clip));
      if (!voice) return;
      e.preventDefault();
      drag = { voice, x: e.clientX, from: voice.start || 0, before: _serializeState(), moved: false };
      return;
    }
    if (bar?.classList.contains("music")) return;
    if (row && !bar && row.dataset.id) return selectLayer(Number(row.dataset.id));
    if (!bar) return;
    const layer = getLayerById(Number(bar.dataset.id));
    if (!layer || state.playing) return;
    e.preventDefault();
    const edge = e.target.closest("[data-edge]")?.dataset.edge;
    try {
      bar.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
    const seq = isTracks() ? null : sequenceStarts();
    const from = startOf(layer, seq);
    const length = durationOf(layer) ?? 1;
    drag = { layer, edge, x: e.clientX, from, length, end: from + length, before: _serializeState(), moved: false };
  });
  area.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 3) return;
    if (drag.voice) {
      drag.moved = true;
      drag.voice.start = Math.max(0, snap(drag.from + dx / pps, e.shiftKey));
      const vb = area.querySelector(`.tk-bar.voice[data-clip="${drag.voice.id}"]`);
      if (vb) vb.style.left = `${LABEL_W + drag.voice.start * pps}px`;
      return;
    }
    if (!drag.moved) {
      drag.moved = true;
      // Moving the start (or the start edge) needs tracks; the end edge works in steps too.
      if (!isTracks() && drag.edge !== "r") convertToTracks();
      if (drag.edge && !(drag.layer.duration > 0)) {
        drag.layer.durationBase = naturalOf(drag.layer);
        drag.layer.durationSig = inkTimeline.signature(drag.layer);
      }
    }
    if (drag.edge) {
      const bar = area.querySelector(`.tk-bar[data-id="${drag.layer.id}"]`);
      const MIN = 0.2;
      if (drag.edge === "r") {
        drag.layer.duration = Math.max(MIN, snap(drag.length + dx / pps, e.shiftKey));
      } else {
        const start = Math.min(drag.end - MIN, Math.max(0, snap(drag.from + dx / pps, e.shiftKey)));
        drag.layer.startAt = start;
        drag.layer.duration = Math.round((drag.end - start) * 100) / 100;
        if (bar) bar.style.left = `${LABEL_W + start * pps}px`;
      }
      if (bar) bar.style.width = `${Math.max(18, drag.layer.duration * pps)}px`;
      return;
    }
    let t = Math.max(0, snap(drag.from + dx / pps, e.shiftKey));
    // Magnet: the start or end of other bars, within 6 px.
    if (!e.shiftKey) {
      const d = durationOf(drag.layer) ?? 1;
      for (const o of getAnimOrder()) {
        if (o === drag.layer) continue;
        const os = Number(o.startAt) || 0;
        const oe = os + (durationOf(o) ?? 1);
        for (const edge of [os, oe]) {
          if (Math.abs((t - edge) * pps) < 6) t = edge;
          if (Math.abs((t + d - edge) * pps) < 6) t = edge - d;
        }
      }
      t = Math.max(0, Math.round(t * 100) / 100);
    }
    drag.layer.startAt = t;
    const bar = area.querySelector(`.tk-bar[data-id="${drag.layer.id}"]`);
    if (bar) bar.style.left = `${LABEL_W + t * pps}px`;
  });
  area.addEventListener("pointerup", () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.voice) {
      if (d.moved) {
        pushUndoSnapshot(d.before);
        scheduleAutoSave();
        window.inkAudio.refreshUI();
      }
      return render();
    }
    if (!d.moved) return selectLayer(d.layer.id); // a click selects
    pushUndoSnapshot(d.before);
    scheduleAutoSave();
    render();
  });
  // Double-click a bar's edge: back to the layer's natural length.
  area.addEventListener("dblclick", (e) => {
    const edge = e.target.closest("[data-edge]");
    const bar = e.target.closest(".tk-bar[data-id]");
    if (!edge || !bar) return;
    const layer = getLayerById(Number(bar.dataset.id));
    if (!(layer?.duration > 0)) return;
    pushUndoSnapshot();
    delete layer.duration;
    scheduleAutoSave();
    render();
  });
  // Ctrl+wheel zooms the time scale.
  scroller.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      pps = Math.min(240, Math.max(20, pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      render();
    },
    { passive: false },
  );

  // Playhead while the editor plays a tracks scene.
  (function playhead() {
    if (run && shown === "tracks") {
      const ph = area.querySelector(".tk-playhead");
      if (ph) ph.style.left = `${LABEL_W + now() * pps}px`;
    }
    inkClock.native.raf(playhead);
  })();

  // Follow edits, timing results and scene changes.
  const originalTimelineRender = inkTimeline.render;
  inkTimeline.render = function (...args) {
    const r = originalTimelineRender.apply(this, args);
    render();
    return r;
  };
  const originalRenderList = window.renderLayerList;
  window.renderLayerList = function (...args) {
    const r = originalRenderList.apply(this, args);
    if (!inkClock.manual) render();
    return r;
  };
  window.addEventListener("inkplainer:scene-changed", () => render());
  window.addEventListener("inkplainer:timing-updated", () => render());
  board.querySelector(".sb-tabs")?.addEventListener("click", () => setTimeout(render, 0));

  show(shown);
  window.inkTracks = { render, sceneLength, isTracks, time: now };
})();
