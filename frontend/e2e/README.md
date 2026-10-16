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

Environment: `PARLEY_API_ORIGIN` (default `http://localhost:18080`), `PARLEY_WEB` (default `http://localhost:3000`), `E2E_ADMIN_EMAIL` (default `admin-e2e@x.io`).
