// A file marked as a spoiler while it is still uploading (a video takes a while): it is uploaded again under its
// spoiler name, and the upload that was stopped must not mark the new one "Upload cancelled". In a DM, as reported.
import { WEB, reg, call, ok, finish, launchBrowser, openDms } from '../lib.mjs'

const a = await reg('alice'), b = await reg('bob')
await openDms(a, b)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
ok('the DM is open', !!dm?.id, JSON.stringify(dm).slice(0, 200))

const browser = await launchBrowser(); const errors = []
const p = await browser.newPage({ viewport: { width: 1280, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector('[data-file-input]', { state: 'attached', timeout: 15000 })
// Slow the upload down, as a phone's would be, so the file is still uploading when it is marked.
const cdp = await p.context().newCDPSession(p).catch(() => null)
if (cdp) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 4 * 1024 * 1024, uploadThroughput: 1024 * 1024 })
const video = Buffer.alloc(6 * 1024 * 1024, 7)
await p.setInputFiles('[data-file-input]', { name: '1cbcecea-6f83-41db-b2a1-0c1d2e3f4a5b.mp4', mimeType: 'video/mp4', buffer: video })
await p.waitForSelector('[data-pending]')
await p.waitForTimeout(400)
const before = await p.locator('[data-pending]').textContent()
ok('the video is uploading', /Uploading/.test(before), before)
await p.click('[data-spoiler-toggle]')
await p.waitForTimeout(300)
const right = await p.locator('[data-pending]').textContent()
ok('marked as a spoiler while it uploads, it is not "Upload cancelled"', !/cancelled/i.test(right) && /Uploading/.test(right), right)
await p.waitForFunction(() => !/Uploading/.test(document.querySelector('[data-pending]')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => {})
const end = await p.locator('[data-pending]').textContent()
ok('it finishes uploading, with no error', !/cancelled|failed/i.test(end) && !/Uploading/.test(end), end)
if (cdp) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
await p.locator('textarea[placeholder^="Message"]').press('Enter'); await p.waitForTimeout(1200)
const msgs = await call(a.token, 'GET', `/channels/${dm.id}/messages`)
const att = msgs?.[0]?.attachments?.[0]
ok('it is sent, as a spoiler, once', msgs.length === 1 && msgs[0].attachments.length === 1 && /^SPOILER_/.test(att?.filename ?? att?.name ?? ''), String(JSON.stringify(att ?? msgs)).slice(0, 300))

// Marked and unmarked quickly, twice over: the last state is what is sent, and nothing is left cancelled.
if (cdp) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 4 * 1024 * 1024, uploadThroughput: 1024 * 1024 })
await p.setInputFiles('[data-file-input]', { name: 'clip.mp4', mimeType: 'video/mp4', buffer: video })
await p.waitForSelector('[data-pending]'); await p.waitForTimeout(300)
for (let i = 0; i < 3; i++) { await p.click('[data-spoiler-toggle]'); await p.waitForTimeout(150) }
await p.waitForFunction(() => !/Uploading/.test(document.querySelector('[data-pending]')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => {})
const end2 = await p.locator('[data-pending]').first().textContent()
ok('toggled three times while uploading, it ends uploaded as a spoiler with no error', !/cancelled|failed/i.test(end2) && await p.locator('[data-spoiler-toggle]').getAttribute('title') === 'Unmark as spoiler', end2)

// Cut off on the way (as Cloudflare does to a request over 100 MB): said so, not "Upload cancelled".
if (cdp) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
const cut = await browser.newPage({ viewport: { width: 1280, height: 900 } }); cut.on('pageerror', (e) => errors.push(e.message))
await cut.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await cut.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await cut.goto(`${WEB}/channels/@me/${dm.id}`); await cut.waitForSelector('[data-file-input]', { state: 'attached', timeout: 15000 })
await cut.route('**/attachments', (r) => r.request().method() === 'POST' ? r.abort('aborted') : r.continue())
await cut.setInputFiles('[data-file-input]', { name: 'long.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(1024 * 1024, 3) })
await cut.waitForFunction(() => !/Uploading/.test(document.querySelector('[data-pending]')?.textContent ?? 'Uploading'), null, { timeout: 15000 }).catch(() => {})
const said = await cut.locator('[data-pending]').textContent()
ok('an upload the network cuts off says so, and is not "Upload cancelled"', /cut off before it finished/.test(said) && !/Upload cancelled/.test(said), said)
await cut.close()

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
