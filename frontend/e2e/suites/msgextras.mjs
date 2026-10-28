// Message extras: alt text on attachments (set before sending, edited after, shown as ALT and to screen readers),
// several pictures in a mosaic, the gallery viewer (arrows, count, zoom, alt), Remove Embeds, and View Reactions
// (who reacted, per emoji, with moderators removing someone's reaction).
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Extras ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const ch = g.channels.find((x) => x.kind === 'text')
const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector('[data-composer-box] textarea'); await p.waitForTimeout(600)
const box = '[data-composer-box] textarea'
const latest = async () => (await call(a.token, 'GET', `/channels/${ch.id}/messages?limit=5`)).sort((x, y) => (x.id < y.id ? 1 : -1))[0]
const png = async (hue) => Buffer.from(await p.evaluate((h) => { const cv = document.createElement('canvas'); cv.width = 80; cv.height = 60; const x = cv.getContext('2d'); x.fillStyle = `hsl(${h} 70% 50%)`; x.fillRect(0, 0, 80, 60); return cv.toDataURL('image/png').split(',')[1] }, hue), 'base64')
const attach = async (n) => {
  await p.setInputFiles('[data-file-input="files"]', await Promise.all(Array.from({ length: n }, async (_, i) => ({ name: `pic${i}.png`, mimeType: 'image/png', buffer: await png(i * 70) }))))
  await p.waitForFunction((k) => [...document.querySelectorAll('[data-pending]')].filter((e) => /B$/.test(e.textContent)).length === k, n, { timeout: 15000 })
}

console.log('-- alt text and mosaic')
await attach(2)
await p.locator('[data-pending] [data-alt-toggle]').first().click(); await p.fill('[data-alt-input]', 'A purple square'); await p.keyboard.press('Enter')
ok('the ALT button lights up once described', await p.locator('[data-pending] [data-alt-toggle].bg-accent').count() === 1)
await p.focus(box); await p.keyboard.press('Enter'); await p.waitForSelector('[data-mosaic="2"]')
const sent = await latest()
ok('alt text is saved with the message', sent.attachments.find((x) => x.filename === 'pic0.png')?.description === 'A purple square' && !sent.attachments.find((x) => x.filename === 'pic1.png')?.description)
ok('two pictures show side by side in a mosaic', await p.locator('[data-mosaic="2"] [data-mosaic-item]').count() === 2)
ok('the described one has an ALT badge and real alt text', await p.locator('[data-mosaic="2"] [data-alt-badge]').count() === 1 && await p.locator('[data-mosaic="2"] img[alt="A purple square"]').count() === 1)
await attach(3); await p.focus(box); await p.keyboard.press('Enter'); await p.waitForSelector('[data-mosaic="3"]')
ok('three pictures: one big and two small', await p.locator('[data-mosaic="3"] .row-span-2').count() === 1)

console.log('-- gallery')
// Uploads finish in any order, so open whichever tile is the described one.
const described = Number(await p.locator('[data-mosaic="2"] [data-mosaic-item]:has(img[alt="A purple square"])').getAttribute('data-mosaic-item'))
await p.locator(`[data-mosaic="2"] [data-mosaic-item="${described}"]`).click(); await p.waitForSelector('[data-lightbox]')
ok('the viewer counts the message\'s pictures', (await p.locator('[data-lightbox-count]').innerText()).trim() === `${described + 1} / 2`)
ok('and shows the alt text', /A purple square/.test(await p.locator('[data-lightbox-alt]').innerText()))
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(150)
ok('→ goes to the other one', (await p.locator('[data-lightbox-count]').innerText()).trim() === `${((described + 1) % 2) + 1} / 2` && await p.locator('[data-lightbox-alt]').count() === 0)
await p.click('[data-lightbox-prev]'); await p.waitForTimeout(150)
ok('the arrow button goes back', /A purple square/.test(await p.locator('[data-lightbox-alt]').innerText()))
await p.click('[data-lightbox-img]'); await p.waitForTimeout(100)
ok('clicking the picture zooms in', (await p.getAttribute('[data-lightbox-img]', 'data-zoomed')) === '1')
await p.keyboard.press('Escape'); await p.waitForTimeout(200)
ok('Escape closes it', await p.locator('[data-lightbox]').count() === 0)

