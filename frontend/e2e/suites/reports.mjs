import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, ok, finish, adminToken } from '../lib.mjs'

const admin = await adminToken()
// The admin queue is shared: start from an empty one so other suites' leftovers can't confuse the UI checks.
for (const r of (await call(admin.token, 'GET', '/admin/reports')) ?? []) if (r.status === 'open') await call(admin.token, 'PATCH', `/admin/reports/${r.id}`, { status: 'dismissed' })
const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Reportville ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
const bad = await call(b.token, 'POST', `/channels/${tc.id}/messages`, { content: `buy cheap stuff ${S}` })

console.log('-- API')
let r = await callS(a.token, 'POST', '/reports', { kind: 'message', message_id: bad.id, reason: '' }); ok('a reason is required', r.status === 400)
r = await callS(b.token, 'POST', '/reports', { kind: 'message', message_id: bad.id, reason: 'oops' }); ok('cannot report your own message', r.status === 400)
r = await callS(c.token, 'POST', '/reports', { kind: 'message', message_id: bad.id, reason: 'spam' }); ok('cannot report a message in a channel you cannot see', r.status === 403 || r.status === 404)
r = await callS(a.token, 'POST', '/reports', { kind: 'message', message_id: bad.id, reason: 'Spam or scam — selling junk' }); ok('alice reports the message', r.status === 201 && !!r.body.id); const rep1 = r.body.id
r = await callS(a.token, 'POST', '/reports', { kind: 'user', user_id: a.user.id, reason: 'me' }); ok('cannot report yourself', r.status === 400)
r = await callS(a.token, 'POST', '/reports', { kind: 'user', user_id: b.user.id, reason: 'Harassment or hate' }); ok('alice reports bob as a user', r.status === 201); const rep2 = r.body.id
r = await callS(a.token, 'POST', '/reports', { kind: 'thing', reason: 'x' }); ok('unknown kind refused', r.status === 400)
r = await raw(a.token, 'GET', '/admin/reports'); ok('only admins list reports', r.status === 403)
let list = await call(admin.token, 'GET', '/admin/reports')
const m = list.find((x) => x.id === rep1); const u = list.find((x) => x.id === rep2)
ok('open reports list both, newest first, with context', list[0].id === rep2 && m?.kind === 'message' && m.content === `buy cheap stuff ${S}` && m.channel_name === tc.name && m.guild_name === `Reportville ${S}` && m.target_username === `bob${S}` && m.reporter_username === `alice${S}` && m.message_exists === true && u?.kind === 'user')
ok('stats count open reports', (await call(admin.token, 'GET', '/admin/stats')).reports_open >= 2)
r = await callS(admin.token, 'DELETE', `/admin/messages/${bad.id}`); ok('admin deletes the reported message from anywhere', r.status === 204 && !(await call(a.token, 'GET', `/channels/${tc.id}/messages?limit=10`)).some((x) => x.id === bad.id))
list = await call(admin.token, 'GET', '/admin/reports')
ok('the snapshot survives deletion and is flagged', list.find((x) => x.id === rep1)?.message_exists === false && list.find((x) => x.id === rep1).content === `buy cheap stuff ${S}`)
r = await callS(admin.token, 'DELETE', `/admin/messages/${bad.id}`); ok('deleting again -> 404', r.status === 404)
r = await callS(admin.token, 'PATCH', `/admin/reports/${rep1}`, { status: 'resolved', note: 'deleted and warned' }); ok('resolve with a note', r.status === 200 && r.body.status === 'resolved' && r.body.note === 'deleted and warned' && !!r.body.resolved_at)
r = await callS(admin.token, 'PATCH', `/admin/reports/${rep2}`, { status: 'dismissed' }); ok('dismiss', r.status === 200 && r.body.status === 'dismissed')
r = await callS(admin.token, 'PATCH', `/admin/reports/${rep2}`, { status: 'weird' }); ok('bad status refused', r.status === 400)
ok('open list no longer has them; all list does', !(await call(admin.token, 'GET', '/admin/reports')).some((x) => x.id === rep1 || x.id === rep2) && (await call(admin.token, 'GET', '/admin/reports?status=all')).filter((x) => x.id === rep1 || x.id === rep2).length === 2)
const audit = await call(admin.token, 'GET', '/admin/audit')
ok('report decisions and the deletion are in the admin audit log', audit.some((e) => e.action === 'report.resolved' && e.target_id === rep1) && audit.some((e) => e.action === 'report.dismissed') && audit.some((e) => e.action === 'message.delete' && e.target_name === `bob${S}`))

