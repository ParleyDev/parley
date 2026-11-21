// Reports that say what kind of problem they are about: child-safety, threat, self-harm and intimate-image reports
// are handled first, the ones that must never reach a server's own moderators do not, one person cannot flood the
// queue, and what was reported is copied when the report is sent (so deleting it afterwards hides nothing), kept
// on a legal hold when asked.
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { B, WEB, S, reg, call, callS, ok, finish, adminToken, openDms, PNG } from '../lib.mjs'

const admin = await adminToken()
for (const r of (await call(admin.token, 'GET', '/admin/reports')) ?? []) if (r.status === 'open') await call(admin.token, 'PATCH', `/admin/reports/${r.id}`, { status: 'dismissed' })
const a = await reg('alice'); const b = await reg('bob'); const flood = await reg('flood')
const mod = await reg('modder'); await call(admin.token, 'PUT', `/admin/users/${mod.user.id}/roles`, { roles: ['MODERATOR'] })
const g = await call(a.token, 'POST', '/guilds', { name: `Safeville ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, flood]) await call(u.token, 'POST', `/invites/${inv.code}`)
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
const say = (u, content, extra = {}) => call(u.token, 'POST', `/channels/${tc.id}/messages`, { content, ...extra })
const upload = async (t, data, name) => { const f = new FormData(); f.append('file', new Blob([data], { type: 'image/png' }), name); const r = await fetch(`${B}/channels/${tc.id}/attachments`, { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: f }); return r.json() }
const listOpen = () => call(admin.token, 'GET', '/admin/reports')

console.log('-- kinds of report')
const plain = await say(b, `ordinary nuisance ${S}`)
let r = await callS(a.token, 'POST', '/reports', { kind: 'message', message_id: plain.id, reason: 'Spam or scam', category: 'spam', to_mods: true }); const repSpam = r.body.id
ok('a report carries its kind', r.status === 201 && (await listOpen()).find((x) => x.id === repSpam)?.category === 'spam')
let row = (await listOpen()).find((x) => x.id === repSpam); ok('(spam: not urgent, sent to the moderators)', row.urgent === false && row.to_mods === true, JSON.stringify(row))
r = await callS(a.token, 'POST', '/reports', { kind: 'user', user_id: b.user.id, reason: 'x', category: 'made_up' })
ok('an unknown kind is filed as "other"', r.status === 201 && (await listOpen()).find((x) => x.id === r.body.id)?.category === 'other')
r = await callS(a.token, 'POST', '/reports', { kind: 'user', user_id: b.user.id, reason: 'x' })
ok('a report without a kind (older apps) is filed as "other"', r.status === 201 && (await listOpen()).find((x) => x.id === r.body.id)?.category === 'other')

// A message with a picture, and talk around it.
await say(a, `before one ${S}`); await say(a, `before two ${S}`)
const pic = await upload(b.token, PNG, 'thing.png')
const bad = await say(b, `the reported words ${S}`, { attachment_ids: [pic.id] })
await say(a, `after one ${S}`)
r = await callS(a.token, 'POST', '/reports', { kind: 'message', message_id: bad.id, reason: 'An adult pursuing a child — keeps asking her age', category: 'child_grooming', to_mods: true }); const repChild = r.body.id
row = (await listOpen()).find((x) => x.id === repChild)
ok('a child-safety report is urgent', r.status === 201 && row.urgent === true && row.category === 'child_grooming', JSON.stringify(row))
ok("it never goes to the server's moderators, even when asked", row.to_mods === false)
ok("(the server's own report list does not have it)", !JSON.stringify(await call(a.token, 'GET', `/guilds/${g.id}/reports`) ?? []).includes(repChild))
r = await callS(a.token, 'POST', '/reports', { kind: 'user', user_id: b.user.id, reason: 'later and ordinary', category: 'harassment' }); const repLater = r.body.id
let list = await listOpen()
ok('urgent reports come first, ahead of newer ordinary ones', list[0].id === repChild && list.findIndex((x) => x.id === repLater) > 0, list.slice(0, 3).map((x) => x.category).join())
for (const [cat, urgent] of [['child_sexual_content', true], ['minor_in_adult_space', true], ['intimate_image', true], ['threat', true], ['self_harm', true], ['underage_user', false], ['illegal', false]]) {
  r = await callS(b.token, 'POST', '/reports', { kind: 'user', user_id: a.user.id, reason: cat, category: cat, guild_id: g.id, to_mods: true })
  const x = (await listOpen()).find((y) => y.id === r.body.id)
  ok(`${cat}: ${urgent ? 'urgent' : 'not urgent'}`, r.status === 201 && x?.urgent === urgent, JSON.stringify(x))
  if (['child_sexual_content', 'minor_in_adult_space', 'intimate_image'].includes(cat)) ok(`${cat}: kept from the server's moderators`, x.to_mods === false)
  if (cat === 'threat') ok('a threat can still go to the server\'s moderators', x.to_mods === true)
}

console.log('-- one person cannot flood the queue')
let codes = []
for (let i = 0; i < 12; i++) codes.push((await callS(flood.token, 'POST', '/reports', { kind: 'user', user_id: b.user.id, reason: `again ${i}`, category: 'spam' })).status)
ok('ten ordinary reports an hour, then a plain refusal', codes.slice(0, 10).every((c) => c === 201) && codes[10] === 429 && codes[11] === 429, codes.join())
r = await callS(flood.token, 'POST', '/reports', { kind: 'user', user_id: b.user.id, reason: 'one more', category: 'other' })
ok('the refusal says when to try again', r.status === 429 && /Try again in \d+ minutes/.test(r.body?.error ?? ''), JSON.stringify(r.body))
r = await callS(flood.token, 'POST', '/reports', { kind: 'message', message_id: bad.id, reason: 'this is serious', category: 'child_sexual_content' })
ok('an urgent report is not held back by earlier ordinary ones', r.status === 201)
codes = []; for (let i = 0; i < 31; i++) codes.push((await callS(flood.token, 'POST', '/reports', { kind: 'user', user_id: b.user.id, reason: `urgent ${i}`, category: 'threat' })).status)
ok('urgent reports have their own, larger allowance (30 an hour)', codes.slice(0, 29).every((c) => c === 201) && codes[29] === 429 && codes[30] === 429, codes.join())
for (const x of await listOpen()) if (x.reporter_id === flood.user.id) await call(admin.token, 'PATCH', `/admin/reports/${x.id}`, { status: 'dismissed' })

console.log('-- what was reported is kept')
r = await callS(a.token, 'GET', `/admin/reports/${repChild}/evidence`); ok('only the admin team reads it', r.status === 403)
r = await callS(admin.token, 'GET', `/admin/reports/${repChild}/evidence`); let ev = r.body
ok('the report keeps the account as it looked', r.status === 200 && ev.evidence?.profile?.username === `bob${S}` && !!ev.evidence.captured_at, JSON.stringify(ev).slice(0, 300))
ok('the reported message, with its file named', ev.evidence.message?.content === `the reported words ${S}` && ev.evidence.message.attachments?.[0]?.filename === 'thing.png')
ok('and what was said around it', ev.evidence.before?.some((m) => m.content === `before two ${S}`) && ev.evidence.after?.some((m) => m.content === `after one ${S}`) && ev.evidence.before.at(-1).content === `before two ${S}`, JSON.stringify(ev.evidence.before?.map((m) => m.content)))
const sha = createHash('sha256').update(PNG).digest('hex')
ok('a copy of the file is held, with its SHA-256', ev.files?.length === 1 && ev.files[0].kept === true && ev.files[0].sha256 === sha && ev.files[0].filename === 'thing.png', JSON.stringify(ev.files))
ok('the answer never carries the file or a link to it', !JSON.stringify(ev).includes('/api/attachments/') && !JSON.stringify(ev).includes('"url"'))
ok('(retention is stated)', ev.retention_days === 365 && ev.legal_hold === false)
ok('reading it is in the audit log', (await call(admin.token, 'GET', '/admin/audit')).some((e) => e.action === 'report.evidence' && e.target_id === repChild))
// The author deletes everything they can.
await call(b.token, 'DELETE', `/channels/${tc.id}/messages/${bad.id}`)
ok('(the message and its file are gone)', !(await call(a.token, 'GET', `/channels/${tc.id}/messages?limit=20`)).some((m) => m.id === bad.id))
ev = (await callS(admin.token, 'GET', `/admin/reports/${repChild}/evidence`)).body
ok('deleting the message afterwards hides nothing', ev.evidence.message?.content === `the reported words ${S}` && ev.files[0].kept === true && (await listOpen()).find((x) => x.id === repChild).message_exists === false)
// A direct message: the reported message only.
await openDms(a, b); const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: `private before ${S}` })
const dmBad = await call(b.token, 'POST', `/channels/${dm.id}/messages`, { content: `private threat ${S}` })
r = await callS(a.token, 'POST', '/reports', { kind: 'message', message_id: dmBad.id, reason: 'Threat of violence', category: 'threat' }); const repDm = r.body.id
ev = (await callS(admin.token, 'GET', `/admin/reports/${repDm}/evidence`)).body
ok('a direct-message report keeps the reported message and none of the conversation around it', r.status === 201 && ev.evidence.message?.content === `private threat ${S}` && ev.evidence.before === undefined && ev.evidence.after === undefined && ev.evidence.channel?.private === true && !JSON.stringify(ev).includes('private before'), JSON.stringify(ev).slice(0, 300))
ev = (await callS(admin.token, 'GET', `/admin/reports/${repLater}/evidence`)).body
ok('a report about a person keeps their profile', ev.evidence?.profile?.username === `bob${S}` && ev.evidence.message === undefined && ev.files.length === 0)

