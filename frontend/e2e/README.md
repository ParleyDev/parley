# End-to-end suites

Playwright scripts that drive the real stack (backend + frontend + Postgres) through the API and the browser.

```bash
# stack up, with the admin the suites use for cleanup and admin checks
ADMIN_EMAILS=admin-e2e@x.io docker compose up -d --build

cd frontend
npm ci && npx playwright install --with-deps chromium
npm run e2e                 # all suites
node e2e/run.mjs groups admin   # a subset
```

Each suite registers its own users (unique per run) and `finish()` deletes them again through the admin API, cascading their servers, messages and uploads. Screenshots go to `e2e/out/`.

Cross-browser: `E2E_BROWSER=webkit` (or `firefox`) switches the engine for suites that use `launchBrowser()` / `phone()` from `lib.mjs`; `npm run e2e:webkit` runs the mobile suites (`mobile`, `mobilepages`, `appearance`) on WebKit, which is what iOS Safari uses (`npx playwright install --with-deps webkit` first). CI runs them after the Chromium pass.

Environment: `PARLEY_API_ORIGIN` (default `http://localhost:18080`), `PARLEY_WEB` (default `http://localhost:3000`), `E2E_ADMIN_EMAIL` (default `admin-e2e@x.io`).

Studio recording: `studiorecord` checks takes on the audio itself (placement against a known loop, a minute of noise stored to the bit, the compressed fallback, a microphone stream) and writes its figures to `e2e/out/studiorecord-measured.json`; `STUDIO_TAKES` (default 20) and `STUDIO_LONG_SECS` (default 60) shorten it. `studiotakes` breaks the way a take reaches the server (pieces refused, held back, sent twice, answers lost, the network gone, the page closed) and checks the stored take sample by sample; with `STUDIO_RESTART_CMD` (for example `docker restart <backend container>`) it also restarts the server during a take. Both need Chromium (a voice room and a microphone).

Studio synchronisation: `studiosync` takes the network away from an open project and checks on the server that every edit made meanwhile arrived, in order (`STUDIO_OFFLINE_SECS`, default 30); it drops and renews the socket, sends edit events out of order, and with `STUDIO_RESTART_CMD` restarts the server under an open project. No microphone; Chromium and WebKit.

Studio rendering and metering: `studiorender` reads the offline render and the exported files back as samples (levels, pan law, placement, fades, buses, stems, 24-bit and dithered 16-bit WAV, a device at 44.1 kHz) and the mixer's meters while a known signal plays. No microphone; Chromium and WebKit. Needs `unzip`.

Studio editing and the engine: `dawedit` edits the timeline by hand in the page (copy, cut and paste, nudging, the selection box, copy and free move by dragging, zoom about the pointer, the loop's edges, markers, track order and height, take lanes) and checks each command on the server, as one change, undone in one step. `dawengine` listens to the engine while it runs: playback through edits, a loop turned to the sample (`DAW_LOOP_SECS`, default 30), the limiter and the gate as exported and as played, and an instrument played from the keyboard. No microphone; Chromium and WebKit.
