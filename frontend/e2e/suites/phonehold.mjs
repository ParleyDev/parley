// Phones: holding a finger on anything with a menu opens that menu as the bottom sheet, like the native app, never
// the browser's text selection or callout; the click that ends the hold does nothing; things without a menu ignore it.
import { chromium, devices } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Hold ${S}` }); const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const dm = await call(b.token, 'POST', '/users/@me/channels', { recipient_id: a.user.id })
await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: 'hello https://example.com' })
const msg = await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: 'hold me' })
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ ...devices['iPhone 13'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await ctx.addInitScript(() => { window.__buzz = []; navigator.vibrate = (ms) => { window.__buzz.push(ms); return true } })
const cdp = await ctx.newCDPSession(p)
// A finger held still: touchStart, wait, touchEnd (which the browser turns into a click).
const hold = async (sel, ms = 650) => {
  const r = await p.locator(sel).locator('visible=true').first().boundingBox(); const x = r.x + Math.min(r.width / 2, 40), y = r.y + r.height / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await p.waitForTimeout(ms)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(350)
}
const sheets = () => p.locator('[data-menu-sheet]').count()
const close = async () => { if (await sheets()) { await p.locator('[data-menu-sheet-backdrop]').click({ position: { x: 20, y: 20 } }); await p.waitForTimeout(250) } }
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), b.token)
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector(`[data-dm-row="${a.user.id}"]`); await p.waitForTimeout(1200)

console.log('-- touch screens act like the app')
const css = await p.evaluate(async () => (await Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => fetch(l.href).then((r) => r.text())))).join(''))
ok('no text selection or callout outside fields', await p.evaluate(() => getComputedStyle(document.body).userSelect === 'none') && /\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)\s*\{[^@]*?body\s*\{[^}]*-webkit-touch-callout:\s*none/.test(css))
ok('fields still select text', await p.evaluate(() => { const i = document.createElement('input'); document.body.append(i); const v = getComputedStyle(i).userSelect; i.remove(); return v !== 'none' }))

console.log('-- holding opens menus')
const url = p.url()
await hold(`[data-dm-row="${a.user.id}"]`)
ok('a DM row opens its menu as a sheet', await sheets() === 1)
ok('and the end of the hold does not open the DM', p.url() === url, p.url())
await close()
await hold(`[data-guild-icon="${g.id}"]`)
ok('a server icon opens its menu', await sheets() === 1 && /Invite|Mark/i.test(await p.locator('[data-menu-sheet]').innerText()))
await close()
await hold('[data-motion-row] [data-avatar-motion]', 200)
ok('a short press is just a tap (no menu)', await sheets() === 0)
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector(`[data-dm-row="${a.user.id}"]`); await p.waitForTimeout(800)
await hold('span:text-is("Direct Messages")')
ok('holding something without a menu does nothing', await sheets() === 0)
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector(`[data-msg-id="${msg.id}"]`); await p.waitForTimeout(1200)
await hold(`[data-msg-id="${msg.id}"] .msg-content`)
ok('a message still opens its own menu, once', await sheets() === 1, String(await sheets()))
await close()
await p.click('button[title="Member List"]').catch(() => {}); await p.waitForSelector(`[data-member-row="${a.user.id}"]`, { timeout: 5000 }).catch(() => {})
await hold(`[data-member-row="${a.user.id}"]`)
ok('a member opens their menu, and the hold does not open their profile', await sheets() === 1 && await p.locator('[data-profile-card]').count() === 0)
await close()
console.log('-- double tap to react')
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector(`[data-msg-id="${msg.id}"]`); await p.waitForTimeout(1000)
await p.evaluate(() => { window.__buzz = [] })
const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await p.waitForTimeout(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
const tr = await p.locator(`[data-msg-id="${msg.id}"] .msg-content`).boundingBox()
await tap(tr.x + 20, tr.y + tr.height / 2); await p.waitForTimeout(120); await tap(tr.x + 20, tr.y + tr.height / 2); await p.waitForTimeout(900)
const after = (await call(b.token, 'GET', `/channels/${ch.id}/messages?limit=5`)).find((x) => x.id === msg.id)
ok('a double tap adds the quick reaction', after?.reactions?.some((r) => r.me), JSON.stringify(after?.reactions))
ok('without selecting any text', await p.evaluate(() => (window.getSelection()?.toString() ?? '') === ''))
ok('and with a light haptic tick', (await p.evaluate(() => window.__buzz)).length === 1)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