console.log('-- legal hold')
r = await callS(mod.token, 'GET', `/admin/reports/${repChild}/evidence`); ok('a moderator can read what was kept', r.status === 200)
r = await callS(mod.token, 'POST', `/admin/reports/${repChild}/hold`, { on: true }); ok('but cannot set a legal hold', r.status === 403)
r = await callS(a.token, 'POST', `/admin/reports/${repChild}/hold`, { on: true }); ok('nor can a member', r.status === 403)
r = await callS(admin.token, 'POST', `/admin/reports/${repChild}/hold`, { on: true }); ok('a trust-and-safety lead puts it on hold', r.status === 200 && r.body.legal_hold === true)
ok('the hold shows with what was kept', (await callS(admin.token, 'GET', `/admin/reports/${repChild}/evidence`)).body.legal_hold === true)
r = await callS(admin.token, 'POST', `/admin/reports/${repSpam}/hold`, { on: true }); r = await callS(admin.token, 'POST', `/admin/reports/${repSpam}/hold`, { on: false }); ok('and lifts one', r.status === 200 && r.body.legal_hold === false)
r = await callS(admin.token, 'POST', `/admin/reports/${crypto.randomUUID()}/hold`, { on: true }); ok('no such report -> 404', r.status === 404)
const audit = await call(admin.token, 'GET', '/admin/audit')
ok('holds are in the audit log', audit.some((e) => e.action === 'report.hold' && e.target_id === repChild) && audit.some((e) => e.action === 'report.unhold' && e.target_id === repSpam))

