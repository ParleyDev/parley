// Tablet layout (768–1023px): sidebars shrink, member list is an overlay from its toggle.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Tab ${S}` }); const tc = g.channels.find((x) => x.kind === 'text')
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token); await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('textarea')
const w = async (sel) => (await p.locator(sel).first().boundingBox())?.width ?? 0
ok('tablet keeps the sidebar, narrower than desktop', await p.locator('[data-channel-row]').first().isVisible() && (await w('aside')) > 200 && (await w('aside')) < 240, String(await w('aside')))
ok('member list is closed by default on tablets', await p.locator('[data-member-list]').count() === 0 || !(await p.locator('[data-member-list]').isVisible()))
await p.click('main button[title="Member List"]'); await p.waitForSelector('[data-member-list]')
const box = await p.locator('[data-member-list]').boundingBox()
const pos = await p.locator('[data-member-list]').evaluate((el) => getComputedStyle(el).position)
ok('opening it docks a 300px overlay on the right instead of squeezing the chat', (pos === 'absolute' || pos === 'fixed') && box.width < 320 && box.x > 500 && (await w('textarea')) > 300, JSON.stringify(box))
await p.screenshot({ path: '147-tablet.png' })
await p.setViewportSize({ width: 1200, height: 700 }); await p.waitForTimeout(300)
ok('desktop width restores the full sidebar', (await w('aside')) >= 260)
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
