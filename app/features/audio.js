// Audio: background music for the whole movie and a voiceover per scene (imported, or
// recorded with the microphone). Play movie plays them in sync; export mixes them offline
// into one soundtrack (features/export.js). Saved with the project (IndexedDB keeps Blobs).
//
//   music = { name, blob, volume, fadeIn, fadeOut, loop }
//   voice (per scene id) = { name, blob, start, volume, extend }
//     start: seconds after the scene's drawing begins; extend: keep the scene on screen
//     until the voice has finished, so it is never cut off.
(() => {
  let music = null;
  const voices = new Map(); // scene id -> voice

  // ── Decoding (cached per Blob) ────────────────────────────────────────────
  let decoder = null;
  const buffers = new WeakMap();
  async function bufferOf(clip) {
    if (!clip?.blob) return null;
    if (buffers.has(clip.blob)) return buffers.get(clip.blob);
    decoder ??= new AudioContext();
    const buf = await decoder.decodeAudioData(await clip.blob.arrayBuffer());
    buffers.set(clip.blob, buf);
    clip.duration = buf.duration;
    return buf;
  }

  const voiceOf = (scene) => (scene ? voices.get(scene.id) || null : null);

  // Seconds (from the start of the scene's drawing) the scene must at least last.
  function sceneMinEnd(scene) {
    const v = voiceOf(scene);
    if (!v || v.extend === false || !v.duration) return 0;
    return (v.start || 0) + v.duration + 0.3;
  }

  // ── Persistence ───────────────────────────────────────────────────────────
  window.serializeAudio = () => ({
    music,
    voices: [...voices.entries()].filter(([id]) => inkScenes.list.some((s) => s.id === id)),
  });
  window.addEventListener("inkplainer:project-loaded", (e) => {
    const saved = e.detail.savedState?.audio;
    music = saved?.music?.blob ? saved.music : null;
    voices.clear();
    for (const [id, v] of saved?.voices || []) if (v?.blob) voices.set(id, v);
    // Durations are needed for scene lengths; decode in the background.
    for (const clip of [music, ...voices.values()]) if (clip) bufferOf(clip).catch(() => {});
    setTimeout(refreshUI, 300);
  });

  // ── Mixing (export) ───────────────────────────────────────────────────────
  // sceneStarts: [{ scene, time }] in seconds; duration: the movie's length.
  async function mix(duration, sceneStarts, sampleRate = 48000) {
    const used = sceneStarts.filter(({ scene }) => voiceOf(scene));
    if (!music && !used.length) return null;
    const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
    if (music) {
      const buf = await bufferOf(music);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = music.loop !== false;
      const gain = ctx.createGain();
      const vol = music.volume ?? 0.6;
      const fadeIn = Math.min(music.fadeIn ?? 1, duration / 2);
      const fadeOut = Math.min(music.fadeOut ?? 2, duration / 2);
      gain.gain.setValueAtTime(fadeIn > 0 ? 0 : vol, 0);
      if (fadeIn > 0) gain.gain.linearRampToValueAtTime(vol, fadeIn);
      gain.gain.setValueAtTime(vol, Math.max(fadeIn, duration - fadeOut));
      gain.gain.linearRampToValueAtTime(0, duration);
      src.connect(gain).connect(ctx.destination);
      src.start(0);
    }
    for (const { scene, time } of used) {
      const v = voiceOf(scene);
      const buf = await bufferOf(v);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = v.volume ?? 1;
      src.connect(gain).connect(ctx.destination);
      src.start(time + (v.start || 0));
    }
    return ctx.startRendering();
  }

  // ── Live playback (Play movie) ────────────────────────────────────────────
  // prepare() decodes everything first; startPlayback() is called on the first frame shown,
  // so the audio clock and the picture start together.
  let live = null; // { ctx, t0, nodes }
  let queued = [];
  async function prepare() {
    for (const clip of [music, ...voices.values()]) if (clip) await bufferOf(clip).catch(() => {});
  }
  function play(ctx, clip, at, gainValue) {
    const buf = buffers.get(clip.blob);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    src.connect(gain).connect(ctx.destination);
    src.start(Math.max(ctx.currentTime, at));
    live.nodes.push(src);
    return { src, gain };
  }
  function startPlayback() {
    stopPlayback();
    if (!music && !voices.size) return;
    const ctx = new AudioContext();
    live = { ctx, t0: ctx.currentTime + 0.02, nodes: [] };
    if (music) {
      const n = play(ctx, music, live.t0, 0);
      if (n) {
        n.src.loop = music.loop !== false;
        n.gain.gain.setValueAtTime(0, live.t0);
        n.gain.gain.linearRampToValueAtTime(music.volume ?? 0.6, live.t0 + Math.max(0.01, music.fadeIn ?? 1));
      }
    }
    for (const [scene, time] of queued) sceneStarted(scene, time);
    queued = [];
  }
  // A scene's drawing starts `time` seconds into the movie.
  function sceneStarted(scene, time) {
    const v = voiceOf(scene);
    if (!v) return;
    if (!live) return void queued.push([scene, time]);
    play(live.ctx, v, live.t0 + time + (v.start || 0), v.volume ?? 1);
  }
  function stopPlayback() {
    queued = [];
    if (!live) return;
    for (const n of live.nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    live.ctx.close();
    live = null;
  }

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
    <div class="ap-section">Background music <span>whole movie</span></div>
    <div class="ap-clip" data-kind="music"></div>
    <div class="ap-opts" data-for="music">
      <label class="ap-field"><span>Volume</span><input type="range" min="0" max="1" step="0.05" data-k="volume"><b></b></label>
      <label class="ap-field"><span>Fade in</span><input type="range" min="0" max="5" step="0.25" data-k="fadeIn"><b></b></label>
      <label class="ap-field"><span>Fade out</span><input type="range" min="0" max="8" step="0.25" data-k="fadeOut"><b></b></label>
      <label class="ap-check"><input type="checkbox" data-k="loop"> Loop if the movie is longer</label>
    </div>
    <div class="ap-section">Voiceover <span class="ap-scene"></span></div>
    <div class="ap-clip" data-kind="voice"></div>
    <div class="ap-opts" data-for="voice">
      <label class="ap-field"><span>Starts after</span><input type="range" min="0" max="10" step="0.1" data-k="start"><b></b></label>
      <label class="ap-field"><span>Volume</span><input type="range" min="0" max="1.5" step="0.05" data-k="volume"><b></b></label>
      <label class="ap-check"><input type="checkbox" data-k="extend"> Keep the scene on until the voice ends</label>
    </div>`;
  document.body.appendChild(panel);
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "audio/*";
  picker.hidden = true;
  document.body.appendChild(picker);
  let pickingFor = null;

  const fmt = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

  let preview = null;
  async function previewClip(clip) {
    if (preview) {
      preview.stop();
      preview = null;
      return refreshUI();
    }
    const ctx = new AudioContext();
    const src = ctx.createBufferSource();
    src.buffer = await bufferOf(clip);
    src.connect(ctx.destination);
    src.start();
    preview = { stop: () => { try { src.stop(); } catch {} ctx.close(); } };
    src.onended = () => {
      if (preview) preview = null;
      refreshUI();
    };
    refreshUI();
  }

  // Microphone recording for the current scene's voiceover.
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
      const blob = new Blob(chunks, { type: "audio/webm" });
      await setVoice({ name: `Recording ${new Date().toLocaleTimeString()}`, blob });
    };
    mr.start(250);
    refreshUI(0);
  }

  async function setMusic(clip) {
    music = clip ? { volume: 0.6, fadeIn: 1, fadeOut: 2, loop: true, ...music, ...clip } : null;
    if (music) await bufferOf(music).catch(() => showToast("That audio file could not be read"));
    scheduleAutoSave();
    refreshUI();
  }
  async function setVoice(clip) {
    const scene = inkScenes.currentScene;
    if (!scene) return;
    if (!clip) voices.delete(scene.id);
    else {
      const v = { start: 0, volume: 1, extend: true, ...voices.get(scene.id), ...clip };
      voices.set(scene.id, v);
      await bufferOf(v).catch(() => showToast("That audio file could not be read"));
    }
    scheduleAutoSave();
    refreshUI();
    window.inkTracks?.render();
  }

  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (!file) return;
    const clip = { name: file.name.replace(/\.[^.]+$/, ""), blob: file };
    if (pickingFor === "music") setMusic(clip);
    else setVoice(clip);
  });

  function clipRow(kind, clip, recording) {
    const icon = (p) => `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    if (recording != null) {
      return `<div class="ap-rec"><span class="ap-rec-dot"></span>Recording ${fmt(recording)}</div><button type="button" data-act="record" class="ap-primary">Stop</button>`;
    }
    if (!clip) {
      return `<button type="button" data-act="add">${icon('<path d="M12 5v14M5 12h14"/>')} Add ${kind === "music" ? "music" : "audio file"}…</button>` +
        (kind === "voice" ? `<button type="button" data-act="record">${icon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>')} Record</button>` : "");
    }
    return `<div class="ap-name" title="${clip.name}">${clip.name}<em>${fmt(clip.duration)}</em></div>
      <button type="button" data-act="play" title="Listen">${preview ? icon('<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>') : icon('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>')}</button>
      <button type="button" data-act="add" title="Replace">${icon('<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>')}</button>
      <button type="button" data-act="remove" title="Remove">${icon('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>')}</button>`;
  }

  function refreshUI(recordingSeconds) {
    const scene = inkScenes.currentScene;
    const v = voiceOf(scene);
    const index = inkScenes.current + 1;
    panel.querySelector(".ap-scene").textContent = `scene ${index}${scene?.name ? ` · ${scene.name}` : ""}`;
    panel.querySelector('[data-kind="music"]').innerHTML = clipRow("music", music);
    panel.querySelector('[data-kind="voice"]').innerHTML = clipRow("voice", v, recorder ? recordingSeconds ?? 0 : null);
    for (const [kind, clip] of [["music", music], ["voice", v]]) {
      const opts = panel.querySelector(`.ap-opts[data-for="${kind}"]`);
      opts.style.display = clip ? "" : "none";
      if (!clip) continue;
      for (const input of opts.querySelectorAll("input")) {
        const k = input.dataset.k;
        if (input.type === "checkbox") input.checked = clip[k] !== false;
        else {
          input.value = clip[k] ?? 0;
          const b = input.nextElementSibling;
          if (b) b.textContent = k === "volume" ? `${Math.round(clip[k] * 100)}%` : `${Number(clip[k]).toFixed(k === "start" ? 1 : 2).replace(/0$/, "")}s`;
        }
      }
    }
    button.classList.toggle("has-audio", !!music || voices.size > 0);
    markScenes();
  }

  panel.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const kind = b.closest("[data-kind]").dataset.kind;
    const clip = kind === "music" ? music : voiceOf(inkScenes.currentScene);
    if (b.dataset.act === "add") {
      pickingFor = kind;
      picker.click();
    } else if (b.dataset.act === "remove") {
      if (kind === "music") setMusic(null);
      else setVoice(null);
    } else if (b.dataset.act === "play" && clip) previewClip(clip);
    else if (b.dataset.act === "record") toggleRecord();
  });
  panel.addEventListener("input", (e) => {
    const input = e.target.closest("input[data-k]");
    if (!input) return;
    const kind = input.closest("[data-for]").dataset.for;
    const clip = kind === "music" ? music : voiceOf(inkScenes.currentScene);
    if (!clip) return;
    clip[input.dataset.k] = input.type === "checkbox" ? input.checked : Number(input.value);
    scheduleAutoSave();
    refreshUI();
    if (kind === "voice") window.inkTracks?.render();
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
      card.classList.toggle("has-voice", !!(s && voices.has(s.id)));
    });
  }

  window.inkAudio = {
    get music() {
      return music;
    },
    voiceOf,
    setVoice,
    setMusic,
    sceneMinEnd,
    mix,
    prepare,
    startPlayback,
    sceneStarted,
    stopPlayback,
    hasAudio: () => !!music || voices.size > 0,
    refreshUI,
  };
  refreshUI();
})();
