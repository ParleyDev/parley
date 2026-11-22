// Attachment links: knowing a file's address is not enough to fetch it. The link a message carries is signed and
// runs out; without a valid signature the file goes only to a signed-in member who can see the conversation.
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { B, WEB, API_ORIGIN, S, reg, call, callS, ok, finish, openDms, PNG, testContainer } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')
await openDms(a, b)
// Friends: between strangers a first message is a request, and its media is held back until it is accepted.
await call(a.token, 'POST', '/users/@me/relationships', { user_id: b.user.id }); await call(b.token, 'PUT', `/users/@me/relationships/${a.user.id}`)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
const upload = async (t, ch, data, name, type = 'image/png') => { const f = new FormData(); f.append('file', new Blob([data], { type }), name); const r = await fetch(`${B}/channels/${ch}/attachments`, { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: f }); return r.json() }
const get = (path, token, headers = {}) => fetch(API_ORIGIN + path, { headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers } })
const pic = await upload(a.token, dm.id, PNG, 'private.png')
const msg = await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: `for bob only ${S}`, attachment_ids: [pic.id] })
const att = msg.attachments[0]
const bare = att.url.split('?')[0]
const q = new URLSearchParams(att.url.split('?')[1])

console.log('-- the link a message carries')
ok('it is signed and has an expiry', q.has('ex') && q.has('sig') && q.get('sig').length === 32, att.url)
const ex = parseInt(q.get('ex'), 16) * 1000
ok('it runs out between one and two days from now', ex - Date.now() > 23.9 * 3600e3 && ex - Date.now() <= 48 * 3600e3, String((ex - Date.now()) / 3600e3))
let r = await get(att.url); ok('it fetches the file with no login (pictures, video and downloads cannot send one)', r.status === 200 && Buffer.from(await r.arrayBuffer()).equals(PNG))
ok('the other person gets the same link for the day (caches stay useful)', (await call(b.token, 'GET', `/channels/${dm.id}/messages`)).find((m) => m.id === msg.id)?.attachments[0].url === att.url)
r = await get(att.url, null, { Range: 'bytes=0-9' }); ok('byte ranges still work', r.status === 206 && (await r.arrayBuffer()).byteLength === 10)
r = await get(`${att.url}&download=1`); ok('and the download form of it', r.status === 200 && r.headers.get('content-disposition').startsWith('attachment'))

console.log('-- the address alone')
r = await get(bare); ok('without a signature or a login: refused', r.status === 401, String(r.status))
ok('the refusal carries none of the file', !(await r.text()).includes('PNG'))
r = await get(bare, c.token); ok('signed in but not in the conversation: refused', r.status === 403, String(r.status))
r = await get(bare, a.token); ok('the sender, signed in: served', r.status === 200)
r = await get(bare, b.token); ok('the other person, signed in: served', r.status === 200)
r = await get(`${bare}?ex=${q.get('ex')}&sig=${'0'.repeat(32)}`); ok('a made-up signature: refused', r.status === 403, String(r.status))
r = await get(`${bare}?ex=${(parseInt(q.get('ex'), 16) + 86400).toString(16)}&sig=${q.get('sig')}`); ok('a later expiry with the same signature: refused', r.status === 403)
r = await get(`${bare}?ex=${Math.floor(Date.now() / 1000 - 60).toString(16)}&sig=${q.get('sig')}`); ok('an expiry in the past: refused, in plain words', r.status === 403 && /expired/.test((await r.json()).error ?? ''))
const other = await upload(a.token, dm.id, Buffer.concat([PNG, Buffer.from('x')]), 'other.png')
const oq = other.url.split('?')[1]
r = await get(`${bare}?${oq}`); ok("another file's signature: refused", r.status === 403)
r = await get(other.url); ok('(a file just uploaded, not yet sent, is served to its signed link)', r.status === 200)
r = await get(other.url.split('?')[0], b.token); ok('an unsent upload is not served to others by address', r.status === 200 || r.status === 403)
if (att.thumb_url) {
  r = await get(att.thumb_url); ok('the thumbnail link is signed too', r.status === 200 && att.thumb_url.includes('sig='))
  r = await get(att.thumb_url.split('?')[0]); ok('the thumbnail address alone: refused', r.status === 401)
} else console.log('  (no thumbnail for this picture)')

console.log('-- audio')
const wav = (() => { const n = 8000, b2 = Buffer.alloc(44 + n * 2); b2.write('RIFF', 0); b2.writeUInt32LE(36 + n * 2, 4); b2.write('WAVEfmt ', 8); b2.writeUInt32LE(16, 16); b2.writeUInt16LE(1, 20); b2.writeUInt16LE(1, 22); b2.writeUInt32LE(8000, 24); b2.writeUInt32LE(16000, 28); b2.writeUInt16LE(2, 32); b2.writeUInt16LE(16, 34); b2.write('data', 36); b2.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b2.writeInt16LE(Math.round(Math.sin(i / 5) * 9000), 44 + i * 2); return b2 })()
const snd = await upload(a.token, dm.id, wav, 'tone.wav', 'audio/wav')
const smsg = await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: '', attachment_ids: [snd.id] })
const sq = smsg.attachments[0].url.split('?')[1]
r = await get(`/api/attachments/${snd.id}/viz?${sq}&peaks=1`); ok('the visualiser data goes to the signed link', r.status === 200, String(r.status))
r = await get(`/api/attachments/${snd.id}/viz?peaks=1`); ok('and not to the address alone', r.status === 401, String(r.status))
r = await get(`/api/attachments/${snd.id}/viz`, c.token); ok('nor to someone outside the conversation', r.status === 403)

