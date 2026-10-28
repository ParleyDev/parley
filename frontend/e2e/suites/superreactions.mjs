// Super reactions: counted apart from normal ones, limited per day, with a burst when someone adds one.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Sup ${S}` })
const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const m = await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: `react to me ${S}` })
const R = (e, burst) => `/channels/${ch.id}/messages/${m.id}/reactions/${encodeURIComponent(e)}${burst ? '?burst=true' : ''}`

console.log('-- api')
await call(b.token, 'PUT', R('🔥'))
await call(b.token, 'PUT', R('🔥', true))
let msg = (await call(a.token, 'GET', `/channels/${ch.id}/messages`)).find((x) => x.id === m.id)
ok('a normal and a super reaction of the same emoji are separate', msg.reactions.length === 2 && msg.reactions.some((r) => r.burst && r.count === 1) && msg.reactions.some((r) => !r.burst && r.count === 1), JSON.stringify(msg.reactions))
ok('reactor lists are split too', (await call(a.token, 'GET', R('🔥', true))).length === 1)
for (const e of ['😀', '🎉', '👍', '❤️']) await call(b.token, 'PUT', R(e, true))
ok('five super reactions a day', (await raw(b.token, 'PUT', R('😮', true))).status === 400)
ok('normal reactions are unlimited', (await raw(b.token, 'PUT', R('😮'))).status === 204)
await call(b.token, 'DELETE', R('🔥', true))
msg = (await call(a.token, 'GET', `/channels/${ch.id}/messages`)).find((x) => x.id === m.id)
ok('removing a super reaction leaves the normal one', msg.reactions.filter((r) => r.emoji === '🔥').length === 1 && !msg.reactions.find((r) => r.emoji === '🔥').burst)

const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message))
await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), a.token)
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector(`[data-msg-id="${m.id}"] [data-reactions]`)

console.log('-- ui')
ok('super reactions look different', await p.locator(`[data-msg-id="${m.id}"] [data-reaction-burst="1"]`).count() === 4)
ok('no burst for existing reactions on load', await p.locator('[data-burst-fx]').count() === 0)
const c = await reg('carol'); await call(c.token, 'POST', `/invites/${inv.code}`)
await call(c.token, 'PUT', R('🎉', true))
await p.waitForSelector(`[data-msg-id="${m.id}"] [data-reaction-burst="1"][data-reaction="🎉"] [data-burst-fx]`, { timeout: 4000 }).catch(() => {})
ok('a new super reaction bursts', await p.locator('[data-burst-fx]').count() >= 1)
await p.click(`[data-msg-id="${m.id}"] .msg-content`, { button: 'right' }); await p.click('[data-context-menu] [data-menu-item="Add Super Reaction"]')
await p.waitForSelector('[data-emoji-grid] [data-emoji-btn]'); await p.locator('[data-emoji-grid] [data-emoji-btn]').first().click(); await p.waitForTimeout(700)
msg = (await call(a.token, 'GET', `/channels/${ch.id}/messages`)).find((x) => x.id === m.id)
ok('Add Super Reaction from the menu', msg.reactions.some((r) => r.burst && r.me))
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
