// Event notifications (Admin Console → Notifications): users, servers, safety and console events posted to a channel
// on the instance and/or a webhook, with links into the admin console. Checks the settings API (admins only, checks
// what it is given, never shows a webhook's address), what each event posts and where, links, escaping, dedup,
// failures, the settings page, ?report= deep links and console links in messages opening in place.
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, ok, finish, adminToken, testContainer } from '../lib.mjs'

const admin = await adminToken()
// Links are absolute, on the instance's APP_URL: http(s)://host[:port].
const APP = '(?:https?://[^/)\\s]+)'
const linked = (text, label, path) => new RegExp(`\\[${label}\\]\\(${APP}${path.replace(/[?.]/g, '\\$&')}\\)`).test(text ?? '')
const a = await reg('evt'), b = await reg('evtpal')
const clear = () => call(admin.token, 'PUT', '/admin/event-routes', Object.fromEntries(['users', 'servers', 'safety', 'console'].map((c) => [c, { channel_id: null, webhook_url: '' }])))
process.on('exit', () => { /* routes are cleared below; a crash leaves them pointing at this run's server, which is harmless */ })
await clear()

// A server only the admin reads, with an ops channel and a spare one.
const g = await call(admin.token, 'POST', '/guilds', { name: `Ops ${S}` })
const chans = await call(admin.token, 'GET', `/guilds/${g.id}/channels`)
const ops = chans.find((c) => c.kind === 'text')
const spare = await call(admin.token, 'POST', `/guilds/${g.id}/channels`, { name: `spare-${S}`, kind: 'text' })
const posts = async (cid = ops.id) => (await call(admin.token, 'GET', `/channels/${cid}/messages?limit=50`)) ?? []
const waitFor = async (pred, cid = ops.id) => { for (let i = 0; i < 40; i++) { const m = (await posts(cid)).find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 150)) } return null }

// A webhook receiver the backend container can reach (its network's gateway is this host).
const hits = []
const srv = createServer((req, res) => { let body = ''; req.on('data', (c) => { body += c }); req.on('end', () => { try { hits.push({ path: req.url, body: JSON.parse(body) }) } catch { hits.push({ path: req.url, body }) } res.writeHead(req.url.includes('fail') ? 500 : 204).end() }) })
await new Promise((r) => srv.listen(0, '0.0.0.0', r))
const gw = execFileSync('docker', ['inspect', testContainer('backend'), '--format', '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}'], { encoding: 'utf8' }).trim().split(' ')[0]
const HOOK = `http://${gw}:${srv.address().port}/hook-${S}`
const waitHook = async (pred) => { for (let i = 0; i < 40; i++) { const h = hits.find(pred); if (h) return h; await new Promise((r) => setTimeout(r, 150)) } return null }

console.log('-- settings API')
let r = await callS(a.token, 'GET', '/admin/event-routes'); ok('only admins see the routes', r.status === 403)
r = await callS(a.token, 'PUT', '/admin/event-routes', { users: { channel_id: ops.id } }); ok('only admins change them', r.status === 403)
r = await callS(admin.token, 'PUT', '/admin/event-routes', { weather: { channel_id: ops.id } }); ok('an unknown category is refused', r.status === 400)
r = await callS(admin.token, 'PUT', '/admin/event-routes', { users: { channel_id: '00000000-0000-0000-0000-000000000000' } }); ok('a channel that is not a server text channel is refused', r.status === 400)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
r = await callS(admin.token, 'PUT', '/admin/event-routes', { users: { channel_id: dm.id } }); ok('a DM is refused', r.status === 400)
r = await callS(admin.token, 'PUT', '/admin/event-routes', { users: { webhook_url: 'ftp://x.example/hook' } }); ok('a webhook must be http(s)', r.status === 400)
r = await callS(admin.token, 'PUT', '/admin/event-routes', { users: { channel_id: ops.id }, servers: { channel_id: ops.id }, safety: { channel_id: spare.id, webhook_url: HOOK }, console: { webhook_url: HOOK } })
ok('routes are saved', r.status === 200, JSON.stringify(r.body))
ok('a route names its channel and server', r.body.routes.users.channel?.name === ops.name && r.body.routes.users.channel?.guild_name === `Ops ${S}`)
ok('a webhook shows by host only, never its address', r.body.routes.safety.webhook?.host === gw && !JSON.stringify(r.body).includes(`hook-${S}`))
r = await callS(admin.token, 'PUT', '/admin/event-routes', { users: { webhook_url: '' } })
ok('a category left out or a field left out is unchanged', r.body.routes.safety.channel?.id === spare.id && r.body.routes.users.channel?.id === ops.id)
const found = await call(admin.token, 'GET', `/admin/event-routes/channels?q=${encodeURIComponent(`spare-${S}`)}`)
ok('channel search finds text channels by name, with their server', found.length === 1 && found[0].id === spare.id && found[0].guild_name === `Ops ${S}`)
ok('and by server name', (await call(admin.token, 'GET', `/admin/event-routes/channels?q=${encodeURIComponent(`Ops ${S}`)}`)).some((c) => c.id === ops.id))

