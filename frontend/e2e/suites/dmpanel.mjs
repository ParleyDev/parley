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
const lum = (c) => (c.match(/\d+/g) ?? []).slice(0, 3).reduce((a, b) => a + Number(b), 0)
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
    radius: getComputedStyle(card).borderTopLeftRadius, innerBg: getComputedStyle(aside.querySelector('[data-profile-inner]')).backgroundColor, innerRadius: getComputedStyle(aside.querySelector('[data-profile-inner]')).borderTopLeftRadius,
    shadow: getComputedStyle(card).boxShadow, border: getComputedStyle(aside).borderLeftWidth, bg: getComputedStyle(aside).backgroundColor, chatBg: getComputedStyle(document.querySelector('[data-header-spans] main')).backgroundColor,
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
  // Like Discord: the card keeps its 304px with a frame on; the frame is the card's width times image / inner width, and
  // the panel widens to the frame plus 8px either side (each side of the room rounded up to a whole device pixel).
  const fw = m.tops[0]?.b.w ?? 0, wantFw = 304 * Math.max(...frame.layers.map((l) => l.width ?? 1312)) / frame.layout.inner_width
  ok(`${label}: with a frame the card keeps its 304px and the frame is card width × image / inner width`, m.card.w === 304 && Math.abs(fw - wantFw) <= 1, JSON.stringify({ card: m.card.w, fw, wantFw }))
  ok(`${label}: the panel is the frame's width plus 16px, no border, the chat's own background (no column)`, Math.abs(m.aside.w - (wantFw + 16)) <= 2 && m.border === '0px' && m.bg === m.chatBg, JSON.stringify({ w: m.aside.w, border: m.border, bg: m.bg, chat: m.chatBg }))
  ok(`${label}: the card is the raised surface: ring plus a soft drop shadow`, /0px 0px 0px 1px/.test(m.shadow) && /0px 8px 24px/.test(m.shadow), m.shadow)
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
  ok(`${label}: without a frame the panel is 320px and the card the same 304px`, m.aside.w === 320 && m.card.w === 304, JSON.stringify({ aside: m.aside.w, card: m.card.w }))
  ok(`${label}: the card fills the panel with 8px all round`, m.card.x === m.aside.x + 8 && m.card.r === m.aside.r - 8 && m.card.y === m.aside.y + 8 && m.card.b === m.aside.b - 8, JSON.stringify({ card: m.card, aside: m.aside }))
  ok(`${label}: the plain card is lighter than the chat around it`, lum(m.innerBg) > lum(m.chatBg), JSON.stringify({ inner: m.innerBg, chat: m.chatBg }))
  ok(`${label}: plain card has no frame and nothing to scroll`, m.tops.length === 0 && m.scroll.sh <= m.scroll.ch + 1 && m.asideScroll.sw <= m.asideScroll.cw)
  if (shots) await p.screenshot({ path: `${shots}/dmpanel-plain-${label}.png` })
}

