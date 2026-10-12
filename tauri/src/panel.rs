//! The quick-panel seam. macOS floats it over every Space; elsewhere it is an ordinary
//!
//! always-on-top window.

use tauri::{Emitter, Manager, WebviewWindow};

pub fn toggle(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("panel") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        show(&window);
    }
}

fn show(window: &WebviewWindow) {
    center_on_active_screen(window);
    float(window);
    let _ = window.show();
    let _ = window.set_focus(); // it is keyboard-driven, so it has to receive keys
    let _ = window.emit("panel-shown", ());
}

fn center_on_active_screen(window: &WebviewWindow) {
    let Ok(monitor) = window.current_monitor() else {
        return;
    };
    let Some(monitor) = monitor else { return };
    let screen = monitor.size().to_logical::<f64>(monitor.scale_factor());
    let origin = monitor.position().to_logical::<f64>(monitor.scale_factor());
    let Ok(size) = window.outer_size() else {
        return;
    };
    let size = size.to_logical::<f64>(monitor.scale_factor());
    let _ = window.set_position(tauri::LogicalPosition::new(
        origin.x + (screen.width - size.width) / 2.0,
        origin.y + (screen.height - size.height) / 3.0,
    ));
}

#[cfg(target_os = "macos")]
fn float(window: &WebviewWindow) {
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
    // ponytail: always-on-top, not a real NSPanel, so it does take focus while open.
    // Swap in tauri-nspanel if that becomes annoying.
}

#[cfg(not(target_os = "macos"))]
fn float(window: &WebviewWindow) {
    let _ = window.set_always_on_top(true);
}
