// How well a take lines up with what it was played over, measured. The project plays tone bursts at known times; the
// test's microphone (see `syntheticMic`) is fed what the DAW plays, as if a player hit every burst exactly; the take is
// recorded the way the band records, and where the bursts landed on the timeline is compared with where they are in
// the backing. This suite measures and reports (the figures go in the baseline); it asserts only that takes land and
// can be measured, not a tolerance.
//
// What the figures include: the loop from the DAW's output to the microphone here is a stream between two audio
// contexts, with no speakers, air or audio interface in it, so the latency the app compensates for (reported by the
// browser for real hardware) is not there to be compensated. The spread between takes is the dependable figure; the
// mean carries that difference.
import { writeFileSync } from 'node:fs'
import { WEB, B, S, IP, BROWSER, reg, call, callS, ok, finish, launchBrowser, chromiumOnly } from '../lib.mjs'
import { wavFile, bursts, pullAudio, onsets, syntheticMic } from '../audio.mjs'

await chromiumOnly('needs a voice room and a microphone')

const TAKES = Number(process.env.STUDIO_TAKES ?? 5)
const AT = [1000, 1500, 2000, 2500, 3000, 3500, 4000]
const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Record ${S}` })
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'record', kind: 'studio' })).body
const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Record', bpm: 120 })).body
const st = await call(a.token, 'GET', `/channels/${P.channel_id}`)
const full = () => call(a.token, 'GET', `/studio/projects/${P.id}`)
const backing = await (await fetch(`${B}/channels/${st.id}/studio/audio?name=bursts.wav&duration_ms=5000`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/wav', 'X-Forwarded-For': IP }, body: wavFile({ seconds: 5, signal: bursts(AT) }) })).json()
const LB = crypto.randomUUID(), CB = crypto.randomUUID()
// Hard left: a mono signal there is at its own level.
let r = await callS(a.token, 'POST', `/studio/projects/${P.id}/ops`, { ops: [{ op: 'lane.put', lane: { id: LB, name: 'Backing', position: 0, pan: -1 } }, { op: 'clip.put', clip: { id: CB, lane_id: LB, audio_id: backing.id, start_ms: 0, length_ms: 5000 } }] })
ok('a project with a backing of tone bursts', r.status === 200, JSON.stringify(r.body))

const browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] })
await ctx.addInitScript(syntheticMic)
const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${WEB}/login`); await page.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await page.goto(`${WEB}/channels/${g.id}/${st.id}`)
const join = page.locator('[data-project-join]').or(page.getByText('Join Voice', { exact: true })).first(); await join.waitFor(); await join.click()
await page.waitForSelector('[data-voice-leave]'); await page.waitForSelector(`[data-daw-clip="${CB}"] [data-daw-wave="1"]`, { timeout: 20000 })
ok('the microphone the room opened is the test\'s', await page.evaluate(() => window.__parleyTestMic.asked.some((c) => c && c.audio)))
// What the DAW plays goes into the microphone.
const rates = await page.evaluate(() => { window.__parleyTestMic.feed(window.__parleyDawTest.tap()); const c = window.__parleyDawTest.context(); return { daw: c.sampleRate, mic: window.__parleyTestMic.context().sampleRate, base: c.baseLatency, output: c.outputLatency ?? null } })

const takes = []
const seen = new Set([backing.id])
for (let n = 0; n < TAKES; n++) {
  await page.click('[data-daw-rtz]')
  await page.click('[data-daw-record]')
  const started = await page.waitForFunction(() => window.__parleyStudio?.recording === true && window.__parleyDaw?.playing === 'backing', null, { timeout: 15000 }).then(() => true, () => false)
  await page.waitForTimeout(5600)
  await page.click('[data-daw-record]')
  let f = null, clip = null
  for (let i = 0; i < 40 && !clip; i++) { f = await full(); clip = f.clips.find((c) => c.audio_id && !seen.has(c.audio_id) && !c.muted); if (!clip) await page.waitForTimeout(500) }
  if (!started || !clip) { takes.push(null); continue }
  seen.add(clip.audio_id)
  const audio = f.audio.find((x) => x.id === clip.audio_id)
  const pcm = await pullAudio(page, `/api/studio/tracks/${audio.id}`, a.token)
  if (!pcm) { takes.push(null); continue }
  const x = pcm.samples[0]
  let top = 0; for (const v of x) if (Math.abs(v) > top) top = Math.abs(v)
  // Each burst in the take, put on the timeline the way the clip puts it there; then the nearest burst of the backing.
  const found = onsets(x, pcm.rate, Math.max(0.02, top * 0.25), 200).map((i) => clip.start_ms + (i * 1000) / pcm.rate - clip.in_ms)
  const errs = found.map((ms) => { const want = AT.reduce((m, v) => (Math.abs(v - ms) < Math.abs(m - ms) ? v : m)); return ms - want }).filter((e) => Math.abs(e) < 250)
  const decodedMs = (x.length * 1000) / pcm.rate
  takes.push({ start_ms: clip.start_ms, in_ms: clip.in_ms, length_ms: clip.length_ms, offset_ms: audio.offset_ms, latency_ms: audio.latency_ms, said_ms: audio.duration_ms, decoded_ms: Math.round(decodedMs * 10) / 10, type: audio.content_type, peak: Math.round(top * 1000) / 1000, bursts: errs.length, errs: errs.map((e) => Math.round(e * 100) / 100) })
  await page.waitForFunction(() => !window.__parleyStudio?.recording && !window.__parleyDaw?.playing, null, { timeout: 8000 }).catch(() => {})
}
const good = takes.filter((t) => t && t.bursts >= 3)
ok(`every one of ${TAKES} takes landed in the project`, takes.every(Boolean), JSON.stringify(takes))
ok('the bursts can be found in every take', good.length === TAKES, JSON.stringify(takes))

const stat = (xs) => { if (!xs.length) return null; const m = xs.reduce((s, v) => s + v, 0) / xs.length; const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length); const r2 = (v) => Math.round(v * 100) / 100; return { mean: r2(m), sd: r2(sd), min: r2(Math.min(...xs)), max: r2(Math.max(...xs)), n: xs.length } }
const perTake = good.map((t) => t.errs.reduce((s, v) => s + v, 0) / t.errs.length)
const within = good.map((t) => Math.max(...t.errs) - Math.min(...t.errs))
const report = {
  browser: BROWSER, rates, takes: good.length,
  // + late, - early: where a burst landed on the timeline against where it is in the backing (ms).
  alignment_ms: stat(good.flatMap((t) => t.errs)),
  alignment_per_take_ms: stat(perTake),
  // The same without the latency the app subtracted (reported by the browser; not in this loop).
  alignment_uncompensated_ms: stat(good.map((t, i) => perTake[i] + (t.latency_ms ?? 0))),
  drift_within_take_ms: stat(within),
  latency_reported_ms: stat(good.map((t) => t.latency_ms ?? 0)),
  // The length the client reported for the take against the length of the audio it uploaded (ms).
  duration_error_ms: stat(good.map((t) => t.said_ms - t.decoded_ms)),
  detail: takes,
}
console.log('\n   measured (no tolerance asserted):')
for (const [k, v] of Object.entries(report)) if (k !== 'detail') console.log(`   ${k}: ${JSON.stringify(v)}`)
writeFileSync('studiorecord-baseline.json', JSON.stringify(report, null, 2))

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
