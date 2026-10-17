// Keeps every range slider's filled track in step with its value. The app's sliders paint
// their fill from a --pct CSS variable that is only updated on some code paths, so a value
// set from code (selecting a layer, a preset, a template) left the fill at the CSS default
// of 40% while the thumb moved. This updates it whenever the value changes, however it changes.
(() => {
  const fill = (input) => {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const val = Number(input.value);
    const pct = max === min ? 0 : Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100));
    input.style.setProperty("--pct", `${pct}%`);
  };
  const isRange = (el) => el instanceof HTMLInputElement && el.type === "range";

  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  Object.defineProperty(HTMLInputElement.prototype, "value", {
    ...desc,
    set(v) {
      desc.set.call(this, v);
      if (this.type === "range") fill(this);
    },
  });
  for (const name of ["valueAsNumber"]) {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, name);
    if (!d?.set) continue;
    Object.defineProperty(HTMLInputElement.prototype, name, {
      ...d,
      set(v) {
        d.set.call(this, v);
        if (this.type === "range") fill(this);
      },
    });
  }
  document.addEventListener("input", (e) => isRange(e.target) && fill(e.target), true);

  // Sliders added later (panels built in code, values set through the value attribute).
  const fillAll = (root) => root.querySelectorAll?.('input[type="range"]').forEach(fill);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes" && isRange(r.target)) fill(r.target);
      for (const n of r.addedNodes) {
        if (isRange(n)) fill(n);
        else if (n.nodeType === 1) fillAll(n);
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "min", "max"] });
  fillAll(document);
})();
