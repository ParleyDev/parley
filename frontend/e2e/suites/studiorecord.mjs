// Recording, checked on the audio itself. Four things:
//
//  1. Placement. The recorder's input is what the DAW plays, exactly 100 ms late, inside the DAW's own audio graph
//     (see `studioInput`): a player who is always 100 ms behind. Every burst of the backing must land on the timeline
//     100 ms after itself, less the output latency the app takes off (reported by the browser for real hardware; this
//     loop has none), within a millisecond, in every take. The click is on for these takes and must be in none.
//  2. Nothing lost. The input is a minute of known noise: the stored take must hold those samples, each one, as 24-bit
//     PCM, with nothing before or after them, and say it is as long as the frames it holds.
//  3. The fallback. Where the capture worklet cannot load, the take is still made, compressed, and says so.
//  4. A microphone. Through getUserMedia (the test's stream, see `syntheticMic`) rather than a node of the graph. The
//     stream between the two audio contexts adds delay of its own, so this is measured and only loosely bounded.
import { writeFileSync } from 'node:fs'
import { WEB, B, S, IP, BROWSER, reg, call, callS, ok, finish, launchBrowser, chromiumOnly } from '../lib.mjs'
import { wavFile, parseWav, bursts, noise, as24, peak, pullAudio, pullRender, onsets, syntheticMic, studioInput, humCheck } from '../audio.mjs'

await chromiumOnly('needs a voice room and a microphone')

const TAKES = Number(process.env.STUDIO_TAKES ?? 20)
const LONG = Number(process.env.STUDIO_LONG_SECS ?? 60)
const AT = [1000, 1500, 2000, 2500, 3000, 3500, 4000]
const LOOP_MS = 100
const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Record ${S}` })
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'record', kind: 'studio' })).body
const project = async (name, armed = false) => {
  const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name, bpm: 120 })).body
  const st = await call(a.token, 'GET', `/channels/${P.channel_id}`)
  const backing = await (await fetch(`${B}/channels/${st.id}/studio/audio?name=bursts.wav&duration_ms=5000`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/wav', 'X-Forwarded-For': IP }, body: wavFile({ seconds: 5, signal: bursts(AT) }) })).json()
  const LB = crypto.randomUUID(), CB = crypto.randomUUID()
  // Hard left: a mono signal there is at its own level.
  const r = await callS(a.token, 'POST', `/studio/projects/${P.id}/ops`, { ops: [{ op: 'lane.put', lane: { id: LB, name: 'Backing', position: 0, pan: -1 } }, { op: 'clip.put', clip: { id: CB, lane_id: LB, audio_id: backing.id, start_ms: 0, length_ms: 5000 } }, ...(armed ? [{ op: 'lane.put', lane: { id: crypto.randomUUID(), name: 'Me', position: 1, user_id: a.user.id, armed: true } }] : [])] })
  ok(`${name}: a project with a backing of tone bursts`, r.status === 200, JSON.stringify(r.body))
  return { P, st, CB, seen: new Set([backing.id]), full: () => call(a.token, 'GET', `/studio/projects/${P.id}`) }
}

const browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
/** The project open in a page of its own, in its voice room. */
const open = async (pr, init) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] })
  await init(ctx)
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${WEB}/login`); await page.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
  await page.goto(`${WEB}/channels/${g.id}/${pr.st.id}`)
  const join = page.locator('[data-project-join]').or(page.getByText('Join Voice', { exact: true })).first(); await join.waitFor(); await join.click()
  await page.waitForSelector('[data-voice-leave]'); await page.waitForSelector(`[data-daw-clip="${pr.CB}"] [data-daw-wave="1"]`, { timeout: 20000 })
  return { ctx, page }
}
/** One take: record from the start for `ms` (calling `during` once it runs), stop, and wait for it in the project. */
const take = async (pr, page, ms, during) => {
  await page.click('[data-daw-rtz]')
  await page.click('[data-daw-record]')
  const started = await page.waitForFunction(() => window.__parleyStudio?.recording === true && window.__parleyDaw?.playing === 'backing', null, { timeout: 15000 }).then(() => true, () => false)
  if (during) await during()
  await page.waitForTimeout(ms)
  await page.click('[data-daw-record]')
  let f = null, clip = null
  for (let i = 0; i < 60 && !clip; i++) { f = await pr.full(); clip = f.clips.find((c) => c.audio_id && !pr.seen.has(c.audio_id) && !c.muted); if (!clip) await page.waitForTimeout(500) }
  await page.waitForFunction(() => !window.__parleyStudio?.recording && !window.__parleyDaw?.playing, null, { timeout: 8000 }).catch(() => {})
  if (!started || !clip) return null
  pr.seen.add(clip.audio_id)
  return { clip, audio: f.audio.find((x) => x.id === clip.audio_id) }
}
/** The take as it is stored: the file, read here. */
const stored = async (id) => { const r = await fetch(`${B}/studio/tracks/${id}`, { headers: { Authorization: `Bearer ${a.token}`, 'X-Forwarded-For': IP } }); const bytes = Buffer.from(await r.arrayBuffer()); return { type: r.headers.get('content-type'), bytes, wav: bytes.toString('latin1', 0, 4) === 'RIFF' ? parseWav(bytes) : null } }
const r2 = (v) => Math.round(v * 100) / 100
const stat = (xs) => { if (!xs.length) return null; const m = xs.reduce((s, v) => s + v, 0) / xs.length; const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length); return { mean: r2(m), sd: r2(sd), min: r2(Math.min(...xs)), max: r2(Math.max(...xs)), n: xs.length } }
/** Where the bursts of a take landed on the timeline, against where each should be (+ late, - early). */
const landed = (x, rate, clip, shift) => {
  const top = peak(x, rate)
  const found = onsets(x, rate, Math.max(0.02, top * 0.25), 200).map((i) => clip.start_ms + (i * 1000) / rate - clip.in_ms)
  return { top, errs: found.map((ms) => { const want = AT.map((v) => v + shift).reduce((m, v) => (Math.abs(v - ms) < Math.abs(m - ms) ? v : m)); return ms - want }).filter((e) => Math.abs(e) < 250) }
}
const report = { browser: BROWSER }

