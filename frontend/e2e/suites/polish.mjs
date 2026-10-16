import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Polish ${S}` }); const g2 = await call(a.token, 'POST', '/guilds', { name: `Two ${S}` }); const g3 = await call(a.token, 'POST', '/guilds', { name: `Three ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const chans = await call(a.token, 'GET', `/guilds/${g.id}/channels`); const tc = chans.find((x) => x.kind === 'text')
await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: 'hello there' }); await call(b.token, 'POST', `/channels/${tc.id}/messages`, { content: '🔥🔥' })
const catA = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'Alpha', kind: 'category' })).body
const catB = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'Beta', kind: 'category' })).body
const secret = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'staff-only', kind: 'text' })).body
await callS(a.token, 'PUT', `/channels/${secret.id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: 1024 })

const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('.msg-content.jumbo')

console.log('-- messages & composer')
const jumbo = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.msg-content.jumbo')).fontSize))
ok('emoji-only messages render jumbo again', jumbo >= 40, String(jumbo))
await p.evaluate(() => document.documentElement.style.setProperty('--font-scale', '1.2'))
ok('jumbo scales with the chat font scale', (await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.msg-content.jumbo')).fontSize))) > jumbo)
await p.evaluate(() => document.documentElement.style.setProperty('--font-scale', '1'))
const gap = await p.evaluate(() => window.innerHeight - document.querySelector('textarea').getBoundingClientRect().bottom)
const boxGap = await p.evaluate(() => window.innerHeight - document.querySelector('textarea').closest('[data-composer-box]').getBoundingClientRect().bottom)
ok('composer box is bottom aligned with the self card', boxGap <= 10, String(boxGap))
void gap

console.log('-- member list')
await p.waitForSelector('[data-member-stats]')
ok('member list is wider with side padding', (await p.evaluate(() => { const a = document.querySelector('[data-member-list]'); const cs = getComputedStyle(a); return [a.getBoundingClientRect().width, parseFloat(cs.paddingLeft)] })).every((v, i) => (i === 0 ? v >= 270 : v >= 12)))
const stat = async (k) => Number(await p.getAttribute(`[data-member-stat="${k}"]`, 'data-member-stat-value'))
ok('totals: online here / members / in voice', await stat('online-here') === 1 && await stat('total') === 2 && await stat('voice') === 0)
await p.hover('[data-member-stat="total"]'); await p.waitForSelector('[role=tooltip]')
ok('hovering a count shows its tooltip', (await p.textContent('[role=tooltip]')) === '2 total server members')
await p.mouse.move(700, 400)
await p.goto(`${WEB}/channels/${g.id}/${secret.id}`); await p.waitForSelector('[data-member-stats]'); await p.waitForTimeout(300)
ok('"online here" counts only members who can see this channel', await stat('online-here') === 1 && await stat('total') === 2)
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('[data-member-stats]')

console.log('-- category reorder')
await p.waitForSelector(`[data-category="${catB.id}"] [data-category-header]`)
ok('categories start in creation order', (await p.locator('[data-category]').evaluateAll((els) => els.map((e) => e.getAttribute('data-category')))).join() === [catA.id, catB.id].join())
await p.locator(`[data-category="${catB.id}"] [data-category-header]`).dragTo(p.locator(`[data-category="${catA.id}"]`), { targetPosition: { x: 40, y: 6 } })
await p.waitForFunction((id) => document.querySelector('[data-category]')?.getAttribute('data-category') === id, catB.id)
await p.waitForTimeout(400)
const order = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).filter((c) => c.kind === 'category').sort((x, y) => x.position - y.position).map((c) => c.id)
ok('dragging a category above another reorders and persists', order.join() === [catB.id, catA.id].join())

console.log('-- folder reorder')
await call(a.token, 'PUT', '/users/@me/guild-layout', [{ kind: 'guild', id: g.id }, { kind: 'folder', id: 'f_polish', name: 'Fun', color: '#e91e63', guilds: [g2.id, g3.id] }])
await p.reload(); await p.waitForSelector('[data-folder="f_polish"]')
const barOrder = async () => p.locator('[data-guild-bar] [data-guild-icon], [data-guild-bar] [data-folder]').evaluateAll((els) => els.map((e) => e.getAttribute('data-guild-icon') ?? 'folder:' + e.getAttribute('data-folder')))
ok('layout renders server then folder', (await barOrder()).slice(0, 2).join() === [g.id, 'folder:f_polish'].join())
await p.dragAndDrop('[data-folder="f_polish"] [data-folder-tile]', `[data-guild-icon="${g.id}"]`, { targetPosition: { x: 24, y: 3 } }); await p.waitForTimeout(600)
ok('dragging a folder above a server reorders it', (await barOrder()).slice(0, 2).join() === ['folder:f_polish', g.id].join())
const saved = await call(a.token, 'GET', '/users/@me/guild-layout')
ok('…and the order is persisted', (Array.isArray(saved) ? saved : saved.layout ?? [])[0]?.id === 'f_polish')
await p.click('[data-folder="f_polish"] [data-folder-tile]', { button: 'right' }); await p.waitForSelector('[data-context-menu] [data-menu-item="Move Down"]'); await p.click('[data-context-menu] [data-menu-item="Move Down"]'); await p.waitForTimeout(400)
ok('Move Down in the folder menu works too', (await barOrder()).slice(0, 2).join() === [g.id, 'folder:f_polish'].join())
await p.click('[data-folder="f_polish"] [data-folder-tile]'); await p.waitForSelector('[data-folder-contents]')
const inner = await p.evaluate(() => document.querySelector('[data-folder-contents] [data-guild-icon] div')?.getBoundingClientRect().width)
ok('servers inside an open folder are smaller than the folder tile', inner <= 40, String(inner))
await p.screenshot({ path: '116-polish.png' })
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
