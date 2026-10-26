// Safety: raid protection (join spikes pause invites, flag the joiners, alert moderators), quarantine, the malicious
// link blocklist, a mass-DM cool-down, sensitive-media scopes (hide in servers), the "Leaving Parley" link check and
// the Safety Center.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, multi, pngFile, ok, finish, adminToken, openDms } from '../lib.mjs'
const admin = await adminToken()
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Safety ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
const ch = g.channels.find((x) => x.kind === 'text')
await call(a.token, 'PATCH', `/guilds/${g.id}`, { raid_threshold: 3 })

console.log('-- raid protection')
ok('raid thresholds are 3 to 100', (await raw(a.token, 'PATCH', `/guilds/${g.id}`, { raid_threshold: 1 })).status === 400)
for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const d = await reg('dave'); await call(d.token, 'POST', `/invites/${inv.code}`)
let gg = await call(a.token, 'GET', `/guilds/${g.id}`)
ok('a join spike pauses invites', gg.invites_paused === true)
const mem = await call(a.token, 'GET', `/guilds/${g.id}/members`)
ok('and flags the people who arrived in it', mem.filter((m) => m.flags?.includes('raid')).length >= 3)
const msgs = await call(a.token, 'GET', `/channels/${ch.id}/messages?limit=20`)
ok('moderators get an alert', msgs.some((m) => m.kind === 'automod_alert' && /Raid alert/.test(m.content)))
const e = await reg('erin')
ok('new people can\'t join while paused', (await raw(e.token, 'POST', `/invites/${inv.code}`)).status === 400)

console.log('-- quarantine')
ok('only moderators quarantine', (await raw(b.token, 'POST', `/guilds/${g.id}/members/${c.user.id}/quarantine`, { on: true })).status === 403)
await call(a.token, 'POST', `/guilds/${g.id}/members/${c.user.id}/quarantine`, { on: true })
ok('quarantined members can read but not post', (await raw(c.token, 'POST', `/channels/${ch.id}/messages`, { content: 'hi' })).status === 403 && (await raw(c.token, 'GET', `/channels/${ch.id}/messages?limit=1`)).status === 200)
const browser = await chromium.launch(); const errors = []
const mk = async (tok, path) => { const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), tok); await p.goto(`${WEB}${path}`); await p.waitForTimeout(1000); return p }
const pc = await mk(c.token, `/channels/${g.id}/${ch.id}`)
ok('and are told why', await pc.locator('[data-quarantined]').count() === 1)
await call(a.token, 'POST', `/guilds/${g.id}/members/${c.user.id}/quarantine`, { on: false })
ok('releasing lets them post again (and clears the raid flag)', (await raw(c.token, 'POST', `/channels/${ch.id}/messages`, { content: 'back' })).status === 201 && !(await call(a.token, 'GET', `/guilds/${g.id}/members`)).find((m) => m.user_id === c.user.id).flags.includes('raid'))

console.log('-- blocked links')
let r = await raw(b.token, 'POST', `/channels/${ch.id}/messages`, { content: 'free stuff https://grabify.link/abc' })
ok('IP loggers are blocked out of the box', r.status === 403 && /malicious/.test((await r.json()).error))
ok('subdomains too', (await raw(b.token, 'POST', `/channels/${ch.id}/messages`, { content: 'https://x.iplogger.org/z' })).status === 403)
ok('only admins edit the list', (await raw(b.token, 'POST', '/admin/blocked-domains', { domain: 'evil.example' })).status === 403)
await call(admin.token, 'POST', '/admin/blocked-domains', { domain: `phish${S}.example`, reason: 'test' })
ok('admins can add a domain', (await raw(b.token, 'POST', `/channels/${ch.id}/messages`, { content: `https://phish${S}.example/login` })).status === 403)
await call(admin.token, 'DELETE', `/admin/blocked-domains/phish${S}.example`)

console.log('-- mass DMs')
const spammer = await reg('spammy'); const targets = []
for (let i = 0; i < 16; i++) targets.push(await reg(`t${i}`))
await openDms(...targets)
let last = 0
for (const t of targets) { const dm = await call(spammer.token, 'POST', '/users/@me/channels', { recipient_id: t.user.id }); last = (await raw(spammer.token, 'POST', `/channels/${dm.id}/messages`, { content: 'buy my stuff' })).status }
ok('messaging lots of new people at once is cooled down', last === 429)

console.log('-- sensitive media')
await call(b.token, 'PATCH', '/users/@me/privacy', { sensitive_media: { servers: 'block', friend_dms: 'blur' } })
const pic = await (await multi(a.token, `/channels/${ch.id}/attachments`, pngFile)).json()
await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: 'look https://example.com', attachment_ids: [pic.id] })
const pb = await mk(b.token, `/channels/${g.id}/${ch.id}`)
ok('"Hide" in servers hides pictures, with a note', await pb.locator('[data-media-blocked]').count() >= 1 && await pb.locator('[data-attachment-img]').count() === 0)
ok('bad levels are refused', (await raw(b.token, 'PATCH', '/users/@me/privacy', { sensitive_media: { servers: 'nuke' } })).status === 400)

console.log('-- leaving and the Safety Center')
await call(b.token, 'PATCH', '/users/@me/privacy', { sensitive_media: { servers: 'show' } }); await pb.reload(); await pb.waitForTimeout(1200)
await pb.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null } })
await pb.locator('.msg-content a[href="https://example.com"]').last().click(); await pb.waitForTimeout(300)
ok('off-site links ask first', (await pb.locator('[data-leave-host]').textContent().catch(() => '')) === 'example.com')
await pb.check('[data-leave-trust]'); await pb.click('[data-leave-visit]'); await pb.waitForTimeout(200)
ok('Visit opens it', (await pb.evaluate(() => window.__opened)).includes('https://example.com/'))
const before = await pb.evaluate(() => document.querySelectorAll('[data-leave-link]').length)
await pb.locator('.msg-content a[href="https://example.com"]').last().click({ modifiers: [] }).catch(() => {}); await pb.waitForTimeout(300)
ok('trusted sites skip the question', before === 0 && await pb.locator('[data-leave-link]').count() === 0)
const ps = await mk(b.token, `/channels/${g.id}/${ch.id}`)
await ps.click('[data-control="User Settings"]'); await ps.click('button:has-text("Content & Social")'); await ps.click('[data-open-safety-center]')
ok('the Safety Center opens', await ps.locator('[data-safety-center]').count() === 1)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
