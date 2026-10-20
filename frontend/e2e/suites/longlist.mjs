// Long channels: the loaded list is a bounded window (400 rows); paging back past it drops the newest and the pane pages
// forward again on the way down, so the DOM never holds a whole channel.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const users = []; for (const n of ['alice', 'bob', 'carol', 'dave', 'erin', 'fay', 'gus', 'hal', 'ivy', 'jo']) users.push(await reg(n))
const [a] = users
const g = await call(a.token, 'POST', '/guilds', { name: `Long ${S}` }); const tc = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of users.slice(1)) await call(u.token, 'POST', `/invites/${inv.code}`)
const ids = []
for (let i = 0; i < 480; i++) { const m = await call(users[i % users.length].token, 'POST', `/channels/${tc.id}/messages`, { content: `row ${i} ${S}` }); if (!m?.id) throw new Error(`post ${i} failed ${JSON.stringify(m)}`); ids.push(m.id) }
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector(`[data-msg-id="${ids[479]}"]`)
const scroller = () => p.evaluate(() => { const el = document.querySelector('[data-msg-id]').closest('.overflow-y-auto'); return { top: el.scrollTop, h: el.scrollHeight } })
// Page back to the very first message.
for (let i = 0; i < 25 && !(await p.locator(`[data-msg-id="${ids[0]}"]`).count()); i++) { await p.evaluate(() => { const el = document.querySelector('[data-msg-id]').closest('.overflow-y-auto'); el.scrollTop = 0 }); await p.waitForTimeout(400) }
ok('the first message is reachable by scrolling up', await p.locator(`[data-msg-id="${ids[0]}"]`).count() === 1)
const n = await p.locator('[data-msg-id]').count()
ok('the DOM holds a bounded window, not the whole channel', n <= 410 && n >= 300, String(n))
ok('the newest message was dropped from the window and the older-messages pill shows', await p.locator(`[data-msg-id="${ids[479]}"]`).count() === 0 && await p.locator('[data-older-bar]').count() === 1)
await p.screenshot({ path: '149-long-window.png' })
await p.evaluate(() => { const el = document.querySelector('[data-msg-id]').closest('.overflow-y-auto'); el.scrollTop = el.scrollHeight })
await p.waitForFunction((id) => !!document.querySelector(`[data-msg-id="${id}"]`), ids[420], { timeout: 15000 })
ok('scrolling down pages forward again', (await p.locator('[data-msg-id]').count()) <= 410)
await p.click('[data-jump-present]')
await p.waitForFunction((id) => !!document.querySelector(`[data-msg-id="${id}"]`), ids[479], { timeout: 15000 })
await p.waitForFunction(() => !document.querySelector('[data-older-bar]'))
ok('Jump to Present returns to the newest page', (await scroller()).top > 0)
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
