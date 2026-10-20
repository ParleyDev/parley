import { chromium } from 'playwright'
import { B, WEB, S, reg, call, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Resume ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
const WS = B.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws'

/** Open a socket and collect events until `until(events)` is true or the timeout passes. */
const open = (token, seq, until, ms = 4000) => new Promise((resolve) => {
  const ws = new WebSocket(`${WS}?token=${token}${seq != null ? `&seq=${seq}` : ''}`); const events = []
  const done = () => { clearTimeout(t); resolve({ ws, events }) }
  const t = setTimeout(done, ms)
  ws.onmessage = (e) => { const ev = JSON.parse(e.data); events.push(ev); if (until(events)) done() }
  ws.onerror = () => done(); ws.onclose = () => done()
})

console.log('-- API')
let { ws, events } = await open(b.token, null, (ev) => ev.some((x) => x.t === 'READY'))
const ready = events.find((x) => x.t === 'READY')
ok('READY carries a sequence number', typeof ready?.s === 'number')
const m0 = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `live ${S}` })
await new Promise((r) => setTimeout(r, 400))
const liveEv = events.find((x) => x.t === 'MESSAGE_CREATE' && x.d.message.id === m0.id)
ok('live events carry increasing sequence numbers', typeof liveEv?.s === 'number' && liveEv.s > ready.s)
const lastSeq = Math.max(...events.map((x) => x.s ?? 0))
ws.close(); await new Promise((r) => setTimeout(r, 300))
// gap: three messages and a channel rename while bob is offline
const gap = []
for (let i = 1; i <= 3; i++) gap.push(await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `missed ${i} ${S}` }))
await call(a.token, 'PATCH', `/channels/${tc.id}`, { topic: `topic ${S}` })
const dmOther = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: (await reg('carol')).user.id })
await call(a.token, 'POST', `/channels/${dmOther.id}/messages`, { content: `not for bob ${S}` })
;({ ws, events } = await open(b.token, lastSeq, (ev) => ev.filter((x) => x.t === 'MESSAGE_CREATE').length >= 3 && ev.some((x) => x.t === 'CHANNEL_UPDATE')))
const resumed = events[0]
ok('reconnecting with seq gets RESUMED first, not READY', resumed?.t === 'RESUMED' && !events.some((x) => x.t === 'READY'))
const replayed = events.filter((x) => x.t === 'MESSAGE_CREATE').map((x) => x.d.message.id)
ok('the three missed messages are replayed in order', JSON.stringify(replayed) === JSON.stringify(gap.map((m) => m.id)))
ok('the channel update was replayed too and the replay count matches', events.some((x) => x.t === 'CHANNEL_UPDATE' && x.d.topic === `topic ${S}`) && resumed.d.replayed >= 4)
ok('events for other people are not replayed', !events.some((x) => x.t === 'MESSAGE_CREATE' && x.d.message.content === `not for bob ${S}`))
ok('replayed sequence numbers are contiguous and above the resume point', events.slice(1).every((x, i, arr) => x.s > lastSeq && (i === 0 || x.s > arr[i - 1].s)))
// still live after resume
const m4 = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `after resume ${S}` })
await new Promise((r) => setTimeout(r, 400))
ok('the resumed socket keeps receiving live events', events.some((x) => x.t === 'MESSAGE_CREATE' && x.d.message.id === m4.id))
const last2 = Math.max(...events.map((x) => x.s ?? 0)); ws.close(); await new Promise((r) => setTimeout(r, 200))
;({ ws, events } = await open(b.token, last2 + 1000000, (ev) => ev.some((x) => x.t === 'READY')))
ok('a sequence number the server never issued (other process) falls back to a full READY', events[0]?.t === 'READY')
ws.close()
;({ ws, events } = await open(b.token, 0, (ev) => ev.some((x) => x.t === 'READY')))
ok('seq=0 means no resume', events[0]?.t === 'READY'); ws.close()

console.log('-- UI')
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), b.token)
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector(`[data-msg-id="${m4.id}"]`)
// Simulate a network blip: drop the socket, post while it is down, let the client reconnect with its last seq.
await p.evaluate(() => window.__parleyWs.drop()); await new Promise((r) => setTimeout(r, 300))
const m5 = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `while offline ${S}` })
await p.waitForSelector(`[data-msg-id="${m5.id}"]`, { timeout: 15000 })
const stats = await p.evaluate(() => window.__parleyWs)
ok('after the blip the client resumed (no second READY) and got the missed message', stats.ready === 1 && stats.resumed >= 1 && stats.replayed >= 1, JSON.stringify(stats))
ok('the missed message appears exactly once', await p.locator(`[data-msg-id="${m5.id}"]`).count() === 1)
await p.screenshot({ path: '108-resumed.png' })
// A server restart: the sequence is gone, so the reconnect is a full READY. The view must stay populated and pick
// up what was missed, without switching channels.
await p.evaluate(() => window.__parleyWs.resync()); await new Promise((r) => setTimeout(r, 300))
const m6 = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `after restart ${S}` })
await p.waitForFunction(() => window.__parleyWs.ready >= 2, null, { timeout: 15000 })
ok('the view keeps its messages through the full reconnect (no blank)', await p.locator(`[data-msg-id="${m4.id}"]`).count() === 1 && await p.locator(`[data-msg-id="${m5.id}"]`).count() === 1)
await p.waitForSelector(`[data-msg-id="${m6.id}"]`, { timeout: 15000 })
ok('…and shows the message posted while it was down, without switching channels', await p.locator(`[data-msg-id="${m6.id}"]`).count() === 1)
await p.screenshot({ path: '108b-after-restart.png' })
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
