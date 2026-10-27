// Phones: the profile editor has a header bar with a reachable close button (also with a frame and while scrolled),
// effect tiles rest on their thumbnail, and Year in review only offers years with activity and never strands you.
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { WEB, S, reg, call, ok, finish, testContainer } from '../lib.mjs'
const a = await reg('alice')
await call(a.token, 'PATCH', '/users/@me', { profile_frame: 'asset:e2e_frame', bio: `Phone ${S}` })
const browser = await chromium.launch(); const errors = []

console.log('-- profile editor on a phone')
const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage(); m.on('pageerror', (e) => errors.push(e.message))
await m.goto(`${WEB}/login`); await m.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await m.goto(`${WEB}/channels/@me`); await m.waitForSelector('[data-panel-self]'); await m.waitForTimeout(800)
await m.tap('[data-panel-self]'); await m.tap('[data-user-menu-edit]'); await m.waitForSelector('[data-profile-editor]'); await m.waitForTimeout(400)
const reachable = () => m.evaluate(() => {
  const b = [...document.querySelectorAll('[data-edit-profile-close]')].find((x) => x.offsetParent !== null)
  if (!b) return { ok: false, why: 'none visible' }
  const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return { ok: r.top >= 0 && r.right <= innerWidth && r.width >= 40 && (hit === b || b.contains(hit)), r: [r.left, r.top, r.width], hit: hit?.outerHTML.slice(0, 80) }
})
let reach = await reachable()
ok('a header bar with a close button you can tap', reach.ok && await m.locator('[data-edit-profile-header]').isVisible(), JSON.stringify(reach))
await m.evaluate(() => { const s = document.querySelector('[data-profile-editor]'); s.scrollTop = s.scrollHeight })
await m.waitForTimeout(200)
reach = await reachable()
ok('still there after scrolling, even with a frame on the card', reach.ok, JSON.stringify(reach))
await m.tap('[data-edit-profile-header] [data-edit-profile-close]')
ok('and it closes the editor', await m.waitForFunction(() => !document.querySelector('[data-profile-editor]')).then(() => true).catch(() => false))

console.log('-- effect tiles')
const p = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('[data-panel-self]'); await p.waitForTimeout(600)
await p.click('[data-panel-self]'); await p.click('[data-user-menu-edit]'); await p.click('[data-editor-section="effect"]')
const tile = p.locator('[data-layered-option="asset:e2e_sparkle"]')
await tile.waitFor()
ok('a tile rests on the effect\'s thumbnail', (await tile.locator('[data-layered-thumb]').getAttribute('src')).endsWith('/thumbnail.png'))
await tile.hover(); await tile.locator('[data-effect-tile-live] [data-effect-layer]').first().waitFor({ timeout: 3000 }).catch(() => {})
ok('and plays the effect while hovered', await tile.locator('[data-effect-tile-live] [data-effect-layer]').count() >= 1 && await tile.locator('[data-layered-thumb]').evaluate((e) => getComputedStyle(e).opacity) === '0')
await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200)

console.log('-- year in review')
const ch = (await call(a.token, 'POST', '/guilds', { name: `Recap ${S}` })).channels.find((x) => x.kind === 'text')
await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: `this year ${S}` })
const now = new Date().getFullYear()
let rec = await call(a.token, 'GET', '/users/@me/recap')
ok('only years with activity are offered (just this one)', JSON.stringify(rec.years) === JSON.stringify([now]), JSON.stringify(rec.years))
const old = await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: `long ago ${S}` })
execSync(`docker exec ${testContainer('db')} psql -U parley -tAc "UPDATE messages SET created_at = created_at - interval '2 years' WHERE id = '${old.id}'"`)
rec = await call(a.token, 'GET', '/users/@me/recap')
ok('a year you posted in shows up', JSON.stringify(rec.years) === JSON.stringify([now, now - 2]), JSON.stringify(rec.years))
await p.click('[data-control="User Settings"]'); await p.click('[data-open-recap]'); await p.waitForSelector('[data-recap-years]')
ok('the picker lists those years, nothing empty', (await p.locator('[data-recap-year]').allInnerTexts()).join(',') === `${now - 2},${now}`)
await p.click(`[data-recap-year="${now - 2}"]`); await p.waitForSelector('[data-recap-stat="messages"]')
ok('picking an older year shows it', (await p.locator('[data-recap-stat="messages"]').innerText()).startsWith('1'))
ok('and the way back stays', await p.locator(`[data-recap-year="${now}"]`).count() === 1)
await p.click(`[data-recap-year="${now}"]`); await p.waitForTimeout(500)
ok('back to this year', await p.locator(`[data-recap-year="${now}"][aria-pressed="true"]`).count() === 1)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
