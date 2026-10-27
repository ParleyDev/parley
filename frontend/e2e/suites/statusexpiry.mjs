// Statuses that end on their own: Idle / Do Not Disturb / Invisible for a set time (then Online again, which others
// see live) and a custom status with "Clear after". The test moves expiry times into the past in the test database
// rather than waiting an hour.
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { WEB, S, reg, call, raw, ok, finish, testContainer } from '../lib.mjs'
const DB = testContainer('db')
const sql = (q) => execSync(`docker exec ${DB} psql -U parley -tAc "${q}"`).toString().trim()
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Status ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const ch = g.channels.find((x) => x.kind === 'text')
const me = () => call(a.token, 'GET', '/users/@me')
const mins = (iso) => (new Date(iso).getTime() - Date.now()) / 60000

console.log('-- API')
ok('durations stay between a minute and 3 days', (await raw(a.token, 'PATCH', '/users/@me', { status: 'dnd', status_for_secs: 10 })).status === 400 && (await raw(a.token, 'PATCH', '/users/@me', { status: 'dnd', status_for_secs: 4 * 86400 })).status === 400)
await call(a.token, 'PATCH', '/users/@me', { status: 'dnd', status_for_secs: 3600 })
let u = await me()
ok('Do Not Disturb for 1 hour records when it ends', u.status === 'dnd' && Math.abs(mins(u.status_expires_at) - 60) < 2)
await call(a.token, 'PATCH', '/users/@me', { status: 'idle' })
ok('picking a status without a duration keeps it', (await me()).status_expires_at === null)
await call(a.token, 'PATCH', '/users/@me', { custom_status: 'Out to lunch', custom_status_for_secs: 1800 })
ok('a custom status can clear after 30 minutes', Math.abs(mins((await me()).custom_status_expires_at) - 30) < 2)

console.log('-- expiry')
const browser = await chromium.launch(); const errors = []
const pb = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); pb.on('pageerror', (e) => errors.push(e.message))
await pb.goto(`${WEB}/login`); await pb.evaluate((t) => localStorage.setItem('parley.token', t), b.token)
await pb.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pb.waitForSelector('[data-member-list]')
// Alice needs to be connected to show as Online at all.
const pa0 = await (await browser.newContext()).newPage()
await pa0.goto(`${WEB}/login`); await pa0.evaluate((t) => localStorage.setItem('parley.token', t), a.token); await pa0.goto(`${WEB}/channels/@me`); await pa0.waitForTimeout(1200)
await call(a.token, 'PATCH', '/users/@me', { status: 'dnd', status_for_secs: 3600 })
await pb.waitForFunction(() => /^Do Not Disturb/.test([...document.querySelectorAll('[data-member-list] button')].find((x) => x.textContent.includes('Alice'))?.querySelector('[data-presence]')?.getAttribute('title') ?? ''), null, { timeout: 8000 }).catch(() => {})
sql(`UPDATE users SET status_expires_at = now() - interval '1 second', custom_status_expires_at = now() - interval '1 second' WHERE id = '${a.user.id}'`)
const back = await pb.waitForFunction(() => /^Online/.test([...document.querySelectorAll('[data-member-list] button')].find((x) => x.textContent.includes('Alice'))?.querySelector('[data-presence]')?.getAttribute('title') ?? ''), null, { timeout: 25000 }).then(() => true).catch(() => false)
ok('when the time is up others see them Online again', back)
u = await me()
ok('and the custom status has cleared', u.status === 'online' && u.custom_status === '' && !u.status_expires_at && !u.custom_status_expires_at, JSON.stringify({ s: u.status, c: u.custom_status }))

console.log('-- picking a duration')
const pa = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); pa.on('pageerror', (e) => errors.push(e.message))
await pa.goto(`${WEB}/login`); await pa.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await pa.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pa.waitForSelector('[data-user-panel-bar]'); await pa.waitForTimeout(500)
await pa.click('[data-panel-self]')
await pa.click('[data-status-menu]'); await pa.click('[data-status-durations="idle"]'); await pa.click('[data-status-duration-list="idle"] [data-status-for="28800"]'); await pa.waitForTimeout(600)
u = await me()
ok('the menu sets Idle for 8 hours', u.status === 'idle' && Math.abs(mins(u.status_expires_at) - 480) < 2)
await pa.click('[data-panel-self]')
ok('and says until when', /until/.test(await pa.locator('[data-status-until]').innerText().catch(() => '')))
await pa.click('[data-set-status]'); await pa.fill('[data-custom-status-input]', 'Focusing'); await pa.selectOption('[data-clear-after]', '3600'); await pa.click('[role=dialog] button:has-text("Save")'); await pa.waitForTimeout(600)
u = await me()
ok('Clear after 1 hour', u.custom_status === 'Focusing' && Math.abs(mins(u.custom_status_expires_at) - 60) < 2)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
