// The web client inside the desktop shell: startup and hardware-acceleration settings, the unread badge, native
// zoom and its keys, spellcheck, push to talk in the background, and the invite page's "Open in the desktop app" link. The shell's commands are
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
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const fake = () => {
  window.__calls = []
  const st = { autostart: false, start_minimized: false, hardware_acceleration: true, close_to_tray: true, minimize_to_tray: false, tray: true, version: '0.13.0' }
  window.__TAURI_INTERNALS__ = { invoke: async (cmd, args) => {
    window.__calls.push([cmd, args ?? null])
    if (cmd === 'desktop_settings') return { ...st }
    if (cmd === 'set_ptt_key') return window.__pttOk ?? true
    if (cmd === 'streaming_apps') return !!window.__obs
    if (cmd === 'set_desktop_settings') { if (args.autostart !== undefined) st.autostart = args.autostart; if (args.startMinimized !== undefined) st.start_minimized = args.startMinimized; if (args.hardwareAcceleration !== undefined) st.hardware_acceleration = args.hardwareAcceleration; if (args.closeToTray !== undefined) st.close_to_tray = args.closeToTray; if (args.minimizeToTray !== undefined) st.minimize_to_tray = args.minimizeToTray; return { ...st } }
    return null
  } }
}
const mk = async (ua, withShell) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'], ...(ua ? { userAgent: ua } : {}) })
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

console.log('-- tray and OBS')
await p.click('button[title="User Settings"]'); await p.click('[data-settings-tab="advanced"]'); await p.waitForSelector('[data-desktop-close-tray]')
await p.click('[data-desktop-close-tray] button'); await p.click('[data-desktop-minimize-tray] button')
await p.waitForFunction(() => window.__calls.filter((c) => c[0] === 'set_desktop_settings').length >= 2)
const trayCalls = await calls(p, 'set_desktop_settings')
ok('close and minimise to tray reach the shell', trayCalls.some((c) => c.closeToTray === false) && trayCalls.some((c) => c.minimizeToTray === true), JSON.stringify(trayCalls))
await p.click('[data-settings-tab="streamer"]'); await p.waitForSelector('[data-streamer-auto]')
ok('the OBS switch works in the app', await p.locator('[data-streamer-auto] button').isEnabled())
await p.click('[data-streamer-auto] button'); await p.keyboard.press('Escape')
const streamer = () => p.evaluate(() => document.documentElement.dataset.streamer)
await p.evaluate(() => window.__parleyStreamerCheck())
ok('nothing happens without OBS', await streamer() === '0')
await p.evaluate(async () => { window.__obs = true; await window.__parleyStreamerCheck() })
ok('OBS starting turns Streamer Mode on', await streamer() === '1')
await p.evaluate(async () => { window.__obs = false; await window.__parleyStreamerCheck() })
ok('and quitting turns it off again', await streamer() === '0')

console.log('-- push to talk')
const vc = g.channels.find((c) => c.kind === 'voice')
const pp = await mk(UA, true)
await pp.evaluate(() => localStorage.setItem('parley.voiceSettings', JSON.stringify({ inputMode: 'ptt', pttKey: 'F8' })))
await pp.goto(`${WEB}/channels/${g.id}/${vc.id}`); await pp.waitForSelector('text=Join Voice')
ok('nothing is watched outside a call', (await calls(pp, 'set_ptt_key')).length === 0)
await pp.click('text=Join Voice'); await pp.waitForSelector('[data-voice-leave]')
await pp.waitForFunction(() => window.__calls.some((c) => c[0] === 'set_ptt_key'))
ok('joining a call hands the shell the key', JSON.stringify(await calls(pp, 'set_ptt_key')) === '[{"code":"F8"}]')
const badge = () => pp.locator('span[title="Push to talk"]').getAttribute('class')
await pp.evaluate(() => window.__parleyPtt(true)); await pp.waitForTimeout(150)
ok('the shell holding it transmits', /bg-success/.test(await badge()))
await pp.evaluate(() => window.__parleyPtt(false)); await pp.waitForTimeout(150)
ok('and letting go stops', !/bg-success/.test(await badge()))
await pp.evaluate(() => { window.__pttOk = false })
await pp.click('button[title="User Settings"]'); await pp.click('[data-settings-tab="voice"]').catch(() => {})
ok('settings say it works in the background', await pp.locator('text=Works while Parley is in the background').count() === 1)
await pp.keyboard.press('Escape')
await pp.click('[data-voice-leave]'); await pp.waitForTimeout(400)
ok('leaving stops the watch', JSON.stringify((await calls(pp, 'set_ptt_key')).at(-1)) === '{"code":null}')
await pp.click('text=Join Voice'); await pp.waitForSelector('text=only works while Parley is in front', { timeout: 5000 }).catch(() => {})
ok('a shell that cannot read keys says so', await pp.locator('text=only works while Parley is in front').count() >= 1)
await pp.click('[data-voice-leave]')

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