console.log('-- users and servers')
const fresh = await reg('evtnew')
let m = await waitFor((x) => x.content.includes(`New account: **evtnew${S}**`))
ok('a sign-up is posted by the Parley account', !!m && m.author?.username?.startsWith('parley'), JSON.stringify(m?.author))
ok('with a link to the user in the console', linked(m?.content, 'User', `/admin/users/${fresh.user.id}`), m?.content)
ok('under its category', m?.content.startsWith('**Users** · '))
const made = await call(a.token, 'POST', '/guilds', { name: `**loud** @everyone ${S}` })
m = await waitFor((x) => x.content.includes('created the server'))
ok('a new server is posted with links to it and its owner', m?.content.includes(`/admin/servers/${made.id}`) && m.content.includes(`/admin/users/${a.user.id}`), m?.content)
ok('names cannot format or ping', m?.content.includes('\\*\\*loud\\*\\* @​everyone') && !m.mention_everyone, m?.content)

console.log('-- safety: channel and webhook')
const rep = await call(b.token, 'POST', '/reports', { kind: 'user', user_id: a.user.id, reason: `secret reason ${S}` })
m = await waitFor((x) => x.content.includes('report'), spare.id)
ok('a new report goes to the safety channel', !!m && m.content.includes(`/admin/reports?report=${rep.id}`) && m.content.includes(`/admin/users/${a.user.id}`), m?.content)
ok('without the report\'s reason', !m?.content.includes('secret reason'))
ok('and not to the other categories\' channel', !(await posts()).some((x) => x.content.includes(`report=${rep.id}`)))
let h = await waitHook((x) => x.body?.event?.kind === 'report.create')
ok('the webhook gets JSON with the event', h?.body?.event?.category === 'safety' && h.body.event.links.some((l) => /^https?:\/\/[^/]+\/admin\/reports\?report=/.test(l.url) && l.url.endsWith(rep.id)), JSON.stringify(h?.body))
ok('with Discord and Slack style text too', typeof h?.body?.content === 'string' && h.body.text.startsWith('*Safety*') && !JSON.stringify(h.body).includes('secret reason'))

console.log('-- console activity')
const sus = await callS(admin.token, 'PATCH', `/admin/users/${fresh.user.id}`, { suspended: true })
m = await waitFor((x) => x.content.includes('suspended') && x.content.includes(`evtnew${S}`))
ok('an admin action on a user is posted to Users', !!m && m.content.includes(`/admin/users/${fresh.user.id}`) && m.content.includes('/admin/audit'), `${sus.status} ${m?.content}`)
h = await waitHook((x) => x.body?.event?.kind === 'user.suspend')
ok('and to Console activity\'s webhook', !!h && h.body.event.summary.includes('suspended'))
await callS(admin.token, 'PUT', '/admin/event-routes', { console: { channel_id: ops.id } })
const before = (await posts()).length
await callS(admin.token, 'PATCH', `/admin/users/${fresh.user.id}`, { suspended: false })
await waitFor((x) => x.content.includes('lifted the suspension'))
await new Promise((res) => setTimeout(res, 800))
ok('two categories on one channel post once', (await posts()).filter((x) => x.content.includes('lifted the suspension')).length === 1, String((await posts()).length - before))
const audit = await call(admin.token, 'GET', '/admin/audit?limit=5').catch(() => null)
ok('changing the routes is itself audited', JSON.stringify(audit ?? '').includes('notifications.update') || (await waitFor((x) => x.content.includes('changed where notifications go'))) !== null)

