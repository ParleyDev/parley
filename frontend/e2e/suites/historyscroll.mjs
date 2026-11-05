import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'

// Scrolling up a long history on a phone loads one page at a time and keeps the reader where they were. WebKit
// (iOS) ignores a script setting the scroll position while a fling or the top bounce is still moving the list; the
// list then stayed at the top after older messages were added above, and loaded page after page in a flash. This
// emulates that: while a "fling" is on, writes to the list's scrollTop are dropped, unless the list stopped
// scrolling (overflow hidden) for the write, which ends the fling, as on iOS.
const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `History ${S}` })
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
const ids = []
for (let i = 1; i <= 210; i++) {
  let r = await raw(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `history line ${i}` })
  while (r.status === 429) { await new Promise((res) => setTimeout(res, 1000)); r = await raw(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `history line ${i}` }) }
  ids.push((await r.json()).id)
}

const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })
await ctx.addInitScript(() => {
  const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
  Object.defineProperty(Element.prototype, 'scrollTop', {
    get() { return d.get.call(this) },
    set(v) {
      if (window.__fling && this.matches?.('[data-message-list]')) {
        if (getComputedStyle(this).overflowY !== 'hidden') { window.__dropped = (window.__dropped ?? 0) + 1; return }
        window.__fling = false
      }
      d.set.call(this, v)
    },
  })
})
const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
let pages = 0
p.on('request', (r) => { if (/\/channels\/[^/]+\/messages\?before=/.test(r.url())) pages++ })
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector(`[data-msg-id="${ids[209]}"]`); await p.waitForTimeout(800)
const list = '[data-message-list]'
const topOf = (id) => p.evaluate(([list, id]) => { const el = document.querySelector(list), r = document.querySelector(`[data-msg-id="${id}"]`); return r ? r.getBoundingClientRect().top - el.getBoundingClientRect().top : null }, [list, id])

console.log('-- a fling up to the top of what is loaded')
const oldest = await p.evaluate((list) => document.querySelector(`${list} [data-msg-id]`).getAttribute('data-msg-id'), list)
pages = 0
// The reader's own scrolling (scrollBy) still moves the list; only the page's own corrections are dropped mid-fling.
await p.evaluate((list) => { window.__fling = true; const el = document.querySelector(list); el.scrollBy(0, -el.scrollTop) }, list)
await p.waitForTimeout(2500)
ok('one page of older messages loads, not several in a row', pages === 1, `${pages} pages`)
const at = await topOf(oldest)
ok('and the message that was at the top stays on screen where it was', at !== null && Math.abs(at) < 80, String(at))
ok('the list is no longer at the very top', await p.evaluate((list) => document.querySelector(list).scrollTop > 400, list))

console.log('-- scrolling up page by page')
await p.evaluate(() => { window.__fling = false })
for (let i = 0; i < 4; i++) { await p.evaluate((list) => { const el = document.querySelector(list); el.scrollBy(0, -el.scrollTop) }, list); await p.waitForTimeout(1200) }
ok('the whole history loads by scrolling up', await p.locator(`[data-msg-id="${ids[0]}"]`).count() === 1)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
