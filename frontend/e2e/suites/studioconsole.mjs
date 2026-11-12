// A project's console (the DAW) for its band: there before joining voice, shared record-arm on the lanes, punch in /
// out during a take, late joiners, tempo / metronome / count-in, band vs audience, and hiding / showing it.
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol'); const d = await reg('dave')
const g = await call(a.token, 'POST', '/guilds', { name: `Console ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, c, d]) await call(u.token, 'POST', `/invites/${inv.code}`)
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'console', kind: 'studio' })).body
const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Console Song' })).body
const st = await call(a.token, 'GET', `/channels/${P.channel_id}`)
const sessions = async () => call(a.token, 'GET', `/channels/${st.id}/studio/sessions`)
const chan = async () => call(a.token, 'GET', `/channels/${st.id}`)

console.log('-- config API')
let cfg0 = (await chan()).studio
ok('a new project has its own console settings', cfg0.bpm === 120 && cfg0.beats === 4 && cfg0.disarmed.length === 0 && cfg0.project_id === P.id, JSON.stringify(cfg0))
let r = await raw(b.token, 'PATCH', `/channels/${st.id}/studio/config`, { bpm: 90 }); ok('only the crew sets the tempo', r.status === 403)
r = await raw(a.token, 'PATCH', `/channels/${st.id}/studio/config`, { bpm: 20 }); ok('tempo is bounded', r.status === 400)
r = await raw(b.token, 'PUT', `/channels/${st.id}/studio/arm/${b.user.id}`, { armed: false }); ok('only the crew arms', r.status === 403)
for (const u of [b, c]) await call(a.token, 'PUT', `/channels/${st.id}/studio/role/${u.user.id}`, { role: 'artist' })
// A lane per band member, so the arm buttons are there before the first take.
const lane = {}
for (const u of [a, b, c]) lane[u.user.id] = crypto.randomUUID()
r = await callS(a.token, 'POST', `/studio/projects/${P.id}/ops`, { ops: [a, b, c].map((u, i) => ({ op: 'lane.put', lane: { id: lane[u.user.id], name: u.user.username, position: i, user_id: u.user.id } })) })
ok('the band gets a lane each', r.status === 200, JSON.stringify(r.body))

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const open = async (tok) => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(`${WEB}/channels/${g.id}/${st.id}`); return p }
const join = async (p) => { await p.click('[data-project-join]'); await p.waitForSelector('[data-voice-leave]') }
const recording = (p) => p.evaluate(() => window.__parleyStudio?.recording === true)
const waitRec = (p, on) => p.waitForFunction((on) => (window.__parleyStudio?.recording === true) === on, on, { timeout: 15000 })

console.log('-- band and audience')
const pa = await open(a.token); await pa.waitForSelector('[data-daw]')
ok('the band has the console before joining voice, with Join session in the header', await pa.locator('[data-project-join]').count() === 1 && await pa.locator('[data-voice-leave]').count() === 0)
const pd = await open(d.token); await pd.waitForSelector('text=Join Voice')
ok('someone outside the band gets the pre-join screen, no console', await pd.locator('[data-daw]').count() === 0)
await join(pa)
const pb = await open(b.token); await pb.waitForSelector('[data-daw]'); await join(pb)
const pc = await open(c.token); await pc.waitForSelector('[data-daw]'); await join(pc)
await pd.click('text=Join Voice'); await pd.waitForSelector('[data-voice-leave]')
await pa.waitForSelector(`[data-voice-tile="${b.user.id}"]`); await pa.waitForSelector(`[data-audience="${d.user.id}"]`)
ok('the band joins heard (engineer and artist badges), others join as the audience', await pa.locator(`[data-voice-tile="${a.user.id}"] [data-engineer-badge]`).count() === 1 && await pa.locator(`[data-voice-tile="${b.user.id}"] [data-artist-badge]`).count() === 1 && await pa.locator(`[data-voice-tile="${d.user.id}"]`).count() === 0)

console.log('-- record-arm')
await pa.waitForSelector(`[data-daw-arm="${lane[c.user.id]}"]`)
ok('every band member\'s lane has an arm button, armed by default', await pa.locator('[data-daw-arm][aria-pressed="true"]').count() === 3)
ok('only the crew can press it', await pb.locator(`[data-daw-arm="${lane[b.user.id]}"]`).isDisabled())
await pa.click(`[data-daw-arm="${lane[c.user.id]}"]`)
await pb.waitForFunction((id) => document.querySelector(`[data-daw-arm="${id}"]`)?.getAttribute('aria-pressed') === 'false', lane[c.user.id])
ok('disarming carol is shared studio state', (await chan()).studio.disarmed.includes(c.user.id))

console.log('-- tempo, metronome, count-in')
await pa.fill('[data-daw-bpm]', '150'); await pa.press('[data-daw-bpm]', 'Enter')
await pa.selectOption('[data-daw-countin]', '1')
await pa.click('[data-daw-click]')
await pa.waitForFunction(() => document.querySelector('[data-daw-click]')?.getAttribute('aria-pressed') === 'true')
let cfg = (await chan()).studio
ok('tempo, metronome and count-in are saved for the project', cfg.bpm === 150 && cfg.click === true && cfg.count_in === 1, JSON.stringify(cfg))
ok('the project keeps the tempo', (await call(a.token, 'GET', `/studio/projects/${P.id}`)).project.bpm === 150)

await pa.click('[data-daw-rtz]'); await pa.click('[data-daw-record]')
await pa.waitForSelector('[data-daw][data-daw-state="count-in"]', { timeout: 5000 })
await pb.waitForFunction(() => (window.__parleyClick?.ticks ?? 0) > 0, null, { timeout: 5000 })
ok('record counts in and the band hears the click', await pb.evaluate(() => window.__parleyClick.running === true))
await pa.waitForSelector('[data-daw][data-daw-state="recording"]', { timeout: 5000 })
await waitRec(pb, true)
ok('armed members record, the disarmed one does not', await recording(pa) && !(await recording(pc)))
let live = (await sessions())[0]
ok('the take keeps its tempo and count-in', live.bpm === 150 && live.click && live.count_in_ms === 1600 && live.tracks.length === 2 && live.project_id === P.id, JSON.stringify(live))
r = await raw(c.token, 'POST', `/studio/sessions/${live.id}/tracks`, {}); ok('an unarmed artist cannot add a track', r.status === 400)
r = await raw(d.token, 'POST', `/studio/sessions/${live.id}/tracks`, {}); ok('the audience cannot add a track', r.status === 403)

console.log('-- punch in / out, late joiner')
await pa.click(`[data-daw-arm="${lane[c.user.id]}"]`)
await waitRec(pc, true)
ok('arming carol mid-take punches her in', true)
await pa.click(`[data-daw-arm="${lane[b.user.id]}"]`)
await waitRec(pb, false)
ok('disarming bob punches him out', true)
await pa.waitForTimeout(500)
await pa.click(`[data-daw-arm="${lane[b.user.id]}"]`)
await waitRec(pb, true)
await call(a.token, 'PUT', `/channels/${st.id}/studio/role/${d.user.id}`, { role: 'artist' })
await waitRec(pd, true)
ok('someone who joins the band mid-take is punched in', (await chan()).artist_ids.includes(d.user.id))
await pa.waitForTimeout(5600)   // > one chunk for the late clips
await pa.screenshot({ path: '219-console-punch.png' })
await pa.click('[data-daw-record]')
await pa.waitForFunction(() => !['recording', 'count-in'].includes(document.querySelector('[data-daw]')?.getAttribute('data-daw-state')))
let done
for (let i = 0; i < 40; i++) { done = (await sessions())[0]; if (done.ended_at && done.tracks.every((t) => t.done)) break; await pa.waitForTimeout(500) }
const per = (u) => done.tracks.filter((t) => t.user_id === u.user.id).length
ok('bob has two clips, carol and dave one each', per(b) === 2 && per(c) === 1 && per(d) === 1 && per(a) === 1, JSON.stringify(done.tracks.map((t) => [t.display_name, t.offset_ms, t.duration_ms])))
let proj
for (let i = 0; i < 20; i++) { proj = await call(a.token, 'GET', `/studio/projects/${P.id}`); if (proj.clips.length >= done.tracks.filter((t) => (t.duration_ms ?? 0) > 0).length) break; await pa.waitForTimeout(500) }
ok('the takes land on the band\'s lanes, dave on a new one', proj.clips.filter((x) => x.lane_id === lane[b.user.id]).length === 2 && proj.lanes.some((l) => l.user_id === d.user.id), JSON.stringify(proj.lanes.map((l) => [l.name, proj.clips.filter((x) => x.lane_id === l.id).length])))

console.log('-- toggle')
await pa.click('[data-console-close]'); await pa.waitForFunction(() => !document.querySelector('[data-daw]'))
ok('closing returns to the band view', await pa.locator(`[data-voice-tile="${b.user.id}"]`).count() === 1)
await pa.click('[data-studio-console-toggle]'); await pa.waitForSelector('[data-daw]')
ok('the header button opens it again', true)
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
