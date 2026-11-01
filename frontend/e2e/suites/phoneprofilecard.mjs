// Phones: every profile (your own from the user panel, someone else's tapped in a chat) opens as the same sheet: full
// width, the frame reaching over its top and cut at the sides and bottom. Contents taller than the sheet scroll
// vertically inside it, never sideways, while the sheet and its frame stay put.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish, openDms } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
await openDms(a, b)
await call(a.token, 'PATCH', '/users/@me', { profile_frame: 'asset:e2e_frame', bio: `Framed ${S}\n${'line\n'.repeat(40)}end`, theme_primary: '#5b2a86', theme_accent: '#b03060' })
const browser = await chromium.launch(); const errors = []
const mk = async (u, path) => {
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}${path}`); await p.waitForTimeout(1200)
  return p
}
const measure = (p) => p.evaluate(() => {
  const sheet = document.querySelector('[data-profile-sheet]'), card = sheet.querySelector('[data-profile-card]'), sc = sheet.querySelector('[data-profile-sheet-scroll]')
  const rs = [...sheet.querySelectorAll('[data-frame-layer]')].map((e) => e.getBoundingClientRect()), s = sheet.getBoundingClientRect()
  const fr = { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) }
  return {
    variant: card.dataset.profileVariant, s: [s.left, s.top, s.right, s.bottom].map(Math.round), frame: [fr.left, fr.top, fr.right, fr.bottom].map(Math.round),
    clip: getComputedStyle(sheet).clipPath, sw: sc.scrollWidth, cw: sc.clientWidth, sh: sc.scrollHeight, ch: sc.clientHeight, ox: getComputedStyle(sc).overflowX, oy: getComputedStyle(sc).overflowY,
    pageX: document.scrollingElement.scrollWidth,
  }
})
const checks = async (p, who) => {
  const m = await measure(p)
  ok(`${who}: the full-width sheet`, m.variant === 'sheet' && m.s[0] === 0 && m.s[2] === 390 && m.s[3] === 844, JSON.stringify(m))
  ok(`${who}: the frame reaches over the top and is cut at the sides and bottom`, m.frame[1] < m.s[1] && (m.frame[3] > m.s[3] || m.frame[0] < 0 || m.frame[2] > 390) && /^inset\(-\d+px 0/.test(m.clip), JSON.stringify(m))
  ok(`${who}: long contents scroll vertically, never sideways`, m.sh > m.ch && m.oy === 'auto' && m.ox === 'hidden' && m.sw <= m.cw && m.pageX <= 390, JSON.stringify(m))
  await p.evaluate(() => { document.querySelector('[data-profile-sheet-scroll]').scrollTop = 600 }); await p.waitForTimeout(150)
  const after = await measure(p)
  ok(`${who}: scrolling moves the contents, not the sheet or its frame`, after.s.join() === m.s.join() && after.frame.join() === m.frame.join(), JSON.stringify({ before: m.frame, after: after.frame }))
}

console.log('-- your own, from the user panel')
const pa = await mk(a, '/channels/@me')
await pa.locator('[data-panel-self]').tap(); await pa.waitForSelector('[data-profile-sheet] [data-profile-frame-layers]'); await pa.waitForTimeout(600)
await checks(pa, 'yours')

console.log('-- someone else\'s, tapped in a chat')
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
const msg = await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: `hi ${S}` })
const pb = await mk(b, `/channels/@me/${dm.id}`)
await pb.waitForSelector(`[data-msg-id="${msg.id}"] [data-msg-avatar]`)
await pb.locator(`[data-msg-id="${msg.id}"] [data-msg-avatar]`).tap()
await pb.waitForSelector('[data-profile-sheet] [data-profile-frame-layers]'); await pb.waitForTimeout(600)
ok('a tap opens the same sheet, not a small card', await pb.locator('[data-profile-popout]').count() === 0)
await checks(pb, 'theirs')
await pb.locator('[data-full-profile-close]').tap(); await pb.waitForFunction(() => !document.querySelector('[data-profile-sheet]'))
await pb.locator(`[data-msg-id="${msg.id}"] [data-msg-author]`).tap()
await pb.waitForSelector('[data-profile-sheet] [data-profile-card][data-profile-variant="sheet"]')
ok('tapping their name opens it too', true)

console.log('-- desktop keeps the popout')
const d = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); d.on('pageerror', (e) => errors.push(e.message))
await d.goto(`${WEB}/login`); await d.evaluate((t) => localStorage.setItem('parley.token', t), b.token)
await d.goto(`${WEB}/channels/@me/${dm.id}`); await d.waitForSelector(`[data-msg-id="${msg.id}"] [data-msg-avatar]`)
await d.locator(`[data-msg-id="${msg.id}"] [data-msg-avatar]`).click(); await d.waitForSelector('[data-profile-popout]')
ok('a click opens the compact popout beside it', await d.locator('[data-full-profile]').count() === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); finish()
