// The rest of the safety batch: explicit-image checks made by the server (with a stub classifier), threat feeds for
// the blocked-links list (with a stub feed), the operator's policies and contacts, and the gaps closed for the
// less-watched ways in (editing, forwarding, forum posts, guests, assistant connections).
import { chromium } from 'playwright'
import http from 'node:http'
import zlib from 'node:zlib'
import { B, WEB, S, H, reg, call, callS, raw, multi, ok, finish, adminToken } from '../lib.mjs'

const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
const admin = await adminToken()
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `More ${S}` }); const tc = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
// A valid 8x8 PNG of one colour. "Explicit" pictures are the red ones, as far as the stub classifier is concerned.
const crc = (buf) => { let x = ~0; for (const v of buf) { x ^= v; for (let k = 0; k < 8; k++) x = (x >>> 1) ^ (0xedb88320 & -(x & 1)) } return (~x) >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]) }
const png = (rr, gg, bb) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2; const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([rr, gg, bb])))]); return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: 8 }, () => row)))), chunk('IEND', Buffer.alloc(0))]) }
const RED = png(250, 1, S % 200), GREEN = png(1, 250, S % 200)
const seen = []; let up = true; let feedBody = ''
const stub = http.createServer((q, res) => {
  const parts = []; q.on('data', (c) => parts.push(c)); q.on('end', () => {
    if (q.url === '/feed.txt') { res.writeHead(feedBody ? 200 : 500, { 'Content-Type': 'text/plain' }); res.end(feedBody); return }
    if (q.url === '/classify') {
      if (!up) { res.writeHead(503); res.end(); return }
      if (q.headers.authorization !== 'Bearer cls-token') { res.writeHead(401); res.end(); return }
      const body = Buffer.concat(parts); seen.push({ surface: q.headers['x-parley-surface'], type: q.headers['content-type'], size: body.length })
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ explicit: body.equals(RED) })); return
    }
    res.writeHead(404); res.end()
  })
})
await new Promise((r) => stub.listen(0, '0.0.0.0', r)); const SVC = `http://${HOST}:${stub.address().port}`
const setExplicit = (body) => callS(admin.token, 'PUT', '/admin/safety/explicit', { service_url: '', allow_when_down: false, ...(body.service_url ? {} : { service_token: '' }), ...body })
const avatar = (tok, data) => multi(tok, '/images?kind=avatar', { name: 'me.png', mimeType: 'image/png', buffer: data })
const attach = async (tok, ch, data) => { const f = new FormData(); f.append('file', new Blob([data], { type: 'image/png' }), 'pic.png'); return fetch(`${B}/channels/${ch}/attachments`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: f }) }
let r

console.log('-- explicit image checks: off until set up')
await setExplicit({})
ok('with no service, pictures are stored unchecked as before', (await avatar(a.token, RED)).status === 201 && seen.length === 0)
ok('the settings are for instance managers', (await callS(a.token, 'GET', '/admin/safety/explicit')).status === 403)
ok('the address must be a web address', (await setExplicit({ service_url: 'classifier.internal' })).status === 400)
r = await setExplicit({ service_url: `${SVC}/classify`, service_token: 'cls-token' })
ok('set up: the token is kept and never sent back', r.status === 200 && r.body.active === true && r.body.service_token_set === true && !JSON.stringify(r.body).includes('cls-token'))
r = await callS(admin.token, 'POST', '/admin/safety/explicit/test'); ok('the test picture goes to the service and comes back clean', r.body.ok === true && seen.at(-1)?.surface === 'test')

console.log('-- pictures everyone sees')
r = await avatar(a.token, RED); ok('an explicit profile picture is refused', r.status === 400 && /explicit/.test((await r.json()).error))
ok('one that is not is stored', (await avatar(a.token, GREEN)).status === 201)
ok('the same for a banner', (await multi(a.token, '/images?kind=banner', { name: 'b.png', mimeType: 'image/png', buffer: RED })).status === 400)
r = await multi(a.token, `/guilds/${g.id}/emojis`, { name: 'e.png', mimeType: 'image/png', buffer: RED }, { name: `red${S % 1000}` })
ok('and an emoji', r.status === 400, String(r.status))
up = false
r = await avatar(a.token, GREEN); ok('while the service is down, new profile pictures are refused: everyone sees them', r.status === 400 && /right now/.test((await r.json()).error))
await setExplicit({ service_url: `${SVC}/classify`, allow_when_down: true })
ok('unless the operator chose to let them through', (await avatar(a.token, GREEN)).status === 201)
await setExplicit({ service_url: `${SVC}/classify` }); up = true

