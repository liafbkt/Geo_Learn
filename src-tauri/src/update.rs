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
    let Some(update) = updater.check().await.map_err(check_error_code)? else {
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

fn check_error_code(error: tauri_plugin_updater::Error) -> &'static str {
    use tauri_plugin_updater::Error;
    match error {
        // The plugin discards non-success HTTP status codes, including 404 and 5xx.
        Error::ReleaseNotFound => "UPDATE_FEED_UNAVAILABLE",
        Error::Reqwest(error) if error.is_decode() => "UPDATE_METADATA_INVALID",
        Error::Reqwest(_) => "UPDATE_NETWORK_FAILED",
        Error::Serialization(_)
        | Error::Semver(_)
        | Error::TargetNotFound(_)
        | Error::TargetsNotFound(_) => "UPDATE_METADATA_INVALID",
        _ => "UPDATE_CHECK_FAILED",
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("app-update")
        .invoke_handler(tauri::generate_handler![check])
        .build()
}

#[cfg(test)]
mod tests {
    use super::check_error_code;
    use tauri_plugin_updater::Error;

    #[test]
    fn missing_feed_is_not_a_network_failure() {
        assert_eq!(
            check_error_code(Error::ReleaseNotFound),
            "UPDATE_FEED_UNAVAILABLE"
        );
    }

    #[test]
    fn unsupported_platform_is_invalid_metadata() {
        assert_eq!(
            check_error_code(Error::TargetNotFound("windows-x86_64".into())),
            "UPDATE_METADATA_INVALID"
        );
    }
}
