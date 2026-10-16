import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, ok, finish } from '../lib.mjs'

const MODERATE = 1 << 29, SEND = 2048, ADD_REACTIONS = 64, CONNECT = 1 << 20, VIEW = 1024
const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Timeout Town ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`); await call(c.token, 'POST', `/invites/${inv.code}`)
const chans = await call(a.token, 'GET', `/guilds/${g.id}/channels`); const tc = chans.find((x) => x.kind === 'text'); const vc = chans.find((x) => x.kind === 'voice')
const url = (u) => `/guilds/${g.id}/members/${u.user.id}/timeout`

console.log('-- API')
ok('catalogue lists MODERATE_MEMBERS at bit 29', (await call(a.token, 'GET', '/permissions')).some((p) => p.name === 'MODERATE_MEMBERS' && p.bit === MODERATE))
let r = await callS(b.token, 'PUT', url(c), { minutes: 10 }); ok('without Timeout Members -> 403', r.status === 403)
const mods = (await callS(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Mods', permissions: MODERATE })).body
await callS(a.token, 'PATCH', `/guilds/${g.id}/members/${b.user.id}`, { roles: [mods.id] })
r = await callS(b.token, 'PUT', url(a), { minutes: 10 }); ok('cannot time out the owner', r.status === 403)
r = await callS(b.token, 'PUT', url(b), { minutes: 10 }); ok('cannot time yourself out', r.status === 400)
r = await callS(b.token, 'PUT', url(c), { minutes: 0 }); ok('duration must be at least a minute', r.status === 400)
r = await callS(b.token, 'PUT', url(c), { minutes: 28 * 24 * 60 + 1 }); ok('duration capped at 28 days', r.status === 400)
r = await callS(b.token, 'PUT', url(c), { minutes: 10 }); ok('mod times carol out for 10 minutes', r.status === 200 && r.body.user_id === c.user.id && new Date(r.body.timeout_until) - Date.now() > 9 * 60000)
const members = await call(c.token, 'GET', `/guilds/${g.id}/members`); ok('member list carries timeout_until', !!members.find((m) => m.user_id === c.user.id)?.timeout_until)
r = await raw(c.token, 'POST', `/channels/${tc.id}/messages`, { content: 'can I talk?' }); ok('timed-out carol cannot send', r.status === 403)
const msg = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: 'hello' })
r = await raw(c.token, 'PUT', `/channels/${tc.id}/messages/${msg.id}/reactions/%F0%9F%91%8D`); ok('nor react', r.status === 403)
r = await raw(c.token, 'GET', `/channels/${tc.id}/messages`); ok('but can still read', r.status === 200)
r = await raw(c.token, 'POST', `/channels/${tc.id}/typing`, {}); ok('typing is refused too', r.status === 403)
// an overwrite cannot undo it
await callS(a.token, 'PUT', `/channels/${tc.id}/permissions/${c.user.id}`, { kind: 'member', allow: SEND | ADD_REACTIONS | VIEW, deny: 0 })
r = await raw(c.token, 'POST', `/channels/${tc.id}/messages`, { content: 'overwrite?' }); ok('a member overwrite cannot lift a timeout', r.status === 403)
// owner/admin exempt even if a row says so
const adminRole = (await callS(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Admins', permissions: 8 })).body
r = await callS(a.token, 'PATCH', `/guilds/${g.id}/members/${c.user.id}`, { roles: [adminRole.id] }); ok('owner gives carol Administrator', r.status === 200)
r = await raw(c.token, 'POST', `/channels/${tc.id}/messages`, { content: 'admins are exempt' }); ok('administrators ignore an existing timeout', r.status === 201)
r = await callS(b.token, 'PUT', url(c), { minutes: 5 }); ok('mods cannot time out an admin (and cannot outrank one)', r.status === 403 || r.status === 400)
await callS(a.token, 'PATCH', `/guilds/${g.id}/members/${c.user.id}`, { roles: [] })
r = await callS(b.token, 'DELETE', url(c)); ok('mod removes the timeout', r.status === 200 && r.body.timeout_until === null)
r = await raw(c.token, 'POST', `/channels/${tc.id}/messages`, { content: 'free again' }); ok('carol can talk again', r.status === 201)
r = await callS(c.token, 'DELETE', url(b)); ok('carol (no perm) cannot clear timeouts', r.status === 403)

console.log('-- UI')
const browser = await chromium.launch(); const errors = []
const mk = async (tok) => { const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector(`[data-member-row="${c.user.id}"]`); return p }
const pb = await mk(b.token); const pc = await mk(c.token)
await pc.waitForSelector('textarea')
await pb.click(`[data-member-row="${c.user.id}"]`, { button: 'right' }); await pb.waitForSelector('[data-context-menu]')
ok('mod sees Timeout in the member menu, no Kick (no perm)', await pb.locator('[data-context-menu] [data-menu-item^="Timeout"]').count() === 1 && await pb.locator('[data-context-menu] [data-menu-item^="Kick"]').count() === 0)
await pb.click('[data-context-menu] [data-menu-item^="Timeout"]'); await pb.waitForSelector('[data-timeout-options]')
ok('modal offers six durations', await pb.locator('[data-timeout-option]').count() === 6)
await pb.click('[data-timeout-option="60"]'); await pb.click('[data-timeout-submit]'); await pb.waitForSelector(`[data-member-row="${c.user.id}"] [data-member-timeout]`)
ok('member list shows the timer badge', true)
await pb.screenshot({ path: '97-timeout-badge.png' })
await pc.waitForSelector('[data-timed-out]')
ok('carol\'s composer is replaced by the timed-out notice, live', await pc.locator('textarea').count() === 0 && /timed out in this server until/.test(await pc.textContent('[data-timed-out]')))
await pc.screenshot({ path: '98-timed-out.png' })
await pb.click(`[data-member-row="${c.user.id}"]`, { button: 'right' }); await pb.waitForSelector('[data-context-menu] [data-menu-item="Remove Timeout"]'); await pb.click('[data-context-menu] [data-menu-item="Remove Timeout"]')
await pc.waitForSelector('textarea')
ok('removing the timeout brings the composer back and clears the badge', await pb.locator(`[data-member-row="${c.user.id}"] [data-member-timeout]`).count() === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
