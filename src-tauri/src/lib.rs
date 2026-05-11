pub mod adapters;
pub mod commands;
pub mod db;
pub mod domain;
pub mod ingest;
pub mod knowledge;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");
            std::fs::create_dir_all(&app_data_dir).expect("failed to create app data directory");

            let db_path = db::resolve_db_path(&app_data_dir);
            let conn = db::open_persistent_connection(&db_path).unwrap_or_else(|e| {
                eprintln!(
                    "DB open failed ({}), attempting recovery: {e}",
                    db_path.display()
                );

                let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
                let backup_path = db_path.with_extension(format!("db.corrupted.{timestamp}"));
                let _ = std::fs::rename(&db_path, &backup_path);

                db::open_persistent_connection(&db_path)
                    .expect("failed to create fresh database after recovery")
            });

            app.manage(db::AppState {
                db: std::sync::Arc::new(std::sync::Mutex::new(conn)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_all_data,
            commands::list_sessions,
            commands::get_session_detail,
            commands::get_token_report,
            commands::get_scan_stats,
            commands::delete_session,
            knowledge::commands::list_llm_providers,
            knowledge::commands::save_llm_provider,
            knowledge::commands::delete_llm_provider,
            knowledge::commands::list_knowledge_runs,
            knowledge::commands::list_knowledge_documents,
            knowledge::commands::update_knowledge_document,
            knowledge::commands::get_export_settings,
            knowledge::commands::save_export_settings,
            knowledge::commands::start_knowledge_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
