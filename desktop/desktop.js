// Desktop shell for Inkplainer, loaded after the app's own scripts.
// 1. Title bar: Inkplainer's top bar drags the window (double-click maximizes) and
//    gets minimize / maximize / close buttons.
// 2. Exports: the app saves videos and stills through `<a download>.click()`; here
//    those go through a native "Save as" dialog instead.
(() => {
  const tauri = window.__TAURI__;
  if (!tauri) return; // opened in a plain browser
  const win = tauri.window.getCurrentWindow();
  const { invoke } = tauri.core;

  // ── Title bar ──────────────────────────────────────────────────────────────
  const GLYPH = { minimize: "", maximize: "", restore: "", close: "" };

  function setUpTitleBar() {
    const bar = document.getElementById("topbar");
    if (!bar) return;

    // Tauri drags only from elements that carry the attribute themselves, so mark the
    // bar plus every purely decorative piece of it (logo, labels, status dots).
    const passive = [
      "#topbar",
      ".topbar-logo", ".topbar-logo *",
      ".topbar-divider",
      ".topbar-center", ".topbar-center *",
      "#topbar-buffer", "#topbar-buffer *",
      ".topbar-right", "#export-status-top", ".version-pill",
    ];
    for (const el of document.querySelectorAll(passive.join(","))) {
      el.setAttribute("data-tauri-drag-region", "");
    }

    const controls = document.createElement("div");
    controls.id = "win-controls";
    controls.innerHTML = `
      <button type="button" class="min" title="Minimize" aria-label="Minimize">${GLYPH.minimize}</button>
      <button type="button" class="max" title="Maximize" aria-label="Maximize">${GLYPH.maximize}</button>
      <button type="button" class="close" title="Close" aria-label="Close">${GLYPH.close}</button>`;
    bar.appendChild(controls);

    const maxBtn = controls.querySelector(".max");
    controls.querySelector(".min").addEventListener("click", () => win.minimize());
    maxBtn.addEventListener("click", () => win.toggleMaximize());
    controls.querySelector(".close").addEventListener("click", () => win.close());

    const refresh = async () => {
      const maximized = await win.isMaximized();
      maxBtn.textContent = maximized ? GLYPH.restore : GLYPH.maximize;
      maxBtn.title = maxBtn.ariaLabel = maximized ? "Restore" : "Maximize";
    };
    refresh();
    win.onResized(refresh);
    win.onFocusChanged(({ payload }) => document.body.classList.toggle("win-blurred", !payload));
  }

  // ── Exports through a "Save as" dialog ─────────────────────────────────────
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.download || !this.href.startsWith("blob:")) return nativeClick.call(this);
    const name = this.download;
    const fallback = () => nativeClick.call(this);
    // Read the blob now: the app revokes the URL a second or two after clicking.
    fetch(this.href)
      .then((res) => res.arrayBuffer())
      .then((bytes) => invoke("save_export", bytes, { headers: { "x-file-name": encodeURIComponent(name) } }))
      .catch((err) => {
        console.error("Save dialog failed, using a plain download instead:", err);
        fallback();
      });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setUpTitleBar);
  } else {
    setUpTitleBar();
  }
})();
