// A project worked on by several people at once: an engineer (a), two artists (b, c) and a listener (d).
//
// Edits to the same list from two people are both kept (notes of one clip, points of one automation, the effects of
// one track, the markers), also when one of them was offline and built on what they had; an undo leaves what someone
// else changed since, and says so; what one deleted is not brought back by the other's edit; solo is each person's own
// and is in nothing shared or exported; a protected track is its owner's and the crew's; the listener reads, follows
// the playback and comments, and edits nothing; the band records with the project open and no call (Chromium: it
// needs a microphone), a take's samples checked one by one; a batch sent twice is applied once; and a take's audio is
// served in ranges. With PARLEY_API_ORIGIN2 (a second instance on the same database) the band's right to record is
// checked there for a take started here.
import { WEB, B, S, IP, BROWSER, reg, call, callS, ok, finish, launchBrowser } from '../lib.mjs'
import { wavFile, parseWav, sine, studioInput, humCheck, pullRender, rms } from '../audio.mjs'

const B2 = process.env.PARLEY_API_ORIGIN2 ? `${process.env.PARLEY_API_ORIGIN2}/api` : null
const chromium = BROWSER === 'chromium'
const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol'); const d = await reg('dave')
const g = await call(a.token, 'POST', '/guilds', { name: `Collab ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const u of [b, c, d]) await call(u.token, 'POST', `/invites/${inv.code}`)
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'collab', kind: 'studio' })).body
const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Collab Song', bpm: 120 })).body
for (const u of [b, c]) await callS(a.token, 'PUT', `/channels/${P.channel_id}/studio/role/${u.user.id}`, { role: 'artist' })
const full = () => call(a.token, 'GET', `/studio/projects/${P.id}`)
const ops = (tok, list, id) => callS(tok, 'POST', `/studio/projects/${P.id}/ops`, id ? { id, ops: list } : { ops: list })
const tone = await (await fetch(`${B}/channels/${P.channel_id}/studio/audio?name=Tone.wav&duration_ms=2000`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/wav', 'X-Forwarded-For': IP }, body: wavFile({ seconds: 2, signal: sine(440, 0.25) }) })).json()
const id = () => crypto.randomUUID()
const L1 = id(), L2 = id(), LM = id(), LB = id(), LC = id(), C1 = id(), C2 = id(), CM = id(), CX = id(), CY = id()
const N0 = { p: 60, t: 0, d: 200, v: 100 }
let r = await ops(a.token, [
  { op: 'lane.put', lane: { id: L1, name: 'One', position: 0 } }, { op: 'lane.put', lane: { id: L2, name: 'Two', position: 1 } },
  { op: 'lane.put', lane: { id: LM, name: 'Keys', kind: 'midi', position: 2 } },
  { op: 'clip.put', clip: { id: C1, lane_id: L1, audio_id: tone.id, start_ms: 0, length_ms: 2000 } },
  { op: 'clip.put', clip: { id: C2, lane_id: L2, audio_id: tone.id, start_ms: 0, length_ms: 2000 } },
  { op: 'clip.put', clip: { id: CM, lane_id: LM, start_ms: 0, length_ms: 2000, notes: [N0] } },
  { op: 'clip.put', clip: { id: CX, lane_id: L2, audio_id: tone.id, start_ms: 4000, length_ms: 500 } },
  { op: 'clip.put', clip: { id: CY, lane_id: L2, audio_id: tone.id, start_ms: 5000, length_ms: 500 } },
])
ok('the project is set up', r.status === 200, JSON.stringify(r.body))
r = await ops(b.token, [{ op: 'lane.put', lane: { id: LB, name: 'Bob', position: 3, user_id: b.user.id, armed: true } }])
ok('an artist makes a track of their own', r.status === 200 && (await full()).lanes.find((l) => l.id === LB)?.user_id === b.user.id, JSON.stringify(r.body))
await ops(c.token, [{ op: 'lane.put', lane: { id: LC, name: 'Carol', position: 4, user_id: c.user.id, armed: false } }])

const browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
/** A member's DAW in a context of its own (not in the call), keeping every toast it showed. */
const open = async (u) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(chromium ? { permissions: ['microphone'] } : {}) })
  if (chromium) await ctx.addInitScript(studioInput, 'hum')
  await ctx.addInitScript(() => {
    window.__toasts = []
    const see = () => document.querySelectorAll('[data-toast]').forEach((e) => { if (!e.__seen) { e.__seen = true; window.__toasts.push(e.textContent) } })
    new MutationObserver(see).observe(document, { childList: true, subtree: true })
  })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}/channels/${g.id}/${P.channel_id}`); await p.waitForSelector(`[data-daw-clip="${C1}"]`, { timeout: 15000 })
  return { ctx, p }
}
const A = await open(a), Bo = await open(b), Ca = await open(c), Da = await open(d)
const edit = (p, list) => p.evaluate((l) => window.__parleyDawTest.edit(l), list)
const undo = (p) => p.evaluate(() => window.__parleyDawTest.undo())
const st = (p) => p.evaluate(() => { const s = window.__parleyDawTest.state(); return { sync: s.sync, version: s.project?.version, markers: s.project?.markers ?? [], lanes: s.lanes, clips: s.clips } })
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await new Promise((res) => setTimeout(res, 100)) } }
const saved = (p, ms) => until(async () => (await st(p)).sync === 'saved', ms)
const toasted = (p, re) => until(async () => (await p.evaluate(() => window.__toasts)).some((x) => re.test(x)), 5000)
const lane = async (lid) => (await full()).lanes.find((l) => l.id === lid)
const clip = async (cid) => (await full()).clips.find((x) => x.id === cid)
/** Everyone has the server's version of the project. */
const settled = async (...pages) => { const v = (await full()).project.version; return until(async () => (await Promise.all(pages.map((x) => st(x.p)))).every((s) => s.version === v && s.sync === 'saved')) }
const has = (list, n) => list.some((x) => x.p === n.p && x.t === n.t && x.d === n.d)

