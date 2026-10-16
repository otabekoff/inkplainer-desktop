// More built-in presets. A preset can also choose a background (settings.bg, a preset key
// from features/backgrounds.js), so a "look" is one click.
(() => {
  const base = {
    zigzag: true, outlineDetect: 50, outlineAlgorithm: "classic", outlineStrokeStyle: "default",
    colorStyle: "filled", textAnimDir: "ltr", textDrawStyle: "reveal",
  };
  const MORE = [
    { id: "preset-marker-pro", name: "Marker Pro", desc: "Outline first, then filled colour, drawn by hand. The classic explainer look.",
      settings: { ...base, animStyle: "illustfill", hand: "custom1", speed: 45, handSpeed: 7 } },
    { id: "preset-pencil", name: "Pencil Sketch", desc: "Charcoal outline with light colour, drawn with a pen.",
      settings: { ...base, animStyle: "outlinefill", hand: "custom4", speed: 35, handSpeed: 6, outlineStrokeStyle: "charcoal", colorStyle: "sparse", bg: "warmwhite" } },
    { id: "preset-watercolor", name: "Watercolor", desc: "Fountain-pen outline with watercolour fills on paper.",
      settings: { ...base, animStyle: "illustfill", hand: "custom2", speed: 38, handSpeed: 6, outlineStrokeStyle: "fountain", colorStyle: "watercolor", bg: "warmwhite" } },
    { id: "preset-chalk-talk", name: "Chalk Talk", desc: "Contour drawing on a chalkboard.",
      settings: { ...base, animStyle: "contour", hand: "custom3", speed: 42, handSpeed: 7, outlineStrokeStyle: "charcoal", bg: "chalk" } },
    { id: "preset-blueprint-ink", name: "Blueprint Ink", desc: "Technical line drawing on blueprint paper.",
      settings: { ...base, animStyle: "outlineonly", hand: "custom4", speed: 45, handSpeed: 8, outlineStrokeStyle: "blueprint", bg: "blueprint" } },
    { id: "preset-speed-draw", name: "Speed Draw", desc: "Very fast scanner reveal for long explainers.",
      settings: { ...base, animStyle: "scanner", hand: "custom3", speed: 90, handSpeed: 14 } },
    { id: "preset-slide-in", name: "Slide In", desc: "The hand carries each element onto the board.",
      settings: { ...base, animStyle: "enter-move", hand: "custom1", speed: 55, handSpeed: 8 } },
    { id: "preset-soft-fade", name: "Soft Fade", desc: "Elements fade in, no hand. Calm and minimal.",
      settings: { ...base, animStyle: "enter-fade", hand: "ghost", speed: 45, handSpeed: 6 } },
  ];
  for (const p of MORE) if (!BUILT_IN_PRESETS.some((b) => b.id === p.id)) BUILT_IN_PRESETS.push(p);

  // applyPreset sets the speed sliders but not the selected layer's own speed, which is
  // what the animation reads; and it knows nothing of backgrounds.
  const originalApply = window.applyPreset;
  window.applyPreset = function (settings, presetId) {
    const r = originalApply.call(this, settings, presetId);
    const layer = getSelectedLayer();
    if (layer) {
      if (settings.speed != null) layer.speed = settings.speed;
      if (settings.handSpeed != null) layer.handSpeed = settings.handSpeed;
      syncSidebarToLayer(layer.id);
    }
    if (settings.bg && BG_GRADIENTS[settings.bg]) {
      selectBgPreset(document.querySelector(`#bg-presets [data-bg-key="${settings.bg}"]`), "gradient", settings.bg);
    }
    scheduleAutoSave();
    return r;
  };
  renderPresets();
})();
