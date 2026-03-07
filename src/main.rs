use tauri::Manager;

mod commands;
mod models;
mod ollama;
mod utils;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                let window = app.get_webview_window("main").unwrap();
                apply_blur_effect(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pick_folder,
            commands::scan_folder,
            commands::get_models,
            commands::generate_names,
            commands::apply_renames,
            commands::organize_by_tags,
            commands::organize_all_to_folder,
            commands::organize_by_date,
            commands::organize_by_time,
            commands::analyze_tags,
            commands::stop_recognition
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "windows")]
fn apply_blur_effect(window: &tauri::WebviewWindow) {
    use window_vibrancy::apply_mica;

    // Set both window and webview background to fully transparent
    let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));

    // Apply Mica backdrop
    let _ = apply_mica(window, Some(true));
}
