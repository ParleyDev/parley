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
const bgs = () => pa.evaluate(() => { const room = document.querySelector('[data-user-panel] [data-frame-wrap]'); const card = room.querySelector('[data-user-menu]'); return { room: getComputedStyle(room).backgroundColor, card: getComputedStyle(card).backgroundColor } })
await pa.evaluate(() => { document.documentElement.dataset.palette = 'aurora' }); await pa.waitForTimeout(100)
let bg = await bgs()
ok('see-through palettes: the frame\'s room stays transparent', bg.room === 'rgba(0, 0, 0, 0)', JSON.stringify(bg))
ok('while the menu card itself gets the solid surface', bg.card !== 'rgba(0, 0, 0, 0)', JSON.stringify(bg))
await pa.evaluate(() => { delete document.documentElement.dataset.palette })
await pa.hover('[data-status-menu]'); await pa.waitForSelector('[data-status-option="idle"]')
ok('flyouts open beside the frame, not on it', await pa.evaluate(() => document.querySelector('[data-status-option="idle"]').getBoundingClientRect().left >= document.querySelector('[data-frame-room]').getBoundingClientRect().right))
await pa.mouse.click(1000, 300); await pa.waitForTimeout(200)
ok('clicking elsewhere closes the menu', await pa.locator('[data-user-menu]').count() === 0)

console.log('-- popout')
const pb = await mk(b, `/channels/${g.id}/${ch.id}`)
await pb.click(`[data-member-row="${a.user.id}"]`); await pb.waitForSelector('[data-profile-popout] [data-profile-frame-layers]'); await pb.waitForTimeout(400)
u = await unclipped(pb, '[data-profile-popout]')
ok('the popout is placed with its frame on screen', u.ok, JSON.stringify(u))
await pb.evaluate(() => { document.documentElement.dataset.palette = 'sunset' }); await pb.waitForTimeout(100)
ok('and its frame room is transparent in see-through palettes', await pb.evaluate(() => getComputedStyle(document.querySelector('[data-profile-popout] [data-frame-wrap]')).backgroundColor) === 'rgba(0, 0, 0, 0)')
await pb.evaluate(() => { delete document.documentElement.dataset.palette })
// The member list sits at the right edge: the popout opens to its left, frame included.
ok('the frame does not hang off the right edge', u.r && u.r[2] <= 1400)
await pb.keyboard.press('Escape')

console.log('-- DM profile panel')
await pb.goto(`${WEB}/channels/@me/${dm.id}`); await pb.waitForSelector('[data-dm-profile] [data-profile-frame-layers]'); await pb.waitForTimeout(500)
u = await unclipped(pb, '[data-dm-profile]')
ok('the side panel leaves room for the frame (not cut off at the top or sides)', u.ok, JSON.stringify(u))

console.log('-- full profile')
await pb.click('[data-dm-profile] [data-view-full-profile]'); await pb.waitForSelector('[data-modal-bare] [data-profile-frame-layers]'); await pb.waitForTimeout(500)
u = await unclipped(pb, '[data-modal-bare]')
ok('the full profile shows the whole frame', u.ok, JSON.stringify(u))
const full = await pb.evaluate(() => { const c = document.querySelector('[data-modal-bare] [data-profile-card]'); const r = c.getBoundingClientRect(); return { variant: c.dataset.profileVariant, w: Math.round(r.width), avatar: Math.round(c.querySelector('.inline-block.rounded-full')?.getBoundingClientRect().width ?? 0), tabs: document.querySelectorAll('[data-modal-bare] [data-profile-tab]').length, tabsVisible: [...document.querySelectorAll('[data-modal-bare] [data-profile-tab]')].every((x) => { const t = x.getBoundingClientRect(), p = x.parentElement.getBoundingClientRect(); return t.right <= p.right + 1 && t.left >= p.left - 1 }), bg: c.style.background } })
ok('in the new wide layout (big avatar, tabs) with the popout\'s colours', full.variant === 'full' && full.w >= 600 && full.avatar >= 110 && full.tabs >= 3 && full.tabsVisible && full.bg.includes('linear-gradient'), JSON.stringify(full))
await pb.setViewportSize({ width: 1400, height: 560 }); await pb.waitForTimeout(300)
const sc = await pb.evaluate(() => { const box = document.querySelector('[data-modal-bare]'), room = box.querySelector('[data-frame-room]'); box.scrollTop = 0; const b = box.getBoundingClientRect(), r = room.getBoundingClientRect(); return { scrolls: box.scrollHeight > box.clientHeight + 4, topIn: r.top >= b.top - 1, sides: r.left >= b.left - 1 && r.right <= b.right + 1 } })
ok('a short window scrolls the profile instead of cutting the frame', sc.scrolls && sc.topIn && sc.sides, JSON.stringify(sc))
await pb.setViewportSize({ width: 1400, height: 900 })
await pb.keyboard.press('Escape')

console.log('-- settings preview')
await pa.keyboard.press('Escape'); await pa.click('[data-control="User Settings"]'); await pa.click('[data-settings-tab="profile"]'); await pa.waitForSelector('[data-profiles-tab] [data-profile-frame-layers]'); await pa.waitForTimeout(400)
u = await unclipped(pa, '[data-profiles-tab]')
ok('Settings → Profiles preview too', u.ok, JSON.stringify(u))
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'PATCH', '/users/@me', { profile_frame: '' })
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
