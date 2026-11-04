// Discord's title bar on wide screens: back/forward, where you are (server, DM, Friends) and the inbox, which leaves
// the channel headers while the bar is on. Settings → Appearance → Show title bar turns it off; never on phones.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish, adminToken } from '../lib.mjs'
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

// Pages outside the chat keep the bar (in the desktop app it is the window's drag strip and close button).
await p.goto(`${WEB}/discover`); await p.waitForSelector('[data-title-bar]')
ok('Discover keeps the title bar and names itself', (await place()) === 'Discover')
const admin = await adminToken()
const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const pa = await actx.newPage(); pa.on('pageerror', (e) => errors.push(e.message))
await pa.goto(`${WEB}/login`); await pa.evaluate((t) => localStorage.setItem('parley.token', t), admin.token)
await pa.goto(`${WEB}/channels/@me`); await pa.waitForSelector('[data-title-bar]')
await pa.goto(`${WEB}/admin`); await pa.waitForSelector('[data-admin]')
ok('so does the admin console', await pa.locator('[data-title-bar]').count() === 1 && (await pa.locator('[data-title-bar-name]').innerText()) === 'Admin Console')
await pa.click('[data-title-back]'); await pa.waitForTimeout(500)
ok('and Back leaves it', new URL(pa.url()).pathname === '/channels/@me', pa.url())
await actx.close()
await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector('[data-message-list]')

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

// Desktop app (bridge faked: the ParleyDesktop user agent and a recording invoke)
const desk = async (frame, prefsOff) => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) ParleyDesktop/0.21.0' })
  await c.addInitScript(([frame, off]) => {
    window.__calls = []
    window.__TAURI_INTERNALS__ = { invoke: async (cmd, args) => {
      window.__calls.push(cmd === 'window_control' ? args.action : cmd)
      if (cmd === 'desktop_settings') return { autostart: false, start_minimized: false, hardware_acceleration: true, version: '0.21.0', ...(frame ? { frame } : {}) }
      if (cmd === 'window_control') return args.action === 'maximize'
      return null
    } }
    if (off) { const k = Object.keys(localStorage).find((x) => x.endsWith('prefs')) ?? 'parley.prefs'; const v = JSON.parse(localStorage.getItem(k) ?? '{}'); v.titleBar = false; localStorage.setItem(k, JSON.stringify(v)) }
  }, [frame, prefsOff])
  const d = await c.newPage(); d.on('pageerror', (e) => errors.push(e.message))
  await d.goto(`${WEB}/login`); await d.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
  await d.goto(`${WEB}/channels/${g.id}/${ch.id}`); await d.waitForSelector('[data-message-list]'); await d.waitForTimeout(800)
  return d
}
const calls = (d) => d.evaluate(() => window.__calls.filter((x) => !['desktop_settings', 'update_status', 'state', 'set_badge', 'set_zoom', 'set_theme', 'set_app_icon', 'set_ptt_key', 'streaming_apps', 'flash'].includes(x)))
console.log('-- frameless desktop window')
const dw = await desk('custom', true)
ok('desktop: the title bar shows even with the setting off (the window has no frame)', await dw.locator('[data-title-bar="custom"]').count() === 1)
ok('desktop: minimise, maximise and close buttons at the right', await dw.locator('[data-window-controls] [data-window]').count() === 3)
const ctl = await dw.locator('[data-window-controls]').boundingBox()
ok('desktop: flush with the window\'s right edge', ctl && Math.abs(ctl.x + ctl.width - 1440) < 2, JSON.stringify(ctl))
ok('desktop: the server list drops its back/forward arrows (the title bar has them)', await dw.locator('[data-history-nav]').count() === 0)
await dw.click('[data-window="minimize"]'); await dw.click('[data-window="maximize"]'); await dw.click('[data-window="close"]')
const bb = await dw.locator('[data-title-bar]').boundingBox()
await dw.mouse.move(bb.x + 300, bb.y + bb.height / 2); await dw.mouse.down(); await dw.mouse.up()
await dw.mouse.dblclick(bb.x + 300, bb.y + bb.height / 2)
const got = await calls(dw)
ok('desktop: the buttons minimise, maximise and close the window', JSON.stringify(got.slice(0, 3)) === '["minimize","maximize","close"]', JSON.stringify(got))
ok('desktop: pressing on the empty bar drags the window, a double-click maximises', got.slice(3).includes('drag') && got.slice(3).includes('maximize'), JSON.stringify(got))
ok('desktop: after maximising, the button offers Restore', (await dw.locator('[data-window="maximize"]').getAttribute('title')) === 'Restore')
await dw.screenshot({ path: 'titlebar-desktop.png' })
await dw.click('[data-user-panel] [data-control="User Settings"]'); await dw.click('[data-settings-tab="appearance"]')
ok('desktop: the Show title bar setting is on and locked', await dw.locator('label:has-text("Show title bar") button[role=switch]').isDisabled() && (await dw.locator('label:has-text("Show title bar") button[role=switch]').getAttribute('aria-checked')) === 'true')
await dw.context().close()
console.log('-- macOS window')
const mw = await desk('mac', false)
const pad = await mw.locator('[data-title-bar]').evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))
ok('macOS: no drawn buttons, room for the traffic lights', await mw.locator('[data-window-controls]').count() === 0 && pad >= 78, String(pad))
await mw.context().close()
console.log('-- older desktop app (system frame)')
const ow = await desk(null, true)
ok('older app with the setting off: no title bar, the server list keeps its arrows', await ow.locator('[data-title-bar]').count() === 0 && await ow.locator('[data-history-nav]').count() === 1)
await ow.context().close()
const on2 = await desk(null, false)
ok('older app with the title bar on: arrows only in the title bar, no window buttons', await on2.locator('[data-history-nav]').count() === 0 && await on2.locator('[data-title-back]').count() === 1 && await on2.locator('[data-window-controls]').count() === 0)
await on2.context().close()

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
