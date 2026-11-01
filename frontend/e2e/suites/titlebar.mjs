// Discord's title bar on wide screens: back/forward, where you are (server, DM, Friends) and the inbox, which leaves
// the channel headers while the bar is on. Settings → Appearance → Show title bar turns it off; never on phones.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Bar ${S}` }); const ch = g.channels.find((x) => x.kind === 'text')
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
const place = () => p.locator('[data-title-bar-name]').innerText()

await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('[data-title-bar]')
const bar = await p.locator('[data-title-bar]').boundingBox()
ok('a title bar runs across the top of the app', bar && bar.y < 40 && bar.width >= 1400 && bar.height >= 30 && bar.height <= 40, JSON.stringify(bar))
ok('on the home page it says Friends', (await place()) === 'Friends')
ok('the inbox sits in the title bar, not in the page header', await p.locator('[data-title-bar] [data-inbox-toggle]').count() === 1 && await p.locator('[data-inbox-toggle]').count() === 1)
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector('[data-message-list]')
ok('in a server it names the server', (await place()) === `Bar ${S}`)
ok('still only one inbox (the channel header lets the bar have it)', await p.locator('[data-inbox-toggle]').count() === 1)
await p.screenshot({ path: 'titlebar-server.png' })
await p.click('[data-title-bar] [data-inbox-toggle]'); await p.waitForTimeout(300)
ok('the inbox opens from the title bar', await p.locator('[data-inbox]').isVisible())
await p.keyboard.press('Escape')
await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector('[data-message-list]')
ok('in a DM it names the person', (await place()) === b.user.display_name, await place())
await p.click('[data-title-back]'); await p.waitForTimeout(500)
ok('Back goes to the previous view', new URL(p.url()).pathname === `/channels/${g.id}/${ch.id}`, p.url())
await p.click('[data-title-forward]'); await p.waitForTimeout(500)
ok('Forward comes back', new URL(p.url()).pathname === `/channels/@me/${dm.id}`, p.url())

// Off in settings
await p.click('[data-user-panel] [data-control="User Settings"]'); await p.click('[data-settings-tab="appearance"]')
await p.locator('label:has-text("Show title bar") button[role=switch]').click(); await p.keyboard.press('Escape'); await p.waitForTimeout(300)
ok('Settings → Appearance turns it off', await p.locator('[data-title-bar]').count() === 0)
ok('and the inbox goes back to the header', await p.locator('header [data-inbox-toggle], [data-inbox-toggle]').count() === 1 && await p.locator('[data-title-bar] [data-inbox-toggle]').count() === 0)
await p.reload(); await p.waitForSelector('[data-message-list]')
ok('the choice is remembered', await p.locator('[data-title-bar]').count() === 0)
await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.endsWith('prefs')); if (k) { const v = JSON.parse(localStorage.getItem(k)); v.titleBar = true; localStorage.setItem(k, JSON.stringify(v)) } })

// Phones: never
const ph = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage(); ph.on('pageerror', (e) => errors.push(e.message))
await ph.goto(`${WEB}/login`); await ph.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await ph.goto(`${WEB}/channels/${g.id}/${ch.id}`); await ph.waitForTimeout(1500)
ok('phones have no title bar', await ph.locator('[data-title-bar]').count() === 0)
ok('and keep the inbox in the header', await ph.locator('[data-inbox-toggle]').count() >= 1)

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
