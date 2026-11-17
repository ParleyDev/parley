// Help links into the user guide (runparley.com/guide, built from docs/guide): every settings section has a Help
// button opening the guide at the part about it (user, server and channel settings, on a computer and on a phone),
// the user menu and the settings footer open the guide's front page, and the shortcuts sheet opens its shortcuts page.
import { chromium } from 'playwright'
import { WEB, reg, call, ok, finish, phone } from '../lib.mjs'

const a = await reg('guidey')
const g = await call(a.token, 'POST', '/guilds', { name: 'Guide Town' })
const chans = await call(a.token, 'GET', `/guilds/${g.id}/channels`)
const general = chans.find((c) => c.kind === 'text') ?? chans[0]

const browser = await chromium.launch(); const errors = []
const start = async (ctxOpts = { viewport: { width: 1440, height: 900 } }, path = `/channels/${g.id}/${general.id}`) => {
  const p = await (await browser.newContext(ctxOpts)).newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null } })
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
  await p.goto(`${WEB}${path}`); await p.waitForSelector('[data-panel-self]', { state: 'attached' })
  return p
}
const opened = (p) => p.evaluate(() => window.__opened.at(-1) ?? '')
const G = 'https://runparley.com/guide/'

const p = await start()
console.log('-- user settings')
await p.click('[data-user-panel] [data-control="User Settings"]'); await p.click('[data-settings-tab="appearance"]')
await p.click('[data-settings-section-pane] [data-help-link]:visible')
ok('Appearance\'s Help opens the guide there', await opened(p) === `${G}settings/#appearance`, await opened(p))
await p.click('[data-settings-tab="voice"]'); await p.click('[data-settings-section-pane] [data-help-link]:visible')
ok('each section has its own place in the guide', await opened(p) === `${G}voice-and-video/#sounding-your-best`, await opened(p))
await p.click('[data-help-guide]')
ok('the footer\'s Help & Guide opens the front page', await opened(p) === G, await opened(p))
await p.keyboard.press('Escape')

console.log('-- server and channel settings')
await p.click('aside button:has-text("Guide Town")'); await p.click('text=Server Settings'); await p.click('[data-settings-tab="roles"]')
await p.click('[data-settings-section-pane] [data-help-link]:visible')
ok('Roles\' Help opens the roles page', await opened(p) === `${G}roles-and-permissions/`, await opened(p))
await p.click('[data-settings-tab="automod"]'); await p.click('[data-settings-section-pane] [data-help-link]:visible')
ok('AutoMod\'s Help opens moderation at AutoMod', await opened(p) === `${G}moderation/#automod`, await opened(p))
await p.keyboard.press('Escape')

console.log('-- user menu and shortcuts')
await p.click('[data-panel-self]'); await p.click('[data-user-menu-help]')
ok('the user menu has Help & Guide', await opened(p) === G, await opened(p))
await p.keyboard.press('Escape'); await p.click('[data-composer], [contenteditable]').catch(() => {}); await p.keyboard.press('Control+Slash'); await p.waitForSelector('[data-shortcuts]'); await p.click('[data-shortcuts-guide]')
ok('the shortcuts sheet opens the shortcuts page', await opened(p) === `${G}keyboard-shortcuts/`, await opened(p))
const box = await p.locator('[role=dialog]:has([data-shortcuts])').boundingBox()
ok('a dialog taller than the window keeps its buttons on screen', box && box.y >= 0 && box.y + box.height <= 900 && await p.locator('[data-shortcuts-edit]').isVisible(), JSON.stringify(box))

console.log('-- phone')
const ph = await start(phone(), '/channels/@me')
await ph.click('[data-control="User Settings"]:visible').catch(() => {})
await ph.waitForSelector('[data-settings-tab="appearance"]').catch(() => {})
if (await ph.locator('[data-settings-tab="appearance"]').count()) {
  await ph.click('[data-settings-tab="appearance"]'); await ph.click('[data-settings-section-pane] [data-help-link]:visible')
  ok('a phone has Help in the section\'s header', await opened(ph) === `${G}settings/#appearance`, await opened(ph))
} else ok('a phone has Help in the section\'s header (settings opened)', false)

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