console.log('-- two people, the same lists')
const N1 = { p: 64, t: 500, d: 200, v: 90 }, N2 = { p: 67, t: 1000, d: 200, v: 80 }
const E1 = { id: id(), type: 'eq', on: true, params: { low: 3 } }, E2 = { id: id(), type: 'compressor', on: true, params: { threshold: -20 } }
const M1 = { id: id(), ms: 1000, name: 'Verse' }, M2 = { id: id(), ms: 3000, name: 'Chorus' }
await A.ctx.setOffline(true)
// Each sends the list as they have it, with their own addition: what goes out is the addition.
await edit(A.p, [{ op: 'clip.put', clip: { id: CM, notes: [N0, N1] } }])
await edit(A.p, [{ op: 'lane.put', lane: { id: L1, automation: { gain: [[1000, 0.5]] } } }])
await edit(A.p, [{ op: 'lane.put', lane: { id: L1, effects: [E1] } }])
await edit(A.p, [{ op: 'project', markers: [M1] }])
await edit(Bo.p, [{ op: 'clip.put', clip: { id: CM, notes: [N0, N2] } }])
await edit(Bo.p, [{ op: 'lane.put', lane: { id: L1, automation: { gain: [[2000, 0.8]] } } }])
await edit(Bo.p, [{ op: 'lane.put', lane: { id: L1, effects: [E2] } }])
await edit(Bo.p, [{ op: 'project', markers: [M2] }])
await saved(Bo.p)
let f = await full()
ok('the one who is online has their edits saved', has(f.clips.find((x) => x.id === CM).notes, N2) && f.lanes.find((l) => l.id === L1).effects.some((e) => e.id === E2.id))
await A.ctx.setOffline(false)
await saved(A.p, 30000); await settled(A, Bo)
f = await full()
const notes = f.clips.find((x) => x.id === CM).notes, l1 = f.lanes.find((l) => l.id === L1)
ok('notes added to one clip by both are all there', notes.length === 3 && has(notes, N0) && has(notes, N1) && has(notes, N2), JSON.stringify(notes))
ok('automation points added to one curve by both are all there', JSON.stringify(l1.automation.gain) === JSON.stringify([[1000, 0.5], [2000, 0.8]]), JSON.stringify(l1.automation))
ok('effects added to one track by both are all there', l1.effects.length === 2 && l1.effects.some((e) => e.id === E1.id && e.params.low === 3) && l1.effects.some((e) => e.id === E2.id && e.params.threshold === -20), JSON.stringify(l1.effects))
ok('markers added by both are all there', f.project.markers.length === 2 && f.project.markers.some((m) => m.id === M1.id) && f.project.markers.some((m) => m.id === M2.id), JSON.stringify(f.project.markers))
const same = async (p) => { const s = await st(p); return s.clips[CM].notes.length === 3 && s.lanes[L1].effects.length === 2 && s.lanes[L1].automation.gain.length === 2 && s.markers.length === 2 }
ok('and both of them see all of it', await until(async () => await same(A.p) && await same(Bo.p)))
// One changes a parameter of an effect while the other switches it off: one effect, both changes.
await edit(A.p, [{ op: 'lane.put', lane: { id: L1, effects: (await st(A.p)).lanes[L1].effects.map((e) => (e.id === E1.id ? { ...e, params: { ...e.params, low: 6 } } : e)) } }])
await edit(Bo.p, [{ op: 'lane.put', lane: { id: L1, effects: (await st(Bo.p)).lanes[L1].effects.map((e) => (e.id === E2.id ? { ...e, on: false } : e)) } }])
await saved(A.p); await saved(Bo.p); await settled(A, Bo)
const fx = (await lane(L1)).effects
ok('a change to one effect leaves the other person’s change to another', fx.find((e) => e.id === E1.id)?.params.low === 6 && fx.find((e) => e.id === E2.id)?.on === false && fx.length === 2, JSON.stringify(fx))
// One removes a note while the other adds one.
await edit(A.p, [{ op: 'clip.put', clip: { id: CM, notes: (await st(A.p)).clips[CM].notes.filter((n) => n.p !== N0.p) } }])
const N3 = { p: 72, t: 1500, d: 100, v: 70 }
await edit(Bo.p, [{ op: 'clip.put', clip: { id: CM, notes: [...(await st(Bo.p)).clips[CM].notes, N3] } }])
await saved(A.p); await saved(Bo.p); await settled(A, Bo)
const n2 = (await clip(CM)).notes
ok('a note removed by one is not brought back by the other adding one', !has(n2, N0) && has(n2, N3) && has(n2, N1) && has(n2, N2), JSON.stringify(n2))

