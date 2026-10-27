# Parley for Windows, macOS and Linux

A native desktop app built with [Tauri 2](https://tauri.app): a small window that opens a **connect screen** (`www/index.html`) offering the hosted service (app.runparley.com) in one tap or any self-hosted address, checks the address with `/api/instance`, remembers it, and then navigates to that server so the full Parley web client runs inside the app. Only the hosted default is built in; one build works for every instance. Addresses typed without a scheme try https first and fall back to plain http.

What the shell adds over the browser:

- A proper window with the Parley name and icon, single-instance (a second launch focuses the first).
- The **desktop** presence indicator: the window's user agent carries `ParleyDesktop/<version>`, which the web client reports when it connects.
- User Settings → **Switch server** brings the connect screen back (the client navigates to `/?parley-switch=1`, the shell intercepts it).
- External links: the web client never opens them silently. A "Leaving Parley" dialog shows the real destination (host and full URL, with a warning when the link text names a different site, and the ASCII form of internationalised domains); the shell then opens it in the default browser via `/?parley-open=<url>`. New-tab links are resolved by the page (WebKitGTK drops `target="_blank"`), and any `window.open` the page still makes is caught by the shell and routed through the same dialog, or a native confirm showing the URL when the loaded web client predates it. Shells older than 0.2.0 cannot open links at all: reinstall.
- Stale web clients: a window left open across a server update shows a "new version available" bar with a Reload button.
- System notifications (Tauri plugin; the web client already uses the Notification API).
- Unread mentions on the dock / taskbar icon (a count on macOS and Linux, a red dot overlay on Windows), and a taskbar flash / dock bounce when a notifying message arrives in the background.
- `parley://invite/<code>`, `parley://channels/<server>/<channel>` and `parley://template/<code>` links open in the app, on the server it is connected to (or once it connects). Invite pages in the browser offer "Open in the desktop app".
- Settings → Advanced: open Parley when you sign in (optionally minimised) and hardware acceleration (off = software rendering from the next launch).
- Native zoom with Ctrl/⌘ + = / - / 0 (Appearance → Zoom level too); the window's size and position are remembered.

The connected server's page can call only the shell's own commands (`capabilities/remote.json`: badge, flash, zoom, startup settings); no plugin or core API is exposed to it. Debug builds start straight on a server with `PARLEY_DESKTOP_URL=https://…`.

## Tests

`tests/shell.mjs` runs a debug build against a local page and checks the commands, the remote capability's limits, autostart, settings on disk and parley:// hand-off between launches (Linux):

```bash
(cd src-tauri && cargo build) && dbus-run-session -- xvfb-run -a node tests/shell.mjs
```

## Build

Prerequisites: Node 22, Rust stable, and on Linux the WebKitGTK dev packages:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev   # Debian/Ubuntu
```

```bash
cd desktop
npm ci
npx tauri icon assets/icon.png      # generates src-tauri/icons/ from the 1024×1024 source (do this once)
npm run dev                         # a dev window
npm run build                       # installers under src-tauri/target/release/bundle/
```

Outputs: `.msi` and `.exe` (Windows), `.dmg` (macOS), `.AppImage` and `.deb` (Linux). `.github/workflows/desktop.yml` builds all three on every change under `desktop/` and uploads them as artifacts. Code signing / notarisation need your certificates (see the Tauri docs for `TAURI_SIGNING_PRIVATE_KEY`, Apple notarisation and Windows signing).

Replace `assets/icon.png` with your own 1024×1024 icon before shipping.
