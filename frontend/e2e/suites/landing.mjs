// Where a channel opens: on your own NEW line or at the bottom. A webhook you created posts as you, but its posts
// aren't yours: reading them moves your read pointer on the server, so a reload doesn't land you back above them.
// A window kept from an old jump is replaced by the newest messages when you come back.
import { chromium } from 'playwright'
import { WEB, B, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Land ${S}` })
const ann = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'announcements', kind: 'text', news: true })
const other = g.channels.find((x) => x.kind === 'text')
await call(a.token, 'PATCH', `/guilds/${g.id}`, { system_channel_id: ann.id })
const first = await call(a.token, 'POST', `/channels/${ann.id}/messages`, { content: 'welcome everyone' })
const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${other.id}`); await p.waitForSelector('textarea'); await p.waitForTimeout(800)
const where = async () => { await p.waitForTimeout(1200); return p.evaluate(() => { const sc = document.querySelector('[data-msg-id]')?.closest('.overflow-y-auto'); return { bottom: sc ? Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight) < 40 : false, divider: !!document.querySelector('[data-unread-divider]') } }) }

console.log('-- your own webhook')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const wh = await call(a.token, 'POST', `/channels/${ann.id}/webhooks`, { name: 'Bot' })
await fetch(`${B}/webhooks/${wh.id}/${wh.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Release notes\n'.repeat(30), username: 'Parley' }) })
await p.waitForTimeout(800)
ok('a post from your webhook counts as new for you', await p.locator(`[data-channel-item] a[href="/channels/${g.id}/${ann.id}"]`).evaluate((el) => el.closest('[data-channel-item]').matches('[data-unread], :has([data-unread])') || el.className.includes('text-text-0')).catch(() => false))
await p.click(`a[href="/channels/${g.id}/${ann.id}"]`)
let w = await where(); ok('opening shows the new line', w.divider, JSON.stringify(w))
await p.evaluate(() => { const sc = document.querySelector('[data-msg-id]').closest('.overflow-y-auto'); sc.scrollTop = sc.scrollHeight }); await p.waitForTimeout(800)
await p.click(`a[href="/channels/${g.id}/${other.id}"]`); await p.waitForTimeout(600)
await p.click(`a[href="/channels/${g.id}/${ann.id}"]`)
w = await where(); ok('coming back lands at the bottom', w.bottom && !w.divider, JSON.stringify(w))
await p.reload(); await p.waitForSelector('[data-msg-id]')
w = await where(); ok('and so does a reload: the server moved your read pointer', w.bottom && !w.divider, JSON.stringify(w))

console.log('-- a window from an old jump')
for (let i = 0; i < 70; i++) await call(b.token, 'POST', `/channels/${other.id}/messages`, { content: `filler ${i}` })
const page = await call(a.token, 'GET', `/channels/${other.id}/messages?limit=100`); const old = page.reduce((m, x) => (x.id < m.id ? x : m))
await p.goto(`${WEB}/channels/${g.id}/${other.id}?message=${old.id}`); await p.waitForTimeout(1500)
await p.click(`a[href="/channels/${g.id}/${ann.id}"]`); await p.waitForTimeout(600)
await p.click(`a[href="/channels/${g.id}/${other.id}"]`)
w = await where(); const metrics = await p.evaluate(() => { const sc = document.querySelector('[data-msg-id]').closest('.overflow-y-auto'); const ids = [...document.querySelectorAll('[data-msg-id]')].map((e) => e.textContent.slice(0, 20)); return { sh: sc.scrollHeight, st: Math.round(sc.scrollTop), ch: sc.clientHeight, n: ids.length, first: ids[0], last: ids.at(-1), bar: !!document.querySelector('[data-older-bar]') } })
console.log(JSON.stringify(metrics))
const has69 = await p.evaluate(() => [...document.querySelectorAll('[data-msg-id] .msg-content')].some((e) => e.textContent.trim() === 'filler 69'))
ok('coming back to it shows the newest messages', w.bottom && has69, JSON.stringify({ ...w, has69 }))
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
