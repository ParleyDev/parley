// A studio project at work while you are elsewhere: the card above the user panel (name, playing or recording and
// where, stop and play, stopping the take, back to the project) and the mark on the project's sidebar row.
import { WEB, B, S, IP, reg, call, callS, ok, finish, launchBrowser, chromiumOnly } from '../lib.mjs'
import { wavFile, bursts } from '../audio.mjs'

await chromiumOnly('needs Web Audio and a microphone')

const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Now ${S}` })
const text = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((c) => c.kind === 'text')
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'jam', kind: 'studio' })).body
const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Night Drive', bpm: 120 })).body
const beat = await (await fetch(`${B}/channels/${P.channel_id}/studio/audio?name=bursts.wav&duration_ms=20000`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/wav', 'X-Forwarded-For': IP }, body: wavFile({ seconds: 20, signal: bursts([500, 5000, 10000, 15000]) }) })).json()
const L = crypto.randomUUID(), C = crypto.randomUUID()
await callS(a.token, 'POST', `/studio/projects/${P.id}/ops`, { ops: [{ op: 'lane.put', lane: { id: L, name: 'Backing', position: 0 } }, { op: 'clip.put', clip: { id: C, lane_id: L, audio_id: beat.id, start_ms: 0, length_ms: 20000 } }] })
const sessions = () => call(a.token, 'GET', `/channels/${P.channel_id}/studio/sessions`)

const browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] })
const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${P.channel_id}`)
await p.waitForSelector(`[data-daw-clip="${C}"] [data-daw-wave="1"]`, { timeout: 20000 })
const card = p.locator('[data-studio-now]')
const state = () => card.getAttribute('data-studio-now-state').catch(() => null)
const away = async () => { await p.click(`[data-channel-item="${text.id}"] a`); await p.waitForURL(`**/${text.id}`) }
const until = async (f, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end;) { if (await f()) return true; await p.waitForTimeout(200) } return false }

console.log('-- nothing to show')
ok('no card on the project\'s own page', await card.count() === 0)
await away()
ok('none elsewhere while it is stopped', await card.count() === 0)

console.log('-- playing, somewhere else')
await p.goto(`${WEB}/channels/${g.id}/${P.channel_id}`); await p.waitForSelector('[data-daw-play]')
await p.click('[data-daw-rtz]'); await p.click('[data-daw-play]')
await p.waitForFunction(() => window.__parleyDaw?.playing, null, { timeout: 10000 })
ok('still none on its page', await card.count() === 0)
await away()
ok('the card shows the project playing', await until(async () => await state() === 'playing') && (await card.locator('[data-studio-now-name]').textContent()) === 'Night Drive')
const t1 = await card.locator('[data-studio-now-time]').textContent()
await p.waitForTimeout(2200)
const t2 = await card.locator('[data-studio-now-time]').textContent()
ok('with the time going on', t1 !== t2, `${t1} → ${t2}`)
ok('the song really is still playing', await p.evaluate(() => !!window.__parleyDaw?.playing))
ok('its sidebar row shows it playing', await p.locator(`[data-sidebar-project="${P.channel_id}"] [data-studio-active="playing"]`).count() === 1)
await p.screenshot({ path: 'studionow-playing.png', clip: { x: 0, y: 300, width: 360, height: 600 } })

console.log('-- stop and play from the card')
await card.locator('[data-studio-now-stop]').click()
ok('stop stops it', await until(async () => !(await p.evaluate(() => window.__parleyDaw?.playing))))
ok('the card stays, stopped, with play and close', await until(async () => await state() === 'stopped') && await card.locator('[data-studio-now-play]').count() === 1 && await card.locator('[data-studio-now-close]').count() === 1)
ok('the sidebar mark goes', await p.locator('[data-studio-active]').count() === 0)
const stoppedAt = await card.locator('[data-studio-now-time]').textContent()
await card.locator('[data-studio-now-play]').click()
ok('play goes on', await until(async () => await state() === 'playing'))
await p.waitForTimeout(600)
const pos = await p.evaluate(() => window.__parleyDaw?.position ?? 0)
ok('from where it stopped', pos >= 1.5, `stopped at ${stoppedAt}, now ${pos}`)
await card.locator('[data-studio-now-stop]').click()
await until(async () => await state() === 'stopped')
await card.locator('[data-studio-now-close]').click()
ok('close hides it', await card.count() === 0)

console.log('-- back to the project')
await p.goto(`${WEB}/channels/${g.id}/${P.channel_id}`); await p.waitForSelector('[data-daw-play]')
await p.click('[data-daw-play]'); await p.waitForFunction(() => window.__parleyDaw?.playing, null, { timeout: 10000 })
await away(); await card.waitFor()
await card.locator('[data-studio-now-back]').click()
const back = await until(async () => p.url().endsWith(P.channel_id)) && await p.waitForSelector('[data-daw]', { timeout: 10000 }).then(() => true, () => false)
ok('clicking the name goes back to the project', back && await p.locator('[data-daw]').count() === 1, p.url())
ok('there the card goes away', await card.count() === 0)
ok('and it is still playing', await p.evaluate(() => !!window.__parleyDaw?.playing))
await p.click('[data-daw-play]')
await until(async () => !(await p.evaluate(() => window.__parleyDaw?.playing)))

console.log('-- recording, somewhere else')
await p.click('[data-daw-rtz]'); await p.click('[data-daw-record]')
const rec = await p.waitForFunction(() => window.__parleyStudio?.recording === true, null, { timeout: 15000 }).then(() => true, () => false)
ok('a take records', rec)
await away()
ok('the card shows it recording', await until(async () => await state() === 'recording'))
ok('the sidebar row shows a red dot', await p.locator(`[data-sidebar-project="${P.channel_id}"] [data-studio-active="recording"]`).count() === 1)
await p.waitForTimeout(1200); await p.screenshot({ path: 'studionow-recording.png', clip: { x: 0, y: 300, width: 360, height: 600 } })
await card.locator('[data-studio-now-stop-take]').click()
ok('stopping the take from the card ends it', await until(async () => (await sessions()).every((x) => x.ended_at), 15000))
ok('then the card says stopped', await until(async () => await state() === 'stopped' || await card.count() === 0))

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
