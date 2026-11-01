// Phones: going back from a DM to the DM list keeps the DM's URL, so a new message in that DM must not pop the
// conversation open again; tapping a DM, or a link to one, still opens it.
import { chromium, devices } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `DmBack ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const dm = await call(b.token, 'POST', '/users/@me/channels', { recipient_id: a.user.id })
await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: 'first' })
const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), b.token)
// What is on top: the element under the middle of the DM row / the message box is that element (not a pane over it).
const showing = () => p.evaluate((id) => { const top = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); if (!r.width) return false; const x = r.left + r.width / 2, y = r.top + r.height / 2; if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) return false; const hit = document.elementFromPoint(x, y); return !!hit && (el === hit || el.contains(hit)) }; return { list: top(document.querySelector(`[data-dm-row="${id}"]`)), chat: top(document.querySelector('textarea.composer-input')) } }, a.user.id)
await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector('textarea.composer-input'); await p.waitForTimeout(1200)
ok('a link to a DM opens the conversation', (await showing()).chat)
await p.click('button[title="Channels"]'); await p.waitForTimeout(500)
ok('back shows the DM list', (await showing()).list && !(await showing()).chat, JSON.stringify(await showing()))
for (const n of [1, 2, 3]) { await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: `ping ${n}` }); await p.waitForTimeout(700) }
ok('new messages in that DM leave you on the list', (await showing()).list && !(await showing()).chat, JSON.stringify(await showing()))
await call(a.token, 'POST', `/channels/${dm.id}/typing`); await p.waitForTimeout(500)
ok('and so does them typing', (await showing()).list && !(await showing()).chat)
await p.click(`[data-dm-row="${a.user.id}"]`); await p.waitForTimeout(600)
ok('tapping the DM opens it again', (await showing()).chat)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
