import { chromium } from 'playwright'
import { B, WEB, S, reg, call, raw, loginRaw, ok, finish, adminToken } from '../lib.mjs'

const admin = await adminToken()
const a = await reg('alice')
const email = `alice${S}@x.io`
const mailFor = async (to) => call(admin.token, 'GET', `/admin/mail?to=${encodeURIComponent(to)}`)
const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
const tokenFrom = (m) => /reset\?token=([0-9a-f]{64})/.exec(m?.body ?? '')?.[1]

console.log('-- API')
let r = await post('/auth/forgot', { email: `nobody${S}@x.io` }); ok('unknown address still answers ok (no enumeration)', r.status === 200 && (await mailFor(`nobody${S}@x.io`)).length === 0)
r = await post('/auth/forgot', { email: email.toUpperCase() }); ok('known address (any case) gets a reset mail', r.status === 200 && (await mailFor(email)).some((m) => /Reset/.test(m.subject)))
const tok = tokenFrom((await mailFor(email)).find((m) => /Reset/.test(m.subject)))
ok('the mail carries a one-hour reset link', !!tok)
r = await post('/auth/reset', { token: tok, password: 'short' }); ok('short password refused and the token survives', r.status === 400)
r = await post('/auth/reset', { token: 'deadbeef', password: 'newpassword1' }); ok('bad token refused', r.status === 400)
r = await post('/auth/reset', { token: tok, password: 'newpassword1' }); ok('reset succeeds', r.status === 200)
r = await post('/auth/reset', { token: tok, password: 'another123' }); ok('token is single-use', r.status === 400)
r = await loginRaw(`alice${S}`); ok('old password no longer works', r.status === 400)
r = await post('/auth/login', { login: `alice${S}`, password: 'newpassword1' }); ok('new password logs in', r.status === 200)
ok('proving the address via reset also verifies it', (await call(a.token, 'GET', '/users/@me')).email_verified_at !== null)

console.log('-- UI')
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.waitForTimeout(600)
ok('login page offers Forgot your password?', await p.locator('[data-forgot-link]').count() === 1)
await p.click('[data-forgot-link]'); await p.waitForTimeout(400); await p.fill('[data-forgot-email]', email); await p.click('[data-forgot-form] button[type=submit], [data-forgot-form] button'); await p.waitForTimeout(800)
ok('forgot form confirms without revealing anything', await p.locator('[data-forgot-sent]').count() === 1)
const tok2 = tokenFrom((await mailFor(email)).find((m) => /Reset/.test(m.subject)))
await p.goto(`${WEB}/reset?token=${tok2}`); await p.waitForTimeout(500)
await p.fill('[data-reset-password]', 'finalpass123'); await p.fill('[data-reset-confirm]', 'different1'); await p.click('[data-reset-form] button'); await p.waitForTimeout(300)
ok('mismatched confirmation is caught client-side', await p.locator('[data-reset-error]:has-text("do not match")').count() === 1)
await p.fill('[data-reset-confirm]', 'finalpass123'); await p.click('[data-reset-form] button'); await p.waitForTimeout(800)
ok('reset page confirms and links to log in', await p.locator('[data-reset-done]').count() === 1)
await p.screenshot({ path: '90-reset-done.png' })
r = await post('/auth/login', { login: `alice${S}`, password: 'finalpass123' }); ok('the password chosen in the UI works', r.status === 200)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