console.log('-- UI: reporting')
const browser = await chromium.launch(); const errors = []
const mk = async (tok, viewport = { width: 1440, height: 900 }) => { const p = await browser.newPage({ viewport }); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); return p }
const bad2 = await say(b, `come to my private chat ${S}`)
const pa = await mk(a.token)
await pa.goto(`${WEB}/channels/${g.id}/${tc.id}`); await pa.waitForSelector(`[data-msg-id="${bad2.id}"] .msg-content`)
const openReport = async () => { await pa.click(`[data-msg-id="${bad2.id}"] .msg-content`, { button: 'right' }); await pa.click('[data-context-menu] [data-menu-item="Report Message"]'); await pa.waitForSelector('[data-report-form]') }
await openReport()
ok('an ordinary reason shows no urgent note and offers the moderators', await pa.locator('[data-report-urgent]').count() === 0 && await pa.locator('[data-report-to-mods]').count() === 1 && await pa.locator('[data-report-sub]').count() === 0)
await pa.click('[data-report-reason="Threat of violence"]')
ok('a threat: looked at first, call emergency services, moderators still offered', await pa.locator('[data-report-urgent="threat"] [data-report-emergency]').count() === 1 && await pa.locator('[data-report-to-mods]').count() === 1 && await pa.locator('[data-report-instance-only]').count() === 0)
await pa.click('[data-report-reason="Child safety"]')
ok('"A child is at risk" asks which kind', await pa.locator('[data-report-sub] [data-report-category]').count() === 4)
ok('sexual content: do not save or forward it, and it goes to the instance team only', await pa.locator('[data-report-urgent="child_sexual_content"] [data-report-no-copy]').count() === 1 && await pa.locator('[data-report-instance-only]').count() === 1 && await pa.locator('[data-report-to-mods]').count() === 0)
await pa.screenshot({ path: 'reportsafety-dialog.png' })
await pa.click('[data-report-reason="Someone too young to be here"]')
ok('an underage account is an ordinary report', await pa.locator('[data-report-urgent]').count() === 0 && await pa.locator('[data-report-to-mods]').count() === 1)
await pa.click('[data-report-reason="An adult pursuing a child"]'); await pa.fill('[data-report-details]', 'asked her to move to a private chat')
ok('the dialog fits the window with every choice showing', await pa.evaluate(() => { const f = document.querySelector('[data-report-submit]').getBoundingClientRect(); return f.bottom <= innerHeight && f.top > 0 }))
await pa.click('[data-report-submit]'); await pa.waitForSelector('text=your report was sent to the admins')
let filed; for (let i = 0; i < 20 && !(filed = (await listOpen()).find((x) => x.message_id === bad2.id)); i++) await pa.waitForTimeout(150)
ok('it is filed as urgent, with the words chosen, for the instance team only', filed?.category === 'child_grooming' && filed.urgent && filed.to_mods === false && filed.reason === 'An adult pursuing a child — asked her to move to a private chat', JSON.stringify(filed))
ok('the confirmation does not claim the moderators were told', await pa.locator("text=and this server's moderators").count() === 0)
await pa.close()

