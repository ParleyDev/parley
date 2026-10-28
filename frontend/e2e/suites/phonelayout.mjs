// Phones: the page is never wider than the screen; the message box is at least 16px so focusing it doesn't zoom
// the page (iOS and installed web apps); with a see-through palette, panes that cover the app (member list,
// navigation) are solid so what's hidden underneath doesn't show through.
import { chromium, devices } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Phone ${S}` }); const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: 'https://example.com/' + 'x'.repeat(180) })
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ ...devices['Pixel 7'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => { localStorage.setItem('parley.token', t); localStorage.setItem('parley.appearance', JSON.stringify({ palette: 'aurora', theme: 'dark' })) }, a.token)
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector('textarea'); await p.waitForTimeout(1200)
ok('the page is no wider than the screen', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
ok('the message box is 16px, so focusing it does not zoom', await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('textarea.composer-input')).fontSize) >= 16))
const alpha = (sel) => p.evaluate((s) => { const c = getComputedStyle(document.querySelector(s)).backgroundColor; const m = /rgba?\(([^)]+)\)/.exec(c); const parts = m ? m[1].split(/[ ,/]+/).filter(Boolean) : []; return parts.length > 3 ? parseFloat(parts[3]) : 1 }, sel)
await p.click('button[title="Member List"]'); await p.waitForSelector('[data-member-list]')
ok('the member list covers the chat with a solid surface', await alpha('[data-member-list]') === 1)
await p.click('[data-member-list] button:has(svg)').catch(() => {}); await p.waitForTimeout(300)
await p.goto(`${WEB}/channels/${g.id}`); await p.waitForTimeout(1000)
ok('so does the navigation pane', await p.evaluate(() => { const el = document.querySelector('[data-layer="md"]'); if (!el) return false; const c = getComputedStyle(el).backgroundColor; return !/\/\s*0?\.\d|, 0?\.\d+\)$/.test(c) }))
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
