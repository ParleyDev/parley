// What becomes of a take when things go wrong on its way to the server. The recorder's input is known noise going
// round (see `studioInput('hum')` and `humCheck`), so a take that lost a piece, got one twice or has them out of order
// is told from a whole one sample by sample, not by its length.
//
// The faults: the pieces of a take refused for 20 s; held back; sent twice; taken by the server with the answer lost;
// the network gone for 20 s; the page closed in the middle of a take and opened again; closed and never opened again;
// and (when STUDIO_RESTART_CMD says how, e.g. `docker restart parley-inv-test`) the server restarted during a take.
import { execSync } from 'node:child_process'
import { WEB, B, S, IP, reg, call, callS, raw, ok, finish, launchBrowser, chromiumOnly } from '../lib.mjs'
import { wavFile, parseWav, bursts, studioInput, humCheck } from '../audio.mjs'

await chromiumOnly('needs a voice room and a microphone')

const RESTART = process.env.STUDIO_RESTART_CMD
const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Takes ${S}` })
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'takes', kind: 'studio' })).body
const project = async (name) => {
  const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name, bpm: 120 })).body
  const st = await call(a.token, 'GET', `/channels/${P.channel_id}`)
  const backing = await (await fetch(`${B}/channels/${st.id}/studio/audio?name=bursts.wav&duration_ms=2000`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/wav', 'X-Forwarded-For': IP }, body: wavFile({ seconds: 2, signal: bursts([500]) }) })).json()
  const LB = crypto.randomUUID(), CB = crypto.randomUUID()
  await callS(a.token, 'POST', `/studio/projects/${P.id}/ops`, { ops: [{ op: 'lane.put', lane: { id: LB, name: 'Backing', position: 0 } }, { op: 'clip.put', clip: { id: CB, lane_id: LB, audio_id: backing.id, start_ms: 0, length_ms: 2000 } }] })
  return { P, st, CB, seen: new Set([backing.id]), full: () => call(a.token, 'GET', `/studio/projects/${P.id}`), sessions: () => call(a.token, 'GET', `/channels/${st.id}/studio/sessions`) }
}
const browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const newContext = async () => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] }); await ctx.addInitScript(studioInput, 'hum'); return ctx }
/** The project open in a page; in its voice room unless told not to join. */
const open = async (ctx, pr, join = true) => {
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${WEB}/login`); await page.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
  await page.goto(`${WEB}/channels/${g.id}/${pr.st.id}`)
  if (join) { const j = page.locator('[data-project-join]').or(page.getByText('Join Voice', { exact: true })).first(); await j.waitFor(); await j.click(); await page.waitForSelector('[data-voice-leave]') }
  await page.waitForSelector(`[data-daw-clip="${pr.CB}"] [data-daw-wave="1"]`, { timeout: 20000 })
  return page
}
const start = async (page) => {
  await page.click('[data-daw-rtz]'); await page.click('[data-daw-record]')
  const on = await page.waitForFunction(() => window.__parleyStudio?.recording === true, null, { timeout: 15000 }).then(() => true, () => false)
  return on ? Date.now() : 0
}
/** The new take of the project once the server has all of it: its clip, its record, its samples. */
const landed = async (pr, waitMs = 40000) => {
  let f = null, clip = null, audio = null
  for (const until = Date.now() + waitMs; Date.now() < until && !(clip && audio?.done);) {
    f = await pr.full(); clip = f.clips.find((c) => c.audio_id && !pr.seen.has(c.audio_id) && !c.muted); audio = clip && f.audio.find((x) => x.id === clip.audio_id)
    if (!(clip && audio?.done)) await new Promise((r) => setTimeout(r, 500))
  }
  if (!clip || !audio) return null
  pr.seen.add(clip.audio_id)
  const r = await fetch(`${B}/studio/tracks/${audio.id}`, { headers: { Authorization: `Bearer ${a.token}`, 'X-Forwarded-For': IP } })
  const bytes = Buffer.from(await r.arrayBuffer()), wav = bytes.toString('latin1', 0, 4) === 'RIFF' ? parseWav(bytes) : null
  return { clip, audio, wav, x: wav?.samples[0] ?? new Float32Array(0), header: !!wav && wav.dataSize === bytes.length - 44 }
}
/** Whole: every sample in its place (a little silence where the browser did not run the recorder), as long as it
 * was recorded, and saying so. */
