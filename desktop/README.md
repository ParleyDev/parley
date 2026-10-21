# Parley for Windows, macOS and Linux

A native desktop app built with [Tauri 2](https://tauri.app): a small window that opens a **connect screen** (`www/index.html`), checks the address with `/api/instance`, remembers it, and then navigates to that server so the full Parley web client runs inside the app. Nothing about a server is baked in; one build works for every instance. Addresses typed without a scheme try https first and fall back to plain http.

What the shell adds over the browser:

- A proper window with the Parley name and icon, single-instance (a second launch focuses the first).
- The **desktop** presence indicator: the window's user agent carries `ParleyDesktop/<version>`, which the web client reports when it connects.
- User Settings → **Switch server** brings the connect screen back (the client navigates to `/?parley-switch=1`, the shell intercepts it).
- External links: the web client never opens them silently. A "Leaving Parley" dialog shows the real destination (host and full URL, with a warning when the link text names a different site, and the ASCII form of internationalised domains); the shell then opens it in the default browser via `/?parley-open=<url>`.
- System notifications (Tauri plugin; the web client already uses the Notification API).

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