// The moonflowers frame (staples only, no rails): its pieces stay on the card's corners whatever the panel's height,
// the front ones paint over everything in the card (footer included), and the message box lines up with your panel.
const moon = frames.find((f) => f.id === 'moonflowers')
if (moon) {
  const d = await reg('roro'); await openDms(d)
  await call(d.token, 'PATCH', '/users/@me', { profile_frame: 'asset:moonflowers', theme_primary: '#1d2b4a', theme_accent: '#6a4c93', bio: 'Moonflowers.' })
  const dmD = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: d.user.id })
  const corners = (p) => p.evaluate((L) => {
    const aside = document.querySelector('[data-dm-profile]'), card = aside.querySelector('[data-profile-card]').getBoundingClientRect()
    const wrap = aside.querySelector('[data-frame-wrap]').getBoundingClientRect()
    const s = card.width / L.inner_width
    const layers = [...aside.querySelectorAll('[data-frame-layer]')].map((e) => { const b = e.getBoundingClientRect(); return { f: e.dataset.frameLayer, order: e.dataset.frameOrder, x: b.left, top: b.top, r: b.right, bottom: b.bottom, styleTop: e.style.top, styleBottom: e.style.bottom } })
    const z = (sel) => getComputedStyle(aside.querySelector(sel)).zIndex
    return { card: { top: card.top, bottom: card.bottom }, wrap: { x: wrap.left, top: wrap.top, r: wrap.right, bottom: wrap.bottom }, ot: L.overflow_top * s, ob: L.overflow_bottom * s, dpr: devicePixelRatio, layers, zFront: z('[data-profile-frame-layers]'), zBack: z('[data-frame-back-layer]'), zCard: z('[data-profile-card]'), asideClip: aside.scrollHeight <= aside.clientHeight && aside.scrollWidth <= aside.clientWidth }
  }, moon.layout)
  const check = (label, c) => {
    const tops = c.layers.filter((l) => /staple_top/.test(l.f)), bottoms = c.layers.filter((l) => /staple_bottom/.test(l.f))
    const px = 1 / c.dpr
    ok(`${label}: top staples hang from the card's top edge (top only)`, tops.length === 2 && tops.every((l) => Math.abs(l.top - (c.card.top - c.ot)) <= px + 0.01 && l.styleTop && !l.styleBottom), JSON.stringify({ tops, c: c.card, ot: c.ot }))
    ok(`${label}: bottom staples end overflow_bottom below the card's bottom edge (bottom only)`, bottoms.length === 2 && bottoms.every((l) => Math.abs(l.bottom - (c.card.bottom + c.ob)) <= px + 0.01 && l.styleBottom && !l.styleTop), JSON.stringify({ bottoms, c: c.card, ob: c.ob }))
    const same = (pair) => pair.length === 2 && ['x', 'top', 'r', 'bottom'].every((k) => Math.abs(pair[0][k] - pair[1][k]) < 0.01)
    ok(`${label}: back and front pieces of each staple land on exactly the same rect`, same(tops) && same(bottoms), JSON.stringify({ tops, bottoms }))
    ok(`${label}: no frame piece reaches past the wrapper that clips it`, c.layers.every((l) => l.x >= c.wrap.x - 0.01 && l.r <= c.wrap.r + 0.01 && l.top >= c.wrap.top - 0.01 && l.bottom <= c.wrap.bottom + 0.01), JSON.stringify({ wrap: c.wrap, layers: c.layers.map((l) => [l.f, l.x, l.top, l.r, l.bottom]) }))
  }
  for (const [w, h, dpr, heights] of [[1280, 720, 1, [721, 600]], [1925, 1289, 1, [1080, 977]], [1920, 1080, 1.25, [1289, 721]], [2560, 1440, 2, [1289, 1001]]]) {
    const label = `moonflowers ${w}x${h}@${dpr}x`
    const p = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
    await p.goto(`${WEB}/channels/@me/${dmD.id}`); await p.waitForSelector('[data-dm-profile] [data-frame-layer]', { state: 'attached' }); await p.waitForTimeout(1200)
    const c = await corners(p)
    check(label, c)
    const mw = await p.evaluate(() => { const a = document.querySelector('[data-dm-profile]').getBoundingClientRect(), cd = document.querySelector('[data-dm-profile] [data-profile-card]').getBoundingClientRect(), f = document.querySelector('[data-dm-profile] [data-frame-layer*="staple_top"]').getBoundingClientRect(); return { aside: a.width, card: cd.width, frame: f.width, frameTop: f.top - a.top, frameRight: a.right - f.right } })
    const wantF = 304 * Math.max(...moon.layers.map((l) => l.width ?? 1312)) / moon.layout.inner_width
    ok(`${label}: card 304px, frame ${wantF.toFixed(2)}px wide, panel = frame + 16, frame 8px inside its top and right`, Math.abs(mw.card - 304) < 0.01 && Math.abs(mw.frame - wantF) <= 1 && Math.abs(mw.aside - (mw.frame + 16)) <= 2 && Math.abs(mw.frameTop - 8) <= 1 && Math.abs(mw.frameRight - 8) <= 1, JSON.stringify({ ...mw, wantF }))
    ok(`${label}: back pieces under the card, front pieces over all of it (footer too)`, c.zBack === '0' && c.zCard === '1' && c.zFront === '20' && c.asideClip, JSON.stringify({ zb: c.zBack, zc: c.zCard, zf: c.zFront }))
    for (const hh of heights) { await p.setViewportSize({ width: w, height: hh }); await p.waitForTimeout(500); check(`${label} → ${hh} tall`, await corners(p)) }
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(500)
    await p.fill('main textarea', Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n')); await p.waitForTimeout(300)
    check(`${label} with a grown message box`, await corners(p))
    await p.fill('main textarea', ''); await p.waitForTimeout(300)
    const dock = await p.evaluate(() => { const b = document.querySelector('[data-composer-box]').getBoundingClientRect(), u = document.querySelector('[data-user-panel]').getBoundingClientRect(); return { box: [Math.round(b.top), Math.round(b.bottom), Math.round(b.height), getComputedStyle(document.querySelector('[data-composer-box]')).borderTopLeftRadius], panel: [Math.round(u.top), Math.round(u.bottom), Math.round(u.height), getComputedStyle(document.querySelector('[data-user-panel]')).borderTopLeftRadius], vh: innerHeight } })
    ok(`${label}: message box and your panel are the same 58px, side by side, 8px off the bottom, same corners`, dock.box[0] === dock.panel[0] && dock.box[1] === dock.panel[1] && dock.box[2] === 58 && dock.box[1] === dock.vh - 8 && dock.box[3] === dock.panel[3] && dock.box[3] === '8px', JSON.stringify(dock))
    if (shots) await p.screenshot({ path: `${shots}/roro-${w}x${h}@${dpr}x.png` })
  }
}

console.log('-- phone')
const ph = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
await ph.goto(`${WEB}/login`); await ph.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await ph.goto(`${WEB}/channels/@me/${dmB.id}`); await ph.waitForSelector('[data-message-list]'); await ph.waitForTimeout(800)
ok('phones: no profile panel', !(await ph.locator('[data-dm-profile]').isVisible().catch(() => false)))
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
