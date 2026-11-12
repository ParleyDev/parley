// The studio's DAW: projects (one open for everyone in the studio), lanes and clips edited live by the whole band
// (ops applied by the server and broadcast), audio imports, the timeline (drag, split, undo), the mixer, recording a
// take over the project (everyone hears the project as the backing; each member's take lands on their lane,
// latency compensated) and export.
import { chromium } from 'playwright'
import { WEB, B, S, IP, reg, call, callS, raw, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob'); const d = await reg('dave')
const g = await call(a.token, 'POST', '/guilds', { name: `DAW ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, d]) await call(u.token, 'POST', `/invites/${inv.code}`)
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'daw', kind: 'studio' })).body
let st = null
const chan = () => call(a.token, 'GET', `/channels/${st.id}`)
const full = (pid) => call(a.token, 'GET', `/studio/projects/${pid}`)
const ops = (tok, pid, list) => callS(tok, 'POST', `/studio/projects/${pid}/ops`, { ops: list })

/** A mono 8 kHz 8-bit WAV of `sec` seconds: a pulse every half second, so it has a waveform and a level. */
const wav = (sec) => {
  const n = 8000 * sec; const buf = Buffer.alloc(44 + n)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40)
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round((i % 4000 < 1500 ? 100 : 15) * Math.sin(i / 3))
  return buf
}
const importAudio = (tok, name, body, dur, type = 'audio/wav') => fetch(`${B}/channels/${st.id}/studio/audio?name=${encodeURIComponent(name)}&duration_ms=${dur}`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': type, 'X-Forwarded-For': IP }, body })

console.log('-- projects')
// Starting a project needs Create Projects on the studio (bit 32): take it from @everyone here.
await callS(a.token, 'PUT', `/channels/${studio.id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: 2 ** 32 })
let r = await callS(d.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Nope' })
ok('without Create Projects nobody starts a project', r.status === 403)
r = await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'First Song', bpm: 100 })
const P = r.body
st = r.status === 201 ? await call(a.token, 'GET', `/channels/${P.channel_id}`) : null
ok('the owner starts a project: its own channel under the studio, at its tempo, with her as its engineer', r.status === 201 && P.bpm === 100 && st?.kind === 'project' && st.parent_id === studio.id && st.studio.project_id === P.id && st.engineer_ids.includes(a.user.id), JSON.stringify(r.body))
ok('the studio lists it', (await call(d.token, 'GET', `/channels/${studio.id}/studio/projects`)).some((x) => x.id === P.id))

console.log('-- import and ops')
r = await importAudio(a.token, 'notes.txt', Buffer.from('hello'), 0, 'text/plain')
ok('only audio can be imported', r.status === 400)
r = await importAudio(d.token, 'beat.wav', wav(1), 1000)
ok('only editors import', r.status === 403)
r = await importAudio(a.token, 'Beat.wav', wav(4), 4000)
const beat = await r.json()
ok('an imported file is studio audio', r.status === 201 && beat.kind === 'import' && beat.name === 'Beat.wav' && beat.duration_ms === 4000 && beat.session_id === null, JSON.stringify(beat))
ok('it is served to the studio', (await raw(d.token, 'GET', `/studio/tracks/${beat.id}`)).status === 200)
const L1 = crypto.randomUUID(), C1 = crypto.randomUUID()
r = await ops(a.token, P.id, [{ op: 'lane.put', lane: { id: L1, name: 'Beat', position: 0 } }, { op: 'clip.put', clip: { id: C1, lane_id: L1, audio_id: beat.id, start_ms: 0, length_ms: 9000 } }])
ok('a clip cannot run past the end of its audio (and the whole change is refused)', r.status === 400 && (await full(P.id)).lanes.length === 0, JSON.stringify(r.body))
r = await ops(a.token, P.id, [{ op: 'lane.put', lane: { id: L1, name: 'Beat', position: 0 } }, { op: 'clip.put', clip: { id: C1, lane_id: L1, audio_id: beat.id, start_ms: 0, length_ms: 4000 } }])
ok('a lane and a clip in one change', r.status === 200 && r.body.version === P.version + 1 && r.body.ops.length === 2, JSON.stringify(r.body))
r = await ops(a.token, P.id, [{ op: 'clip.put', clip: { id: C1, fade_in_ms: 500, gain: 0.5 } }])
const f1 = await full(P.id)
ok('a put changes only what it names', f1.clips[0].fade_in_ms === 500 && f1.clips[0].gain === 0.5 && f1.clips[0].length_ms === 4000 && f1.audio.length === 1)
r = await ops(d.token, P.id, [{ op: 'clip.del', id: C1 }])
ok('the audience cannot edit', r.status === 403)
r = await ops(a.token, P.id, [{ op: 'project', bpm: 128 }])
ok('the project\'s tempo is the studio\'s metronome', r.status === 200 && (await chan()).studio.bpm === 128)
await call(a.token, 'PATCH', `/channels/${st.id}/studio/config`, { bpm: 120 })
ok('and the console\'s tempo is the project\'s', (await full(P.id)).project.bpm === 120)

console.log('-- live co-editing')
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const mk = async (tok) => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'], acceptDownloads: true }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(`${WEB}/channels/${g.id}/${st.id}`); const join = p.locator('[data-project-join]').or(p.getByText('Join Voice', { exact: true })).first(); await join.waitFor(); await join.click(); await p.waitForSelector('[data-voice-leave]'); return p }
const pa = await mk(a.token); const pb = await mk(b.token)
await call(a.token, 'PUT', `/channels/${st.id}/studio/role/${b.user.id}`, { role: 'artist' })
await pa.waitForSelector('[data-daw]')
await pb.waitForSelector('[data-daw]', { timeout: 10000 }).catch(() => {})
ok('with a project open the band gets the DAW, not just the engineer', (await pa.locator('[data-daw-project-name]').textContent()) === 'First Song' && await pb.locator('[data-daw]').count() === 1)
await pa.waitForSelector(`[data-daw-clip="${C1}"] [data-daw-wave="1"]`, { timeout: 15000 }).catch(() => {})
ok('the clip shows its waveform', await pa.locator(`[data-daw-clip="${C1}"] [data-daw-wave="1"]`).count() === 1)
await pa.locator('[data-daw-zoom-in]').click()
const box = await pa.locator(`[data-daw-clip="${C1}"]`).boundingBox()
await pa.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await pa.mouse.down(); await pa.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 6 }); await pa.mouse.up()
await pa.waitForTimeout(600)
let moved = (await full(P.id)).clips[0].start_ms
ok('dragging a clip moves it, snapped to the beat (500 ms at 120 BPM)', moved > 0 && moved % 500 === 0, String(moved))
await pb.waitForFunction(([id, x]) => Math.abs(document.querySelector(`[data-daw-clip="${id}"]`)?.getBoundingClientRect().x - x) < 400 && document.querySelector(`[data-daw-clip="${id}"]`).style.left !== '0px', [C1, box.x], { timeout: 5000 }).catch(() => {})
ok('bob sees it move', (await pb.locator(`[data-daw-clip="${C1}"]`).evaluate((e) => e.style.left)) !== '0px')
await pa.keyboard.press('Control+z'); await pa.waitForTimeout(600)
ok('undo puts it back, for everyone', (await full(P.id)).clips[0].start_ms === 0)
await pa.keyboard.press('Control+Shift+z'); await pa.waitForTimeout(600)
ok('redo moves it again', (await full(P.id)).clips[0].start_ms === moved)

