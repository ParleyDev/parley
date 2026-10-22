// Connections: link GitHub / Twitch via OAuth (stub provider), show on profile, hide, remove; admin keys.
import { chromium } from 'playwright'
import http from 'node:http'
import { B, WEB, S, reg, call, raw, ok, finish, adminToken } from '../lib.mjs'
const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
const admin = await adminToken(); const a = await reg('alice'); const b = await reg('bob')
// A stub for both providers: authorize bounces straight back with a code, token/profile answer canned JSON.
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const path = u.pathname
  if (path === '/login/oauth/authorize' || path === '/oauth2/authorize') { res.writeHead(302, { Location: `${u.searchParams.get('redirect_uri')}?code=c0de&state=${encodeURIComponent(u.searchParams.get('state'))}` }); res.end(); return }
  if (path === '/login/oauth/access_token' || path === '/oauth2/token') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ access_token: 'tok' })); return }
  if (path === '/user') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 4242, login: `octo${S}`, html_url: `https://github.com/octo${S}` })); return }
  if (path === '/helix/users') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: '77', login: `streamer${S}`, display_name: `Streamer ${S}` }] })); return }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(0, '0.0.0.0', r)); const PORT = server.address().port
const settings = await call(admin.token, 'GET', '/admin/settings')

console.log('-- admin keys')
await raw(admin.token, 'PUT', '/admin/settings', { ...settings, oauth_providers: {}, oauth_endpoint_override: '' }) // a previous run may have left keys behind
let r = await raw(a.token, 'GET', '/connections/github/start'); ok('without provider keys, start is refused with a hint', r.status === 400 && /not set up/.test((await r.json()).error))
r = await raw(admin.token, 'PUT', '/admin/settings', { ...settings, oauth_providers: { github: { client_id: 'gid', client_secret: 'gsec' }, twitch: { client_id: 'tid', client_secret: 'tsec' } }, oauth_endpoint_override: `http://${HOST}:${PORT}` })
ok('admin saves provider keys; the public instance lists the providers but not the secrets', r.status === 200 && (await (await raw(a.token, 'GET', '/instance')).json()).oauth_available.join(',') === 'github,twitch' && (await (await raw(a.token, 'GET', '/instance')).json()).oauth_providers == null)

console.log('-- link flow')
const start = await call(a.token, 'GET', '/connections/github/start')
ok('start returns the provider authorize URL with our callback and a state', /\/login\/oauth\/authorize\?/.test(start.url) && /redirect_uri=/.test(start.url) && /state=/.test(start.url))
let hop = await fetch(start.url, { redirect: 'manual' }); const back = hop.headers.get('location')
ok('the provider sends the browser back to our callback with a code', /\/api\/connections\/github\/callback\?code=/.test(back))
hop = await fetch(back.replace(/^https?:\/\/[^/]+\/api/, B), { redirect: 'manual' })
ok('the callback links the account and lands on the app with ?connected=github', hop.status >= 300 && hop.status < 400 && /connected=github/.test(hop.headers.get('location') ?? ''), hop.headers.get('location'))
let mine = await call(a.token, 'GET', '/users/@me/connections')
ok('the connection is listed with the provider name and URL', mine.length === 1 && mine[0].provider === 'github' && mine[0].name === `octo${S}` && mine[0].url === `https://github.com/octo${S}` && mine[0].visible === true)
const bad = await fetch(back.replace(/^https?:\/\/[^/]+\/api/, B).replace(/state=[^&]+/, 'state=nope'), { redirect: 'manual' })
ok('a forged state is refused (connect_error)', /connect_error=/.test(bad.headers.get('location') ?? ''))
// twitch too
const ts = await call(a.token, 'GET', '/connections/twitch/start'); const th = await fetch(ts.url, { redirect: 'manual' }); await fetch(th.headers.get('location').replace(/^https?:\/\/[^/]+\/api/, B), { redirect: 'manual' })
mine = await call(a.token, 'GET', '/users/@me/connections'); ok('twitch links with its display name', mine.some((c) => c.provider === 'twitch' && c.name === `Streamer ${S}` && c.url === `https://twitch.tv/streamer${S}`))

console.log('-- visibility')
ok('others see visible connections on the profile', (await call(b.token, 'GET', `/users/${a.user.id}`)).connections.length === 2)
const gh = mine.find((c) => c.provider === 'github')
await call(a.token, 'PATCH', `/users/@me/connections/${gh.id}`, { visible: false })
ok('hidden ones disappear for others but stay for you', (await call(b.token, 'GET', `/users/${a.user.id}`)).connections.length === 1 && (await call(a.token, 'GET', `/users/${a.user.id}`)).connections.length === 2)
ok('someone else cannot change or delete your connection', (await raw(b.token, 'PATCH', `/users/@me/connections/${gh.id}`, { visible: true })).status === 404 && (await raw(b.token, 'DELETE', `/users/@me/connections/${gh.id}`)).status === 404)

console.log('-- UI')
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/@me?connected=github`); await p.waitForSelector('text=account linked')
ok('landing with ?connected shows a toast and cleans the URL', !/connected=/.test(p.url()))
await p.click('button[title="User Settings"]'); await p.click('text=Connections'); await p.waitForSelector('[data-connections-tab]')
// The tab renders before its provider list and connections load.
await p.waitForFunction(() => document.querySelectorAll('[data-connection-row]').length === 2 && !!document.querySelector('[data-connect="twitch"]'), null, { timeout: 10000 }).catch(() => {})
ok('the tab offers Connect buttons for the configured providers and lists both links', await p.locator('[data-connect="github"]').count() === 1 && await p.locator('[data-connect="twitch"]').count() === 1 && await p.locator('[data-connection-row]').count() === 2)
await p.locator('[data-connection-row="github"] [data-connection-visible] [role=switch]').click(); await p.waitForSelector('[data-connection-row="github"] [data-connection-visible="1"]')
ok('the visibility switch saves', (await call(b.token, 'GET', `/users/${a.user.id}`)).connections.length === 2)
await p.screenshot({ path: '172-connections.png' })
await p.keyboard.press('Escape')
const pb = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); await pb.goto(`${WEB}/login`); await pb.evaluate((t) => localStorage.setItem('parley.token', t), b.token)
const dm = await call(b.token, 'POST', '/users/@me/channels', { recipient_id: a.user.id }); await pb.goto(`${WEB}/channels/@me/${dm.id}`); await pb.waitForSelector('[data-profile-connections]')
ok('the profile panel shows the connections as chips', await pb.locator('[data-profile-connections] [data-connection="github"]').count() === 1 && await pb.locator('[data-profile-connections] [data-connection="twitch"]').count() === 1)
await p.click('button[title="User Settings"]'); await p.click('text=Connections'); await p.waitForSelector('[data-connections-tab]')
await p.locator('[data-connection-row="twitch"] [data-connection-remove]').click(); await p.waitForFunction(() => document.querySelectorAll('[data-connection-row]').length === 1)
ok('remove drops it', (await call(a.token, 'GET', '/users/@me/connections')).length === 1)
await raw(admin.token, 'PUT', '/admin/settings', { ...settings, oauth_providers: {}, oauth_endpoint_override: '' })
ok('no page errors', errors.length === 0, errors.join('\n'))
server.close(); await browser.close(); await finish()
