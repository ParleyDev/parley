fn main() {
    // The app's own commands, callable from the connected server's web client (capabilities/remote.json).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "set_badge", "flash", "set_zoom", "desktop_settings", "set_desktop_settings", "set_ptt_key", "input_idle", "streaming_apps", "set_app_icon", "overlay", "window_control", "update_status", "check_update", "install_update", "choose_download", "reveal_download",
    ])))
    .expect("tauri build")
}
