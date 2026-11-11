// Downloads in the desktop app (bridge faked): Download asks where with the system Save dialog first (cancel stops
// it), and when a download finishes the shell's `parley-download` event shows "Downloaded <name>" with Show in folder
// (or an error), instead of the file landing somewhere without a word. Browsers keep their own download UI.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WEB, S, FIX, reg, call, callS, multi, ok, finish } from '../lib.mjs'

const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Dl ${S}` }); const ch = g.channels.find((x) => x.kind === 'text')
const post = async (file) => { const att = await (await multi(a.token, `/channels/${ch.id}/attachments`, file)).json(); await callS(a.token, 'POST', `/channels/${ch.id}/messages`, { content: '', attachment_ids: [att.id] }); return att }
const clip = await post({ buffer: readFileSync(join(FIX, 'clip.webm')), mimeType: 'video/webm', name: 'clip.webm' })
const doc = await post({ buffer: Buffer.from('%NOTPDF just bytes'), mimeType: 'application/octet-stream', name: 'notes.bin' })
const browser = await chromium.launch(); const errors = []

/** `answer`: what the fake Save dialog returns (a path, or null = cancelled). */
const open = async (answer) => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) ParleyDesktop/0.24.0' })
  await c.addInitScript((answer) => {
    window.__calls = []
    window.__TAURI_INTERNALS__ = { invoke: async (cmd, args) => {
      window.__calls.push({ cmd, args })
      if (cmd === 'choose_download') return answer
      if (cmd === 'desktop_settings') return { autostart: false, start_minimized: false, hardware_acceleration: true, version: '0.24.0', frame: 'custom' }
      if (cmd === 'update_status') return { state: 'none', downloaded: 0, current: '0.24.0' }
      return null
    } }
  }, answer)
  const p = await c.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
  await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector(`[data-inline-video="${clip.id}"]`); await p.waitForTimeout(500)
  return p
}
const calls = (p, cmd) => p.evaluate((cmd) => window.__calls.filter((c) => c.cmd === cmd), cmd)
const dlClick = async (p, sel) => Promise.all([p.waitForEvent('download', { timeout: 3000 }).catch(() => null), p.locator(sel).click()]).then(([d]) => d)

console.log('-- Save dialog, then the download')
let p = await open('/home/alice/Videos/clip.webm')
await p.locator(`[data-inline-video="${clip.id}"]`).hover()
let d = await dlClick(p, `[data-inline-video="${clip.id}"] [data-video-download]`)
let asked = await calls(p, 'choose_download')
ok('the video\'s Download asks where to save it, named after the file', asked.length === 1 && asked[0].args.name === 'clip.webm' && /\/attachments\/.*download=1/.test(asked[0].args.url), JSON.stringify(asked))
ok('then downloads it', d?.suggestedFilename() === 'clip.webm', d?.suggestedFilename())
d = await dlClick(p, `[data-attachment-card]`)
asked = await calls(p, 'choose_download')
ok('a file card asks too', asked.length === 2 && asked[1].args.name === 'notes.bin' && d?.suggestedFilename() === 'notes.bin', JSON.stringify(asked[1]))

console.log('-- finished')
await p.evaluate(() => window.dispatchEvent(new CustomEvent('parley-download', { detail: { url: 'http://x/attachments/1/clip.webm?download=1', path: '/home/alice/Videos/clip.webm', ok: true } })))
await p.waitForSelector('[data-toast]')
ok('a finished download says so', /Downloaded clip\.webm/.test(await p.locator('[data-toast]').last().innerText()))
await p.screenshot({ path: 'desktop-download-toast.png', clip: { x: 780, y: 700, width: 500, height: 160 } })
await p.locator('[data-toast-action]').click()
const rev = await calls(p, 'reveal_download')
ok('Show in folder asks the shell to show that file', rev.length === 1 && rev[0].args.path === '/home/alice/Videos/clip.webm', JSON.stringify(rev))
await p.evaluate(() => window.dispatchEvent(new CustomEvent('parley-download', { detail: { url: 'http://x/attachments/1/big.zip?download=1', path: null, ok: false } })))
await p.waitForTimeout(200)
ok('a failed one says it failed', /Couldn’t download big\.zip/.test(await p.locator('[data-toast]').last().innerText()))
await p.context().close()

console.log('-- cancelled')
p = await open(null)
await p.locator(`[data-inline-video="${clip.id}"]`).hover()
d = await dlClick(p, `[data-inline-video="${clip.id}"] [data-video-download]`)
ok('cancelling the Save dialog downloads nothing', d === null && (await calls(p, 'choose_download')).length === 1)
await p.context().close()

console.log('-- browsers')
const w = await (await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true })).newPage(); w.on('pageerror', (e) => errors.push(e.message))
await w.goto(`${WEB}/login`); await w.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await w.goto(`${WEB}/channels/${g.id}/${ch.id}`); await w.waitForSelector(`[data-inline-video="${clip.id}"]`)
d = await dlClick(w, '[data-attachment-card]')
ok('a browser downloads straight away (its own downloads bar)', d?.suggestedFilename() === 'notes.bin')

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
