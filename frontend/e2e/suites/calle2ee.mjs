// End-to-end encrypted calls (mesh): the channel setting, key agreement and a matching safety code, media flowing
// through the frame-encryption worker, refusing clients that can't encrypt (client and server side), dropping them
// when encryption is switched on mid-call, and the DM toggle.
import { chromium } from 'playwright'
import { WEB, B, S, reg, call, raw, ok, finish } from '../lib.mjs'
const WS = B.replace(/^http/, 'ws').replace(/\/api$/, '/ws')
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol'), d = await reg('dave')
const g = await call(a.token, 'POST', '/guilds', { name: `Crypt ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
ok('voice channels start end-to-end encrypted', vc.e2ee === true)
{ const st = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'Studio', kind: 'studio' }); const sg = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'Stage', kind: 'stage' }); ok('studio channels don\'t, stage channels do', st.e2ee === false && sg.e2ee === true) }
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const u of [b, c, d]) await call(u.token, 'POST', `/invites/${inv.code}`)

console.log('-- REST')
let r = await raw(b.token, 'PATCH', `/channels/${vc.id}`, { e2ee: true }); ok('members without Manage Channels cannot switch it', r.status === 403)
const text = g.channels.find((x) => x.kind === 'text')
r = await raw(a.token, 'PATCH', `/channels/${text.id}`, { e2ee: true }); ok('text channels refuse it', r.status === 400)
await raw(a.token, 'PATCH', `/channels/${vc.id}`, { e2ee: false }) // it starts on; switch it off to switch it back on
r = await raw(a.token, 'PATCH', `/channels/${vc.id}`, { e2ee: true }); ok('owner turns it on', r.status === 200 && (await r.json()).e2ee === true)
const audit = await call(a.token, 'GET', `/guilds/${g.id}/audit`)
ok('audit log records the change', audit.some((e) => e.action === 'channel.update' && e.details?.e2ee === true))

console.log('-- server refuses a client that cannot encrypt')
const sock = (tok) => new Promise((res) => { const w = new WebSocket(`${WS}?token=${tok}`); const ev = []; w.onmessage = (m) => ev.push(JSON.parse(m.data)); w.onopen = () => setTimeout(() => res({ w, ev }), 300) })
const dv = await sock(d.token)
dv.w.send(JSON.stringify({ op: 'voice_join', channel_id: vc.id })); await new Promise((x) => setTimeout(x, 500))
ok('voice_join without e2ee is refused', dv.ev.some((e) => e.t === 'VOICE_ERROR' && /end-to-end encrypted/.test(e.d.message)), JSON.stringify(dv.ev.map((e) => e.t)))

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const hooks = () => {
  const Orig = window.RTCPeerConnection
  window.__pcs = []
  window.RTCPeerConnection = function (...args) { const pc = new Orig(...args); window.__pcs.push(pc); return pc }
  window.RTCPeerConnection.prototype = Orig.prototype
}
const open = async (tok, url, init = hooks) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] })
  await ctx.addInitScript(init)
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(url); return p
}
const joinVoice = async (p) => { await p.waitForSelector('text=Join Voice'); await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]', { timeout: 15000 }) }
const url = `${WEB}/channels/${g.id}/${vc.id}`
const code = async (p) => { await p.click('[data-call-lock]'); const t = await p.locator('[data-safety-code]').innerText().catch(() => ''); await p.click('[data-call-lock]', { force: true }).catch(() => {}); await p.keyboard.press('Escape'); return t }

console.log('-- encrypted mesh call')
const pa = await open(a.token, url); await joinVoice(pa)
const pb = await open(b.token, url); await joinVoice(pb)
ok('the sidebar marks the channel', await pa.locator(`[data-channel-row="${vc.name}"] [data-e2ee-icon]`).count() === 1)
ok('the call shows the lock', await pa.locator('[data-call-lock]').count() === 1 && await pb.locator('[data-call-lock]').count() === 1)
await pa.waitForTimeout(2500)
const ca = await code(pa), cb = await code(pb)
ok('both see the same 20-digit safety code', /^\d{4}( \d{4}){4}$/.test(ca) && ca === cb, `${ca} / ${cb}`)
const transforms = await pa.evaluate(() => window.__pcs.filter((pc) => pc.connectionState !== 'closed').flatMap((pc) => pc.getTransceivers().flatMap((t) => [t.sender, t.receiver])).map((x) => !!x.transform))
ok('every sender and receiver runs through the encryption worker', transforms.length >= 6 && transforms.every(Boolean), JSON.stringify(transforms))
// Media still flows end to end: alice's camera reaches bob, decoded.
await pa.click('button[aria-label="Turn On Camera"], button[title="Turn On Camera"]').catch(() => {})
const sees = await pb.waitForFunction((id) => [...document.querySelectorAll(`[data-voice-tile="${id}"] video`)].some((v) => v.videoWidth > 0 && !v.paused), a.user.id, { timeout: 15000 }).then(() => true).catch(() => false)
ok('alice\'s encrypted camera decodes at bob', sees)
const heard = await pb.waitForFunction(() => [...document.querySelectorAll('audio[data-peer]')].some((x) => x.srcObject && x.srcObject.getAudioTracks().some((t) => t.readyState === 'live' && !t.muted)), null, { timeout: 10000 }).then(() => true).catch(() => false)
ok('alice\'s encrypted audio reaches bob', heard)
ok('video negotiated as VP8', await pa.evaluate(async () => { for (const pc of window.__pcs) { if (pc.connectionState !== 'connected') continue; const st = await pc.getStats(); for (const v of st.values()) if (v.type === 'codec' && /video/i.test(v.mimeType)) return /vp8/i.test(v.mimeType) } return false }))

console.log('-- a third person changes the code')
const pc3 = await open(c.token, url); await joinVoice(pc3); await pa.waitForTimeout(3000)
const ca3 = await code(pa), cc3 = await code(pc3)
ok('code changes when someone joins, and still matches', ca3 !== ca && ca3 === cc3, `${ca3} / ${cc3}`)
await pc3.click('[data-voice-leave]'); await pa.waitForTimeout(1500)

console.log('-- browser without encryption support')
const pd = await open(d.token, url, () => { delete window.RTCRtpScriptTransform; delete RTCRtpSender.prototype.createEncodedStreams })
await pd.waitForSelector('text=Join Voice'); await pd.click('text=Join Voice'); await pd.waitForTimeout(1200)
ok('it is told it cannot join, and stays out', await pd.locator('[data-voice-leave]').count() === 0 && await pd.locator("text=can't encrypt calls").count() >= 1)

console.log('-- switching off and on mid-call')
await raw(a.token, 'PATCH', `/channels/${vc.id}`, { e2ee: false })
await pa.waitForSelector('[data-voice-leave]'); await pa.waitForTimeout(3000)
ok('turning it off reconnects the call unencrypted', await pa.locator('[data-call-lock]').count() === 0 && await pa.locator('[data-voice-leave]').count() === 1)
// A client that can't encrypt joins the now-plain call, then encryption comes back on: it is dropped.
dv.ev.length = 0
dv.w.send(JSON.stringify({ op: 'voice_join', channel_id: vc.id })); await new Promise((x) => setTimeout(x, 600))
ok('the plain call lets it in', dv.ev.some((e) => e.t === 'VOICE_STATE_UPDATE' && e.d.user_id === d.user.id && e.d.channel_id === vc.id))
dv.ev.length = 0
await raw(a.token, 'PATCH', `/channels/${vc.id}`, { e2ee: true }); await new Promise((x) => setTimeout(x, 800))
ok('switching encryption on drops it from the call', dv.ev.some((e) => e.t === 'VOICE_STATE_UPDATE' && e.d.user_id === d.user.id && e.d.channel_id === null), JSON.stringify(dv.ev.map((e) => [e.t, e.d?.user_id === d.user.id, e.d?.channel_id])))
await pa.waitForTimeout(4000)
ok('the others reconnect encrypted', await pa.locator('[data-call-lock]').count() === 1 && await pb.locator('[data-call-lock]').count() === 1 && await pa.locator('[data-voice-leave]').count() === 1)
const ca4 = await code(pa), cb4 = await code(pb)
ok('with new keys and a matching code', ca4 && ca4 === cb4 && ca4 !== ca, `${ca4} / ${cb4}`)
dv.w.close()
await pa.click('[data-voice-leave]'); await pb.click('[data-voice-leave]')

console.log('-- DM calls')
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
await pa.goto(`${WEB}/channels/@me/${dm.id}`); await pa.waitForSelector('[data-dm-e2ee]')
ok('DM calls are end-to-end encrypted by default', (await pa.getAttribute('[data-dm-e2ee]', 'data-dm-e2ee')) === '1')
await pa.click('[data-dm-e2ee]'); await pa.waitForTimeout(800)
ok('the header toggle turns it off', (await pa.getAttribute('[data-dm-e2ee]', 'data-dm-e2ee')) === '0')
await pa.click('[data-dm-e2ee]'); await pa.waitForTimeout(800)
ok('and back on', (await pa.getAttribute('[data-dm-e2ee]', 'data-dm-e2ee')) === '1')
ok('and leaves a notice in the conversation', await pa.locator('text=turned on end-to-end encryption for calls').count() >= 1)
await pa.click('[data-start-call]'); await pa.waitForSelector('[data-dm-call]')
await pb.goto(`${WEB}/channels/@me/${dm.id}`); await pb.waitForSelector('[data-start-call]'); await pb.click('[data-start-call]')
await pb.waitForTimeout(3500)
ok('the DM call shows the lock', await pa.locator('[data-dm-call] [data-call-lock]').count() === 1)
const da = await code(pa), db = await code(pb)
ok('and both sides see the same code', /^\d{4}( \d{4}){4}$/.test(da) && da === db, `${da} / ${db}`)
const dmTransforms = await pb.evaluate(() => window.__pcs.filter((pc) => pc.connectionState !== 'closed').flatMap((pc) => pc.getTransceivers().flatMap((t) => [t.sender, t.receiver])).every((x) => !!x.transform))
ok('DM call media goes through the worker', dmTransforms)
// Toggling from the header during the DM call: leave() marks the DM call quiet, which used to re-run the resync from
// the store subscription and recurse until the stack overflowed (an endless loop of sounds, the page frozen).
const responsive = async (p) => { const t0 = Date.now(); await p.evaluate(() => 1); return Date.now() - t0 < 300 }
await pa.click('[data-dm-e2ee]'); await pa.waitForTimeout(4000)
ok('switching encryption off mid DM call reconnects both, unencrypted', (await pa.evaluate(() => window.__parleyVoice())).e2ee === false && (await pb.evaluate(() => window.__parleyVoice())).e2ee === false && (await pb.evaluate(() => window.__parleyVoice())).channel === dm.id)
ok('…without freezing the page', await responsive(pa) && await responsive(pb))
await pa.click('[data-dm-e2ee]'); await pa.waitForTimeout(4000)
ok('and back on mid call: both encrypted again', (await pa.evaluate(() => window.__parleyVoice())).e2ee === true && (await pb.evaluate(() => window.__parleyVoice())).e2ee === true && await responsive(pa))
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close()
await finish()
