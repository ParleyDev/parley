// DAWproject: a project exported as a .dawproject (validated against the format's XSD: tracks, buses, sends,
// routing, audio as WAV, MIDI notes, automation, markers, built-in devices) and imported back as a new project.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WEB, B, S, IP, FIX, reg, call, callS, ok, finish } from '../lib.mjs'

const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `DAWproject ${S}` })
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'studio', kind: 'studio' })).body
const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Round Trip', bpm: 110, beats: 4 })).body
const room = P.channel_id
const wav = (sec) => {
  const n = 8000 * sec; const buf = Buffer.alloc(44 + n)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40)
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(80 * Math.sin(i / 3))
  return buf
}
const beat = await (await fetch(`${B}/channels/${room}/studio/audio?name=Beat.wav&duration_ms=4000`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/wav', 'X-Forwarded-For': IP }, body: wav(4) })).json()
const BUS = crypto.randomUUID(), AUD = crypto.randomUUID(), MID = crypto.randomUUID()
let r = await callS(a.token, 'POST', `/studio/projects/${P.id}/ops`, { ops: [
  { op: 'project', markers: [{ id: 'm1', ms: 2000, name: 'Verse' }], tempo_map: [{ bar: 4, bpm: 140, beats: 3 }], master_effects: [{ id: 'l1', type: 'limiter', on: true, params: { ceiling: -1 } }] },
  { op: 'lane.put', lane: { id: BUS, name: 'Reverb Bus', kind: 'bus', position: 0, effects: [{ id: 'r1', type: 'reverb', on: true, params: { size: 3 } }] } },
  { op: 'lane.put', lane: { id: AUD, name: 'Drums', kind: 'audio', position: 1, gain: 0.8, pan: -0.5, effects: [{ id: 'e1', type: 'eq', on: true, params: { low: 3 } }, { id: 'c1', type: 'compressor', on: true, params: { threshold: -20 } }], sends: { [BUS]: 0.4 }, automation: { gain: [[0, 0.5], [2000, 1]] } } },
  { op: 'lane.put', lane: { id: MID, name: 'Keys', kind: 'midi', position: 2, mute: true } },
  { op: 'clip.put', clip: { id: crypto.randomUUID(), lane_id: AUD, audio_id: beat.id, start_ms: 500, in_ms: 250, length_ms: 3000, fade_in_ms: 100 } },
  { op: 'clip.put', clip: { id: crypto.randomUUID(), lane_id: MID, start_ms: 1000, length_ms: 2000, notes: [{ p: 60, t: 0, d: 500, v: 100 }, { p: 64, t: 500, d: 500, v: 90 }] } },
] })
ok('a project with a bus, send, effects, audio, MIDI, automation and a marker', r.status === 200, JSON.stringify(r.body))

const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${room}`)
await p.waitForSelector('[data-daw]', { timeout: 15000 })
await p.click('[data-daw-export-open]')
const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('[data-daw-export-dawproject]')])
const dir = mkdtempSync(join(tmpdir(), 'dawproject-'))
const file = join(dir, dl.suggestedFilename())
await dl.saveAs(file)
ok('it downloads as a .dawproject', dl.suggestedFilename() === 'Round Trip.dawproject')
execFileSync('unzip', ['-q', '-o', file, '-d', join(dir, 'x')])
const xml = readFileSync(join(dir, 'x', 'project.xml'), 'utf8')
const lint = (xsd, f) => { try { execFileSync('xmllint', ['--noout', '--schema', join(FIX, 'dawproject', xsd), f], { stdio: 'pipe' }); return '' } catch (e) { return String(e.stderr) } }
const v1 = lint('Project.xsd', join(dir, 'x', 'project.xml')), v2 = lint('MetaData.xsd', join(dir, 'x', 'metadata.xml'))
ok('project.xml is valid against the DAWproject schema', v1 === '', v1.slice(0, 600))
ok('metadata.xml too', v2 === '', v2.slice(0, 300))
ok('tempo and time signature', /<Tempo [^>]*value="110"/.test(xml) && /<TimeSignature [^>]*numerator="4"/.test(xml))
ok('tracks: audio, MIDI, the bus as an effect channel, and the master', /contentType="audio"[^>]*name="Drums"/.test(xml) && /contentType="notes"[^>]*name="Keys"/.test(xml) && /role="effect"/.test(xml) && /role="master"/.test(xml))
ok('levels, pan (normalized), mute and the send', /name="Volume" unit="linear" value="0.8"/.test(xml) && /name="Pan" unit="normalized" value="0.25"/.test(xml) && /name="Mute" value="true"/.test(xml) && /<Send destination=/.test(xml))
ok('EQ and compressor as built-in devices, reverb noted', /<Equalizer /.test(xml) && /<Compressor /.test(xml) && /Effects not carried over: Reverb/.test(xml))
ok('the audio clip with its offset and fade, its file as WAV', /<Clip time="0.5" duration="3" playStart="0.25"[^>]*fadeInTime="0.1"/.test(xml) && /<File path="audio\/Beat-[0-9a-f]{8}\.wav"\/>/.test(xml) && existsSync(join(dir, 'x', xml.match(/<File path="([^"]+)"/)[1])))
ok('the WAV is real audio', readFileSync(join(dir, 'x', xml.match(/<File path="([^"]+)"/)[1])).subarray(0, 4).toString() === 'RIFF')
ok('MIDI notes', (xml.match(/<Note /g) ?? []).length === 2 && /key="64"/.test(xml))
ok('tempo changes and the master limiter', /<TempoAutomation [^>]*><Target parameter="id\d+"\/><RealPoint time="0" value="110"/.test(xml) && /value="140"/.test(xml) && /<TimeSignaturePoint [^>]*numerator="3"/.test(xml) && /<Limiter /.test(xml))
ok('volume automation and the marker', /<Points [^>]*><Target parameter="id\d+"\/><RealPoint time="0" value="0.5"/.test(xml) && /<Marker time="2" name="Verse"\/>/.test(xml))

// And back in: the studio's Import takes the file as a new project.
await p.goto(`${WEB}/channels/${g.id}/${studio.id}`)
await p.waitForSelector('[data-studio-import]', { timeout: 15000 })
await p.setInputFiles('[data-studio-import-file]', file)
await p.waitForSelector('[data-daw-project-name]', { timeout: 30000 }).catch(() => {})
const cards = await call(a.token, 'GET', `/channels/${studio.id}/studio/projects`)
const back = cards.find((x) => x.id !== P.id)
ok('importing it makes a new project and opens it', !!back && back.name === 'Round Trip' && back.bpm === 110 && p.url().endsWith(back?.channel_id))
const full = await call(a.token, 'GET', `/studio/projects/${back.id}`)
const L = (n) => full.lanes.find((l) => l.name === n)
ok('its tracks come back with their kinds and levels', L('Drums')?.kind === 'audio' && L('Keys')?.kind === 'midi' && L('Reverb Bus')?.kind === 'bus' && Math.abs(L('Drums').gain - 0.8) < 0.01 && Math.abs(L('Drums').pan + 0.5) < 0.01 && L('Keys').mute === true, JSON.stringify(full.lanes.map((l) => [l.name, l.kind, l.gain, l.pan])))
ok('the send to the bus', Math.abs((L('Drums').sends ?? {})[L('Reverb Bus').id] - 0.4) < 0.01)
const ac = full.clips.find((c) => c.lane_id === L('Drums').id), mc = full.clips.find((c) => c.lane_id === L('Keys').id)
ok('the audio clip, re-imported, in place', !!ac?.audio_id && ac.start_ms === 500 && ac.in_ms === 250 && ac.length_ms === 3000 && ac.fade_in_ms === 100, JSON.stringify(ac))
ok('the MIDI notes', mc?.notes?.length === 2 && mc.notes[1].p === 64 && mc.start_ms === 1000)
ok('the automation and the marker', JSON.stringify(L('Drums').automation?.gain) === JSON.stringify([[0, 0.5], [2000, 1]]) && full.project.markers?.[0]?.name === 'Verse' && full.project.markers[0].ms === 2000)
// A file as Bitwig writes them: time in beats, a clip wrapping a clip, audio inside warps, volume in decibels.
const bw = join(dir, 'bw'); execFileSync('mkdir', ['-p', join(bw, 'audio')])
execFileSync('cp', [join(dir, 'x', xml.match(/<File path="([^"]+)"/)[1]), join(bw, 'audio', 'loop.wav')])
const bxml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Project version="1.0"><Application name="Bitwig Studio" version="5.0"/><Transport><Tempo unit="bpm" value="120" id="id0" name="Tempo"/><TimeSignature numerator="4" denominator="4" id="id1"/></Transport><Structure><Track contentType="audio" loaded="true" id="id2" name="Loop" color="#a2eabf"><Channel audioChannels="2" destination="id9" role="regular" solo="false" id="id3"><Mute value="false" id="id4" name="Mute"/><Pan max="1" min="0" unit="normalized" value="0.5" id="id5" name="Pan"/><Volume max="6" min="-144" unit="decibel" value="-6.0206" id="id6" name="Volume"/></Channel></Track><Track contentType="audio notes" loaded="true" id="id8" name="Master"><Channel audioChannels="2" role="master" solo="false" id="id9"><Volume max="2" min="0" unit="linear" value="1" id="id10" name="Volume"/></Channel></Track></Structure><Arrangement id="id11"><Lanes timeUnit="beats" id="id12"><Lanes track="id2" id="id13"><Clips id="id14"><Clip time="4" duration="4" playStart="0"><Clips id="id15"><Clip time="0" duration="4" contentTimeUnit="beats" playStart="0"><Warps contentTimeUnit="seconds" timeUnit="beats" id="id16"><Audio algorithm="stretch" channels="1" duration="4" sampleRate="8000" id="id17"><File path="audio/loop.wav"/></Audio><Warp time="0" contentTime="0"/><Warp time="4" contentTime="2"/></Warps></Clip></Clips></Clip></Clips></Lanes></Lanes><Markers id="id18"><Marker time="8" name="Chorus"/></Markers></Arrangement><Scenes/></Project>`
execFileSync('python3', ['-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1],"w");z.writestr("project.xml",sys.argv[2]);z.write(sys.argv[3],"audio/loop.wav");z.close()', join(dir, 'Bitwig.dawproject'), bxml, join(bw, 'audio', 'loop.wav')])
await p.goto(`${WEB}/channels/${g.id}/${studio.id}`)
await p.waitForSelector('[data-studio-import]', { timeout: 15000 })
await p.setInputFiles('[data-studio-import-file]', join(dir, 'Bitwig.dawproject'))
await p.waitForFunction((n) => document.querySelector('[data-daw-project-name]')?.textContent === n, 'Bitwig', { timeout: 30000 }).catch(() => {})
const bwp = (await call(a.token, 'GET', `/channels/${studio.id}/studio/projects`)).find((x) => x.name === 'Bitwig')
const bfull = bwp && await call(a.token, 'GET', `/studio/projects/${bwp.id}`)
const bclip = bfull?.clips[0]
ok('a Bitwig-style file (beats, nested clips, warps, dB volume) comes in', !!bclip && bclip.start_ms === 2000 && bclip.length_ms === 2000 && Math.abs(bfull.lanes[0].gain - 0.5) < 0.01 && bfull.project.markers?.[0]?.ms === 4000, JSON.stringify({ clips: bfull?.clips, lanes: bfull?.lanes?.map((l) => [l.name, l.gain]), markers: bfull?.project.markers }))
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