console.log('-- attachments, by the server\'s own filter')
seen.length = 0
ok('with the server\'s filter off, attachments are not sent to be checked', (await attach(b.token, tc.id, RED)).status < 300 && seen.length === 0)
await call(a.token, 'PATCH', `/guilds/${g.id}`, { explicit_filter: 'all' })
r = await attach(b.token, tc.id, RED); ok('with it on for everyone, an explicit attachment is refused by the server', r.status === 400 && /explicit/.test((await r.json()).error))
ok('whatever app sent it: this was a plain API call', seen.at(-1)?.surface === 'attachment')
ok('a picture that is not explicit goes through', (await attach(b.token, tc.id, GREEN)).status < 300)
await call(a.token, 'PATCH', `/guilds/${g.id}`, { explicit_filter: 'no_roles' })
const role = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'trusted' }); await call(a.token, 'PATCH', `/guilds/${g.id}/members/${b.user.id}`, { roles: [role.id] })
ok('"members without roles": a member with a role is not checked', (await attach(b.token, tc.id, RED)).status < 300)
await call(a.token, 'PATCH', `/guilds/${g.id}/members/${b.user.id}`, { roles: [] })
ok('and one without is', (await attach(b.token, tc.id, RED)).status === 400)
await call(a.token, 'PATCH', `/guilds/${g.id}`, { explicit_filter: 'all' })
up = false; ok('while the service is down, attachments go through', (await attach(b.token, tc.id, RED)).status < 300); up = true
const adultCh = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'adults', kind: 'text' }); await call(a.token, 'PATCH', `/channels/${adultCh.id}`, { nsfw: true })
await call(admin.token, 'POST', `/admin/age/users/${a.user.id}/attest`, { note: 'e2e fixture' })
seen.length = 0; ok('an 18+ channel is left alone', (await attach(a.token, adultCh.id, RED)).status < 300 && seen.length === 0)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
ok('so is a direct message (each side\'s own setting decides there)', (await attach(a.token, dm.id, RED)).status < 300 && seen.length === 0)
await setExplicit({}); await call(a.token, 'PATCH', `/guilds/${g.id}`, { explicit_filter: 'off' })

