use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{
    Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use tauri::ipc::Response;
use tauri::{Emitter, Manager, WebviewWindow, WebviewWindowBuilder, Window};

#[cfg(target_os = "macos")]
mod macos;
mod window_frame;
use window_frame::WindowFrame;

#[derive(Default)]
struct PendingDocuments(Mutex<HashMap<String, VecDeque<String>>>);
static NEXT_WINDOW: AtomicU64 = AtomicU64::new(1);
static QUITTING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedTab {
    path: String,
    page: usize,
    zoom: f64,
    rotation: u16,
    fit: bool,
    top: f64,
    left: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedWindow {
    id: String,
    tabs: Vec<SavedTab>,
    active: usize,
    updated: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    frame: Option<WindowFrame>,
}

#[derive(Default, Serialize, Deserialize)]
struct StoredSessions {
    windows: Vec<SavedWindow>,
    open: Vec<String>,
    #[serde(default, rename = "lastFrame", skip_serializing_if = "Option::is_none")]
    last_frame: Option<WindowFrame>,
}

struct SessionData {
    stored: StoredSessions,
    labels: HashMap<String, String>,
}

struct SessionManager {
    path: PathBuf,
    data: Mutex<SessionData>,
}

#[derive(Serialize)]
struct SessionInfo {
    restore: Option<SavedWindow>,
    recent: Vec<SavedWindow>,
}

impl SessionManager {
    fn new(app: &tauri::AppHandle) -> Self {
        let path = app
            .path()
            .app_config_dir()
            .expect("Missing app config directory")
            .join("sessions.json");
        let stored = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            data: Mutex::new(SessionData {
                stored,
                labels: HashMap::new(),
            }),
        }
    }

    fn write(&self, stored: &StoredSessions) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let bytes = serde_json::to_vec(stored).map_err(|e| e.to_string())?;
        // Session writes hold the manager lock. Replace the last complete snapshot
        // only after the new one has been written on the same filesystem.
        let pending = self.path.with_extension("json.tmp");
        std::fs::write(&pending, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(pending, &self.path).map_err(|e| e.to_string())
    }

    fn finish_window(&self, window: &Window, archive: bool) {
        let frame = WindowFrame::capture(window);
        let Ok(mut data) = self.data.lock() else {
            return;
        };
        let id = data.labels.get(window.label()).cloned();
        let mut changed = false;
        if let Some(frame) = frame {
            if let Some(saved) = data
                .stored
                .windows
                .iter_mut()
                .find(|saved| Some(&saved.id) == id.as_ref())
            {
                changed |= saved.frame.as_ref() != Some(&frame);
                saved.frame = Some(frame.clone());
            }
            changed |= data.stored.last_frame.as_ref() != Some(&frame);
            data.stored.last_frame = Some(frame);
        }
        if let (true, Some(id)) = (archive, id) {
            changed = true;
            data.labels.remove(window.label());
            data.stored.open.retain(|item| item != &id);
        }
        if changed {
            if let Err(error) = self.write(&data.stored) {
                eprintln!("Unable to save window session: {error}");
            }
        }
    }

    fn restore_frame(&self, window: &Window, session_id: Option<&str>) {
        let frame = self.data.lock().ok().and_then(|data| {
            let id = session_id.or_else(|| data.labels.get(window.label()).map(String::as_str));
            match id {
                Some(id) => data
                    .stored
                    .windows
                    .iter()
                    .find(|saved| saved.id == id)?
                    .frame
                    .clone(),
                None if window.label() == "main" => data.stored.last_frame.clone(),
                None => None,
            }
        });
        if let Some(frame) = frame {
            frame.restore(window);
        }
    }
}

#[tauri::command]
fn get_sessions(
    window: WebviewWindow,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionInfo, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    let restore = data
        .labels
        .get(window.label())
        .and_then(|id| data.stored.windows.iter().find(|item| &item.id == id))
        .cloned();
    let mut recent = data.stored.windows.clone();
    recent.sort_by_key(|item| std::cmp::Reverse(item.updated));
    Ok(SessionInfo { restore, recent })
}

#[tauri::command]
fn save_session(
    window: Window,
    state: tauri::State<'_, SessionManager>,
    mut session: SavedWindow,
) -> Result<(), String> {
    if session.tabs.is_empty() || session.id.is_empty() {
        return Ok(());
    }
    let frame = WindowFrame::capture(&window);
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    session.frame = frame.or_else(|| {
        data.stored
            .windows
            .iter()
            .find(|saved| saved.id == session.id)?
            .frame
            .clone()
    });
    data.labels
        .insert(window.label().to_string(), session.id.clone());
    data.stored.windows.retain(|item| item.id != session.id);
    data.stored.windows.push(session.clone());
    if !data.stored.open.contains(&session.id) {
        data.stored.open.push(session.id);
    }
    data.stored
        .windows
        .sort_by_key(|item| std::cmp::Reverse(item.updated));
    let open = data.stored.open.clone();
    let mut kept = 0;
    data.stored.windows.retain(|item| {
        kept += 1;
        kept <= 20 || open.contains(&item.id)
    });
    state.write(&data.stored)
}

#[tauri::command]
fn archive_session(window: Window, state: tauri::State<'_, SessionManager>) {
    state.finish_window(&window, true);
}

#[tauri::command]
fn restore_session_frame(
    window: Window,
    state: tauri::State<'_, SessionManager>,
    session_id: String,
) {
    state.restore_frame(&window, Some(&session_id));
}

fn is_file(path: &str) -> bool {
    Path::new(path).is_file()
}

fn create_window(app: tauri::AppHandle, restore: Option<String>) -> Result<String, String> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .ok_or("Missing window configuration")?
        .clone();
    config.label = format!("viewer-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    let label = config.label.clone();
    if let Some(id) = restore {
        app.state::<SessionManager>()
            .data
            .lock()
            .map_err(|e| e.to_string())?
            .labels
            .insert(label.clone(), id);
    }
    let built = WebviewWindowBuilder::from_config(&app, &config)
        .and_then(|builder| builder.build())
        .map_err(|e| e.to_string());
    if built.is_err() {
        app.state::<SessionManager>()
            .data
            .lock()
            .map_err(|e| e.to_string())?
            .labels
            .remove(&label);
    }
    built?;
    Ok(label)
}

#[tauri::command]
async fn new_window(app: tauri::AppHandle) -> Result<String, String> {
    create_window(app, None)
}

#[tauri::command]
fn window_ready(window: WebviewWindow, dark: bool) -> Result<(), String> {
    // Leave room for macOS half-screen tiles on smaller displays.
    #[cfg(target_os = "macos")]
    {
        window
            .set_min_size(Some(tauri::LogicalSize::new(480.0, 320.0)))
            .map_err(|e| e.to_string())?;
    }
    window
        .state::<SessionManager>()
        .restore_frame(&window.as_ref().window(), None);
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
fn close_window(window: Window) -> Result<(), String> {
    window
        .state::<SessionManager>()
        .finish_window(&window, true);
    window.close().map_err(|e| e.to_string())
}

fn document_window_label(app: &tauri::AppHandle) -> Option<String> {
    // Launch Services can deliver Opened before Tauri creates the main window.
    if app.try_state::<SessionManager>().is_none() {
        return Some("main".into());
    }
    let windows = app.webview_windows();
    windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| windows.get("main"))
        .or_else(|| windows.values().next())
        .map(|window| window.label().to_owned())
        .or_else(|| create_window(app.clone(), None).ok())
}

fn queue_document(app: &tauri::AppHandle, path: PathBuf) {
    if !path.is_file() {
        return;
    }
    let Some(label) = document_window_label(app) else {
        return;
    };
    if let Ok(mut pending) = app.state::<PendingDocuments>().0.lock() {
        pending
            .entry(label.clone())
            .or_default()
            .push_back(path.to_string_lossy().into_owned());
    }
    if let Some(window) = app.get_webview_window(&label) {
        let _ = app.emit_to(label.as_str(), "open-document-path", ());
        if window.is_visible().unwrap_or(false) {
            let _ = window.set_focus();
        }
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
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as Native, Submenu, WINDOW_SUBMENU_ID};
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
                    &MenuItem::with_id(
                        app,
                        "quit",
                        "Quit Preview Pro Max",
                        true,
                        Some("CmdOrCtrl+Q"),
                    )?,
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
            &Submenu::with_id_and_items(
                app,
                WINDOW_SUBMENU_ID,
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
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths: Vec<_> = args
                .into_iter()
                .skip(1)
                .map(|value| Path::new(&cwd).join(value))
                .filter(|path| path.is_file())
                .collect();
            if paths.is_empty() {
                let _ = create_window(app.clone(), None);
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
            window_ready,
            get_sessions,
            save_session,
            archive_session,
            restore_session_frame
        ])
        .setup(|app| {
            let manager = SessionManager::new(app.handle());
            let restore = {
                let data = manager.data.lock().unwrap();
                data.stored
                    .open
                    .iter()
                    .filter(|id| data.stored.windows.iter().any(|window| &window.id == *id))
                    .cloned()
                    .collect::<Vec<_>>()
            };
            if let Some(id) = restore.first() {
                manager
                    .data
                    .lock()
                    .unwrap()
                    .labels
                    .insert("main".into(), id.clone());
            }
            app.manage(manager);
            for id in restore.into_iter().skip(1) {
                let _ = create_window(app.handle().clone(), Some(id));
            }
            #[cfg(target_os = "macos")]
            {
                app.set_menu(desktop_menu(app.handle())?)?;
                macos::install_tiling_shortcuts(app.handle().clone());
            }
            for arg in std::env::args_os().skip(1) {
                if let Ok(path) = std::path::absolute(arg) {
                    queue_document(app.handle(), path);
                }
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let action = event.id().as_ref();
            if action == "quit" {
                QUITTING.store(true, Ordering::Relaxed);
                app.exit(0);
                return;
            }
            if action == "new-window" {
                let _ = create_window(app.clone(), None);
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
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let archive = !QUITTING.load(Ordering::Relaxed)
                    && window.app_handle().webview_windows().len() > 1;
                window
                    .state::<SessionManager>()
                    .finish_window(window, archive);
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Ok(mut pending) = window.state::<PendingDocuments>().0.lock() {
                    pending.remove(window.label());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Preview Pro Max")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                QUITTING.store(true, Ordering::Relaxed);
                for window in app.webview_windows().values() {
                    app.state::<SessionManager>()
                        .finish_window(&window.as_ref().window(), false);
                }
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        queue_document(app, path);
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
