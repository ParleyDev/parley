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
