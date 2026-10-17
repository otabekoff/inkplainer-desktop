//! Inkplainer desktop: hosts the (offline-patched) web app in a frameless window.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// Files saved by save_export in this session: the only paths reveal/open accept, so the
/// page cannot ask Windows to open arbitrary files.
#[derive(Default)]
struct SavedExports(Mutex<HashSet<PathBuf>>);

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
    let mut builder = tauri::Builder::default();
    // A second launch brings the open window forward instead of starting another app on the
    // same project storage. Debug builds can opt out (INKPLAINER_ALLOW_MULTIPLE=1) so a
    // scripted test instance with its own WebView2 data folder can run next to a normal one.
    if !(cfg!(debug_assertions) && std::env::var_os("INKPLAINER_ALLOW_MULTIPLE").is_some()) {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .manage(SavedExports::default())
        .manage(PickedExports::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let (width, height) = initial_size(app.handle());
            // Debug builds expose DevTools on a port (INKPLAINER_DEVTOOLS_PORT, default 9229)
            // so the app can be driven by scripts.
            let browser_args = if cfg!(debug_assertions) {
                let port = std::env::var("INKPLAINER_DEVTOOLS_PORT").unwrap_or_else(|_| "9229".into());
                format!("{BROWSER_ARGS} --remote-debugging-port={port}")
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
            #[cfg(windows)]
            allow_own_microphone(&window);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![save_export, pick_export_path, write_export, reveal_export, open_export])
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
/// `x-file-name` header its suggested name. Returns where it was saved, or None when the
/// user cancels.
#[tauri::command]
async fn save_export(
    app: AppHandle,
    saved: tauri::State<'_, SavedExports>,
    request: Request<'_>,
) -> Result<Option<String>, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes as the request body".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(|v| percent_decode_str(v).decode_utf8_lossy().into_owned())
        .unwrap_or_else(|| "whiteboard".into());

    let Some(path) = ask_save_path(&app, &name)? else {
        return Ok(None);
    };
    std::fs::write(&path, bytes).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    saved.0.lock().unwrap().insert(path.clone());
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// The "Save as" dialog, opened in Videos for videos and Pictures for images.
fn ask_save_path(app: &AppHandle, name: &str) -> Result<Option<PathBuf>, String> {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let (filter, folder) = match ext.as_str() {
        "mp4" => ("MP4 video", app.path().video_dir()),
        "webm" => ("WebM video", app.path().video_dir()),
        "png" => ("PNG image", app.path().picture_dir()),
        _ => ("File", app.path().download_dir()),
    };
    let mut dialog = app.dialog().file().set_title("Export video").set_file_name(name);
    if !ext.is_empty() {
        dialog = dialog.add_filter(filter, &[ext.as_str()]);
    }
    if let Ok(folder) = folder {
        dialog = dialog.set_directory(folder);
    }
    match dialog.blocking_save_file() {
        Some(target) => Ok(Some(target.into_path().map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

/// Recording a voiceover is part of the app itself, so the app's own pages get the microphone
/// without WebView2's extra "allow microphone?" prompt. (Windows' own privacy setting for
/// microphone access still applies.) Other pages and other permissions are left alone.
#[cfg(windows)]
fn allow_own_microphone(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;
    let _ = window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut kind)?;
            if kind != COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                return Ok(());
            }
            let mut uri = windows_core::PWSTR::null();
            args.Uri(&mut uri)?;
            let uri = webview2_com::take_pwstr(uri);
            let own = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://127.0.0.1:", "http://localhost:"];
            if own.iter().any(|prefix| uri.starts_with(prefix)) {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_PermissionRequested(&handler, &mut token);
    });
}

/// Paths chosen with pick_export_path: the only places write_export writes to.
#[derive(Default)]
struct PickedExports(Mutex<HashSet<PathBuf>>);

/// Asks where an export goes, before it is rendered (so the save comes first, not last).
#[tauri::command]
async fn pick_export_path(
    app: AppHandle,
    picked: tauri::State<'_, PickedExports>,
    name: String,
) -> Result<Option<String>, String> {
    // Debug builds: INKPLAINER_TEST_EXPORT_DIR skips the dialog, for scripted tests.
    let test_dir = cfg!(debug_assertions).then(|| std::env::var_os("INKPLAINER_TEST_EXPORT_DIR")).flatten();
    let path = match test_dir {
        Some(dir) => PathBuf::from(dir).join(&name),
        None => match ask_save_path(&app, &name)? {
            Some(path) => path,
            None => return Ok(None),
        },
    };
    picked.0.lock().unwrap().insert(path.clone());
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Writes an export to a path chosen with pick_export_path (header `x-path`), or next to it
/// with another extension (header `x-ext`, e.g. the final frame as .png beside the video).
/// The body is the file's bytes. Returns the path written.
#[tauri::command]
async fn write_export(
    picked: tauri::State<'_, PickedExports>,
    saved: tauri::State<'_, SavedExports>,
    request: Request<'_>,
) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes as the request body".into());
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|v| percent_decode_str(v).decode_utf8_lossy().into_owned())
    };
    let chosen = PathBuf::from(header("x-path").ok_or("missing x-path")?);
    if !picked.0.lock().unwrap().contains(&chosen) {
        return Err("not a path chosen for this export".into());
    }
    let target = match header("x-ext") {
        Some(ext) if ext.chars().all(|c| c.is_ascii_alphanumeric()) && !ext.is_empty() => chosen.with_extension(ext),
        Some(_) => return Err("bad extension".into()),
        None => chosen,
    };
    std::fs::write(&target, bytes).map_err(|e| format!("could not write {}: {e}", target.display()))?;
    saved.0.lock().unwrap().insert(target.clone());
    Ok(target.to_string_lossy().into_owned())
}

fn saved_path(saved: &SavedExports, path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !saved.0.lock().unwrap().contains(&path) {
        return Err("not a file exported in this session".into());
    }
    if !path.exists() {
        return Err(format!("{} no longer exists", path.display()));
    }
    Ok(path)
}

/// Shows an exported file selected in File Explorer.
#[tauri::command]
fn reveal_export(app: AppHandle, saved: tauri::State<'_, SavedExports>, path: String) -> Result<(), String> {
    let path = saved_path(&saved, &path)?;
    app.opener().reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

/// Opens an exported file in its default app (the video player for MP4/WebM).
#[tauri::command]
fn open_export(app: AppHandle, saved: tauri::State<'_, SavedExports>, path: String) -> Result<(), String> {
    let path = saved_path(&saved, &path)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}
