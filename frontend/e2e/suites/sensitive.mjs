// Content & Social: sensitive media (blur by preference), age-restricted channels (gate + badge), DM spam filter.
import { chromium } from 'playwright'
import { B, WEB, S, FIX, reg, call, raw, ok, finish, openDms } from '../lib.mjs'
import fs from 'node:fs'
const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')
await openDms(a, b, c)
for (const u of [a, b, c]) await call(u.token, 'PUT', '/users/@me/birthdate', { birthdate: '1990-01-01' }) // adults: 18+ channels need a birth date on file
const g = await call(a.token, 'POST', '/guilds', { name: `Sens ${S}` }); const tc = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const up = async (t, ch, name, type, data) => { const f = new FormData(); f.append('file', new Blob([data], { type }), name); const r = await fetch(`${B}/channels/${ch}/attachments`, { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: f }); return r.json() }
const privacy = (t, patch) => raw(t, 'PATCH', '/users/@me/privacy', patch)

console.log('-- prefs')
let r = await privacy(b.token, { sensitive_media: { bogus: 'blur' } }); ok('unknown sensitive_media key refused', r.status === 400)
r = await privacy(b.token, { sensitive_media: { restricted: 'maybe' } }); ok('bad value refused', r.status === 400)
r = await privacy(b.token, { spam_filter: 'lots' }); ok('bad spam filter refused', r.status === 400)
r = await privacy(b.token, { sensitive_media: { restricted: 'blur', non_friend_dms: 'blur' }, spam_filter: 'non_friends' }); let u = await r.json()
ok('sensitive media and spam filter save', r.status === 200 && u.sensitive_media.restricted === 'blur' && u.sensitive_media.non_friend_dms === 'blur' && u.spam_filter === 'non_friends')

console.log('-- age-restricted channel')
r = await raw(a.token, 'PATCH', `/channels/${tc.id}`, { nsfw: true }); const ch = await r.json(); ok('a channel can be marked age-restricted', r.status === 200 && ch.nsfw === true)
const pic = await up(a.token, tc.id, 'dot.png', 'image/png', fs.readFileSync(`${FIX}/pic.png`))
const pm = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: 'look', attachment_ids: [pic.id] })

console.log('-- spam filter')
const dm = await call(c.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
await call(c.token, 'POST', `/channels/${dm.id}/messages`, { content: 'FREE NITRO here https://totally.legit/claim' }); await new Promise((r) => setTimeout(r, 500))
const dmv = (await call(b.token, 'GET', '/users/@me/channels')).find((x) => x.id === dm.id)
ok('a link from a brand-new account lands in Spam', dmv.request_state === 'spam', JSON.stringify(dmv.request_state))
await privacy(b.token, { spam_filter: 'none' })
const d = await reg('dave'); const dm2 = await call(d.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
await call(d.token, 'POST', `/channels/${dm2.id}/messages`, { content: 'hi https://example.com' }); await new Promise((r) => setTimeout(r, 500))
ok('with the filter off the same message stays a normal request', (await call(b.token, 'GET', '/users/@me/channels')).find((x) => x.id === dm2.id).request_state === 'pending')
await privacy(b.token, { spam_filter: 'non_friends' })

console.log('-- UI')
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), b.token)
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('[data-age-gate]')
ok('an age-restricted channel shows the gate first, with an 18+ badge in the header', await p.locator('[data-nsfw-badge]').count() === 1 && await p.locator('[data-msg-id]').count() === 0)
await p.click('[data-age-continue]'); await p.waitForSelector(`[data-msg-id="${pm.id}"]`)
ok('continuing opens the channel; the picture is blurred as SENSITIVE', await p.locator(`[data-msg-id="${pm.id}"] [data-blur="sensitive"]`).count() === 1)
await p.screenshot({ path: '169-sensitive.png' })
await p.click(`[data-msg-id="${pm.id}"] [data-blur="sensitive"]`); await p.waitForTimeout(300)
ok('clicking reveals it', await p.locator(`[data-msg-id="${pm.id}"] [data-blur]`).count() === 0)
await p.reload(); await p.waitForSelector(`[data-msg-id="${pm.id}"]`)
ok('the gate is remembered per channel', await p.locator('[data-age-gate]').count() === 0)
await p.goto(`${WEB}/channels/@me/requests`); await p.waitForSelector('[data-spam-folder]')
ok('the Spam folder lists carol\'s filtered DM', await p.locator(`[data-request="${dm.id}"][data-request-spam="1"]`).count() === 1)
await p.click('[data-spam-folder] summary'); await p.locator(`[data-request="${dm.id}"] [data-request-accept]`).click(); await p.waitForSelector('textarea[placeholder^="Message"]')
ok('Not spam accepts it into the DM list', (await call(b.token, 'GET', '/users/@me/channels')).find((x) => x.id === dm.id).request_state === 'accepted')
await p.click('button[title="User Settings"]'); await p.click('text=Content & Social'); await p.waitForSelector('[data-sensitive="restricted"][data-on="blur"]')
ok('Content & Social shows the sensitive-media and spam-filter choices', await p.locator('[data-spam-filter="non_friends"][data-on="1"]').count() === 1)
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