console.log('-- edit alt text after sending')
await p.locator(`[data-msg-id="${sent.id}"]`).click({ button: 'right', position: { x: 300, y: 10 } }); await p.click('[data-menu-item="Edit Attachments"]')
await p.fill(`[data-alt-edit="${sent.attachments.find((x) => x.filename === 'pic1.png').id}"]`, 'A green square'); await p.click('[data-alt-save]'); await p.waitForTimeout(600)
ok('alt text can be changed after sending', (await latest().then(() => call(a.token, 'GET', `/channels/${ch.id}/messages?limit=5`))).find((m) => m.id === sent.id).attachments.find((x) => x.filename === 'pic1.png').description === 'A green square')
ok('only the author can', (await raw(b.token, 'PATCH', `/channels/${ch.id}/messages/${sent.id}`, { attachment_descriptions: { [sent.attachments[0].id]: 'nope' } })).status === 403)

console.log('-- remove embeds')
const linkMsg = await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: 'look https://example.com/page' })
ok('others can\'t remove embeds from your message', (await raw(c.token, 'PATCH', `/channels/${ch.id}/messages/${linkMsg.id}`, { suppress_embeds: true })).status === 403)
await p.waitForTimeout(500)
await p.locator(`[data-msg-id="${linkMsg.id}"]`).click({ button: 'right', position: { x: 300, y: 10 } }); await p.click('[data-menu-item="Remove Embeds"]'); await p.waitForTimeout(600)
const after = (await call(a.token, 'GET', `/channels/${ch.id}/messages?limit=10`)).find((m) => m.id === linkMsg.id)
ok('a moderator can remove them', after.suppress_embeds === true && after.edited_at === null)
await p.locator(`[data-msg-id="${linkMsg.id}"]`).click({ button: 'right', position: { x: 300, y: 10 } })
ok('and the menu offers to show them again', await p.locator('[data-menu-item="Show Embeds"]').count() === 1)
await p.keyboard.press('Escape')

console.log('-- view reactions')
await call(b.token, 'PUT', `/channels/${ch.id}/messages/${linkMsg.id}/reactions/${encodeURIComponent('👍')}`)
await call(c.token, 'PUT', `/channels/${ch.id}/messages/${linkMsg.id}/reactions/${encodeURIComponent('👍')}`)
await call(c.token, 'PUT', `/channels/${ch.id}/messages/${linkMsg.id}/reactions/${encodeURIComponent('🎉')}`)
await p.waitForTimeout(600)
await p.locator(`[data-msg-id="${linkMsg.id}"]`).click({ button: 'right', position: { x: 300, y: 10 } }); await p.click('[data-menu-item="View Reactions"]'); await p.waitForSelector('[data-reactions-modal]')
ok('a tab per emoji', await p.locator('[data-reactions-tab]').count() === 2)
await p.waitForSelector('[data-reactor]')
ok('listing who reacted', await p.locator('[data-reactor]').count() === 2)
ok('members without Manage Messages cannot remove others\' reactions', (await raw(b.token, 'DELETE', `/channels/${ch.id}/messages/${linkMsg.id}/reactions/${encodeURIComponent('👍')}/${c.user.id}`)).status === 403)
await p.click(`[data-reactor-remove="${c.user.id}"]`); await p.waitForTimeout(500)
const reacts = (await call(a.token, 'GET', `/channels/${ch.id}/messages?limit=10`)).find((m) => m.id === linkMsg.id).reactions
ok('a moderator can', reacts.find((r) => r.emoji === '👍')?.count === 1 && await p.locator('[data-reactor]').count() === 1)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
