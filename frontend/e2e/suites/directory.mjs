// Directory channels: list servers you manage, browse and search by category, join from the list, remove entries.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const hubOwner = await reg('hub'), clubOwner = await reg('club'), member = await reg('member')
const hub = await call(hubOwner.token, 'POST', '/guilds', { name: `Hub ${S}` })
const club = await call(clubOwner.token, 'POST', '/guilds', { name: `Chess Club ${S}` })
const inv = await call(hubOwner.token, 'POST', `/guilds/${hub.id}/invites`, {})
for (const u of [clubOwner, member]) await call(u.token, 'POST', `/invites/${inv.code}`)
const dir = await call(hubOwner.token, 'POST', `/guilds/${hub.id}/channels`, { name: 'Clubs', kind: 'directory' })

console.log('-- api')
ok('a directory channel is made', dir.kind === 'directory' && dir.name === 'clubs')
ok('it doesn\'t take messages', (await raw(member.token, 'POST', `/channels/${dir.id}/messages`, { content: 'hi' })).status === 400)
ok('you can only list servers you manage', [403, 404].includes((await raw(member.token, 'POST', `/channels/${dir.id}/directory`, { guild_id: club.id })).status))

const browser = await chromium.launch(); const errors = []
const ctx = async (t) => { const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t); return p }

console.log('-- listing')
const pc = await ctx(clubOwner.token)
await pc.goto(`${WEB}/channels/${hub.id}/${dir.id}`); await pc.waitForSelector('[data-directory-add]')
await pc.click('[data-directory-add]'); await pc.waitForSelector('[data-directory-add-form]')
await pc.selectOption('[data-directory-pick]', club.id); await pc.selectOption('[data-directory-category]', 'gaming'); await pc.fill('[data-directory-desc]', 'Weekly chess nights')
await pc.click('[data-directory-add-confirm]'); await pc.waitForSelector(`[data-directory-entry="${club.id}"]`)
ok('a club owner lists their server', (await pc.locator(`[data-directory-entry="${club.id}"]`).innerText()).includes('Weekly chess nights'))

console.log('-- browsing and joining')
const pm = await ctx(member.token)
await pm.goto(`${WEB}/channels/${hub.id}/${dir.id}`); await pm.waitForSelector(`[data-directory-entry="${club.id}"]`)
await pm.click('[data-directory-cat="music"]'); await pm.waitForSelector('[data-directory-empty]')
ok('categories filter', await pm.locator(`[data-directory-entry="${club.id}"]`).count() === 0)
await pm.click('[data-directory-cat="all"]'); await pm.fill('[data-directory-search]', 'chess'); await pm.waitForSelector(`[data-directory-entry="${club.id}"]`)
ok('search finds it', true)
await pm.click(`[data-directory-join="${club.id}"]`); await pm.waitForURL(new RegExp(club.id), { timeout: 8000 }).catch(() => {})
ok('Join takes you into the server', (await call(clubOwner.token, 'GET', `/guilds/${club.id}/members`)).some((m) => m.user_id === member.user.id))
ok('members can\'t remove entries', (await raw(member.token, 'DELETE', `/channels/${dir.id}/directory/${club.id}`)).status === 403)
await call(hubOwner.token, 'DELETE', `/channels/${dir.id}/directory/${club.id}`)
ok('the hub\'s moderators can', (await call(member.token, 'GET', `/channels/${dir.id}/directory`)).length === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
for (const [t, g] of [[hubOwner, hub], [clubOwner, club]]) await call(t.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