// Split at the playhead: click the ruler a little into the clip, select it, press S.
const clipBox = await pa.locator(`[data-daw-clip="${C1}"]`).boundingBox()
const ruler = await pa.locator('[data-daw-ruler]').boundingBox()
await pa.mouse.click(clipBox.x + clipBox.width / 2, ruler.y + ruler.height / 2)
await pa.locator(`[data-daw-clip="${C1}"]`).click({ position: { x: 20, y: 40 } })
await pa.keyboard.press('s'); await pa.waitForTimeout(600)
let cl = (await full(P.id)).clips.sort((x, y) => x.start_ms - y.start_ms)
ok('S splits the clip at the playhead into two that play the same audio', cl.length === 2 && cl[0].start_ms + cl[0].length_ms === cl[1].start_ms && cl[1].in_ms === cl[0].length_ms && cl[0].length_ms + cl[1].length_ms === 4000, JSON.stringify(cl.map((c) => [c.start_ms, c.in_ms, c.length_ms])))
await pb.waitForFunction(() => document.querySelectorAll('[data-daw-clip]').length === 2, null, { timeout: 5000 }).catch(() => {})
ok('bob sees the split', await pb.locator('[data-daw-clip]').count() === 2)
await pa.screenshot({ path: 'daw-arrangement.png' })

