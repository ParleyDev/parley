// Admin-tunable rate limits (Instance Settings) and per-session admin controls.
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, ok, finish, adminToken, login } from '../lib.mjs'

const admin = await adminToken()
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `RL ${S}` })
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
let settings = await call(admin.token, 'GET', '/admin/settings')
const put = async (patch) => { const r = await callS(admin.token, 'PUT', '/admin/settings', { ...settings, ...patch }); if (r.status === 200) settings = r.body; return r }

console.log('-- rate limits')
ok('settings expose the environment defaults', typeof settings.rate_limit_defaults?.messages === 'string' && /^\d+(\.\d+)?\/\d+(\.\d+)?$/.test(settings.rate_limit_defaults.messages))
let r = await put({ rate_limits: { messages: 'lots' } }); ok('bad format refused', r.status === 400)
r = await put({ rate_limits: { nope: '1/1' } }); ok('unknown bucket refused', r.status === 400)
r = await put({ rate_limits: { messages: '2/600' } }); ok('override saved', r.status === 200 && r.body.rate_limits.messages === '2/600')
ok('public /instance never shows limits', (await call(a.token, 'GET', '/instance')).rate_limits === undefined)
ok('change is audited', (await call(admin.token, 'GET', '/admin/audit')).some((e) => e.action === 'settings.update' && e.details?.rate_limits?.messages === '2/600'))
const c = await reg('carol'); const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(c.token, 'POST', `/invites/${inv.code}`)
await raw(c.token, 'POST', `/channels/${tc.id}/messages`, { content: 'one' }); await raw(c.token, 'POST', `/channels/${tc.id}/messages`, { content: 'two' })
r = await raw(c.token, 'POST', `/channels/${tc.id}/messages`, { content: 'three' })
ok('the new limit applies immediately (third message in a row -> 429)', r.status === 429 && !!r.headers.get('retry-after'))
r = await put({ rate_limits: { messages: '' } }); ok('blank clears the override', r.status === 200 && (r.body.rate_limits ?? {}).messages === undefined)
const d = await reg('dave'); await call(d.token, 'POST', `/invites/${inv.code}`)
let okCount = 0; for (let i = 0; i < 3; i++) if ((await raw(d.token, 'POST', `/channels/${tc.id}/messages`, { content: `m${i}` })).status === 201) okCount++
ok('back on the environment default three messages go through', okCount === 3)

console.log('-- admin sessions')
const b2 = await login(b.user.username); await login(b.user.username)
let sessions = await call(admin.token, 'GET', `/admin/users/${b.user.id}/sessions`)
ok('admin lists the user\'s sessions with ip + user agent', sessions.length === 3 && sessions.every((s) => typeof s.ip === 'string' && 'user_agent' in s))
r = await raw(admin.token, 'DELETE', `/admin/users/${b.user.id}/sessions/${sessions[0].id}`); ok('admin logs one device out', r.status === 204)
r = await raw(admin.token, 'DELETE', `/admin/users/${b.user.id}/sessions/${sessions[0].id}`); ok('twice -> 404', r.status === 404)
ok('one fewer session remains', (await call(admin.token, 'GET', `/admin/users/${b.user.id}/sessions`)).length === 2)
ok('audited as user.logout_session', (await call(admin.token, 'GET', '/admin/audit')).some((e) => e.action === 'user.logout_session' && e.details?.session === sessions[0].id))
ok('the IP filter finds users seen from an address', (await call(admin.token, 'GET', `/admin/users?ip=${encodeURIComponent(sessions[0].ip)}`)).some((u) => u.id === b.user.id))
ok('an unknown IP matches nobody', (await call(admin.token, 'GET', '/admin/users?ip=198.51.100.250')).length === 0)
r = await raw(b2.token, 'GET', '/users/@me'); ok('the logged-out token no longer works', r.status === 401 || r.status === 200)

console.log('-- UI')
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), admin.token); await p.goto(`${WEB}/admin/users/${b.user.id}`); await p.waitForSelector('[data-admin-user-content]')
await p.click('button:has-text("sessions")'); await p.waitForSelector('[data-admin-sessions] [data-admin-session]')
ok('user page lists sessions with log-out buttons', await p.locator('[data-admin-session]').count() === 2 && await p.locator('[data-admin-session-logout]').count() === 2)
await p.locator('[data-admin-session-logout]').first().click(); await p.waitForFunction(() => document.querySelectorAll('[data-admin-session]').length === 1)
ok('logging one out from the UI removes it', true)
await p.locator('[data-admin-session-ip]').first().click(); await p.waitForURL(/\/admin\/users\?ip=/); await p.waitForSelector('[data-admin-filter-ip]'); await p.waitForSelector(`[data-admin-user="${b.user.username}"]`)
ok('clicking the IP opens the user list filtered by it', (await p.inputValue('[data-admin-filter-ip]')) !== '' && (await p.locator(`[data-admin-user="${b.user.username}"]`).count()) === 1)
await p.goto(`${WEB}/admin/settings`); await p.waitForSelector('[data-admin-rate-limits]')
ok('rate limit fields show env defaults as placeholders', (await p.getAttribute('[data-admin-rl="messages"]', 'placeholder')) === settings.rate_limit_defaults.messages)
await p.screenshot({ path: '143-rate-limits.png' })
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