console.log('-- undo next to someone else')
await edit(A.p, [{ op: 'lane.put', lane: { id: L1, gain: 0.5 } }]); await saved(A.p)
await edit(Bo.p, [{ op: 'lane.put', lane: { id: L1, gain: 0.8 } }]); await saved(Bo.p)
await until(async () => Math.abs((await st(A.p)).lanes[L1].gain - 0.8) < 1e-4)
await undo(A.p)
ok('undoing a change someone has changed since leaves theirs', !!(await toasted(A.p, /Someone changed that since: their change was kept/)) && await saved(A.p) && Math.abs((await lane(L1)).gain - 0.8) < 1e-4, String((await lane(L1)).gain))
await edit(A.p, [{ op: 'lane.put', lane: { id: L1, pan: 0.3 } }, { op: 'lane.put', lane: { id: L2, pan: -0.3 } }]); await saved(A.p)
await edit(Bo.p, [{ op: 'lane.put', lane: { id: L1, pan: 0.6 } }]); await saved(Bo.p)
await until(async () => Math.abs((await st(A.p)).lanes[L1].pan - 0.6) < 1e-4)
await undo(A.p); await saved(A.p)
f = await full()
ok('undoing an edit they changed part of takes back the rest', !!(await toasted(A.p, /Someone changed part of that since: their change was kept/)) && Math.abs(f.lanes.find((l) => l.id === L1).pan - 0.6) < 1e-4 && f.lanes.find((l) => l.id === L2).pan === 0, JSON.stringify(f.lanes.map((l) => l.pan)))
await edit(A.p, [{ op: 'clip.put', clip: { id: CY, start_ms: 5500 } }]); await saved(A.p)
await edit(Bo.p, [{ op: 'clip.del', id: CY }]); await saved(Bo.p)
await until(async () => !(await st(A.p)).clips[CY])
await undo(A.p); await saved(A.p)
ok('undoing a move of a clip someone deleted does not bring it back', !(await clip(CY)) && !(await st(A.p)).clips[CY] && !(await st(Bo.p)).clips[CY])

