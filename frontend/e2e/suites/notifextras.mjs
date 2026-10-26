// The server Notification Settings dialog (mute, level, suppressions, highlights, events, mobile push, channel
// overrides) and Highlights in the Inbox (busy messages from your servers).
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Notif ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const ch = g.channels.find((x) => x.kind === 'text')
const other = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'quiet-room', kind: 'text' })
const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message))
await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), b.token)
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForTimeout(1000)
const mine = async () => (await call(b.token, 'GET', '/users/@me/notification-settings')).find((n) => n.target_id === g.id) ?? {}

console.log('-- dialog')
await p.locator(`button:has-text("Notif ${S}")`).first().click(); await p.click('text=Notification Settings'); await p.waitForSelector(`[data-guild-notifications="${g.id}"]`)
await p.selectOption('[data-gn-mute-for]', '60'); await p.click('[data-gn-mute]'); await p.waitForTimeout(400)
ok('mute for an hour', new Date((await mine()).muted_until).getTime() - Date.now() > 50 * 60e3)
await p.click('[data-gn-unmute]'); await p.waitForTimeout(400)
ok('and unmute', !(await mine()).muted_until)
// Controlled inputs settle after the save answers, so click and wait rather than check().
for (const sel of ['[data-gn-level="mentions"]', '[data-gn="mobile_push"]', '[data-gn="mute_events"]', '[data-gn="suppress_roles"]']) { await p.click(sel); await p.waitForTimeout(300) }
const s1 = await mine()
ok('level and switches are saved', s1.level === 'mentions' && s1.mobile_push === false && s1.mute_events === true && s1.suppress_roles === true, JSON.stringify(s1))
await p.selectOption('[data-gn-add-channel]', other.id); await p.click('[data-gn-add]'); await p.waitForTimeout(500)
ok('channel overrides can be added', await p.locator(`[data-gn-override="${other.id}"]`).count() === 1)
await p.keyboard.press('Escape'); await p.waitForTimeout(200)

console.log('-- highlights')
const hot = await call(c.token, 'POST', `/channels/${ch.id}/messages`, { content: `big news ${S}` })
for (const u of [a, c]) await call(u.token, 'PUT', `/channels/${ch.id}/messages/${hot.id}/reactions/${encodeURIComponent('🔥')}`)
await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: 'wow', reply_to: hot.id })
await call(c.token, 'POST', `/channels/${ch.id}/messages`, { content: `quiet ${S}` })
await p.click('[data-inbox-toggle]'); await p.click('[data-inbox-tab="highlights"]'); await p.waitForTimeout(800)
ok('Highlights shows the busy message', await p.locator(`[data-inbox-highlight="${hot.id}"]`).count() === 1)
ok('and not the quiet one', !(await p.locator('[data-inbox-highlights]').innerText()).includes(`quiet ${S}`))
await call(b.token, 'PUT', `/users/@me/notification-settings/${g.id}`, { suppress_highlights: true })
ok('suppressing highlights for a server hides them', !(await call(b.token, 'GET', '/users/@me/highlights')).some((m) => m.id === hot.id))
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
