// Sign-up protection (Instance Settings → Sign-up protection): disposable email services and the admin's own domains
// are refused at sign-up and email change, domains that can't receive mail are refused, a CAPTCHA (stubbed provider)
// gates sign-up, unverified accounts are read-only, and accounts that never verify are removed after N days.
import http from 'node:http'
import { execSync } from 'node:child_process'
import { chromium } from 'playwright'
import { WEB, B, H, S, PASSWORD, reg, call, callS, raw, ok, finish, adminToken, openDms, testContainer } from '../lib.mjs'

const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
const sql = (q) => execSync(`docker exec ${testContainer('db')} psql -U parley -tAc "${q.replace(/"/g, '\\"')}"`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
const checks = []
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c }); req.on('end', () => {
    const f = Object.fromEntries(new URLSearchParams(body)); checks.push(f)
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: f.response === 'good-token' && f.secret === 'sekret' }))
  })
})
await new Promise((r) => server.listen(0, '0.0.0.0', r)); const PORT = server.address().port

const admin = await adminToken()
let settings = (await callS(admin.token, 'GET', '/admin/settings')).body
const put = async (patch) => { const r = await callS(admin.token, 'PUT', '/admin/settings', { ...settings, ...patch }); if (r.status === 200) settings = r.body; return r }
const signup = (email, extra = {}) => raw(null, 'POST', '/auth/register', { username: `sg${Math.floor(Math.random() * 1e9)}`, email, password: PASSWORD, ...extra })

console.log('-- disposable and blocked domains')
let r = await signup(`a${S}@mailinator.com`); ok('off by default: a throwaway address is accepted', r.status === 200)
r = await put({ block_disposable_emails: true, blocked_email_domains: `@blocked-${S}.test, *.also-${S}.test\nnot-a-domain` })
ok('saved, with the extra domains tidied', r.status === 200 && r.body.blocked_email_domains === `blocked-${S}.test\nalso-${S}.test`, JSON.stringify(r.body.blocked_email_domains))
r = await signup(`b${S}@mailinator.com`); const j = await r.json()
ok('a disposable service is refused with a clear message', r.status === 400 && /Disposable email/.test(j.error), JSON.stringify(j))
ok('subdomains of one too', (await signup(`c${S}@mx.guerrillamail.com`)).status === 400)
ok("the admin's own domains (and their subdomains) too", (await signup(`d${S}@blocked-${S}.test`)).status === 400 && (await signup(`e${S}@x.also-${S}.test`)).status === 400)
ok('ordinary addresses still sign up', (await signup(`f${S}@x.io`)).status === 200)
const u = await reg('guard')
r = await raw(u.token, 'POST', '/users/@me/email', { email: `g${S}@yopmail.com`, password: PASSWORD })
ok('changing your email to one is refused too', r.status === 400 && /Disposable/.test((await r.json()).error))
ok('the domain list stays out of the public settings', (await (await fetch(`${B}/instance`)).json()).blocked_email_domains === '')
await put({ block_disposable_emails: false, blocked_email_domains: '' })

console.log('-- domains that take no mail')
await put({ check_email_domain: true })
r = await signup(`h${S}@nowhere-${S}.invalid`)
ok('a domain that does not exist is refused', r.status === 400 && /can't receive mail/.test((await r.json()).error))
ok('a real mail domain is accepted', (await signup(`h${S}@gmail.com`)).status === 200)
await put({ check_email_domain: false })

console.log('-- CAPTCHA')
r = await put({ captcha_provider: 'turnstile', captcha_site_key: 'site-key', captcha_secret: '' })
ok('a CAPTCHA needs its secret', r.status === 400)
r = await put({ captcha_provider: 'turnstile', captcha_site_key: 'site-key', captcha_secret: 'sekret', captcha_verify_url: `http://${HOST}:${PORT}/siteverify` })
ok('turned on', r.status === 200)
const pub = await (await fetch(`${B}/instance`)).json()
ok('the sign-up page learns the provider and site key, never the secret', pub.captcha_provider === 'turnstile' && pub.captcha_site_key === 'site-key' && pub.captcha_secret === '' && pub.captcha_verify_url === '')
r = await signup(`i${S}@x.io`); ok('no token: refused', r.status === 400 && /complete the CAPTCHA/.test((await r.json()).error))
r = await signup(`i${S}@x.io`, { captcha_token: 'bad-token' }); ok('a failed check: refused', r.status === 400 && /CAPTCHA check failed/.test((await r.json()).error))
r = await signup(`i${S}@x.io`, { captcha_token: 'good-token' }); ok('a solved one: signed up', r.status === 200)
ok('the provider was asked with the secret, site key and token', checks.some((c) => c.secret === 'sekret' && c.sitekey === 'site-key' && c.response === 'good-token'))

const browser = await chromium.launch(); const errors = []
{
  const p = await browser.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  // The provider's script, faked: a widget that solves itself.
  await p.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: "window.turnstile = { render(el, o) { el.innerHTML = '<div data-fake-turnstile>ok</div>'; setTimeout(() => o.callback('good-token'), 300); return 1 }, reset() {}, remove() {} }" }))
  await p.goto(`${WEB}/register`); await p.waitForSelector('[data-captcha="turnstile"]')
  await p.fill('input[type=email]', `j${S}@x.io`); await p.fill("input[autocomplete=username]", `sgj${S}`); await p.fill('input[type=password]', PASSWORD)
  ok('the register page shows the CAPTCHA and waits for it', await p.locator('[data-captcha] [data-fake-turnstile]').count() === 1)
  await p.waitForFunction(() => !document.querySelector('form button.btn-primary').disabled, null, { timeout: 5000 }).catch(() => {})
  await p.click('form button.btn-primary'); await p.waitForURL(/\/channels/, { timeout: 8000 }).catch(() => {})
  ok('solved, the sign-up goes through', /\/channels/.test(p.url()), p.url())
  await p.close()
}
await put({ captcha_provider: '', captcha_site_key: '', captcha_secret: '', captcha_verify_url: '' })

