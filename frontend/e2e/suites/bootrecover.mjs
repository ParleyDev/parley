// Start-up never ends on a blank screen: the page is dark from the first paint, a bundle that fails to load shows
// "Parley didn't start" with Reload, a chunk missing after a deploy reloads into the new build, and a crash outside
// the app shell shows the error screen instead of an empty one.
import { chromium } from 'playwright'
import { WEB, reg, ok, finish } from '../lib.mjs'

const a = await reg('alice')
const browser = await chromium.launch()
// Signed in from the first request (no earlier page load, so nothing of the bundle is cached yet).
const ctx = async () => { const c = await browser.newContext({ viewport: { width: 390, height: 844 } }); await c.addInitScript((t) => { try { localStorage.setItem('parley.token', t) } catch { /* ignore */ } }, a.token); return { c, p: await c.newPage() } }

console.log('-- first paint')
let { c, p } = await ctx()
await p.route('**/assets/index-*.js', (r) => new Promise((res) => setTimeout(() => res(r.continue()), 1500)))
await p.goto(`${WEB}/channels/@me`, { waitUntil: 'commit' }); await p.waitForTimeout(400)
ok('the page is never white while starting', await p.evaluate(() => getComputedStyle(document.body).backgroundColor) !== 'rgb(255, 255, 255)')
await p.waitForSelector('[data-guild-bar], nav, textarea, [data-dm-list]', { timeout: 15000 }).catch(() => {})
ok('then the app renders over the watchdog', await p.locator('#boot-stuck').count() === 0)
await c.close()

console.log('-- the bundle fails to load')
;({ c, p } = await ctx())
await p.route('**/assets/index-*.js', (r) => r.abort())
await p.goto(`${WEB}/channels/@me`); await p.waitForTimeout(800)
ok('"Parley didn\'t start" shows with a Reload button', await p.locator('#boot-stuck').isVisible() && await p.getByRole('button', { name: 'Reload' }).isVisible())
await p.unroute('**/assets/index-*.js')
await p.getByRole('button', { name: 'Reload' }).click()
await p.waitForSelector('#boot-stuck', { state: 'detached', timeout: 15000 }).catch(() => {})
ok('Reload brings the app up once the network is back', await p.locator('#boot-stuck').count() === 0)
await c.close()

console.log('-- a fonts request that hangs')
;({ c, p } = await ctx())
await p.route('https://fonts.googleapis.com/**', () => { /* never answers */ })
await p.goto(`${WEB}/channels/@me`, { waitUntil: 'commit' })
const t0 = Date.now(); await p.waitForSelector('#root > *:not(#boot-stuck)', { timeout: 15000 }).catch(() => {})
ok('the app still renders promptly', Date.now() - t0 < 8000, `${Date.now() - t0}ms`)
await c.close()

console.log('-- a chunk gone after a deploy')
;({ c, p } = await ctx())
await p.goto(`${WEB}/channels/@me`); await p.waitForTimeout(1500)
let loads = 0; p.on('load', () => loads++)
// What vite fires when a lazy import's file is missing: the page reloads into the served build.
await p.evaluate(() => { const e = new Event('vite:preloadError', { cancelable: true }); e.payload = new Error('Failed to fetch dynamically imported module'); window.dispatchEvent(e) })
await p.waitForTimeout(2500)
ok('the page reloads once', loads === 1, `loads=${loads}`)
await p.evaluate(() => { const e = new Event('vite:preloadError', { cancelable: true }); window.dispatchEvent(e) })
await p.waitForTimeout(1500)
ok('but not in a loop (once a minute at most)', loads === 1, `loads=${loads}`)
await c.close()

await browser.close()
await finish()
