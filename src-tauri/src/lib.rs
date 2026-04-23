pub mod adapters;
pub mod commands;
pub mod db;
pub mod domain;
pub mod ingest;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::scan_sources,
            commands::get_session_detail,
            commands::delete_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
