// How the DAW holds up at the size it is meant to carry: a project of 16 audio tracks of 5 minutes each, 200 clips and
// 8 effects, opened, played, looped and rendered, with the figures written down. Nothing here is asserted: this is a
// measuring script (not a suite), run by hand before and after work on the engine and compared.
//   PARLEY_API_ORIGIN=… PARLEY_WEB=… npm run perf:studio
// Figures land in e2e/out/studioperf.json. They depend on the machine, so compare runs from the same one.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WEB, B, S, IP, BROWSER, reg, call, callS, finish, launchBrowser } from './lib.mjs'

const TRACKS = 16, MINUTES = 5, CLIPS = 200, LEN = MINUTES * 60_000
const out = join(dirname(fileURLToPath(import.meta.url)), 'out'); mkdirSync(out, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), 'studioperf-'))
const r2 = (v) => Math.round(v * 100) / 100

const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Perf ${S}` })
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'perf', kind: 'studio' })).body
const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Perf', bpm: 120 })).body
const st = await call(a.token, 'GET', `/channels/${P.channel_id}`)

console.log(`-- building: ${TRACKS} tracks of ${MINUTES} min, ${CLIPS} clips, 8 effects`)
// Each track its own file (a tone of its own pitch, pulsing), sent as FLAC: what the page holds once decoded is the same
// as for any 5 minute take.
const audio = []
for (let i = 0; i < TRACKS; i++) {
  const f = join(tmp, `t${i}.flac`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${110 * (i + 1)}:duration=${MINUTES * 60}:sample_rate=48000`, '-af', `tremolo=f=${1 + (i % 4)}:d=0.8,volume=0.5`, '-c:a', 'flac', f])
  const r = await fetch(`${B}/channels/${st.id}/studio/audio?name=t${i}.flac&duration_ms=${LEN}`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/flac', 'X-Forwarded-For': IP }, body: readFileSync(f) })
  if (!r.ok) { console.log('   could not import the audio:', r.status, await r.text()); await finish() }
  audio.push((await r.json()).id)
}
const fx = (type, params = {}) => ({ id: crypto.randomUUID().slice(0, 8), type, on: true, params })
const BUS = crypto.randomUUID()
const lanes = [{ op: 'lane.put', lane: { id: BUS, name: 'Room', kind: 'bus', position: TRACKS, effects: [fx('reverb')] } }]
const clips = []; let last = null
for (let i = 0; i < TRACKS; i++) {
  const id = crypto.randomUUID()
  // 8 effects in all: an EQ on four tracks, a compressor on two, the reverb on the bus, a limiter on the master.
  lanes.push({ op: 'lane.put', lane: { id, name: `Track ${i + 1}`, position: i, volume: 0.5, pan: (i % 5 - 2) / 4, effects: i < 4 ? [fx('eq', { mid: 3, midFreq: 1000 })] : i < 6 ? [fx('compressor')] : [], sends: i % 4 === 0 ? { [BUS]: 0.3 } : {} } })
  const n = i < CLIPS - TRACKS * Math.floor(CLIPS / TRACKS) ? Math.floor(CLIPS / TRACKS) + 1 : Math.floor(CLIPS / TRACKS), each = Math.floor(LEN / n)
  for (let k = 0; k < n; k++) { last = crypto.randomUUID(); clips.push({ op: 'clip.put', clip: { id: last, lane_id: id, audio_id: audio[i], start_ms: k * each, in_ms: k * each, length_ms: each, fade_in_ms: 10, fade_out_ms: 10 } }) }
}
let r = await callS(a.token, 'POST', `/studio/projects/${P.id}/ops`, { ops: [{ op: 'project', master_effects: [fx('limiter')], loop_start_ms: 60_000, loop_end_ms: 62_000 }, ...lanes, ...clips] })
if (r.status !== 200) { console.log('   could not build the project:', r.status, JSON.stringify(r.body)); await finish() }

