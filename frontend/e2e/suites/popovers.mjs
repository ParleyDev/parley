// Floating UI and list polish: user menu flyouts pop over beside the menu (never stretching it), menus from the DM
// profile panel escape its scroll box, the member list only shows who can see the channel, asset nameplates keep
// their height and sit on the right (also in the user menu), reactions are 20px and super reactions always move,
// and the avatar in a profile opens the full image.
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, multi, pngFile, ok, finish, openDms } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
await openDms(a, b, c)
const img = await (await multi(b.token, '/images?kind=avatar', pngFile)).json()
await call(b.token, 'PATCH', '/users/@me', { avatar_url: img.url })
await call(a.token, 'PATCH', '/users/@me', { nameplate: 'asset:e2e_wave', profile_frame: 'gold' })
const g = await call(a.token, 'POST', '/guilds', { name: `Pop ${S}` }); const general = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const secret = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'secret', kind: 'text' })
await callS(a.token, 'PUT', `/channels/${secret.id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: 1024 })
await callS(a.token, 'PUT', `/channels/${secret.id}/permissions/${b.user.id}`, { kind: 'member', allow: 1024, deny: 0 })
const msg = await call(a.token, 'POST', `/channels/${general.id}/messages`, { content: `react to me ${S}` })
await callS(b.token, 'PUT', `/channels/${general.id}/messages/${msg.id}/reactions/${encodeURIComponent('🔥')}?burst=true`)
await callS(b.token, 'PUT', `/channels/${general.id}/messages/${msg.id}/reactions/${encodeURIComponent('👍')}`)

const browser = await chromium.launch(); const errors = []
const mk = async (u, path, viewport = { width: 1400, height: 900 }) => {
  const p = await (await browser.newContext({ viewport })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}${path}`); await p.waitForTimeout(1200)
  return p
}

console.log('-- user menu flyouts')
const p = await mk(a, `/channels/${g.id}/${general.id}`)
const panelH = (await p.locator('[data-user-panel]').boundingBox()).height
await p.click('[data-panel-self]'); await p.waitForSelector('[data-user-menu]'); await p.waitForTimeout(400)
ok('with a profile frame the menu still floats above the panel', await p.locator('[data-user-menu]').evaluate((e) => getComputedStyle(e.closest('.pop')).position === 'absolute' && e.classList.contains('pf-gold')) && Math.abs((await p.locator('[data-user-panel]').boundingBox()).height - panelH) < 1)
const before = await p.locator('[data-user-menu]').boundingBox()
await p.click('[data-status-menu]'); await p.waitForSelector('[data-status-option="idle"]')
const after = await p.locator('[data-user-menu]').boundingBox()
const fly = await p.locator('[data-status-option="idle"]').boundingBox()
ok('clicking a row does not stretch the menu', Math.abs(after.height - before.height) < 1 && Math.abs(after.width - before.width) < 1, JSON.stringify({ before, after }))
ok('the flyout pops over beside it', fly.x >= after.x + after.width, JSON.stringify({ fly, after }))
await p.hover('[data-status-option="idle"]'); await p.waitForSelector('[data-status-duration-list="idle"]')
ok('hovering from the row into the flyout keeps it open', await p.locator('[data-status-duration-list="idle"] [data-status-for]').count() === 5)
await p.hover('[data-switch-accounts]'); await p.waitForSelector('[data-account-switcher]')
ok('switch accounts flies out too, outside the menu', (await p.locator('[data-account-switcher]').boundingBox()).x >= after.x + after.width)
ok('your nameplate is the user panel background, not in the menu', await p.locator('[data-user-panel] > [data-panel-nameplate] [data-nameplate-video="e2e_wave"]').count() === 1 && await p.locator('[data-user-menu] [data-nameplate-video]').count() === 0)
ok('it fills the panel behind its content', await p.locator('[data-panel-nameplate]').evaluate((w) => { const r = w.getBoundingClientRect(), pr = w.parentElement.getBoundingClientRect(); return Math.abs(r.height - pr.height) <= 2 && getComputedStyle(w).zIndex === '0' }), await p.locator('[data-panel-nameplate]').evaluate((w) => JSON.stringify([w.getBoundingClientRect().height, w.parentElement.getBoundingClientRect().height, getComputedStyle(w).zIndex])))
await p.keyboard.press('Escape'); await p.mouse.click(700, 450); await p.waitForTimeout(200)
const narrow = await mk(a, `/channels/@me`, { width: 780, height: 900 })
await narrow.click('[data-panel-self]'); await narrow.waitForSelector('[data-user-menu]'); await narrow.waitForTimeout(400)
const nb = await narrow.locator('[data-user-menu]').boundingBox()
await narrow.click('[data-status-menu]'); await narrow.waitForSelector('[data-status-option="dnd"]'); await narrow.waitForTimeout(400)
const na = await narrow.locator('[data-user-menu]').boundingBox()
ok('narrow window: the flyout still pops over instead of growing the menu', Math.abs(na.height - nb.height) < 1 && await narrow.evaluate(() => { const r = document.querySelector('[data-status-option="dnd"]').getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0 }), JSON.stringify({ nb, na }))

