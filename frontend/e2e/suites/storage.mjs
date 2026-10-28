import { chromium } from 'playwright'
import { deflateSync } from 'node:zlib'
import { API_ORIGIN, WEB, S, reg, call, callS, raw, ok, finish, adminToken, multi, pngFile } from '../lib.mjs'

// Minimal PNG encoder (RGB) so the suite can make an image big enough to need a thumbnail.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
const png = (w, h) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x % 256; raw[o + 1] = y % 256; raw[o + 2] = 128 } } return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]) }
const bigPng = { name: 'big.png', mimeType: 'image/png', buffer: png(900, 600) }

const admin = await adminToken()
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Store ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')

console.log('-- thumbnails')
let up = await (await multi(a.token, `/channels/${tc.id}/attachments`, bigPng)).json()
ok('a 900x600 upload records its size and gets a thumbnail', up.width === 900 && up.height === 600 && typeof up.thumb_url === 'string' && /\/thumb(\?v=\d+)?$/.test(up.thumb_url))
let r = await fetch(API_ORIGIN + up.thumb_url); const tb = Buffer.from(await r.arrayBuffer())
const dims = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) })
ok('the thumbnail is a PNG scaled to 400px on the long side', r.status === 200 && r.headers.get('content-type') === 'image/png' && tb.slice(1, 4).toString() === 'PNG' && dims(tb).w === 400 && dims(tb).h === 267)
ok('thumbnails are much smaller than the original', tb.length < bigPng.buffer.length)
const small = await (await multi(a.token, `/channels/${tc.id}/attachments`, pngFile)).json()
ok('small images get no thumbnail', small.thumb_url === undefined && (await fetch(`${API_ORIGIN}/api/attachments/${small.id}/thumb`)).status === 404)
const txt = await (await multi(a.token, `/channels/${tc.id}/attachments`, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })).json()
ok('non-images get no thumbnail', txt.thumb_url === undefined)
const m = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: 'pics', attachment_ids: [up.id, small.id] })
ok('messages carry thumb_url only where one exists', m.attachments.find((x) => x.id === up.id).thumb_url === up.thumb_url && !('thumb_url' in m.attachments.find((x) => x.id === small.id)))

console.log('-- quotas')
let st = await call(a.token, 'GET', '/users/@me/storage')
ok('storage usage counts attachments against the default 1 GiB quota', st.quota === 1073741824 && st.attachments === 3 && st.attachment_bytes === bigPng.buffer.length + pngFile.buffer.length + 5 && st.used === st.attachment_bytes + st.image_bytes)
r = await callS(admin.token, 'PATCH', `/admin/users/${b.user.id}`, { upload_quota_bytes: 100 }); ok('admin sets a 100-byte quota for bob', r.status === 200)
ok('bob sees it', (await call(b.token, 'GET', '/users/@me/storage')).quota === 100)
r = await multi(b.token, `/channels/${tc.id}/attachments`, pngFile); ok('a tiny upload fits', r.status === 201)
r = await multi(b.token, `/channels/${tc.id}/attachments`, pngFile); const err = await r.json()
ok('the next one is refused with the usage in the message', r.status === 400 && /quota exceeded/i.test(err.error) && /of 100 B used/.test(err.error), err.error)
r = await multi(b.token, '/images?kind=avatar', pngFile); ok('profile images count too', r.status === 400)
ok('the refused file left no trace', (await call(b.token, 'GET', '/users/@me/storage')).attachments === 1)
r = await callS(admin.token, 'PATCH', `/admin/users/${b.user.id}`, { upload_quota_bytes: 0 }); ok('0 means unlimited', r.status === 200 && (await call(b.token, 'GET', '/users/@me/storage')).quota === null)
r = await multi(b.token, `/channels/${tc.id}/attachments`, bigPng); ok('…so big uploads work again', r.status === 201)
r = await callS(admin.token, 'PATCH', `/admin/users/${b.user.id}`, { upload_quota_bytes: null }); ok('null restores the default', r.status === 200 && (await call(b.token, 'GET', '/users/@me/storage')).quota === 1073741824)
r = await callS(admin.token, 'PATCH', `/admin/users/${b.user.id}`, { upload_quota_bytes: -5 }); ok('negative refused', r.status === 400)
r = await callS(b.token, 'PATCH', `/admin/users/${b.user.id}`, { upload_quota_bytes: 0 }); ok('non-admins cannot change quotas', r.status === 403)
const c = await call(admin.token, 'GET', `/admin/users/${b.user.id}/content`); ok('admin content view reports quota and override', c.quota === 1073741824 && c.quota_override === null)
ok('quota changes are audited', (await call(admin.token, 'GET', '/admin/audit')).some((e) => e.action === 'user.quota' && e.target_name === `bob${S}`))
await callS(a.token, 'DELETE', `/channels/${tc.id}/messages/${m.id}`)
ok('deleting the message frees the space and the thumbnail', (await call(a.token, 'GET', '/users/@me/storage')).attachment_bytes === 5 && (await fetch(API_ORIGIN + up.thumb_url)).status === 404)

console.log('-- UI')
const m2 = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: 'thumb', attachment_ids: [(await (await multi(a.token, `/channels/${tc.id}/attachments`, bigPng)).json()).id] })
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector(`[data-msg-id="${m2.id}"] [data-attachment-img="thumb"]`)
ok('the chat grid loads the thumbnail, not the original', (await p.getAttribute(`[data-msg-id="${m2.id}"] [data-attachment-img]`, 'src')).match(/\/thumb(\?v=\d+)?$/) !== null)
await p.click('[data-control="User Settings"]'); await p.waitForSelector('[data-storage-section]')
ok('My Account shows storage usage against the quota', (await p.textContent('[data-storage-section]')).includes('of 1024.00 MB used') && await p.locator('[data-storage-bar]').count() === 1)
await p.screenshot({ path: '112-storage.png' })
await p.close()
const pad = await browser.newPage({ viewport: { width: 1440, height: 900 } }); pad.on('pageerror', (e) => errors.push(e.message))
await pad.goto(`${WEB}/login`); await pad.evaluate((t) => localStorage.setItem('parley.token', t), admin.token)
await pad.goto(`${WEB}/admin/users/${b.user.id}`); await pad.waitForSelector('[data-admin-quota-row]')
await pad.fill('[data-admin-quota-input]', '5'); await pad.click('[data-admin-quota-save]'); await pad.waitForFunction(() => document.querySelector('[data-admin-quota-value]')?.textContent?.startsWith('5'))
ok('admin sets a custom quota from the content page', (await call(b.token, 'GET', '/users/@me/storage')).quota === 5 * 1024 * 1024 && (await pad.textContent('[data-admin-quota-row]')).includes('CUSTOM'))
await pad.click('[data-admin-quota-reset]'); await pad.waitForFunction(() => !document.querySelector('[data-admin-quota-row]')?.textContent?.includes('CUSTOM'))
ok('Default restores the instance quota', (await call(b.token, 'GET', '/users/@me/storage')).quota === 1073741824)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