console.log('-- tests and failures')
r = await callS(admin.token, 'POST', '/admin/event-routes/users/test')
ok('a test posts to the channel', r.status === 200 && r.body.channel?.ok === true && r.body.webhook === null, JSON.stringify(r.body))
ok('and it shows up', !!(await waitFor((x) => x.content.includes('Users events will show up here'))))
r = await callS(admin.token, 'POST', '/admin/event-routes/weather/test'); ok('a test for no category is 404', r.status === 404)
await callS(admin.token, 'PUT', '/admin/event-routes', { servers: { channel_id: null, webhook_url: `http://${gw}:${srv.address().port}/fail-${S}` } })
r = await callS(admin.token, 'POST', '/admin/event-routes/servers/test')
ok('a failing webhook is reported', r.body.webhook?.ok === false && r.body.webhook.error.includes('500'), JSON.stringify(r.body))
ok('and kept for the settings page', (await call(admin.token, 'GET', '/admin/event-routes')).routes.servers.last_error?.message.includes('500'))
await callS(admin.token, 'PUT', '/admin/event-routes', { servers: { webhook_url: '' } })
ok('emptying a category removes it', (await call(admin.token, 'GET', '/admin/event-routes')).routes.servers.webhook === null)

console.log('-- the console')
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), admin.token)
await p.goto(`${WEB}/admin/notifications`); await p.waitForSelector('[data-notify-category="console"]')
ok('a card per category', await p.locator('[data-notify-category]').count() === 4)
ok('the chosen channel shows with its server', (await p.textContent(`[data-notify-category="users"] [data-notify-channel="${ops.id}"]`)).includes(`Ops ${S}`))
ok('the webhook shows by host', await p.locator(`[data-notify-category="safety"] [data-notify-webhook="${gw}"]`).count() === 1)
await p.fill('[data-notify-category="servers"] [data-notify-channel-search]', `spare-${S}`)
await p.click(`[data-notify-category="servers"] [data-notify-channel-option="${spare.id}"]`)
await p.waitForSelector(`[data-notify-category="servers"] [data-notify-channel="${spare.id}"]`)
ok('picking a channel saves it', (await call(admin.token, 'GET', '/admin/event-routes')).routes.servers.channel?.id === spare.id)
await p.click('[data-notify-test="servers"]')
ok('Send a test posts', !!(await waitFor((x) => x.content.includes('Servers events will show up here'), spare.id)))
await p.click('[data-notify-category="safety"] [data-notify-webhook-remove]')
await p.waitForSelector('[data-notify-webhook-input="safety"]')
ok('removing the webhook clears it', (await call(admin.token, 'GET', '/admin/event-routes')).routes.safety.webhook === null)
await p.screenshot({ path: 'eventnotify-settings.png' })

await p.goto(`${WEB}/admin/reports?report=${rep.id}`)
await p.waitForSelector(`[data-admin-report="${rep.id}"]`)
ok('a report link opens that report, marked', await p.getAttribute(`[data-admin-report="${rep.id}"]`, 'data-report-focused') === '1')

// Console links in messages stay in the app (same origin as the client).
await call(admin.token, 'POST', `/channels/${ops.id}/messages`, { content: `see [User](${WEB}/admin/users/${a.user.id}) and [Elsewhere](https://example.org/x)` })
await p.goto(`${WEB}/channels/${g.id}/${ops.id}`)
const inApp = p.locator('a[data-in-app]', { hasText: 'User' }).last()
await inApp.waitFor()
ok('other links still open a new tab', await p.locator('a', { hasText: 'Elsewhere' }).last().getAttribute('target') === '_blank')
await inApp.click()
await p.waitForURL(`**/admin/users/${a.user.id}`, { timeout: 5000 }).catch(() => {})
ok('a console link opens in place', p.url().endsWith(`/admin/users/${a.user.id}`) && (await browser.contexts()[0].pages()).length === 1, p.url())

await browser.close()
await clear()
srv.close()
ok('no page errors', errors.length === 0, errors.join(' | '))
await finish()
