pub mod backup;
mod content;
mod db;
mod progress;
#[cfg(windows)]
mod update;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(std::sync::Mutex::new(backup::BackupStages::default()))
        .setup(|app| {
            #[cfg(windows)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            #[cfg(windows)]
            app.handle().plugin(update::init())?;
            let database = db::Database::open(app.handle()).map_err(std::io::Error::other)?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            content::list_content_pack_ids,
            content::read_content_resource,
            progress::load_progress_snapshot,
            progress::load_attempt_history,
            progress::load_retry_debts,
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
