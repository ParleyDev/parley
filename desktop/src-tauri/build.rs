fn main() {
    // The app's own commands, callable from the connected server's web client (capabilities/remote.json).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "set_badge", "flash", "set_zoom", "desktop_settings", "set_desktop_settings", "set_ptt_key", "streaming_apps", "set_app_icon",
    ])))
    .expect("tauri build")
}
