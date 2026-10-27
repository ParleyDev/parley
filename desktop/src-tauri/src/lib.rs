//! Parley desktop shell: a native window that opens the bundled connect screen, then navigates to the chosen
//! server so the full web client runs inside it. The user agent carries a `ParleyDesktop/<version>` marker,
//! which the web client uses to report the "desktop" presence platform. A page may ask to go back to the
//! connect screen by navigating to `/?parley-switch=1` (User Settings → Switch server).
//!
//! External links: the web client shows its "Leaving Parley" dialog, then navigates to `/?parley-open=<url>`,
//! which this shell cancels and hands to the OS browser. Anything that still tries to open a new window
//! (a `target="_blank"` link the guard missed, `window.open`, an out-of-date web bundle) is never dropped:
//! the shell asks the page to show the same dialog, or falls back to a native confirm that spells out the URL.
//!
//! The connected server's page may also call a handful of shell commands (capabilities/remote.json): the unread
//! badge, an attention flash, zoom, and the startup settings. `parley://invite/<code>` and
//! `parley://channels/<server>/<channel>` links open in the app, on whichever server it is connected to.
//! Window size and position are remembered between launches.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, UserAttentionType, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn user_agent() -> String {
    let os = if cfg!(target_os = "windows") { "Windows NT 10.0; Win64; x64" } else if cfg!(target_os = "macos") { "Macintosh; Intel Mac OS X 10_15_7" } else { "X11; Linux x86_64" };
    format!("Mozilla/5.0 ({os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ParleyDesktop/{VERSION}")
}

/// The bundled connect screen's URL for this platform's custom scheme.
/// Script run in the page when it asks for a new window: the client's own Leaving Parley dialog if it has one,
/// else a plain confirm showing the real destination, then the usual ?parley-open hand-off.
fn leave_script(target: &str) -> String {
    let u = serde_json::to_string(target).unwrap_or_else(|_| "\"\"".into());
    format!(
        "(u => {{ if (window.__parleyOpenLink) {{ window.__parleyOpenLink(u); return }} \
         if (confirm('Leaving Parley\\n\\nThis link opens in your web browser:\\n\\n' + u + '\\n\\nOnly open links from people you trust.')) \
         location.href = location.origin + '/?parley-open=' + encodeURIComponent(u) }})({u})"
    )
}

fn connect_url() -> url::Url {
    let base = if cfg!(target_os = "windows") { "http://tauri.localhost/index.html#switch" } else { "tauri://localhost/index.html#switch" };
    url::Url::parse(base).expect("static url")
}

/// Shell preferences the web client can't keep itself (it isn't running yet at login).
#[derive(Default, Serialize, Deserialize)]
struct Prefs {
    #[serde(default)] start_minimized: bool,
    /// None = on. Applied at launch (the web view's GPU use can't change while it runs).
    #[serde(default)] hardware_acceleration: Option<bool>,
}