console.log('-- unverified accounts are read-only')
const v = await reg('verified'), n = await reg('unverified')
sql(`UPDATE users SET email_verified_at = now() WHERE id = '${v.user.id}'`)
await openDms(v, n)
const g = await call(v.token, 'POST', '/guilds', { name: `Guard ${S}` }); const tc = g.channels.find((c) => c.kind === 'text')
const inv = await call(v.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(n.token, 'POST', `/invites/${inv.code}`)
const hello = await call(v.token, 'POST', `/channels/${tc.id}/messages`, { content: 'hello' })
ok('off by default: an unverified account can post', (await raw(n.token, 'POST', `/channels/${tc.id}/messages`, { content: 'before' })).status === 201)
await put({ unverified_read_only: true })
r = await raw(n.token, 'POST', `/channels/${tc.id}/messages`, { content: 'blocked' }); const rj = await r.json()
ok('on: posting is refused with code email_unverified', r.status === 403 && rj.code === 'email_unverified', JSON.stringify(rj))
const blocked = { react: (await raw(n.token, 'PUT', `/channels/${tc.id}/messages/${hello.id}/reactions/${encodeURIComponent('👍')}`)).status, dm: (await raw(n.token, 'POST', '/users/@me/channels', { recipient_id: v.user.id })).status, friend: (await raw(n.token, 'POST', '/users/@me/relationships', { user_id: v.user.id })).status }
ok('reacting, starting a DM and friend requests too', blocked.react === 403 && blocked.dm === 403 && blocked.friend === 403, JSON.stringify(blocked))
ok('reading still works', (await raw(n.token, 'GET', `/channels/${tc.id}/messages`)).status === 200)
ok('verified accounts post as usual', (await raw(v.token, 'POST', `/channels/${tc.id}/messages`, { content: 'fine' })).status === 201)
{
  const p = await browser.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), n.token)
  await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('[data-verification-gate]')
  ok('the message box explains it instead of failing', /Verify your email address to post/.test(await p.textContent('[data-verification-gate]')))
  await p.close()
}
await put({ unverified_read_only: false })

console.log('-- accounts that never verify')
const old = await reg('stale'), keep = await reg('kept')
sql(`UPDATE users SET created_at = now() - interval '10 days' WHERE id IN ('${old.user.id}', '${keep.user.id}')`)
sql(`UPDATE users SET email_verified_at = now() WHERE id = '${keep.user.id}'`)
r = await put({ unverified_delete_days: 400 }); ok('days are 0 to 365', r.status === 400)
r = await put({ unverified_delete_days: 7 }); ok('set to 7 days', r.status === 200)
let state = ''
for (let i = 0; i < 30 && state !== 'deleted'; i++) { await new Promise((res) => setTimeout(res, 300)); state = sql(`SELECT account_state FROM users WHERE id = '${old.user.id}'`) }
ok('an account unverified for 10 days is removed (anonymized like any deletion)', state === 'deleted' && sql(`SELECT username LIKE 'deleted_%' OR display_name = 'Deleted User' FROM users WHERE id = '${old.user.id}'`) === 't', state)
ok('a verified one of the same age is kept', sql(`SELECT account_state FROM users WHERE id = '${keep.user.id}'`) === 'active')
ok('a new unverified one is kept', sql(`SELECT account_state FROM users WHERE id = '${n.user.id}'`) === 'active')
await put({ unverified_delete_days: 0 })

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); server.close(); await finish()
