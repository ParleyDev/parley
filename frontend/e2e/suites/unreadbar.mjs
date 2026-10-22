// Server bar unread state (Discord-style): every unread DM appears under Home with its unread message count and
// leaves once read; a server (and a closed folder holding it) badges the messages that mention you.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')
await call(a.token, 'POST', '/users/@me/relationships', { user_id: b.user.id }); await call(b.token, 'PUT', `/users/@me/relationships/${a.user.id}`)
await call(a.token, 'POST', '/users/@me/relationships', { user_id: c.user.id }); await call(c.token, 'PUT', `/users/@me/relationships/${a.user.id}`)
const g1 = await call(a.token, 'POST', '/guilds', { name: `Home ${S}` }); const t1 = g1.channels.find((x) => x.kind === 'text')
const g2 = await call(b.token, 'POST', '/guilds', { name: `Pings ${S}` }); const t2 = g2.channels.find((x) => x.kind === 'text')
const inv = await call(b.token, 'POST', `/guilds/${g2.id}/invites`, {}); await call(a.token, 'POST', `/invites/${inv.code}`)
const dmB = await call(b.token, 'POST', '/users/@me/channels', { recipient_id: a.user.id })
const dmC = await call(c.token, 'POST', '/users/@me/channels', { recipient_id: a.user.id })

const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g1.id}/${t1.id}`); await p.waitForSelector('[data-guild-bar]'); await p.waitForTimeout(500)
const dmCount = (id) => p.locator(`[data-unread-dm="${id}"] [data-unread-dm-count]`).getAttribute('data-unread-dm-count').catch(() => null)
const pings = () => p.locator(`[data-guild-icon="${g2.id}"] [data-guild-mentions]`).getAttribute('data-guild-mentions').catch(() => null)
ok('clean start: no unread DMs in the server bar', await p.locator('[data-unread-dm]').count() === 0)

console.log('-- DMs')
await call(b.token, 'POST', `/channels/${dmB.id}/messages`, { content: 'hey' }); await call(b.token, 'POST', `/channels/${dmB.id}/messages`, { content: 'you there?' })
await p.waitForSelector(`[data-unread-dm="${dmB.id}"]`)
ok('an unread DM appears under Home with its message count', await dmCount(dmB.id) === '2', String(await dmCount(dmB.id)))
await call(c.token, 'POST', `/channels/${dmC.id}/messages`, { content: 'hi from carol' }); await p.waitForSelector(`[data-unread-dm="${dmC.id}"]`)
const order = await p.locator('[data-unread-dm]').evaluateAll((els) => els.map((e) => e.getAttribute('data-unread-dm')))
ok('a second DM joins the list, newest first', order.length === 2 && order[0] === dmC.id, JSON.stringify(order))
ok('Home itself carries no DM count', await p.locator('[data-home-badge]').count() === 0)

console.log('-- server mentions')
await call(b.token, 'POST', `/channels/${t2.id}/messages`, { content: `ping <@${a.user.id}>` }); await call(b.token, 'POST', `/channels/${t2.id}/messages`, { content: 'no ping here' })
await p.waitForSelector(`[data-guild-icon="${g2.id}"] [data-guild-mentions]`)
ok('the server where you were pinged shows a count of the pings only', await pings() === '1', String(await pings()))

console.log('-- after a reload (counts come from READY)')
await p.reload(); await p.waitForSelector(`[data-unread-dm="${dmB.id}"]`)
ok('DM counts survive a reload', await dmCount(dmB.id) === '2' && await dmCount(dmC.id) === '1')
ok('server ping count survives a reload', await pings() === '1')

console.log('-- folders')
await call(a.token, 'PUT', '/users/@me/guild-layout', [{ kind: 'guild', id: g1.id }, { kind: 'folder', id: `f${S}`, name: 'Stuff', color: null, guilds: [g2.id] }])
await p.reload(); await p.waitForSelector('[data-folder-tile]')
ok('a closed folder sums the pings of its servers', (await p.locator('[data-folder-tile] [data-folder-mentions]').getAttribute('data-folder-mentions')) === '1')
await call(a.token, 'PUT', '/users/@me/guild-layout', [{ kind: 'guild', id: g1.id }, { kind: 'guild', id: g2.id }]); await p.reload(); await p.waitForSelector(`[data-guild-icon="${g2.id}"]`)

console.log('-- reading clears them')
await p.click(`[data-unread-dm="${dmB.id}"]`); await p.waitForURL(`**/channels/@me/${dmB.id}`)
await p.waitForFunction((id) => !document.querySelector(`[data-unread-dm="${id}"]`), dmB.id, { timeout: 5000 }).catch(() => {})
ok('opening a DM removes it from the server bar', await p.locator(`[data-unread-dm="${dmB.id}"]`).count() === 0 && await p.locator(`[data-unread-dm="${dmC.id}"]`).count() === 1)
await p.click(`[data-unread-dm="${dmC.id}"]`, { button: 'right' }); await p.click('[data-context-menu] [data-menu-item="Mark As Read"]')
await p.waitForFunction(() => !document.querySelector('[data-unread-dm]'), null, { timeout: 5000 }).catch(() => {})
ok('Mark As Read from its menu removes it too', await p.locator('[data-unread-dm]').count() === 0)
await p.goto(`${WEB}/channels/${g2.id}/${t2.id}`); await p.waitForFunction((gid) => !document.querySelector(`[data-guild-icon="${gid}"] [data-guild-mentions]`), g2.id, { timeout: 5000 }).catch(() => {})
ok('reading the channel clears the server ping count', await p.locator(`[data-guild-icon="${g2.id}"] [data-guild-mentions]`).count() === 0)
await p.reload(); await p.waitForSelector('[data-guild-bar]'); await p.waitForTimeout(500)
ok('and they stay cleared after a reload', await p.locator('[data-unread-dm]').count() === 0 && await p.locator(`[data-guild-icon="${g2.id}"] [data-guild-mentions]`).count() === 0)

console.log('-- your own messages')
await call(a.token, 'POST', `/channels/${dmB.id}/messages`, { content: 'sent from my phone' }); await p.waitForTimeout(500)
ok('your own DM messages never count', await p.locator('[data-unread-dm]').count() === 0)

ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
