// Phones: tapping your panel slides your profile up as a full-width sheet (Discord mobile), with a full-width Edit
// Profile button and a floating bar for status, accounts and settings; it slides away when closed or dragged down.
import { chromium } from 'playwright'
import { WEB, reg, call, ok, finish, openDms as openDmsFor } from '../lib.mjs'
const a = await reg('alice')
await call(a.token, 'PATCH', '/users/@me', { bio: 'sheet bio' })

const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('[data-user-panel]')

console.log('-- opening')
await p.locator('[data-panel-self]').tap()
await p.waitForSelector('[data-profile-sheet]')
ok('no desktop self menu on a phone', await p.locator('[data-user-menu]').count() === 0)
const mid = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('[data-profile-sheet]')).transform).m42)
ok('it slides up from the bottom', mid > 0, String(mid))
await p.waitForTimeout(450)
const box = await p.locator('[data-profile-sheet]').boundingBox()
ok('full width, from near the top to the bottom', box && box.x === 0 && Math.abs(box.width - 390) < 1 && box.y <= 12 && Math.abs(box.y + box.height - 844) < 1, JSON.stringify(box))
ok('your profile is in it', await p.locator('[data-profile-sheet] >> text=sheet bio').count() > 0)
const edit = await p.locator('[data-profile-sheet] [data-full-edit-profile]').boundingBox()
ok('Edit Profile spans the card', edit && edit.width > 250, JSON.stringify(edit))
await p.screenshot({ path: 'selfsheet-open.png' })

console.log('-- dock')
ok('the floating bar has status, accounts and settings', await p.locator('[data-self-dock-status]').isVisible() && await p.locator('[data-self-dock-accounts]').isVisible() && await p.locator('[data-self-dock-settings]').isVisible())
await p.locator('[data-self-dock-status]').tap(); await p.waitForSelector('[data-self-dock-panel="status"]')
await p.locator('[data-status-durations="dnd"]').tap(); await p.locator('[data-status-duration-list="dnd"] [data-status-for="3600"]').tap()
await p.waitForFunction(() => !document.querySelector('[data-self-dock-panel]'))
let me; for (let i = 0; i < 20; i++) { me = await call(a.token, 'GET', '/users/@me'); if (me.status === 'dnd') break; await p.waitForTimeout(150) }
ok('status is set from the bar, for a while', me.status === 'dnd' && !!me.status_expires_at, JSON.stringify({ s: me.status, e: me.status_expires_at }))
await p.locator('[data-self-dock-accounts]').tap(); await p.waitForSelector('[data-self-dock-panel="accounts"] [data-manage-accounts]')
ok('accounts open the switcher', true)
await p.locator('[data-self-dock-backdrop]').tap({ position: { x: 20, y: 100 } }); await p.waitForFunction(() => !document.querySelector('[data-self-dock-panel]'))

console.log('-- closing')
await p.locator('[data-full-profile-close]').tap()
await p.waitForTimeout(80)
ok('X slides it down', await p.locator('[data-profile-sheet][data-closing]').count() === 1)
await p.waitForFunction(() => !document.querySelector('[data-profile-sheet]'))
ok('and it goes', true)
await p.locator('[data-panel-self]').tap(); await p.waitForSelector('[data-profile-sheet]'); await p.waitForTimeout(450)
const cdp = await p.context().newCDPSession(p)
const touch = async (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 200, y }] })
const sheetTop = async () => (await p.locator('[data-profile-sheet]').boundingBox()).y
const top0 = await sheetTop()
// A slow pull (a quick flick would dismiss it).
await touch('touchStart', 300); for (const y of [315, 330, 345, 360]) { await touch('touchMove', y); await p.waitForTimeout(80) }
const pulled = await sheetTop()
ok('pulling down from the top drags the sheet with the finger', pulled > top0 + 40, JSON.stringify({ top0, pulled }))
await touch('touchEnd', 360); await p.waitForTimeout(350)
ok('a short pull springs back', await p.locator('[data-profile-sheet]').count() === 1 && Math.abs((await sheetTop()) - top0) < 1)
await touch('touchStart', 300); for (let y = 330; y <= 540; y += 30) await touch('touchMove', y); await touch('touchEnd', 540)
await p.waitForFunction(() => !document.querySelector('[data-profile-sheet]'))
ok('swiping down dismisses it', true)
await p.locator('[data-panel-self]').tap(); await p.waitForSelector('[data-profile-sheet]'); await p.waitForTimeout(450)
await p.evaluate(() => { const el = document.querySelector('[data-profile-sheet-scroll]'); el.querySelector('[data-profile-tabs]').insertAdjacentHTML('afterend', '<div style="height:1200px" data-filler></div>') })
await touch('touchStart', 600); for (let y = 580; y >= 200; y -= 40) await touch('touchMove', y); await touch('touchEnd', 200); await p.waitForTimeout(400)
const scrolled = await p.evaluate(() => document.querySelector('[data-profile-sheet-scroll]').scrollTop)
ok('swiping up scrolls what is in it, while the sheet stays', scrolled > 100 && Math.abs((await sheetTop()) - top0) < 1, String(scrolled))
await touch('touchStart', 300); for (let y = 330; y <= 540; y += 30) await touch('touchMove', y)
ok('scrolled down, a pull scrolls back instead of moving the sheet', Math.abs((await sheetTop()) - top0) < 1)
await touch('touchEnd', 540); await p.waitForTimeout(300)
ok('and it stays open', await p.locator('[data-profile-sheet]').count() === 1)
const card = await p.locator('[data-profile-sheet] [data-profile-card]').boundingBox(), sh = await p.locator('[data-profile-sheet]').boundingBox()
ok('the profile card is the sheet, not a box inside it', card && Math.abs(card.x - sh.x) < 1 && Math.abs(card.width - sh.width) < 1 && Math.abs(card.y - sh.y) < 1 && Math.abs(card.height - sh.height) < 1, JSON.stringify({ card, sh }))
// Let the earlier scroll come to rest (a tap during momentum only stops it, as on a real phone).
await p.evaluate(() => { document.querySelector('[data-profile-sheet-scroll]').scrollTop = 0 }); await p.waitForTimeout(500)
await p.locator('[data-self-dock-settings]').tap(); await p.waitForSelector('[data-settings-frame], [role=dialog][aria-label*="Settings"]', { timeout: 5000 }).catch(() => {})
ok('Settings opens your settings', await p.locator('[data-profile-sheet]').count() === 0 && await p.locator('[data-settings-frame]').count() > 0)

