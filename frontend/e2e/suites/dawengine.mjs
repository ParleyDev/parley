// The DAW's playback engine, heard: what plays is captured sample for sample while the project is edited and looped,
// and compared with what it should be. Other clips do not gap when one is edited during playback; a loop turns on
// the sample every time; the gate and the limiter do in playback what they do in an export, and the limiter never
// passes its ceiling; and playing does not make React draw.
import { WEB, B, S, IP, BROWSER, reg, call, callS, ok, finish, launchBrowser } from '../lib.mjs'
import { wavFile, sine, impulses, bursts, pullRender, liveRate, startCapture, stopCapture, peak, rms, onsets, firstOver, db } from '../audio.mjs'

const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Engine ${S}` })
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'engine', kind: 'studio' })).body
const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Engine', bpm: 120 })).body
const st = await call(a.token, 'GET', `/channels/${P.channel_id}`)
const importAudio = async (name, seconds, signal) => (await fetch(`${B}/channels/${st.id}/studio/audio?name=${name}&duration_ms=${seconds * 1000}`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/wav', 'X-Forwarded-For': IP }, body: wavFile({ seconds, signal }) })).json()
const ops = (list) => callS(a.token, 'POST', `/studio/projects/${P.id}/ops`, { ops: list })
const id = () => crypto.randomUUID()

const TONE = await importAudio('tone.wav', 12, sine(1000, 0.5))
const BURST = await importAudio('burst.wav', 1, bursts([100], 0.8, 50))
const CLICK = await importAudio('click.wav', 1, impulses([100]))
// Loud bursts over a steady quiet tone, for the limiter; a tone that is quiet, then loud, then quiet, for the gate.
const LOUD = await importAudio('loud.wav', 2, (i, rate) => 0.2 * Math.sin((2 * Math.PI * 500 * i) / rate) + bursts([300, 1100], 0.7, 200)(i, rate))
const STEP = await importAudio('step.wav', 2, (i, rate) => { const ms = (i * 1000) / rate; return (ms >= 500 && ms < 1000 ? 0.5 : 0.002) * Math.sin((2 * Math.PI * 1000 * i) / rate) })
ok('the test signals are imported', [TONE, BURST, CLICK, LOUD, STEP].every((x) => x.id), JSON.stringify(TONE))

const browser = await launchBrowser({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
// Every time React draws: counted by the hook its developer tools use.
await ctx.addInitScript(() => { window.__commits = 0; window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject() { return 1 }, onCommitFiberRoot() { window.__commits++ }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} } })
const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await page.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await page.goto(`${WEB}/channels/${g.id}/${st.id}`)
await page.waitForSelector('[data-daw]', { timeout: 20000 }); await page.waitForFunction(() => !!window.__parleyDawTest)
const RATE = await liveRate(page), exact = RATE === 48000
console.log(`   (${BROWSER}: the page's audio runs at ${RATE} Hz${exact ? '' : '; sample-exact checks are off'})`)

let lanes = []
/** Replace the project's content; resolves once the page shows the last clip with its waveform. */
const scene = async (list, proj = {}) => {
  const last = list.filter((o) => o.op === 'clip.put').pop()
  const r = await ops([...lanes.map((l) => ({ op: 'lane.del', id: l })), { op: 'project', master_gain: 1, master_effects: [], clear_loop: true, ...proj }, ...list])
  if (r.status !== 200) throw new Error(`scene refused: ${r.status} ${JSON.stringify(r.body)}`)
  lanes = list.filter((o) => o.op === 'lane.put').map((o) => o.lane.id)
  await page.waitForSelector(`[data-daw-clip="${last.clip.id}"] [data-daw-wave="1"]`, { timeout: 10000 })
  await page.waitForTimeout(300)
}
const daw = () => page.evaluate(() => window.__parleyDaw)
const local = (list) => page.evaluate((l) => window.__parleyDawTest.edit(l), list)
const play = async () => { await page.click('[data-daw-rtz]'); await page.click('[data-daw-play]'); await page.waitForFunction(() => !!window.__parleyDaw?.playing) }
const stop = async () => { if ((await daw()).playing) await page.click('[data-daw-play]'); await page.waitForFunction(() => !window.__parleyDaw?.playing) }
/** How far a steady sine is from being one: the largest |x[n] - 2cos(w)x[n-1] + x[n-2]| over the stretch (zero for a pure sine, the size of the step at a break). */
const breaks = (x, rate, hz, from, to) => { const k = 2 * Math.cos((2 * Math.PI * hz) / rate); let m = 0, at = -1; for (let i = from + 2; i < to; i++) { const e = Math.abs(x[i] - k * x[i - 1] + x[i - 2]); if (e > m) { m = e; at = i } } return { worst: m, at } }

console.log('-- editing while it plays')
{
  const LT = id(), LO = id(), CT = id(), C1 = id(), C2 = id()
  // The tone hard left, everything that is edited hard right: the left channel is the tone alone.
  await scene([{ op: 'lane.put', lane: { id: LT, name: 'Tone', position: 0, pan: -1 } }, { op: 'lane.put', lane: { id: LO, name: 'Other', position: 1, pan: 1 } },
    { op: 'clip.put', clip: { id: CT, lane_id: LT, audio_id: TONE.id, start_ms: 0, length_ms: 12000 } }, { op: 'clip.put', clip: { id: C1, lane_id: LO, audio_id: BURST.id, start_ms: 3000, length_ms: 1000 } }])
  await startCapture(page); await play()
  const wait = (ms) => page.waitForTimeout(ms)
  await wait(1000)
  const s0 = await daw()
  await local([{ op: 'clip.put', clip: { id: C1, start_ms: 4000 } }]); await wait(500)
  await local([{ op: 'clip.put', clip: { id: C2, lane_id: LO, audio_id: BURST.id, start_ms: 5000, length_ms: 1000 } }]); await wait(500)
  // Another member's edit, as it arrives from the server.
  await ops([{ op: 'clip.put', clip: { id: C1, start_ms: 6000 } }]); await wait(500)
  await local([{ op: 'clip.put', clip: { id: C2, length_ms: 500, fade_out_ms: 100 } }]); await wait(500)
  await local([{ op: 'lane.put', lane: { id: LO, gain: 0.5 } }]); await wait(300)
  await local([{ op: 'clip.del', id: C2 }]); await wait(500)
  const s1 = await daw()
  // A new track changes the mixer's shape: that one edit starts playback again, from where it is.
  const LN = id(), CN = id()
  await local([{ op: 'lane.put', lane: { id: LN, name: 'New', position: 2, pan: 1 } }, { op: 'clip.put', clip: { id: CN, lane_id: LN, audio_id: BURST.id, start_ms: 7000, length_ms: 1000 } }]); await wait(4700)
  const s2 = await daw()
  await stop()
  const cap = await stopCapture(page)
  lanes.push(LN)
  ok('playback went on through the edits, in the pass it started in', !!s1.playing && !!s2.playing && s0.passes === s1.passes, JSON.stringify([s0, s1, s2]))
  const L = cap.samples[0], R = cap.samples[1]
  const begin = L.findIndex((v) => Math.abs(v) > 0.01)
  // The tone from just after it starts to just before the track is added: every clip edit falls in it.
  const from = begin + 480, to = from + Math.round(3.6 * cap.rate)
  const br = breaks(L, cap.rate, 1000, from, to)
  // A pure 0.5 sine at 1 kHz moves at most 0.065 between samples; a restart would break it by up to its full swing.
  ok(`the tone has no break in ${((to - from) / cap.rate).toFixed(1)} s of playing while other clips were moved, added, trimmed and removed (worst step ${br.worst.toExponential(1)})`, cap.skipped === 0 ? br.worst < 2e-3 : true, JSON.stringify({ ...br, skipped: cap.skipped, begin }))
  ok('and is at its level throughout', Math.abs(rms(L.subarray(from, to), cap.rate) - 0.5 / Math.SQRT2) < 2e-3, String(rms(L.subarray(from, to), cap.rate)))
  if (cap.skipped) console.log(`   (the browser skipped ${cap.skipped} frames of audio during the capture: the break check does not count)`)
  // Adding the track: the tone stops once, for a moment, and is back at its level and in its place on the timeline.
  let gap = 0, run = 0, gapAt = -1
  for (let i = to; i < begin + Math.round(8.5 * cap.rate); i++) { if (Math.abs(L[i]) < 1e-3 && Math.abs(L[i + 5]) < 1e-3 && Math.abs(L[i + 11]) < 1e-3) { run++; if (run > gap) { gap = run; gapAt = i } } else run = 0 }
  const gapMs = (gap * 1000) / cap.rate
  console.log(`   (adding a track while playing: the tone is silent for ${gapMs.toFixed(1)} ms, ${(((gapAt - begin) * 1000) / cap.rate / 1000).toFixed(2)} s in)`)
  ok(`adding a track starts playback again with a gap of under 150 ms (${gapMs.toFixed(1)} ms), and the tone goes on at its level`, gapMs < 150 && Math.abs(rms(L.subarray(begin), cap.rate, 5000, 8500) - 0.5 / Math.SQRT2) < 2e-3, `${gapMs} ${rms(L.subarray(begin), cap.rate, 5000, 8500)}`)
  // The bursts on the right are where the edits put them: 6000 (moved twice, at half level), 7000 (the new track).
  const on = onsets(R, cap.rate, 0.05, 300).map((i) => ((i - begin) * 1000) / cap.rate)
  ok('the moved clip plays where it was moved to, the new one where it was put, the deleted one not at all', on.length === 2 && Math.abs(on[0] - 6100) < 3 && Math.abs(on[1] - 7100) < 3, JSON.stringify(on))
  const lv = [peak(R.subarray(begin), cap.rate, 6100, 6150), peak(R.subarray(begin), cap.rate, 7100, 7150)]
  ok('at the level its track was turned to', Math.abs(lv[0] - 0.4) < 0.02 && Math.abs(lv[1] - 0.8) < 0.02, JSON.stringify(lv))
}

console.log('-- a loop')
{
  const LK = id(), CK = id(), SECS = Number(process.env.DAW_LOOP_SECS ?? 30)
  await scene([{ op: 'lane.put', lane: { id: LK, name: 'Click', position: 0, pan: -1 } }, { op: 'clip.put', clip: { id: CK, lane_id: LK, audio_id: CLICK.id, start_ms: 0, length_ms: 1000 } }], { loop_start_ms: 0, loop_end_ms: 1000, loop_on: true })
  await startCapture(page); await play()
  await page.waitForTimeout(SECS * 1000)
  const s = await daw()
  await stop()
  const cap = await stopCapture(page)
  const on = onsets(cap.samples[0], cap.rate, 0.3, 500)
  const gaps = on.slice(1).map((v, i) => v - on[i])
  const off = gaps.filter((d) => d !== cap.rate)
  ok(`the loop came round ${on.length} times in ${SECS} s`, on.length >= SECS - 1 && on.length <= SECS + 1 && !!s.playing, `${on.length}`)
  ok(`every turn is exactly a second after the one before, to the sample (${off.length} of ${gaps.length} are not)`, exact && cap.skipped === 0 ? off.length === 0 : off.every((d) => Math.abs(d - cap.rate) < cap.rate / 1000 + cap.skipped), JSON.stringify({ off: off.slice(0, 5), skipped: cap.skipped, where: gaps.map((d, i) => (d === cap.rate ? null : { turn: i + 1, at: on[i], next: Array.from({ length: 12 }, (_, k) => peak(cap.samples[0].subarray(on[i] + cap.rate - 2400 + k * 400, on[i] + cap.rate - 2400 + (k + 1) * 400), cap.rate).toFixed(2)).join(' ') })).filter(Boolean).slice(0, 3) }))
  // A range moved while it loops: the next turn is at the new end, without stopping.
  await startCapture(page); await play(); await page.waitForTimeout(1500)
  await local([{ op: 'project', loop_start_ms: 0, loop_end_ms: 500, loop_on: true }]); await page.waitForTimeout(4000)
  const s2 = await daw()
  await stop()
  const cap2 = await stopCapture(page)
  const on2 = onsets(cap2.samples[0], cap2.rate, 0.3, 300), g2 = on2.slice(1).map((v, i) => Math.round(((v - on2[i]) * 1000) / cap2.rate))
  ok('a loop shortened while it plays turns at the new length from then on', !!s2.playing && g2.slice(-4).every((d) => d === 500) && g2[0] === 1000, JSON.stringify(g2))
}

console.log('-- the limiter and the gate, in the export and as they play')
{
  const LL = id(), CL = id()
  const fx = (type, params) => [{ id: 'f1', type, on: true, params }]
  /** The scene rendered, and the same played and captured, lined up with the render. */
  const both = async (ms) => {
    const r = await pullRender(page)
    await startCapture(page); await play(); await page.waitForTimeout(ms + 600); await stop()
    const cap = await stopCapture(page)
    const x = r.samples[0], y = cap.samples[0]
    // The click on the right is in both at the same place on the timeline: that lines them up.
    const off = firstOver(cap.samples[1], cap.rate, 0.02) - firstOver(r.samples[1], r.rate, 0.02)
    const n = Math.min(x.length, y.length - off, Math.round((ms * r.rate) / 1000))
    let worst = 0, xy = 0, xx = 0, yy = 0
    for (let i = Math.max(0, -off); i < n; i++) { const u = x[i], v = y[i + off]; worst = Math.max(worst, Math.abs(u - v)); xy += u * v; xx += u * u; yy += v * v }
    return { r, x, live: y.subarray(Math.max(0, off), off + n), match: xy / Math.sqrt(xx * yy || 1), worst, n, off, skipped: cap.skipped }
  }
  // A quiet click hard right, under every threshold here, as the mark.
  const LR = id(), CR = id()
  const mark = [{ op: 'lane.put', lane: { id: LR, name: 'Mark', position: 1, pan: 1, gain: 0.05 } }, { op: 'clip.put', clip: { id: CR, lane_id: LR, audio_id: CLICK.id, start_ms: 0, length_ms: 1000 } }]
  const CEIL = Math.pow(10, -6 / 20)
  // 0.9 at the most, doubled by the track: 5 dB over full scale into a limiter at -6 dBFS.
  await scene([{ op: 'lane.put', lane: { id: LL, name: 'Loud', position: 0, pan: -1, gain: 2 } }, { op: 'clip.put', clip: { id: CL, lane_id: LL, audio_id: LOUD.id, start_ms: 0, length_ms: 2000 } }, ...mark], { master_effects: fx('limiter', { ceiling: -6, release: 100 }) })
  let m = await both(2000)
  const dry = (i) => 2 * (0.2 * Math.sin((2 * Math.PI * 500 * i) / 48000))
  ok(`a limiter on the master keeps the export at its ceiling: peak ${db(peak(m.x, 48000)).toFixed(2)} dBFS for -6`, peak(m.x, 48000) <= CEIL + 1e-6 && peak(m.x, 48000) > CEIL * 0.98, String(peak(m.x, 48000)))
  ok('what is under the ceiling passes as it is, 2 ms late (the look-ahead)', Math.abs(m.x[4800 + 96] - dry(4800)) < 1e-3 && Math.abs(rms(m.x, 48000, 50, 250) - 0.4 / Math.SQRT2) < 2e-3, `${m.x[4896]} for ${dry(4800)}`)
  ok('it turns down for a burst before it arrives and comes back after it', rms(m.x, 48000, 350, 480) < CEIL && rms(m.x, 48000, 350, 480) > CEIL * 0.5 && Math.abs(rms(m.x, 48000, 900, 1050) - 0.4 / Math.SQRT2) < 0.02, `${rms(m.x, 48000, 350, 480)} ${rms(m.x, 48000, 900, 1050)}`)
  ok(`played, it never passes the ceiling either (peak ${db(peak(m.live, 48000)).toFixed(2)} dBFS)`, peak(m.live, 48000) <= CEIL + 1e-6, String(peak(m.live, 48000)))
  ok(`and what plays is what is exported (match ${m.match.toFixed(5)}, largest difference ${m.worst.toExponential(1)})`, m.match > 0.999 && (!exact || m.skipped || m.worst < 2e-3), JSON.stringify({ match: m.match, worst: m.worst, n: m.n, off: m.off, skipped: m.skipped }))
  // The same on the track.
  await scene([{ op: 'lane.put', lane: { id: LL, name: 'Loud', position: 0, pan: -1, gain: 1, effects: fx('limiter', { ceiling: -12, release: 50 }) } }, { op: 'clip.put', clip: { id: CL, lane_id: LL, audio_id: LOUD.id, start_ms: 0, length_ms: 2000 } }])
  const r = await pullRender(page)
  ok('a limiter on a track keeps that track at its ceiling', peak(r.samples[0], 48000) <= Math.pow(10, -12 / 20) + 1e-6 && peak(r.samples[0], 48000) > 0.24, String(peak(r.samples[0], 48000)))

  // The gate: -60 dBFS for half a second, -6 for half a second, -60 after.
  await scene([{ op: 'lane.put', lane: { id: LL, name: 'Step', position: 0, pan: -1, effects: fx('gate', { threshold: -30, attack: 1, hold: 50, release: 100, range: -80 }) } }, { op: 'clip.put', clip: { id: CL, lane_id: LL, audio_id: STEP.id, start_ms: 0, length_ms: 2000 } }, ...mark])
  m = await both(2000)
  ok('a gate is shut under its threshold: nothing comes through', peak(m.x, 48000, 0, 495) < 1e-9, String(peak(m.x, 48000, 0, 495)))
  ok('open over it: the signal as it is', Math.abs(rms(m.x, 48000, 550, 950) - 0.5 / Math.SQRT2) < 1e-3, String(rms(m.x, 48000, 550, 950)))
  ok('held for its hold time after the signal falls, then shut again', rms(m.x, 48000, 1005, 1040) > 0.001 && rms(m.x, 48000, 1700, 1950) < 2e-5, `${rms(m.x, 48000, 1005, 1040)} ${rms(m.x, 48000, 1700, 1950)}`)
  ok(`and what plays is what is exported (match ${m.match.toFixed(5)}, largest difference ${m.worst.toExponential(1)})`, m.match > 0.999 && (!exact || m.skipped || m.worst < 2e-3), JSON.stringify({ match: m.match, worst: m.worst, n: m.n, off: m.off, skipped: m.skipped }))
  await scene([{ op: 'lane.put', lane: { id: LL, name: 'Step', position: 0, pan: -1, effects: fx('gate', { threshold: -30, attack: 1, hold: 50, release: 100, range: -20 }) } }, { op: 'clip.put', clip: { id: CL, lane_id: LL, audio_id: STEP.id, start_ms: 0, length_ms: 2000 } }])
  const rg = await pullRender(page)
  ok('with a range of -20 dB a shut gate turns down by 20 dB instead', Math.abs(db(rms(rg.samples[0], 48000, 100, 450) / (0.002 / Math.SQRT2)) + 20) < 0.2, String(db(rms(rg.samples[0], 48000, 100, 450) / (0.002 / Math.SQRT2))))
}

console.log('-- an instrument played by hand')
{
  const LM = id(), LT = id(), CT = id()
  const put = (lane) => local([{ op: 'lane.put', lane: { id: LM, ...lane } }])
  await scene([{ op: 'lane.put', lane: { id: LM, kind: 'midi', name: 'Keys', position: 0, pan: -1, gain: 1, instrument: { type: 'synth' } } }, { op: 'lane.put', lane: { id: LT, name: 'Tone', position: 1, pan: 1, mute: true } },
    { op: 'clip.put', clip: { id: CT, lane_id: LT, audio_id: TONE.id, start_ms: 0, length_ms: 2000 } }])
  if ((await page.locator(`[data-daw-midi-arm="${LM}"]`).getAttribute('aria-pressed')) !== 'true') await page.click(`[data-daw-midi-arm="${LM}"]`)
  if ((await page.locator('[data-daw-keys]').getAttribute('aria-pressed')) !== 'true') await page.click('[data-daw-keys]')
  await page.locator('[data-daw]').click({ position: { x: 5, y: 5 } }).catch(() => {})
  /** A key held for half a second, heard: the peak on each side while it sounds, what is left a second after it is let
   *  go, and the root of the note's energy (its level, whatever its first samples were). */
  const note = async (during) => {
    await startCapture(page)
    await page.keyboard.down('a'); await page.waitForTimeout(250); if (during) await during(); await page.waitForTimeout(250); await page.keyboard.up('a')
    await page.waitForTimeout(1500)
    const cap = await stopCapture(page), n = cap.samples[0].length
    return { l: peak(cap.samples[0], cap.rate), r: peak(cap.samples[1], cap.rate), tail: peak(cap.samples[0].subarray(n - Math.round(cap.rate * 0.3)), cap.rate), e: Math.sqrt(cap.samples[0].reduce((t, v) => t + v * v, 0)) }
  }
  // The first note after the strips are built starts harder on WebKit (see the results document): levels are compared from the second.
  const first = await note()
  ok('the first key after the engine was idle sounds', first.l > 0.01 && first.r < first.l * 1e-3 && first.tail < 1e-4, JSON.stringify(first))
  const full = await note()
  ok('a key sounds through its track: hard left as the track is panned', full.l > 0.01 && full.r < full.l * 1e-3 && full.tail < 1e-4, JSON.stringify(full))
  await put({ gain: 0.25 }); await page.waitForTimeout(200)
  const quiet = await note()
  ok(`at the track's fader: a quarter of the level with the fader at a quarter (${(quiet.e / full.e).toFixed(3)})`, Math.abs(quiet.e / full.e - 0.25) < 0.02, JSON.stringify({ full, quiet }))
  await put({ gain: 1, mute: true }); await page.waitForTimeout(200)
  const muted = await note()
  ok('and not at all on a muted track', muted.l < 1e-5, JSON.stringify(muted))
  await put({ mute: false }); await page.waitForTimeout(200)
  // The octave moved while the key is held: the note that was started is the one that stops.
  const moved = await note(() => page.keyboard.press('x'))
  ok('a key let go after the octave was changed stops its note', moved.l > 0.01 && moved.tail < 1e-4, JSON.stringify(moved))
  await page.keyboard.press('z')
  await play(); await page.waitForTimeout(300)
  const live = await note()
  await stop()
  ok('the same while the project plays', Math.abs(live.e / full.e - 1) < 0.08 && live.r < live.l * 1e-3, JSON.stringify({ full, live }))
  await page.click('[data-daw-keys]')
}

console.log('-- playing does not make React draw')
{
  const LT = id(), CT = id()
  await scene([{ op: 'lane.put', lane: { id: LT, name: 'Tone', position: 0 } }, { op: 'clip.put', clip: { id: CT, lane_id: LT, audio_id: TONE.id, start_ms: 0, length_ms: 12000 } }])
  ok('React\'s draws are being counted', await page.evaluate(() => window.__commits) > 0)
  await play(); await page.waitForTimeout(1000)
  const h0 = await page.locator('[data-daw-playhead]').evaluate((e) => parseFloat(e.style.left)), t0 = await page.locator('[data-daw-time]').textContent()
  const c0 = await page.evaluate(() => window.__commits)
  await page.waitForTimeout(5000)
  const c1 = await page.evaluate(() => window.__commits)
  const h1 = await page.locator('[data-daw-playhead]').evaluate((e) => parseFloat(e.style.left)), t1 = await page.locator('[data-daw-time]').textContent()
  await stop()
  ok(`five seconds of playing drew ${c1 - c0} times (${((c1 - c0) / 5).toFixed(1)} a second)`, (c1 - c0) / 5 <= 2, `${c0} -> ${c1}`)
  ok('while the playhead and the time moved on', h1 - h0 > 150 && t0 !== t1, JSON.stringify([h0, h1, t0, t1]))
}

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
