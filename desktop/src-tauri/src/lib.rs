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
//!
//! A tray icon (where the desktop has one) reopens the window and quits. Closing the window hides it to the tray
//! unless turned off, and minimising can too; without a tray, closing quits as usual. `streaming_apps` tells the
//! page whether OBS or XSplit is running, for Streamer Mode's automatic switch.
//!
//! Global push-to-talk: while the page is in a call with push to talk on, it names its key (`set_ptt_key`). The
//! shell then reads that key's state (it never grabs the key, so it still types in other apps) and, while the
//! window is in the background, tells the page through `window.__parleyPtt(down)`. In the foreground the page
//! sees the key itself.

use serde::{Deserialize, Serialize};
use device_query::{DeviceQuery, DeviceState, Keycode};
use std::sync::{Arc, Mutex};
use std::time::Duration;
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
    /// None = on: the close button hides the window to the tray (when there is one).
    #[serde(default)] close_to_tray: Option<bool>,
    #[serde(default)] minimize_to_tray: bool,
}

fn prefs_path(app: &AppHandle) -> Option<std::path::PathBuf> { app.path().app_config_dir().ok().map(|d| d.join("desktop.json")) }
fn load_prefs(app: &AppHandle) -> Prefs { prefs_path(app).and_then(|p| std::fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default() }
fn save_prefs(app: &AppHandle, p: &Prefs) -> Result<(), String> {
    let path = prefs_path(app).ok_or("no config directory")?;
    if let Some(d) = path.parent() { std::fs::create_dir_all(d).map_err(|e| e.to_string())?; }
    std::fs::write(path, serde_json::to_vec(p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct DesktopSettings { autostart: bool, start_minimized: bool, hardware_acceleration: bool, close_to_tray: bool, minimize_to_tray: bool, tray: bool, version: &'static str }

fn settings(app: &AppHandle) -> DesktopSettings {
    let p = load_prefs(app);
    DesktopSettings {
        autostart: app.autolaunch().is_enabled().unwrap_or(false), start_minimized: p.start_minimized, hardware_acceleration: p.hardware_acceleration.unwrap_or(true),
        close_to_tray: p.close_to_tray.unwrap_or(true), minimize_to_tray: p.minimize_to_tray, tray: has_tray(app), version: VERSION,
    }
}

#[tauri::command]
fn desktop_settings(app: AppHandle) -> DesktopSettings { settings(&app) }

/// Settings → Windows/Desktop: open on login, and start minimised when it does.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn set_desktop_settings(app: AppHandle, autostart: Option<bool>, start_minimized: Option<bool>, hardware_acceleration: Option<bool>, close_to_tray: Option<bool>, minimize_to_tray: Option<bool>) -> Result<DesktopSettings, String> {
    if let Some(on) = autostart {
        let l = app.autolaunch();
        if on { l.enable() } else { l.disable() }.map_err(|e| e.to_string())?;
    }
    if start_minimized.is_some() || hardware_acceleration.is_some() || close_to_tray.is_some() || minimize_to_tray.is_some() {
        let mut p = load_prefs(&app);
        if let Some(m) = start_minimized { p.start_minimized = m; }
        if let Some(h) = hardware_acceleration { p.hardware_acceleration = Some(h); }
        if let Some(c) = close_to_tray { p.close_to_tray = Some(c); }
        if let Some(m) = minimize_to_tray { p.minimize_to_tray = m; }
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

/// The in-game overlay: a small always-on-top window showing who's in your call and who's talking, loaded from the
/// connected server's `/overlay` page. `locked` makes it click-through so games keep the mouse.
#[tauri::command]
fn overlay(app: AppHandle, show: bool, locked: Option<bool>) -> Result<bool, String> {
    if !show {
        if let Some(w) = app.get_webview_window("overlay") { let _ = w.close(); }
        return Ok(false)
    }
    let w = match app.get_webview_window("overlay") {
        Some(w) => w,
        None => {
            let main = app.get_webview_window("main").ok_or("no main window")?;
            let origin = main.url().map_err(|e| e.to_string())?;
            if !matches!(origin.scheme(), "http" | "https") { return Err("Connect to a server first".into()) }
            let url = origin.join("/overlay").map_err(|e| e.to_string())?;
            let b = WebviewWindowBuilder::new(&app, "overlay", WebviewUrl::External(url))
                .title("Parley overlay").inner_size(280.0, 360.0).position(24.0, 24.0)
                .decorations(false).always_on_top(true).skip_taskbar(true).resizable(true).focused(false).shadow(false)
                .user_agent(&user_agent());
            #[cfg(not(target_os = "macos"))]
            let b = b.transparent(true);
            b.build().map_err(|e| e.to_string())?
        }
    };
    if let Some(l) = locked { w.set_ignore_cursor_events(l).map_err(|e| e.to_string())?; }
    let _ = w.show();
    Ok(true)
}

/// Settings → Appearance → App icon: the window, taskbar and tray icon (a PNG the page draws). Empty resets it.
#[tauri::command]
fn set_app_icon(app: AppHandle, window: WebviewWindow, png: Vec<u8>) -> Result<(), String> {
    if png.len() > 512 * 1024 { return Err("icon too large".into()) }
    let icon = if png.is_empty() { app.default_window_icon().cloned().ok_or("no default icon")? } else { tauri::image::Image::from_bytes(&png).map_err(|e| e.to_string())?.to_owned() };
    window.set_icon(icon.clone()).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("main") { let _ = tray.set_icon(Some(icon)); }
    Ok(())
}

#[tauri::command]
fn set_zoom(window: WebviewWindow, factor: f64) -> Result<(), String> {
    if !factor.is_finite() { return Err("bad zoom".into()); }
    window.set_zoom(factor.clamp(0.5, 2.0)).map_err(|e| e.to_string())
}

/// The browser's `KeyboardEvent.code` for a key the shell can watch.
fn keycode(code: &str) -> Option<Keycode> {
    use Keycode::*;
    if let Some(d) = code.strip_prefix("Digit") { return Some([Key0, Key1, Key2, Key3, Key4, Key5, Key6, Key7, Key8, Key9][d.parse::<usize>().ok().filter(|n| *n < 10)?]); }
    if let Some(n) = code.strip_prefix("Numpad").and_then(|d| d.parse::<usize>().ok()) { return [Numpad0, Numpad1, Numpad2, Numpad3, Numpad4, Numpad5, Numpad6, Numpad7, Numpad8, Numpad9].get(n).cloned(); }
    if let Some(n) = code.strip_prefix('F').and_then(|d| d.parse::<usize>().ok()) {
        return [F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12, F13, F14, F15, F16, F17, F18, F19, F20].get(n.checked_sub(1)?).cloned();
    }
    if let Some(l) = code.strip_prefix("Key").filter(|l| l.len() == 1) { return l.parse().ok(); }
    let mac = cfg!(target_os = "macos");
    Some(match code {
        "Backquote" => Grave, "Minus" => Minus, "Equal" => Equal, "BracketLeft" => LeftBracket, "BracketRight" => RightBracket,
        "Backslash" => BackSlash, "Semicolon" => Semicolon, "Quote" => Apostrophe, "Comma" => Comma, "Period" => Dot, "Slash" => Slash,
        "Space" => Space, "Tab" => Tab, "CapsLock" => CapsLock, "Escape" => Escape, "Enter" => Enter, "Backspace" => Backspace,
        "ArrowUp" => Up, "ArrowDown" => Down, "ArrowLeft" => Left, "ArrowRight" => Right,
        "Home" => Home, "End" => End, "PageUp" => PageUp, "PageDown" => PageDown, "Insert" => Insert, "Delete" => Delete,
        "NumpadAdd" => NumpadAdd, "NumpadSubtract" => NumpadSubtract, "NumpadMultiply" => NumpadMultiply, "NumpadDivide" => NumpadDivide,
        "NumpadDecimal" => NumpadDecimal, "NumpadEnter" => NumpadEnter, "NumpadEqual" => NumpadEquals,
        "ShiftLeft" => LShift, "ShiftRight" => RShift, "ControlLeft" => LControl, "ControlRight" => RControl,
        "AltLeft" => if mac { LOption } else { LAlt }, "AltRight" => if mac { ROption } else { RAlt },
        "MetaLeft" => if mac { Command } else { LMeta }, "MetaRight" => if mac { RCommand } else { RMeta },
        _ => return None,
    })
}

/// The push-to-talk key being watched, if any.
#[derive(Default)]
struct Ptt { key: Arc<Mutex<Option<Keycode>>>, started: Mutex<bool> }

/// Watch `code` for push to talk while the window is in the background (None stops). Returns whether the shell
/// can: false for a key it doesn't know, or where key state can't be read (no X display, macOS without Input
/// Monitoring).
#[tauri::command]
fn set_ptt_key(app: AppHandle, code: Option<String>) -> bool {
    let key = match code.as_deref() { Some(c) => match keycode(c) { Some(k) => Some(k), None => return false }, None => None };
    let state = app.state::<Ptt>();
    if let Ok(mut k) = state.key.lock() { *k = key; }
    if key.is_none() { return true; }
    let mut started = match state.started.lock() { Ok(s) => s, Err(_) => return false };
    if !*started {
        // Probe once on this thread so the answer is honest, then poll on a thread of our own.
        if DeviceState::checked_new().is_none() { return false; }
        *started = true;
        let (key, h) = (state.key.clone(), app.clone());
        std::thread::spawn(move || {
            let Some(dev) = DeviceState::checked_new() else { return };
            let mut down = false;
            loop {
                let want = key.lock().ok().and_then(|k| *k);
                let held = want.is_some_and(|k| dev.get_keys().contains(&k));
                let w = h.get_webview_window("main");
                let now = held && !w.as_ref().and_then(|w| w.is_focused().ok()).unwrap_or(true);
                if now != down {
                    down = now;
                    if let Some(w) = w { let _ = w.eval(&format!("window.__parleyPtt && window.__parleyPtt({down})")); }
                }
                std::thread::sleep(Duration::from_millis(if want.is_some() { 15 } else { 200 }));
            }
        });
    }
    true
}

/// Whether a tray icon was created (Linux desktops without a status area have none).
struct Tray(std::sync::atomic::AtomicBool);
fn has_tray(app: &AppHandle) -> bool { app.state::<Tray>().0.load(std::sync::atomic::Ordering::Relaxed) }

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.unminimize(); let _ = w.set_focus(); }
}

/// Linux loads the status-area library at run time and aborts if it is missing: look for it first.
#[cfg(target_os = "linux")]
fn tray_supported() -> bool {
    ["libayatana-appindicator3.so.1", "libappindicator3.so.1", "libayatana-appindicator3.so", "libappindicator3.so"]
        .iter().any(|n| unsafe { libloading::Library::new(n) }.is_ok())
}
#[cfg(not(target_os = "linux"))]
fn tray_supported() -> bool { true }

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    if !tray_supported() { return Err(tauri::Error::AssetNotFound("status-area library (libayatana-appindicator3)".into())) }
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open = MenuItem::with_id(app, "open", "Open Parley", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Parley", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut b = TrayIconBuilder::with_id("main").tooltip("Parley").menu(&menu).show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() { "open" => show_main(app), "quit" => app.exit(0), _ => {} })
        .on_tray_icon_event(|tray, e| { if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e { show_main(tray.app_handle()) } });
    if let Some(icon) = app.default_window_icon() { b = b.icon(icon.clone()); }
    b.build(app)?;
    Ok(())
}

/// Names of programs that mean "streaming right now" (OBS Studio, Streamlabs, XSplit).
fn is_streaming_app(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    let n = n.trim_end_matches(".exe");
    matches!(n, "obs" | "obs64" | "obs32" | "obs-studio" | "obs-browser-page" | "streamlabs obs" | "streamlabs desktop" | "xsplit.core" | "xsplit broadcaster" | "xsplitbroadcaster")
}

/// Is OBS or XSplit running? (Streamer Mode's automatic switch.)
#[tauri::command]
fn streaming_apps() -> bool {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    sys.processes().values().any(|p| is_streaming_app(&p.name().to_string_lossy()))
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
        .manage(Ptt::default())
        .manage(Tray(std::sync::atomic::AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![set_badge, flash, set_zoom, desktop_settings, set_desktop_settings, set_ptt_key, streaming_apps, set_app_icon, overlay])
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
            match build_tray(app.handle()) {
                Ok(()) => app.state::<Tray>().0.store(true, std::sync::atomic::Ordering::Relaxed),
                Err(e) => eprintln!("no tray icon: {e}"),
            }
            if std::env::args().any(|a| a == "--autostart") && load_prefs(app.handle()).start_minimized {
                if has_tray(app.handle()) && load_prefs(app.handle()).minimize_to_tray { let _ = window.hide(); } else { let _ = window.minimize(); }
            }
            // Close (and, when chosen, minimise) to the tray instead of quitting.
            {
                let h = app.handle().clone();
                let w = window.clone();
                window.on_window_event(move |e| match e {
                    tauri::WindowEvent::CloseRequested { api, .. } if has_tray(&h) && load_prefs(&h).close_to_tray.unwrap_or(true) => { api.prevent_close(); let _ = w.hide(); }
                    tauri::WindowEvent::Resized(_) if has_tray(&h) && load_prefs(&h).minimize_to_tray && w.is_minimized().unwrap_or(false) => { let _ = w.hide(); }
                    _ => {}
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Parley");
}

#[cfg(test)]
mod tests {
    use super::{deep_path, is_streaming_app, keycode};
    #[test]
    fn streaming_names() {
        assert!(is_streaming_app("obs64.exe") && is_streaming_app("obs") && is_streaming_app("XSplit.Core.exe") && is_streaming_app("Streamlabs OBS.exe"));
        assert!(!is_streaming_app("observer") && !is_streaming_app("chrome.exe") && !is_streaming_app("jobs"));
    }
    use device_query::Keycode;
    #[test]
    fn keycodes() {
        assert_eq!(keycode("Backquote"), Some(Keycode::Grave));
        assert_eq!(keycode("KeyV"), Some(Keycode::V));
        assert_eq!(keycode("Digit7"), Some(Keycode::Key7));
        assert_eq!(keycode("F13"), Some(Keycode::F13));
        assert_eq!(keycode("F0"), None);
        assert_eq!(keycode("Numpad3"), Some(Keycode::Numpad3));
        assert_eq!(keycode("CapsLock"), Some(Keycode::CapsLock));
        assert_eq!(keycode("MediaPlay"), None);
        assert_eq!(keycode("KeyAB"), None);
    }
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
