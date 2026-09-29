use std::path::Path;
use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::{Emitter, Manager};

#[derive(Default)]
struct PendingDocument(Mutex<Option<String>>);

fn is_file(path: &str) -> bool {
    Path::new(path).is_file()
}

fn queue_document(app: &tauri::AppHandle, path: String) {
    if !is_file(&path) {
        return;
    }
    if let Ok(mut pending) = app.state::<PendingDocument>().0.lock() {
        *pending = Some(path);
    }
    let _ = app.emit("open-document-path", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn take_pending_document(state: tauri::State<'_, PendingDocument>) -> Option<String> {
    state.0.lock().ok()?.take()
}

#[tauri::command]
async fn read_document(path: String) -> Result<Response, String> {
    if !is_file(&path) {
        return Err("Please choose a file.".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    Ok(Response::new(bytes))
}

pub fn run() {
    tauri::Builder::default()
        .manage(PendingDocument::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = args.into_iter().skip(1).find(|value| is_file(value)) {
                queue_document(app, path);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_document,
            take_pending_document
        ])
        .setup(|app| {
            if let Some(path) = std::env::args().skip(1).find(|value| is_file(value)) {
                queue_document(app.handle(), path);
            }
            Ok(())
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