const whole = (t, secs, slack = 1.2) => {
  if (!t) return { ok: false, why: 'no take' }
  const h = humCheck(t.x), len = t.x.length / 48000
  const good = h.phase >= 0 && h.wrong === 0 && h.silent <= 4096 && Math.abs(len - secs) < slack && t.header && Math.abs(t.audio.duration_ms - len * 1000) <= 1 && t.clip.length_ms >= t.audio.duration_ms - t.clip.in_ms - 2
  return { ok: good, why: JSON.stringify({ ...h, secs: Math.round(len * 100) / 100, wanted: Math.round(secs * 100) / 100, header: t.header, said_ms: t.audio.duration_ms, clip: [t.clip.start_ms, t.clip.in_ms, t.clip.length_ms] }) }
}
const chunks = '**/api/studio/sessions/*/tracks/*/chunks?*'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const idle = (page) => page.waitForFunction(() => !window.__parleyStudio?.recording && !window.__parleyDaw?.playing, null, { timeout: 8000 }).catch(() => {})

// ---- never opened again (checked at the end: the server has to notice) -------------------------------------------
const gone = await project('Gone')
let goneAt = 0, goneSession = null
{
  const ctx = await newContext(), page = await open(ctx, gone)
  ok('a take is started by someone who will not be back', !!(await start(page)))
  await wait(5000)
  goneSession = (await gone.sessions()).find((s) => !s.ended_at)
  ok('it is live, with their track', !!goneSession && goneSession.tracks.length === 1, JSON.stringify(goneSession))
  // Gone, with no chance to say so: nothing more is sent from here on.
  await ctx.route('**/api/**', (r) => r.abort()); await ctx.close()
  goneAt = Date.now()
}

const pr = await project('Faults')
const ctx = await newContext()
let page = await open(ctx, pr)

// ---- the pieces refused for 20 s ---------------------------------------------------------------------------------
{
  let refused = 0
  const t0 = await start(page)
  await wait(3000)
  await page.route(chunks, (r) => { refused++; return r.abort() })
  await wait(20000)
  const behind = await page.evaluate(() => window.__parleyStudio?.recording === true)
  await page.unroute(chunks)
  await wait(3000)
  await page.click('[data-daw-record]'); const secs = (Date.now() - t0) / 1000
  const t = await landed(pr), w = whole(t, secs)
  ok('recording went on while the server could not be reached', behind && refused >= 3, `${refused} requests refused`)
  ok(`a take whose pieces were refused for 20 s is whole (${Math.round(secs)} s)`, w.ok, w.why)
  await idle(page)
}
// ---- held back, sent twice, the answer lost ---------------------------------------------------------------------
for (const [name, fault] of [
  ['held back 3 s each', async (r) => { await wait(3000); await r.continue().catch(() => {}) }],
  ['sent twice', async (r) => { await r.fetch().catch(() => {}); await r.continue().catch(() => {}) }],
  ['taken with the answer lost', async (r) => { await r.fetch().catch(() => {}); await r.abort().catch(() => {}) }],
]) {
  let n = 0
  // Every other request, so the take does get through.
  await page.route(chunks, (r) => (n++ % 2 === 0 ? fault(r) : r.continue()))
  const t0 = await start(page)
  await wait(7000)
  await page.click('[data-daw-record]'); const secs = (Date.now() - t0) / 1000
  const t = await landed(pr), w = whole(t, secs)
  await page.unroute(chunks)
  ok(`a take whose pieces were ${name} is whole (${n} requests)`, w.ok && n >= 2, w.why)
  await idle(page)
}
// ---- the network gone for 20 s ----------------------------------------------------------------------------------
{
  const t0 = await start(page)
  await wait(3000)
  await ctx.setOffline(true)
  await wait(20000)
  const still = await page.evaluate(() => window.__parleyStudio?.recording === true)
  await ctx.setOffline(false)
  // Back in the room, and the take still running.
  await page.waitForFunction(() => window.__parleyStudio?.recording === true, null, { timeout: 20000 }).catch(() => {})
  await wait(5000)
  const live = (await pr.sessions()).find((s) => !s.ended_at)
  if (live) await page.click('[data-daw-record]')
  const secs = (Date.now() - t0) / 1000
  const t = await landed(pr, 60000), w = whole(t, secs, 3)
  ok('recording went on with the network gone', still)
  ok(`a take with the network gone for 20 s is whole (${Math.round(secs)} s)`, w.ok, w.why)
  await idle(page)
}
// ---- the server restarted ---------------------------------------------------------------------------------------
if (RESTART) {
  const t0 = await start(page)
  await wait(3000)
  execSync(RESTART, { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) { if (await fetch(`${B}/users/@me`, { headers: { Authorization: `Bearer ${a.token}`, 'X-Forwarded-For': IP } }).then((r) => r.ok, () => false)) break; await wait(500) }
  await wait(6000)
  const live = (await pr.sessions()).find((s) => !s.ended_at)
  if (live) await page.click('[data-daw-record]')
  const secs = (Date.now() - t0) / 1000
  const t = await landed(pr, 60000), w = whole(t, secs, 3)
  ok(`a take recorded across a restart of the server is whole (${Math.round(secs)} s)`, w.ok, w.why)
  await idle(page)
} else console.log('  (server restart not tried: set STUDIO_RESTART_CMD)')

// ---- the page closed in the middle of a take, and opened again --------------------------------------------------
{
  const t0 = await start(page)
  await wait(3000)
  // Nothing more reaches the server: what is recorded from here is only on this device.
  let cut = true
  await ctx.route(chunks, (r) => (cut ? r.abort() : r.continue()))
  await wait(5000)
  // Another page keeps the browser's context while this one goes.
  const other = await ctx.newPage()
  page.on('dialog', (d) => d.accept().catch(() => {}))
  const closed = page.waitForEvent('close', { timeout: 10000 }).catch(() => {})
  await page.close({ runBeforeUnload: true }); await closed; const secs = (Date.now() - t0) / 1000
  cut = false
  const before = (await pr.full()).clips.filter((c) => c.audio_id && !pr.seen.has(c.audio_id)).length
  // Back later, not in the room, touching nothing. The take it left has been ended by then (one still running would
  // go on recording into the armed track as soon as the project is open again).
  await wait(12000)
  for (const x of await pr.sessions()) if (!x.ended_at) await callS(a.token, 'POST', `/channels/${pr.st.id}/studio/sessions/${x.id}/stop`, {})
  page = await open(ctx, pr, false); await other.close()
  const t = await landed(pr, 60000), w = whole(t, secs, 1.5)
  ok('nothing of it was in the project while the page was away', before === 0)
  ok(`a take whose page closed is sent when the app is next opened, whole, and placed (${Math.round(secs)} s)`, w.ok, w.why)
  const count = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('parley-takes'); r.onsuccess = () => { const q = r.result.transaction('takes').objectStore('takes').count(); q.onsuccess = () => { r.result.close(); res(q.result) } }; r.onerror = () => res(-1) }))
  // Dropped once the server has said it has all of it: a moment after the take is in the project.
  let kept = await count()
  for (let i = 0; i < 60 && kept !== 0; i++) { await wait(500); kept = await count() }
  const left = kept ? await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('parley-takes'); r.onsuccess = () => { const q = r.result.transaction('takes').objectStore('takes').getAll(); q.onsuccess = () => { r.result.close(); res(q.result) } }; r.onerror = () => res(null) })) : null
  ok('and is no longer kept on the device', kept === 0, JSON.stringify({ left, now: Date.now(), take: t?.audio }))
}
await ctx.close()

