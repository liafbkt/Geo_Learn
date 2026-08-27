use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const RESOURCE_NAMES: [&str; 4] = [
    "manifest.json",
    "entities.json",
    "sources.json",
    "map.topojson",
];

#[derive(Debug, Serialize)]
pub struct ContentResourceError {
    pub code: String,
    pub message: String,
}

impl ContentResourceError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
        }
    }
}

pub fn validate_pack_id(pack_id: &str) -> Result<(), ContentResourceError> {
    if pack_id.is_empty()
        || !pack_id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(ContentResourceError::new(
            "invalid_pack_id",
            "Pack ID must contain only lowercase ASCII letters, digits, and hyphens.",
        ));
    }
    Ok(())
}

pub fn validate_resource_name(file_name: &str) -> Result<(), ContentResourceError> {
    if RESOURCE_NAMES.contains(&file_name) {
        Ok(())
    } else {
        Err(ContentResourceError::new(
            "invalid_resource_name",
            "Resource name is not allow-listed.",
        ))
    }
}

fn resource_error(code: &str, message: impl Into<String>) -> ContentResourceError {
    ContentResourceError::new(code, message)
}

fn enumerate_pack_ids(root: &Path) -> Result<Vec<String>, ContentResourceError> {
    let entries = std::fs::read_dir(root).map_err(|_| {
        resource_error(
            "content_root_unavailable",
            "Bundled content is unavailable.",
        )
    })?;
    let mut ids = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|_| {
            resource_error(
                "content_enumeration_failed",
                "Unable to enumerate bundled content.",
            )
        })?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if validate_pack_id(name).is_ok() && path.join("manifest.json").is_file() {
            ids.push(name.to_owned());
        }
    }
    ids.sort();
    Ok(ids)
}

fn content_root(app: &AppHandle) -> Result<PathBuf, ContentResourceError> {
    app.path()
        .resource_dir()
        .map(|root| root.join("resources").join("content"))
        .map_err(|_| {
            resource_error(
                "content_root_unavailable",
                "Bundled content is unavailable.",
            )
        })
}

#[tauri::command]
pub fn list_content_pack_ids(app: AppHandle) -> Result<Vec<String>, ContentResourceError> {
    enumerate_pack_ids(&content_root(&app)?)
}

#[tauri::command]
pub fn read_content_resource(
    app: AppHandle,
    pack_id: String,
    file_name: String,
) -> Result<String, ContentResourceError> {
    validate_pack_id(&pack_id)?;
    validate_resource_name(&file_name)?;
    let path = content_root(&app)?.join(&pack_id).join(&file_name);
    std::fs::read_to_string(path).map_err(|_| {
        resource_error(
            "content_resource_unavailable",
            "Bundled content resource is unavailable.",
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{enumerate_pack_ids, validate_pack_id, validate_resource_name};

    #[test]
    fn rejects_path_traversal_and_absolute_pack_ids() {
        assert!(validate_pack_id("../settings.json").is_err());
        assert!(validate_pack_id("C:\\temp").is_err());
        assert!(validate_pack_id("pack/child").is_err());
    }

    #[test]
    fn allows_only_the_four_content_resource_names() {
        assert!(validate_resource_name("manifest.json").is_ok());
        assert!(validate_resource_name("entities.json").is_ok());
        assert!(validate_resource_name("sources.json").is_ok());
        assert!(validate_resource_name("map.topojson").is_ok());
        assert!(validate_resource_name("../settings.json").is_err());
        assert!(validate_resource_name("settings.json").is_err());
    }

    #[test]
    fn enumerates_only_direct_pack_directories_with_manifests() {
        let root =
            std::env::temp_dir().join(format!("spatial-memory-content-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("valid-pack")).expect("create valid pack");
        std::fs::write(root.join("valid-pack").join("manifest.json"), "{}")
            .expect("write manifest");
        std::fs::create_dir_all(root.join("without-manifest")).expect("create incomplete pack");
        std::fs::create_dir_all(root.join("valid-pack").join("nested"))
            .expect("create nested directory");
        std::fs::write(
            root.join("valid-pack").join("nested").join("manifest.json"),
            "{}",
        )
        .expect("write nested manifest");

        let result = enumerate_pack_ids(&root).expect("enumerate packs");

        assert_eq!(result, vec!["valid-pack"]);
        std::fs::remove_dir_all(root).expect("remove test directory");
    }
}
