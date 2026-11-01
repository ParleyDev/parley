// Desktop app updates (bridge faked): the shell's updater status shows as Discord's green arrow in the title bar and
// in Settings → Advanced → App updates (check, progress, restart to update); apps from before the updater are
// pointed at the download page when a newer release is out.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Upd ${S}` }); const ch = g.channels.find((x) => x.kind === 'text')
const browser = await chromium.launch(); const errors = []

/** `shell`: the updater status the fake shell reports in turn (null = an old shell without the updater). */
const open = async (statuses, version = '0.21.0') => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: `Mozilla/5.0 (X11; Linux x86_64) ParleyDesktop/${version}` })
  await c.route('https://api.github.com/repos/ParleyDev/parley/releases/latest', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tag_name: 'v0.22.0' }) }))
  await c.addInitScript(([statuses, version]) => {
    window.__calls = []; window.__channel = 'stable'; let i = 0
    const next = () => statuses[Math.min(i++, statuses.length - 1)]
    window.__TAURI_INTERNALS__ = { invoke: async (cmd, args) => {
      window.__calls.push(cmd === 'set_desktop_settings' && args?.updateChannel ? `channel:${args.updateChannel}` : cmd)
      if (cmd === 'set_desktop_settings' && args?.updateChannel) window.__channel = args.updateChannel
      if (cmd === 'desktop_settings' || cmd === 'set_desktop_settings') return { autostart: false, start_minimized: false, hardware_acceleration: true, version, frame: 'custom', ...(statuses ? { update_channel: window.__channel } : {}) }
      if (cmd === 'update_status' || cmd === 'check_update') { if (!statuses) throw new Error('Command update_status not found'); return { downloaded: 0, current: version, ...next() } }
      if (cmd === 'install_update') return null
      if (cmd === 'window_control') return false
      return null
    } }
  }, [statuses, version])
  const p = await c.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
  await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector('[data-message-list]'); await p.waitForTimeout(1200)
  return p
}
const advanced = async (p) => { await p.click('[data-user-panel] [data-control="User Settings"]'); await p.click('[data-settings-tab="advanced"]'); await p.waitForSelector('[data-app-updates]') }

console.log('-- up to date')
let p = await open([{ state: 'none' }])
ok('no update arrow when the app is up to date', await p.locator('[data-desktop-update]').count() === 0)
await advanced(p)
ok('the update channel starts on Stable', (await p.locator('button#update-channel').innerText()).startsWith('Stable'))
await p.click('button#update-channel'); await p.locator('[data-dropdown-option="dev"]').click(); await p.waitForTimeout(800)
const chc = await p.evaluate(() => window.__calls)
ok('picking Development switches the shell\'s channel and checks again', chc.includes('channel:dev') && chc.includes('check_update') && (await p.locator('button#update-channel').innerText()).startsWith('Development'), JSON.stringify(chc))
ok('Settings shows the version and that it is up to date', /Parley desktop 0\.21\.0/.test(await p.locator('[data-app-updates]').innerText()) && /up to date/.test(await p.locator('[data-app-update-line]').innerText()))
await p.context().close()

console.log('-- check, download, ready')
p = await open([{ state: 'none' }, { state: 'checking' }, { state: 'downloading', version: '0.22.0', downloaded: 50, total: 100 }, { state: 'ready', version: '0.22.0' }])
await advanced(p)
await p.click('[data-app-update-check]')
await p.waitForSelector('[data-app-updates="downloading"]', { timeout: 5000 }).catch(() => {})
ok('Check for updates asks the shell and shows the download progress', (await p.evaluate(() => window.__calls)).includes('check_update') && /Downloading 0\.22\.0… 50%/.test(await p.locator('[data-app-update-line]').innerText()), await p.locator('[data-app-update-line]').innerText())
await p.waitForSelector('[data-app-updates="ready"]', { timeout: 5000 }).catch(() => {})
ok('when it is downloaded Settings offers Restart to update', await p.locator('[data-app-update-install]').count() === 1)
await p.screenshot({ path: 'desktop-update-settings.png' })
await p.keyboard.press('Escape'); await p.waitForTimeout(300)
ok('and the title bar shows the green arrow', await p.locator('[data-title-bar] [data-desktop-update="ready"]').count() === 1 && /Restart to update to 0\.22\.0/.test(await p.locator('[data-desktop-update]').getAttribute('title')))
await p.screenshot({ path: 'desktop-update-titlebar.png', clip: { x: 0, y: 0, width: 1440, height: 40 } })
await p.click('[data-desktop-update="ready"]'); await p.waitForTimeout(200)
ok('clicking it installs the update (the shell restarts the app)', (await p.evaluate(() => window.__calls)).includes('install_update'))
await p.context().close()

console.log('-- older app without an updater')
p = await open(null, '0.20.0')
await p.waitForSelector('[data-desktop-update="download"]', { timeout: 5000 }).catch(() => {})
ok('a newer release is out: the arrow links to the download page', (await p.locator('[data-desktop-update="download"]').getAttribute('href'))?.includes('github.com/ParleyDev/parley/releases'))
await advanced(p)
ok('Settings says it can\'t update itself and links the download', /0\.22\.0 is out/.test(await p.locator('[data-app-update-line]').innerText()) && await p.locator('[data-app-update-download]').count() === 1)
await p.context().close()
p = await open(null, '0.22.0')
await p.waitForTimeout(800)
ok('an old app that is already on the latest release is left alone', await p.locator('[data-desktop-update]').count() === 0)
await p.context().close()

console.log('-- Linux .deb install')
p = await open([{ state: 'unsupported' }])
await advanced(p)
ok('no channel picker where the app can\'t update itself', await p.locator('[data-update-channel]').count() === 0)
ok('a package install is pointed at its package manager or the download', /package manager/.test(await p.locator('[data-app-update-line]').innerText()) && await p.locator('[data-app-update-check]').count() === 0 && await p.locator('[data-app-update-download]').count() === 1)
await p.context().close()

console.log('-- browsers')
const w = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); w.on('pageerror', (e) => errors.push(e.message))
await w.goto(`${WEB}/login`); await w.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await w.goto(`${WEB}/channels/${g.id}/${ch.id}`); await w.waitForSelector('[data-message-list]')
await w.click('[data-user-panel] [data-control="User Settings"]'); await w.click('[data-settings-tab="advanced"]'); await w.waitForTimeout(400)
ok('the web app has no desktop update section', await w.locator('[data-app-updates]').count() === 0 && await w.locator('[data-desktop-update]').count() === 0)

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
