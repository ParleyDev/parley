// Shared helpers for the end-to-end suites. Every suite registers its own users (unique per run via
// `S`) and `finish()` deletes them again through the admin API, so repeated runs leave no data behind.
//
// Environment:
//   PARLEY_API_ORIGIN  backend origin        (default http://localhost:18080)
//   PARLEY_WEB         frontend origin       (default http://localhost:3000)
//   E2E_ADMIN_EMAIL    a Parley admin account used for cleanup and admin suites
//                      (default admin-e2e@x.io — the backend must list it in ADMIN_EMAILS)
export const API_ORIGIN = process.env.PARLEY_API_ORIGIN ?? 'http://localhost:18080'
export const B = `${API_ORIGIN}/api`
export const WEB = process.env.PARLEY_WEB ?? 'http://localhost:3000'
export const S = Math.floor(Math.random() * 1e6)
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin-e2e@x.io'
export const PASSWORD = 'password1'
// Per-IP rate limits would couple suites and runs together; the backend trusts X-Forwarded-For
// (nginx sets it in front of the API), so every run presents its own private address.
export const IP = `10.99.${Math.floor(S / 256) % 256}.${S % 256}`
export const H = { 'Content-Type': 'application/json', 'X-Forwarded-For': IP }

export let pass = 0, fail = 0
const created = []
/** Remember a user for cleanup. */
export const track = (u) => { if (u?.id) created.push(u.id); return u }

export const reg = async (u, email) => {
  const mail = email ?? `${u}${S}@x.io`
  const r = await fetch(`${B}/auth/register`, { method: 'POST', headers: H, body: JSON.stringify({ username: u + S, email: mail, password: PASSWORD, display_name: u[0].toUpperCase() + u.slice(1) }) })
  const j = await r.json().catch(() => ({}))
  if (j.user && mail !== ADMIN_EMAIL) track(j.user)
  return j
}
export const loginRaw = (login) => fetch(`${B}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ login, password: PASSWORD }) })
export const login = async (l) => (await loginRaw(l)).json().catch(() => ({}))
/** JSON call; returns the parsed body (null when there is none). */
export const call = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: { ...H, Authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => null) }
/** Raw call; returns the Response so status codes can be asserted. */
export const raw = (t, m, p, b) => fetch(B + p, { method: m, headers: { ...H, Authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined })
/** Multipart upload with extra text fields. */
export const multi = async (t, p, file, fields = {}) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); f.append('file', new Blob([file.buffer], { type: file.mimeType }), file.name); return fetch(B + p, { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'X-Forwarded-For': IP }, body: f }) }

export const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok  ', n) } else { fail++; console.log('  FAIL', n, x) } }

// 2x2 two-frame animated GIF (red then blue) and a 1x1 PNG.
export const GIF = Buffer.from('474946383961020002008000 00 ff0000 0000ff 21ff0b4e45545343415045322e30030100000021f904000a0000002c00000000020002000002030480020021f904000a0000002c0000000002000200000203 4c9202003b'.replace(/\s+/g, ''), 'hex')
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
export const gifFile = { name: 'party_blob.gif', mimeType: 'image/gif', buffer: GIF }
export const pngFile = { name: 'dot.png', mimeType: 'image/png', buffer: PNG }

/** Log in (or register) the admin account and make sure its admin flag is set. */
export const adminToken = async () => {
  let a = await login(ADMIN_EMAIL)
  if (!a.token) a = await reg('admin', ADMIN_EMAIL)
  await call(a.token, 'GET', '/admin/stats')
  return a
}

/** Delete every user this run registered (and, by cascade, their servers, messages and uploads). */
export const cleanup = async () => {
  if (!created.length) return
  try {
    const a = await login(ADMIN_EMAIL)
    if (!a.token) { console.log(`  (cleanup skipped: ${ADMIN_EMAIL} cannot log in; set ADMIN_EMAILS on the backend)`); return }
    let n = 0
    for (const id of created) { const r = await raw(a.token, 'DELETE', `/admin/users/${id}`); if (r.status === 204) n++ }
    console.log(`  (cleanup: removed ${n}/${created.length} test users)`)
  } catch (e) { console.log('  (cleanup failed:', e.message, ')') }
}

/** Print the summary, clean up, and exit non-zero on any failure. Call after closing the browser. */
export const finish = async () => {
  await cleanup()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

// Older suites: register with a lowercase display name and get {status, body} from calls.
export const regLower = async (u) => {
  const r = await fetch(`${B}/auth/register`, { method: 'POST', headers: H, body: JSON.stringify({ username: u + S, email: `${u}${S}@x.io`, password: PASSWORD, display_name: u }) })
  const j = await r.json().catch(() => ({}))
  if (j.user) track(j.user)
  return j
}
export const callS = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: { ...H, Authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt) } catch { /* not json */ } return { status: r.status, body: j } }

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
/** Directory with the committed test files (pic.png, fake.png, notes.txt). */
export const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

// ---- cross-browser: E2E_BROWSER=chromium (default) | webkit | firefox -------------------------------
import { chromium as _chromium, webkit as _webkit, firefox as _firefox, devices as _devices } from 'playwright'
export const BROWSER = process.env.E2E_BROWSER ?? 'chromium'
export const browserType = () => (BROWSER === 'webkit' ? _webkit : BROWSER === 'firefox' ? _firefox : _chromium)
/** Launch the configured engine; Chromium-only flags (fake media devices) are dropped elsewhere. */
export const launchBrowser = (opts = {}) => { const { args, ...rest } = opts; return browserType().launch(BROWSER === 'chromium' ? { args, ...rest } : rest) }
/** A phone context descriptor: real iOS-like WebKit under E2E_BROWSER=webkit, emulated otherwise. */
export const phone = () => ({ ..._devices['iPhone 13'], ...(BROWSER === 'chromium' ? {} : { defaultBrowserType: BROWSER }) })