console.log('-- UI')
const bad2 = await call(b.token, 'POST', `/channels/${tc.id}/messages`, { content: `more junk ${S}` })
const browser = await chromium.launch(); const errors = []
const mk = async (tok) => { const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); return p }
const pa = await mk(a.token)
await pa.goto(`${WEB}/channels/${g.id}/${tc.id}`); await pa.waitForSelector(`[data-msg-id="${bad2.id}"] .msg-content`)
await pa.click(`[data-msg-id="${bad2.id}"] .msg-content`, { button: 'right' }); await pa.waitForSelector('[data-context-menu] [data-menu-item="Report Message"]')
await pa.click('[data-context-menu] [data-menu-item="Report Message"]'); await pa.waitForSelector('[data-report-form]')
await pa.click('[data-report-reason="Spam or scam"]'); await pa.fill('[data-report-details]', 'keeps posting ads'); await pa.click('[data-report-submit]'); await pa.waitForSelector('text=your report was sent')
ok('reporting from the message menu works', (await call(admin.token, 'GET', '/admin/reports')).some((x) => x.message_id === bad2.id && x.reason === 'Spam or scam — keeps posting ads'))
await pa.click(`[data-member-row="${b.user.id}"]`, { button: 'right' }); await pa.waitForSelector('[data-context-menu] [data-menu-item="Report User"]')
await pa.click('[data-context-menu] [data-menu-item="Report User"]'); await pa.waitForSelector('[data-report-form]'); await pa.click('[data-report-reason="Something else"]'); await pa.click('[data-report-submit]'); await pa.waitForSelector('text=your report was sent')
{
  // The confirmation shows as the request goes out; give the report a moment to land.
  const found = async () => (await call(admin.token, 'GET', '/admin/reports')).some((x) => x.kind === 'user' && x.target_user_id === b.user.id && x.status === 'open')
  let yes = false; for (let i = 0; i < 20 && !(yes = await found()); i++) await pa.waitForTimeout(150)
  ok('reporting a user from the member menu works', yes)
}
await pa.close()
const pad = await mk(admin.token); await pad.goto(`${WEB}/admin/reports`); await pad.waitForSelector('[data-admin-report]')
const row = pad.locator(`[data-admin-report][data-report-kind="message"]`).first()
ok('Reports page shows the open message report with its snapshot', (await row.locator('[data-report-context]').textContent()).includes(`more junk ${S}`) && (await row.locator('[data-report-reason]').textContent()).includes('keeps posting ads'))
await pad.screenshot({ path: '105-reports.png' })
await row.locator('[data-report-delete-message]').click(); await pad.waitForSelector('text=Message deleted'); await pad.waitForFunction(() => !document.querySelector('[data-admin-report][data-report-kind="message"] [data-report-delete-message]'))
ok('Delete message removes it and the button', !(await call(a.token, 'GET', `/channels/${tc.id}/messages?limit=10`)).some((x) => x.id === bad2.id))
await row.locator('[data-report-resolve]').click(); await pad.waitForFunction((id) => !document.querySelector(`[data-admin-report][data-report-kind="message"]`), bad2.id)
await pad.click('[data-admin-report-filter="resolved"]'); await pad.waitForSelector('[data-admin-report][data-report-status="resolved"]')
ok('Resolve moves it to the resolved filter', await pad.locator('[data-admin-report][data-report-status="resolved"]').count() >= 1)
await pad.close()
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
