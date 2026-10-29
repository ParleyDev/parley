// Scrollbars like Discord's: hidden until the pointer is over their area (or the reader scrolls it), with their room
// always kept so nothing moves when they appear. The chat's message list has the wide one (16px, 8px thumb), everything
// else the thin one (8px, 4px thumb). Checked on the DM view, the DM list, a server's channel list, the member list and
// the DM profile panel: the bar's strip is blank, then drawn on hover, and widths don't change.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, openDms, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const others = []
for (let i = 0; i < 18; i++) others.push(await reg(`pal${i}`))
await openDms(a, b, ...others)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
for (const o of others) await call(a.token, 'POST', '/users/@me/channels', { recipient_id: o.user.id })
for (let i = 0; i < 40; i++) await call(i % 2 ? b.token : a.token, 'POST', `/channels/${dm.id}/messages`, { content: `message ${i} ${S}` })
await call(b.token, 'PATCH', '/users/@me', { bio: Array.from({ length: 48 }, (_, i) => `Line ${i + 1}`).join('\n').slice(0, 380) })
const g = await call(a.token, 'POST', '/guilds', { name: `Scroll ${S}` })
for (let i = 0; i < 30; i++) await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: `room-${i}`, kind: 'text' })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const o of others) await call(o.token, 'POST', `/invites/${inv.code}`)
const text = g.channels.find((c) => c.kind === 'text')

// Playwright hides scrollbars in headless Chromium unless asked not to.
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] }); const errors = []
const shots = process.env.SHOTS
const p = await (await browser.newContext({ viewport: { width: 1440, height: 600 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)

/** The scroll box's own vertical bar strip: blank (one colour) or with a thumb drawn in it. */
const strip = async (sel, name) => {
  const box = await p.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.right - (el.offsetWidth - el.clientWidth), y: r.top, w: el.offsetWidth - el.clientWidth, h: r.height, gutter: el.offsetWidth - el.clientWidth, client: el.clientWidth, overflow: el.scrollHeight > el.clientHeight } })
  await p.mouse.move(5, 300); await p.waitForTimeout(250)
  const before = await p.screenshot({ clip: { x: box.x, y: box.y, width: Math.max(1, box.w), height: box.h } })
  const clientOut = await p.locator(sel).first().evaluate((el) => el.clientWidth)
  if (shots) await p.screenshot({ path: `${shots}/scroll-${name}-idle.png` })
  const r = await p.locator(sel).first().boundingBox()
  await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await p.waitForTimeout(250)
  const after = await p.screenshot({ clip: { x: box.x, y: box.y, width: Math.max(1, box.w), height: box.h } })
  const clientIn = await p.locator(sel).first().evaluate((el) => el.clientWidth)
  if (shots) await p.screenshot({ path: `${shots}/scroll-${name}-hover.png` })
  return { ...box, changed: !before.equals(after), clientOut, clientIn }
}

const check = async (label, sel, gutter, name) => {
  const s = await strip(sel, name)
  ok(`${label}: overflows, and its ${gutter}px bar room is always there`, s.overflow && s.gutter === gutter, JSON.stringify(s))
  ok(`${label}: the bar appears only on hover, with no layout shift`, s.changed && s.clientOut === s.clientIn, JSON.stringify({ changed: s.changed, out: s.clientOut, in: s.clientIn }))
}

console.log('-- DM view')
await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector(`text=message 39 ${S}`); await p.waitForTimeout(1200)
await check('chat message list (16px)', '[data-message-list]', 16, 'chat')
await check('DM list (8px)', '[data-dm-list]', 8, 'dmlist')
await check('profile panel (8px)', '[data-dm-profile] [data-profile-scroll]', 8, 'profile')

console.log('-- while scrolling, without hover')
await p.mouse.move(5, 300)
const listBox = await p.locator('[data-message-list]').boundingBox()
await p.mouse.move(listBox.x + 50, listBox.y + 50); await p.mouse.wheel(0, -300); await p.mouse.move(5, 300); await p.waitForTimeout(100)
ok('scrolling the list (wheel) shows its bar for a moment', await p.locator('[data-message-list].scrolling').count() === 1)
await p.waitForTimeout(1300)
ok('and it goes again about a second later', await p.locator('[data-message-list].scrolling').count() === 0)
await p.evaluate(() => { document.querySelector('[data-message-list]').scrollTop -= 200 }); await p.waitForTimeout(50)
ok('a scroll the app makes itself (no reader input) does not show it', await p.locator('[data-message-list].scrolling').count() === 0)

console.log('-- server')
await p.goto(`${WEB}/channels/${g.id}/${text.id}`); await p.waitForSelector('[data-member-list]'); await p.waitForTimeout(1000)
await check('channel list (8px)', '[data-channel-list]', 8, 'channels')
await check('member list (8px)', '[data-member-list]', 8, 'members')

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
