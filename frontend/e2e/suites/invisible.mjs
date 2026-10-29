// Invisible means offline to everyone else: no "online", no device (phone, desktop, VR) and no away state, in READY,
// in presence updates, in profiles and member lists, and in the app's dots. Switching to Invisible takes effect at
// once, and switching back shows the person again, on the device they're on.
import { chromium } from 'playwright'
import { WEB, API_ORIGIN, S, reg, call, ok, openDms, finish } from '../lib.mjs'

const a = await reg('alice'), b = await reg('bob')
await openDms(a, b)
await call(a.token, 'POST', '/users/@me/relationships', { username: b.user.username }); await call(b.token, 'PUT', `/users/@me/relationships/${a.user.id}`)
const g = await call(a.token, 'POST', '/guilds', { name: `Invisible ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const WS = API_ORIGIN.replace(/^http/, 'ws') + '/ws'

/** A socket that keeps every event it receives. */
const sock = (token, platform) => new Promise((resolve) => {
  const events = []; const ws = new WebSocket(`${WS}?token=${encodeURIComponent(token)}&platform=${platform}`)
  ws.onmessage = (m) => { try { const e = JSON.parse(m.data); events.push(e); if (e.t === 'READY') resolve({ ws, events, ready: e.d }) } catch { /* not json */ } }
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('-- set to Invisible, signed in on a phone')
await call(b.token, 'PATCH', '/users/@me', { status: 'invisible' })
const bob = await sock(b.token, 'mobile'); await sleep(500)
const al = await sock(a.token, 'web'); await sleep(300)
ok("Alice's READY doesn't list Bob as online", !al.ready.online.includes(b.user.id), JSON.stringify(al.ready.online))
ok('nor his devices', !(b.user.id in (al.ready.platforms ?? {})), JSON.stringify(al.ready.platforms))
ok('nor as away', !(al.ready.idle ?? []).includes(b.user.id))
const prof = await call(a.token, 'GET', `/users/${b.user.id}`)
ok("his profile's status reads offline, not invisible", prof.status === 'offline', prof.status)
const members = await call(a.token, 'GET', `/guilds/${g.id}/members`)
ok('so does the member list', JSON.stringify(members).includes('"invisible"') === false)
ok("Bob's own account still says Invisible", (await call(b.token, 'GET', '/users/@me')).status === 'invisible')

console.log('-- switching')
al.events.length = 0
await call(b.token, 'PATCH', '/users/@me', { status: 'online' }); await sleep(700)
const up = al.events.find((e) => e.t === 'PRESENCE_UPDATE' && e.d.user_id === b.user.id)
ok('back to Online: Alice sees him online, on mobile', up?.d.online === true && up.d.platforms.includes('mobile'), JSON.stringify(up?.d))
al.events.length = 0
await call(b.token, 'PATCH', '/users/@me', { status: 'invisible' }); await sleep(700)
const down = al.events.find((e) => e.t === 'PRESENCE_UPDATE' && e.d.user_id === b.user.id)
ok('to Invisible again: at once offline, no devices, not away', down?.d.online === false && down.d.platforms.length === 0 && !down.d.idle, JSON.stringify(down?.d))

console.log('-- in the app')
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}`); await p.waitForSelector('[data-member-list]'); await p.waitForTimeout(1000)
const row = p.locator('[data-member-list] button:has-text("Bob")').first()
ok('the member list puts him under Offline', await p.locator('[data-member-list] h3:has-text("Offline")').count() === 1 && (await p.locator('[data-member-list]').innerText()).indexOf('Bob') > (await p.locator('[data-member-list]').innerText()).indexOf('OFFLINE'))
ok('with a plain offline dot, no phone', await row.locator('[data-presence="mobile"]').count() === 0)
await p.goto(`${WEB}/channels/@me`); await p.waitForTimeout(800)
await p.click('button:has-text("All")').catch(() => {}); await p.waitForTimeout(400)
ok('Friends shows him Offline', (await p.locator('main [data-motion-row]:has-text("Bob") [data-friend-sub]').first().textContent()).trim() === 'Offline')

bob.ws.close(); al.ws.close()
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
