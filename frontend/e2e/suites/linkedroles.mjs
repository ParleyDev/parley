// More connection providers (GitLab, Reddit, Spotify) and linked roles: requirements on a role (a linked account, an
// app-reported value), claimed in Channels & Roles and lost when no longer met.
import { chromium } from 'playwright'
import http from 'node:http'
import { B, WEB, S, reg, call, raw, ok, finish, adminToken } from '../lib.mjs'
const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
const admin = await adminToken(); const owner = await reg('owner'), a = await reg('alice'), dev = await reg('dev')
let redditBasic = false
const json = (res, v) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)) }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname
  if (['/oauth/authorize', '/api/v1/authorize', '/authorize'].includes(p)) { res.writeHead(302, { Location: `${u.searchParams.get('redirect_uri')}?code=c0de&state=${encodeURIComponent(u.searchParams.get('state'))}` }); res.end(); return }
  if (p === '/api/v1/access_token') { redditBasic = (req.headers.authorization ?? '').startsWith('Basic '); return json(res, { access_token: 'tok' }) }
  if (['/oauth/token', '/api/token'].includes(p)) return json(res, { access_token: 'tok' })
  if (p === '/api/v4/user') return json(res, { id: 9, username: `lab${S}`, web_url: `https://gitlab.com/lab${S}` })
  if (p === '/api/v1/me') return json(res, { id: 't2_x', name: `red${S}` })
  if (p === '/v1/me') return json(res, { id: `spot${S}`, display_name: `Spot ${S}`, external_urls: { spotify: 'https://open.spotify.com/user/x' } })
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(0, '0.0.0.0', r)); const PORT = server.address().port
const settings = await call(admin.token, 'GET', '/admin/settings')
await raw(admin.token, 'PUT', '/admin/settings', { ...settings, oauth_providers: { gitlab: { client_id: 'a', client_secret: 'b' }, reddit: { client_id: 'c', client_secret: 'd' }, spotify: { client_id: 'e', client_secret: 'f' } }, oauth_endpoint_override: `http://${HOST}:${PORT}` })
const linkVia = async (tok, name) => {
  const start = await call(tok, 'GET', `/connections/${name}/start`)
  const back = (await fetch(start.url, { redirect: 'manual' })).headers.get('location')
  await fetch(back.replace(/^https?:\/\/[^/]+\/api/, B), { redirect: 'manual' })
}

console.log('-- providers')
for (const n of ['gitlab', 'reddit', 'spotify']) await linkVia(a.token, n)
const conns = await call(a.token, 'GET', '/users/@me/connections')
ok('GitLab, Reddit and Spotify link', ['gitlab', 'reddit', 'spotify'].every((p) => conns.some((c) => c.provider === p)) && conns.find((c) => c.provider === 'reddit').name === `red${S}`)
ok('Reddit gets its client credentials as Basic auth', redditBasic)

console.log('-- app metadata')
const app = await call(dev.token, 'POST', '/applications', { name: `Levels ${S}`, redirect_uris: ['https://levels.example/cb'] })
const bot = await call(dev.token, 'POST', `/applications/${app.id}/bot`, {})
ok('metadata keys are checked', (await raw(dev.token, 'PUT', `/applications/${app.id}/role-connections/metadata`, [{ key: 'Bad Key', type: 2, name: 'x' }])).status === 400)
await call(dev.token, 'PUT', `/applications/${app.id}/role-connections/metadata`, [{ key: 'level', type: 2, name: 'Level' }])
const g = await call(owner.token, 'POST', '/guilds', { name: `Link ${S}` })
const inv = await call(owner.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(a.token, 'POST', `/invites/${inv.code}`)
await raw(owner.token, 'POST', '/oauth2/authorize', { client_id: app.client_id, scope: 'bot', guild_id: g.id })
const role = await call(owner.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Verified Dev' })
ok('roles with moderation powers can\'t be linked roles', await (async () => { const m = await call(owner.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Mod', permissions: 1 << 13 }); return (await raw(owner.token, 'PUT', `/guilds/${g.id}/roles/${m.id}/requirements`, { requirements: { connection: 'gitlab' } })).status === 400 })())
await call(owner.token, 'PUT', `/guilds/${g.id}/roles/${role.id}/requirements`, { requirements: { connection: 'gitlab', app: { app_id: app.id, key: 'level', value: 5 } } })
let lr = (await call(a.token, 'GET', `/guilds/${g.id}/linked-roles`)).find((r) => r.id === role.id)
ok('the role lists what is still missing', lr.missing.length === 1 && lr.missing[0].includes('Level'))
ok('claiming early is refused', (await raw(a.token, 'PUT', `/guilds/${g.id}/me/linked-roles/${role.id}`)).status === 400)
// alice authorises the app to report about her, and it says she's level 7.
const r = await raw(a.token, 'POST', '/oauth2/authorize', { client_id: app.client_id, scope: 'identify role_connections.write', redirect_uri: 'https://levels.example/cb' })
const code = new URL((await r.json()).redirect).searchParams.get('code')
const tok = await (await fetch(`${B}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: app.client_id, client_secret: app.client_secret }) })).json()
const put = await fetch(`${B}/users/@me/applications/${app.id}/role-connection`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok.access_token }, body: JSON.stringify({ platform_name: 'Levels', metadata: { level: 7, junk: 1 } }) })
ok('the app reports the user\'s values (unknown keys dropped)', put.status === 200 && JSON.stringify((await put.json()).metadata) === '{"level":7}')
void bot

console.log('-- claiming')
const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message))
await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), a.token)
await p.goto(`${WEB}/channels/${g.id}`); await p.waitForTimeout(800)
await p.locator(`button:has-text("Link ${S}")`).first().click(); await p.click('text=Channels & Roles'); await p.waitForSelector(`[data-linked-role="${role.id}"]`)
await p.click(`[data-linked-claim="${role.id}"]`); await p.waitForSelector(`[data-linked-role="${role.id}"] [data-linked-have]`)
ok('meeting the requirements lets you claim it', (await call(owner.token, 'GET', `/guilds/${g.id}/members`)).find((m) => m.user_id === a.user.id).roles.includes(role.id))
const gl = (await call(a.token, 'GET', '/users/@me/connections')).find((c) => c.provider === 'gitlab')
await call(a.token, 'DELETE', `/users/@me/connections/${gl.id}`)
ok('removing the linked account takes the role away', !(await call(owner.token, 'GET', `/guilds/${g.id}/members`)).find((m) => m.user_id === a.user.id).roles.includes(role.id))
ok('no page errors', errors.length === 0, errors.join(' | '))
await raw(admin.token, 'PUT', '/admin/settings', settings)
server.close(); await call(owner.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
