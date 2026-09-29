use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::{
    Mutex,
    atomic::{AtomicU64, Ordering},
};
use tauri::ipc::Response;
use tauri::{Emitter, Manager, WebviewWindow, WebviewWindowBuilder};

#[derive(Default)]
struct PendingDocuments(Mutex<HashMap<String, VecDeque<String>>>);
static NEXT_WINDOW: AtomicU64 = AtomicU64::new(1);

fn is_file(path: &str) -> bool {
    Path::new(path).is_file()
}

fn create_window(app: tauri::AppHandle) -> Result<String, String> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .ok_or("Missing window configuration")?
        .clone();
    config.label = format!("viewer-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    let label = config.label.clone();
    WebviewWindowBuilder::from_config(&app, &config)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    Ok(label)
}

#[tauri::command]
async fn new_window(app: tauri::AppHandle) -> Result<String, String> {
    create_window(app)
}

#[tauri::command]
fn window_ready(window: WebviewWindow, dark: bool) -> Result<(), String> {
    let color = if dark {
        tauri::window::Color(31, 32, 35, 255)
    } else {
        tauri::window::Color(241, 242, 244, 255)
    };
    window
        .set_background_color(Some(color))
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
fn close_window(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

fn queue_document(app: &tauri::AppHandle, path: String) {
    if !is_file(&path) {
        return;
    }
    let windows = app.webview_windows();
    let window = windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| windows.get("main"))
        .or_else(|| windows.values().next())
        .cloned()
        .or_else(|| {
            create_window(app.clone())
                .ok()
                .and_then(|label| app.get_webview_window(&label))
        });
    let Some(window) = window else {
        return;
    };
    if let Ok(mut pending) = app.state::<PendingDocuments>().0.lock() {
        pending
            .entry(window.label().to_string())
            .or_default()
            .push_back(path);
    }
    let _ = app.emit_to(window.label(), "open-document-path", ());
    if window.is_visible().unwrap_or(false) {
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn take_pending_document(
    window: WebviewWindow,
    state: tauri::State<'_, PendingDocuments>,
) -> Option<String> {
    state.0.lock().ok()?.get_mut(window.label())?.pop_front()
}

#[tauri::command]
async fn read_document(path: String) -> Result<Response, String> {
    if !is_file(&path) {
        return Err("Please choose a file.".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

#[cfg(target_os = "macos")]
fn desktop_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as Native, Submenu};
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "Preview Pro Max",
                true,
                &[
                    &Native::about(app, None, None)?,
                    &Native::separator(app)?,
                    &Native::services(app, None)?,
                    &Native::separator(app)?,
                    &Native::hide(app, None)?,
                    &Native::hide_others(app, None)?,
                    &Native::separator(app)?,
                    &Native::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &MenuItem::with_id(app, "new-tab", "New Tab", true, Some("CmdOrCtrl+T"))?,
                    &MenuItem::with_id(app, "new-window", "New Window", true, Some("CmdOrCtrl+N"))?,
                    &MenuItem::with_id(app, "open", "Open…", true, Some("CmdOrCtrl+O"))?,
                    &Native::separator(app)?,
                    &MenuItem::with_id(app, "close-tab", "Close Tab", true, Some("CmdOrCtrl+W"))?,
                    &MenuItem::with_id(
                        app,
                        "close-window",
                        "Close Window",
                        true,
                        Some("CmdOrCtrl+Shift+W"),
                    )?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &Native::undo(app, None)?,
                    &Native::redo(app, None)?,
                    &Native::separator(app)?,
                    &Native::cut(app, None)?,
                    &Native::copy(app, None)?,
                    &Native::paste(app, None)?,
                    &Native::select_all(app, None)?,
                    &Native::separator(app)?,
                    &MenuItem::with_id(app, "find", "Find…", true, Some("CmdOrCtrl+F"))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &Native::minimize(app, None)?,
                    &Native::maximize(app, None)?,
                    &Native::fullscreen(app, None)?,
                ],
            )?,
        ],
    )
}

pub fn run() {
    tauri::Builder::default()
        .manage(PendingDocuments::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths: Vec<_> = args
                .into_iter()
                .skip(1)
                .filter(|value| is_file(value))
                .collect();
            if paths.is_empty() {
                let _ = create_window(app.clone());
            }
            for path in paths {
                queue_document(app, path);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_document,
            take_pending_document,
            new_window,
            close_window,
            window_ready
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_menu(desktop_menu(app.handle())?)?;
            for path in std::env::args().skip(1).filter(|value| is_file(value)) {
                queue_document(app.handle(), path);
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let action = event.id().as_ref();
            if action == "new-window" {
                let _ = create_window(app.clone());
                return;
            }
            let windows = app.webview_windows();
            if let Some(window) = windows
                .values()
                .find(|w| w.is_focused().unwrap_or(false))
                .or_else(|| windows.values().next())
            {
                if action == "close-window" {
                    let _ = window.close();
                } else {
                    let _ = app.emit_to(window.label(), "menu-action", action);
                }
            }
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Ok(mut pending) = window.state::<PendingDocuments>().0.lock() {
                    pending.remove(window.label());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Preview Pro Max")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        queue_document(app, path.to_string_lossy().into_owned());
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
