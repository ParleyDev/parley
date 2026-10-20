// Push notifications for the native apps: token registration, FCM delivery (stubbed) for DMs and mentions to offline
// users, mute and online suppression, dead-token cleanup.
import http from 'node:http'
import { generateKeyPairSync } from 'node:crypto'
import { B, S, reg, call, callS, raw, ok, finish, adminToken } from '../lib.mjs'

const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
const sent = []; let tokenCalls = 0
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c }); req.on('end', () => {
    if (req.url === '/token') { tokenCalls++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ access_token: 'stub-access', expires_in: 3600 })); return }
    if (req.url.endsWith('/messages:send')) {
      const m = JSON.parse(body).message; sent.push({ auth: req.headers.authorization, ...m })
      if (m.token.includes('dead')) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } })); return }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ name: 'projects/test/messages/1' })); return
    }
    res.writeHead(404); res.end()
  })
})
await new Promise((r) => server.listen(0, '0.0.0.0', r)); const PORT = server.address().port
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const sa = JSON.stringify({ type: 'service_account', project_id: 'test', client_email: `push-${S}@test.iam.gserviceaccount.com`, private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) })

const admin = await adminToken()
const a = await reg('alice'); const b = await reg('bob')
let settings = await call(admin.token, 'GET', '/admin/settings')
const put = async (patch) => { const r = await callS(admin.token, 'PUT', '/admin/settings', { ...settings, ...patch }); if (r.status === 200) settings = r.body; return r }

console.log('-- settings + tokens')
let r = await put({ fcm_service_account: '{"nope":1}' }); ok('a bad service account is refused', r.status === 400)
r = await put({ fcm_service_account: sa, fcm_endpoint: `http://${HOST}:${PORT}` }); ok('service account accepted; push on', r.status === 200 && r.body.push === true && r.body.fcm_service_account === sa)
ok('/instance shows push on, never the key', (await call(a.token, 'GET', '/instance')).push === true && (await call(a.token, 'GET', '/instance')).fcm_service_account === undefined)
ok('audit records set, not the key', (await call(admin.token, 'GET', '/admin/audit')).some((e) => e.action === 'settings.update' && e.details?.fcm_service_account === 'set'))
r = await callS(b.token, 'PUT', '/users/@me/push-tokens', { platform: 'toaster', token: 'x'.repeat(40) }); ok('platform validated', r.status === 400)
r = await callS(b.token, 'PUT', '/users/@me/push-tokens', { platform: 'android', token: 'short' }); ok('token length validated', r.status === 400)
const good = `good-${S}-${'t'.repeat(40)}`, dead = `dead-${S}-${'t'.repeat(40)}`
r = await callS(b.token, 'PUT', '/users/@me/push-tokens', { platform: 'android', token: good }); ok('bob registers a device', r.status === 200 && r.body.push_enabled === true)
await callS(b.token, 'PUT', '/users/@me/push-tokens', { platform: 'ios', token: dead })

console.log('-- delivery')
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: `psst ${S}` })
for (let i = 0; i < 40 && sent.length < 2; i++) await new Promise((r) => setTimeout(r, 150))
ok('a DM to an offline user pushes to each of his devices', sent.length === 2 && sent.every((m) => m.auth === 'Bearer stub-access' && m.notification.body === `psst ${S}` && m.notification.title.startsWith('Alice') && m.data.channel_id === dm.id), JSON.stringify(sent.map((m) => [m.token.slice(0, 4), m.notification])))
ok('OAuth token was minted once and cached', tokenCalls === 1)
await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: `again ${S}` })
for (let i = 0; i < 40 && sent.length < 3; i++) await new Promise((r) => setTimeout(r, 150)); await new Promise((r) => setTimeout(r, 400))
ok('the dead token was dropped after UNREGISTERED: second message reaches one device', sent.length === 3 && sent[2].token === good)
// bob comes online over a socket: no push
const WS = B.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws'
const sock = new WebSocket(`${WS}?token=${b.token}`); await new Promise((res) => { sock.onopen = () => setTimeout(res, 500) })
await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: `online ${S}` }); await new Promise((r) => setTimeout(r, 800))
ok('nothing is pushed while bob has a socket open', sent.length === 3)
sock.close(); await new Promise((r) => setTimeout(r, 1500))
// mentions in a server
const g = await call(a.token, 'POST', '/guilds', { name: `Push ${S}` }); const tc = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `no mention ${S}` }); await new Promise((r) => setTimeout(r, 600))
ok('plain server messages do not push', sent.length === 3)
await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `hey <@${b.user.id}> ${S}` })
for (let i = 0; i < 40 && sent.length < 4; i++) await new Promise((r) => setTimeout(r, 150))
ok('a mention pushes with the channel and server in the title', sent.length === 4 && sent[3].notification.title.includes(`#${tc.name}`) && sent[3].data.guild_id === g.id, JSON.stringify(sent[3]?.notification))
await callS(b.token, 'PUT', `/users/@me/notification-settings/${g.id}`, { level: 'nothing' })
await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `muted <@${b.user.id}> ${S}` }); await new Promise((r) => setTimeout(r, 800))
ok('a muted server never pushes', sent.length === 4)
r = await callS(b.token, 'DELETE', '/users/@me/push-tokens', { token: good }); ok('logging out a device removes its token', r.status === 204)
await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: `bye ${S}` }); await new Promise((r) => setTimeout(r, 800))
ok('no devices left, nothing sent', sent.length === 4)
r = await put({ fcm_service_account: '', fcm_endpoint: '' }); ok('push turned off', r.status === 200 && r.body.push === false)
server.close(); await finish()
