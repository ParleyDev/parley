// Studio console: the engineer's DAW — record-arm per band member, live meters, the take growing on the timeline,
// waveforms once it is in, mute / solo / seek on playback and the mixdown export.
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Console ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`); await call(c.token, 'POST', `/invites/${inv.code}`)
const st = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'console', kind: 'studio' })).body
await call(a.token, 'PUT', `/channels/${st.id}/studio/role/${a.user.id}`, { role: 'engineer' })

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const mk = async (tok) => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(`${WEB}/channels/${g.id}/${st.id}`); await p.waitForSelector('text=Join Voice'); await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]'); return p }
const pa = await mk(a.token); const pb = await mk(b.token); const pc = await mk(c.token)
for (const u of [b, c]) await call(a.token, 'PUT', `/channels/${st.id}/studio/role/${u.user.id}`, { role: 'artist' })

console.log('-- console')
await pa.waitForSelector('[data-studio-console]')
ok('the engineer gets the console in place of the stage, open by default', await pa.locator('[data-studio-console]').count() === 1 && await pb.locator('[data-studio-console]').count() === 0 && await pb.locator('[data-studio-console-toggle]').count() === 0)
await pa.waitForSelector(`[data-console-lane-head="${c.user.id}"]`)
ok('one lane per band member', await pa.locator('[data-console-lane-head]').count() === 3)
ok('everyone is armed to start', (await pa.locator('[data-console-armed]').textContent()) === '3 of 3 armed')
await pa.waitForFunction((id) => Number(document.querySelector(`[data-console-meter="${id}"]`)?.dataset.level ?? 0) > 0.05, b.user.id, { timeout: 15000 }).catch(() => {})
ok('live meters move with the artists\' mics', await pa.evaluate((id) => Number(document.querySelector(`[data-console-meter="${id}"]`)?.dataset.level ?? 0) > 0.05, b.user.id))
await pa.click(`[data-console-arm="${c.user.id}"]`)
ok('disarming carol', (await pa.getAttribute(`[data-console-arm="${c.user.id}"]`, 'aria-pressed')) === 'false' && (await pa.locator('[data-console-armed]').textContent()) === '2 of 3 armed')

let r = await raw(a.token, 'POST', `/channels/${st.id}/studio/sessions`, { name: 'x', armed: [] }); ok('a take needs at least one armed track', r.status === 400)

await pa.fill('[data-console-take-name]', 'Take one')
await pa.click('[data-console-record]')
await pa.waitForSelector('[data-console-live]')
ok('record starts the named take', (await pa.locator('[data-console-live]').textContent()) === 'Take one' && (await pa.getAttribute('[data-studio-console]', 'data-console-state')) === 'recording')
await pb.waitForFunction(() => window.__parleyStudio?.recording === true, null, { timeout: 10000 })
await pa.waitForTimeout(1500)
ok('armed members record, the disarmed one does not', await pa.evaluate(() => window.__parleyStudio?.recording === true) && await pc.evaluate(() => !window.__parleyStudio?.recording))
const live = (await call(a.token, 'GET', `/channels/${st.id}/studio/sessions`))[0]
ok('the session stores who is armed', Array.isArray(live.armed) && live.armed.length === 2 && !live.armed.includes(c.user.id))
r = await raw(c.token, 'POST', `/studio/sessions/${live.id}/tracks`, {}); ok('an unarmed artist cannot add a track', r.status === 400)
ok('arming is locked while recording', await pa.locator(`[data-console-arm="${b.user.id}"]`).isDisabled())
const t1 = await pa.locator('[data-console-time]').textContent(); await pa.waitForTimeout(1200); const t2 = await pa.locator('[data-console-time]').textContent()
ok('the timecode runs', t1 !== t2, `${t1} -> ${t2}`)
await pa.waitForFunction((id) => /Recording · [1-9]\d* KB/.test(document.querySelector(`[data-console-status="${id}"]`)?.textContent ?? ''), b.user.id, { timeout: 12000 })
ok('chunk uploads show up live in the lane', true)
const w1 = (await pa.locator(`[data-console-lane="${b.user.id}"] [data-region-live="1"]`).boundingBox()).width; await pa.waitForTimeout(1000); const w2 = (await pa.locator(`[data-console-lane="${b.user.id}"] [data-region-live="1"]`).boundingBox()).width
ok('the region grows while it records', w2 > w1, `${w1} -> ${w2}`)
ok('no region on the unarmed lane', await pa.locator(`[data-console-lane="${c.user.id}"] [data-console-region]`).count() === 0)
await pa.screenshot({ path: '217-console-recording.png' })
await pa.click('[data-console-record]')
await pa.waitForFunction(() => document.querySelector('[data-studio-console]')?.getAttribute('data-console-state') !== 'recording')

console.log('-- playback')
await pa.waitForSelector('[data-console-wave]', { timeout: 30000 })
await pa.waitForFunction(() => document.querySelectorAll('[data-console-wave]').length === 2, null, { timeout: 30000 })
ok('the finished take comes up with two waveforms', true)
ok('the take picker selects it', (await pa.locator('[data-console-take] option:checked').textContent()) === 'Take one')
await pa.click(`[data-console-mute="${b.user.id}"]`); ok('mute', (await pa.getAttribute(`[data-console-mute="${b.user.id}"]`, 'aria-pressed')) === 'true')
await pa.click(`[data-console-mute="${b.user.id}"]`)
await pa.click(`[data-console-solo="${a.user.id}"]`); ok('solo', (await pa.getAttribute(`[data-console-solo="${a.user.id}"]`, 'aria-pressed')) === 'true')
await pa.click(`[data-console-solo="${a.user.id}"]`)
const tl = await pa.locator('[data-console-timeline]').boundingBox()
await pa.mouse.click(tl.x + tl.width * 0.05, tl.y + 40)
ok('clicking the timeline moves the playhead', (await pa.locator('[data-console-time]').textContent()) !== '00:00.0')
await pa.click('[data-console-play]'); await pa.waitForTimeout(600)
ok('play', (await pa.getAttribute('[data-studio-console]', 'data-console-state')) === 'playing')
await pa.screenshot({ path: '218-console-playback.png' })
await pa.click('[data-console-play]')
await pa.click('[data-console-rtz]'); ok('return to zero', (await pa.locator('[data-console-time]').textContent()) === '00:00.0')
await pa.click('[data-console-export]')
await pa.waitForFunction(() => (window.__parleyMix?.exportedBytes ?? 0) > 44, null, { timeout: 30000 })
ok('export renders a WAV', true)

console.log('-- toggle')
await pa.click('[data-console-close]'); await pa.waitForFunction(() => !document.querySelector('[data-studio-console]'))
ok('closing returns to the band view', await pa.locator(`[data-voice-tile="${b.user.id}"]`).count() === 1)
await pa.reload(); await pa.waitForSelector('text=Join Voice'); await pa.click('text=Join Voice'); await pa.waitForSelector('[data-voice-leave]')
ok('and stays closed', await pa.locator('[data-studio-console]').count() === 0)
await pa.click('[data-studio-console-toggle]'); await pa.waitForSelector('[data-studio-console]')
ok('the header button opens it again', true)
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
