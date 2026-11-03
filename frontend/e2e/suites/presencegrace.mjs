// Presence that matches what people are doing. A closed connection doesn't flash its user offline: they stay online
// for a grace period (a refresh, a network blip, a server restart), and a phone app put in the background shows idle
// for a while before offline. The server shows someone idle by itself once their client stops reporting input, even
// when its timers have stopped (a hidden window); a call counts as being here; bots aren't timed. And messages count
// as read only when the reader has seen them: the window focused, the reader not away, the newest message on screen.
// The test backends run with PRESENCE_GRACE_SECS=3 and PRESENCE_PHONE_LINGER_SECS=8.
import { chromium } from 'playwright'
import { B, WEB, S, reg, call, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', `/guilds`, { name: `Presence ${S}` }); const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const tc = g.channels.find((x) => x.kind === 'text'), vc = g.channels.find((x) => x.kind === 'voice')
const WS = B.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws'
const open = (token, q = '') => new Promise((resolve) => { const ws = new WebSocket(`${WS}?token=${token}${q}`); const events = []; ws.onmessage = (e) => { const ev = JSON.parse(e.data); events.push(ev); if (ev.t === 'READY') resolve({ ws, events, ready: ev.d }) }; ws.onerror = () => resolve({ ws, events }) })
const send = (s, op) => s.ws.send(JSON.stringify(op))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Alice watches bob's presence from a socket of her own.
const watcher = await open(a.token, '&platform=web')
const bobEvents = () => watcher.events.filter((e) => e.t === 'PRESENCE_UPDATE' && e.d.user_id === b.user.id).map((e) => e.d)
const bobNow = () => bobEvents().at(-1)
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await sleep(100) } return false }
const shown = (d) => !d ? 'none' : !d.online ? 'offline' : d.idle ? `idle on ${d.platforms.join(',')}` : `online on ${d.platforms.join(',')}`

console.log('-- a closed connection lingers')
let s = await open(b.token, '&platform=web')
ok('bob connects: online', await until(() => shown(bobNow()) === 'online on web'), shown(bobNow()))
s.ws.close(); await sleep(1500)
ok('his connection closes: still online for the grace period', shown(bobNow()) === 'online on web', shown(bobNow()))
ok('a newcomer\'s READY lists him online meanwhile', (await open(a.token, '&platform=web').then((x) => { x.ws.close(); return x.ready.online.includes(b.user.id) })))
ok('then offline', await until(() => shown(bobNow()) === 'offline', 8000), shown(bobNow()))
s = await open(b.token, '&platform=web'); await until(() => shown(bobNow()) === 'online on web')
let n = bobEvents().length
s.ws.close(); await sleep(1000); s = await open(b.token, '&platform=web'); await sleep(4500)
ok('a reconnect within the grace period (refresh, blip, restart) never shows him offline', bobEvents().slice(n).every((d) => d.online), JSON.stringify(bobEvents().slice(n)))

console.log('-- a phone app in the background')
const phone = await open(b.token, '&platform=mobile')
s.ws.close(); await sleep(300)
send(phone, { op: 'suspend' }); phone.ws.close()
ok('the app goes to the background: idle on mobile, not offline', await until(() => shown(bobNow()) === 'idle on mobile', 3000), shown(bobNow()))
await sleep(4000)
ok('still idle after the ordinary grace period', shown(bobNow()) === 'idle on mobile', shown(bobNow()))
const r1 = await open(a.token, '&platform=web'); r1.ws.close()
ok('READY lists him online and idle meanwhile', r1.ready.online.includes(b.user.id) && r1.ready.idle.includes(b.user.id) && r1.ready.platforms[b.user.id]?.[0] === 'mobile')
ok('offline once the phone linger runs out', await until(() => shown(bobNow()) === 'offline', 8000), shown(bobNow()))
const back = await open(b.token, '&platform=mobile')
ok('back in the app: online at once', await until(() => shown(bobNow()) === 'online on mobile', 3000), shown(bobNow()))
back.ws.close(); await until(() => shown(bobNow()) === 'offline', 8000)

console.log('-- the server notices someone walked away')
s = await open(b.token, '&platform=web&away_after=2')
send(s, { op: 'activity' })
ok('a client that reports input: online', await until(() => shown(bobNow()) === 'online on web'), shown(bobNow()))
ok('no input reported (its own timers stopped): the server shows him idle', await until(() => shown(bobNow()) === 'idle on web', 6000), shown(bobNow()))
send(s, { op: 'activity' })
ok('input again: online at once', await until(() => shown(bobNow()) === 'online on web', 2000), shown(bobNow()))
send(s, { op: 'voice_join', channel_id: vc.id, e2ee: true }); await sleep(500)
n = bobEvents().length; await sleep(4500)
ok('in a call: never idle, input or not', bobEvents().slice(n).every((d) => !d.idle) && shown(bobNow()) === 'online on web', JSON.stringify(bobEvents().slice(n)))
send(s, { op: 'voice_leave' }); s.ws.close(); await until(() => shown(bobNow()) === 'offline', 8000)
const bot = await open(b.token, '&platform=web')
await until(() => shown(bobNow()) === 'online on web'); n = bobEvents().length; await sleep(4500)
ok('a client that doesn\'t ask to be timed and reports no input (a bot) isn\'t', bobEvents().slice(n).every((d) => !d.idle) && shown(bobNow()) === 'online on web', JSON.stringify(bobEvents().slice(n)))
bot.ws.close(); await until(() => shown(bobNow()) === 'offline', 8000)

