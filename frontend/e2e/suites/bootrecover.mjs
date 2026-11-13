// Start-up never ends on a blank screen: the page is dark from the first paint, a bundle that fails to load reloads
// once and then shows "Parley didn't start" with Reload, a stylesheet that fails reloads instead of leaving the app
// unstyled, a chunk missing after a deploy reloads into the new build, and the offline shell keeps its own files.
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
let boots = 0; p.on('request', (r) => { if (r.isNavigationRequest() && r.frame() === p.mainFrame()) boots++ })
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('#boot-stuck', { state: 'visible', timeout: 5000 }).catch(() => {})
ok('it reloads once by itself first', boots === 2, `loads=${boots}`)
ok('"Parley didn\'t start" shows with a Reload button', await p.locator('#boot-stuck').isVisible() && await p.getByRole('button', { name: 'Reload' }).isVisible())
await p.unroute('**/assets/index-*.js')
await p.getByRole('button', { name: 'Reload' }).click()
await p.waitForSelector('#boot-stuck', { state: 'detached', timeout: 15000 }).catch(() => {})
ok('Reload brings the app up once the network is back', await p.locator('#boot-stuck').count() === 0)
await c.close()

console.log('-- the stylesheet fails to load (a page from before a deploy)')
;({ c, p } = await ctx())
const styled = () => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--msg-gap').trim() === '17px')
let cssTries = 0
await p.route('**/assets/index-*.css', (r) => (++cssTries === 1 ? r.fulfill({ status: 404, body: 'gone' }) : r.continue()))
boots = 0; p.on('request', (r) => { if (r.isNavigationRequest() && r.frame() === p.mainFrame()) boots++ })
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('#root > *:not(#boot-stuck)', { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(500)
ok('the page reloads into the served build', boots === 2, `loads=${boots}`)
ok('and the app is styled', await styled())
await c.close()

console.log('-- offline shell keeps its own files')
;({ c, p } = await ctx())
await p.goto(`${WEB}/channels/@me`)
await p.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => {})
await p.reload(); await p.waitForTimeout(1500)
const shellFiles = await p.evaluate(async () => { const r = await caches.match('/', { cacheName: 'parley-shell-v1' }); return r ? Array.from(new Set((await r.text()).match(/\/assets\/[^"'\s>]+/g) || [])) : [] })
const cached = () => p.evaluate(async (fs) => { const c = await caches.open('parley-assets-v1'); return (await Promise.all(fs.map((f) => c.match(f, { ignoreVary: true })))).every(Boolean) }, shellFiles)
ok('the cached shell lists its stylesheet', shellFiles.some((f) => f.endsWith('.css')), shellFiles.join(' '))
ok('its files are in the asset cache', await cached())
// Lots of newer files (other builds' chunks), then one more fetch through the worker: the cache is trimmed.
await p.evaluate(async () => { const c = await caches.open('parley-assets-v1'); for (let i = 0; i < 450; i++) await c.put(`/assets/old-${i}.js`, new Response('x')) })
await p.evaluate(async () => { const n = performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname).filter((x) => x.startsWith('/assets/')); const c = await caches.open('parley-assets-v1'); await c.delete(n[n.length - 1]); await fetch(n[n.length - 1]) })
await p.waitForTimeout(1500)
const left = await p.evaluate(async () => (await (await caches.open('parley-assets-v1')).keys()).length)
ok('the cache was trimmed', left <= 400, `entries=${left}`)
ok('but not of the shell\'s own files', await cached())
// A phone waking with no network: the worker serves the cached shell, and it starts styled.
await c.setOffline(true)
await p.reload().catch(() => {}); await p.waitForTimeout(2000)
ok('offline, the shell starts styled', await styled())
await c.setOffline(false)
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
