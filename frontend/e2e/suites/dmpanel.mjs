// The DM profile panel as Discord's floating card: the header across the chat and the panel, a 320px panel with the
// card filling its height (8px around it, plus room for the frame), contents scrolling inside with View Full Profile
// always in view, the frame's top and bottom pieces at the card's real corners, the effect clipped to the card, and
// nothing scrolling the panel itself. Uses the Dark Moon frame and the All Nighter effect when the instance has them
// (the test stack's assets folder), else the e2e ones.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, openDms, finish } from '../lib.mjs'
const frames = await fetch(`${WEB}/api/assets/profile-frames`).then((r) => r.json()).catch(() => [])
const effects = await fetch(`${WEB}/api/assets/profile-effects`).then((r) => r.json()).catch(() => [])
const frame = frames.find((f) => f.id === 'dark_moon') ?? frames.find((f) => f.id === 'e2e_frame')
const effect = effects.find((f) => f.id === 'all_nighter') ?? effects.find((f) => f.id === 'e2e_sparkle')
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
await openDms(a, b, c)
// Bios stop at 400 characters: many short lines make it tall.
const bio = Array.from({ length: 48 }, (_, i) => `Line ${i + 1}`).join('\n').slice(0, 380)
await call(b.token, 'PATCH', '/users/@me', { profile_frame: `asset:${frame.id}`, profile_effect: `asset:${effect.id}`, theme_primary: '#3b2a86', theme_accent: '#b03060', bio })
await call(c.token, 'PATCH', '/users/@me', { bio: 'Short and plain.' })
const dmB = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
const dmC = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: c.user.id })
const browser = await chromium.launch(); const errors = []
const shots = process.env.SHOTS
console.log(`  (frame ${frame.id}, effect ${effect.id})`)

const measure = (p) => p.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) } }
  const aside = document.querySelector('[data-dm-profile]'), card = aside.querySelector('[data-profile-card]'), scroll = aside.querySelector('[data-profile-scroll]')
  const staple = (anchor) => [...aside.querySelectorAll('[data-frame-layer]')].map((e) => ({ f: e.dataset.frameLayer, b: r(e) })).filter((x) => x.f.includes(`staple_${anchor}`))
  return {
    vw: innerWidth, vh: innerHeight, header: r(document.querySelector('[data-header-spans] > header')), aside: r(aside), card: r(card), inner: r(aside.querySelector('[data-profile-inner]')),
    footer: r(aside.querySelector('[data-profile-footer]')), button: r(aside.querySelector('[data-view-full-profile]')), effect: r(aside.querySelector('[data-profile-effect]')),
    scroll: { sh: scroll.scrollHeight, ch: scroll.clientHeight, sw: scroll.scrollWidth, cw: scroll.clientWidth },
    asideScroll: { sw: aside.scrollWidth, cw: aside.clientWidth, sh: aside.scrollHeight, ch: aside.clientHeight },
    pageX: document.documentElement.scrollWidth > innerWidth, tops: staple('top'), bottoms: staple('bottom'),
    radius: getComputedStyle(card).borderTopLeftRadius, innerRadius: getComputedStyle(aside.querySelector('[data-profile-inner]')).borderTopLeftRadius,
    shadow: getComputedStyle(card).boxShadow, border: getComputedStyle(aside).borderLeftWidth, bg: getComputedStyle(aside).backgroundColor, chatBg: getComputedStyle(document.querySelector('[data-header-spans]')).backgroundColor,
  }
})