console.log('-- the web client')
const browser = await chromium.launch(); const errors = []
const page = async (u) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token); await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('[data-member-list]')
  return p
}
const pb = await page(b)
ok('bob opens Parley: online', await until(() => shown(bobNow()) === 'online on web'), shown(bobNow()))
// His window is hidden and its timers stop: the client sends nothing, so only the server can tell.
await pb.evaluate(() => { const send = WebSocket.prototype.send; WebSocket.prototype.send = function (d) { if (window.__frozen) return; return send.call(this, d) }; window.__parleyWs.idleAfter = 3000; window.__parleyWs.drop() })
await pb.waitForFunction(() => document.querySelector('[data-member-list]') && window.__parleyWs.resumed + window.__parleyWs.ready > 1, null, { timeout: 8000 }).catch(() => {}); await sleep(800)
await pb.evaluate(() => { window.__frozen = true })
ok('his window stops reporting anything: the server shows him idle', await until(() => shown(bobNow()) === 'idle on web', 8000), shown(bobNow()))
await pb.evaluate(() => { window.__frozen = false }); await pb.mouse.move(300, 300); await pb.mouse.move(340, 320)
ok('he comes back and moves the mouse: online', await until(() => shown(bobNow()) === 'online on web', 4000), shown(bobNow()))
await pb.evaluate(() => { window.__parleyWs.idleAfter = 5 * 60_000; window.__parleyWs.drop() }); await sleep(500)
ok('a reload is no flash of offline', bobEvents().slice(-3).every((d) => d.online))

console.log('-- marking messages read')
const pa = await page(a)
await pa.waitForSelector('[data-message-id]', { state: 'attached', timeout: 3000 }).catch(() => {})
const readUpTo = async () => { const x = await open(a.token, '&platform=vr'); x.ws.close(); return x.ready.read_states.find((r) => r.channel_id === tc.id)?.last_read_msg ?? null }
const post = (text) => call(b.token, 'POST', `/channels/${tc.id}/messages`, { content: text })
const shownMsg = (id) => pa.waitForSelector(`[data-message-id="${id}"]`, { timeout: 5000 }).then(() => true, () => false)
let m = await post('looking right at it')
await shownMsg(m.id); await sleep(600)
ok('in front, focused, at the bottom: read', (await readUpTo()) === m.id, await readUpTo())

await pa.evaluate(() => { document.hasFocus = () => false; window.dispatchEvent(new Event('blur')) })
m = await post('another window in front'); await shownMsg(m.id); await sleep(800)
ok('the window not focused: stays unread', (await readUpTo()) !== m.id)
await pa.evaluate(() => { delete document.hasFocus; window.dispatchEvent(new Event('focus')) })
await sleep(600)
ok('focusing the window marks it read', (await readUpTo()) === m.id, await readUpTo())

await pa.evaluate(() => { window.__parleyWs.idleAfter = 700 }); await sleep(1000)
m = await post('nobody at the keyboard'); await shownMsg(m.id); await sleep(800)
ok('the reader away (no input): stays unread', (await readUpTo()) !== m.id)
await pa.mouse.move(500, 400); await pa.mouse.move(520, 420); await pa.evaluate(() => { window.__parleyWs.idleAfter = 5 * 60_000 }); await sleep(600)
ok('they come back and move the mouse: read', (await readUpTo()) === m.id, await readUpTo())

for (let i = 0; i < 40; i++) await post(`history ${i}\n${'line\n'.repeat(3)}`)
const lastHist = (await call(a.token, 'GET', `/channels/${tc.id}/messages?limit=1`))[0]
await shownMsg(lastHist.id); await sleep(800)
await pa.mouse.move(640, 400); for (let i = 0; i < 6; i++) await pa.mouse.wheel(0, -1500)
await sleep(800)
m = await post('while scrolled up'); await sleep(1200)
ok('scrolled up in the history: the new message stays unread', (await readUpTo()) !== m.id, await readUpTo())
await pa.mouse.move(640, 400); for (let i = 0; i < 40; i++) await pa.mouse.wheel(0, 3000)
await sleep(1200)
ok('scrolling down to it marks it read', (await readUpTo()) === m.id, await readUpTo())
await pa.screenshot({ path: 'presencegrace-read.png' })

ok('no page errors', errors.length === 0, errors.join('\n'))
watcher.ws.close(); await browser.close(); await finish()