await ops(b.token, P.id, [{ op: 'lane.put', lane: { id: L1, name: 'Drums' } }])
await pa.waitForFunction((id) => document.querySelector(`[data-daw-lane-head="${id}"] [data-daw-lane-name]`)?.textContent === 'Drums', L1, { timeout: 5000 }).catch(() => {})
ok('the band edits too: bob renames the lane and alice sees it', (await pa.locator(`[data-daw-lane-head="${L1}"] [data-daw-lane-name]`).textContent()) === 'Drums')

console.log('-- mixer and playback')
await pa.click('[data-daw-view-mixer]'); await pa.waitForSelector('[data-daw-mixer]')
await pa.locator(`[data-console-fader="${L1}"]`).fill('50'); await pa.waitForTimeout(800)
ok('a fader move is shared (sent when it settles)', Math.abs((await full(P.id)).lanes[0].gain - 0.5) < 0.01)
await pa.click('[data-daw-rtz]'); await pa.click('[data-daw-play]')
await pa.waitForFunction(() => ['local', 'shared'].includes(window.__parleyDaw?.playing) && window.__parleyDaw.sources > 0, null, { timeout: 8000 }).catch(() => {})
await pa.waitForFunction(() => Number(document.querySelector('[data-console-meter="master"]')?.dataset.level ?? 0) > 0.02, null, { timeout: 8000 }).catch(() => {})
ok('play schedules every clip and the master meter moves', await pa.evaluate(() => window.__parleyDaw.sources === 2 && Number(document.querySelector('[data-console-meter="master"]')?.dataset.level ?? 0) > 0.02), JSON.stringify(await pa.evaluate(() => window.__parleyDaw)))
await pa.screenshot({ path: 'daw-mixer.png' })
await pa.click('[data-daw-play]')
await pa.click('[data-daw-view-arrange]')

console.log('-- recording over the project')
await pa.click('[data-daw-rtz]')
await pa.click('[data-daw-record]')
await pb.waitForFunction(() => window.__parleyDaw?.playing === 'backing', null, { timeout: 8000 }).catch(() => {})
ok('when a take starts, the band hears the project (the backing)', await pb.evaluate(() => window.__parleyDaw?.playing === 'backing'))
await pb.waitForFunction(() => window.__parleyStudio?.recording === true, null, { timeout: 10000 })
ok('and records over it', true)
await pa.waitForTimeout(3500)
await pa.screenshot({ path: 'daw-recording.png' })
await pa.click('[data-daw-record]')
let f2
for (let i = 0; i < 40; i++) { f2 = await full(P.id); if (f2.lanes.some((l) => l.user_id === b.user.id) && f2.lanes.some((l) => l.user_id === a.user.id) && f2.clips.length >= 4) break; await pa.waitForTimeout(500) }
const bLane = f2.lanes.find((l) => l.user_id === b.user.id)
const bClip = f2.clips.find((c) => c.lane_id === bLane?.id)
const bTake = f2.audio.find((x) => x.id === bClip?.audio_id)
ok('each member\'s take lands on a lane of their own, from where recording started', !!bLane && !!bClip && bClip.start_ms >= 0 && bClip.start_ms < 1500 && bClip.length_ms > 1500, JSON.stringify({ bLane, bClip }))
ok('the take carries the latency it was moved by', bTake && typeof bTake.latency_ms === 'number' && bTake.latency_ms >= 0, JSON.stringify(bTake))
await pb.waitForFunction(() => window.__parleyDaw?.playing !== 'backing', null, { timeout: 5000 }).catch(() => {})
ok('the backing stops with the take', await pb.evaluate(() => window.__parleyDaw?.playing !== 'backing'))
await pa.waitForFunction((id) => !!document.querySelector(`[data-daw-lane-head="${id}"]`), bLane.id, { timeout: 8000 }).catch(() => {})
ok('the new lanes and clips show up', await pa.locator(`[data-daw-lane-head="${bLane.id}"]`).count() === 1)

