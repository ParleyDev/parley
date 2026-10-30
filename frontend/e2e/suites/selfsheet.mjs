// Phones: tapping your panel slides your profile up as a full-width sheet (Discord mobile), with a full-width Edit
// Profile button and a floating bar for status, accounts and settings; it slides away when closed or dragged down.
import { chromium } from 'playwright'
import { WEB, reg, call, ok, finish } from '../lib.mjs'
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
await touch('touchStart', 300); for (let y = 320; y <= 500; y += 30) await touch('touchMove', y)
const dragged = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('[data-profile-sheet]')).transform).m42)
ok('it follows a finger down', dragged > 120, String(dragged))
await touch('touchEnd', 500)
await p.waitForFunction(() => !document.querySelector('[data-profile-sheet]'))
ok('dragged far enough, it closes', true)
await p.locator('[data-panel-self]').tap(); await p.waitForSelector('[data-profile-sheet]'); await p.waitForTimeout(450)
await touch('touchStart', 300); await touch('touchMove', 340); await touch('touchEnd', 340); await p.waitForTimeout(300)
ok('a short drag springs back', await p.locator('[data-profile-sheet]').count() === 1 && await p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('[data-profile-sheet]')).transform).m42) === 0)
await p.locator('[data-self-dock-settings]').tap(); await p.waitForSelector('[data-settings-frame], [role=dialog][aria-label*="Settings"]', { timeout: 5000 }).catch(() => {})
ok('Settings opens your settings', await p.locator('[data-profile-sheet]').count() === 0 && await p.locator('[data-settings-frame]').count() > 0)

console.log('-- frames')
// A frame reaches past the card (staples, rails): in the sheet it must stay whole, on screen and not cut by the sheet.
await call(a.token, 'PATCH', '/users/@me', { profile_frame: 'asset:e2e_frame', profile_effect: '', theme_primary: '#5b2a86', theme_accent: '#b03060' })
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('[data-user-panel]')
await p.locator('[data-panel-self]').tap(); await p.waitForSelector('[data-profile-sheet] [data-frame-room]'); await p.waitForTimeout(700)
const framed = await p.evaluate(() => {
  const room = document.querySelector('[data-profile-sheet] [data-frame-room]'), r = room.getBoundingClientRect(), cut = []
  if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1) cut.push('viewport')
  // Up to the sheet's fixed backdrop: the app layout behind it can't clip it.
  for (let el = room.parentElement; el && el !== document.body; el = el.parentElement) {
    const cs = getComputedStyle(el)
    if (/(hidden|auto|scroll|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) { const e = el.getBoundingClientRect(); if (r.left < e.left - 1 || r.right > e.right + 1 || r.top < e.top - 1) cut.push(el.className.split(' ').slice(0, 3).join('.')) }
    if (cs.position === 'fixed') break
  }
  const card = document.querySelector('[data-profile-sheet] [data-profile-card]').getBoundingClientRect()
  return { cut, pad: parseFloat(getComputedStyle(room).paddingTop), room: [r.left, r.top, r.right], card: [card.left, card.top, card.right], frame: document.querySelector('[data-profile-sheet] [data-profile-card]').dataset.profileFrame }
})
ok('the frame is on your card in the sheet', framed.frame === 'asset:e2e_frame', JSON.stringify(framed))
ok('the whole framed area is on screen and not cut by the sheet', framed.cut.length === 0 && framed.pad > 10, JSON.stringify(framed))
ok('the card sits inside the frame room', framed.card[0] >= framed.room[0] && framed.card[2] <= framed.room[2] && framed.card[1] >= framed.room[1], JSON.stringify(framed))
await p.screenshot({ path: 'selfsheet-frame.png' })
await p.locator('[data-full-profile-close]').tap(); await p.waitForFunction(() => !document.querySelector('[data-profile-sheet]'))

console.log('-- desktop unchanged')
const d = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
await d.goto(`${WEB}/login`); await d.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await d.goto(`${WEB}/channels/@me`); await d.waitForSelector('[data-panel-self]'); await d.locator('[data-panel-self]').click()
ok('desktop still opens the self menu', await d.locator('[data-user-menu]').count() === 1 && await d.locator('[data-profile-sheet]').count() === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); finish()
