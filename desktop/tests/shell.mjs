// Drives a debug build of the desktop shell (Linux, under Xvfb and a private D-Bus session) against a local page:
// the page calls the shell's commands through the remote capability, a second launch hands over a parley:// link,
// startup and tray settings land on disk, a running OBS is seen, and push to talk is heard while the window is in the background (keys pressed
// through XTest with a tiny helper: XKEY=/path/to/xkey, built from tests/xkey.c). Build first: (cd src-tauri && cargo build)
//   dbus-run-session -- xvfb-run -a node tests/shell.mjs
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const bin = join(here, '../src-tauri/target/debug/parley-desktop')
const home = mkdtempSync(join(tmpdir(), 'parley-desktop-'))
let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok  ', n) } else { fail++; console.log('  FAIL', n, x) } }

const results = {}; const hits = []
const page = (step) => `<!doctype html><meta charset=utf-8><title>shell test</title><script>
(async () => {
  const inv = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke
  const out = { ipc: !!inv }
  const t = async (k, f) => { try { out[k] = (await f()) ?? 'ok' } catch (e) { out[k] = 'error: ' + e } }
  if (inv && ${step} === 1) {
    await t('settings', () => inv('desktop_settings'))
    await t('badge', () => inv('set_badge', { count: 3 }))
    await t('flash', () => inv('flash'))
    await t('zoom', () => inv('set_zoom', { factor: 1.25 }))
    await t('badZoom', () => inv('set_zoom', { factor: 'big' }))
    await t('after', () => inv('set_desktop_settings', { autostart: true, startMinimized: true, hardwareAcceleration: false }))
    await t('opener', () => inv('plugin:opener|open_url', { url: 'https://example.com' }))
    await t('notify', () => inv('plugin:notification|notify', { options: { title: 'x' } }))
    window.__parleyPtt = (down) => fetch('/ptt/' + down, { method: 'POST', body: '{}' })
    await t('pttBad', () => inv('set_ptt_key', { code: 'MediaPlay' }))
    await t('ptt', () => inv('set_ptt_key', { code: 'Backquote' }))
    await t('tray', () => inv('set_desktop_settings', { closeToTray: false, minimizeToTray: true }))
    setInterval(() => inv('streaming_apps').then((v) => fetch('/obs/' + v, { method: 'POST', body: '{}' })), 400)
    await t('obs', () => inv('streaming_apps'))
  }
  if (inv && ${step} === 2) await t('off', () => inv('set_desktop_settings', { autostart: false }))
  await fetch('/result/${step}', { method: 'POST', body: JSON.stringify(out) })
})()
</script>`
const ptt = [], obs = []
const srv = createServer((req, res) => {
  hits.push(req.url)
  if (req.url.startsWith('/ptt/')) { ptt.push(req.url.slice(5)); res.end(); return }
  if (req.url.startsWith('/obs/')) { obs.push(req.url.slice(5)); res.end(); return }
  if (req.method === 'POST') { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { results[req.url.split('/').pop()] = JSON.parse(b); res.end() }); return }
  res.setHeader('Content-Type', 'text/html')
  res.end(page(req.url.startsWith('/invite/') ? 2 : 1))
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${srv.address().port}`
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), PARLEY_DESKTOP_URL: `${origin}/start`, WEBKIT_DISABLE_COMPOSITING_MODE: '1' }
const wait = async (f, ms = 20000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 200)); return f() }

console.log('-- commands from the server page')
const app = spawn(bin, [], { env, stdio: 'inherit' })
ok('the page loads in the shell', await wait(() => results['1']))
const r = results['1'] ?? {}
ok('it can reach the shell', r.ipc === true, JSON.stringify(r))
ok('desktop_settings', r.settings?.version && r.settings.autostart === false && r.settings.start_minimized === false && r.settings.hardware_acceleration === true, JSON.stringify(r.settings))
ok('badge, flash and zoom', r.badge === 'ok' && r.flash === 'ok' && r.zoom === 'ok', JSON.stringify(r))
ok('a bad zoom is refused', String(r.badZoom).startsWith('error'))
ok('startup settings change', r.after?.autostart === true && r.after?.start_minimized === true && r.after?.hardware_acceleration === false, JSON.stringify(r.after))
const prefsFile = join(home, '.config/us.vic10.parley.desktop/desktop.json')
ok('and are kept for the next launch', existsSync(prefsFile) && JSON.parse(readFileSync(prefsFile, 'utf8')).hardware_acceleration === false)
const autostartFile = join(home, '.config/autostart/Parley.desktop')
ok('an autostart entry is written, launching minimised', existsSync(autostartFile) && /--autostart/.test(readFileSync(autostartFile, 'utf8')))
ok('plugin APIs stay out of reach of the server page', String(r.opener).startsWith('error') && String(r.notify).startsWith('error'), JSON.stringify({ opener: r.opener, notify: r.notify }))

console.log('-- tray and streaming apps')
ok('a tray icon is up, closing to it by default', r.settings?.tray === true && r.settings?.close_to_tray === true && r.settings?.minimize_to_tray === false, JSON.stringify(r.settings))
ok('close / minimise to tray can change', r.tray?.close_to_tray === false && r.tray?.minimize_to_tray === true, JSON.stringify(r.tray))
ok('no streaming app is running', r.obs === false)
const fake = join(home, 'obs'); copyFileSync('/bin/sleep', fake); const obsProc = spawn(fake, ['60'])
const seen = obs.length
ok('OBS running is seen', await wait(() => obs.slice(seen).includes('true'), 5000), obs.slice(-3).join())
obsProc.kill()
const gone = obs.length
ok('and its quitting too', await wait(() => obs.slice(gone + 1).includes('false'), 5000))

console.log('-- push to talk in the background')
ok('the shell watches a known key, and refuses one it cannot', r.ptt === true && r.pttBad === false, JSON.stringify({ ptt: r.ptt, pttBad: r.pttBad }))
const xkey = process.env.XKEY
if (xkey) {
  const key = (down) => spawn(xkey, ['grave', down ? '1' : '0'], { stdio: 'inherit' })
  key(true); await new Promise((r) => setTimeout(r, 400)); key(false)
  ok('in the foreground the page hears the key itself', ptt.length === 0, JSON.stringify(ptt))
  spawn(xkey, ['blur'], { stdio: 'inherit' }); await new Promise((r) => setTimeout(r, 500))
  key(true); ok('holding the key tells the page', await wait(() => ptt.includes('true'), 3000), JSON.stringify(ptt))
  key(false); ok('letting go too', await wait(() => ptt.includes('false'), 3000), JSON.stringify(ptt))
  key(true); await new Promise((r) => setTimeout(r, 300)); key(false); await new Promise((r) => setTimeout(r, 300))
  ok('every press, once each', ptt.join() === 'true,false,true,false', JSON.stringify(ptt))
} else console.log('  skip  keys (set XKEY)')

console.log('-- parley:// links')
const second = spawn(bin, ['parley://invite/abc123'], { env, stdio: 'inherit' })
ok('a second launch hands its link to the running app', await wait(() => hits.includes('/invite/abc123')), JSON.stringify(hits))
await wait(() => second.exitCode !== null, 5000)
ok('and exits', second.exitCode !== null)
ok('turning it off removes the entry', await wait(() => results['2']) && results['2'].off?.autostart === false && !existsSync(autostartFile), JSON.stringify(results['2']))
const bogus = spawn(bin, ['parley://settings/../../etc'], { env, stdio: 'inherit' })
await wait(() => bogus.exitCode !== null, 5000); await new Promise((r) => setTimeout(r, 1000))
ok('other parley:// paths are ignored', !hits.some((h) => h.includes('settings') || h.includes('etc')))

app.kill(); srv.close(); rmSync(home, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
