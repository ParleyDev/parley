// Menus on a phone are a bottom sheet laid out like Discord mobile's: the quick reactions as big round buttons, the
// rest as rounded cards of rows with their icons in one column; submenus open as a page with a way back. The sheet
// starts at no more than about half the screen, grows when pulled up, and closes with a swipe down, a tap outside
// or the back button.
import { chromium, devices } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Sheet ${S}` }); const ch = g.channels.find((x) => x.kind === 'text')
const msg = await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: 'hold me' })
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ ...devices['iPhone 13'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
const cdp = await ctx.newCDPSession(p)
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
const hold = async (sel) => { const r = await p.locator(sel).first().boundingBox(); const x = r.x + Math.min(r.width / 2, 40), y = r.y + r.height / 2; await touch('touchStart', x, y); await p.waitForTimeout(650); await touch('touchEnd'); await p.waitForTimeout(450) }
// A finger dragging from (x, y) by dy in steps, then lifting.
const drag = async (x, y, dy, steps = 8) => { await touch('touchStart', x, y); for (let i = 1; i <= steps; i++) { await touch('touchMove', x, y + (dy * i) / steps); await p.waitForTimeout(16) } await touch('touchEnd'); await p.waitForTimeout(450) }
const sheet = '[data-menu-sheet]'
const open = async () => { await hold(`[data-msg-id="${msg.id}"] .msg-content`); await p.waitForSelector(sheet) }
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector(`[data-msg-id="${msg.id}"]`); await p.waitForTimeout(1200)
const H = await p.evaluate(() => innerHeight)

console.log('-- layout')
await open(); await p.waitForTimeout(400)
const lay = await p.evaluate(() => {
  const s = document.querySelector('[data-menu-sheet]')
  const cards = [...s.querySelectorAll('.sheet-card')]
  const icons = [...s.querySelectorAll('[data-menu-item] > span:first-child')].map((e) => Math.round(e.getBoundingClientRect().left))
  const labels = [...s.querySelectorAll('[data-menu-item] > span.flex-1')].map((e) => Math.round(e.getBoundingClientRect().left))
  const quick = [...s.querySelectorAll('[data-quick-row] > button')].map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), round: getComputedStyle(b).borderRadius } })
  return { cards: cards.length, icons: new Set(icons).size, labels: new Set(labels).size, quick, h: s.getBoundingClientRect().height, top: s.getBoundingClientRect().top }
})
ok('the actions come in several cards', lay.cards >= 3, String(lay.cards))
ok('every icon and every label lines up in one column', lay.icons === 1 && lay.labels === 1, JSON.stringify(lay))
ok('the quick reactions are big round buttons', lay.quick.length > 0 && lay.quick.every((q) => q.w >= 48 && q.round.startsWith('9999')), JSON.stringify(lay.quick))
ok('the sheet takes no more than about half the screen', lay.h <= H * 0.56, `${lay.h} of ${H}`)
await p.screenshot({ path: 'phonesheet-message.png' })

console.log('-- pulling it up, swiping it away')
const box = await p.locator(sheet).boundingBox()
await drag(195, box.y + 12, -150)
const tall = await p.locator(sheet).boundingBox()
ok('pulled up, it grows to show more', tall.height > box.height + 40 && tall.height <= H * 0.89, `${box.height} -> ${tall.height}`)
await p.evaluate((s) => { document.querySelector(s).scrollTop = 0 }, sheet)
await drag(195, tall.y + 12, 260)
ok('a swipe down closes it', await p.locator(sheet).count() === 0)
await open()
const b2 = await p.locator(sheet).boundingBox()
await drag(195, b2.y + 12, 50)
ok('a short pull springs back', await p.locator(sheet).count() === 1 && Math.abs((await p.locator(sheet).boundingBox()).y - b2.y) < 2)

console.log('-- submenus')
await p.click(`${sheet} [data-menu-item="Remind Me"]`); await p.waitForTimeout(250)
ok('a submenu opens as its own page', await p.locator(`${sheet} [data-menu-page="Remind Me"]`).count() === 1 && await p.locator(`${sheet} [data-menu-item="Copy Text"]`).count() === 0)
const indent = await p.evaluate(() => { const s = document.querySelector('[data-menu-sheet] [data-menu-item] > span.flex-1').getBoundingClientRect().left, c = document.querySelector('[data-menu-sheet] .sheet-card').getBoundingClientRect().left; return s - c })
ok('its rows without icons start at the edge of the card (no empty icon column)', indent <= 20, String(indent))
await p.screenshot({ path: 'phonesheet-submenu.png' })
await p.click(`${sheet} [data-menu-back]`); await p.waitForTimeout(200)
ok('and Back returns to the menu', await p.locator(`${sheet} [data-menu-item="Copy Text"]`).count() === 1)

console.log('-- the back button')
await p.click(`${sheet} [data-menu-item="Remind Me"]`); await p.waitForTimeout(200)
const back = () => p.evaluate(() => window.dispatchEvent(new CustomEvent('parley:back', { cancelable: true })))
ok('back from a submenu returns to the menu (and is handled)', (await back()) === false && await p.locator(`${sheet} [data-menu-item="Copy Text"]`).count() === 1)
await back(); await p.waitForTimeout(350)
ok('back again closes the sheet', await p.locator(sheet).count() === 0)

console.log('-- other menus')
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector(`[data-guild-icon="${g.id}"]`); await p.waitForTimeout(800)
await hold(`[data-guild-icon="${g.id}"]`)
ok('a server menu is a sheet of cards too', await p.locator(`${sheet} .sheet-card`).count() >= 1)
await p.screenshot({ path: 'phonesheet-server.png' })
await p.locator('[data-menu-sheet-backdrop]').click({ position: { x: 20, y: 20 } }); await p.waitForTimeout(350)
ok('a tap outside closes it', await p.locator(sheet).count() === 0)

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