// ---- 1. placement, and no click -------------------------------------------------------------------------------
{
  // With a track of my own, armed: its input shows before anything is recorded.
  const pr = await project('Loop', true)
  const { ctx, page } = await open(pr, (c) => c.addInitScript(studioInput, 'loop'))
  report.rates = await page.evaluate(() => { const c = window.__parleyDawTest.context(); return { daw: c.sampleRate, base: c.baseLatency, output: c.outputLatency ?? null } })
  ok('the audio runs at the project rate, 48 kHz', report.rates.daw === 48000, JSON.stringify(report.rates))
  await page.waitForSelector('[data-daw-input]', { timeout: 8000 }).catch(() => {})
  ok('the armed track names its input before recording', (await page.locator('[data-daw-input]').first().textContent().catch(() => '')) === 'test')
  await page.click('[data-daw-click]')
  ok('the metronome is on', await page.waitForSelector('[data-daw-click][aria-pressed="true"]', { timeout: 5000 }).then(() => true, () => false))
  const takes = []
  let status = false
  for (let n = 0; n < TAKES; n++) {
    const before = await page.evaluate(() => window.__parleyDawTest.clicks())
    const t = await take(pr, page, 5600, async () => { status ||= await page.waitForSelector('[data-daw-take-status]', { timeout: 3000 }).then(() => true, () => false) })
    if (!t) { takes.push(null); continue }
    // Out of the project before the next one: it would be played with the backing, and recorded again.
    await callS(a.token, 'POST', `/studio/projects/${pr.P.id}/ops`, { ops: [{ op: 'clip.del', id: t.clip.id }] })
    await page.waitForSelector(`[data-daw-clip="${t.clip.id}"]`, { state: 'detached', timeout: 8000 }).catch(() => {})
    const file = await stored(t.audio.id)
    if (!file.wav) { takes.push({ type: file.type }); continue }
    const x = file.wav.samples[0], rate = file.wav.rate
    const { top, errs } = landed(x, rate, t.clip, LOOP_MS - (t.audio.latency_ms ?? 0))
    // Where no burst is (the click would be: beats at 0 and 500 ms, and 4500), there is nothing at all.
    const at = (ms) => ms - t.clip.start_ms + t.clip.in_ms
    const quiet = Math.max(peak(x, rate, Math.max(0, at(0)), at(1050)), peak(x, rate, at(4250), at(5050)))
    takes.push({ start_ms: t.clip.start_ms, in_ms: t.clip.in_ms, offset_ms: t.audio.offset_ms, latency_ms: t.audio.latency_ms, said_ms: t.audio.duration_ms, frames: file.wav.frames, bits: file.wav.bits, rate, peak: r2(top), quiet, ticks: (await page.evaluate(() => window.__parleyDawTest.clicks())) - before, bursts: errs.length, errs: errs.map((e) => Math.round(e * 1000) / 1000) })
  }
  const good = takes.filter((t) => t && t.bursts === AT.length)
  ok(`every one of ${TAKES} takes landed in the project as 24-bit PCM at 48 kHz`, takes.every((t) => t && t.bits === 24 && t.rate === 48000), JSON.stringify(takes))
  ok('every burst is found in every take', good.length === TAKES, JSON.stringify(takes))
  const worst = Math.max(...good.flatMap((t) => t.errs.map(Math.abs)))
  ok(`every burst of ${good.length} of ${TAKES} takes is within 1 ms of where it was played (worst ${r2(worst)} ms)`, good.length === TAKES && worst <= 1, JSON.stringify(good.map((t) => t.errs)))
  ok('a take says it is as long as the frames it holds', good.every((t) => Math.abs(t.said_ms - (t.frames * 1000) / t.rate) <= 1), JSON.stringify(good.map((t) => [t.said_ms, t.frames])))
  ok('the click played during every take', good.every((t) => t.ticks > 0), JSON.stringify(good.map((t) => t.ticks)))
  ok('and is in none of them', good.every((t) => t.quiet < 1e-6), JSON.stringify(good.map((t) => t.quiet)))
  ok('the take showed its state while it was sent', status)
  const mix = await pullRender(page)
  ok('nor is the click in the mix', !!mix && peak(mix.samples[0], mix.rate, 0, 950) < 1e-6 && peak(mix.samples[0], mix.rate, 1000, 1100) > 0.1, mix ? `${peak(mix.samples[0], mix.rate, 0, 950)}` : 'no render')
  Object.assign(report, { takes: good.length, alignment_ms: stat(good.flatMap((t) => t.errs)), drift_within_take_ms: stat(good.map((t) => Math.max(...t.errs) - Math.min(...t.errs))), latency_reported_ms: stat(good.map((t) => t.latency_ms ?? 0)), duration_error_ms: stat(good.map((t) => t.said_ms - (t.frames * 1000) / t.rate)), detail: takes })
  await ctx.close()
}