for (const [w, h] of [[1280, 720], [1920, 1080]]) {
  const label = `${w}x${h}`
  const p = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
  console.log(`-- ${label}: framed, with an effect and a long bio`)
  await p.goto(`${WEB}/channels/@me/${dmB.id}`); await p.waitForSelector('[data-dm-profile] [data-profile-frame-layers] [data-frame-layer]', { state: 'attached', timeout: 8000 }).catch(() => {}); await p.waitForTimeout(1500)
  let m = await measure(p)
  ok(`${label}: the header runs across the chat and the panel; the panel starts under it`, m.header && m.header.r >= m.vw - 1 && m.aside.y >= m.header.b, JSON.stringify({ header: m.header, aside: m.aside }))
  ok(`${label}: the panel is 320px, no left border, a step lighter than the chat`, m.aside.w === 320 && m.border === '0px' && m.bg !== m.chatBg, JSON.stringify({ w: m.aside.w, border: m.border, bg: m.bg, chat: m.chatBg }))
  ok(`${label}: card 8px radius, 1px ring, inner 6px`, m.radius === '8px' && m.innerRadius === '6px' && /0px 0px 0px 1px/.test(m.shadow), JSON.stringify({ r: m.radius, ir: m.innerRadius, s: m.shadow }))
  ok(`${label}: nothing scrolls the panel itself, sideways or down, and the page doesn't either`, m.asideScroll.sw <= m.asideScroll.cw && m.asideScroll.sh <= m.asideScroll.ch && !m.pageX, JSON.stringify(m.asideScroll))
  ok(`${label}: the long bio scrolls inside the card`, m.scroll.sh > m.scroll.ch + 50 && m.scroll.sw <= m.scroll.cw, JSON.stringify(m.scroll))
  ok(`${label}: View Full Profile stays in view at the bottom of the card`, m.button && m.button.b <= m.inner.b && m.button.b <= m.vh && m.footer.b === m.inner.b, JSON.stringify({ button: m.button, inner: m.inner }))
  const T = m.tops[0]?.b, B = m.bottoms[0]?.b
  ok(`${label}: the frame's top pieces sit on the card's top edge, inside the panel`, T && m.tops.every((x) => Math.abs(x.b.y - T.y) <= 1) && T.y >= m.aside.y && T.y < m.card.y, JSON.stringify({ T, card: m.card, aside: m.aside }))
  ok(`${label}: its bottom pieces end below the card's bottom edge, 8px above the panel's`, B && Math.abs(B.b - (m.aside.b - 8)) <= 2 && B.y < m.card.b && B.b > m.card.b, JSON.stringify({ B, card: m.card, aside: m.aside }))
  ok(`${label}: the frame's side pieces don't run past the panel`, [...m.tops, ...m.bottoms].every((x) => x.b.x >= m.aside.x - 1 && x.b.r <= m.aside.r + 1))
  ok(`${label}: the effect plays over the card, clipped to it`, m.effect && m.effect.x === m.inner.x && m.effect.y === m.inner.y && m.effect.w === m.inner.w && m.effect.h === m.inner.h, JSON.stringify({ e: m.effect, inner: m.inner }))
  if (shots) await p.screenshot({ path: `${shots}/dmpanel-framed-${label}.png` })
  await p.locator('[data-profile-scroll]').evaluate((e) => { e.scrollTop = e.scrollHeight }); await p.waitForTimeout(200)
  m = await measure(p)
  ok(`${label}: scrolled to the end of the bio, the footer is still there and the panel hasn't moved`, m.button.b <= m.inner.b && m.asideScroll.sh <= m.asideScroll.ch)
  if (shots) await p.screenshot({ path: `${shots}/dmpanel-framed-${label}-scrolled.png` })

  console.log(`-- ${label}: no cosmetics`)
  await p.goto(`${WEB}/channels/@me/${dmC.id}`); await p.waitForSelector('[data-dm-profile] [data-profile-card]'); await p.waitForTimeout(800)
  m = await measure(p)
  ok(`${label}: the card fills the panel with 8px all round`, m.card.x === m.aside.x + 8 && m.card.r === m.aside.r - 8 && m.card.y === m.aside.y + 8 && m.card.b === m.aside.b - 8, JSON.stringify({ card: m.card, aside: m.aside }))
  ok(`${label}: plain card has no frame and nothing to scroll`, m.tops.length === 0 && m.scroll.sh <= m.scroll.ch + 1 && m.asideScroll.sw <= m.asideScroll.cw)
  if (shots) await p.screenshot({ path: `${shots}/dmpanel-plain-${label}.png` })
}

console.log('-- phone')
const ph = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
await ph.goto(`${WEB}/login`); await ph.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await ph.goto(`${WEB}/channels/@me/${dmB.id}`); await ph.waitForSelector('[data-message-list]'); await ph.waitForTimeout(800)
ok('phones: no profile panel', !(await ph.locator('[data-dm-profile]').isVisible().catch(() => false)))
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
