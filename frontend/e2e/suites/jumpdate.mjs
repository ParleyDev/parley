// Windows into history: ?around= / ?after= on the message list, jumping far back from a pin, paging forward, Jump to Present, and jump to date.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob'); const extra = [await reg('carol'), await reg('dave'), await reg('erin')]
const g = await call(a.token, 'POST', '/guilds', { name: `Jump ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, ...extra]) await call(u.token, 'POST', `/invites/${inv.code}`)
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
// Five posters keep each under the per-user message rate limit.
const posters = [a, b, ...extra]; const ids = []
for (let i = 0; i < 160; i++) { const m = await call(posters[i % posters.length].token, 'POST', `/channels/${tc.id}/messages`, { content: `msg ${i} ${S}` }); if (!m?.id) throw new Error(`post ${i} failed: ${JSON.stringify(m)}`); ids.push(m.id) }
const list = (q) => call(b.token, 'GET', `/channels/${tc.id}/messages?${q}`)

console.log('-- API')
let ms = await list(`around=${ids[80]}&limit=50`)
ok('around returns a 50-message window with the anchor in the middle', ms.length === 50 && ms[24].id === ids[80] && ms[0].id === ids[56] && ms[49].id === ids[105], `${ms.length} ${ms.findIndex((m) => m.id === ids[80])}`)
ok('window is ascending', ms.every((m, i) => i === 0 || m.id > ms[i - 1].id))
ms = await list(`after=${ids[150]}&limit=50`); ok('after pages forward, oldest first, and stops at the end', ms.length === 9 && ms[0].id === ids[151] && ms[8].id === ids[159])
ms = await list(`around=${ids[2]}&limit=50`); ok('near the start the window is short on the older side', ms.some((m) => m.id === ids[0]) && ms.filter((m) => m.id <= ids[2]).length < 25 && ms.filter((m) => m.id > ids[2]).length === 25)
const futureAnchor = 'ffffffff-ffff-7000-8000-000000000000'
ms = await list(`around=${futureAnchor}&limit=50`); ok('an anchor after everything yields the last 25', ms.length === 25 && ms[24].id === ids[159])
ms = await list(`around=00000000-0000-7000-8000-000000000000&limit=50`); ok('an anchor before everything yields the first 25', ms.length === 25 && ms.some((m) => m.id === ids[0]))
let r = await raw(b.token, 'GET', `/channels/${tc.id}/messages?around=nope`); ok('bad anchor -> 400', r.status === 400)

console.log('-- UI')
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), b.token); await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('textarea')
await p.waitForSelector(`[data-msg-id="${ids[159]}"]`)
await raw(a.token, 'PUT', `/channels/${tc.id}/pins/${ids[10]}`)
await p.waitForSelector('[data-system="pins_add"]')
await p.click('[data-pins-toggle]'); await p.waitForSelector('[data-pins-panel] [data-msg-card]')
await p.locator(`[data-pins-panel] [data-msg-card="${ids[10]}"] [data-jump]`).click()
await p.waitForFunction((id) => { const el = document.querySelector(`[data-msg-id="${id}"]`); if (!el) return false; const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight }, ids[10], { timeout: 15000 })
ok('jumping to a pin 150 messages back loads one window instead of paging', await p.locator('[data-msg-id]').count() < 80 && await p.locator(`[data-msg-id="${ids[159]}"]`).count() === 0)
ok('the older-messages bar shows while in the past', await p.locator('[data-older-bar]').count() === 1)
await p.screenshot({ path: '141-window.png' })
// A live message while viewing the past does not get spliced into the window.
const live = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `live one ${S}` }); await p.waitForTimeout(600)
ok('live messages wait until Jump to Present', await p.locator(`[data-msg-id="${live.id}"]`).count() === 0)
// Scroll down pages forward.
await p.evaluate(() => { const el = document.querySelector('[data-msg-id]').closest('.overflow-y-auto'); el.scrollTop = el.scrollHeight })
await p.waitForFunction((id) => !!document.querySelector(`[data-msg-id="${id}"]`), ids[40], { timeout: 15000 })
await p.waitForTimeout(800)
ok('scrolling to the bottom of the window pages forward one page, not the whole channel', await p.locator('[data-msg-id]').count() < 120 && await p.locator('[data-older-bar]').count() === 1)
await p.click('[data-jump-present]')
await p.waitForFunction((id) => !!document.querySelector(`[data-msg-id="${id}"]`), live.id, { timeout: 15000 })
await p.waitForFunction(() => !document.querySelector('[data-older-bar]'))
ok('Jump to Present reloads the latest page including the live message and hides the bar', await p.evaluate(() => { const el = document.querySelector('[data-msg-id]').closest('.overflow-y-auto'); return el.scrollHeight - el.scrollTop - el.clientHeight < 40 }))
const after = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `after present ${S}` })
await p.waitForSelector(`[data-msg-id="${after.id}"]`); ok('live messages append again', true)
// Jump to date: today's start lands on the first message of today; a past date with nothing after it → error toast.
await p.click('[data-jump-date-btn]'); await p.waitForSelector('[data-jump-date]')
const today = new Date(); const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
await p.fill('[data-jump-date]', ymd); await p.click('[data-jump-date-go]')
await p.waitForFunction((id) => { const el = document.querySelector(`[data-msg-id="${id}"]`); if (!el) return false; const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight }, ids[0], { timeout: 15000 })
ok('jump to today scrolls to the first message of the day', await p.locator('[data-jump-date-pop]').count() === 0)
await p.screenshot({ path: '142-jump-date.png' })
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
