// Matching uploads against known abuse material: off until an administrator sets it up; a listed file hash or a
// matching service's answer refuses the upload with plain words, suspends the account and puts a record (never the
// file) in a queue only trust-and-safety leads and legal can open; the reviewer records the report filed or releases a
// false match; an unreachable service lets uploads through or refuses them, as set. Stand-in files only: small
// generated pictures, and a stub for the matching service.
import { chromium } from 'playwright'
import http from 'node:http'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { B, WEB, S, reg, call, callS, raw, ok, finish, adminToken } from '../lib.mjs'
const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
// A valid 8x8 PNG of one colour: different colours are different files (and hashes).
const png = (r, g, b) => {
  const crc = (buf) => { let c, n = ~0; for (const x of buf) { c = (n ^ x) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; n = (n >>> 8) ^ c } return (~n) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 8 }, () => [r, g, b]).flat())])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: 8 }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const LISTED = png(200, 10, 10), KNOWN_TO_SERVICE = png(10, 200, 10), CLEAN = png(10, 10, 200), CLEAN2 = png(90, 90, 90)
// The matching service: knows one file by its hash, wants its token, and can be switched off.
const seen = []; let serviceUp = true
const server = http.createServer((req, res) => {
  const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
    if (!serviceUp) { res.writeHead(503); res.end(); return }
    if (req.headers.authorization !== 'Bearer stub-token') { res.writeHead(401); res.end(); return }
    const body = Buffer.concat(parts)
    seen.push({ sha: req.headers['x-parley-sha256'], surface: req.headers['x-parley-surface'], type: req.headers['content-type'], bytes: body.length, shaMatches: sha(body) === req.headers['x-parley-sha256'] })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(sha(body) === sha(KNOWN_TO_SERVICE) ? { match: true, source: 'stub matcher', reference: 'ref-42', category: 'test' } : { match: false }))
  })
})
await new Promise((r) => server.listen(0, '0.0.0.0', r)); const SERVICE = `http://${HOST}:${server.address().port}/check`

const admin = await adminToken()
const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol'); const d = await reg('dave')
const g = await call(a.token, 'POST', '/guilds', { name: `Match ${S}` }); const tc = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, c, d]) await call(u.token, 'POST', `/invites/${inv.code}`)
const upload = async (t, data, name = 'pic.png') => { const f = new FormData(); f.append('file', new Blob([data], { type: 'image/png' }), name); const r = await fetch(`${B}/channels/${tc.id}/attachments`, { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: f }); return { status: r.status, body: await r.json().catch(() => null) } }
const avatar = async (t, data) => { const f = new FormData(); f.append('file', new Blob([data], { type: 'image/png' }), 'me.png'); const r = await fetch(`${B}/images?kind=avatar`, { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: f }); return { status: r.status, body: await r.json().catch(() => null) } }
const reset = async () => { await callS(admin.token, 'PUT', '/admin/safety/matching', { service_url: '', service_token: '', fail_closed: false }); const cfg = (await callS(admin.token, 'GET', '/admin/safety/matching')).body; for (const l of cfg.hash_lists) await raw(admin.token, 'DELETE', `/admin/safety/matching/hashes?source=${encodeURIComponent(l.source)}`) }
await reset()

console.log('-- off until set up')
let r = await callS(admin.token, 'GET', '/admin/safety/matching')
ok('nothing is matched against by default', r.status === 200 && r.body.active === false && r.body.hash_total === 0 && r.body.service_url === '')
ok('members cannot see or change the setup', (await raw(a.token, 'GET', '/admin/safety/matching')).status === 403 && (await raw(a.token, 'PUT', '/admin/safety/matching', { service_url: SERVICE, fail_closed: false })).status === 403)
ok('nor the queue', (await raw(a.token, 'GET', '/admin/safety/matches')).status === 403)
ok('with matching off any picture uploads', (await upload(a.token, LISTED)).status === 201)

