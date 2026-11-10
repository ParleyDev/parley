// Where a channel opens, Discord's way: on the NEW line when something arrived since the last visit, back at a spot
// the reader was reading back at (a screen or more up), otherwise at the newest message. A nudge up isn't "reading
// back", a deleted newest message doesn't leave the channel stuck unread, and a channel never opened has no NEW line.
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, ok, finish } from '../lib.mjs'

const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Land2 ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const home = g.channels.find((x) => x.kind === 'text')
const hist = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'history', kind: 'text' })
const quiet = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'quiet', kind: 'text' })
const post = async (ch, content) => (await call(b.token, 'POST', `/channels/${ch}/messages`, { content })).id
const ids = []
for (let i = 1; i <= 60; i++) { ids.push(await post(hist.id, `history ${i}`)); if (i % 25 === 0) await new Promise((r) => setTimeout(r, 1200)) }
await callS(a.token, 'PUT', `/channels/${hist.id}/read`, { message_id: ids.at(-1) })

const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${home.id}`); await p.waitForSelector('textarea'); await p.waitForTimeout(800)
const scroller = 'document.querySelector("[data-msg-id]")?.closest(".overflow-y-auto")'
const where = async () => { await p.waitForTimeout(1000); return p.evaluate(`(() => { const sc = ${scroller}; const d = document.querySelector('[data-unread-divider]'); const top = sc && [...sc.querySelectorAll('[data-row-id]')].find((r) => r.getBoundingClientRect().bottom > sc.getBoundingClientRect().top); return { fromBottom: sc ? Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight) : -1, divider: d ? Math.round(d.getBoundingClientRect().top - sc.getBoundingClientRect().top) : null, top: top?.dataset.rowId, h: sc?.clientHeight } })()`) }
const open = async (ch) => { await p.click(`a[href="/channels/${g.id}/${ch}"]`); return where() }
const scrollBy = async (dy) => { await p.evaluate(`(() => { const sc = ${scroller}; sc.scrollTop += ${dy}; sc.dispatchEvent(new Event('scroll')) })()`); await p.waitForTimeout(400) }
const unread = (ch) => p.evaluate((href) => !!document.querySelector(`[data-channel-item] > a[data-unread][href="${href}"]`), `/channels/${g.id}/${ch}`)

console.log('-- read channel: the newest message')
let w = await open(hist.id)
ok('a channel read to the end opens at the bottom, with no NEW line', w.fromBottom < 40 && w.divider === null, JSON.stringify(w))

console.log('-- a nudge up is not reading back')
await scrollBy(-150)
await open(home.id); w = await open(hist.id)
ok('coming back after a small scroll up lands at the bottom again', w.fromBottom < 40, JSON.stringify(w))

console.log('-- reading back is remembered')
await scrollBy(-1600); const was = (await where()).top
await open(home.id); w = await open(hist.id)
ok('coming back soon after reading back returns to the same spot', w.top === was && w.fromBottom > 400, JSON.stringify({ ...w, was }))

console.log('-- something new since: the NEW line wins')
await open(home.id)
const fresh = await post(hist.id, 'something new'); await p.waitForTimeout(500)
w = await open(hist.id)
ok('the NEW line is on screen, not the remembered spot', w.divider !== null && w.divider >= 0 && w.divider < w.h, JSON.stringify(w))
ok('the new message is on screen', await p.evaluate((id) => { const e = document.querySelector(`[data-msg-id="${id}"]`); return !!e && e.getBoundingClientRect().bottom <= window.innerHeight }, fresh))

console.log('-- a deleted newest message')
await open(home.id)
await post(quiet.id, 'still here'); const oops = await post(quiet.id, 'oops'); await p.waitForTimeout(400)
await callS(b.token, 'DELETE', `/channels/${quiet.id}/messages/${oops}`); await p.waitForTimeout(500)
ok('the channel shows unread (a message is still new)', await unread(quiet.id))
w = await open(quiet.id)
await open(home.id); await p.waitForTimeout(400)
ok('after reading it, the channel is no longer unread', !(await unread(quiet.id)))
await p.reload(); await p.waitForSelector('textarea'); await p.waitForTimeout(800)
ok('and the server agrees: no unread after a reload', !(await unread(quiet.id)))
w = await open(quiet.id)
ok('reopening shows no NEW line', w.divider === null, JSON.stringify(w))

console.log('-- never opened: no NEW line')
const c = await reg('carol')
const g2 = await call(c.token, 'POST', '/guilds', { name: `Fresh ${S}` }); const t2 = g2.channels.find((x) => x.kind === 'text')
for (let i = 1; i <= 40; i++) await call(c.token, 'POST', `/channels/${t2.id}/messages`, { content: `old talk ${i}` })
const inv2 = await call(c.token, 'POST', `/guilds/${g2.id}/invites`, {}); await call(a.token, 'POST', `/invites/${inv2.code}`)
await p.goto(`${WEB}/channels/${g2.id}/${t2.id}`); await p.waitForSelector('[data-msg-id]'); w = await where()
ok('a channel joined with history opens at the newest message without a NEW line', w.fromBottom < 40 && w.divider === null, JSON.stringify(w))

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