console.log('-- UI: the queue')
const pad = await mk(admin.token); await pad.goto(`${WEB}/admin/reports`); await pad.waitForSelector('[data-admin-report]')
const first = pad.locator('[data-admin-report]').first()
ok('urgent reports are at the top, marked', await first.getAttribute('data-report-urgent') === '1' && await first.locator('[data-report-urgent-badge]').count() === 1)
const card = pad.locator(`[data-admin-report="${repChild}"]`)
ok('each report names what it is about', (await card.locator('[data-report-category-label]').textContent()) === 'An adult pursuing a child' && (await pad.locator(`[data-admin-report="${repLater}"] [data-report-category-label]`).textContent()) === 'Harassment or hate')
ok('the one on hold says so', await card.locator('[data-report-hold-badge]').count() === 1 && await pad.locator(`[data-admin-report="${repLater}"] [data-report-hold-badge]`).count() === 0)
await card.locator('[data-report-evidence-toggle]').click(); await card.locator('[data-report-evidence]').waitFor()
ok('"What was kept" shows the message, marked, with the talk around it', (await card.locator('[data-evidence-line="reported"]').textContent()).includes(`the reported words ${S}`) && await card.locator('[data-evidence-line="around"]').count() >= 3)
ok('the file is described and its copy held, not shown', await card.locator('[data-evidence-file="kept"]').count() === 1 && (await card.locator('[data-evidence-files]').textContent()).includes(sha) && await card.locator('[data-report-evidence] img, [data-report-evidence] a').count() === 0)
ok('it says how long it is kept', (await card.locator('[data-evidence-retention]').textContent()).includes('On legal hold'))
await pad.screenshot({ path: 'reportsafety-queue.png' })
await card.locator('[data-report-hold-toggle]').click(); await pad.waitForSelector('text=Legal hold lifted')
await pad.waitForFunction((id) => document.querySelector(`[data-admin-report="${id}"]`)?.getAttribute('data-report-hold') === '0', repChild)
ok('lifting the hold from the queue', (await card.locator('[data-evidence-retention]').textContent()).includes('365 days') && (await listOpen()).find((x) => x.id === repChild).legal_hold === false)
await card.locator('[data-report-evidence-toggle]').click(); ok('and the kept copy folds away', await card.locator('[data-report-evidence]').count() === 0)
await pad.close()
const pm = await mk(mod.token); await pm.goto(`${WEB}/admin/reports`); await pm.waitForSelector('[data-admin-report]')
ok('a moderator sees what was kept but no hold button', await pm.locator('[data-report-evidence-toggle]').count() > 0 && await pm.locator('[data-report-hold-toggle]').count() === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
for (const x of await listOpen()) await call(admin.token, 'PATCH', `/admin/reports/${x.id}`, { status: 'dismissed' })
await finish()