// ---- 2. nothing lost ------------------------------------------------------------------------------------------
{
  const pr = await project('Noise')
  const { ctx, page } = await open(pr, (c) => c.addInitScript(studioInput, 'noise'))
  const N = LONG * 48000, SEED = 20260 + S
  const t = await take(pr, page, LONG * 1000 + 1500, () => page.evaluate(([n, seed]) => window.__studioIn.play(n, seed), [N, SEED]))
  ok(`a take of ${LONG} s of noise landed`, !!t, '')
  if (t) {
    const file = await stored(t.audio.id), w = file.wav
    ok('it is stored as PCM: 24 bits, 48 kHz, one channel, a true header', !!w && w.format === 1 && w.bits === 24 && w.rate === 48000 && w.channels === 1 && w.dataSize === file.bytes.length - 44 && w.riffSize === file.bytes.length - 8, JSON.stringify(w && { ...w, samples: undefined }))
    const x = w?.samples[0] ?? new Float32Array(0), want = noise(N, SEED)
    let first = 0; while (first < x.length && x[first] === 0) first++
    let wrong = 0, worst = 0
    for (let i = 0; i < N; i++) { const d = Math.abs((x[first + i] ?? 9) - as24(want[i])); if (d > 0) wrong++; if (d > worst) worst = d }
    let after = 0; for (let i = first + N; i < x.length; i++) if (x[i] !== 0) after++
    ok(`all ${N} samples are the ones played, to the bit (${wrong} differ, worst ${worst * 8388608} steps)`, wrong === 0, `first at ${first}`)
    ok('with nothing after them', x.length > first + N && after === 0, `${after} of ${x.length - first - N}`)
    ok(`so ${LONG} s played is ${LONG} s recorded, and the take says how long it is`, Math.abs(t.audio.duration_ms - (w.frames * 1000) / 48000) <= 1 && t.clip.length_ms <= t.audio.duration_ms, `${t.audio.duration_ms} for ${w?.frames} frames`)
    report.lossless = { frames: N, differ: wrong, take_frames: w?.frames, said_ms: t.audio.duration_ms }
  }
  await ctx.close()
}
// From its first sample: the input is noise going round since before the take. Every sample of the take
// must be the one that was playing at that moment. Where the browser did not run the recorder for a moment the take
// is silent, and what follows is still in its place.
{
  const pr = await project('Hum')
  const { ctx, page } = await open(pr, (c) => c.addInitScript(studioInput, 'hum'))
  const runs = []
  for (let n = 0; n < 3; n++) {
    const t = await take(pr, page, 2500)
    runs.push(humCheck((t && (await stored(t.audio.id)).wav?.samples[0]) || new Float32Array(0)))
  }
  ok('three takes of a running signal hold it from their first sample, each sample in its place', runs.every((r) => r.frames > 48000 && r.phase >= 0 && r.wrong === 0), JSON.stringify(runs))
  ok('what the browser did not hand over is little', runs.every((r) => r.silent <= 4096), JSON.stringify(runs))
  report.start_of_take = runs
  await ctx.close()
}

