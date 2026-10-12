//! The shell owns the vault, the global shortcut and the quick panel. Nothing else: the webview
//! never touches a platform API directly.

mod panel;
mod qr;
mod store;

use std::fs;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[tauri::command]
fn vault_load() -> Result<Option<String>, String> {
    store::load()
}

#[tauri::command]
fn vault_save(json: String) -> Result<(), String> {
    store::save(&json)
}

/// The webview cannot reach the clipboard: WebKit only allows a write inside a user gesture,
/// and the code is only known after an async digest.
#[tauri::command]
fn copy_code(app: tauri::AppHandle, text: String) -> Result<(), String> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("Could not copy: {e}"))
}

/// Wipes the clipboard only while it still holds the code we put there.
#[tauri::command]
fn clear_code(app: tauri::AppHandle, expected: String) -> Result<(), String> {
    if app.clipboard().read_text().ok().as_deref() != Some(expected.as_str()) {
        return Ok(());
    }
    app.clipboard()
        .write_text(String::new())
        .map_err(|e| format!("Could not clear the clipboard: {e}"))
}

#[tauri::command]
fn scan_qr(image: Vec<u8>) -> Result<Option<String>, String> {
    qr::scan(&image)
}

#[tauri::command]
fn hide_panel(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("panel") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn set_shortcut(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    let shortcut: Shortcut = accelerator
        .parse()
        .map_err(|_| "That shortcut can't be used.".to_string())?;
    let manager = app.global_shortcut();
    let _ = manager.unregister_all();
    manager
        .on_shortcut(shortcut, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                panel::toggle(app);
            }
        })
        .map_err(|_| "That one is already taken.".to_string())
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let result = if on {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|e| format!("Could not change the login item: {e}"))
}

#[tauri::command]
fn export_links(app: tauri::AppHandle, text: String) -> Result<String, String> {
    // a fixed path in Downloads, since a save dialog would mean another plugin
    let dir = app
        .path()
        .download_dir()
        .map_err(|_| "No Downloads folder.".to_string())?;
    let path = dir.join("authd-keys.txt");
    fs::write(&path, text).map_err(|e| format!("Could not write the file: {e}"))?;
    Ok(path.display().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // macOS routes ⌘C/⌘V through the menu, so the webview needs one to paste at all
            app.set_menu(tauri::menu::Menu::default(app.handle())?)?;
            Ok(())
        })
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            vault_load,
            vault_save,
            copy_code,
            clear_code,
            scan_qr,
            hide_panel,
            set_shortcut,
            set_autostart,
            export_links
        ])
        .on_window_event(|window, event| {
            if window.label() == "panel" {
                if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("authd failed to start");
}
