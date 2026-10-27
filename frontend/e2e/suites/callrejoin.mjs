// Leaving a DM call that's still going doesn't ring you back: the DM offers Join Call instead. Once the call ends,
// a new one rings again.
import { chromium } from 'playwright'
import { WEB, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
await call(a.token, 'POST', '/users/@me/relationships', { user_id: b.user.id }); await call(b.token, 'PUT', `/users/@me/relationships/${a.user.id}`)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const mk = async (t) => { const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t); await p.goto(`${WEB}/channels/@me/${dm.id}`); return p }
const pa = await mk(a.token), pb = await mk(b.token)
const ringing = (p) => p.evaluate(() => window.__parleyRing === true || !!document.querySelector('[data-incoming-call]'))

console.log('-- leave and rejoin')
await pa.waitForSelector('[data-start-call]'); await pa.click('[data-start-call]')
await pb.waitForSelector('[data-incoming-call]'); await pb.click('[data-call-join]')
await pb.waitForSelector('[data-voice-connected]')
await pb.click('[data-voice-connected] [data-voice-disconnect]'); await pb.waitForTimeout(1500)
ok('leaving a call that\'s still going doesn\'t ring', !(await ringing(pb)))
ok('the DM offers to join again', await pb.locator('[data-join-call]').count() === 1)
await pb.click('[data-join-call]'); await pb.waitForSelector('[data-voice-connected]')
ok('rejoining works', true)

console.log('-- a new call rings again')
await pb.click('[data-voice-connected] [data-voice-disconnect]'); await pa.click('[data-voice-connected] [data-voice-disconnect]'); await pb.waitForTimeout(1200)
await pa.click('[data-start-call]')
await pb.waitForSelector('[data-incoming-call]', { timeout: 6000 }).catch(() => {})
ok('after the call ended, the next one rings', await ringing(pb))
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
