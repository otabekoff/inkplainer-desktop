//! Inkplainer desktop: hosts the (offline-patched) web app in a frameless window.

use std::path::PathBuf;

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

/// Window size the app opens at, in logical pixels, when the screen has room for it.
const PREFERRED: (f64, f64) = (1440.0, 900.0);
/// Below 900px wide Inkplainer swaps its editor for a "use a desktop" notice.
const MINIMUM: (f64, f64) = (1000.0, 640.0);

/// WebView2 (Chromium) switches. Setting any replaces Tauri's defaults, so the first line
/// repeats them. The rest render and encode on the GPU (the discrete one on laptops that
/// have two) and keep an export running at full speed while the window is in the background.
const BROWSER_ARGS: &str = concat!(
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
    " --force_high_performance_gpu",
    " --ignore-gpu-blocklist",
    " --enable-gpu-rasterization",
    " --enable-zero-copy",
    " --disable-background-timer-throttling",
    " --disable-renderer-backgrounding",
    " --disable-backgrounding-occluded-windows",
);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch brings the open window forward instead of starting another app
        // on the same project storage.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let (width, height) = initial_size(app.handle());
            // Debug builds expose DevTools on a port so the app can be driven by scripts.
            let browser_args = if cfg!(debug_assertions) {
                format!("{BROWSER_ARGS} --remote-debugging-port=9229")
            } else {
                BROWSER_ARGS.to_string()
            };
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Inkplainer")
                .decorations(false)
                .shadow(true)
                .inner_size(width, height)
                .min_inner_size(MINIMUM.0, MINIMUM.1)
                .center()
                .additional_browser_args(&browser_args)
                .visible(false)
                .build()?;
            // Windows hands the launcher's "start maximized" hint (a maximized terminal,
            // a shortcut set to Maximized) to the first window shown. Undo it so the app
            // always opens at its own size and maximizing stays the user's choice.
            window.show()?;
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize()?;
                window.set_size(LogicalSize::new(width, height))?;
                window.center()?;
            }
            window.set_focus()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![save_export])
        .run(tauri::generate_context!())
        .expect("error while running Inkplainer");
}

/// Opens as a normal (restored) window that fits the screen, leaving maximize to the user.
fn initial_size(app: &AppHandle) -> (f64, f64) {
    let Some(monitor) = app.primary_monitor().ok().flatten() else {
        return PREFERRED;
    };
    let area: LogicalSize<f64> = monitor.work_area().size.to_logical(monitor.scale_factor());
    let fit = |preferred: f64, available: f64, minimum: f64| preferred.min(available * 0.92).max(minimum);
    (
        fit(PREFERRED.0, area.width, MINIMUM.0),
        fit(PREFERRED.1, area.height, MINIMUM.1),
    )
}

/// Saves an exported video or image. The body is the file's bytes and the
/// `x-file-name` header its suggested name. Returns false when the user cancels.
#[tauri::command]
async fn save_export(app: AppHandle, request: Request<'_>) -> Result<bool, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes as the request body".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(|v| percent_decode_str(v).decode_utf8_lossy().into_owned())
        .unwrap_or_else(|| "whiteboard".into());

    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let (filter, folder) = match ext.as_str() {
        "mp4" => ("MP4 video", app.path().video_dir()),
        "webm" => ("WebM video", app.path().video_dir()),
        "png" => ("PNG image", app.path().picture_dir()),
        _ => ("File", app.path().download_dir()),
    };

    let mut dialog = app.dialog().file().set_title("Save export").set_file_name(&name);
    if !ext.is_empty() {
        dialog = dialog.add_filter(filter, &[ext.as_str()]);
    }
    if let Ok(folder) = folder {
        dialog = dialog.set_directory(folder);
    }
    let Some(target) = dialog.blocking_save_file() else {
        return Ok(false);
    };
    let path: PathBuf = target.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    Ok(true)
}
