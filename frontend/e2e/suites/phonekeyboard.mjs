// The on-screen keyboard on a phone: reading the newest messages and opening the keyboard keeps them in view above
// the message box, as the list shrinks to the space left (the native app resizes its web view; phone browsers shrink
// the visual viewport). A stand-in visualViewport plays the browser keyboard: Playwright cannot open a real one.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('kb')
const g = await call(a.token, 'POST', '/guilds', { name: `Keyboard ${S}` }); const tc = g.channels.find((x) => x.kind === 'text')
let lastId
for (let i = 1; i <= 40; i++) {
  let r = await raw(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `line ${i}` })
  while (r.status === 429) { await new Promise((res) => setTimeout(res, 1000)); r = await raw(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `line ${i}` }) }
  lastId = (await r.json()).id
}
const browser = await chromium.launch(); const errors = []
const mk = async (fakeVv) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  if (fakeVv) await ctx.addInitScript(() => {
    const vv = new EventTarget(); vv.height = window.innerHeight; vv.width = window.innerWidth; vv.scale = 1; vv.offsetTop = 0; vv.offsetLeft = 0
    Object.defineProperty(window, 'visualViewport', { get: () => vv })
    window.__keyboard = (px) => { vv.height = window.innerHeight - px; vv.dispatchEvent(new Event('resize')) }
  })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
  await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector(`[data-msg-id="${lastId}"]`); await p.waitForTimeout(800)
  return p
}
// The newest message is fully on screen, above the message box.
const newestShown = (p) => p.evaluate((id) => { const m = document.querySelector(`[data-msg-id="${id}"]`).getBoundingClientRect(), box = document.querySelector('textarea').getBoundingClientRect(), list = document.querySelector('[data-message-list]').getBoundingClientRect(); return { ok: m.bottom <= box.top + 1 && m.bottom <= list.bottom + 1 && m.top >= list.top, m: Math.round(m.bottom), box: Math.round(box.top), list: Math.round(list.bottom) } }, lastId)

console.log('-- the app: the web view resizes')
const p = await mk(false)
ok('the newest message shows before typing', (await newestShown(p)).ok)
await p.click('textarea'); await p.setViewportSize({ width: 390, height: 500 }); await p.waitForTimeout(600)
let r = await newestShown(p); ok('opening the keyboard keeps it in view above the message box', r.ok, JSON.stringify(r))
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(600)
r = await newestShown(p); ok('and closing it too', r.ok, JSON.stringify(r))
// The keyboard animates open: many small resizes, each with the scroll event the shrink causes.
for (let h = 844; h >= 480; h -= 26) { await p.setViewportSize({ width: 390, height: h }); await p.evaluate(() => document.querySelector('[data-message-list]').dispatchEvent(new Event('scroll'))) }
await p.waitForTimeout(600)
r = await newestShown(p); ok('an animated keyboard (many small resizes) keeps it in view too', r.ok, JSON.stringify(r))

console.log('-- a phone browser: the visual viewport shrinks')
const q = await mk(true)
await q.click('textarea'); await q.evaluate(() => window.__keyboard(340)); await q.waitForTimeout(600)
r = await newestShown(q); ok('opening the keyboard keeps the newest message in view', r.ok, JSON.stringify(r))
await q.screenshot({ path: 'e2e/out/phonekeyboard.png' })

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
