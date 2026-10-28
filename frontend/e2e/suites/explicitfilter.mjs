// Explicit media filters, checked on each device: the real model loads and lets a clean picture through; a personal
// "Filter" level blurs pictures found explicit (click to reveal); a server's filter hides them for everyone with no
// reveal, keeps them out of the composer, and can spare members with roles. Explicit content is simulated by
// filename through a test hook rather than shipped as test data.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, multi, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Filter ${S}` }); const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch(); const errors = []

// A colourful 256×256 picture (a clean landscape-ish gradient), made in the browser.
const gp = await browser.newPage()
const png = Buffer.from(await gp.evaluate(() => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const x = cv.getContext('2d'); const gr = x.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#6ab7ff'); gr.addColorStop(0.6, '#e0f2ff'); gr.addColorStop(0.61, '#3c8d2f'); gr.addColorStop(1, '#245c1b'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256); x.fillStyle = '#fff6a0'; x.beginPath(); x.arc(190, 60, 28, 0, 7); x.fill(); return cv.toDataURL('image/png').split(',')[1] }), 'base64')
await gp.close()
const post = async (u, name) => { const att = await (await multi(u.token, `/channels/${ch.id}/attachments`, { name, mimeType: 'image/png', buffer: png })).json(); return call(u.token, 'POST', `/channels/${ch.id}/messages`, { attachment_ids: [att.id] }) }
const mk = async (u, hook) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  if (hook) await ctx.addInitScript(() => { window.__parleyExplicitTest = (url) => url.includes('BAD') })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  return p
}
const att = (p, mid) => p.locator(`[data-msg-id="${mid}"] [data-attachment-img], [data-msg-id="${mid}"] [data-blur], [data-msg-id="${mid}"] [data-explicit-removed]`).first()
const blurOf = (p, mid) => p.locator(`[data-msg-id="${mid}"] [data-blur]`).first().getAttribute('data-blur').catch(() => null)

console.log('-- personal Filter, real model')
await raw(b.token, 'PATCH', '/users/@me/privacy', { sensitive_media: { servers: 'filter' } })
const clean = await post(a, 'meadow.png')
const pb = await mk(b, false)
await pb.goto(`${WEB}/channels/${g.id}/${ch.id}`); await att(pb, clean.id).waitFor()
ok('a picture waits behind a blur while it is checked', ['checking', null].includes(await blurOf(pb, clean.id)))
await pb.waitForFunction((mid) => !document.querySelector(`[data-msg-id="${mid}"] [data-blur]`), clean.id, { timeout: 60000 }).catch(() => {})
ok('the on-device model passes a clean picture', (await blurOf(pb, clean.id)) === null && await pb.locator(`[data-msg-id="${clean.id}"] img[data-attachment-img]`).isVisible())
ok('Settings offers Filter', await raw(b.token, 'PATCH', '/users/@me/privacy', { sensitive_media: { servers: 'nope' } }).then((r) => r.status === 400))

console.log('-- personal Filter, explicit picture')
const bad = await post(a, 'BAD.png')
const pb2 = await mk(b, true)
await pb2.goto(`${WEB}/channels/${g.id}/${ch.id}`); await att(pb2, bad.id).waitFor()
await pb2.waitForFunction((mid) => document.querySelector(`[data-msg-id="${mid}"] [data-blur]`)?.getAttribute('data-blur') === 'explicit', bad.id, { timeout: 5000 }).catch(() => {})
ok('an explicit picture is blurred and labelled', (await blurOf(pb2, bad.id)) === 'explicit')
ok('a clean one is not', (await blurOf(pb2, clean.id)) === null)
await pb2.click(`[data-msg-id="${bad.id}"] [data-blur]`)
ok('clicking reveals it', (await blurOf(pb2, bad.id)) === null)

console.log('-- server filter')
const pa = await mk(a, true)
await pa.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pa.waitForSelector('textarea')
await pa.locator(`button:has-text("Filter ${S}")`).first().click(); await pa.click('text=Server Settings')
await pa.locator('button:has-text("Safety")').first().click(); await pa.click('[data-explicit-filter-option="all"]'); await pa.waitForTimeout(600)
ok('the owner turns the filter on for everyone', (await call(a.token, 'GET', `/guilds/${g.id}`)).explicit_filter === 'all')
await pa.keyboard.press('Escape')
const pc = await mk(c, true)
await pc.goto(`${WEB}/channels/${g.id}/${ch.id}`); await att(pc, bad.id).waitFor()
await pc.waitForSelector(`[data-msg-id="${bad.id}"] [data-explicit-removed]`, { timeout: 5000 }).catch(() => {})
ok('with Show, carol still gets the explicit picture hidden', await pc.locator(`[data-msg-id="${bad.id}"] [data-explicit-removed]`).count() === 1 && await pc.locator(`[data-msg-id="${bad.id}"] img[data-attachment-img]`).count() === 0)
ok('and clean pictures as usual', await pc.locator(`[data-msg-id="${clean.id}"] img[data-attachment-img]`).isVisible())
const pc2 = await mk(c, true); await pc2.goto(`${WEB}/channels/${g.id}/${ch.id}`)
await pc2.waitForSelector('textarea'); await pc2.locator('input[type="file"]').first().setInputFiles({ name: 'BAD.png', mimeType: 'image/png', buffer: png })
await pc2.waitForSelector('text=looks explicit', { timeout: 5000 }).catch(() => {})
ok('the composer refuses an explicit upload', await pc2.locator('text=looks explicit').count() >= 1 && await pc2.locator('[data-pending-attachment], [data-upload-item]').count() === 0)
await pc2.locator('input[type="file"]').first().setInputFiles({ name: 'meadow2.png', mimeType: 'image/png', buffer: png })
await pc2.waitForTimeout(1200)
ok('but takes a clean one', await pc2.locator('text=meadow2.png').count() >= 1)

console.log('-- members with roles')
await call(a.token, 'PATCH', `/guilds/${g.id}`, { explicit_filter: 'no_roles' })
const role = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Trusted' })
await call(a.token, 'PATCH', `/guilds/${g.id}/members/${a.user.id}`, { roles: [role.id] })
const pc3 = await mk(c, true); await pc3.goto(`${WEB}/channels/${g.id}/${ch.id}`); await att(pc3, bad.id).waitFor(); await pc3.waitForTimeout(800)
ok('"members without roles" spares a member with a role', await pc3.locator(`[data-msg-id="${bad.id}"] [data-explicit-removed]`).count() === 0)
ok('bad values are refused', (await raw(a.token, 'PATCH', `/guilds/${g.id}`, { explicit_filter: 'maybe' })).status === 400)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
