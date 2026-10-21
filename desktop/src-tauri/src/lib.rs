//! Parley desktop shell: a native window that opens the bundled connect screen, then navigates to the chosen
//! server so the full web client runs inside it. The user agent carries a `ParleyDesktop/<version>` marker,
//! which the web client uses to report the "desktop" presence platform. A page may ask to go back to the
//! connect screen by navigating to `/?parley-switch=1` (User Settings → Switch server).

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn user_agent() -> String {
    let os = if cfg!(target_os = "windows") { "Windows NT 10.0; Win64; x64" } else if cfg!(target_os = "macos") { "Macintosh; Intel Mac OS X 10_15_7" } else { "X11; Linux x86_64" };
    format!("Mozilla/5.0 ({os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ParleyDesktop/{VERSION}")
}

/// The bundled connect screen's URL for this platform's custom scheme.
fn connect_url() -> url::Url {
    let base = if cfg!(target_os = "windows") { "http://tauri.localhost/index.html#switch" } else { "tauri://localhost/index.html#switch" };
    url::Url::parse(base).expect("static url")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch focuses the existing window instead of opening another.
            if let Some(w) = app.get_webview_window("main") { let _ = w.set_focus(); }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Parley")
                .inner_size(1280.0, 820.0)
                .min_inner_size(720.0, 480.0)
                .user_agent(&user_agent())
                .on_navigation(move |url| {
                    // The web client asks to open a link outside the app with ?parley-open=<url>: hand it to the OS
                    // (browser / mail client) and stay where we are. Only web and mail schemes are allowed through.
                    if let Some((_, target)) = url.query_pairs().find(|(k, _)| k == "parley-open") {
                        if let Ok(t) = url::Url::parse(&target) {
                            if matches!(t.scheme(), "http" | "https" | "mailto") {
                                let _ = handle.opener().open_url(t.as_str(), None::<&str>);
                            }
                        }
                        return false;
                    }
                    // The web client asks for the connect screen with ?parley-switch=1: cancel that navigation and
                    // load the bundled page instead.
                    if url.query_pairs().any(|(k, v)| k == "parley-switch" && v == "1") {
                        let h = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Some(w) = h.get_webview_window("main") { let _ = w.navigate(connect_url()); }
                        });
                        return false;
                    }
                    true
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Parley");
}
