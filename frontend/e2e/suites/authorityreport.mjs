// Reporting to the authorities: a report about child sexual content or an adult pursuing a child cannot be closed
// until the report that was filed (or the decision that none was needed) is on record, and the export gives what a
// hotline form asks for, for a report and for an upload that matched known material.
import { chromium } from 'playwright'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { B, WEB, S, reg, call, callS, raw, ok, finish, adminToken, login } from '../lib.mjs'

const admin = await adminToken()
const a = await reg('reporter'), b = await reg('subject'), m = await reg('moderator'), c = await reg('uploader')
await login(`subject${S}`) // a sign-in, so there is a network address on file
await call(admin.token, 'PUT', `/admin/users/${m.user.id}/roles`, { roles: ['MODERATOR'] })
const g = await call(a.token, 'POST', '/guilds', { name: `Authority ${S}` }); const tc = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const msg = await call(b.token, 'POST', `/channels/${tc.id}/messages`, { content: `the reported words ${S}` })
const file = async (category, reason = 'A child is at risk') => (await callS(a.token, 'POST', '/reports', { kind: 'message', message_id: msg.id, reason, category })).body.id
const close = (id, status = 'resolved') => callS(admin.token, 'PATCH', `/admin/reports/${id}`, { status })
const rec = (tok, id, body) => callS(tok, 'PUT', `/admin/reports/${id}/authority`, body)
const one = async (id) => (await call(admin.token, 'GET', '/admin/reports?status=all')).find((x) => x.id === id)
let r

console.log('-- the report cannot be closed first')
const r1 = await file('child_sexual_content')
r = await close(r1); ok('resolving is refused, with what is needed', r.status === 400 && /authorities/.test(r.body?.error ?? ''), JSON.stringify(r.body))
ok('so is dismissing', (await close(r1, 'dismissed')).status === 400)
r = await callS(admin.token, 'GET', `/admin/reports/${r1}/authority`); ok('the report says a record is needed and there is none', r.body.required === true && r.body.record === null)
const spam = await file('spam', 'Spam or scam')
ok('an ordinary report closes as before', (await close(spam)).status === 200 && (await callS(admin.token, 'GET', `/admin/reports/${spam}/authority`)).body.required === false)

console.log('-- who records it, and what a record needs')
ok('a moderator can see the state', (await callS(m.token, 'GET', `/admin/reports/${r1}/authority`)).status === 200)
ok('but only a trust-and-safety lead or legal records it', (await rec(m.token, r1, { decision: 'not_required', note: 'A drawing of a cartoon, not a child' })).status === 403)
const when = new Date(Date.now() - 3600e3).toISOString()
ok('"filed" needs where and the reference', (await rec(admin.token, r1, { decision: 'filed', authority: 'NCMEC CyberTipline', filed_at: when, evidence_preserved: true })).status === 400)
ok('and when', (await rec(admin.token, r1, { decision: 'filed', authority: 'NCMEC CyberTipline', reference: '123456789', evidence_preserved: true })).status === 400)
ok('not a date in the future', (await rec(admin.token, r1, { decision: 'filed', authority: 'NCMEC CyberTipline', reference: '123456789', filed_at: new Date(Date.now() + 86400e3).toISOString(), evidence_preserved: true })).status === 400)
ok('and the evidence confirmed as preserved', (await rec(admin.token, r1, { decision: 'filed', authority: 'NCMEC CyberTipline', reference: '123456789', filed_at: when })).status === 400)
ok('(nothing was recorded by the refused tries)', (await callS(admin.token, 'GET', `/admin/reports/${r1}/authority`)).body.record === null && (await one(r1)).legal_hold === false)
r = await rec(admin.token, r1, { decision: 'filed', authority: 'NCMEC CyberTipline', reference: '123456789', filed_at: when, evidence_preserved: true, note: 'Filed by phone and form' })
ok('a complete record is kept, with who made it', r.status === 200 && r.body.record.reference === '123456789' && r.body.record.recorded_by === admin.user.username)
ok('and puts the report on legal hold, so "preserved" is true', (await one(r1)).legal_hold === true)
ok('now the report closes', (await close(r1)).status === 200)
r = await callS(admin.token, 'GET', '/admin/audit?q=report.authority'); ok('it is in the audit log with the reference', JSON.stringify(r.body).includes('123456789'))

console.log('-- when no report is needed')
const r2 = await file('child_grooming')
ok('an adult pursuing a child is held the same way', (await close(r2)).status === 400)
ok('"none was needed" needs a real reason', (await rec(admin.token, r2, { decision: 'not_required', note: 'no' })).status === 400)
r = await rec(admin.token, r2, { decision: 'not_required', note: 'Both accounts belong to adults; checked with the server owner' })
ok('with one, it is recorded', r.status === 200 && r.body.record.decision === 'not_required')
ok('without a hold, and the report closes', (await one(r2)).legal_hold === false && (await close(r2, 'dismissed')).status === 200)

