// Antivirus gate: a stub clamd (INSTREAM protocol) flags the EICAR test string; infected uploads are refused everywhere.
import net from 'node:net'
import { S, reg, call, callS, raw, multi, ok, finish, adminToken, pngFile } from '../lib.mjs'

const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
let scans = 0
const server = net.createServer((sock) => {
  let buf = Buffer.alloc(0)
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d])
    // zINSTREAM\0 then (len BE32 + chunk)* then len 0
    if (!buf.subarray(0, 10).equals(Buffer.from('zINSTREAM\0'))) return
    let off = 10; const chunks = []
    while (off + 4 <= buf.length) { const len = buf.readUInt32BE(off); off += 4; if (len === 0) { scans++; const data = Buffer.concat(chunks); sock.end(data.includes(EICAR) ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0'); return } if (off + len > buf.length) return; chunks.push(buf.subarray(off, off + len)); off += len }
  })
})
await new Promise((r) => server.listen(0, '0.0.0.0', r)); const PORT = server.address().port

const admin = await adminToken()
const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `AV ${S}` }); const tc = g.channels.find((x) => x.kind === 'text')
let settings = await call(admin.token, 'GET', '/admin/settings')
const put = async (patch) => { const r = await callS(admin.token, 'PUT', '/admin/settings', { ...settings, ...patch }); if (r.status === 200) settings = r.body; return r }
const txt = (body, name = 'notes.txt') => ({ buffer: Buffer.from(body), mimeType: 'text/plain', name })

console.log('-- settings')
let r = await put({ av_addr: 'http://nope' }); ok('address must be host:port', r.status === 400)
r = await put({ av_addr: `${HOST}:${PORT}`, av_fail_closed: true }); ok('admin points uploads at the scanner', r.status === 200 && r.body.av_addr === `${HOST}:${PORT}` && r.body.av_fail_closed === true)
ok('/instance hides it', (await call(a.token, 'GET', '/instance')).av_addr === undefined)

console.log('-- scanning')
r = await multi(a.token, `/channels/${tc.id}/attachments`, txt('just a note')); ok('clean file accepted', r.status === 201 && scans === 1)
r = await multi(a.token, `/channels/${tc.id}/attachments`, txt(`hello ${EICAR} there`, 'bad.txt')); const j = await r.json()
ok('infected attachment refused with the signature name', r.status === 400 && /Eicar-Test-Signature/.test(j.error), JSON.stringify(j))
ok('nothing was stored for it', !(await call(a.token, 'GET', '/users/@me/storage')).attachments || (await call(a.token, 'GET', '/users/@me/storage')).attachments <= 1)
const bad = Buffer.concat([pngFile.buffer, Buffer.from(EICAR)])
r = await multi(a.token, '/images?kind=avatar', { buffer: bad, mimeType: 'image/png', name: 'a.png' }); ok('profile images are scanned too', r.status === 400 && /Eicar/.test((await r.json()).error))
r = await multi(a.token, '/images?kind=avatar', pngFile); ok('clean image accepted', r.status === 201)

server.close(); await new Promise((res) => setTimeout(res, 200))
r = await multi(a.token, `/channels/${tc.id}/attachments`, txt('scanner down')); ok('fail closed: upload refused while the scanner is unreachable', r.status === 400 && /scanner/.test((await r.json()).error))
await put({ av_fail_closed: false })
r = await multi(a.token, `/channels/${tc.id}/attachments`, txt('scanner down 2')); ok('fail open: upload passes with an error logged', r.status === 201)
r = await put({ av_addr: '' }); ok('cleared', r.status === 200 && !r.body.av_addr)
ok('audited', (await call(admin.token, 'GET', '/admin/audit')).some((e) => e.action === 'settings.update' && typeof e.details?.av_addr === 'string'))
await finish()
