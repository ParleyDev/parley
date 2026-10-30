// Profile frames reach past the card (staples over the top and bottom, rails at the sides). Everywhere a framed card
// shows (user menu, popout, DM profile panel, full profile, settings preview) the whole framed area must be on
// screen and not clipped by a scroll box or modal, and the user menu must not cover the user panel.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish, openDms } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
await openDms(a, b)
await call(a.token, 'PATCH', '/users/@me', { profile_frame: 'asset:e2e_frame', bio: `Framed ${S}`, theme_primary: '#5b2a86', theme_accent: '#b03060' })
const g = await call(a.token, 'POST', '/guilds', { name: `Frames ${S}` }); const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const dm = await call(b.token, 'POST', '/users/@me/channels', { recipient_id: a.user.id })
const browser = await chromium.launch(); const errors = []
const mk = async (u, path, viewport = { width: 1400, height: 900 }) => {
  const p = await (await browser.newContext({ viewport })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}${path}`); await p.waitForTimeout(1200)
  return p
}
/** The framed area within `scope`: fully inside the viewport and every clipping ancestor. */
const unclipped = (p, scope) => p.evaluate((scope) => {
  const room = document.querySelector(`${scope} [data-frame-room], ${scope}[data-frame-room]`)
  if (!room) return { ok: false, why: 'no frame room' }
  const r = room.getBoundingClientRect(), cut = []
  if (r.top < -1 || r.left < -1 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1) cut.push('viewport')
  let fixed = false
  for (let el = room.parentElement; el && el !== document.body; el = el.parentElement) {
    const cs = getComputedStyle(el)
    // Past a fixed-position box, only ancestors that form a containing block (transform, filter, contain) can clip it.
    const contains = cs.transform !== 'none' || cs.filter !== 'none' || /paint|strict|content/.test(cs.contain)
    if (/(hidden|auto|scroll|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY) && (!fixed || contains)) {
      const e = el.getBoundingClientRect()
      // A scroll box may scroll the frame into view, but not cut it off sideways or above its top.
      if (r.left < e.left - 1 || r.right > e.right + 1 || r.top < e.top + (el.scrollTop ? -el.scrollTop : 0) - 1) cut.push(el.tagName + '.' + el.className.split(' ').slice(0, 3).join('.'))
    }
    if (cs.position === 'fixed') fixed = true
  }
  const pad = parseFloat(getComputedStyle(room).paddingTop)
  return { ok: cut.length === 0 && pad > 10, cut, pad, r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] }
}, scope)

console.log('-- user menu')
const pa = await mk(a, `/channels/${g.id}/${ch.id}`)
await pa.click('[data-panel-self]'); await pa.waitForSelector('[data-user-panel] [data-frame-room] [data-profile-frame-layers]'); await pa.waitForTimeout(400)
let u = await unclipped(pa, '[data-user-panel]')
ok('the menu makes room for its frame and stays on screen', u.ok, JSON.stringify(u))
ok('its bottom staple stays clear of the user panel', await pa.evaluate(() => document.querySelector('[data-frame-room]').getBoundingClientRect().bottom <= document.querySelector('[data-user-panel]').getBoundingClientRect().top + 1))
const bgs = () => pa.evaluate(() => { const room = document.querySelector('[data-user-panel] [data-frame-wrap]'); const card = getComputedStyle(room.querySelector('[data-user-menu]')); return { room: getComputedStyle(room).backgroundColor, card: card.backgroundImage !== 'none' ? card.backgroundImage.slice(0, 40) : card.backgroundColor } })
await pa.evaluate(() => { document.documentElement.dataset.palette = 'aurora'; document.documentElement.dataset.seeThrough = '' }); await pa.waitForTimeout(100)
let bg = await bgs()
ok('see-through palettes: the frame\'s room stays transparent', bg.room === 'rgba(0, 0, 0, 0)', JSON.stringify(bg))
ok('while the menu card itself keeps its solid surface (its own colour or profile theme)', bg.card !== 'rgba(0, 0, 0, 0)', JSON.stringify(bg))
await pa.evaluate(() => { delete document.documentElement.dataset.palette; delete document.documentElement.dataset.seeThrough })
await pa.hover('[data-status-menu]'); await pa.waitForSelector('[data-status-option="idle"]')
await pa.waitForTimeout(250)
const fly = await pa.evaluate(() => { const panel = document.querySelector('[data-status-option="idle"]').closest('[data-flyout-panel]'), card = document.querySelector('[data-user-menu]').getBoundingClientRect(); const box = panel.parentElement; return { gap: Math.round(panel.getBoundingClientRect().left - card.right), boxBg: getComputedStyle(box).backgroundColor } })
ok('flyouts open just beside the menu card (6px)', fly.gap >= 4 && fly.gap <= 8, JSON.stringify(fly))
await pa.evaluate(() => { document.documentElement.dataset.palette = 'aurora'; document.documentElement.dataset.seeThrough = '' }); await pa.waitForTimeout(50)
ok('and nothing but the panel is painted in see-through palettes', await pa.evaluate(() => getComputedStyle(document.querySelector('[data-flyout-panel]').parentElement).backgroundColor) === 'rgba(0, 0, 0, 0)')
await pa.hover('[data-status-option="idle"]'); await pa.waitForSelector('[data-status-duration-list="idle"]')
ok('same for the durations list', await pa.evaluate(() => getComputedStyle(document.querySelector('[data-status-duration-list="idle"]').parentElement).backgroundColor) === 'rgba(0, 0, 0, 0)')
await pa.evaluate(() => { delete document.documentElement.dataset.palette; delete document.documentElement.dataset.seeThrough })
await pa.mouse.click(1000, 300); await pa.waitForTimeout(200)
ok('clicking elsewhere closes the menu', await pa.locator('[data-user-menu]').count() === 0)

console.log('-- popout')
const pb = await mk(b, `/channels/${g.id}/${ch.id}`)
await pb.click(`[data-member-row="${a.user.id}"]`); await pb.waitForSelector('[data-profile-popout] [data-profile-frame-layers]'); await pb.waitForTimeout(400)
u = await unclipped(pb, '[data-profile-popout]')
ok('the popout is placed with its frame on screen', u.ok, JSON.stringify(u))
await pb.evaluate(() => { document.documentElement.dataset.palette = 'sunset' }); await pb.waitForTimeout(100)
ok('and its frame room is transparent in see-through palettes', await pb.evaluate(() => getComputedStyle(document.querySelector('[data-profile-popout] [data-frame-wrap]')).backgroundColor) === 'rgba(0, 0, 0, 0)')
await pb.evaluate(() => { delete document.documentElement.dataset.palette; delete document.documentElement.dataset.seeThrough })
// The member list sits at the right edge: the popout opens to its left, frame included.
ok('the frame does not hang off the right edge', u.r && u.r[2] <= 1400)
await pb.keyboard.press('Escape')

console.log('-- DM profile panel')
await pb.goto(`${WEB}/channels/@me/${dm.id}`); await pb.waitForSelector('[data-dm-profile] [data-profile-frame-layers]'); await pb.waitForTimeout(500)
u = await unclipped(pb, '[data-dm-profile]')
ok('the side panel leaves room for the frame (not cut off at the top or sides)', u.ok, JSON.stringify(u))

console.log('-- full profile')
await pb.click('[data-dm-profile] [data-view-full-profile]'); await pb.waitForSelector('[data-full-profile] [data-profile-frame-layers]'); await pb.waitForTimeout(500)
// The full profile's frame reaches over the window's edge (Discord does this): every frame image must be on screen
// and nothing between it and the page may clip it.
const fr = () => pb.evaluate(() => {
  const imgs = [...document.querySelectorAll('[data-full-profile] [data-frame-layer^="front_staple"]')]
  const cut = []
  for (const im of imgs) {
    const r = im.getBoundingClientRect()
    if (r.top < -1 || r.bottom > innerHeight + 1 || r.left < -1 || r.right > innerWidth + 1) cut.push('viewport:' + im.dataset.frameLayer)
    for (let el = im.closest('[data-profile-frame-layers]').parentElement; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el)
      if (/(hidden|auto|scroll|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) { const e = el.getBoundingClientRect(); if (r.top < e.top - 1 || r.bottom > e.bottom + 1) cut.push(im.dataset.frameLayer + ' in ' + el.className.split(' ').slice(0, 3).join('.')) }
      if (cs.position === 'fixed') break
    }
  }
  return { ok: imgs.length > 0 && cut.length === 0, n: imgs.length, cut }
})
u = await fr()
ok('the full profile shows the whole frame', u.ok, JSON.stringify(u))
const full = await pb.evaluate(() => { const box = document.querySelector('[data-full-profile]'), c = box.querySelector('[data-profile-card]'); const r = c.getBoundingClientRect(); return { variant: c.dataset.profileVariant, w: Math.round(r.width), win: Math.round(box.getBoundingClientRect().width), avatar: Math.round(c.querySelector('.inline-block.rounded-full')?.getBoundingClientRect().width ?? 0), tabs: box.querySelectorAll('[data-profile-tab]').length, bg: c.style.background, tabsBeside: box.querySelector('[data-full-profile-tabs]').getBoundingClientRect().left >= r.right } })
ok('the window: card (big avatar, the popout\'s colours) with tabs beside it, not too wide', full.variant === 'full' && full.w === 400 && full.win <= 1000 && full.avatar >= 110 && full.tabs >= 3 && full.tabsBeside && full.bg.includes('linear-gradient'), JSON.stringify(full))
await pb.setViewportSize({ width: 1400, height: 620 }); await pb.waitForTimeout(300)
const sc = await pb.evaluate(() => { const body = document.querySelector('[data-full-profile] [data-profile-body]'); return { scrolls: body.scrollHeight >= body.clientHeight, inView: document.querySelector('[data-full-profile]').getBoundingClientRect().bottom <= innerHeight } })
u = await fr()
ok('a short window keeps the frame whole and scrolls the card inside', u.ok && sc.inView, JSON.stringify({ u, sc }))
await pb.setViewportSize({ width: 1400, height: 900 })
await pb.keyboard.press('Escape')

console.log('-- settings preview')
await pa.keyboard.press('Escape'); await pa.click('[data-control="User Settings"]'); await pa.click('[data-settings-tab="profile"]'); await pa.waitForSelector('[data-profiles-tab] [data-profile-frame-layers]'); await pa.waitForTimeout(400)
u = await unclipped(pa, '[data-profiles-tab]')
ok('Settings → Profiles preview too', u.ok, JSON.stringify(u))
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'PATCH', '/users/@me', { profile_frame: '' })
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
