// The web client inside the desktop shell: startup and hardware-acceleration settings, the unread badge, native
// zoom and its keys, spellcheck, and the invite page's "Open in the desktop app" link. The shell's commands are
// faked here (desktop/tests/shell.mjs drives the real one).
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, openDms, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
await openDms(a, b)
const g = await call(b.token, 'POST', '/guilds', { name: `Desk ${S}` })
const inv = await call(b.token, 'POST', `/guilds/${g.id}/invites`, {})
await call(a.token, 'POST', `/invites/${inv.code}`)
const ch = g.channels.find((c) => c.kind === 'text')
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ParleyDesktop/0.13.0'
const browser = await chromium.launch(); const errors = []
const fake = () => {
  window.__calls = []
  const st = { autostart: false, start_minimized: false, hardware_acceleration: true, version: '0.13.0' }
  window.__TAURI_INTERNALS__ = { invoke: async (cmd, args) => {
    window.__calls.push([cmd, args ?? null])
    if (cmd === 'desktop_settings') return { ...st }
    if (cmd === 'set_desktop_settings') { if (args.autostart !== undefined) st.autostart = args.autostart; if (args.startMinimized !== undefined) st.start_minimized = args.startMinimized; if (args.hardwareAcceleration !== undefined) st.hardware_acceleration = args.hardwareAcceleration; return { ...st } }
    return null
  } }
}
const mk = async (ua, withShell) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(ua ? { userAgent: ua } : {}) })
  if (withShell) await ctx.addInitScript(fake)
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
  return p
}
const calls = (p, cmd) => p.evaluate((c) => window.__calls.filter((x) => x[0] === c).map((x) => x[1]), cmd)

console.log('-- settings')
const p = await mk(UA, true)
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector('textarea')
await p.click('button[title="User Settings"]')
await p.click('[data-settings-tab="advanced"]'); await p.waitForSelector('[data-desktop-settings]')
ok('the desktop section shows inside the app', true)
await p.click('[data-desktop-autostart] button')
await p.waitForFunction(() => window.__calls.some((c) => c[0] === 'set_desktop_settings'))
ok('Open on startup asks the shell', JSON.stringify((await calls(p, 'set_desktop_settings'))[0]) === '{"autostart":true}')
await p.click('[data-desktop-minimized] button')
await p.waitForFunction(() => window.__calls.filter((c) => c[0] === 'set_desktop_settings').length === 2)
ok('and Start minimized', JSON.stringify((await calls(p, 'set_desktop_settings'))[1]) === '{"startMinimized":true}')
await p.click('[data-desktop-hwaccel] button')
await p.waitForSelector('[data-desktop-restart]')
ok('turning hardware acceleration off asks for a restart', JSON.stringify((await calls(p, 'set_desktop_settings'))[2]) === '{"hardwareAcceleration":false}')

console.log('-- zoom and spellcheck')
await p.click('[data-settings-tab="language"]'); await p.waitForSelector('[data-spellcheck-toggle]')
await p.click('[data-spellcheck-toggle] button')
await p.keyboard.press('Escape'); await p.waitForTimeout(300)
ok('spellcheck can be turned off in the message box', await p.locator('textarea').first().getAttribute('spellcheck') === 'false')
await p.evaluate(() => { window.__calls.length = 0 })
await p.keyboard.press('Control+Equal'); await p.waitForTimeout(150); await p.keyboard.press('Control+Equal'); await p.waitForTimeout(150)
const z = await calls(p, 'set_zoom')
ok('Ctrl+= zooms natively in 10% steps', z.length >= 2 && Math.abs(z.at(-1).factor - 1.2) < 1e-9, JSON.stringify(z))
ok('without CSS zoom on top', await p.evaluate(() => document.documentElement.style.zoom === ''))
await p.keyboard.press('Control+0'); await p.waitForTimeout(150)
ok('Ctrl+0 resets it', (await calls(p, 'set_zoom')).at(-1).factor === 1)

console.log('-- badge')
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('[data-guild-bar], nav')
await p.evaluate(() => { window.__calls.length = 0 })
await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: `<@${a.user.id}> hey` })
await p.waitForFunction(() => window.__calls.some((c) => c[0] === 'set_badge' && c[1].count > 0), null, { timeout: 8000 }).catch(() => {})
ok('a mention puts a count on the app icon', (await calls(p, 'set_badge')).some((x) => x.count === 1), JSON.stringify(await calls(p, 'set_badge')))
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForTimeout(1500)
ok('reading it clears the badge', (await calls(p, 'set_badge')).at(-1)?.count === 0, JSON.stringify(await calls(p, 'set_badge')))

console.log('-- browsers')
const w = await mk(null, false)
await w.goto(`${WEB}/channels/${g.id}/${ch.id}`); await w.waitForSelector('textarea')
await w.evaluate(() => localStorage.setItem('parley.prefs', JSON.stringify({ zoom: 120 }))); await w.reload(); await w.waitForSelector('textarea')
ok('browsers keep CSS zoom', await w.evaluate(() => document.documentElement.style.zoom === '120%'))
const inv2 = await call(b.token, 'POST', `/guilds/${g.id}/invites`, {})
await w.goto(`${WEB}/invite/${inv2.code}`); await w.waitForSelector('[data-invite-open-app]')
ok('invite pages offer the desktop app', await w.locator('[data-invite-open-app]').getAttribute('href') === `parley://invite/${inv2.code}`)
const d2 = await mk(UA, true); await d2.goto(`${WEB}/invite/${inv2.code}`); await d2.waitForTimeout(1500)
ok('but not inside it', await d2.locator('[data-invite-open-app]').count() === 0)
const old = await mk(UA, false); await old.goto(`${WEB}/channels/${g.id}/${ch.id}`); await old.waitForSelector('textarea')
ok('older shells without commands still work', true)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(b.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
