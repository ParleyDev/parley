// Automatic idle: a socket reports its user away (no input for a while, or the mobile app in the background) and the
// user shows as Idle once every socket is away. Any active device keeps them Online; a status they picked wins.
import { chromium } from 'playwright'
import { B, WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Idle ${S}` }); const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const tc = g.channels.find((x) => x.kind === 'text')
const WS = B.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws'
const open = (token, platform, extra = '') => new Promise((resolve) => { const ws = new WebSocket(`${WS}?token=${token}&platform=${platform}${extra}`); const events = []; ws.onmessage = (e) => { const ev = JSON.parse(e.data); events.push(ev); if (ev.t === 'READY') resolve({ ws, events }) }; ws.onerror = () => resolve({ ws, events }) })
const send = (s, op) => s.ws.send(JSON.stringify(op))
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token); await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('[data-member-list]')
// Wait until bob's badge in alice's member list has a title matching `re`.
const bobIs = (re) => p.waitForFunction((src) => [...document.querySelectorAll('[data-member-list] button')].some((x) => x.textContent.includes('Bob') && new RegExp(src).test(x.querySelector('[data-presence]')?.getAttribute('title') ?? '')), re.source, { timeout: 10000 }).then(() => true).catch(() => false)
const bobColor = () => p.locator('[data-member-list] button:has-text("Bob") [data-presence] rect').first().getAttribute('fill')

console.log('-- sockets')
const m = await open(b.token, 'mobile')
ok('bob connects: online', await bobIs(/^Online on mobile$/))
send(m, { op: 'idle', idle: true })
ok('his only socket goes away: idle', await bobIs(/^Idle on mobile$/))
ok('idle shows the yellow badge', (await bobColor()) === '#f6b53d', await bobColor())
const w = await open(b.token, 'web')
ok('an active second device brings him back online', await bobIs(/^Online on /))
ok('that socket\'s READY does not list him as idle', !w.events.find((e) => e.t === 'READY').d.idle?.includes(b.user.id))
w.ws.close()
ok('closing it leaves only the away socket: idle again', await bobIs(/^Idle on mobile$/))
const c = await open(a.token, 'web')
ok('READY lists idle users', c.events.find((e) => e.t === 'READY').d.idle?.includes(b.user.id))
c.ws.close()
send(m, { op: 'idle', idle: false })
ok('back at the phone: online', await bobIs(/^Online on mobile$/))
const bg = await open(b.token, 'mobile', '&idle=1')
send(m, { op: 'idle', idle: true })
ok('a socket that connects from the background counts as away from the start', await bobIs(/^Idle on mobile$/))

if (process.env.PARLEY_API_ORIGIN2) {
  console.log('-- across instances')
  const WS2 = process.env.PARLEY_API_ORIGIN2.replace(/^http/, 'ws') + '/ws'
  const other = await new Promise((resolve) => { const ws = new WebSocket(`${WS2}?token=${b.token}&platform=web`); ws.onmessage = (e) => { if (JSON.parse(e.data).t === 'READY') resolve(ws) } })
  ok('active on another instance: online', await bobIs(/^Online on /))
  other.close()
  ok('that one gone: idle again', await bobIs(/^Idle on mobile$/))
}

console.log('-- a picked status wins')
await call(b.token, 'PATCH', '/users/@me', { status: 'dnd' })
ok('do not disturb stays do not disturb while away', await bobIs(/^Do Not Disturb/))
await call(b.token, 'PATCH', '/users/@me', { status: 'invisible' })
ok('invisible stays offline while away', await bobIs(/^Offline$/))
await call(b.token, 'PATCH', '/users/@me', { status: 'online' })
ok('back to online: shows idle again', await bobIs(/^Idle on mobile$/))
m.ws.close(); bg.ws.close()
ok('last socket gone: offline', await bobIs(/^Offline$/))

console.log('-- the web client')
const bctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const pb = await bctx.newPage(); pb.on('pageerror', (e) => errors.push(e.message))
await pb.goto(`${WEB}/login`); await pb.evaluate((t) => localStorage.setItem('parley.token', t), b.token); await pb.goto(`${WEB}/channels/${g.id}/${tc.id}`); await pb.waitForSelector('[data-member-list]')
ok('bob opens Parley: online', await bobIs(/^Online on web$/))
await pb.evaluate(() => { window.__parleyWs.idleAfter = 800 }); await pb.waitForTimeout(1000); await pb.evaluate(() => window.__parleyWs.checkIdle())
ok('no input for the idle timeout: idle', await bobIs(/^Idle on web$/))
ok('he sees himself as idle too', await pb.waitForFunction(() => /^Idle/.test(document.querySelector('[data-user-panel-bar] [data-presence]')?.getAttribute('title') ?? ''), null, { timeout: 5000 }).then(() => true).catch(() => false))
await pb.evaluate(() => { window.__parleyWs.idleAfter = 10 * 60_000 }); await pb.mouse.move(300, 300); await pb.mouse.move(320, 340)
ok('moving the mouse: online again', await bobIs(/^Online on web$/))
await pb.evaluate(() => { window.__parleyWs.idleAfter = 800 }); await pb.waitForTimeout(1000); await pb.evaluate(() => window.__parleyWs.checkIdle())
ok('idle again before a reconnect', await bobIs(/^Idle on web$/))
await pb.evaluate(() => window.__parleyWs.drop()); await pb.waitForTimeout(2500)
ok('a reconnect while away stays idle (no flash of online)', await bobIs(/^Idle on web$/))
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