console.log('-- the setup page')
const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message))
await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), admin.token)
await p.goto(`${WEB}/admin/matching`); await p.waitForSelector('[data-admin-matching]')
ok('the console says matching is off, and why Parley cannot ship a list', (await p.getAttribute('[data-admin-matching]', 'data-matching-active')) === '0' && (await p.locator('[data-matching-state]').textContent()).includes('vetted'))
await p.fill('[data-hash-source]', 'test feed'); await p.fill('[data-hash-input]', `${sha(LISTED)}\nnot-a-hash\n${sha(LISTED).toUpperCase()}\nabc123`); await p.click('[data-hash-add]')
await p.waitForSelector('[data-hash-list="test feed"]')
ok('hashes are added to a named list (a repeat and junk ignored)', (await p.locator('[data-hash-list="test feed"] [data-hash-count]').textContent()) === '1' && (await p.getAttribute('[data-admin-matching]', 'data-matching-active')) === '1')
await p.fill('[data-matching-url]', SERVICE); await p.fill('[data-matching-token]', 'stub-token'); await p.click('[data-matching-save]')
await p.waitForFunction(() => !document.querySelector('[data-matching-save]')?.disabled === false, null, { timeout: 4000 }).catch(() => {})
await p.click('[data-matching-test]'); await p.waitForSelector('[data-matching-probe]', { timeout: 8000 }).catch(() => {})
ok('Send a test picture reaches the service and reports its answer', (await p.getAttribute('[data-matching-probe]', 'data-matching-probe')) === 'ok' && seen.some((s) => s.surface === 'test' && s.shaMatches), JSON.stringify(seen.slice(-1)))
await p.screenshot({ path: 'mediamatch-setup.png', fullPage: true })
r = await callS(admin.token, 'GET', '/admin/safety/matching')
ok('the token is stored but never sent back', r.body.service_token_set === true && !JSON.stringify(r.body).includes('stub-token'))
ok('a service address must be a web address', (await raw(admin.token, 'PUT', '/admin/safety/matching', { service_url: 'ftp://x', fail_closed: false })).status === 400)

console.log('-- a file on the hash list')
ok('(clean pictures still upload, and are sent to the service with their hash)', (await upload(a.token, CLEAN)).status === 201 && seen.some((s) => s.sha === sha(CLEAN) && s.surface === 'attachment' && s.type === 'image/png' && s.shaMatches))
const before = seen.length
r = await upload(b.token, LISTED, 'holiday.png')
ok('the upload is refused in plain words', r.status === 400 && r.body?.error === "This file can't be uploaded.", JSON.stringify(r))
ok('without saying what was recognised', !/hash|match|list|abuse|csam/i.test(JSON.stringify(r.body)))
ok('a listed file is not sent on to the service', seen.length === before)
ok('the account is suspended at once', [401, 403].includes((await raw(b.token, 'GET', '/users/@me')).status))
ok('others in the channel never got it', !(await call(a.token, 'GET', `/channels/${tc.id}/messages`)).some((m) => m.author.id === b.user.id && (!m.kind || m.kind === 'default')), JSON.stringify((await call(a.token, 'GET', `/channels/${tc.id}/messages`)).filter((m) => m.author.id === b.user.id).map((m) => [m.kind, m.content, m.attachments?.length])))

console.log('-- a file the service knows')
r = await avatar(c.token, KNOWN_TO_SERVICE)
ok('a profile picture the service matches is refused the same way', r.status === 400 && r.body?.error === "This file can't be uploaded.", JSON.stringify(r))
ok('and that account is suspended', [401, 403].includes((await raw(c.token, 'GET', '/users/@me')).status))
ok('a clean profile picture is fine', (await avatar(d.token, CLEAN2)).status === 201)

