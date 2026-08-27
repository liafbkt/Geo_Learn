mod content;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            content::list_content_pack_ids,
            content::read_content_resource
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
