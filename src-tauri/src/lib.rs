pub mod backup;
mod content;
mod db;
mod progress;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(std::sync::Mutex::new(backup::BackupStages::default()))
        .setup(|app| {
            let database = db::Database::open(app.handle()).map_err(std::io::Error::other)?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            content::list_content_pack_ids,
            content::read_content_resource,
            progress::load_progress_snapshot,
            progress::save_attempt_transaction,
            progress::save_practice_session,
            progress::load_resumable_session,
            progress::load_settings,
            progress::save_settings,
            backup::choose_and_export_backup,
            backup::choose_and_inspect_backup,
            backup::import_staged_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
