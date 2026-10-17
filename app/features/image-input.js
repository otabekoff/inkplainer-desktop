// More ways to add content than the drop zone in the right panel:
//  - Ctrl+V pastes images (screenshots, copied files) as layers, and plain text as a text layer.
//  - Images can be dropped anywhere in the window; on the canvas they land where dropped.
(() => {
  const isTyping = () =>
    /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;

  function canvasPoint(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    return { x: ((clientX - r.left) / r.width) * state.canvasW, y: ((clientY - r.top) / r.height) * state.canvasH };
  }

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Could not read ${file.name || "the image"}`));
        img.src = reader.result;
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function addImages(files, at) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    for (const [i, file] of images.entries()) {
      try {
        const img = await readImage(file);
        const base = (file.name || "").replace(/\.[^.]+$/, "");
        addLayer(img, base && base !== "image" ? base : `Pasted image ${state.layers.length + 1}`);
        await keepSvgSource(file, state.layers[state.layers.length - 1]);
        if (at) {
          const layer = state.layers[state.layers.length - 1];
          layer.x = Math.round(at.x - layer.w / 2 + i * 24);
          layer.y = Math.round(at.y - layer.h / 2 + i * 24);
          redrawLayersOnCanvas();
          drawSelectionHandles();
          renderLayerList();
          scheduleAutoSave();
        }
      } catch (err) {
        showToast(err.message);
      }
    }
    return images.length;
  }

  // SVG files keep their source so they can be drawn stroke by stroke (features/svg-draw.js).
  async function keepSvgSource(file, layer) {
    if (!layer || !/svg/i.test(file.type)) return;
    layer.svgSource = await file.text();
    layer.animStyle = "svg-draw";
    if (layer.id === state.selectedLayerId) syncSidebarToLayer(layer.id);
  }
  window.keepSvgSource = keepSvgSource;

  // The panel's drop zone and Browse button go through the app's loadImageFile.
  const originalLoad = window.loadImageFile;
  window.loadImageFile = function (file) {
    if (!/svg/i.test(file.type)) return originalLoad.call(this, file);
    readImage(file).then(async (img) => {
      addLayer(img, file.name.replace(/.[^.]+$/, ""));
      await keepSvgSource(file, state.layers[state.layers.length - 1]);
    }, (err) => showToast(err.message));
  };

  // ── Paste ─────────────────────────────────────────────────────────────────
  document.addEventListener("paste", (e) => {
    if (isTyping() || state.playing) return;
    const data = e.clipboardData;
    if (!data) return;
    const files = [...data.items].filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter(Boolean);
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      addImages(files, null);
      return;
    }
    const text = data.getData("text/plain").trim();
    if (text && text.length <= 2000) {
      e.preventDefault();
      // Same path as clicking the canvas with the text tool, then committing.
      openTextEditor(Math.round(state.canvasW * 0.1), Math.round(state.canvasH * 0.2), null);
      document.getElementById("text-editor-ta").value = text;
      closeTextEditor(true);
    }
  });

  // ── Drop anywhere ─────────────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.id = "drop-anywhere";
  overlay.innerHTML = "<div>Drop images to add them as layers</div>";
  document.body.appendChild(overlay);

  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth++;
    overlay.classList.add("show");
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) {
      depth = 0;
      overlay.classList.remove("show");
    }
  });
  // Without this, dropping a file outside the drop zone would navigate to it.
  window.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    depth = 0;
    overlay.classList.remove("show");
    if (!hasFiles(e)) return;
    if (e.target.closest?.("#drop-zone")) return; // the panel's own drop zone already handled it
    e.preventDefault();
    addImages([...e.dataTransfer.files], canvasPoint(e.clientX, e.clientY)).then((n) => {
      if (!n) showToast("Only image files can be added");
    });
  });
})();
