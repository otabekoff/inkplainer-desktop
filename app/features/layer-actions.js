// Actions for the selected layer, in its settings: edit text (text layers), replace image,
// flip, duplicate.
(() => {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/*";
  picker.hidden = true;
  document.body.appendChild(picker);
  let replacing = null;

  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read the image"));
      img.src = src;
    });

  function refresh(layer) {
    redrawLayersOnCanvas();
    renderLayerList();
    selectLayer(layer.id);
    scheduleAutoSave();
  }

  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    const layer = replacing;
    picker.value = "";
    replacing = null;
    if (!file || !layer) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const img = await loadImage(reader.result);
        pushUndoSnapshot();
        // Fit the new image inside the old box, keeping its centre.
        const s = Math.min(layer.w / img.width, layer.h / img.height);
        const cx = layer.x + layer.w / 2;
        const cy = layer.y + layer.h / 2;
        layer.img = img;
        layer.w = Math.round(img.width * s);
        layer.h = Math.round(img.height * s);
        layer.x = Math.round(cx - layer.w / 2);
        layer.y = Math.round(cy - layer.h / 2);
        layer.baseW = layer.w;
        layer.baseH = layer.h;
        layer.resizePct = 100;
        delete layer._origImg;
        layer.name = file.name.replace(/\.[^.]+$/, "") || layer.name;
        refresh(layer);
      } catch (err) {
        showToast(err.message);
      }
    };
    reader.readAsDataURL(file);
  });

  async function flip(layer, horizontal) {
    const c = document.createElement("canvas");
    c.width = layer.img.naturalWidth || layer.img.width;
    c.height = layer.img.naturalHeight || layer.img.height;
    const x = c.getContext("2d");
    x.translate(horizontal ? c.width : 0, horizontal ? 0 : c.height);
    x.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
    x.drawImage(layer.img, 0, 0);
    const img = await loadImage(c.toDataURL("image/png"));
    pushUndoSnapshot();
    layer.img = img;
    delete layer._origImg;
    refresh(layer);
  }

  function duplicate(layer) {
    pushUndoSnapshot();
    const copy = { ...layer, id: ++_layerIdCounter, name: `${layer.name} copy`, x: layer.x + 24, y: layer.y + 24, animOrder: null };
    state.layers.splice(state.layers.indexOf(layer) + 1, 0, copy);
    refresh(copy);
  }

  inkLayerPanel.add((layer) => {
    const wrap = document.createElement("div");
    wrap.className = "ink-ls-section";
    wrap.innerHTML = '<div class="section-label" style="margin-top:2px">Layer</div><div class="ink-seg ink-actions"></div>';
    const row = wrap.querySelector(".ink-actions");
    const add = (text, title, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.title = title;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      row.appendChild(b);
    };
    if (layer.kind === "text") {
      add("Edit text", "Open this text in the text editor", () => {
        switchTab("text");
        openTextEditor(layer.x, layer.y, layer);
      });
    } else {
      add("Replace…", "Swap in a different image, keeping the position", () => {
        replacing = layer;
        picker.click();
      });
    }
    add("Flip ↔", "Mirror horizontally", () => flip(layer, true));
    add("Flip ↕", "Mirror vertically", () => flip(layer, false));
    add("Duplicate", "Copy this layer", () => duplicate(layer));
    wrap.addEventListener("mousedown", (e) => e.stopPropagation());
    return wrap;
  });
})();
