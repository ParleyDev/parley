// Saving and sharing on iPhones and iPads (Safari and the home-screen app, which ignores downloads): Download and
// Save Image open the share sheet with the file itself (Save Image, Save to Files), straight from the tap, since
// Safari refuses a share sheet that waited on the network; a file not yet in hand offers "Save" once it arrives.
import { webkit } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WEB, S, FIX, reg, call, callS, multi, ok, finish } from '../lib.mjs'

const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `iOS save ${S}` })
const ch = g.channels.find((x) => x.kind === 'text')
const post = async (file) => { const att = await (await multi(a.token, `/channels/${ch.id}/attachments`, file)).json(); await callS(a.token, 'POST', `/channels/${ch.id}/messages`, { content: '', attachment_ids: [att.id] }); return att }
const img = await post({ buffer: readFileSync(join(FIX, 'pic.png')), mimeType: 'image/png', name: 'sunset.png' })
const doc = await post({ buffer: Buffer.from('PK\x05\x06' + '\0'.repeat(18), 'binary'), mimeType: 'application/zip', name: 'notes.zip' })
const txt = await post({ buffer: Buffer.from('hello notes\n'), mimeType: 'text/plain', name: 'notes.txt' })
const clip = await post({ buffer: readFileSync(join(FIX, 'clip.webm')), mimeType: 'video/webm', name: 'clip.webm' })

const browser = await webkit.launch()
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
})
await ctx.addInitScript((tok) => {
  try { localStorage.setItem('parley.token', tok) } catch { /* ignore */ }
  // The share sheet, as Safari has it: only from a tap (a call after waiting on the network is refused).
  window.__shares = []
  let tapAt = 0
  addEventListener('pointerup', () => { tapAt = performance.now() }, true)
  addEventListener('click', () => { tapAt = performance.now() }, true)
  navigator.canShare = (d) => !!d && (!d.files || d.files.every((f) => f instanceof File))
  navigator.share = (d) => {
    const fresh = performance.now() - tapAt < 50
    window.__shares.push({ files: (d.files ?? []).map((f) => f.name), url: d.url ?? null, fresh })
    return fresh ? Promise.resolve() : Promise.reject(new DOMException('not allowed', 'NotAllowedError'))
  }
}, a.token)
const p = await ctx.newPage()
const errors = []; p.on('pageerror', (e) => errors.push(e.message))
const shares = () => p.evaluate(() => window.__shares)
const reset = () => p.evaluate(() => { window.__shares = [] })
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`)
await p.waitForSelector('[data-attachment-card]', { timeout: 20000 })
await p.waitForTimeout(800)

console.log('-- the image viewer\'s Download')
await p.locator(`img[src*="${img.id}"], img[src*="sunset"]`).first().click()
await p.waitForSelector('[data-lightbox]'); await p.waitForTimeout(800)
await p.click('[data-lightbox-download]'); await p.waitForTimeout(400)
let sh = await shares()
ok('opens the share sheet with the picture itself', sh.length === 1 && sh[0].files[0] === 'sunset.png', JSON.stringify(sh))
ok('straight from the tap', sh[0]?.fresh === true)
await p.keyboard.press('Escape').catch(() => {}); await p.locator('[data-lightbox] button[title="Close"]').click().catch(() => {})
await p.waitForSelector('[data-lightbox]', { state: 'detached' }).catch(() => {})

console.log('-- a file card (not fetched ahead)')
await reset()
await p.locator('[data-attachment-card]', { hasText: 'notes.zip' }).click()
await p.waitForSelector('[data-toast-action]', { timeout: 8000 }).catch(() => {})
ok('nothing is shared late, without a tap', (await shares()).length === 0)
ok('"Save" is offered once the file has arrived', await p.locator('[data-toast]', { hasText: 'notes.zip' }).locator('[data-toast-action]').isVisible())
await p.locator('[data-toast]', { hasText: 'notes.zip' }).locator('[data-toast-action]').click(); await p.waitForTimeout(300)
sh = await shares()
ok('and Save shares the file from that tap', sh.length === 1 && sh[0].files[0] === 'notes.zip' && sh[0].fresh, JSON.stringify(sh))
ok('the page did not navigate to the file', new URL(p.url()).pathname === `/channels/${g.id}/${ch.id}`)

console.log('-- a video\'s menu: Share… and Save to Device')
await reset()
const vbtn = p.locator("[data-video-download]").first()
if (await vbtn.count()) {
  await vbtn.click(); await p.waitForTimeout(800)
  await p.locator('[data-menu-item="Share…"]').click(); await p.waitForTimeout(300)
  sh = await shares()
  ok('Share… sends the video file, from the tap', sh.length === 1 && sh[0].files[0] === 'clip.webm' && sh[0].fresh, JSON.stringify(sh))
  await reset()
  await vbtn.click(); await p.waitForTimeout(300)
  await p.locator('[data-menu-item="Save to Device"]').click(); await p.waitForTimeout(300)
  sh = await shares()
  ok('Save to Device opens the share sheet with it too', sh.length === 1 && sh[0].files[0] === 'clip.webm' && sh[0].fresh, JSON.stringify(sh))
} else ok('the video has a download button', false)

console.log('-- a text file preview\'s download link')
await reset()
await p.locator('[data-file-preview-download]').first().click()
await p.waitForSelector('[data-toast-action]', { timeout: 8000 }).catch(() => {})
await p.locator('[data-toast]', { hasText: 'notes.txt' }).locator('[data-toast-action]').click().catch(() => {}); await p.waitForTimeout(300)
sh = await shares()
ok('saves through the share sheet too', sh.length === 1 && sh[0].files[0] === 'notes.txt' && sh[0].fresh, JSON.stringify(sh))

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
