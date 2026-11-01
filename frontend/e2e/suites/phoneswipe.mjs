// Phones: swipe gestures like Discord. A right swipe pulls the chat along with the finger and pushes the channel list
// in (a left swipe on the list goes back); short drags spring back; a message swiped left replies; a left swipe
// elsewhere on a server chat opens the member list; settings sections swipe right back to the list.
import { chromium, devices } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Swipe ${S}` }); const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
for (let i = 0; i < 25; i++) await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: `line ${i}` })
const target = await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: 'swipe me to reply' })
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ ...devices['iPhone 13'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await ctx.addInitScript(() => { window.__buzz = []; navigator.vibrate = (ms) => { window.__buzz.push(ms); return true } })
const cdp = await ctx.newCDPSession(p)
const W = 390
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
// Drag from (x0,y0) by (dx,dy) in steps; `hold` keeps the finger down at the end (returns a release function).
const drag = async (x0, y0, dx, dy, { steps = 12, ms = 12, hold = false } = {}) => {
  await touch('touchStart', x0, y0)
  for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + (dx * i) / steps, y0 + (dy * i) / steps); await p.waitForTimeout(ms) }
  const release = async () => { await touch('touchEnd'); await p.waitForTimeout(400) }
  if (hold) return release
  await release()
}
const pane = () => p.evaluate(() => { const nav = document.querySelector('[data-layer="md"]'); const r = nav.getBoundingClientRect(); return getComputedStyle(nav).display !== 'none' && r.left > -5 && r.width > 0 ? 'nav' : 'content' })
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector(`[data-msg-id="${target.id}"]`); await p.waitForTimeout(1500)

console.log('-- chat ⇄ channel list')
ok('starts on the chat', await pane() === 'content')
let release = await drag(60, 400, 110, 4, { hold: true })
const mid = await p.evaluate(() => { const box = document.querySelector('[data-pane-drag]'); const c = document.querySelector('[data-pane-content]').firstElementChild?.getBoundingClientRect(); const n = document.querySelector('[data-layer="md"]').getBoundingClientRect(); return { dragging: !!box, content: Math.round(c?.left ?? -1), nav: Math.round(n.right) } })
ok('the chat follows the finger and the list slides in beside it', mid.dragging && mid.content > 80 && mid.content < 140 && Math.abs(mid.nav - mid.content) <= 2, JSON.stringify(mid))
await release()
ok('a short drag springs back to the chat', await pane() === 'content' && await p.locator('[data-pane-drag]').count() === 0)
await drag(40, 400, 250, 6)
ok('dragging past a third opens the channel list', await pane() === 'nav' && await p.locator('[data-pane-drag]').count() === 0)
await drag(330, 400, -110, 2, { steps: 3, ms: 0 })
ok('on the list, a quick flick left goes back to the chat', await pane() === 'content')
await drag(40, 400, 110, 2, { steps: 3, ms: 0 })
ok('a quick flick right opens the list too', await pane() === 'nav')
await drag(330, 400, -260, 4)
ok('and a long drag left closes it', await pane() === 'content')
await drag(200, 500, 6, -200)
ok('scrolling up and down never moves the panes', await pane() === 'content' && await p.locator('[data-pane-drag]').count() === 0)

console.log('-- swipe a message to reply')
const row = await p.locator(`[data-msg-id="${target.id}"]`).boundingBox()
const ry = row.y + row.height / 2
await p.evaluate(() => { window.__buzz = [] })
release = await drag(300, ry, -50, 2, { hold: true, steps: 6 })
ok('the message follows the finger with a reply arrow', await p.evaluate((id) => { const el = document.querySelector(`[data-msg-id="${id}"]`); return el.hasAttribute('data-swiping') && el.getBoundingClientRect().left < -30 && getComputedStyle(el.querySelector('[data-swipe-reply]')).display === 'flex' }, target.id))
await release()
ok('a short swipe does not reply', await p.locator('[data-reply-banner]').count() === 0 && await pane() === 'content')
await drag(300, ry, -110, 3, { steps: 8 })
ok('swiping past the mark replies to it', await p.locator('[data-reply-banner]').count() === 1 && /Bob/i.test(await p.locator('[data-reply-banner]').innerText()))
ok('with a haptic tick at the mark', (await p.evaluate(() => window.__buzz)).length >= 1)
ok('and the message slides back into place', await p.evaluate((id) => !document.querySelector(`[data-msg-id="${id}"]`).hasAttribute('data-swiping'), target.id))
ok('the channel list did not move', await pane() === 'content')

console.log('-- member list')
await drag(300, 60, -150, 2)
ok('a left swipe on the header opens the member list', await p.locator('[data-member-list]').count() > 0 && await p.locator('[data-member-list]').first().isVisible())
await drag(60, 400, 150, 2)
ok('and a right swipe closes it (instead of opening the channel list)', !(await p.locator('[data-member-list]').first().isVisible().catch(() => false)) && await pane() === 'content')

console.log('-- settings')
await drag(40, 400, 250, 6)
await p.click('[data-user-panel] button[title="User Settings"], [data-user-panel] [aria-label="User Settings"]').catch(async () => { await p.evaluate(() => window.__parleyOpenSettings?.()) })
await p.waitForSelector('[data-settings-view="menu"]', { timeout: 5000 }).catch(() => {})
await p.locator('[data-settings-tab]').nth(1).click(); await p.waitForSelector('[data-settings-view="section"]')
await drag(30, 400, 260, 4)
ok('a settings section swipes right back to the list', await p.locator('[data-settings-view="menu"]').count() === 1)
ok('without moving the app behind it', await pane() === 'nav' && await p.locator('[data-pane-drag]').count() === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
