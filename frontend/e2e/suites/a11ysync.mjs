// Settings sync across devices, screen-reader support (landmarks, skip link, a live region for new messages),
// arrow-key navigation in lists, and the first-run Getting Started checklist.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `A11y ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const ch = g.channels.find((x) => x.kind === 'text')
const second = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'second', kind: 'text' })
for (let i = 0; i < 3; i++) await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: `line ${i}` })
const browser = await chromium.launch(); const errors = []
const mk = async (tok, path) => { const p = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), tok); await p.goto(`${WEB}${path}`); await p.waitForTimeout(1200); return p }

console.log('-- getting started')
const fresh = await reg('newbie')
const pn = await mk(fresh.token, '/channels/@me')
ok('new accounts get a Getting Started checklist', await pn.locator('[data-getting-started]').count() === 1)
await pn.click('[data-getting-started-step="friend"]'); await pn.waitForTimeout(300)
ok('steps take you where you need to go', await pn.locator('input[placeholder*="username" i], [data-add-friend-input]').count() >= 1)
await pn.click('[data-getting-started-dismiss]').catch(() => {}); await pn.waitForTimeout(200)
ok('and it can be dismissed', await pn.locator('[data-getting-started]').count() === 0)

console.log('-- settings sync')
const pa1 = await mk(a.token, `/channels/${g.id}/${ch.id}`)
const pa2 = await mk(a.token, `/channels/${g.id}/${ch.id}`)
await pa1.click('[data-control="User Settings"]'); await pa1.click('button:has-text("Appearance")'); await pa1.waitForSelector('[data-appearance]')
await pa1.click('[data-palette-option="midnight"]'); await pa1.waitForTimeout(2000)
ok('a setting changed on one device follows to the others', await pa2.evaluate(() => document.documentElement.dataset.palette) === 'midnight')
const pa3 = await mk(a.token, `/channels/${g.id}/${ch.id}`)
ok('including new sessions', await pa3.evaluate(() => document.documentElement.dataset.palette) === 'midnight')
await pa1.uncheck('[data-sync-settings]'); await pa1.click('[data-palette-option="onyx"]'); await pa1.waitForTimeout(1500)
ok('turning sync off keeps changes on this device', await pa2.evaluate(() => document.documentElement.dataset.palette) === 'midnight' && await pa1.evaluate(() => document.documentElement.dataset.palette) === 'onyx')
await pa1.keyboard.press('Escape')

console.log('-- screen readers and the keyboard')
const pa = pa2
ok('landmarks are labelled', await pa.locator('nav[aria-label="Servers"]').count() === 1 && await pa.locator('aside[aria-label="Channels"]').count() === 1 && await pa.locator('[role="log"][data-message-list]').count() >= 1)
// From the top of the page (the composer may hold focus after load).
await pa.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex') }); await pa.keyboard.press('Tab'); await pa.waitForTimeout(100)
ok('Tab first reaches a skip link', await pa.evaluate(() => document.activeElement?.hasAttribute('data-skip-link')), await pa.evaluate(() => document.activeElement?.outerHTML.slice(0, 160)))
await pa.keyboard.press('Enter'); await pa.waitForTimeout(100)
ok('which jumps to the messages', await pa.evaluate(() => document.activeElement?.hasAttribute('data-message-list')))
await pa.keyboard.press('ArrowUp'); await pa.waitForTimeout(100)
const lastId = await pa.evaluate(() => document.activeElement?.getAttribute('data-msg-id'))
await pa.keyboard.press('ArrowUp'); await pa.waitForTimeout(100)
const prevId = await pa.evaluate(() => document.activeElement?.getAttribute('data-msg-id'))
ok('arrow keys move through messages', !!lastId && !!prevId && lastId !== prevId)
await pa.focus(`[data-channel-item="${ch.id}"] > a`); await pa.keyboard.press('ArrowDown'); await pa.waitForTimeout(100)
ok('and through the channel list', await pa.evaluate(() => !!document.activeElement?.closest('[data-channel-item]')) && (await pa.evaluate(() => document.activeElement?.closest('[data-channel-item]')?.getAttribute('data-channel-item'))) !== ch.id)
await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: `announce me ${S}` }); await pa.waitForTimeout(800)
ok('new messages are announced', (await pa.locator('[data-live-region]').first().innerText()).includes(`announce me ${S}`))
void second
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
