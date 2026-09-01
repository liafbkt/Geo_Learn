//! No-argument update check. Do not grant the upstream generic check command:
//! it accepts proxy URLs, request headers, target overrides and downgrades.
//! The official plugin still owns download, signature verification and install.

use serde::Serialize;
use std::time::Duration;
use tauri::{plugin::TauriPlugin, Manager, Runtime, Webview};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMetadata {
    rid: tauri::ResourceId,
    current_version: String,
    version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    // Required by the official JS Update constructor; never expose manifest URLs.
    raw_json: serde_json::Value,
}

#[tauri::command]
async fn check<R: Runtime>(webview: Webview<R>) -> Result<Option<UpdateMetadata>, &'static str> {
    let updater = webview
        .updater_builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "UPDATE_NOT_CONFIGURED")?;
    let Some(update) = updater.check().await.map_err(|_| "UPDATE_CHECK_FAILED")? else {
        return Ok(None);
    };
    let date = update
        .date
        .map(|value| value.format(&time::format_description::well_known::Rfc3339))
        .transpose()
        .map_err(|_| "UPDATE_METADATA_INVALID")?;
    let current_version = update.current_version.clone();
    let version = update.version.clone();
    let body = update.body.clone();
    // Store the actual official Update, not a renderer-supplied URL or byte buffer.
    let rid = webview.resources_table().add(update);
    Ok(Some(UpdateMetadata {
        rid,
        current_version,
        version,
        date,
        body,
        raw_json: serde_json::json!({}),
    }))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("app-update")
        .invoke_handler(tauri::generate_handler![check])
        .build()
}
