import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, ok, finish, multi } from '../lib.mjs'
import { deflateSync } from 'node:zlib'

// Opening a busy channel must land on the first unread message (with a NEW line) or at the bottom,
// and late-loading content (thumbnails) must not drift the view.
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Scroll ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
const ids = []
for (let i = 1; i <= 45; i++) ids.push((await call(b.token, 'POST', `/channels/${tc.id}/messages`, { content: `message number ${i}` })).id)
await callS(a.token, 'PUT', `/channels/${tc.id}/read`, { message_id: ids[14] }) // alice read up to #15: 30 unread, more than a screen

const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 700 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
const metrics = () => p.evaluate(() => { const el = document.querySelector('[data-composer-box]').closest('main')?.querySelector('.overflow-y-auto') ?? document.querySelector('main .overflow-y-auto'); return { top: el.scrollTop, h: el.scrollHeight, c: el.clientHeight } })
const inView = async (sel) => p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); const c = document.querySelector('main .overflow-y-auto').getBoundingClientRect(); return r.top >= c.top && r.bottom <= c.bottom }, sel)

console.log('-- first unread')
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('[data-unread-divider]'); await p.waitForTimeout(400)
ok('a NEW divider sits before the first unread message', await p.evaluate((id) => document.querySelector('[data-unread-divider]')?.nextElementSibling?.getAttribute('data-msg-id'), ids[15]) === ids[15])
ok('the view opens at the divider (near the top of the pane), not at a random spot', await inView('[data-unread-divider]') && (await p.evaluate(() => { const d = document.querySelector('[data-unread-divider]').getBoundingClientRect(); const c = document.querySelector('main .overflow-y-auto').getBoundingClientRect(); return d.top - c.top })) < 120)
ok('message #16 is visible just below it', await inView(`[data-msg-id="${ids[15]}"]`))
let m = await metrics(); ok('and we are not at the bottom yet', m.h - m.top - m.c > 100)

console.log('-- bottom when all read')
await callS(a.token, 'PUT', `/channels/${tc.id}/read`, { message_id: ids[44] })
await p.goto(`${WEB}/channels/${g.id}`); await p.waitForSelector(`[data-msg-id="${ids[44]}"]`); await p.waitForTimeout(500)
m = await metrics(); ok('with nothing unread the channel opens at the bottom', m.h - m.top - m.c < 3, JSON.stringify(m))
ok('no NEW divider when nothing is unread', await p.locator('[data-unread-divider]').count() === 0)

console.log('-- late-loading content keeps the bottom')
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
const png = (w, h) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const raw = Buffer.alloc((w * 3 + 1) * h, 90); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]) }
for (let i = 0; i < 3; i++) { const up = await (await multi(b.token, `/channels/${tc.id}/attachments`, { name: `big${i}.png`, mimeType: 'image/png', buffer: png(800, 500) })).json(); await call(b.token, 'POST', `/channels/${tc.id}/messages`, { content: `pic ${i}`, attachment_ids: [up.id] }) }
await p.waitForTimeout(600); await callS(a.token, 'PUT', `/channels/${tc.id}/read`, { message_id: (await call(a.token, 'GET', `/channels/${tc.id}/messages?limit=1`))[0].id })
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('[data-attachment-img]'); await p.waitForFunction(() => [...document.querySelectorAll('[data-attachment-img]')].every((i) => i.complete), null, { timeout: 15000 }); await p.waitForTimeout(400)
m = await metrics(); ok('after the thumbnails finish loading the view is still at the bottom', m.h - m.top - m.c < 3, JSON.stringify(m))

console.log('-- revisit uses cached messages')
await p.click(`aside a[href="/channels/${g.id}/${tc.id}"]`).catch(() => {}); await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('text=Direct Messages'); await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('[data-attachment-img]'); await p.waitForTimeout(500)
m = await metrics(); ok('coming back lands at the bottom again', m.h - m.top - m.c < 3, JSON.stringify(m))
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
