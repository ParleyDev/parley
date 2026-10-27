// Typing on a phone: opening a channel does not pop the keyboard (desktop still focuses the box; Reply focuses
// everywhere), and when the keyboard is up the app shrinks to the visible area so the header (which DM or channel
// you are in) stays on screen. A stand-in visualViewport plays the keyboard: Playwright cannot open a real one.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('typer')
const g = await call(a.token, 'POST', '/guilds', { name: `Typing ${S}` }); const tc = g.channels.find((x) => x.kind === 'text')
const m = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: 'reply to me' })
const browser = await chromium.launch(); const errors = []
const fakeViewport = () => {
  const vv = new EventTarget(); vv.height = window.innerHeight; vv.width = window.innerWidth; vv.scale = 1; vv.offsetTop = 0; vv.offsetLeft = 0
  Object.defineProperty(window, 'visualViewport', { get: () => vv })
  window.__keyboard = (px) => { vv.height = window.innerHeight - px; vv.dispatchEvent(new Event('resize')) }
}
const mk = async (phone) => {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } })
  if (phone) await ctx.addInitScript(fakeViewport)
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
  return p
}
const focusedComposer = (p) => p.evaluate(() => document.activeElement?.tagName === 'TEXTAREA')

console.log('-- focusing the message box')
const d = await mk(false)
await d.goto(`${WEB}/channels/${g.id}/${tc.id}`); await d.waitForSelector('textarea'); await d.waitForTimeout(400)
ok('on a desktop, opening a channel focuses the message box', await focusedComposer(d))
const p = await mk(true)
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('textarea'); await p.waitForTimeout(400)
ok('on a phone it does not (no keyboard popping up)', !(await focusedComposer(p)))
const header = () => p.evaluate(() => { const h = document.querySelector('main header'); const r = h.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), text: h.textContent } })
const before = await header() // where the header sits when the channel opens
await p.locator(`[data-msg-id="${m.id}"] .msg-content`).click({ button: 'right' }); await p.click('[data-context-menu] [data-menu-item="Reply"]'); await p.waitForTimeout(300)
ok('choosing Reply still focuses it, ready to type', await focusedComposer(p))

console.log('-- keyboard open')
await p.evaluate(() => window.__keyboard(330)); await p.waitForTimeout(200)
const after = await header()
ok('the app shrinks to the space above the keyboard', await p.evaluate(() => getComputedStyle(document.getElementById('root')).height) === `${844 - 330}px`)
ok('the header (which channel you are in) stays at the top', after.top === before.top && after.text.includes(tc.name) && after.bottom > 0, JSON.stringify({ before, after }))
ok('and the page is not scrolled away', await p.evaluate(() => window.scrollY === 0))
ok('the message box sits just above the keyboard', await p.evaluate(() => Math.abs(document.querySelector('textarea').getBoundingClientRect().bottom - (844 - 330)) < 80))
ok('no home-bar gap is kept above the keyboard', await p.evaluate(() => document.documentElement.dataset.keyboard === 'open'))
await p.evaluate(() => window.__keyboard(0)); await p.waitForTimeout(200)
ok('closing the keyboard restores the full height', await p.evaluate(() => getComputedStyle(document.getElementById('root')).height === '844px' && !document.documentElement.dataset.keyboard))
await p.screenshot({ path: 'phonetyping.png' })

console.log('-- short screens')
const r = await (await browser.newContext({ viewport: { width: 390, height: 460 }, isMobile: true, hasTouch: true })).newPage(); r.on('pageerror', (e) => errors.push(e.message))
await r.goto(`${WEB}/register`); await r.waitForSelector('form')
const box = await r.evaluate(() => { const f = document.querySelector('form'), s = f.closest('.overflow-y-auto'); return { formTop: Math.round(f.getBoundingClientRect().top), scrolls: s.scrollHeight > s.clientHeight } })
ok('a form taller than the space left scrolls, with its top visible (not clipped)', box.formTop >= 0 && box.scrolls, JSON.stringify(box))
await r.locator('form button.btn-primary').scrollIntoViewIfNeeded()
ok('and its button can be scrolled to', await r.locator('form button.btn-primary').isVisible())

ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
