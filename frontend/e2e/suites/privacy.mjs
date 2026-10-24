// Privacy defaults: direct messages from friends and server members only, and opt-in search (an exact username
// always works, partial matches only for people who turn "Let people find me by searching" on, friends, and admins).
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, ok, finish, adminToken } from '../lib.mjs'
const admin = await adminToken()
const a = await reg('alice'); const b = await reg('bobby'); const c = await reg('carol')

console.log('-- direct messages')
ok('new accounts take DMs from friends and server members', (await call(a.token, 'GET', '/users/@me')).dm_privacy === 'friends_and_servers')
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
let r = await raw(a.token, 'POST', `/channels/${dm.id}/messages`, { content: 'hi stranger' })
ok('a stranger who shares no server cannot DM you', r.status === 403)
const g = await call(b.token, 'POST', '/guilds', { name: `Priv ${S}` }); const inv = await call(b.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(a.token, 'POST', `/invites/${inv.code}`)
r = await raw(a.token, 'POST', `/channels/${dm.id}/messages`, { content: 'hi from the server' })
ok('sharing a server lets them', r.status === 200 || r.status === 201)
await callS(c.token, 'PATCH', '/users/@me/privacy', { dm_privacy: 'everyone' })
const dm2 = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: c.user.id })
r = await raw(a.token, 'POST', `/channels/${dm2.id}/messages`, { content: 'hi' }); ok('choosing "Everyone" still opens DMs to anyone', r.status === 200 || r.status === 201)

console.log('-- search')
const names = (list) => list.map((u) => u.username)
const part = b.user.username.slice(0, -2)
ok('a partial name does not find someone who has not opted in', !names(await call(c.token, 'GET', `/users/search?q=${part}`)).includes(b.user.username))
ok('their exact username does', names(await call(c.token, 'GET', `/users/search?q=${b.user.username.toUpperCase()}`)).includes(b.user.username))
r = await callS(c.token, 'POST', '/users/@me/relationships', { username: b.user.username }); ok('so a friend request by exact username works', r.status === 200 || r.status === 201 || r.status === 204)
ok('admins find anyone by a partial name', names(await call(admin.token, 'GET', `/users/search?q=${part}`)).includes(b.user.username))
await call(b.token, 'PUT', `/users/@me/relationships/${c.user.id}`)
ok('friends find each other by a partial name', names(await call(c.token, 'GET', `/users/search?q=${part}`)).includes(b.user.username))
const d = await reg('dave')
ok('before opting in, strangers miss them on a partial name', !names(await call(d.token, 'GET', `/users/search?q=${part}`)).includes(b.user.username))
await callS(b.token, 'PATCH', '/users/@me/privacy', { searchable: true })
ok('after opting in, a partial name finds them', names(await call(d.token, 'GET', `/users/search?q=${part}`)).includes(b.user.username))

console.log('-- settings')
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1280, height: 860 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), d.token)
await p.goto(`${WEB}/channels/@me`); await p.click('[data-control="User Settings"]'); await p.click('[data-settings-tab="social"]'); await p.waitForSelector('[data-search-section]')
ok('Content & Social shows the search setting, off by default', await p.getAttribute('[data-search-section] [role=switch]', 'aria-checked') === 'false')
ok('and the DM default is "Friends and server members"', await p.locator('input[name="dm_privacy"]').nth(1).isChecked())
await p.click('[data-search-section] [role=switch]'); await p.waitForTimeout(500)
ok('turning it on saves it', (await call(d.token, 'GET', '/users/@me')).searchable === true)
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
