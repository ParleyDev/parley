// Cloudflare TURN: an admin pastes a TURN key ID and API token, the server trades them for short-lived relay logins
// (checked on save, cached, port 53 dropped) and calls get them on every join, so peer-to-peer calls that can't connect
// directly go through the relay. A stub stands in for Cloudflare's Realtime API.
import { chromium } from 'playwright'
import http from 'node:http'
import { B, WEB, reg, call, callS, raw, ok, finish, adminToken } from '../lib.mjs'
const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
const KEY = 'key123', TOKEN = 'good-token'
let calls = 0, lastBody = null
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    if (req.method !== 'POST' || req.url !== `/v1/turn/keys/${KEY}/credentials/generate-ice-servers`) { res.writeHead(404); res.end(); return }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); res.end('{}'); return }
    calls++; lastBody = JSON.parse(body || '{}')
    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53', 'turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: `u${calls}`, credential: `c${calls}` }] }))
  })
})
await new Promise((r) => server.listen(0, '0.0.0.0', r)); const PORT = server.address().port
const STUB = `http://${HOST}:${PORT}`
const admin = await adminToken(); const a = await reg('alice'), b = await reg('bob')
const settings = await call(admin.token, 'GET', '/admin/settings')
const put = (extra) => callS(admin.token, 'PUT', '/admin/settings', { ...settings, cf_turn_key_id: '', cf_turn_api_token: '', cf_turn_endpoint: '', ...extra })
const ice = async (t) => (await callS(t, 'GET', '/voice/ice-servers'))
const urls = (list) => list.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]))

console.log('-- off')
await put({})
let r = await ice(a.token)
ok('without a key, calls get the instance ICE servers only', r.status === 200 && Array.isArray(r.body) && !urls(r.body).some((u) => u.startsWith('turn')), JSON.stringify(r.body))
ok('and /instance says the relay is off', (await (await fetch(`${B}/instance`)).json()).turn === false)
ok('the ICE list needs a signed-in user', (await fetch(`${B}/voice/ice-servers`)).status === 401)

console.log('-- admin settings')
r = await put({ cf_turn_key_id: KEY })
ok('a key ID without its token is refused', r.status === 400)
r = await put({ cf_turn_key_id: KEY, cf_turn_api_token: 'wrong', cf_turn_endpoint: STUB })
ok('a token Cloudflare rejects is caught on save', r.status === 400 && /didn't accept/.test(JSON.stringify(r.body)), JSON.stringify(r.body))
r = await callS(a.token, 'PUT', '/admin/settings', { ...settings, cf_turn_key_id: KEY, cf_turn_api_token: TOKEN, cf_turn_endpoint: STUB })
ok('only admins can set it', r.status === 403)
r = await put({ cf_turn_key_id: KEY, cf_turn_api_token: TOKEN, cf_turn_endpoint: STUB })
ok('a working key saves', r.status === 200 && r.body.turn === true, JSON.stringify(r.body?.turn))
ok('  after trying it once with a 24 hour lifetime', calls === 1 && lastBody?.ttl === 86400, `${calls} ${JSON.stringify(lastBody)}`)
const pub = await (await fetch(`${B}/instance`)).json()
ok('/instance says the relay is on, without the key or token', pub.turn === true && !JSON.stringify(pub).includes(TOKEN) && !JSON.stringify(pub).includes(KEY))

console.log('-- clients')
r = await ice(b.token)
const all = urls(r.body)
ok("calls get Cloudflare's relays", all.includes('turn:turn.cloudflare.com:3478?transport=udp') && all.includes('turns:turn.cloudflare.com:443?transport=tcp'), JSON.stringify(r.body))
ok('  with the short-lived login', r.body.some((s) => s.username === 'u1' && s.credential === 'c1'))
ok('  next to the instance STUN server', all.some((u) => u.includes('stun.l.google.com')))
ok('port 53 (blocked by browsers) is left out', !all.some((u) => u.split('?')[0].endsWith(':53')))
await ice(a.token); await ice(b.token)
ok('the login is reused for a while instead of asking Cloudflare every time', calls === 1, String(calls))

console.log('-- a call')
await call(a.token, 'POST', '/users/@me/relationships', { user_id: b.user.id }); await call(b.token, 'PUT', `/users/@me/relationships/${a.user.id}`)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
const mk = async (t) => {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  // Record the ICE servers every peer connection is made with.
  await p.addInitScript(() => { const P = window.RTCPeerConnection; window.__ice = []; window.RTCPeerConnection = function (cfg, ...rest) { window.__ice.push(cfg?.iceServers ?? []); return new P(cfg, ...rest) }; window.RTCPeerConnection.prototype = P.prototype; Object.assign(window.RTCPeerConnection, P) })
  await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t); await p.goto(`${WEB}/channels/@me/${dm.id}`); return p
}
const pa = await mk(a.token), pb = await mk(b.token)
const fetched = []; pa.on('request', (q) => { if (q.url().includes('/voice/ice-servers')) fetched.push(q.url()) })
await pa.waitForSelector('[data-start-call]'); await pa.click('[data-start-call]')
await pb.waitForSelector('[data-incoming-call]'); await pb.click('[data-call-join]')
await pb.waitForSelector('[data-voice-connected]'); await pb.waitForTimeout(2000)
ok('joining a call fetches fresh ICE servers', fetched.length >= 1)
const iceA = await pa.evaluate(() => window.__ice.flat()), iceB = await pb.evaluate(() => window.__ice.flat())
ok("both sides' peer connections use the relay", [iceA, iceB].every((l) => l.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.startsWith('turns:')) && s.username === 'u1')), JSON.stringify([iceA, iceB]))
ok('and the call connects', (await pa.locator('[data-voice-connected]').count()) === 1)
await browser.close()

console.log('-- Cloudflare down')
await put({ cf_turn_key_id: KEY, cf_turn_api_token: TOKEN, cf_turn_endpoint: STUB })
server.close()
// The cached login keeps working while Cloudflare is unreachable; with nothing cached, calls fall back to STUN.
r = await ice(a.token)
ok('a call still gets ICE servers when Cloudflare is unreachable', r.status === 200 && urls(r.body).some((u) => u.includes('stun')))

await put({})
ok('clearing the key turns the relay off', (await (await fetch(`${B}/instance`)).json()).turn === false)
await finish()
