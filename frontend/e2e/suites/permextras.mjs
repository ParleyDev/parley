// More permission bits (View Audit Log, Manage Expressions, Manage Events, Manage Threads, Read Message History,
// Embed Links, Use External Emoji) and reports to a server's moderators (plus reporting a whole server).
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, multi, pngFile, ok, finish, adminToken } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Perms ${S}` }), g2 = await call(a.token, 'POST', '/guilds', { name: `Other ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const ch = g.channels.find((x) => x.kind === 'text')
const bit = (n) => 2 ** n
const staff = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Staff', permissions: bit(7) | bit(30) | bit(25) | bit(19) })
await call(a.token, 'PATCH', `/guilds/${g.id}/members/${b.user.id}`, { roles: [staff.id] })

console.log('-- narrower permissions')
ok('View Audit Log reads the audit log', (await raw(b.token, 'GET', `/guilds/${g.id}/audit`)).status === 200 && (await raw(c.token, 'GET', `/guilds/${g.id}/audit`)).status === 403)
ok('Manage Expressions adds emoji', (await multi(b.token, `/guilds/${g.id}/emojis`, pngFile, { name: 'bobs' })).status === 201 && (await multi(c.token, `/guilds/${g.id}/emojis`, pngFile, { name: 'nope' })).status === 403)
const when = new Date(Date.now() + 3600e3).toISOString()
ok('Manage Events schedules events', (await raw(b.token, 'POST', `/guilds/${g.id}/events`, { name: 'Game night', starts_at: when, location: 'here' })).status === 201 && (await raw(c.token, 'POST', `/guilds/${g.id}/events`, { name: 'x', starts_at: when, location: 'x' })).status === 403)
const t = await call(c.token, 'POST', `/channels/${ch.id}/threads`, { name: `chat ${S}` })
ok('Manage Threads locks threads', (await raw(b.token, 'PATCH', `/threads/${t.id}`, { locked: true })).status === 200)

console.log('-- @everyone defaults')
const everyone = (await call(a.token, 'GET', `/guilds/${g.id}/roles`)).find((r) => r.id === g.id)
ok('@everyone has Embed Links, Read Message History and Use External Emoji', [14, 16, 18].every((n) => (everyone.permissions & bit(n)) !== 0))
await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: 'history' })
await call(a.token, 'PATCH', `/guilds/${g.id}/roles/${g.id}`, { permissions: everyone.permissions & ~bit(16) & ~bit(14) & ~bit(18) })
ok('without Read Message History, old messages are hidden', (await call(c.token, 'GET', `/channels/${ch.id}/messages?limit=10`)).length === 0 && (await call(a.token, 'GET', `/channels/${ch.id}/messages?limit=10`)).length > 0)
ok('without Embed Links, links don\'t unfurl', (await call(c.token, 'POST', `/channels/${ch.id}/messages`, { content: 'see https://example.com' })).suppress_embeds === true)
const far = await (await multi(a.token, `/guilds/${g2.id}/emojis`, pngFile, { name: 'faraway' })).json()
const home = (await call(a.token, 'GET', `/guilds/${g.id}/emojis`)).find((e) => e.name === 'bobs')
ok('without Use External Emoji, other servers\' emoji are refused', (await raw(c.token, 'POST', `/channels/${ch.id}/messages`, { content: `<:faraway:${far.id}>` })).status === 403)
ok('but this server\'s are fine', (await raw(c.token, 'POST', `/channels/${ch.id}/messages`, { content: `<:bobs:${home.id}>` })).status === 201)
await call(a.token, 'PATCH', `/guilds/${g.id}/roles/${g.id}`, { permissions: everyone.permissions })

console.log('-- reports to moderators')
const bad = await call(c.token, 'POST', `/channels/${ch.id}/messages`, { content: `rude words ${S}` })
const browser = await chromium.launch(); const errors = []
const mk = async (tok, path) => { const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), tok); await p.goto(`${WEB}${path}`); await p.waitForTimeout(1000); return p }
const pb = await mk(b.token, `/channels/${g.id}/${ch.id}`)
await pb.locator(`[data-msg-id="${bad.id}"]`).click({ button: 'right', position: { x: 300, y: 10 } }); await pb.click('[data-menu-item="Report Message"]'); await pb.waitForSelector('[data-report-form]')
ok('in a server you can also tell its moderators', await pb.locator('[data-report-to-mods]').isChecked())
await pb.click('[data-report-submit]'); await pb.waitForTimeout(600)
const pa = await mk(a.token, `/channels/${g.id}/${ch.id}`)
await pa.locator(`button:has-text("Perms ${S}")`).first().click(); await pa.click('text=Server Settings'); await pa.click('[data-settings-tab="reports"]'); await pa.waitForSelector('[data-reports-tab]'); await pa.waitForTimeout(500)
const rep = pa.locator('[data-guild-report]').first()
ok('moderators see the report (not who sent it)', /rude words/.test(await rep.innerText()) && !(await rep.innerText()).includes(b.user.username))
await rep.locator('[data-report-resolve]').click(); await pa.waitForTimeout(500)
ok('and can resolve it', await pa.locator('[data-guild-report]').count() === 0)
ok('members without moderation can\'t read them', (await raw(c.token, 'GET', `/guilds/${g.id}/reports`)).status === 403)
const gr = await raw(c.token, 'POST', '/reports', { kind: 'guild', guild_id: g2.id, reason: 'Spam server' })
ok('a whole server can be reported', gr.status === 201)
ok('no page errors', errors.length === 0, errors.join(' | '))
// Leave the shared instance's admin queue as we found it.
const admin = await adminToken()
for (const r of await call(admin.token, 'GET', '/admin/reports')) if (r.guild_id === g.id || r.guild_id === g2.id) await call(admin.token, 'PATCH', `/admin/reports/${r.id}`, { status: 'dismissed' })
await call(a.token, 'DELETE', `/guilds/${g.id}`); await call(a.token, 'DELETE', `/guilds/${g2.id}`)
await browser.close(); await finish()