console.log('-- deleted by one, edited by the other')
await A.ctx.setOffline(true)
await edit(A.p, [{ op: 'clip.put', clip: { id: CX, start_ms: 4500 } }])
await edit(Bo.p, [{ op: 'clip.del', id: CX }]); await saved(Bo.p)
await A.ctx.setOffline(false)
await until(async () => (await st(A.p)).sync === 'saved' && !(await st(A.p)).clips[CX], 30000)
await settled(A, Bo)
ok('a clip deleted while someone offline moved it stays deleted, for both', !(await clip(CX)) && !(await st(A.p)).clips[CX] && !(await st(Bo.p)).clips[CX])
const MX = (await full()).project.markers.find((m) => m.id === M1.id)
r = await ops(b.token, [{ op: 'marker.del', id: M1.id }]); const r2 = await ops(a.token, [{ op: 'marker.put', marker: { id: M1.id, name: 'Renamed' } }])
ok('a marker deleted is not brought back by a rename of it', !!MX && r.status === 200 && r2.status === 200 && !(await full()).project.markers.some((m) => m.id === M1.id))
await settled(A, Bo)

console.log('-- solo is mine')
await A.p.click(`[data-daw-solo="${L1}"]`)
await until(async () => (await st(A.p)).lanes[L1].solo === true)
await A.p.waitForTimeout(800)
ok('a solo is not in the shared project', (await full()).lanes.every((l) => l.solo === false) && (await st(Bo.p)).lanes[L1].solo === false)
r = await ops(a.token, [{ op: 'lane.put', lane: { id: L2, solo: true } }])
ok('and the server keeps none it is sent', (await lane(L2)).solo === false, JSON.stringify(r.body).slice(0, 200))
// Level, pan and effects out of the way: two tracks of the same tone, one of them soloed.
await ops(a.token, [{ op: 'lane.put', lane: { id: L1, gain: 1, pan: 0, effects: [], automation: {} } }, { op: 'lane.put', lane: { id: L2, gain: 1, pan: 0 } }, { op: 'lane.put', lane: { id: LM, mute: true } }]); await settled(A, Bo)
const heard = await pullRender(A.p, undefined, true), mix = await pullRender(A.p), other = await pullRender(Bo.p, undefined, true)
const e = (x) => rms(x.samples[0], x.rate, 100, 1900)
ok('I hear my solo; the mix that is exported has every track', e(heard) > 0.05 && Math.abs(e(mix) / e(heard) - 2) < 0.05, `${e(heard)} ${e(mix)}`)
ok('someone else hears every track', Math.abs(e(other) / e(mix) - 1) < 0.02, `${e(other)} ${e(mix)}`)
await A.p.reload(); await A.p.waitForSelector(`[data-daw-clip="${C1}"]`, { timeout: 15000 })
ok('my solo is still on after a reload', await until(async () => (await st(A.p)).lanes[L1]?.solo === true, 5000) && await A.p.getAttribute(`[data-daw-solo="${L1}"]`, 'aria-pressed') === 'true')
await A.p.click(`[data-daw-solo="${L1}"]`); await until(async () => (await st(A.p)).lanes[L1].solo === false)