console.log('-- member list follows channel access')
const ids = async (pg) => pg.$$eval('[data-member-row]', (els) => els.map((e) => e.getAttribute('data-member-row')))
let rows = await ids(p)
ok('a public channel lists everyone', [a, b, c].every((u) => rows.includes(u.user.id)))
await p.goto(`${WEB}/channels/${g.id}/${secret.id}`); await p.waitForTimeout(1200)
rows = await ids(p)
ok('a private channel lists only who can see it', rows.includes(a.user.id) && rows.includes(b.user.id) && !rows.includes(c.user.id), JSON.stringify(rows))
ok('the total still counts the whole server', await p.locator('[data-member-stat="total"]').getAttribute('data-member-stat-value') === '3')

console.log('-- nameplates fit the row')
const plate = await p.locator(`[data-member-row="${a.user.id}"]`).evaluate((row) => {
  const v = row.querySelector('video'); const r = row.getBoundingClientRect(), vr = v.getBoundingClientRect()
  return { h: Math.abs(vr.height - r.height) < 1.5, right: Math.abs(vr.right - r.right) < 1.5, fade: getComputedStyle(v).maskImage || getComputedStyle(v).webkitMaskImage }
})
ok('as tall as the row and pinned to its right edge', plate.h && plate.right, JSON.stringify(plate))
ok('fading in from the left', /gradient/.test(plate.fade))

console.log('-- reactions')
await p.goto(`${WEB}/channels/${g.id}/${general.id}`); await p.waitForSelector(`[data-reaction-burst="1"]`)
const sizes = await p.locator('[data-reaction="👍"]').evaluate((el) => { const e = el.firstElementChild.firstElementChild; const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, tag: e.outerHTML.slice(0, 120) } })
ok('reaction emoji are 20px', Math.round(sizes.h) === 20, JSON.stringify(sizes))
ok('super reactions always animate', await p.locator('[data-reaction-burst="1"] .super-emoji').evaluate((e) => getComputedStyle(e).animationName === 'super-pulse' && getComputedStyle(e).animationIterationCount === 'infinite') && await p.locator('[data-reaction-burst="1"]').evaluate((e) => getComputedStyle(e).animationName === 'super-shimmer'))
await p.hover('[data-reaction-burst="1"]')
ok('and burst on hover', await p.locator('[data-reaction-burst="1"] [data-burst-fx]').count() === 1)

console.log('-- DM profile panel menus and avatar')
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector('[data-dm-profile]')
await p.click('[data-dm-profile] button[aria-label="More"]'); await p.waitForSelector('[data-context-menu]')
const sub = p.locator('[data-context-menu] [aria-haspopup="menu"]').first()
if (await sub.count()) await sub.hover()
await p.waitForTimeout(250)
ok('the panel menu renders above the page, not inside the panel', await p.evaluate(() => !document.querySelector('[data-dm-profile] [data-context-menu]') && !!document.querySelector('body > * [data-context-menu], body > [data-context-menu]')))
ok('and is fully visible (not clipped)', await p.evaluate(() => [...document.querySelectorAll('[data-context-menu], [data-context-menu] [role="menu"]')].every((m) => { const r = m.getBoundingClientRect(); const x = r.left + 4, y = r.top + 4; const hit = document.elementFromPoint(x, y); return r.left >= 0 && r.right <= innerWidth && (m.contains(hit) || hit?.closest('[data-context-menu]')) })))
await p.keyboard.press('Escape'); await p.waitForTimeout(150)
await p.click('[data-dm-profile] [data-view-avatar]'); await p.waitForSelector('[data-lightbox]')
ok('clicking the avatar opens the full image', (await p.locator('[data-lightbox] img').first().getAttribute('src')).includes(img.url.split('/').pop()))
await p.keyboard.press('Escape'); await p.waitForTimeout(200)
ok('Escape closes the image and leaves the profile', await p.locator('[data-lightbox]').count() === 0 && await p.locator('[data-dm-profile]').count() === 1)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