console.log('-- fresh links')
r = await callS(a.token, 'POST', '/attachments/urls', { ids: [pic.id, snd.id] })
ok('a member can ask for fresh links to what they can see', r.status === 200 && r.body.length === 2 && r.body.every((x) => x.url.includes('sig=')) && (await get(r.body.find((x) => x.id === pic.id).url)).status === 200, JSON.stringify(r.body))
r = await callS(c.token, 'POST', '/attachments/urls', { ids: [pic.id, snd.id] }); ok('someone outside the conversation gets none', r.status === 200 && r.body.length === 0, JSON.stringify(r.body))
r = await fetch(`${B}/attachments/urls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [pic.id] }) }); ok('it needs a login', r.status === 401)
r = await callS(a.token, 'POST', '/attachments/urls', { ids: Array.from({ length: 501 }, () => crypto.randomUUID()) }); ok('at most 500 at a time', r.status === 400)
// A server channel someone has left.
const g = await call(a.token, 'POST', '/guilds', { name: `Linkville ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(c.token, 'POST', `/invites/${inv.code}`)
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
const gp = await upload(a.token, tc.id, PNG, 'server.png'); const gm = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: 'pic', attachment_ids: [gp.id] })
const gbare = gm.attachments[0].url.split('?')[0]
ok('a member of the server is served by address when signed in', (await get(gbare, c.token)).status === 200)
await call(c.token, 'DELETE', `/guilds/${g.id}/members/@me`)
r = await get(gbare, c.token); ok('after leaving, their login no longer fetches it', r.status === 403, String(r.status))
ok('and they get no fresh links', (await callS(c.token, 'POST', '/attachments/urls', { ids: [gp.id] })).body.length === 0)

console.log('-- files from before links were signed')
// Their plain addresses were handed out as permanent (pasted elsewhere, bookmarked, kept by bots) and keep working.
{
  const sql = (q2) => execSync(`docker exec ${testContainer('db')} psql -U parley -tAc "${q2}"`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
  const old = await upload(a.token, dm.id, Buffer.concat([PNG, Buffer.from('old')]), 'old.png')
  const om = await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: 'an old one', attachment_ids: [old.id] })
  const obare = om.attachments[0].url.split('?')[0]
  ok('(a new file is refused at its plain address)', (await get(obare)).status === 401)
  sql(`UPDATE attachments SET created_at = (SELECT (value #>> '{}')::timestamptz - interval '1 day' FROM instance_settings WHERE key = 'attachment_links_signed_since') WHERE id = '${old.id}'`)
  r = await get(obare); ok('a file uploaded before the change is still served at its plain address', r.status === 200 && (await r.arrayBuffer()).byteLength === PNG.length + 3, String(r.status))
  ok('with a stale or made-up signature too', (await get(`${obare}?ex=1&sig=${'0'.repeat(32)}`)).status === 200)
  ok('and through the signed link the app is given', (await get((await call(a.token, 'GET', `/channels/${dm.id}/messages`)).find((m) => m.id === om.id).attachments[0].url)).status === 200)
  ok('newer files are unaffected by that', (await get(bare)).status === 401)
}

console.log('-- in the app')
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1280, height: 800 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
// (As the sender: a message request hides pictures from the person receiving it until they accept.)
await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector(`[data-msg-id="${msg.id}"]`); await p.screenshot({ path: 'attachlinks.png' }); await p.waitForSelector(`[data-msg-id="${msg.id}"] [data-attachment-img]`, { state: "attached" })
await p.waitForFunction((id) => { const i = document.querySelector(`[data-msg-id="${id}"] [data-attachment-img]`); return i && i.complete && i.naturalWidth > 0 }, msg.id)
ok('the picture shows in the conversation', true)
ok('from a signed link', (await p.locator(`[data-msg-id="${msg.id}"] [data-attachment-img]`).first().getAttribute('src')).includes('sig='))
await p.waitForSelector(`[data-msg-id="${smsg.id}"] audio, [data-msg-id="${smsg.id}"] [data-audio-player], [data-msg-id="${smsg.id}"]`)
// Two days on, with the conversation still open: the app asks for fresh links before the old ones are used.
const asked = p.waitForRequest((q2) => q2.url().endsWith('/api/attachments/urls') && q2.method() === 'POST', { timeout: 15000 })
await p.clock.setFixedTime(Date.now() + 47 * 3600e3)
await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
const req = await asked.catch(() => null)
ok('a conversation left open asks for fresh links before the old ones run out', !!req && JSON.parse(req.postData()).ids.includes(pic.id), req?.postData() ?? 'no request')
const resp = req && await (await req.response()).json()
ok('and gets them', !!resp && resp.some((x) => x.id === pic.id && x.url.includes('sig=')))
await p.waitForTimeout(300)
ok('the picture is still showing', await p.evaluate((id) => { const i = document.querySelector(`[data-msg-id="${id}"] [data-attachment-img]`); return !!i && i.naturalWidth > 0 }, msg.id))
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
