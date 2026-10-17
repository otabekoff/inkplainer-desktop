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
      .then((path) => path && showSaved(path))
      .catch((err) => {
        console.error("Save dialog failed, using a plain download instead:", err);
        fallback();
      });
  };

  // ── "Saved" dialog: where the file went, with Play and Show in folder ──────
  const dialog = document.createElement("div");
  dialog.id = "export-saved";
  dialog.innerHTML = `
    <div class="es-card" role="dialog" aria-modal="true" aria-labelledby="es-title">
      <div class="es-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </div>
      <div class="es-title" id="es-title"></div>
      <div class="es-file"></div>
      <div class="es-folder"></div>
      <div class="es-actions">
        <button type="button" class="es-open es-primary"></button>
        <button type="button" class="es-reveal">Show in folder</button>
        <button type="button" class="es-close">Close</button>
      </div>
      <div class="es-error"></div>
    </div>`;
  document.body.appendChild(dialog);
  let savedPath = null;
  const hide = () => dialog.classList.remove("show");
  const run = (cmd) =>
    invoke(cmd, { path: savedPath })
      .then(hide)
      .catch((err) => (dialog.querySelector(".es-error").textContent = String(err)));
  dialog.querySelector(".es-open").addEventListener("click", () => run("open_export"));
  dialog.querySelector(".es-reveal").addEventListener("click", () => run("reveal_export"));
  dialog.querySelector(".es-close").addEventListener("click", hide);
  dialog.addEventListener("mousedown", (e) => e.target === dialog && hide());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dialog.classList.contains("show")) hide();
  });

  function showSaved(path) {
    savedPath = path;
    const sep = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
    const file = path.slice(sep + 1);
    const isImage = /\.(png|jpe?g)$/i.test(file);
    dialog.querySelector(".es-title").textContent = isImage ? "Image saved" : "Video saved";
    dialog.querySelector(".es-file").textContent = file;
    dialog.querySelector(".es-folder").textContent = path.slice(0, sep);
    dialog.querySelector(".es-folder").title = path;
    dialog.querySelector(".es-open").textContent = isImage ? "Open image" : "Play video";
    dialog.querySelector(".es-error").textContent = "";
    // The export banner closes itself shortly after a save; this replaces it.
    if (typeof closeExportBanner === "function") closeExportBanner();
    dialog.classList.add("show");
    dialog.querySelector(".es-open").focus();
  }
  window.showExportSaved = showSaved;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setUpTitleBar);
  } else {
    setUpTitleBar();
  }
})();