console.log('-- frames')
// A frame reaches past the card (staples, rails): in the sheet it must stay whole, on screen and not cut by the sheet.
await call(a.token, 'PATCH', '/users/@me', { profile_frame: 'asset:e2e_frame', profile_effect: '', theme_primary: '#5b2a86', theme_accent: '#b03060' })
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('[data-user-panel]')
await p.locator('[data-panel-self]').tap(); await p.waitForSelector('[data-profile-sheet] [data-frame-room]'); await p.waitForTimeout(700)
const framed = await p.evaluate(() => {
  const sheet = document.querySelector('[data-profile-sheet]'), card = document.querySelector('[data-profile-sheet] [data-profile-card]')
  const layers = [...document.querySelectorAll('[data-profile-sheet] [data-frame-layer]')].map((e) => e.getBoundingClientRect())
  const s = sheet.getBoundingClientRect(), c = card.getBoundingClientRect()
  const clip = getComputedStyle(sheet).clipPath
  const fb = document.querySelector('[data-profile-sheet] [data-profile-frame-layers]').getBoundingClientRect()
  return { box: [fb.left, fb.top, fb.right, fb.bottom], frame: card.dataset.profileFrame, s: [s.left, s.top, s.right, s.bottom], c: [c.left, c.top, c.right, c.bottom], clip, layers: layers.length, past: layers.filter((r) => r.left < s.left - 1 || r.right > s.right + 1 || r.bottom > s.bottom + 1).length }
})
ok('the frame is on the sheet', framed.frame === 'asset:e2e_frame', JSON.stringify(framed))
ok('the card fills the sheet edge to edge', Math.abs(framed.c[0] - framed.s[0]) < 1 && Math.abs(framed.c[2] - framed.s[2]) < 1 && Math.abs(framed.c[3] - framed.s[3]) < 1, JSON.stringify(framed))
ok('the sheet cuts the frame at its sides and bottom, and lets it reach over the top', /^inset\(-\d+px 0(px)?( 0(px)?){0,2}\)$/.test(framed.clip), framed.clip)
ok('the frame reaches past the sheet sideways (so it is cut there)', framed.past > 0, JSON.stringify(framed))
ok('its bottom edge lies below the sheet, out of sight', framed.box[3] > framed.s[3] + 100, JSON.stringify(framed))
await p.screenshot({ path: 'selfsheet-frame.png' })
await p.locator('[data-full-profile-close]').tap(); await p.waitForFunction(() => !document.querySelector('[data-profile-sheet]'))

console.log('-- someone else\'s card')
const b = await reg('bob'); await openDmsFor(a, b)
const dmc = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
await call(b.token, 'POST', `/channels/${dmc.id}/messages`, { content: 'hi from bob' })
await p.goto(`${WEB}/channels/@me/${dmc.id}`); await p.waitForSelector('text=hi from bob'); await p.waitForTimeout(500)
await p.locator('[data-msg-author]').first().tap()
await p.waitForSelector('[data-profile-sheet]'); await p.waitForTimeout(400)
const ct = (await p.locator('[data-profile-sheet]').boundingBox()).y
await touch('touchStart', ct + 60); for (let y = ct + 90; y <= ct + 300; y += 30) await touch('touchMove', y); await touch('touchEnd', ct + 300)
await p.waitForFunction(() => !document.querySelector('[data-profile-sheet]'))
ok('a profile card on a phone also swipes away', true)

console.log('-- desktop unchanged')
const d = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
await d.goto(`${WEB}/login`); await d.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await d.goto(`${WEB}/channels/@me`); await d.waitForSelector('[data-panel-self]'); await d.locator('[data-panel-self]').click()
ok('desktop still opens the self menu', await d.locator('[data-user-menu]').count() === 1 && await d.locator('[data-profile-sheet]').count() === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); finish()