console.log('-- threat feeds')
const before = (await callS(admin.token, 'GET', '/admin/link-feeds')).body
ok('feeds are for instance managers', (await callS(a.token, 'GET', '/admin/link-feeds')).status === 403)
const d1 = `feed-one-${S}.example`, d2 = `feed-two-${S}.example`, d3 = `feed-three-${S}.example`, mine = `by-hand-${S}.example`
await call(admin.token, 'POST', '/admin/blocked-domains', { domain: mine, reason: 'added by hand' })
feedBody = `# a threat feed\n0.0.0.0 ${d1}\nhttp://${d2}/\nhttp://shared-${S}.example/one/bad/page\ngithub.com\n${mine}\nnot a domain line\n`
r = await callS(admin.token, 'POST', '/admin/link-feeds', { name: `Test feed ${S}`, url: `${SVC}/feed.txt` })
const feed = r.body.feeds?.find((f) => f.name === `Test feed ${S}`)
ok('adding a feed fetches it at once', r.status === 200 && feed?.last_status === 'ok' && feed.entries === 3, JSON.stringify(feed))
ok('the same address twice is refused', (await callS(admin.token, 'POST', '/admin/link-feeds', { name: 'again', url: `${SVC}/feed.txt` })).status === 409)
ok('it adds to the count without touching what was added by hand', r.body.manual === before.manual + 1 && r.body.total === before.total + 3, `${r.body.manual}/${r.body.total} vs ${before.manual}/${before.total}`)
const send = (content) => callS(b.token, 'POST', `/channels/${tc.id}/messages`, { content })
r = await send(`look https://${d1}/free`); ok('a link to a listed domain is refused in a message', r.status === 403 && /blocked/.test(r.body?.error ?? ''), JSON.stringify(r.body))
ok('and to a subdomain of one', (await send(`look https://cdn.${d2}/x`)).status === 403)
ok('a line naming one page of a site did not block the site', (await send(`fine https://shared-${S}.example/another/page`)).status === 201)
ok('a site everybody shares is never blocked, whatever the feed says', (await send('code at https://github.com/example/repo')).status === 201)
r = await callS(b.token, 'GET', `/embeds?url=${encodeURIComponent(`https://${d1}/`)}`); ok('a listed site gets no link preview', r.status === 200 && r.body === null)
ok('the hand-kept list shows only what was added by hand', await (async () => { const l = await call(admin.token, 'GET', '/admin/blocked-domains'); return l.some((x) => x.domain === mine) && !l.some((x) => x.domain === d1) })())
feedBody = `${d1}\n${d3}\n`
r = await callS(admin.token, 'POST', `/admin/link-feeds/${feed.id}/refresh`)
ok('a refresh takes the feed as it is now', r.body.feeds.find((f) => f.id === feed.id).entries === 2 && (await send(`gone https://${d2}/`)).status === 201 && (await send(`new https://${d3}/`)).status === 403)
ok('a domain the feed dropped but you added yourself stays blocked', (await send(`mine https://${mine}/`)).status === 403)
feedBody = ''
r = await callS(admin.token, 'POST', `/admin/link-feeds/${feed.id}/refresh`); const failed = r.body.feeds.find((f) => f.id === feed.id)
ok('a feed that cannot be fetched says so', failed.last_status !== 'ok' && failed.entries === 2, JSON.stringify(failed))
ok('and what it listed before stays blocked', (await send(`still https://${d1}/`)).status === 403)
r = await callS(admin.token, 'PATCH', `/admin/link-feeds/${feed.id}`, { enabled: false })
ok('switching a feed off stops it blocking', r.body.feeds.find((f) => f.id === feed.id).entries === 0 && (await send(`ok now https://${d1}/`)).status === 201)
feedBody = `${d1}\n`; await callS(admin.token, 'PATCH', `/admin/link-feeds/${feed.id}`, { enabled: true })
ok('and on again brings it back', (await send(`again https://${d1}/`)).status === 403)

console.log('-- the less-watched ways in')
const okMsg = (await send('a harmless message')).body
r = await callS(b.token, 'PATCH', `/channels/${tc.id}/messages/${okMsg.id}`, { content: `edited to https://${d1}/prize` })
ok('a message cannot be edited into a blocked link', r.status === 403, String(r.status))
ok('and it stays as it was', (await call(b.token, 'GET', `/channels/${tc.id}/messages/${okMsg.id}`)).content === 'a harmless message')
const forum = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'ideas', kind: 'forum' })
r = await callS(b.token, 'POST', `/channels/${forum.id}/threads`, { name: 'Free stuff', content: `get it at https://${d1}/` })
ok('a forum post gets the link check too', r.status === 403, String(r.status))
r = await callS(b.token, 'POST', `/channels/${forum.id}/threads`, { name: `https://${d1}/ in the title`, content: 'nothing to see' })
ok('in its title as well', r.status === 403, String(r.status))
ok('an ordinary post still works', (await callS(b.token, 'POST', `/channels/${forum.id}/threads`, { name: 'An idea', content: 'What about a book club?' })).status === 201)
await callS(admin.token, 'DELETE', `/admin/link-feeds/${feed.id}`)
const linked = (await send(`was fine when sent https://${d1}/`)).body
feedBody = `${d1}\n`; r = await callS(admin.token, 'POST', '/admin/link-feeds', { name: `Test feed ${S}`, url: `${SVC}/feed.txt` }); const feed2 = r.body.feeds.find((f) => f.name === `Test feed ${S}`)
r = await callS(b.token, 'POST', `/channels/${tc.id}/messages/${linked.id}/forward`, { channel_id: forum.id.replace(/./, (c) => c) && tc.id })
ok('forwarding a message checks what it carries', r.status === 403, String(r.status))
let codes = []; for (let i = 0; i < 22; i++) codes.push((await raw(b.token, 'POST', `/channels/${tc.id}/messages/${okMsg.id}/forward`, { channel_id: tc.id })).status)
ok('and forwarding has its own limit', codes.slice(0, 15).every((c) => c === 201) && codes.includes(429), codes.join(','))
const guest = await (await fetch(`${B}/auth/guest`, { method: 'POST', headers: { ...H, 'X-Forwarded-For': `10.77.${S % 250}.${(S >> 8) % 250}` }, body: '{}' })).json()
if (guest.token && guest.guild_id) {
  r = await callS(guest.token, 'POST', `/guilds/${guest.guild_id}/invites`, {}); ok('a guest cannot hand out invites', r.status === 403 || r.status === 404, String(r.status))
} else console.log('  (guest accounts are off on this instance: skipped)')
r = await fetch(`${WEB}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Array.from({ length: 26 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' }))) })
ok('an assistant connection still needs its token before anything else', r.status === 401)

console.log('-- policies and contacts')
const pol = (tok, body) => callS(tok, 'PUT', '/admin/policies', { terms_url: '', guidelines_url: '', privacy_url: '', safety_contact: '', legal_contact: '', ...body })
const polBefore = (await callS(admin.token, 'GET', '/admin/policies')).body
await pol(admin.token, {})
r = await fetch(`${B}/instance/policies`); ok('anyone can read them, signed in or not', r.status === 200 && (await r.json()).terms_url === '')
ok('only instance managers set them', (await pol(a.token, { terms_url: 'https://example.org/terms' })).status === 403)
ok('a document is a web address', (await pol(admin.token, { terms_url: 'javascript:alert(1)' })).status === 400 && (await pol(admin.token, { terms_url: 'terms.html' })).status === 400)
ok('a contact is an email address or a web address', (await pol(admin.token, { safety_contact: 'call me' })).status === 400)
r = await pol(admin.token, { terms_url: `https://example.org/terms-${S}`, guidelines_url: `https://example.org/rules-${S}`, safety_contact: `safety${S}@example.org`, legal_contact: 'https://example.org/legal' })
ok('saved', r.status === 200 && r.body.safety_contact === `safety${S}@example.org`)
ok('and public', (await (await fetch(`${B}/instance/policies`)).json()).legal_contact === 'https://example.org/legal')
r = await callS(admin.token, 'GET', '/admin/audit?q=policies.update'); ok('the change is in the audit log', JSON.stringify(r.body).includes(`terms-${S}`))

console.log('-- in the app')
const browser = await chromium.launch(); const errors = []
const page = async (tok) => { const p = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); if (tok) await p.evaluate((k) => localStorage.setItem('parley.token', k), tok); return p }
const anon = await page(null)
await anon.goto(`${WEB}/register`); await anon.waitForSelector('[data-signup-policies]')
ok('sign-up names the terms and the guidelines, and links to them', await anon.locator(`[data-policy-link="terms"][href="https://example.org/terms-${S}"]`).count() === 1 && await anon.locator('[data-policy-link="guidelines"]').count() === 1 && await anon.locator('[data-policy-link="privacy"]').count() === 0)
const pb = await page(b.token)
await pb.goto(`${WEB}/channels/@me`); await pb.waitForTimeout(600); await pb.click('[data-control="User Settings"]'); await pb.waitForSelector('[data-safety-contact]')
ok('My Account shows the safety contact as a mail link', await pb.locator(`[data-policy-link="safety"][href="mailto:safety${S}@example.org"]`).count() === 1)
const pad = await page(admin.token)
await pad.goto(`${WEB}/admin/policies`); await pad.waitForSelector('[data-admin-policies]')
await pad.fill('[data-policy-field="privacy_url"]', `https://example.org/privacy-${S}`); await pad.click('[data-policy-save]'); await pad.waitForTimeout(600)
ok('Policies & Contacts saves from the console', (await (await fetch(`${B}/instance/policies`)).json()).privacy_url === `https://example.org/privacy-${S}`)
await pad.goto(`${WEB}/admin/blocked-links`); await pad.waitForSelector(`[data-link-feed="Test feed ${S}"]`)
ok('Blocked Links lists the feed, its size and that it was fetched', (await pad.locator(`[data-link-feed="Test feed ${S}"] [data-feed-entries]`).innerText()).includes('1') && await pad.getAttribute(`[data-link-feed="Test feed ${S}"]`, 'data-feed-status') === 'ok')
await pad.locator(`[data-link-feed="Test feed ${S}"] [data-feed-remove]`).click(); await pad.waitForFunction((n) => !document.querySelector(`[data-link-feed="${n}"]`), `Test feed ${S}`)
ok('removing a feed removes what it blocked', (await send(`free again https://${d1}/`)).status === 201)
await pad.goto(`${WEB}/admin/explicit`); await pad.waitForSelector('[data-admin-explicit][data-explicit-active="0"]')
await pad.fill('[data-explicit-url]', `${SVC}/classify`); await pad.fill('[data-explicit-token]', 'cls-token'); await pad.click('[data-explicit-save]'); await pad.waitForSelector('[data-explicit-active="1"]')
await pad.click('[data-explicit-test]'); await pad.waitForSelector('[data-explicit-probe="ok"]')
ok('Explicit Image Checks is set up and tested from the console', true)

ok('no page errors', errors.length === 0, errors.join(' | '))
await setExplicit({}); if (feed2) await callS(admin.token, 'DELETE', `/admin/link-feeds/${feed2.id}`)
await call(admin.token, 'DELETE', `/admin/blocked-domains/${mine}`)
if (polBefore) await callS(admin.token, 'PUT', '/admin/policies', polBefore)
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
stub.close(); await browser.close(); await finish()
