// Phone photos are stored sideways with an EXIF orientation tag. The original displays upright (browsers apply the
// tag), so the server-made chat thumbnail and the stored width/height must apply it too.
import { chromium } from 'playwright'
import { B, WEB, reg, call, ok, finish } from '../lib.mjs'

const a = await reg('photog')
const g = await call(a.token, 'POST', '/guilds', { name: 'Photos' }); const tc = g.channels.find((c) => c.kind === 'text').id
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1280, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`)

// An 800x400 JPEG as the camera stores it (left half red, right half blue) plus EXIF orientation 6 = "turn 90° clockwise",
// so it should display 400 wide and 800 tall with red on top.
const raw = Buffer.from(await p.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 800; c.height = 400; const x = c.getContext('2d')
  x.fillStyle = '#f00'; x.fillRect(0, 0, 400, 400); x.fillStyle = '#00f'; x.fillRect(400, 0, 400, 400)
  return [...new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer())]
}))
const tiff = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0])
const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]); const len = Buffer.alloc(2); len.writeUInt16BE(payload.length + 2)
const photo = Buffer.concat([raw.subarray(0, 2), Buffer.from([0xff, 0xe1]), len, payload, raw.subarray(2)])

const f = new FormData(); f.append('file', new Blob([photo], { type: 'image/jpeg' }), 'IMG_0001.jpg')
const att = await (await fetch(`${B}/channels/${tc}/attachments`, { method: 'POST', headers: { Authorization: 'Bearer ' + a.token }, body: f })).json()
ok('stored size is the displayed (upright) one', att.width === 400 && att.height === 800, JSON.stringify([att.width, att.height]))
ok('a thumbnail was made', att.thumb_url === `/api/attachments/${att.id}/thumb?v=2`, String(att.thumb_url))
const thumbUrl = `${B}/attachments/${att.id}/thumb`
const t = await p.evaluate(async (u) => {
  const img = new Image(); img.crossOrigin = 'anonymous'; img.src = u; await img.decode()
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0)
  const px = (yy) => [...x.getImageData(Math.floor(c.width / 2), yy, 1, 1).data]
  return { w: img.naturalWidth, h: img.naturalHeight, top: px(Math.floor(c.height / 8)), bottom: px(Math.floor(c.height * 7 / 8)) }
}, thumbUrl)
ok('thumbnail is upright: 200x400, red on top, blue below', t.w === 200 && t.h === 400 && t.top[0] > 200 && t.top[2] < 60 && t.bottom[2] > 200 && t.bottom[0] < 60, JSON.stringify(t))

const m = await call(a.token, 'POST', `/channels/${tc}/messages`, { content: '', attachment_ids: [att.id] })
await p.evaluate((tok) => localStorage.setItem('parley.token', tok), a.token); await p.goto(`${WEB}/channels/${g.id}/${tc}`)
const shown = p.locator(`[data-msg-id="${m.id}"] img`).last(); await shown.waitFor()
await p.waitForFunction((id) => { const i = [...document.querySelectorAll(`[data-msg-id="${id}"] img`)].pop(); return i && i.complete && i.naturalWidth > 0 }, m.id)
const box = await shown.boundingBox()
ok('chat shows it portrait, as the original', box.height > box.width * 1.5, JSON.stringify(box))
await p.screenshot({ path: 'photo-orientation.png' })
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
