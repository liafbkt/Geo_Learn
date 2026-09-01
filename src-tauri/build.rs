fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().plugin(
        "app-update",
        tauri_build::InlinedPlugin::default().commands(&["check"]),
    ))
    .expect("failed to build application capabilities")
}