console.log('-- the review queue')
r = await callS(admin.token, 'GET', '/admin/safety/matches')
const mb = r.body.find((m) => m.user_id === b.user.id), mc = r.body.find((m) => m.user_id === c.user.id)
ok('each match is recorded: who, where, what matched', !!mb && mb.status === 'open' && mb.source === 'hash-list:test feed' && mb.surface === 'attachment' && mb.channel_id === tc.id && mb.guild_id === g.id && mb.filename === 'holiday.png' && mb.sha256 === sha(LISTED) && mb.suspended && mb.quarantined && mb.legal_hold, JSON.stringify(mb))
ok('the service\'s match carries its source and reference', !!mc && mc.source === 'service:stub matcher' && mc.reference === 'ref-42' && mc.category === 'test' && mc.surface === 'image')
ok('the quarantined file is not served by any upload route', (await fetch(`${B}/attachments/${mb.id}`, { headers: { Authorization: 'Bearer ' + admin.token } })).status >= 400 && (await fetch(`${B}/images/${mb.id}`)).status >= 400 && (await fetch(`${B}/attachments/quarantine/${mb.id}`, { headers: { Authorization: 'Bearer ' + admin.token } })).status >= 400)
ok('the queue has no way to fetch the file', !JSON.stringify(r.body).includes('url'))
await p.goto(`${WEB}/admin/matches`); await p.waitForSelector(`[data-match="${mb.id}"]`)
ok('the console lists both, waiting for review', await p.locator('[data-match][data-match-status="open"]').count() >= 2)
await p.click(`[data-match="${mb.id}"] > button`); await p.waitForSelector('[data-match-detail]')
ok('with the record and no picture', (await p.locator('[data-match-detail]').textContent()).includes('hash-list:test feed') && await p.locator('[data-match-detail] img, [data-match-detail] video').count() === 0)
await p.screenshot({ path: 'mediamatch-queue.png' })
ok('a match cannot be closed before a report is recorded or it is released', (await raw(admin.token, 'PATCH', `/admin/safety/matches/${mb.id}`, { action: 'close' })).status === 400)
ok('recording a report needs its reference', (await raw(admin.token, 'PATCH', `/admin/safety/matches/${mb.id}`, { action: 'reported', report_ref: '  ' })).status === 400)
await p.fill('[data-match-ref-input]', 'CT-000123'); await p.click('[data-match-reported]')
await p.waitForSelector(`[data-match="${mb.id}"][data-match-status="reported"]`)
ok('recording the report marks the match reported, with the reference', (await p.locator('[data-match-ref]').textContent()).includes('CT-000123'))
ok('a reported match cannot be released as a false match', (await raw(admin.token, 'PATCH', `/admin/safety/matches/${mb.id}`, { action: 'release', note: 'oops' })).status === 400)
ok('its file cannot be destroyed while on hold', (await raw(admin.token, 'PATCH', `/admin/safety/matches/${mb.id}`, { action: 'close' })).status === 200 && (await raw(admin.token, 'PATCH', `/admin/safety/matches/${mb.id}`, { action: 'destroy' })).status === 400)
ok('and the account stays suspended', [401, 403].includes((await raw(b.token, 'GET', '/users/@me')).status))
// A false match
ok('releasing needs a reason', (await raw(admin.token, 'PATCH', `/admin/safety/matches/${mc.id}`, { action: 'release', note: '' })).status === 400)
ok('and the legal hold lifted first', (await raw(admin.token, 'PATCH', `/admin/safety/matches/${mc.id}`, { action: 'release', note: 'a test pattern' })).status === 400)
await raw(admin.token, 'PATCH', `/admin/safety/matches/${mc.id}`, { action: 'unhold' })
r = await callS(admin.token, 'PATCH', `/admin/safety/matches/${mc.id}`, { action: 'release', note: 'a test pattern' })
ok('a released match restores the account and holds no file', r.status === 200 && r.body.status === 'released' && r.body.quarantined === false && (await raw(c.token, 'GET', '/users/@me')).status === 200)
const log = await call(admin.token, 'GET', '/admin/audit')
ok('looks and decisions are in the audit log, hashes are not', JSON.stringify(log).includes('safety.matches.view') && JSON.stringify(log).includes('safety.match.reported') && !JSON.stringify(log).includes(sha(LISTED)))

console.log('-- the service is down')
serviceUp = false
ok('by default uploads go through unchecked while the service is down', (await upload(a.token, png(1, 2, 3))).status === 201)
await callS(admin.token, 'PUT', '/admin/safety/matching', { service_url: SERVICE, fail_closed: true })
r = await upload(a.token, png(4, 5, 6))
ok('with "refuse when unreachable" on, they are refused, and the member is told to try later', r.status === 400 && /safety check is unavailable/.test(r.body?.error ?? ''), JSON.stringify(r))
ok('and nobody is suspended for an outage', (await raw(a.token, 'GET', '/users/@me')).status === 200)
r = await callS(admin.token, 'POST', '/admin/safety/matching/test')
ok('the test says the service could not be used', r.body.ok === false)
serviceUp = true

console.log('-- administrators')
await raw(admin.token, 'PATCH', `/admin/safety/matches/${mb.id}`, { action: 'unhold' })
await call(admin.token, 'POST', `/invites/${inv.code}`)
const n0 = (await call(admin.token, 'GET', '/admin/safety/matches')).length
r = await upload(admin.token, LISTED)
ok('an administrator\'s matching upload is refused and recorded', r.status === 400 && (await call(admin.token, 'GET', '/admin/safety/matches')).length === n0 + 1)
ok('but a machine does not suspend an administrator', (await raw(admin.token, 'GET', '/users/@me')).status === 200)

await reset()
ok('removing the lists and the service turns matching off again', (await callS(admin.token, 'GET', '/admin/safety/matching')).body.active === false && (await upload(a.token, LISTED)).status === 201)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); server.close(); await finish()
