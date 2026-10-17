// Audio: background music tracks for the whole movie and voiceover clips per scene
// (imported, or recorded with the microphone). The editor's own Play plays the current scene's
// audio, Play movie plays everything in sync, and export mixes it offline into one soundtrack
// (features/export.js). Saved with the project (IndexedDB keeps the Blobs as they are).
//
//   music  = [{ id, name, blob, start, volume, fadeIn, fadeOut, loop }]  start: seconds into the movie
//   voices = Map(scene id -> [{ id, name, blob, start, volume, extend }])
//     start: seconds after the scene's drawing begins; extend: keep the scene on screen until
//     the clip has finished, so it is never cut off.
(() => {
  let music = [];
  const voices = new Map();
  let nextClipId = 1;
  const newId = () => nextClipId++;

  // ── Decoding (cached per Blob) ────────────────────────────────────────────
  let decoder = null;
  const buffers = new WeakMap();
  async function bufferOf(clip) {
    if (!clip?.blob) return null;
    if (buffers.has(clip.blob)) {
      clip.duration ??= buffers.get(clip.blob).duration;
      return buffers.get(clip.blob);
    }
    decoder ??= new AudioContext();
    const buf = await decoder.decodeAudioData(await clip.blob.arrayBuffer());
    buffers.set(clip.blob, buf);
    clip.duration = buf.duration;
    queueMicrotask(() => window.inkTracks?.render()); // its bar can show the waveform now
    return buf;
  }

  const clipsOf = (scene) => (scene ? voices.get(scene.id) || [] : []);

  // Seconds (from the start of the scene's drawing) the scene must at least last.
  function sceneMinEnd(scene) {
    let end = 0;
    for (const c of clipsOf(scene)) if (c.extend !== false && c.duration) end = Math.max(end, (c.start || 0) + c.duration + 0.3);
    return end;
  }

  // ── Persistence ───────────────────────────────────────────────────────────
  window.serializeAudio = () => ({
    music,
    voiceClips: [...voices.entries()].filter(([id, list]) => list.length && inkScenes.list.some((s) => s.id === id)),
  });
  window.addEventListener("inkplainer:project-loaded", (e) => {
    const saved = e.detail.savedState?.audio;
    voices.clear();
    // Older projects: one music track ({ music }) and one voiceover per scene ({ voices }).
    music = Array.isArray(saved?.music) ? saved.music.filter((m) => m?.blob) : saved?.music?.blob ? [saved.music] : [];
    for (const [id, list] of saved?.voiceClips || []) voices.set(id, list.filter((c) => c?.blob));
    for (const [id, v] of saved?.voices || []) if (v?.blob) voices.set(id, [...(voices.get(id) || []), v]);
    for (const c of [...music, ...[...voices.values()].flat()]) {
      c.id ??= newId();
      nextClipId = Math.max(nextClipId, c.id + 1);
      bufferOf(c).catch(() => {});
    }
    // Music used to start at a time in the whole movie; that is a time in the first scene.
    for (const m of music) m.anchor ??= inkScenes.list[0]?.id;
    setTimeout(refreshUI, 300);
  });

  // Music starts in a scene (its anchor), `start` seconds after that scene's drawing begins.
  const sceneIndex = (id) => inkScenes.list.findIndex((s) => s.id === id);
  const anchorIndex = (track) => Math.max(0, sceneIndex(track.anchor));

  // ── Waveforms (for the Tracks view), cached per Blob ──────────────────────
  const waves = new WeakMap();
  function waveform(clip) {
    const buf = clip?.blob && buffers.get(clip.blob);
    if (!buf) return null;
    if (waves.has(clip.blob)) return waves.get(clip.blob);
    const W = 600;
    const H = 48;
    const data = buf.getChannelData(0);
    const per = Math.max(1, Math.floor(data.length / W));
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const x = c.getContext("2d");
    x.fillStyle = "rgba(0, 0, 0, 0.32)";
    let peak = 0.0001;
    const peaks = new Float32Array(W);
    for (let i = 0; i < W; i++) {
      let m = 0;
      for (let j = i * per, end = Math.min(data.length, j + per); j < end; j += 4) m = Math.max(m, Math.abs(data[j]));
      peaks[i] = m;
      peak = Math.max(peak, m);
    }
    for (let i = 0; i < W; i++) {
      const h = Math.max(1, (peaks[i] / peak) * (H - 4));
      x.fillRect(i, (H - h) / 2, 1, h);
    }
    const url = c.toDataURL("image/png");
    waves.set(clip.blob, url);
    return url;
  }

  // Undo: the audio of the moment (music and this scene's voiceovers) goes into each snapshot.
  registerUndoExtra(
    "audio",
    () => ({ music: music.map((m) => ({ ...m })), scene: inkScenes.currentScene?.id, voices: clipsOf(inkScenes.currentScene).map((c) => ({ ...c })) }),
    (saved) => {
      music = saved.music.map((m) => ({ ...m }));
      if (saved.scene != null) voices.set(saved.scene, saved.voices.map((c) => ({ ...c })));
      refreshUI();
      window.inkTracks?.render();
    },
  );

  // ── Scheduling clips on a context ─────────────────────────────────────────
  function schedule(ctx, clip, at, gainValue, nodes) {
    const buf = buffers.get(clip.blob);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    src.connect(gain).connect(ctx.destination);
    src.start(Math.max(ctx.currentTime, at));
    nodes?.push(src);
    return { src, gain };
  }
  // Starts a music track at `at` (an absolute time on ctx), with its fades.
  function scheduleMusic(ctx, track, at, nodes, endAt) {
    const n = schedule(ctx, track, at, 0, nodes);
    if (!n) return null;
    n.src.loop = track.loop !== false;
    const vol = track.volume ?? 0.6;
    const fadeIn = Math.max(0.01, track.fadeIn ?? 1);
    n.gain.gain.setValueAtTime(0, at);
    n.gain.gain.linearRampToValueAtTime(vol, at + fadeIn);
    if (endAt != null) {
      const fadeOut = Math.min(track.fadeOut ?? 2, Math.max(0.01, endAt - at - fadeIn));
      n.gain.gain.setValueAtTime(vol, Math.max(at + fadeIn, endAt - fadeOut));
      n.gain.gain.linearRampToValueAtTime(0, endAt);
      n.src.stop(endAt + 0.05);
    } else if (!n.src.loop) {
      const end = at + n.src.buffer.duration;
      const fadeOut = Math.min(track.fadeOut ?? 2, n.src.buffer.duration / 2);
      n.gain.gain.setValueAtTime(vol, end - fadeOut);
      n.gain.gain.linearRampToValueAtTime(0, end);
    }
    return n;
  }

  // ── Mixing (export) ───────────────────────────────────────────────────────
  // sceneStarts: [{ scene, time }] in seconds; duration: the movie's length.
  async function mix(duration, sceneStarts, sampleRate = 48000) {
    const used = sceneStarts.filter(({ scene }) => clipsOf(scene).length);
    if (!music.length && !used.length) return null;
    for (const c of [...music, ...used.flatMap(({ scene }) => clipsOf(scene))]) await bufferOf(c);
    const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
    const first = sceneStarts.length ? sceneIndex(sceneStarts[0].scene.id) : 0;
    for (const track of music) {
      const anchored = sceneStarts.find(({ scene }) => scene.id === inkScenes.list[anchorIndex(track)]?.id);
      // Anchored in a scene before the first one rendered: already playing at the start.
      const at = anchored ? anchored.time + (track.start || 0) : anchorIndex(track) < first ? 0 : null;
      if (at != null && at < duration) scheduleMusic(ctx, track, at, null, duration);
    }
    for (const { scene, time } of used) for (const c of clipsOf(scene)) schedule(ctx, c, time + (c.start || 0), c.volume ?? 1);
    return ctx.startRendering();
  }

  // ── Live playback: Play movie ─────────────────────────────────────────────
  // prepare() decodes everything first; startPlayback() is called on the first frame shown,
  // so the audio clock and the picture start together.
  let live = null; // { ctx, t0, nodes }
  let queued = [];
  async function prepare() {
    for (const c of [...music, ...[...voices.values()].flat()]) await bufferOf(c).catch(() => {});
  }
  function startPlayback() {
    stopPlayback();
    if (!music.length && !voices.size) return;
    const ctx = new AudioContext();
    live = { ctx, t0: ctx.currentTime + 0.02, nodes: [], first: null };
    for (const [scene, time] of queued) sceneStarted(scene, time);
    queued = [];
  }
  // A scene's drawing starts `time` seconds into the movie.
  function sceneStarted(scene, time) {
    if (!live) return void queued.push([scene, time]);
    const index = sceneIndex(scene.id);
    if (live.first == null) {
      live.first = index;
      // Music anchored in an earlier scene is already playing when the preview starts.
      for (const track of music) if (anchorIndex(track) < index) scheduleMusic(live.ctx, track, live.t0, live.nodes);
    }
    for (const track of music) {
      if (anchorIndex(track) === index) scheduleMusic(live.ctx, track, live.t0 + time + (track.start || 0), live.nodes);
    }
    for (const c of clipsOf(scene)) schedule(live.ctx, c, live.t0 + time + (c.start || 0), c.volume ?? 1, live.nodes);
  }
  function stopPlayback() {
    queued = [];
    if (!live) return;
    stopNodes(live);
    live = null;
  }
  function stopNodes(session) {
    for (const n of session.nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    session.ctx.close();
  }

  // ── Live playback: the editor's own Play (the current scene) ──────────────
  let editor = null; // { ctx, t0, nodes, musicGains, fading }
  async function startEditorAudio() {
    stopEditorAudio();
    const clips = clipsOf(inkScenes.currentScene);
    if (!music.length && !clips.length) return;
    const ctx = new AudioContext();
    const session = { ctx, t0: ctx.currentTime + 0.02, nodes: [], musicGains: [], fading: false };
    editor = session;
    await prepare();
    if (editor !== session) return ctx.close();
    session.t0 = ctx.currentTime + 0.02;
    // Music anchored in this scene starts at its offset; music from an earlier scene plays from
    // its beginning (this is the scene on its own, not the whole movie); later music waits.
    const here = inkScenes.current;
    for (const track of music) {
      const a = anchorIndex(track);
      if (a > here) continue;
      const n = scheduleMusic(ctx, track, session.t0 + (a === here ? track.start || 0 : 0), session.nodes);
      if (n) session.musicGains.push({ gain: n.gain, volume: track.volume ?? 0.6 });
    }
    for (const c of clips) schedule(ctx, c, session.t0 + (c.start || 0), c.volume ?? 1, session.nodes);
  }
  function stopEditorAudio() {
    if (!editor) return;
    stopNodes(editor);
    editor = null;
  }
  // Fade the music out once the scene's animation has finished (voiceovers play to their end).
  (function watchEditor() {
    if (editor && state.done && !editor.fading) {
      editor.fading = true;
      const now = editor.ctx.currentTime;
      for (const { gain } of editor.musicGains) {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 1.5);
      }
    }
    inkClock.native.raf(watchEditor);
  })();
  const originalGenerateNow = window._generateNow;
  window._generateNow = function (...args) {
    const r = originalGenerateNow.apply(this, args);
    if (!inkClock.manual && !window.inkPlayer?.playing) startEditorAudio();
    return r;
  };
  const originalReset = window.resetAnim;
  window.resetAnim = function (...args) {
    if (!inkClock.manual) stopEditorAudio();
    return originalReset.apply(this, args);
  };
  const originalToggle = window.togglePlay;
  window.togglePlay = function (...args) {
    const r = originalToggle.apply(this, args);
    if (editor && !state.done) {
      if (state.playing) editor.ctx.resume();
      else editor.ctx.suspend();
    }
    return r;
  };

  // ── Panel ─────────────────────────────────────────────────────────────────
  const board = document.getElementById("storyboard");
  if (!board) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sb-audio";
  button.title = "Music and voiceover";
  button.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><span>Audio</span><i class="sb-audio-dot"></i>`;
  board.querySelector(".sb-actions").prepend(button);

  const panel = document.createElement("div");
  panel.id = "audio-panel";
  panel.innerHTML = `
    <div class="ap-title">Audio</div>
    <div class="ap-section">Music <span>whole movie</span></div>
    <div class="ap-list" data-kind="music"></div>
    <div class="ap-add" data-kind="music"></div>
    <div class="ap-section">Voiceover <span class="ap-scene"></span></div>
    <div class="ap-list" data-kind="voice"></div>
    <div class="ap-add" data-kind="voice"></div>`;
  document.body.appendChild(panel);
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "audio/*";
  picker.multiple = true;
  picker.hidden = true;
  document.body.appendChild(picker);
  let pickingFor = null;

  const fmt = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
  const icon = (p) => `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const PLAY = '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>';
  const STOP = '<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/>';
  const TRASH = '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>';

  let preview = null; // { id, stop }
  async function previewClip(clip) {
    const same = preview?.id === clip.id;
    preview?.stop();
    preview = null;
    if (same) return refreshUI();
    const ctx = new AudioContext();
    const src = ctx.createBufferSource();
    src.buffer = await bufferOf(clip);
    src.connect(ctx.destination);
    src.start();
    const p = { id: clip.id, stop: () => { try { src.stop(); } catch {} ctx.close(); } };
    preview = p;
    src.onended = () => {
      if (preview === p) preview = null;
      refreshUI();
    };
    refreshUI();
  }

  // Microphone recording, as a new voiceover clip in the current scene.
  let recorder = null;
  async function toggleRecord() {
    if (recorder) return recorder.stop();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      return showToast(`Microphone not available: ${err.message}`);
    }
    const chunks = [];
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    const started = performance.now();
    recorder = mr;
    const tick = setInterval(() => refreshUI((performance.now() - started) / 1000), 250);
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = async () => {
      clearInterval(tick);
      stream.getTracks().forEach((t) => t.stop());
      recorder = null;
      await addVoice({ name: `Recording ${new Date().toLocaleTimeString()}`, blob: new Blob(chunks, { type: "audio/webm" }) });
    };
    mr.start(250);
    refreshUI(0);
  }

  async function addMusic(clip) {
    pushUndoSnapshot();
    const track = { id: newId(), anchor: inkScenes.currentScene?.id, start: 0, volume: 0.6, fadeIn: 1, fadeOut: 2, loop: true, ...clip };
    music.push(track);
    await bufferOf(track).catch(() => showToast("That audio file could not be read"));
    changed();
  }
  async function addVoice(clip) {
    const scene = inkScenes.currentScene;
    if (!scene) return;
    pushUndoSnapshot();
    const list = clipsOf(scene);
    const after = list.reduce((t, c) => Math.max(t, (c.start || 0) + (c.duration || 0)), 0);
    const v = { id: newId(), start: list.length ? Math.round((after + 0.3) * 10) / 10 : 0, volume: 1, extend: true, ...clip };
    voices.set(scene.id, [...list, v]);
    await bufferOf(v).catch(() => showToast("That audio file could not be read"));
    changed();
  }
  function removeClip(kind, id) {
    pushUndoSnapshot();
    if (kind === "music") music = music.filter((m) => m.id !== id);
    else voices.set(inkScenes.currentScene.id, clipsOf(inkScenes.currentScene).filter((c) => c.id !== id));
    changed();
  }
  function changed() {
    scheduleAutoSave();
    refreshUI();
    window.inkTracks?.render();
  }

  picker.addEventListener("change", async () => {
    const files = [...(picker.files || [])];
    picker.value = "";
    for (const file of files) {
      const clip = { name: file.name.replace(/\.[^.]+$/, ""), blob: file };
      if (pickingFor === "music") await addMusic(clip);
      else await addVoice(clip);
    }
  });

  const MUSIC_FIELDS = [["start", "Starts after", 0, 30, 0.1, "s"], ["volume", "Volume", 0, 1, 0.05, "%"], ["fadeIn", "Fade in", 0, 5, 0.25, "s"], ["fadeOut", "Fade out", 0, 8, 0.25, "s"]];
  const VOICE_FIELDS = [["start", "Starts after", 0, 20, 0.1, "s"], ["volume", "Volume", 0, 1.5, 0.05, "%"]];
  function clipCard(kind, c) {
    const fields = (kind === "music" ? MUSIC_FIELDS : VOICE_FIELDS)
      .map(([k, label, min, max, step, unit]) => {
        const v = c[k] ?? 0;
        const shown = unit === "%" ? `${Math.round(v * 100)}%` : `${Number(v).toFixed(step < 0.25 ? 1 : 2).replace(/\.?0+$/, "") || 0}s`;
        return `<label class="ap-field"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-k="${k}"><b>${shown}</b></label>`;
      })
      .join("");
    // Music: which scene it starts in.
    const anchorField = kind === "music"
      ? '<label class="ap-field"><span>Starts in</span><select data-k="anchor">' +
        inkScenes.list.map((sc, i) => '<option value="' + sc.id + '"' + (i === anchorIndex(c) ? " selected" : "") + ">Scene " + (i + 1) + (sc.name ? " · " + sc.name.replace(/</g, "&lt;") : "") + "</option>").join("") +
        "</select></label>"
      : "";
    const check = kind === "music"
      ? `<label class="ap-check"><input type="checkbox" data-k="loop" ${c.loop !== false ? "checked" : ""}> Loop to the end of the movie</label>`
      : `<label class="ap-check"><input type="checkbox" data-k="extend" ${c.extend !== false ? "checked" : ""}> Keep the scene on until it ends</label>`;
    return `<div class="ap-card" data-id="${c.id}">
      <div class="ap-card-head"><div class="ap-name" title="${c.name}">${c.name}<em>${fmt(c.duration)}</em></div>
        <button type="button" data-act="play" title="Listen">${icon(preview?.id === c.id ? STOP : PLAY)}</button>
        <button type="button" data-act="remove" title="Remove">${icon(TRASH)}</button></div>
      ${anchorField}${fields}${check}</div>`;
  }

  function refreshUI(recordingSeconds) {
    const scene = inkScenes.currentScene;
    panel.querySelector(".ap-scene").textContent = `scene ${inkScenes.current + 1}${scene?.name ? ` · ${scene.name}` : ""}`;
    panel.querySelector('.ap-list[data-kind="music"]').innerHTML = music.map((m) => clipCard("music", m)).join("");
    panel.querySelector('.ap-list[data-kind="voice"]').innerHTML = clipsOf(scene).map((c) => clipCard("voice", c)).join("");
    panel.querySelector('.ap-add[data-kind="music"]').innerHTML = `<button type="button" data-act="add">${icon('<path d="M12 5v14M5 12h14"/>')} Add music…</button>`;
    panel.querySelector('.ap-add[data-kind="voice"]').innerHTML = recorder
      ? `<div class="ap-rec"><span class="ap-rec-dot"></span>Recording ${fmt(recordingSeconds ?? 0)}</div><button type="button" data-act="record" class="ap-primary">Stop</button>`
      : `<button type="button" data-act="add">${icon('<path d="M12 5v14M5 12h14"/>')} Add audio file…</button>` +
        `<button type="button" data-act="record">${icon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>')} Record</button>`;
    button.classList.toggle("has-audio", music.length > 0 || [...voices.values()].some((l) => l.length));
    markScenes();
  }

  const clipBy = (kind, id) => (kind === "music" ? music : clipsOf(inkScenes.currentScene)).find((c) => c.id === id);
  panel.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const kind = b.closest("[data-kind]")?.dataset.kind;
    const id = Number(b.closest(".ap-card")?.dataset.id);
    if (b.dataset.act === "add") {
      pickingFor = kind;
      picker.click();
    } else if (b.dataset.act === "remove") removeClip(kind, id);
    else if (b.dataset.act === "play") {
      const c = clipBy(kind, id);
      if (c) previewClip(c);
    } else if (b.dataset.act === "record") toggleRecord();
  });
  // One undo step per slider drag or checkbox click.
  panel.addEventListener("focusin", (e) => e.target.matches?.("select") && pushUndoSnapshot());
  panel.addEventListener("pointerdown", (e) => e.target.matches?.("input[type=range]") && pushUndoSnapshot());
  panel.addEventListener("click", (e) => e.target.matches?.("input[type=checkbox]") && pushUndoSnapshot(), true);
  panel.addEventListener("input", (e) => {
    const input = e.target.closest("input[data-k]");
    if (!input) return;
    const kind = input.closest("[data-kind]").dataset.kind;
    const clip = clipBy(kind, Number(input.closest(".ap-card").dataset.id));
    if (!clip) return;
    clip[input.dataset.k] = input.type === "checkbox" ? input.checked : Number(input.value);
    const b = input.nextElementSibling;
    if (b?.tagName === "B") {
      const k = input.dataset.k;
      b.textContent = k === "volume" ? `${Math.round(clip[k] * 100)}%` : `${clip[k]}s`;
    }
    scheduleAutoSave();
    window.inkTracks?.render();
  });

  function openPanel() {
    refreshUI();
    panel.classList.add("show");
    const r = button.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(window.innerWidth - pr.width - 8, r.right - pr.width))}px`;
    panel.style.top = `${Math.max(8, r.top - pr.height - 8)}px`;
  }
  button.addEventListener("click", () => (panel.classList.contains("show") ? panel.classList.remove("show") : openPanel()));
  document.addEventListener("mousedown", (e) => {
    if (panel.classList.contains("show") && !panel.contains(e.target) && !button.contains(e.target) && !recorder) panel.classList.remove("show");
  });
  window.addEventListener("inkplainer:scene-changed", () => refreshUI());

  // Scene cards are rebuilt on every edit; keep their voiceover mark.
  const strip = board.querySelector(".sb-strip");
  if (strip) new MutationObserver(() => markScenes()).observe(strip, { childList: true });
  function markScenes() {
    document.querySelectorAll(".sb-scene").forEach((card) => {
      const s = inkScenes.list[Number(card.dataset.index)];
      card.classList.toggle("has-voice", !!(s && clipsOf(s).length));
    });
  }

  window.inkAudio = {
    get music() {
      return music;
    },
    clipsOf,
    waveform,
    anchorIndex,
    addMusic,
    addVoice,
    sceneMinEnd,
    mix,
    prepare,
    startPlayback,
    sceneStarted,
    stopPlayback,
    hasAudio: () => music.length > 0 || [...voices.values()].some((l) => l.length),
    refreshUI,
    get editorPlaying() {
      return !!editor;
    },
  };
  refreshUI();
})();
