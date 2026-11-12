// The studio's DAW, phases 2-5: effects, buses, sends and automation (and the loudness meter); tempo changes,
// markers, the loop range, loop recording into takes, punch recording, recording alone, nudging, presence and
// comments; MIDI tracks with instruments, the piano roll and the computer keyboard; versions; and exports (WAV / FLAC /
// MP3, stems, posting to a channel, project files in and out), plus the lite DAW on phones.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { WEB, B, S, IP, reg, call, callS, raw, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob'); const d = await reg('dave')
const g = await call(a.token, 'POST', '/guilds', { name: `DAW2 ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, d]) await call(u.token, 'POST', `/invites/${inv.code}`)
const text = g.channels.find((x) => x.kind === 'text')
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'daw2', kind: 'studio' })).body
const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Phase Two' })).body
// The project's own channel: its voice room, console and band (alice, who started it, is its engineer).
const st = await call(a.token, 'GET', `/channels/${P.channel_id}`)
const full = () => call(a.token, 'GET', `/studio/projects/${P.id}`)
const ops = (tok, list) => callS(tok, 'POST', `/studio/projects/${P.id}/ops`, { ops: list })
const id = () => crypto.randomUUID()
const wav = (sec) => {
  const n = 8000 * sec; const buf = Buffer.alloc(44 + n)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40)
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round((i % 4000 < 1500 ? 100 : 15) * Math.sin(i / 3))
  return buf
}
const beat = await (await fetch(`${B}/channels/${st.id}/studio/audio?name=Loop.wav&duration_ms=4000`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/wav', 'X-Forwarded-For': IP }, body: wav(4) })).json()

console.log('-- buses, sends, effects, automation (API)')
const L = id(), BUS = id(), M = id()
let r = await ops(a.token, [{ op: 'lane.put', lane: { id: BUS, kind: 'bus', name: 'Verb', effects: [{ id: 'r1', type: 'reverb', params: { size: 2.5, mix: 1 } }] } }, { op: 'lane.put', lane: { id: L, name: 'Beat', sends: { [BUS]: 0.4 }, effects: [{ id: 'e1', type: 'eq', params: { low: 3 } }, { id: 'c1', type: 'compressor' }] } }, { op: 'clip.put', clip: { id: id(), lane_id: L, audio_id: beat.id, start_ms: 0, length_ms: 4000 } }])
ok('a bus with a reverb, and a track with inserts sending to it', r.status === 200, JSON.stringify(r.body))
r = await ops(a.token, [{ op: 'clip.put', clip: { id: id(), lane_id: BUS, audio_id: beat.id, start_ms: 0, length_ms: 1000 } }]); ok('buses hold no clips', r.status === 400)
r = await ops(a.token, [{ op: 'lane.put', lane: { id: L, sends: { [L]: 0.5 } } }]); ok('sends only go to buses', r.status === 400)
r = await ops(a.token, [{ op: 'lane.put', lane: { id: L, effects: [{ id: 'x', type: 'flanger' }] } }]); ok('unknown effects are refused', r.status === 400)
r = await ops(a.token, [{ op: 'lane.put', lane: { id: L, automation: { gain: [[2000, 0.2], [0, 1]], 'fx:e1:low': [[0, -6]] } } }, { op: 'project', master_effects: [{ id: 'lim', type: 'limiter', params: { ceiling: -1 } }] }])
let f = await full()
ok('automation is kept sorted; the master gets its chain', r.status === 200 && JSON.stringify(f.lanes.find((l) => l.id === L).automation.gain) === '[[0,1.0],[2000,0.2]]'.replace('1.0', '1') && f.project.master_effects[0].type === 'limiter', JSON.stringify(f.lanes.find((l) => l.id === L).automation))
r = await ops(a.token, [{ op: 'lane.del', id: BUS }])
f = await full()
ok('deleting a bus drops the sends to it', r.status === 200 && JSON.stringify(f.lanes.find((l) => l.id === L).sends) === '{}')
await ops(a.token, [{ op: 'lane.put', lane: { id: BUS, kind: 'bus', name: 'Verb', effects: [{ id: 'r1', type: 'reverb', params: { mix: 1 } }] } }, { op: 'lane.put', lane: { id: L, sends: { [BUS]: 0.4 } } }])

console.log('-- MIDI, tempo, markers, loop (API)')
r = await ops(a.token, [{ op: 'lane.put', lane: { id: M, kind: 'midi', name: 'Keys' } }, { op: 'clip.put', clip: { id: id(), lane_id: M, start_ms: 0, length_ms: 2000, notes: [{ p: 60, t: 0, d: 500, v: 100 }, { p: 64, t: 500, d: 500 }] } }])
f = await full()
const mlane = f.lanes.find((l) => l.id === M), mclip = f.clips.find((c) => c.lane_id === M)
ok('a MIDI track gets a synth; its clip holds notes and no audio', r.status === 200 && mlane.instrument?.type === 'synth' && mclip.audio_id === null && mclip.notes.length === 2 && mclip.notes[1].v === 100, JSON.stringify({ mlane, mclip }))
r = await ops(a.token, [{ op: 'clip.put', clip: { id: mclip.id, notes: [{ p: 300, t: 0, d: 10 }] } }]); ok('bad notes are refused', r.status === 400)
r = await ops(a.token, [{ op: 'lane.put', lane: { id: M, instrument: { type: 'sampler', audio_id: beat.id, root: 60, params: { r: 300 } } } }]); ok('a sampler plays audio of the studio', r.status === 200)
r = await ops(a.token, [{ op: 'lane.put', lane: { id: M, instrument: { type: 'sampler', audio_id: id(), root: 60, params: {} } } }]); ok('but not audio from elsewhere', r.status === 400)
await ops(a.token, [{ op: 'lane.put', lane: { id: M, instrument: { type: 'drums', params: {} } } }])
r = await ops(a.token, [{ op: 'project', loop_on: true }]); ok('the loop needs a range first', r.status === 400)
r = await ops(a.token, [{ op: 'project', tempo_map: [{ bar: 4, bpm: 90, beats: 3 }], markers: [{ id: 'v1', ms: 2000, name: 'Verse' }], loop_start_ms: 0, loop_end_ms: 2000 }])
f = await full()
ok('tempo changes, markers and a loop range are saved', r.status === 200 && f.project.tempo_map[0].bpm === 90 && f.project.markers[0].name === 'Verse' && f.project.loop_end_ms === 2000)

console.log('-- comments, versions (API)')
r = await callS(d.token, 'POST', `/studio/projects/${P.id}/comments`, { ms: 1500, body: 'Louder here?' })
ok('anyone who can talk in the studio comments at a moment of the song', r.status === 201 && r.body.ms === 1500)
const cm = r.body
r = await raw(b.token, 'DELETE', `/studio/comments/${cm.id}`); ok('only its author (or the crew) deletes it', r.status === 403)
r = await callS(a.token, 'POST', `/studio/projects/${P.id}/versions`, { name: 'Before drums' })
const v1 = r.body
ok('a version is saved', r.status === 201 && v1.name === 'Before drums')
await ops(a.token, [{ op: 'lane.put', lane: { id: L, gain: 0.25 } }, { op: 'lane.del', id: M }])
r = await callS(a.token, 'POST', `/studio/versions/${v1.id}/restore`)
f = await full()
ok('restoring brings it back (the deleted track, the old level)', r.status === 200 && f.lanes.some((l) => l.id === M) && f.lanes.find((l) => l.id === L).gain === 1 && f.clips.some((c) => c.lane_id === M), JSON.stringify(f.lanes.map((l) => [l.name, l.gain])))
ok('and the state before the restore is kept as a version', (await call(a.token, 'GET', `/studio/projects/${P.id}/versions`)).some((v) => v.name.startsWith('Before restoring')))

console.log('-- the DAW in the browser')
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const mk = async (tok, viewport = { width: 1500, height: 950 }, mobile = false) => { const ctx = await browser.newContext({ viewport, permissions: ['microphone'], acceptDownloads: true, isMobile: mobile, hasTouch: mobile }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(`${WEB}/channels/${g.id}/${st.id}`); const join = p.locator('[data-project-join]').or(p.getByText('Join Voice', { exact: true })).first(); await join.waitFor(); await join.click(); await p.waitForSelector('[data-voice-leave]'); return p }
const pa = await mk(a.token); const pb = await mk(b.token)
await call(a.token, 'PUT', `/channels/${st.id}/studio/role/${b.user.id}`, { role: 'artist' })
await pa.waitForSelector('[data-daw]'); await pb.waitForSelector('[data-daw]', { timeout: 10000 })
await ops(a.token, [{ op: 'project', loop_on: false }])

// Mixer: effects and the loudness meter.
await pa.click('[data-daw-view-mixer]'); await pa.waitForSelector('[data-daw-mixer]')
ok('a strip per track, the bus and the master, each with its inserts', await pa.locator(`[data-daw-strip="${BUS}"][data-strip-kind="bus"]`).count() === 1 && await pa.locator(`[data-daw-fx="${L}"] [data-daw-fx-slot]`).count() === 2 && await pa.locator('[data-daw-fx="master"] [data-daw-fx-slot="limiter"]').count() === 1)
await pa.locator(`[data-daw-fx="${L}"] [data-daw-fx-add]`).selectOption('delay')
await pa.waitForSelector('[data-daw-fx-editor="delay"]')
await pa.locator('[data-daw-fx-editor="delay"] [data-daw-fx-param="mix"]').fill('800'); await pa.waitForTimeout(700)
f = await full()
const delay = f.lanes.find((l) => l.id === L).effects.find((e) => e.type === 'delay')
ok('adding a delay opens its editor; its settings are shared', !!delay && delay.params.mix > 0.6, JSON.stringify(delay))
await pa.click('[data-daw-rtz]'); await pa.click('[data-daw-play]')
await pa.waitForFunction(() => ['local', 'shared'].includes(window.__parleyDaw?.playing) && window.__parleyDaw.graph >= 3, null, { timeout: 8000 }).catch(() => {})
await pa.waitForFunction(() => document.querySelector('[data-daw-lufs]')?.getAttribute('data-daw-lufs'), null, { timeout: 8000 }).catch(() => {})
const lufs = Number(await pa.locator('[data-daw-lufs]').getAttribute('data-daw-lufs'))
ok('playing builds the graph (tracks, bus, master) and the master shows its loudness', lufs < 0 && lufs > -70, String(lufs))
await pa.screenshot({ path: 'daw2-mixer.png' })
await pa.click('[data-daw-play]')
await pa.click('[data-daw-view-arrange]')

// Automation lane: click to add a point.
await pa.click(`[data-daw-auto-toggle="${L}"]`)
await pa.locator(`[data-daw-auto-param="${L}"]`).selectOption('pan')
const row = await pa.locator(`[data-daw-auto-row="${L}:pan"]`).boundingBox()
await pa.mouse.click(row.x + 120, row.y + 8); await pa.waitForTimeout(700)
f = await full()
ok('clicking the automation lane adds a pan point, high = right', (f.lanes.find((l) => l.id === L).automation.pan ?? [])[0]?.[1] > 0.5, JSON.stringify(f.lanes.find((l) => l.id === L).automation))

// Loop range on the ruler, markers, tempo badge.
const ruler = await pa.locator('[data-daw-ruler]').boundingBox()
await pa.mouse.move(ruler.x + 5, ruler.y + 10); await pa.mouse.down(); await pa.mouse.move(ruler.x + 150, ruler.y + 10, { steps: 5 }); await pa.mouse.up(); await pa.waitForTimeout(600)
f = await full()
ok('dragging on the ruler sets the loop range and turns the loop on', f.project.loop_on && f.project.loop_end_ms > f.project.loop_start_ms, JSON.stringify([f.project.loop_start_ms, f.project.loop_end_ms]))
await pa.click('[data-daw-play]')
await pa.waitForFunction(() => !!window.__parleyDaw?.loop, null, { timeout: 5000 }).catch(() => {})
const loopEnd = f.project.loop_end_ms / 1000
await pa.waitForTimeout(loopEnd * 1000 + 600)
const posLoop = await pa.evaluate(() => window.__parleyDaw)
ok('playing loops the range', !!posLoop.loop && posLoop.position < loopEnd, JSON.stringify(posLoop))
await pa.click('[data-daw-play]')
await pa.keyboard.press('l'); await pa.waitForTimeout(500)
ok('L turns the loop off', (await full()).project.loop_on === false)
ok('markers and tempo changes show on the ruler', await pa.locator('[data-daw-marker="v1"]').count() === 1 && /90/.test(await pa.locator('[data-daw-ruler]').innerText()))

// MIDI: a clip from a double-click, the piano roll, and the computer keyboard.
await pa.click('[data-daw-add-midi]'); await pa.waitForTimeout(600)
f = await full()
const synth = f.lanes.filter((l) => l.kind === 'midi').find((l) => l.id !== M)
ok('+ MIDI makes a MIDI track with a synth, armed for playing here', !!synth && synth.instrument.type === 'synth' && (await pa.locator(`[data-daw-midi-arm="${synth.id}"]`).getAttribute('aria-pressed')) === 'true')
const slane = await pa.locator(`[data-daw-lane="${synth.id}"]`).boundingBox()
await pa.mouse.dblclick(slane.x + 300, slane.y + slane.height / 2)
await pa.waitForSelector('[data-daw-piano-roll]', { timeout: 5000 })
const grid = await pa.locator('[data-daw-roll-grid-area]').boundingBox()
await pa.locator('[data-daw-piano-roll] .overflow-auto').evaluate((e) => { e.scrollTop = 0 })
await pa.mouse.click(grid.x + 30, grid.y + 14 * 10 + 5); await pa.waitForTimeout(300)
await pa.mouse.click(grid.x + 200, grid.y + 14 * 14 + 5); await pa.waitForTimeout(700)
f = await full()
const rollClip = f.clips.find((c) => c.lane_id === synth.id)
ok('double-clicking a MIDI track makes a one-bar clip and opens the piano roll; clicks add notes', !!rollClip && rollClip.notes.length === 2 && rollClip.notes.some((n) => n.p === 86), JSON.stringify(rollClip?.notes))
await pa.screenshot({ path: 'daw2-pianoroll.png' })
await pa.click('[data-daw-roll-close]')
await pa.click('[data-daw-keys]')
await pa.click('[data-daw-rtz]'); await pa.evaluate(() => document.activeElement?.blur())
await pa.keyboard.press('Space'); await pa.waitForTimeout(400)
await pa.keyboard.down('a'); await pa.waitForTimeout(300); await pa.keyboard.up('a')
await pa.keyboard.down('d'); await pa.waitForTimeout(200); await pa.keyboard.up('d')
await pa.waitForTimeout(300); await pa.keyboard.press('Space'); await pa.waitForTimeout(800)
f = await full()
const played = f.clips.filter((c) => c.lane_id === synth.id && c.id !== rollClip.id)
ok('played on the computer keyboard while playing, the notes become a clip on stop', played.length === 1 && played[0].notes.map((n) => n.p).join() === '60,64', JSON.stringify(played.map((c) => c.notes)))
await pa.click('[data-daw-keys]')

// Presence and comments.
await pb.click('[data-daw-ruler]', { position: { x: 400, y: 10 } })
await pa.waitForSelector(`[data-daw-peer-head="${b.user.id}"]`, { timeout: 5000 }).catch(() => {})
ok('alice sees where bob\'s playhead is', await pa.locator(`[data-daw-peer-head="${b.user.id}"]`).count() === 1)
await pb.click('[data-daw-comments-open]'); await pb.fill('[data-daw-comment-input]', 'Needs more cowbell'); await pb.click('[data-daw-comment-send]')
await pa.waitForFunction(() => document.querySelectorAll('[data-daw-comment-pin]').length >= 2, null, { timeout: 5000 }).catch(() => {})
ok('a comment shows as a pin on everyone\'s ruler', await pa.locator('[data-daw-comment-pin]').count() >= 2)
await pb.click('[data-daw-comments-open]')

console.log('-- recording: loop takes, punch, alone')
await ops(a.token, [{ op: 'project', loop_start_ms: 0, loop_end_ms: 1500, loop_on: true }])
await pa.click('[data-daw-rtz]'); await pa.click('[data-daw-record]')
await pb.waitForFunction(() => window.__parleyStudio?.recording === true, null, { timeout: 10000 })
await pb.waitForFunction(() => !!window.__parleyDaw?.loop && window.__parleyDaw.playing === 'backing', null, { timeout: 5000 }).catch(() => {})
ok('loop recording loops the backing', await pb.evaluate(() => !!window.__parleyDaw?.loop))
await pa.waitForTimeout(4200)
await pa.click('[data-daw-record]')
let takes = []
for (let i = 0; i < 40; i++) { f = await full(); const bl = f.lanes.find((l) => l.user_id === b.user.id); takes = bl ? f.clips.filter((c) => c.lane_id === bl.id && c.group_id) : []; if (takes.length >= 2) break; await pa.waitForTimeout(500) }
ok('a take over the loop becomes a group of takes, one per pass, one playing', takes.length >= 2 && takes.filter((c) => !c.muted).length === 1 && takes.every((c) => c.start_ms === 0 && c.length_ms <= 1500), JSON.stringify(takes.map((c) => [c.start_ms, c.in_ms, c.length_ms, c.muted])))
await pa.waitForTimeout(500)
const tclip = pa.locator(`[data-daw-clip="${takes.find((c) => !c.muted).id}"]`) // this group's playing take (another member's group may come first)
await tclip.click({ position: { x: 20, y: 40 } })
await pa.waitForSelector('[data-daw-takes]', { timeout: 10000 }).catch(() => {})
await pa.locator('[data-daw-take="1"]').click()
// The pick is saved through the server: under load that can take a moment.
let g1
for (let i = 0; i < 20; i++) { f = await full(); g1 = f.clips.filter((c) => c.group_id === takes[0].group_id).sort((x, y) => x.id.localeCompare(y.id)); if (!g1[0].muted) break; await pa.waitForTimeout(300) }
ok('picking a take plays it and mutes the others (comping)', !g1[0].muted && g1.slice(1).every((c) => c.muted), JSON.stringify(g1.map((c) => c.muted)))
await ops(a.token, [{ op: 'project', loop_on: false, punch_on: true, loop_start_ms: 1000, loop_end_ms: 2000 }])
const before = new Set(f.clips.map((c) => c.id))
await pa.click('[data-daw-rtz]'); await pa.click('[data-daw-record]')
await pb.waitForFunction(() => window.__parleyStudio?.recording === true, null, { timeout: 10000 })
await pa.waitForTimeout(3200); await pa.click('[data-daw-record]')
let punched = []
for (let i = 0; i < 40; i++) { f = await full(); const bl = f.lanes.find((l) => l.user_id === b.user.id); punched = f.clips.filter((c) => !before.has(c.id) && c.lane_id === bl?.id); if (punched.length) break; await pa.waitForTimeout(500) }
ok('punch recording keeps only the punch range', punched.length === 1 && punched[0].start_ms >= 1000 && punched[0].start_ms + punched[0].length_ms <= 2000, JSON.stringify(punched))
await ops(a.token, [{ op: 'project', punch_on: false }])
await pb.click('[data-daw-record-solo]')
await pb.waitForFunction(() => window.__parleyStudio?.recording === true, null, { timeout: 10000 })
await pa.waitForTimeout(800)
ok('recording alone: only its starter records, and everyone hears the backing', !(await pa.evaluate(() => window.__parleyStudio?.recording)) && (await pa.evaluate(() => window.__parleyDaw?.playing)) === 'backing')
r = await raw(a.token, 'POST', `/channels/${st.id}/studio/sessions`, {})
ok('and nobody else can start a take meanwhile', r.status === 409)
await pa.waitForTimeout(1500); await pb.click('[data-daw-record-solo]')
await pb.waitForFunction(() => window.__parleyStudio?.recording !== true, null, { timeout: 10000 })
ok('the soloist stops their own take', true)

console.log('-- exports')
await pa.click('[data-daw-export-open]')
const dl = async (sel) => { const [x] = await Promise.all([pa.waitForEvent('download', { timeout: 60000 }), pa.click(sel)]); const path = `/tmp/claude-1002/daw2-${Date.now()}-${x.suggestedFilename().replace(/[^\w.-]/g, '_')}`; await x.saveAs(path); return { name: x.suggestedFilename(), path } }
await pa.locator('[data-daw-export-format]').selectOption('flac')
let file = await dl('[data-daw-export-mix]')
const probe = (p) => JSON.parse(execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', p]).toString())
let pr = probe(file.path)
ok('FLAC export decodes (ffprobe), stereo 48 kHz', file.name.endsWith('.flac') && pr.streams[0].codec_name === 'flac' && pr.streams[0].channels === 2 && Number(pr.format.duration) > 3, JSON.stringify(pr.streams[0]))
execFileSync('ffmpeg', ['-v', 'error', '-i', file.path, '-f', 'null', '-'])
ok('and decodes without errors from start to end', true)
await pa.locator('[data-daw-export-format]').selectOption('mp3')
file = await dl('[data-daw-export-mix]')
pr = probe(file.path)
ok('MP3 export decodes', file.name.endsWith('.mp3') && pr.streams[0].codec_name === 'mp3', JSON.stringify(pr.streams[0]))
file = await dl('[data-daw-export-stems]')
const zipList = execFileSync('unzip', ['-l', file.path]).toString()
ok('stems: one WAV per track, zipped', file.name.endsWith('stems.zip') && /Beat\.wav/.test(zipList) && /Keys\.wav/.test(zipList) && !/Verb\.wav/.test(zipList), zipList)
await pa.locator('[data-daw-post-channel]').selectOption(text.id); await pa.fill('[data-daw-post-text]', 'First mix!')
await pa.click('[data-daw-post]')
let posted
for (let i = 0; i < 40; i++) { posted = (await call(a.token, 'GET', `/channels/${text.id}/messages?limit=5`)).find((m) => m.content === 'First mix!'); if (posted) break; await pa.waitForTimeout(500) }
ok('the mix is posted to a channel as an audio attachment', posted?.attachments?.[0]?.content_type === 'audio/mpeg', JSON.stringify(posted?.attachments))
file = await dl('[data-daw-export-project]')
ok('the project file saves', file.name.endsWith('.parley-project') && /project\.json/.test(execFileSync('unzip', ['-l', file.path]).toString()))
await pa.locator('[data-daw-import-project-file]').setInputFiles({ name: 'copy.parley-project', mimeType: 'application/zip', buffer: readFileSync(file.path) })
let opened
for (let i = 0; i < 60; i++) { opened = (await call(a.token, 'GET', `/channels/${studio.id}/studio/projects`)).find((x) => x.id !== P.id)?.id; if (opened) break; await pa.waitForTimeout(500) }
const copy = opened && opened !== P.id ? await call(a.token, 'GET', `/studio/projects/${opened}`) : null
f = await full()
ok('importing it makes a new project in the studio with the same tracks, clips and routing', !!copy && copy.lanes.length === f.lanes.length && copy.clips.length === f.clips.length && copy.lanes.some((l) => l.kind === 'bus') && copy.lanes.some((l) => Object.keys(l.sends).length === 1) && copy.audio.length >= 1, JSON.stringify({ lanes: copy?.lanes.length, clips: copy?.clips.length }))

console.log('-- phones')
const ph = await mk(b.token, { width: 390, height: 844 }, true)
await ph.waitForSelector('[data-daw]', { timeout: 10000 }).catch(() => {})
ok('phones get the lite DAW: the mixer, play, comments, export; no detailed editing', await ph.locator('[data-daw-mixer]').count() === 1 && await ph.locator('[data-daw-comments-open]').count() === 1 && await ph.locator('[data-daw-versions-open]').count() === 0 && await ph.locator('[data-daw-add-midi]').count() === 0)
await ph.screenshot({ path: 'daw2-phone.png' })

ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
