// A project open in the DAW stays the project the server has, through whatever the connection does: edits made with
// no connection are kept, shown and sent in order when it is back (with nothing reloaded over them); another editor's
// work in the meantime is there afterwards; an edit the server refuses is taken back on its own, the ones around it
// kept; a socket that drops and resumes replays what was missed, one that comes back fresh takes the project again;
// events that cross on the way are put in order; and (when STUDIO_RESTART_CMD says how, e.g.
// `docker restart parley-inv-test`) the same across a restart of the server. STUDIO_OFFLINE_SECS sets the outage (30).
import { execSync } from 'node:child_process'
import { WEB, B, S, IP, reg, call, callS, ok, finish, launchBrowser } from '../lib.mjs'

const OUTAGE = Number(process.env.STUDIO_OFFLINE_SECS ?? 30) * 1000
const RESTART = process.env.STUDIO_RESTART_CMD
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Sync ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'daw', kind: 'studio' })).body
const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Sync Song', bpm: 120 })).body
await callS(a.token, 'PUT', `/channels/${P.channel_id}/studio/role/${b.user.id}`, { role: 'artist' })
const full = () => call(a.token, 'GET', `/studio/projects/${P.id}`)
const ops = (tok, list) => callS(tok, 'POST', `/studio/projects/${P.id}/ops`, { ops: list })
const wav = (sec) => {
  const n = 8000 * sec; const buf = Buffer.alloc(44 + n)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40)
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(80 * Math.sin(i / 3))
  return buf
}
const beat = await (await fetch(`${B}/channels/${P.channel_id}/studio/audio?name=Beat.wav&duration_ms=8000`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/wav', 'X-Forwarded-For': IP }, body: wav(8) })).json()
const LA = crypto.randomUUID(), LB = crypto.randomUUID(), CA = crypto.randomUUID()
await ops(a.token, [{ op: 'lane.put', lane: { id: LA, name: 'One', position: 0 } }, { op: 'lane.put', lane: { id: LB, name: 'Two', position: 1 } }, { op: 'clip.put', clip: { id: CA, lane_id: LA, audio_id: beat.id, start_ms: 0, length_ms: 1000 } }])

const browser = await launchBrowser(); const errors = []
/** A member's DAW in a context of its own, counting how often it took the whole project from the server. */
const open = async (u) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  const seen = { loads: 0 }
  p.on('request', (r) => { if (r.method() === 'GET' && r.url().endsWith(`/api/studio/projects/${P.id}`)) seen.loads++ })
  await p.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}/channels/${g.id}/${P.channel_id}`); await p.waitForSelector(`[data-daw-clip="${CA}"]`, { timeout: 15000 })
  return { ctx, p, seen }
}
const A = await open(a), Bo = await open(b)
const edit = (p, list) => p.evaluate((l) => window.__parleyDawTest.edit(l), list)
const st = (p) => p.evaluate(() => { const s = window.__parleyDawTest.state(); return { sync: s.sync, unsent: s.unsent, version: s.project?.version, name: s.project?.name, undo: s.undo.length, lanes: Object.fromEntries(Object.values(s.lanes).map((l) => [l.id, l.name])), clips: Object.fromEntries(Object.values(s.clips).map((c) => [c.id, c.start_ms])), comments: s.comments.length } })
const ws = (p) => p.evaluate(() => ({ ready: window.__parleyWs.ready, resumed: window.__parleyWs.resumed }))
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await new Promise((r) => setTimeout(r, 100)) } }
const sync = (p, want, ms) => until(async () => (await st(p)).sync === want, ms)
const toasts = (p) => p.locator('[role="alert"], [data-toast]').allTextContents()

console.log('-- the indicator')
ok('an open project with nothing to send says saved', await A.p.getAttribute('[data-daw-sync]', 'data-daw-sync') === 'saved')
await edit(A.p, [{ op: 'clip.put', clip: { id: CA, start_ms: 50 } }])
ok('an edit is saved a moment later', await sync(A.p, 'saved') && (await full()).clips.find((c) => c.id === CA).start_ms === 50)

console.log(`-- ${OUTAGE / 1000} s without a connection`)
const v0 = (await full()).project.version
let loads = A.seen.loads, sockets = await ws(A.p)
await A.ctx.setOffline(true)
// Twelve edits, each needing the one before: a lane, then clips on it, then the same clip moved step by step.
const LN = crypto.randomUUID(), CN = crypto.randomUUID()
await edit(A.p, [{ op: 'lane.put', lane: { id: LN, name: 'Made offline', position: 2 } }])
await edit(A.p, [{ op: 'clip.put', clip: { id: CN, lane_id: LN, audio_id: beat.id, start_ms: 0, in_ms: 0, length_ms: 500 } }])
for (let i = 1; i <= 10; i++) { await edit(A.p, [{ op: 'clip.put', clip: { id: CN, start_ms: i * 100 } }, { op: 'lane.put', lane: { id: LN, name: `Step ${i}` } }]); await A.p.waitForTimeout(40) }
ok('the edits wait, and the DAW says it has no connection and how many are waiting', await sync(A.p, 'offline', 8000) && (await st(A.p)).unsent === 12, JSON.stringify(await st(A.p)))
ok('…where the member can see it', (await A.p.getAttribute('[data-daw-sync]', 'data-daw-sync')) === 'offline' && /12/.test(await A.p.innerText('[data-daw-sync]')))
// Meanwhile someone else works on the project.
const CB = crypto.randomUUID()
await edit(Bo.p, [{ op: 'lane.put', lane: { id: LB, name: 'Bob was here' } }])
await edit(Bo.p, [{ op: 'clip.put', clip: { id: CB, lane_id: LB, audio_id: beat.id, start_ms: 3000, in_ms: 0, length_ms: 700 } }])
await sync(Bo.p, 'saved')
await A.p.waitForTimeout(OUTAGE)
let s = await st(A.p)
ok('through the outage the edits stay as made, on screen', s.lanes[LN] === 'Step 10' && s.clips[CN] === 1000 && s.unsent === 12 && await A.p.locator(`[data-daw-clip="${CN}"]`).count() === 1, JSON.stringify(s))
ok('and nothing of them is on the server yet', (await full()).project.version === v0 + 2 && !(await full()).lanes.some((l) => l.id === LN))
ok('no error was shown for them', !(await toasts(A.p)).some((t) => /fail|fetch|error/i.test(t)), JSON.stringify(await toasts(A.p)))
await A.ctx.setOffline(false)
ok('with the connection back they are sent', await sync(A.p, 'saved', 20000), JSON.stringify(await st(A.p)))
let f = await full()
ok('all twelve are on the server, each as one change, after the other editor\'s two', f.project.version === v0 + 14, `${v0} -> ${f.project.version}`)
ok('in the order they were made (each needed the one before, and the last one stands)', f.lanes.find((l) => l.id === LN)?.name === 'Step 10' && f.clips.find((c) => c.id === CN)?.start_ms === 1000, JSON.stringify(f.clips.find((c) => c.id === CN)))
const after = await ws(A.p)
s = await until(async () => { const x = await st(A.p); return x.lanes[LB] === 'Bob was here' && x.clips[CB] === 3000 && x.version === f.project.version ? x : null })
ok('the other editor\'s work in the meantime is in the open project too, beside the member\'s own', !!s && s.lanes[LN] === 'Step 10' && s.clips[CN] === 1000, JSON.stringify(await st(A.p)))
// A socket that survived or resumed replays what was missed: nothing is reloaded. A fresh one takes the project again
// (by design), with the unsent edits put back on top.
if (after.ready === sockets.ready) ok('and the project was not reloaded to get there', A.seen.loads === loads, `${A.seen.loads - loads} loads`)
else ok('the connection came back fresh, so the project was taken again, with the edits still on top', A.seen.loads > loads)
ok('the other editor has the member\'s edits', !!(await until(async () => { const x = await st(Bo.p); return x.lanes[LN] === 'Step 10' && x.clips[CN] === 1000 })))
ok('each of them undoes as one step', (await st(A.p)).undo === 13)

console.log('-- an edit the server refuses')
// An artist may not rename the project: that edit goes, the ones before and after it stay.
await Bo.ctx.setOffline(true)
await edit(Bo.p, [{ op: 'lane.put', lane: { id: LB, name: 'Before the refusal' } }])
await edit(Bo.p, [{ op: 'project', name: 'Bob renamed it' }])
await edit(Bo.p, [{ op: 'clip.put', clip: { id: CB, start_ms: 4200 } }])
ok('made with no connection, all three show', (await st(Bo.p)).name === 'Bob renamed it' && (await st(Bo.p)).undo === 5)
await Bo.ctx.setOffline(false)
await sync(Bo.p, 'saved', 20000)
s = await until(async () => { const x = await st(Bo.p); return x.name === 'Sync Song' ? x : null })
ok('the refused edit is taken back', !!s, JSON.stringify(await st(Bo.p)))
ok('the edits before and after it are kept, here and on the server', s?.lanes[LB] === 'Before the refusal' && s?.clips[CB] === 4200 && (f = await full()).lanes.find((l) => l.id === LB).name === 'Before the refusal' && f.clips.find((c) => c.id === CB).start_ms === 4200 && f.project.name === 'Sync Song', JSON.stringify(s))
ok('it left the undo history, the others stay', s?.undo === 4)
ok('and the member is told', (await toasts(Bo.p)).some((t) => /forbidden/i.test(t)), JSON.stringify(await toasts(Bo.p)))

console.log('-- a socket that drops')
loads = A.seen.loads; sockets = await ws(A.p)
await A.p.evaluate(() => window.__parleyWs.drop())
await ops(b.token, [{ op: 'lane.put', lane: { id: LA, name: 'While the socket was down' } }])
ok('resumed: what was missed is replayed', !!(await until(async () => (await st(A.p)).lanes[LA] === 'While the socket was down')) && (await ws(A.p)).resumed === sockets.resumed + 1, JSON.stringify(await ws(A.p)))
ok('with nothing reloaded', A.seen.loads === loads)
// Not resumed: nothing is replayed, so the project, its comments and its takes are taken from the server again.
await A.ctx.setOffline(true)
await A.p.evaluate(() => window.__parleyWs.resync())
await ops(b.token, [{ op: 'lane.put', lane: { id: LA, name: 'While away' } }])
await callS(b.token, 'POST', `/studio/projects/${P.id}/comments`, { ms: 500, body: 'left while you were away' })
let takes = 0; A.p.on('request', (r) => { if (r.url().includes(`/channels/${P.channel_id}/studio/sessions`)) takes++ })
await A.p.waitForTimeout(1500)
await A.ctx.setOffline(false)
s = await until(async () => { const x = await st(A.p); return x.lanes[LA] === 'While away' && x.comments === 1 ? x : null }, 30000)
ok('a fresh connection: the open project shows what happened meanwhile, with no action', !!s && (await ws(A.p)).ready === sockets.ready + 1, JSON.stringify([await st(A.p), await ws(A.p)]))
ok('its comments and its take list are taken again too', s?.comments === 1 && !!(await until(() => takes > 0)))

console.log('-- events that cross')
loads = A.seen.loads
let v = (await st(A.p)).version
const lane = (name) => ({ op: 'lane.put', lane: { id: LA, project_id: P.id, name, color: null, position: 0, gain: 1, pan: 0, mute: false, solo: false, user_id: null, kind: 'audio' } })
await A.p.evaluate(([pid, v, x, y]) => { const t = window.__parleyDawTest; t.remote({ project_id: pid, version: v + 2, ops: [y] }); t.remote({ project_id: pid, version: v + 1, ops: [x] }) }, [P.id, v, lane('first'), lane('second')])
s = await st(A.p)
ok('an edit that arrives before the one it follows waits for it: both apply, in order', s.version === v + 2 && s.lanes[LA] === 'second', JSON.stringify(s))
await A.p.waitForTimeout(700)
ok('with nothing reloaded', A.seen.loads === loads)
await A.p.evaluate(([pid, v, y]) => window.__parleyDawTest.remote({ project_id: pid, version: v + 5, ops: [y] }), [P.id, v, lane('lost')])
ok('one whose predecessor never comes has the project taken from the server instead', !!(await until(() => A.seen.loads > loads)) && !!(await until(async () => (await st(A.p)).lanes[LA] === 'While away')), JSON.stringify(await st(A.p)))

console.log('-- the server restarted')
if (RESTART) {
  const up = () => until(async () => { try { return (await fetch(`${B}/studio/clock`, { headers: { Authorization: `Bearer ${a.token}`, 'X-Forwarded-For': IP } })).ok } catch { return false } }, 90000)
  loads = A.seen.loads; sockets = await ws(A.p)
  execSync(RESTART, { stdio: 'ignore' })
  // Edits made while it is down are kept and sent when it is back.
  await edit(A.p, [{ op: 'lane.put', lane: { id: LN, name: 'Made while the server was down' } }])
  await edit(A.p, [{ op: 'clip.put', clip: { id: CN, start_ms: 2500 } }])
  ok('the server came back', await up())
  // And someone else's, made before this client is connected again.
  await ops(b.token, [{ op: 'lane.put', lane: { id: LB, name: 'After the restart' } }])
  ok('edits made while it was down are saved', await sync(A.p, 'saved', 60000) && (f = await full()).lanes.find((l) => l.id === LN).name === 'Made while the server was down' && f.clips.find((c) => c.id === CN).start_ms === 2500, JSON.stringify(await st(A.p)))
  s = await until(async () => { const x = await st(A.p); return x.lanes[LB] === 'After the restart' && x.version === (await full()).project.version ? x : null }, 60000)
  ok('and the open project shows what another member did in the meantime, with no action', !!s && s.lanes[LN] === 'Made while the server was down' && s.clips[CN] === 2500, JSON.stringify([await st(A.p), await ws(A.p)]))
} else console.log('  (server restart not tried: set STUDIO_RESTART_CMD)')

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