const browser = await launchBrowser({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] }); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
// Every start of a piece of audio, with how far ahead of the audio clock it was asked for (under 0: late, and heard late).
await ctx.addInitScript(() => {
  const starts = []; window.__perfStarts = starts
  const orig = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) { if (!(this.context instanceof OfflineAudioContext)) starts.push({ at: performance.now(), lead: (when - this.context.currentTime) * 1000 }); return orig.call(this, when, ...rest) }
})
const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await page.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
// The memory of the processes drawing pages, from the system (Chromium on Linux only).
const rss = async () => { try { const cdp = await browser.newBrowserCDPSession(); const { processInfo } = await cdp.send('SystemInfo.getProcessInfo'); await cdp.detach(); let kb = 0; for (const p of processInfo.filter((x) => x.type === 'renderer')) kb += Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${p.id}/status`, 'utf8'))?.[1] ?? 0); return kb ? Math.round(kb / 1024) : null } catch { return null } }
const heap = () => page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null))
const before = { rss_mb: await rss(), heap_mb: await heap() }

console.log('-- opening')
let t0 = Date.now()
await page.goto(`${WEB}/channels/${g.id}/${st.id}`)
await page.waitForSelector('[data-daw]'); const shown = Date.now() - t0
await page.waitForFunction((n) => window.__parleyDaw?.decoded >= n, TRACKS, { timeout: 300_000, polling: 250 }).catch(() => {})
const decoded = await page.evaluate(() => window.__parleyDaw?.decoded ?? 0); const ready = Date.now() - t0
await page.waitForSelector(`[data-daw-clip="${last}"] [data-daw-wave="1"]`, { timeout: 120_000 }).catch(() => {})
const drawn = Date.now() - t0
const loaded = { rss_mb: await rss(), heap_mb: await heap() }

// Frames drawn over a stretch of time, and the longest wait for one.
const frames = (ms) => page.evaluate((ms) => new Promise((done) => { let n = 0, worst = 0, long = 0, prev = performance.now(); const from = prev; const f = (t) => { const d = t - prev; prev = t; n++; if (d > worst) worst = d; if (d > 50) long++; if (t - from >= ms) done({ fps: Math.round((n * 1000) / (t - from) * 10) / 10, worst_ms: Math.round(d > worst ? d : worst), over_50ms: long }); else requestAnimationFrame(f) }; requestAnimationFrame(f) }), ms)
const idle = await frames(5000)

console.log('-- playing')
await page.click('[data-daw-rtz]')
const pressed = await page.evaluate(() => { window.__perfStarts.length = 0; const t = performance.now(); document.querySelector('[data-daw-play]').click(); return t })
await page.waitForFunction(() => !!window.__parleyDaw?.playing, null, { timeout: 15000 }).catch(() => {})
const first = await page.evaluate((t) => { const c = window.__parleyDawTest.context(); const s = window.__perfStarts.filter((x) => x.at >= t); if (!s.length) return null; return { handler_ms: s[0].at - t, lead_ms: Math.min(...s.map((x) => x.lead)), output_ms: ((c.outputLatency || 0) + (c.baseLatency || 0)) * 1000, starts: s.length, late: s.filter((x) => x.lead < 0).length } }, pressed)
const playing = await frames(10_000)
const live = { rss_mb: await rss(), heap_mb: await heap() }
await page.click('[data-daw-play]'); await page.waitForFunction(() => !window.__parleyDaw?.playing, null, { timeout: 5000 }).catch(() => {})

console.log('-- looping (2 s, for 20 s)')
r = await callS(a.token, 'POST', `/studio/projects/${P.id}/ops`, { ops: [{ op: 'project', loop_on: true }] })
await page.waitForTimeout(800)
await page.evaluate(() => { window.__perfStarts.length = 0; document.querySelector('[data-daw-play]').click() })
await page.waitForTimeout(20_000)
const loop = await page.evaluate(() => { const s = window.__perfStarts.slice(); const leads = s.map((x) => x.lead); return { playing: window.__parleyDaw?.playing ?? null, starts: s.length, late: s.filter((x) => x.lead < 0).length, least_lead_ms: s.length ? Math.min(...leads) : null } })
await page.click('[data-daw-play]'); await page.waitForTimeout(500)
await callS(a.token, 'POST', `/studio/projects/${P.id}/ops`, { ops: [{ op: 'project', loop_on: false }] }); await page.waitForTimeout(800)

console.log('-- rendering')
const render = await page.evaluate(async () => { const t = performance.now(); const b = await window.__parleyDawTest.render(); return { ms: Math.round(performance.now() - t), seconds: Math.round(b.length / b.sampleRate * 10) / 10 } }).catch((e) => ({ error: String(e?.message ?? e) }))
const after = { rss_mb: await rss(), heap_mb: await heap() }

const report = {
  browser: BROWSER, at: new Date().toISOString(),
  project: { tracks: TRACKS, minutes: MINUTES, clips: clips.length, effects: 8 },
  open: { daw_shown_ms: shown, audio_decoded_ms: ready, decoded_files: decoded, waveforms_drawn_ms: drawn },
  frames: { idle, playing },
  // From pressing play to sound: the page's own work, then how far ahead the audio was scheduled, then the device.
  play_to_sound_ms: first && { total: r2(first.handler_ms + first.lead_ms + first.output_ms), handler: r2(first.handler_ms), scheduled_ahead: r2(first.lead_ms), output: r2(first.output_ms), late_starts: first.late, starts: first.starts },
  loop: loop && { ...loop, least_lead_ms: loop.least_lead_ms === null ? null : r2(loop.least_lead_ms) },
  render: render.error ? render : { ...render, times_real_time: r2(render.seconds / (render.ms / 1000)) },
  // What the decoded audio alone takes as the engine holds it today (32-bit float; one channel per mono file).
  decoded_pcm_mb_at_least: Math.round((TRACKS * MINUTES * 60 * 48000 * 4) / 1048576),
  memory: { before, loaded, playing: live, after_render: after },
  page_errors: errors,
}
console.log(JSON.stringify(report, null, 2))
writeFileSync(join(out, 'studioperf.json'), JSON.stringify(report, null, 2))
await browser.close()
await finish()