console.log('-- a protected track')
await Bo.p.locator(`[data-daw-lane-head="${LB}"] [data-daw-lane-menu]`).click()
await Bo.p.click(`[data-daw-protect="${LB}"]`)
await Bo.p.mouse.click(900, 600)
ok('its owner protects a track', await until(async () => (await lane(LB)).protected === true))
ok('everyone sees that it is', await Ca.p.waitForSelector(`[data-daw-protected="${LB}"]`, { timeout: 5000 }).then(() => true, () => false) && await Ca.p.locator(`[data-daw-lane-head="${LB}"] [data-daw-lane-menu]`).click().then(async () => await Ca.p.locator(`[data-daw-protect="${LB}"]`).count() === 0))
await Ca.p.mouse.click(900, 600)
const refused = []
for (const [what, list] of [
  ['its level', [{ op: 'lane.put', lane: { id: LB, gain: 0.5 } }]], ['unprotecting it', [{ op: 'lane.put', lane: { id: LB, protected: false } }]],
  ['a clip on it', [{ op: 'clip.put', clip: { id: id(), lane_id: LB, audio_id: tone.id, start_ms: 0, length_ms: 500 } }]],
  ['its automation', [{ op: 'auto', lane: LB, param: 'gain', add: [[0, 0.5]], del: [] }]],
  ['its effects', [{ op: 'fx.put', lane: LB, effect: { id: id(), type: 'eq', on: true, params: {} } }]], ['deleting it', [{ op: 'lane.del', id: LB }]],
]) { const x = await ops(c.token, list); if (x.status !== 403) refused.push(`${what}: ${x.status}`) }
ok('another artist changes nothing of it (403)', refused.length === 0, refused.join(', '))
const before = (await lane(LB)).gain
await edit(Ca.p, [{ op: 'lane.put', lane: { id: LB, gain: 0.4 } }])
ok('and is told so in the editor, with nothing changed', !!(await toasted(Ca.p, /That track is protected/)) && (await st(Ca.p)).lanes[LB].gain === before && (await lane(LB)).gain === before)
r = await ops(a.token, [{ op: 'lane.put', lane: { id: LB, gain: 0.7 } }]); const own = await ops(b.token, [{ op: 'lane.put', lane: { id: LB, pan: 0.1 } }])
ok('the engineer and the owner still change it', r.status === 200 && own.status === 200 && Math.abs((await lane(LB)).gain - 0.7) < 1e-4)
ok('other tracks stay open to the artist', (await ops(c.token, [{ op: 'lane.put', lane: { id: L2, gain: 0.9 } }])).status === 200)

console.log('-- the listener')
ok('the listener is told the project is read-only', await Da.p.locator('[data-daw-readonly]').count() === 1 && await A.p.locator('[data-daw-readonly]').count() === 0)
ok('and has nothing to record with', await Da.p.locator('[data-daw-record], [data-daw-record-solo]').count() === 0)
const dv = (await full()).project.version
await edit(Da.p, [{ op: 'lane.put', lane: { id: L2, gain: 0.1 } }])
ok('an edit of theirs is not made, and they are told why', !!(await toasted(Da.p, /You are listening in/)) && Math.abs((await st(Da.p)).lanes[L2].gain - 0.9) < 1e-4 && (await full()).project.version === dv)
ok('the server refuses it too', (await ops(d.token, [{ op: 'lane.put', lane: { id: L2, gain: 0.1 } }])).status === 403 && (await callS(d.token, 'POST', `/studio/projects/${P.id}/transport`, { playing: true, position_ms: 0 })).status === 403)
await edit(A.p, [{ op: 'lane.put', lane: { id: L2, name: 'Second' } }])
ok('they see the band’s edits as they are made', await until(async () => (await st(Da.p)).lanes[L2].name === 'Second', 8000))
await Da.p.click('[data-daw-comments-open]'); await Da.p.fill('[data-daw-comment-input]', 'Lovely take'); await Da.p.click('[data-daw-comment-send]')
ok('they comment', await until(async () => (await call(a.token, 'GET', `/studio/projects/${P.id}/comments`)).some((x) => x.body === 'Lovely take' && x.user_id === d.user.id), 8000))
await A.p.click('[data-daw-rtz]'); await A.p.click('[data-daw-play]')
ok('they follow the shared playback', await Da.p.waitForSelector('[data-daw][data-daw-state="playing"]', { timeout: 8000 }).then(() => true, () => false))
await A.p.click('[data-daw-play]')
ok('and its stop', await Da.p.waitForSelector('[data-daw][data-daw-state="stopped"]', { timeout: 8000 }).then(() => true, () => false))

console.log('-- a batch sent twice')
const bid = id()
r = await ops(a.token, [{ op: 'lane.put', lane: { id: L2, gain: 0.25 } }], bid)
const v1 = (await full()).project.version
await ops(a.token, [{ op: 'lane.put', lane: { id: L2, gain: 0.6 } }])
const again = await ops(a.token, [{ op: 'lane.put', lane: { id: L2, gain: 0.25 } }], bid)
f = await full()
ok('is applied once', r.status === 200 && !r.body.repeat && again.status === 200 && again.body.repeat === true && f.project.version === v1 + 1 && Math.abs(f.lanes.find((l) => l.id === L2).gain - 0.6) < 1e-4, JSON.stringify([r.body.repeat, again.body, f.project.version, v1]))