// ---- never opened again: the server ends the take and keeps what it has ------------------------------------------
{
  let s = null
  for (;;) { s = (await gone.sessions()).find((x) => x.id === goneSession?.id); if (!s || s.ended_at || Date.now() - goneAt > 80000) break; await wait(2000) }
  const ended = s?.ended_at ? (Date.parse(s.ended_at) - goneAt) / 1000 : null
  ok(`a take left by its starter is ended by the server (${ended === null ? 'never' : Math.round(ended) + ' s'} after)`, ended !== null && ended < 75, JSON.stringify(s))
  // Nobody is in the room now, so the next take is turned away for that (400), not for a take in progress (409).
  const r = await raw(a.token, 'POST', `/channels/${gone.st.id}/studio/sessions`, { name: 'next' })
  const said = r.ok ? null : await r.json().catch(() => null)
  ok('and no longer stops the next take from starting', r.ok || (r.status === 400 && /Join the session/.test(said?.error ?? '')), `${r.status} ${JSON.stringify(said)}`)
  if (r.ok) await raw(a.token, 'POST', `/channels/${gone.st.id}/studio/sessions/${(await r.json()).id}/stop`)
  const t = await landed(gone, Math.max(1000, 115000 - (Date.now() - goneAt)))
  const h = t ? humCheck(t.x) : null, len = t ? t.x.length / 48000 : 0
  ok(`what the server had of it becomes a take in the project (${Math.round(len * 10) / 10} s), each sample in its place`, !!t && t.audio.done && h.phase >= 0 && h.wrong === 0 && len > 2 && len < 6.5, JSON.stringify(h))
  ok('with a true header and its length told from its size', !!t && t.header && Math.abs(t.audio.duration_ms - len * 1000) <= 1, JSON.stringify(t?.audio))
}

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
