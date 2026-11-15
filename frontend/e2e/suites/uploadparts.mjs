// Large files go up in parts, each request well under a proxy's body limit (Cloudflare's plans stop at 100 MB a
// request, which is what made videos over it fail as "Upload cancelled"). At the API: a part at the wrong offset is
// told where the upload is, someone else's upload is not theirs to add to, a file over the limit is refused before a
// byte is sent, and the last part makes the attachment, whole. In the browser: a 70 MB video in a DM, one of whose
// parts the connection drops, resumes and is sent; the file served is the one uploaded.
import { B, WEB, IP, reg, call, callS, ok, finish, launchBrowser, openDms, adminToken } from '../lib.mjs'
import { createHash } from 'node:crypto'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const a = await reg('alice'), b = await reg('bob')
await openDms(a, b)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
// Alice may upload up to 200 MB (the instance's own limit is lower on the test stack).
const admin = await adminToken()
const lim = await callS(admin.token, 'PATCH', `/admin/users/${a.user.id}`, { max_upload_bytes: 200 * 1024 * 1024 })
ok('alice may upload 200 MB', lim.status < 300, JSON.stringify(lim.body).slice(0, 200))
const H = (t) => ({ Authorization: `Bearer ${t}`, 'X-Forwarded-For': IP })
const sha = (buf) => createHash('sha256').update(buf).digest('hex')

console.log('-- at the API')
// 40 MB of something that is not all one byte, so a part in the wrong place would show.
const file = Buffer.alloc(40 * 1024 * 1024); for (let i = 0; i < file.length; i += 4096) file.writeUInt32LE(i, i)
let r = await callS(a.token, 'POST', `/channels/${dm.id}/attachments/uploads`, { filename: 'big.bin', size: file.length, content_type: 'application/octet-stream' })
const up = r.body
ok('an upload in parts starts, with the size of its parts', r.status === 201 && up.received === 0 && up.part_bytes === 32 * 1024 * 1024, JSON.stringify(r.body))
const put = (tok, id, at, buf) => fetch(`${B}/attachments/uploads/${id}?offset=${at}`, { method: 'PUT', headers: { ...H(tok), 'Content-Type': 'application/octet-stream' }, body: buf }).then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) }))
let p = await put(a.token, up.id, 1000, file.subarray(1000, 2000))
ok('a part at the wrong offset is told where the upload is (409)', p.status === 409 && p.body?.received === 0, JSON.stringify(p))
p = await put(b.token, up.id, 0, file.subarray(0, 1000))
ok('someone else cannot add to it', p.status === 404, String(p.status))
p = await put(a.token, up.id, 0, file.subarray(0, up.part_bytes))
ok('the first part lands', p.status === 200 && p.body.received === up.part_bytes, JSON.stringify(p.body))
p = await put(a.token, up.id, 0, file.subarray(0, up.part_bytes))
ok('sent again (its answer lost), it is told where the upload got to', p.status === 409 && p.body.received === up.part_bytes, JSON.stringify(p.body))
r = await call(a.token, 'GET', `/attachments/uploads/${up.id}`)
ok('and can ask', r.received === up.part_bytes && r.size === file.length, JSON.stringify(r))
p = await put(a.token, up.id, up.part_bytes, file.subarray(up.part_bytes))
const att = p.body?.attachment
ok('the last part makes the attachment', p.status === 201 && att?.size === file.length && att?.filename === 'big.bin', JSON.stringify(p.body).slice(0, 300))
r = await callS(a.token, 'POST', `/channels/${dm.id}/messages`, { content: 'big', attachment_ids: [att.id] })
ok('which is sent like any other', r.status === 201 && r.body.attachments.length === 1, String(r.status))
const got = Buffer.from(await (await fetch(`${WEB}${att.url}`)).arrayBuffer())
ok('and served whole, byte for byte', got.length === file.length && sha(got) === sha(file), `${got.length}`)
r = await callS(a.token, 'GET', `/attachments/uploads/${up.id}`)
ok('the finished upload is gone', r.status === 404, String(r.status))
r = await callS(a.token, 'POST', `/channels/${dm.id}/attachments/uploads`, { filename: 'huge.bin', size: 300 * 1024 * 1024 })
ok('a file over the limit is refused before a byte is sent', r.status === 400 && /too large/i.test(r.body.error), JSON.stringify(r.body))

console.log('-- in the browser')
const browser = await launchBrowser(); const errors = []
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await page.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await page.goto(`${WEB}/channels/@me/${dm.id}`); await page.waitForSelector('[data-file-input]', { state: 'attached', timeout: 15000 })
// Every request the upload makes, and the connection dropping the second part once.
const sizes = []; let dropped = false, single = 0
page.on('request', (q) => { if (q.method() === 'POST' && /\/attachments$/.test(q.url())) single++ })
await page.route('**/api/attachments/uploads/**', async (route) => {
  const q = route.request()
  if (q.method() !== 'PUT') return route.continue()
  sizes.push(q.postDataBuffer()?.length ?? 0)
  if (!dropped && /offset=[1-9]/.test(q.url())) { dropped = true; return route.abort('connectionreset') }
  return route.continue()
})
const video = Buffer.alloc(70 * 1024 * 1024); for (let i = 0; i < video.length; i += 4096) video.writeUInt32LE(i ^ 0x5a5a5a5a, i)
// Over Playwright's limit for a file handed over in memory: written out, and chosen from there.
const tmp = mkdtempSync(join(tmpdir(), 'parley-parts-')), vpath = join(tmp, 'phone-video.mp4')
writeFileSync(vpath, video)
await page.setInputFiles('[data-file-input]', vpath)
await page.waitForFunction(() => !/Uploading/.test(document.querySelector('[data-pending]')?.textContent ?? 'Uploading'), null, { timeout: 120000 }).catch(() => {})
const tile = await page.locator('[data-pending]').textContent()
ok('a 70 MB video goes up in parts, none of them over 33 MB, with no single request', sizes.length >= 3 && Math.max(...sizes) <= 33 * 1024 * 1024 && single === 0, JSON.stringify({ sizes, single }))
ok('the part the connection dropped is sent again, and the upload finishes with no error', dropped && !/cut off|cancelled|failed/i.test(tile) && !/Uploading/.test(tile), tile)
await page.locator('textarea[placeholder^="Message"]').press('Enter'); await page.waitForTimeout(1500)
const msgs = await call(a.token, 'GET', `/channels/${dm.id}/messages`)
const v = msgs.find((m) => m.attachments?.[0]?.filename === 'phone-video.mp4')?.attachments[0]
ok('it is sent', !!v && v.size === video.length, JSON.stringify(v).slice(0, 200))
if (v) {
  const back = Buffer.from(await (await fetch(`${WEB}${v.url}`)).arrayBuffer())
  ok('and the file served is the one uploaded', back.length === video.length && sha(back) === sha(video), String(back.length))
}

rmSync(tmp, { recursive: true, force: true })
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