console.log('-- audio in ranges')
{
  const get = (h = {}) => fetch(`${B}/studio/tracks/${tone.id}`, { headers: { Authorization: `Bearer ${a.token}`, 'X-Forwarded-For': IP, ...h } })
  const whole = await get(), all = Buffer.from(await whole.arrayBuffer()), tag = whole.headers.get('etag')
  ok('the whole file says it can be read in ranges, and has a tag', whole.status === 200 && whole.headers.get('accept-ranges') === 'bytes' && !!tag && all.length > 1000)
  let x = await get({ Range: 'bytes=100-199' }), part = Buffer.from(await x.arrayBuffer())
  ok('a range is that part of it', x.status === 206 && x.headers.get('content-range') === `bytes 100-199/${all.length}` && part.equals(all.subarray(100, 200)), `${x.status} ${x.headers.get('content-range')}`)
  x = await get({ Range: 'bytes=-64' }); part = Buffer.from(await x.arrayBuffer())
  ok('a range from the end is its last bytes', x.status === 206 && part.equals(all.subarray(all.length - 64)))
  x = await get({ Range: `bytes=${all.length + 10}-` })
  ok('a range past the end is refused (416)', x.status === 416 && x.headers.get('content-range') === `bytes */${all.length}`, `${x.status} ${x.headers.get('content-range')}`)
  x = await get({ 'If-None-Match': tag })
  ok('a copy that is still good is not sent again (304)', x.status === 304)
}

