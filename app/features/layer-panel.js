// Lets feature modules add their own sections to a layer's settings in the Layers panel
// (the block that opens under the selected layer). The app rebuilds that list on every
// change, so sections are re-added after each render.
//
//   inkLayerPanel.add((layer) => element | null)
//   inkLayerPanel.segmented(label, options, value, onChange)   a labelled button row
(() => {
  const builders = [];

  function decorate() {
    for (const box of document.querySelectorAll('.layer-settings[id^="ls-"]')) {
      if (box.dataset.ext) continue;
      box.dataset.ext = "1";
      const layer = getLayerById(Number(box.id.slice(3)));
      if (!layer) continue;
      const anchor = [...box.querySelectorAll(".section-label")].find((l) => /Position/.test(l.textContent));
      for (const build of builders) {
        const el = build(layer);
        if (!el) continue;
        if (anchor) box.insertBefore(el, anchor);
        else box.appendChild(el);
      }
    }
  }

  const original = window.renderLayerList;
  window.renderLayerList = function (...args) {
    const result = original.apply(this, args);
    decorate();
    return result;
  };

  function segmented(label, options, value, onChange, hint) {
    const wrap = document.createElement("div");
    wrap.className = "ink-ls-section";
    wrap.innerHTML = `<div class="section-label" style="margin-top:2px"></div><div class="ink-seg"></div>`;
    wrap.querySelector(".section-label").textContent = label;
    if (hint) wrap.querySelector(".section-label").title = hint;
    const seg = wrap.querySelector(".ink-seg");
    for (const [val, text, tip] of options) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      if (tip) b.title = tip;
      b.classList.toggle("active", val === value);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        seg.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
        onChange(val);
      });
      seg.appendChild(b);
    }
    // Keep clicks inside from reaching handlers that select or drag the layer.
    wrap.addEventListener("mousedown", (e) => e.stopPropagation());
    return wrap;
  }

  window.inkLayerPanel = {
    add(build) {
      builders.push(build);
      document.querySelectorAll('.layer-settings[id^="ls-"]').forEach((b) => delete b.dataset.ext);
      decorate();
    },
    segmented,
  };
})();
