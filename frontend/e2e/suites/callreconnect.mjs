// A call on a media server (LiveKit) that drops: the room is reconnected without being asked, the other side hears
// you again, a camera survives it; a server that stays away ends as a failed call with Try again (not as a member
// sitting in a silent call); a server that says no fails at once with its reason.
// Needs a LiveKit dev server on localhost:7880 (key "devkey", secret "secret"); skipped when there is none.
import { chromium } from 'playwright'
import { WEB, B, S, reg, call, callS, ok, finish, adminToken } from '../lib.mjs'
const LK = 'http://localhost:7880'
const reachable = await fetch(LK).then((r) => !!r.status, () => false)
if (!reachable) { console.log('  (skipped: no media server on localhost:7880)'); await finish() }
const admin = await adminToken()
const original = await call(admin.token, 'GET', '/admin/settings')
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Drop ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
await callS(admin.token, 'PUT', '/admin/settings', { ...original, livekit_url: 'ws://localhost:7880', livekit_api_key: 'devkey', livekit_api_secret: 'secret' })
ok('(the instance uses the media server)', (await (await fetch(`${B}/instance`)).json()).voice_mode === 'sfu')

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const mk = async (tok) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('[data-voice-prejoin]')
  return p
}
const pa = await mk(a.token), pb = await mk(b.token)
const v = (p) => p.evaluate(() => window.__parleyVoice())
const until = (p, want, ms = 20000) => p.waitForSelector(`[data-call-status="${want}"]`, { timeout: ms }).then(() => true, () => false)
const inRoom = (p, remote) => p.waitForFunction((n) => { const x = window.__parleyVoice?.(); return x?.room === 'connected' && x.remote === n }, remote, { timeout: 20000 }).then(() => true, () => false)
for (const p of [pa, pb]) { await p.click('[data-voice-prejoin] button'); await until(p, 'connected') }
ok('both are in the room', await inRoom(pa, 1) && await inRoom(pb, 1))
await pa.click('[data-voice-connected] [data-voice-camera]')
await pb.waitForFunction((id) => !!document.querySelector(`[data-voice-tile="${id}"] video`), a.user.id, { timeout: 15000 }).catch(() => {})
ok('(alice has her camera on, and bob sees it)', await pb.locator(`[data-voice-tile="${a.user.id}"] video`).count() === 1)

console.log('-- the room drops')
await pa.evaluate(() => window.__parleyCall.drop('server went away'))
ok('the call says reconnecting, in the panel and over the stage', await pa.locator('[data-call-status="reconnecting"]').count() === 1 && await pa.locator('[data-call-reconnecting]').count() === 1)
ok('and is back in the room without being asked', await until(pa, 'connected') && await inRoom(pa, 1))
ok('still in the call for everyone', (await v(pa)).channel === vc.id && await pb.locator('[data-voice-tile]').count() === 2)
await pb.waitForFunction((id) => !!document.querySelector(`audio[data-peer="${id}"]`)?.srcObject, a.user.id, { timeout: 15000 }).catch(() => {})
ok('bob hears alice again', await pb.evaluate((id) => { const el = document.querySelector(`audio[data-peer="${id}"]`); return !!el?.srcObject && el.srcObject.getAudioTracks().some((t) => t.readyState === 'live') }, a.user.id))
await pb.waitForFunction((id) => { const el = document.querySelector(`[data-voice-tile="${id}"] video`); return !!el && el.readyState >= 2 }, a.user.id, { timeout: 15000 }).catch(() => {})
ok('and sees her camera again', await pb.locator(`[data-voice-tile="${a.user.id}"] video`).count() === 1)
ok('the overlay is gone', await pa.locator('[data-call-reconnecting]').count() === 0)

console.log('-- the media server stays away')
// New connections to the media server are refused; the one in use is cut.
let serverDown = true
await pa.routeWebSocket(/:7880\//, (ws) => { if (serverDown) ws.close(); else ws.connectToServer() })
await pa.evaluate(() => window.__parleyCall.drop('server down'))
ok('it reconnects first', await pa.locator('[data-call-status="reconnecting"]').count() === 1)
const failed = await pa.waitForSelector('[data-call-failed="transport"]', { timeout: 90000 }).then(() => true, () => false)
ok('after its attempts the call fails, with Try again', failed && await pa.locator('[data-call-retry]').count() === 1)
const log = await pa.evaluate(() => window.__parleyCall.events())
ok('it tried several times, waiting longer each time', log.filter((l) => l.includes(' lost transport')).length >= 5, log.slice(-8).join(' | '))
ok('alice is out of the call for bob too (not silent in it)', await pb.waitForFunction(() => document.querySelectorAll('[data-voice-tile]').length === 1, null, { timeout: 10000 }).then(() => true, () => false))
ok('and her side shows no call', (await v(pa)).channel === null)
await pa.screenshot({ path: 'callreconnect-failed.png' })
serverDown = false
await pa.click('[data-call-retry]')
ok('once the server is back, Try again rejoins', await until(pa, 'connected') && await inRoom(pa, 1))

console.log('-- the server says no')
await pa.route('**/api/voice/token', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'You cannot connect to this channel' }) }))
await pa.evaluate(() => window.__parleyCall.drop('kicked from the room'))
await pa.waitForSelector('[data-call-failed]', { timeout: 15000 }).catch(() => {})
ok('a refusal fails at once, without retries', await pa.locator('[data-call-failed="refused"]').count() === 1)
ok('with the server\'s reason under plain words', (await pa.locator('[data-call-failed-detail]').textContent().catch(() => '')) === 'You cannot connect to this channel' && (await pa.locator('[data-call-failed-why]').textContent()).includes("didn't let you join"))
await pa.unroute('**/api/voice/token')
await pa.click('[data-call-retry]')
ok('Try again rejoins when it is allowed', await until(pa, 'connected') && await inRoom(pa, 1))

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await callS(admin.token, 'PUT', '/admin/settings', { ...original, livekit_url: '', livekit_api_key: '', livekit_api_secret: '' })
await finish()