fn prefs_path(app: &AppHandle) -> Option<std::path::PathBuf> { app.path().app_config_dir().ok().map(|d| d.join("desktop.json")) }
fn load_prefs(app: &AppHandle) -> Prefs { prefs_path(app).and_then(|p| std::fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default() }
fn save_prefs(app: &AppHandle, p: &Prefs) -> Result<(), String> {
    let path = prefs_path(app).ok_or("no config directory")?;
    if let Some(d) = path.parent() { std::fs::create_dir_all(d).map_err(|e| e.to_string())?; }
    std::fs::write(path, serde_json::to_vec(p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct DesktopSettings { autostart: bool, start_minimized: bool, hardware_acceleration: bool, version: &'static str }

fn settings(app: &AppHandle) -> DesktopSettings {
    let p = load_prefs(app);
    DesktopSettings { autostart: app.autolaunch().is_enabled().unwrap_or(false), start_minimized: p.start_minimized, hardware_acceleration: p.hardware_acceleration.unwrap_or(true), version: VERSION }
}

#[tauri::command]
fn desktop_settings(app: AppHandle) -> DesktopSettings { settings(&app) }

/// Settings → Windows/Desktop: open on login, and start minimised when it does.
#[tauri::command]
fn set_desktop_settings(app: AppHandle, autostart: Option<bool>, start_minimized: Option<bool>, hardware_acceleration: Option<bool>) -> Result<DesktopSettings, String> {
    if let Some(on) = autostart {
        let l = app.autolaunch();
        if on { l.enable() } else { l.disable() }.map_err(|e| e.to_string())?;
    }
    if start_minimized.is_some() || hardware_acceleration.is_some() {
        let mut p = load_prefs(&app);
        if let Some(m) = start_minimized { p.start_minimized = m; }
        if let Some(h) = hardware_acceleration { p.hardware_acceleration = Some(h); }
        save_prefs(&app, &p)?;
    }
    Ok(settings(&app))
}

/// Unread mentions on the dock / taskbar icon (a red dot overlay on Windows, which has no count badge).
#[tauri::command]
fn set_badge(window: WebviewWindow, count: u32) {
    #[cfg(windows)]
    {
        let icon = if count > 0 { tauri::image::Image::from_bytes(include_bytes!("../../assets/badge.png")).ok() } else { None };
        let _ = window.set_overlay_icon(icon);
    }
    #[cfg(not(windows))]
    let _ = window.set_badge_count(if count > 0 { Some(count as i64) } else { None });
}

/// Flash the taskbar button / bounce the dock icon once, when a notifying message arrives in the background.
#[tauri::command]
fn flash(window: WebviewWindow) {
    if !window.is_focused().unwrap_or(true) { let _ = window.request_user_attention(Some(UserAttentionType::Informational)); }
}

#[tauri::command]
fn set_zoom(window: WebviewWindow, factor: f64) -> Result<(), String> {
    if !factor.is_finite() { return Err("bad zoom".into()); }
    window.set_zoom(factor.clamp(0.5, 2.0)).map_err(|e| e.to_string())
}

/// A deep link waiting for the app to reach a server (it was opened on the connect screen).
struct Pending(Mutex<Option<String>>);

/// `parley://invite/abc` → `/invite/abc`; only a few kinds of page, and only plain path characters.
fn deep_path(u: &url::Url) -> Option<String> {
    if u.scheme() != "parley" { return None; }
    let path = format!("{}{}", u.host_str().unwrap_or(""), u.path());
    let path = path.trim_matches('/');
    let kind = path.split('/').next()?;
    if !["invite", "channels", "template"].contains(&kind) { return None; }
    if path.len() > 200 || !path.chars().all(|c| c.is_ascii_alphanumeric() || "-_/@".contains(c)) || path.contains("//") { return None; }
    Some(format!("/{path}"))
}

fn open_deep(app: &AppHandle, u: &url::Url) {
    let Some(path) = deep_path(u) else { return };
    let Some(w) = app.get_webview_window("main") else { return };
    let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus();
    match w.url() {
        Ok(cur) if matches!(cur.scheme(), "http" | "https") => { if let Ok(next) = cur.join(&path) { let _ = w.navigate(next); } }
        _ => { if let Ok(mut p) = app.state::<Pending>().0.lock() { *p = Some(path); } }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch focuses the existing window instead of opening another (its parley:// link, if
            // any, arrives through the deep-link plugin).
            if let Some(w) = app.get_webview_window("main") { let _ = w.unminimize(); let _ = w.set_focus(); }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Pending(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![set_badge, flash, set_zoom, desktop_settings, set_desktop_settings])
        .setup(|app| {
            let handle = app.handle().clone();
            // AppImages and dev builds aren't registered for parley:// by an installer.
            #[cfg(any(windows, target_os = "linux"))]
            let _ = app.deep_link().register_all();
            if let Ok(Some(urls)) = app.deep_link().get_current() { for u in urls { open_deep(&handle, &u); } }
            { let h = handle.clone(); app.deep_link().on_open_url(move |e| { for u in e.urls() { open_deep(&h, &u); } }); }
            // Debug builds can start straight on a server (PARLEY_DESKTOP_URL), for development and tests.
            let start = if cfg!(debug_assertions) { std::env::var("PARLEY_DESKTOP_URL").ok().and_then(|u| url::Url::parse(&u).ok()).map(WebviewUrl::External) } else { None };
            // Hardware acceleration off (Settings → Advanced): software rendering for this launch.
            let no_gpu = load_prefs(app.handle()).hardware_acceleration == Some(false);
            #[cfg(target_os = "linux")]
            if no_gpu { std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1"); std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1"); }
            let builder = WebviewWindowBuilder::new(app, "main", start.unwrap_or_else(|| WebviewUrl::App("index.html".into())));
            #[cfg(windows)]
            let builder = if no_gpu { builder.additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-gpu") } else { builder };
            #[cfg(not(any(windows, target_os = "linux")))]
            let _ = no_gpu;
            let window = builder
                .title("Parley")
                .inner_size(1280.0, 820.0)
                .min_inner_size(720.0, 480.0)
                .user_agent(&user_agent())
                // Tauri's native file-drop handler swallows HTML drag and drop on Windows (WebView2): reordering
                // channels and servers, and dropping files onto the composer, never reach the page while it is on.
                .disable_drag_drop_handler()
                .on_new_window({
                    let handle = handle.clone();
                    move |url, _features| {
                        if matches!(url.scheme(), "http" | "https" | "mailto") {
                            let h = handle.clone();
                            let js = leave_script(url.as_str());
                            tauri::async_runtime::spawn(async move {
                                if let Some(w) = h.get_webview_window("main") { let _ = w.eval(&js); }
                            });
                        }
                        tauri::webview::NewWindowResponse::Deny
                    }
                })
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
                .on_page_load(|w, payload| {
                    // Reached a server with a deep link waiting: go there.
                    if payload.event() != PageLoadEvent::Finished || !matches!(payload.url().scheme(), "http" | "https") { return; }
                    let pending = w.app_handle().state::<Pending>().0.lock().ok().and_then(|mut p| p.take());
                    if let Some(next) = pending.and_then(|p| payload.url().join(&p).ok()) { let _ = w.navigate(next); }
                })
                .build()?;
            if std::env::args().any(|a| a == "--autostart") && load_prefs(app.handle()).start_minimized { let _ = window.minimize(); }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Parley");
}

#[cfg(test)]
mod tests {
    use super::deep_path;
    fn p(s: &str) -> Option<String> { deep_path(&url::Url::parse(s).unwrap()) }
    #[test]
    fn deep_links() {
        assert_eq!(p("parley://invite/abc123").as_deref(), Some("/invite/abc123"));
        assert_eq!(p("parley://channels/@me/0190-ab").as_deref(), Some("/channels/@me/0190-ab"));
        assert_eq!(p("parley://settings/x"), None);
        assert_eq!(p("parley://invite/a?b=1").as_deref(), Some("/invite/a"));
        assert_eq!(p("parley://invite/..%2F..").as_deref(), None);
        assert_eq!(p("https://invite/abc"), None);
    }
}
