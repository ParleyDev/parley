// Push notifications for the native apps: token registration, FCM delivery (stubbed) for DMs and mentions to offline
// users, mute and online suppression, dead-token cleanup; APNs delivery (stubbed) for iOS tokens.
import http from 'node:http'
import { generateKeyPairSync } from 'node:crypto'
import { B, S, reg, call, callS, raw, ok, finish, adminToken, openDms } from '../lib.mjs'

const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
const sent = []; const apnsSent = []; let tokenCalls = 0
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c }); req.on('end', () => {
    if (req.url === '/token') { tokenCalls++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ access_token: 'stub-access', expires_in: 3600 })); return }
    if (req.url.startsWith('/3/device/')) {
      const token = req.url.slice('/3/device/'.length)
      apnsSent.push({ token, auth: req.headers.authorization, topic: req.headers['apns-topic'], type: req.headers['apns-push-type'], priority: req.headers['apns-priority'], body: JSON.parse(body) })
      if (token.includes('gone')) { res.writeHead(410, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ reason: 'Unregistered' })); return }
      res.writeHead(200); res.end(); return
    }
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
await openDms(a, b)
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
ok('FCM data is all strings: a DM has no guild_id key', sent.every((m) => !('guild_id' in m.data) && Object.values(m.data).every((v) => typeof v === 'string')), JSON.stringify(sent[0]?.data))
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

console.log('-- APNs for iOS')
const p8 = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' })
r = await put({ apns_key: 'not a key', apns_key_id: 'ABC123DEFG', apns_team_id: '45H7F9K932' }); ok('a bad .p8 is refused', r.status === 400)
r = await put({ apns_key: p8, apns_key_id: 'short', apns_team_id: '45H7F9K932' }); ok('a bad key ID is refused', r.status === 400)
r = await put({ apns_key: p8, apns_key_id: 'abc123defg', apns_team_id: '45H7F9K932', apns_endpoint: `http://${HOST}:${PORT}` })
ok('APNs key accepted; push on; IDs upper-cased', r.status === 200 && r.body.push === true && r.body.apns_key_id === 'ABC123DEFG')
const inst = await call(a.token, 'GET', '/instance'); ok('/instance shows push on, never the APNs key', inst.push === true && inst.apns_key === undefined && inst.apns_key_id === undefined)
const iosGood = 'a'.repeat(64), iosGone = 'gone' + 'b'.repeat(60)
await callS(b.token, 'PUT', '/users/@me/push-tokens', { platform: 'ios', token: iosGood }); await callS(b.token, 'PUT', '/users/@me/push-tokens', { platform: 'ios', token: iosGone })
await callS(b.token, 'PUT', '/users/@me/push-tokens', { platform: 'android', token: 'android' + 'c'.repeat(60) })
const fcmBefore = sent.length
await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: `to the iphone ${S}` })
for (let i = 0; i < 40 && apnsSent.length < 2; i++) await new Promise((r) => setTimeout(r, 150)); await new Promise((r) => setTimeout(r, 400))
const ap = apnsSent.find((m) => m.token === iosGood)
ok('a DM reaches each iOS device through APNs', apnsSent.length === 2 && !!ap, JSON.stringify(apnsSent.map((m) => m.token.slice(0, 4))))
ok('…as an alert with title, body, sound and the channel to open', ap?.body.aps.alert.title.startsWith('Alice') && ap?.body.aps.alert.body === `to the iphone ${S}` && ap?.body.aps.sound === 'default' && ap?.body.channel_id === dm.id && ap?.body.aps['thread-id'] === dm.id && !('guild_id' in ap.body), JSON.stringify(ap?.body))
ok('…for the app\'s bundle ID, high priority', ap?.topic === 'com.runparley.app' && ap?.type === 'alert' && ap?.priority === '10')
const jwt = (ap?.auth ?? '').replace(/^bearer /, '').split('.'); const dec = (x) => JSON.parse(Buffer.from(x, 'base64url').toString())
ok('…signed with an ES256 provider token naming the key and team', jwt.length === 3 && dec(jwt[0]).alg === 'ES256' && dec(jwt[0]).kid === 'ABC123DEFG' && dec(jwt[1]).iss === '45H7F9K932')
ok('Android devices still go through FCM', sent.length === fcmBefore + 1 && sent.at(-1).token.startsWith('android'))
await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: `again iphone ${S}` })
for (let i = 0; i < 40 && apnsSent.length < 3; i++) await new Promise((r) => setTimeout(r, 150)); await new Promise((r) => setTimeout(r, 400))
ok('a token APNs calls Unregistered is dropped', apnsSent.length === 3 && apnsSent[2].token === iosGood)
ok('the provider token is reused', apnsSent[2].auth === ap?.auth)
r = await put({ fcm_service_account: '', fcm_endpoint: '' }); ok('FCM off, APNs alone keeps push on', r.status === 200 && r.body.push === true)
r = await put({ apns_key: '', apns_key_id: '', apns_team_id: '', apns_endpoint: '' }); ok('push turned off', r.status === 200 && r.body.push === false)
server.close(); await finish()