console.log('-- recording with no call')
const sessions = () => call(a.token, 'GET', `/channels/${P.channel_id}/studio/sessions`)
const ended = () => until(async () => !(await sessions()).some((x) => !x.ended_at), 20000)
if (chromium) {
  const seen = new Set((await full()).audio.map((x) => x.id))
  /** Someone's new take once the server has all of it: its clip, its record, its samples. */
  const landed = async (uid = b.user.id) => {
    let cl = null, au = null
    await until(async () => { const x = await full(); cl = x.clips.find((k) => k.audio_id && !seen.has(k.audio_id) && !k.muted && x.audio.some((y) => y.id === k.audio_id && y.user_id === uid)); au = cl && x.audio.find((k) => k.id === cl.audio_id); return !!(cl && au?.done) }, 40000)
    if (!cl || !au) return null
    seen.add(cl.audio_id)
    const res = await fetch(`${B}/studio/tracks/${au.id}`, { headers: { Authorization: `Bearer ${a.token}`, 'X-Forwarded-For': IP } })
    const bytes = Buffer.from(await res.arrayBuffer()), wav = bytes.toString('latin1', 0, 4) === 'RIFF' ? parseWav(bytes) : null
    return { clip: cl, audio: au, wav, x: wav?.samples[0] ?? new Float32Array(0) }
  }
  const good = (t, secs) => { if (!t) return { ok: false, why: 'no take' }; const h = humCheck(t.x), len = t.x.length / 48000; return { ok: h.phase >= 0 && h.wrong === 0 && h.silent <= 4096 && Math.abs(len - secs) < 1.5 && t.wav.bits === 24 && t.wav.rate === 48000, why: JSON.stringify({ ...h, secs: len, wanted: secs, bits: t.wav?.bits, rate: t.wav?.rate }) } }
  const recording = (p, on) => p.waitForFunction((v) => (window.__parleyStudio?.recording === true) === v, on, { timeout: 15000 }).then(() => true, () => false)

  // The engineer starts a take for the band; the artist has the project open, an armed track, and is in no call.
  await A.p.click('[data-daw-rtz]'); await A.p.click('[data-daw-record]')
  let on = await recording(Bo.p, true), t0 = Date.now()
  ok('a take the engineer starts records the artist’s armed track, with no call', on && await Bo.p.locator('[data-voice-leave]').count() === 0 && await A.p.locator('[data-voice-leave]').count() === 0)
  const live = (await sessions()).find((x) => !x.ended_at)
  ok('the take counts both of them in', !!live && live.armed.includes(b.user.id) && live.armed.includes(a.user.id), JSON.stringify(live?.armed))
  ok('the artist whose track is not armed does not record', await Ca.p.evaluate(() => window.__parleyStudio?.recording !== true))
  ok('nor does the listener', await Da.p.evaluate(() => window.__parleyStudio?.recording !== true))
  if (B2 && live) {
    const mk = (u, body) => fetch(`${B2}/studio/sessions/${live.id}/tracks`, { method: 'POST', headers: { Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json', 'X-Forwarded-For': IP }, body: JSON.stringify(body) })
    const no = await mk(d, { offset_ms: 0, latency_ms: 0 }), notMine = await mk(c, { offset_ms: 0, latency_ms: 0, lane_id: LB })
    ok('on another instance, the listener may not record into the take, nor an artist onto someone else’s track', no.status === 403 && notMine.status >= 400 && notMine.status < 500, `${no.status} ${notMine.status}`)
  }
  await A.p.waitForTimeout(3000)
  await A.p.click('[data-daw-record]'); let secs = (Date.now() - t0) / 1000
  await recording(Bo.p, false); await ended()
  let take = await landed(), w = good(take, secs)
  ok('what was recorded is whole, sample for sample, at 24 bits and 48 kHz', w.ok, w.why)
  ok('and is a clip on the artist’s track', take?.clip.lane_id === LB && take?.audio.user_id === b.user.id, JSON.stringify(take?.clip))

  // On their own: the artist records alone, in no call.
  await Bo.p.click('[data-daw-rtz]'); await Bo.p.click('[data-daw-record-solo]')
  on = await recording(Bo.p, true); t0 = Date.now()
  ok('an artist records alone with no call', on && await Bo.p.locator('[data-voice-leave]').count() === 0)
  await Bo.p.waitForTimeout(2500)
  await Bo.p.click('[data-daw-record-solo]'); secs = (Date.now() - t0) / 1000
  await recording(Bo.p, false); await ended()
  take = await landed(); w = good(take, secs)
  ok('and that take is whole too', w.ok && take?.clip.lane_id === LB, w.why)
  if (B2) {
    // The right to record is the band's on every instance, for a take started on this one.
    r = await callS(a.token, 'POST', `/channels/${P.channel_id}/studio/sessions`, {})
    const mk = (u, body) => fetch(`${B2}/studio/sessions/${r.body.id}/tracks`, { method: 'POST', headers: { Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json', 'X-Forwarded-For': IP }, body: JSON.stringify(body) })
    const yes = await mk(b, { offset_ms: 0, latency_ms: 0, lane_id: LB, sample_rate: 48000, channels: 1, bits: 24 })
    ok('on another instance, the artist in no call may record into it', yes.status === 201, `${yes.status} ${await yes.text()}`)
    await callS(a.token, 'POST', `/channels/${P.channel_id}/studio/sessions/${r.body.id}/stop`, {})
  }
} else console.log(`  (recording not run under ${BROWSER}: it needs a microphone)`)
// Without a microphone: who may start and join a take is the server's to say.
await ended()
r = await callS(d.token, 'POST', `/channels/${P.channel_id}/studio/sessions`, {})
ok('the listener cannot start a take', r.status === 403, JSON.stringify(r.body))
r = await callS(a.token, 'POST', `/channels/${P.channel_id}/studio/sessions`, {})
ok('the engineer starts one with no one in the call, and is in it with the owners of armed tracks', r.status < 300 && r.body.armed.includes(a.user.id) && r.body.armed.includes(b.user.id) && !r.body.armed.includes(c.user.id) && !r.body.armed.includes(d.user.id), JSON.stringify(r.body))
{
  const mk = (u, body) => callS(u.token, 'POST', `/studio/sessions/${r.body.id}/tracks`, body)
  ok('the listener cannot record into it', (await mk(d, { offset_ms: 0, latency_ms: 0 })).status === 403)
  ok('an artist cannot record onto a track that is not theirs', (await mk(c, { offset_ms: 0, latency_ms: 0, lane_id: LB })).status >= 400)
  ok('nor onto their own while it is not armed', (await mk(c, { offset_ms: 0, latency_ms: 0, lane_id: LC })).status >= 400)
  await callS(a.token, 'POST', `/channels/${P.channel_id}/studio/sessions/${r.body.id}/stop`, {})
}

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