console.log('-- the details for the report')
ok('a moderator cannot export', (await callS(m.token, 'GET', `/admin/reports/${r1}/authority/export`)).status === 403)
r = await callS(admin.token, 'GET', `/admin/reports/${r1}/authority/export`); const ex = r.body
ok('a lead gets one document', r.status === 200 && !!ex.about?.generated_at && ex.about.generated_by === admin.user.username)
ok('what happened: the kind, when, what the reporter said, where', ex.incident.category === 'child_sexual_content' && ex.incident.what_the_reporter_said === 'A child is at risk' && ex.incident.where.server_name === `Authority ${S}` && ex.incident.where.channel_id === tc.id)
ok('who it is about: name, email, when they joined', ex.reported_person.username === b.user.username && ex.reported_person.email === `subject${S}@x.io` && !!ex.reported_person.registered_at)
ok('and the network addresses they used, with dates', ex.reported_person.network_addresses.length >= 1 && !!ex.reported_person.network_addresses[0].ip && !!ex.reported_person.network_addresses[0].last_seen, JSON.stringify(ex.reported_person.network_addresses))
ok('the words reported, and the message as it was', ex.content.text_as_reported.includes('the reported words') && ex.content.message?.id === msg.id)
ok('who reported it', ex.reported_by.username === a.user.username)
ok('that it is on hold, and the record of the filing', ex.preservation.legal_hold === true && ex.record.reference === '123456789')
r = await callS(admin.token, 'GET', '/admin/audit?q=report.authority_export'); ok('every export is logged', (r.body ?? []).length >= 1 || JSON.stringify(r.body).includes('authority_export'))

console.log('-- an upload that matched known material')
const crc = (buf) => { let x = ~0; for (const v of buf) { x ^= v; for (let k = 0; k < 8; k++) x = (x >>> 1) ^ (0xedb88320 & -(x & 1)) } return (~x) >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]) }
const png = (rr, gg, bb) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2; const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([rr, gg, bb])))]); return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: 8 }, () => row)))), chunk('IEND', Buffer.alloc(0))]) }
const KNOWN = png(S % 255, 77, 201); const sha = crypto.createHash('sha256').update(KNOWN).digest('hex')
await callS(admin.token, 'POST', '/admin/safety/matching/hashes', { source: `authority test ${S}`, hashes: sha })
const f = new FormData(); f.append('file', new Blob([KNOWN], { type: 'image/png' }), 'pic.png')
r = await fetch(`${B}/channels/${tc.id}/attachments`, { method: 'POST', headers: { Authorization: 'Bearer ' + c.token }, body: f })
const match = (await call(admin.token, 'GET', '/admin/safety/matches?status=open')).find((x) => x.sha256 === sha)
ok('(the upload was refused and recorded)', r.status >= 400 && !!match, String(r.status))
ok('a moderator cannot export it', (await callS(m.token, 'GET', `/admin/safety/matches/${match.id}/export`)).status === 403)
r = await callS(admin.token, 'GET', `/admin/safety/matches/${match.id}/export`); const mx = r.body
ok('a lead gets the same kind of document for it', r.status === 200 && mx.incident.match_id === match.id && mx.reported_person.username === c.user.username && !!mx.reported_person.email)
ok('with the file\'s hash and where the held copy is, never the file', mx.content.files[0].sha256 === sha && mx.content.files[0].copy_held === true && mx.content.files[0].held_at.endsWith(`quarantine/${match.id}`) && !JSON.stringify(mx).includes('iVBOR'))
ok('where the upload came from and what recognised it', 'ip' in mx.incident.upload_came_from && mx.incident.matched_by.source.includes('authority test'))
await raw(admin.token, 'PATCH', `/admin/safety/matches/${match.id}`, { action: 'reported', report_ref: `T-${S}` })
ok('once the report is recorded on the match, the document carries it', (await callS(admin.token, 'GET', `/admin/safety/matches/${match.id}/export`)).body.record.reference === `T-${S}`)

console.log('-- in the console')
const r3 = await file('child_sexual_content')
const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((k) => localStorage.setItem('parley.token', k), admin.token)
await p.goto(`${WEB}/admin/reports`); await p.waitForSelector(`[data-admin-report="${r3}"] [data-authority="needed"]`)
const card = p.locator(`[data-admin-report="${r3}"]`)
ok('the report shows what must happen before it can close', (await card.locator('[data-authority]').innerText()).includes('cannot be closed'))
ok('Record waits for the checklist', await card.locator('[data-authority-save]').isDisabled())
await card.locator('[data-authority-reference]').fill('987654'); await card.locator('[data-authority-kept]').check(); await card.locator('[data-authority-save]').click()
await p.waitForSelector(`[data-admin-report="${r3}"] [data-authority="filed"]`)
ok('filling it in records the filing', (await card.locator('[data-authority-summary]').innerText()).includes('987654') && (await one(r3)).legal_hold === true)
const dl = p.waitForEvent('download'); await card.locator('[data-authority-export]').click(); const got = await dl
ok('and the details download as a file', got.suggestedFilename() === `report-${r3}.json`)
await p.goto(`${WEB}/admin/matches`); await p.waitForSelector(`[data-match="${match.id}"]`); await p.locator(`[data-match="${match.id}"] > button`).click(); await p.waitForSelector('[data-match-export]')
ok('Matched Uploads offers the same download', await p.locator('[data-match-export]').count() >= 1)

ok('no page errors', errors.length === 0, errors.join(' | '))
await raw(admin.token, 'PATCH', `/admin/safety/matches/${match.id}`, { action: 'close' })
await callS(admin.token, 'DELETE', `/admin/safety/matching/hashes?source=${encodeURIComponent(`authority test ${S}`)}`)
await call(admin.token, 'PATCH', `/admin/users/${c.user.id}`, { suspended: false })
for (const id of [r3]) await close(id)
await call(admin.token, 'PUT', `/admin/users/${m.user.id}/roles`, { roles: [] })
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