// ---- 3. the fallback ------------------------------------------------------------------------------------------
{
  const pr = await project('Fallback')
  const { ctx, page } = await open(pr, async (c) => { await c.addInitScript(studioInput, 'loop'); await c.addInitScript(() => { const real = AudioWorklet.prototype.addModule; AudioWorklet.prototype.addModule = function (url, ...rest) { return /studio/.test(String(url)) ? Promise.reject(new Error('no worklet here')) : real.call(this, url, ...rest) } }) })
  let said = false
  const t = await take(pr, page, 3000, async () => { said = await page.waitForSelector('[data-daw-take-status="compressed"]', { timeout: 3000 }).then(() => true, () => false) })
  ok('without the capture worklet a take is still made', !!t, '')
  ok('it is compressed, and its record says so', !!t && !t.audio.bits && !/wav/.test(t.audio.content_type), JSON.stringify(t?.audio))
  ok('the transport said so while it recorded', said)
  ok('and the clip says so after', !!t && /compressed/.test(await page.locator(`[data-daw-clip="${t.clip.id}"]`).textContent().catch(() => '')))
  if (t) {
    const pcm = await pullAudio(page, `/api/studio/tracks/${t.audio.id}`, a.token)
    const { errs } = pcm ? landed(pcm.samples[0], pcm.rate, t.clip, LOOP_MS - (t.audio.latency_ms ?? 0)) : { errs: [] }
    ok('it can be heard and is near where it was played', errs.length >= 3 && errs.every((e) => Math.abs(e) < 60), JSON.stringify(errs))
    report.fallback_alignment_ms = stat(errs)
  }
  await ctx.close()
}

// ---- 4. a microphone ------------------------------------------------------------------------------------------
{
  const pr = await project('Mic')
  const { ctx, page } = await open(pr, (c) => c.addInitScript(syntheticMic))
  ok('the microphone the room opened is the test\'s', await page.evaluate(() => window.__parleyTestMic.asked.some((c) => c && c.audio)))
  await page.evaluate(() => { window.__parleyTestMic.feed(window.__parleyDawTest.tap()) })
  const takes = []
  for (let n = 0; n < 3; n++) {
    const t = await take(pr, page, 5600)
    const file = t && await stored(t.audio.id)
    if (!file?.wav) { takes.push(null); continue }
    const { errs } = landed(file.wav.samples[0], file.wav.rate, t.clip, -(t.audio.latency_ms ?? 0))
    takes.push({ bits: file.wav.bits, frames: file.wav.frames, said_ms: t.audio.duration_ms, errs: errs.map(r2) })
  }
  const good = takes.filter((t) => t && t.errs.length >= 3)
  ok('three takes from a microphone are PCM too', good.length === 3 && good.every((t) => t.bits === 24), JSON.stringify(takes))
  ok('and land within the delay of the test\'s own stream (100 ms), steadily (10 ms)', good.length === 3 && good.every((t) => t.errs.every((e) => Math.abs(e) < 100) && Math.max(...t.errs) - Math.min(...t.errs) <= 10.5), JSON.stringify(takes))
  report.microphone_alignment_ms = stat(good.flatMap((t) => t.errs))
  report.microphone_drift_within_take_ms = stat(good.map((t) => Math.max(...t.errs) - Math.min(...t.errs)))
  await ctx.close()
}

console.log('\n   measured:')
for (const [k, v] of Object.entries(report)) if (k !== 'detail') console.log(`   ${k}: ${JSON.stringify(v)}`)
writeFileSync('studiorecord-measured.json', JSON.stringify(report, null, 2))

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
