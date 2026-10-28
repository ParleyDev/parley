// Calls on a phone: tiles share the screen, the bar keeps mic, camera, More and hang up (the rest in a sheet of
// labelled tiles), a tapped tile opens across the whole screen with its own close / mute / hang up, and nothing that
// a phone can't do (screen share, device pickers) is offered. Desktop keeps its full bar.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, openDms, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
await openDms(a, b)
const g = await call(a.token, 'POST', '/guilds', { name: `Phone call ${S}` })
const vc = g.channels.find((c) => c.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const mk = async (u, phone) => {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['microphone', 'camera'] } : { viewport: { width: 1280, height: 800 }, permissions: ['microphone', 'camera'] })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  return p
}
const d = await mk(b, false), p = await mk(a, true)
await d.goto(`${WEB}/channels/${g.id}/${vc.id}`); await d.getByRole('button', { name: 'Join Voice' }).click(); await d.waitForSelector('[data-voice-controls]')

console.log('-- the bar')
await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.getByRole('button', { name: 'Join Voice' }).tap(); await p.waitForSelector('[data-voice-controls]'); await p.waitForTimeout(800)
const bar = await p.evaluate(() => [...document.querySelectorAll('[data-voice-controls] button')].filter((x) => x.offsetParent).map((x) => x.getAttribute('aria-label')))
ok('the phone bar keeps mic, camera, More and hang up', bar.length <= 4 && bar.includes('More') && bar.includes('Disconnect'), JSON.stringify(bar))
ok('no device pickers or screen share on a phone', await p.locator('[data-device-chevron]:visible').count() === 0 && !bar.includes('Share Your Screen'))
const tiles = await p.locator('[data-voice-grid-fill] [data-voice-tile]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
ok('two people share the height of the screen', tiles.length === 2 && tiles.every((h) => h > 250), JSON.stringify(tiles))

console.log('-- More sheet')
await p.locator('[data-phone-call-more]').tap(); await p.waitForSelector('[data-phone-call-more-sheet]'); await p.waitForTimeout(400)
const labels = await p.locator('[data-phone-call-more-sheet] button').allInnerTexts()
ok('the rest are labelled tiles in a sheet', labels.some((l) => /Send a Reaction/.test(l)) && labels.some((l) => /Activities/.test(l)), JSON.stringify(labels))
const sheet = await p.locator('[data-phone-call-more-sheet]').boundingBox()
ok('docked along the bottom', sheet && Math.abs(sheet.y + sheet.height - 844) <= 2 && sheet.width >= 388, JSON.stringify(sheet))
await p.locator('[data-phone-call-more-backdrop]').tap({ position: { x: 20, y: 20 } }); await p.waitForTimeout(200)
ok('tapping outside closes it', await p.locator('[data-phone-call-more-sheet]').count() === 0)

console.log('-- full screen')
await p.locator('[data-voice-tile]').first().tap(); await p.waitForSelector('[data-phone-stage]'); await p.waitForTimeout(300)
const st = await p.locator('[data-phone-stage]').boundingBox()
ok('a tapped tile opens across the whole screen', st && st.width >= 388 && st.height >= 842, JSON.stringify(st))
ok('with close, mute and hang up', await p.locator('[data-phone-stage-close]').isVisible() && await p.locator('[data-phone-stage-mute]').isVisible() && await p.locator('[data-phone-stage-leave]').isVisible())
await p.locator('[data-phone-stage-mute]').tap(); await p.waitForTimeout(300)
ok('mute works from there', await p.locator('[data-phone-stage-mute]').getAttribute('aria-pressed') === 'true')
await p.locator('[data-phone-stage]').tap({ position: { x: 195, y: 420 } }); await p.waitForTimeout(400)
ok('a tap hides the controls', await p.locator('[data-phone-stage-close]').evaluate((e) => getComputedStyle(e.parentElement).opacity === '0'))
await p.locator('[data-phone-stage]').tap({ position: { x: 195, y: 420 } }); await p.waitForTimeout(300)
await p.locator('[data-phone-stage-close]').tap(); await p.waitForTimeout(300)
ok('close returns to the call', await p.locator('[data-phone-stage]').count() === 0 && await p.locator('[data-voice-controls]').isVisible())

console.log('-- back from the background')
const before = await p.evaluate(() => window.__parleyMic.info())
await p.evaluate(() => window.__parleyMic.end())
ok('(the OS ended the mic while the app was away)', (await p.evaluate(() => window.__parleyMic.info())).state === 'ended')
await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
await p.waitForTimeout(1500)
const after = await p.evaluate(() => window.__parleyMic.info())
ok('coming back reopens the mic, still in the call', after.state === 'live' && after.id !== before.id && await p.locator('[data-voice-controls]').isVisible(), JSON.stringify({ before, after }))

console.log('-- desktop')
ok('desktop keeps device pickers and its full bar', await d.locator('[data-device-chevron]:visible').count() >= 1 && await d.locator('[data-phone-call-more]').count() === 0)
await d.locator('[data-voice-tile]').first().click(); await d.waitForTimeout(300)
ok('and a click focuses a tile there, no phone full-screen view', await d.locator('[data-phone-stage]').count() === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