console.log('-- recording onto a chosen track')
const L2 = crypto.randomUUID()
await ops(a.token, P.id, [{ op: 'lane.put', lane: { id: L2, name: 'Overdub', position: 50 } }])
await pb.waitForSelector(`[data-daw-rec-here="${L2}"]`, { timeout: 8000 }).catch(() => {})
ok('your own track shows as where your takes land', await pb.locator(`[data-daw-rec-here="${bLane.id}"][aria-pressed="true"]`).count() === 1)
await pb.click(`[data-daw-rec-here="${L2}"]`)
await pb.waitForSelector(`[data-daw-rec-here="${L2}"][aria-pressed="true"]`, { timeout: 5000 }).catch(() => {})
ok('a band member picks another track to record on', await pb.locator(`[data-daw-rec-here="${L2}"][aria-pressed="true"]`).count() === 1 && (await full(P.id)).lanes.find((l) => l.id === L2)?.user_id === b.user.id)
await pa.click('[data-daw-rtz]')
await pa.click('[data-daw-record]')
await pb.waitForFunction(() => window.__parleyStudio?.recording === true, null, { timeout: 10000 }).catch(() => {})
await pa.waitForTimeout(2500)
await pa.click('[data-daw-record]')
let f3
for (let i = 0; i < 40; i++) { f3 = await full(P.id); if (f3.clips.some((c) => c.lane_id === L2)) break; await pa.waitForTimeout(500) }
ok('the next take lands on the chosen track, not on the first one', f3.clips.some((c) => c.lane_id === L2) && f3.clips.filter((c) => c.lane_id === bLane.id).length === f2.clips.filter((c) => c.lane_id === bLane.id).length, JSON.stringify(f3.clips.map((c) => c.lane_id)))

console.log('-- export, sessions, close')
await pa.click('[data-daw-export-open]'); await pa.click('[data-daw-export-mix]')
await pa.waitForFunction(() => (window.__parleyDawExport ?? 0) > 44, null, { timeout: 30000 }).catch(() => {})
ok('export renders the project to a WAV', await pa.evaluate(() => (window.__parleyDawExport ?? 0) > 1000))
const sess = (await call(a.token, 'GET', `/channels/${st.id}/studio/sessions`)).find((x) => x.tracks.some((t) => t.id === bTake.id))
ok('the take is also in Sessions, recorded into the project', sess.project_id === P.id && sess.position_ms === 0)
r = await raw(a.token, 'DELETE', `/channels/${st.id}/studio/sessions/${sess.id}`)
ok('deleting the session keeps the takes the project uses', r.status === 204 && (await raw(a.token, 'GET', `/studio/tracks/${bTake.id}`)).status === 200 && (await full(P.id)).clips.length === f3.clips.length)
r = await raw(b.token, 'DELETE', `/studio/projects/${P.id}`)
ok('deleting a project needs Delete Projects (an artist has not)', r.status === 403)
r = await raw(a.token, 'DELETE', `/studio/projects/${P.id}`)
ok('the owner can: the project, its channel and its audio go', r.status === 204 && (await call(a.token, 'GET', `/channels/${studio.id}/studio/projects`)).length === 0 && (await raw(a.token, 'GET', `/channels/${st.id}`)).status === 404 && (await raw(a.token, 'GET', `/studio/tracks/${beat.id}`)).status === 404)

ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
