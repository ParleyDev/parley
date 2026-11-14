// What the studio's DAW renders, measured: test signals (a constant level, a sine, clicks) go through a project and
// the offline render that exports use is read back as samples. Levels, the pan law, mutes and solos, clip placement
// to the sample, fades, automation, buses and sends, stems, the exported WAV (24-bit, and 16-bit with dither, from a
// device at any rate) and the mixer's meters are checked against what the mix should be, not against what the screen
// shows. No voice room is needed: the project's manager has the DAW without joining.
import { WEB, B, S, IP, BROWSER, reg, call, callS, ok, finish, launchBrowser } from '../lib.mjs'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { wavFile, parseWav, dc, sine, impulses, pullRender, pullWav, liveRate, mean, rms, peak, at, near, onsets, maxDiff, panLaw, db } from '../audio.mjs'

const parseWavFile = (path) => parseWav(readFileSync(path))

const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Render ${S}` })
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'render', kind: 'studio' })).body
const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Render', bpm: 120 })).body
const st = await call(a.token, 'GET', `/channels/${P.channel_id}`)
const importAudio = async (name, body, dur) => (await fetch(`${B}/channels/${st.id}/studio/audio?name=${encodeURIComponent(name)}&duration_ms=${dur}`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/wav', 'X-Forwarded-For': IP }, body })).json()

// The signals: two seconds each, 48 kHz unless said.
const DC = await importAudio('dc.wav', wavFile({ seconds: 2, signal: dc(0.5) }), 2000)
const HOT = await importAudio('hot.wav', wavFile({ seconds: 2, signal: dc(0.9) }), 2000)
const WIDE = await importAudio('wide.wav', wavFile({ seconds: 2, signal: [dc(0.5), dc(0.25)] }), 2000)
const TONE = await importAudio('tone.wav', wavFile({ seconds: 2, signal: sine(1000, 0.5) }), 2000)
const TONE44 = await importAudio('tone44.wav', wavFile({ seconds: 2, rate: 44100, signal: sine(1000, 0.5) }), 2000)
const CLICKS = await importAudio('clicks.wav', wavFile({ seconds: 2, signal: impulses([100, 500]) }), 2000)
ok('the test signals are imported', [DC, HOT, WIDE, TONE, TONE44, CLICKS].every((x) => x.id && x.duration_ms === 2000), JSON.stringify(DC))

const browser = await launchBrowser({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await page.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await page.goto(`${WEB}/channels/${g.id}/${st.id}`)
await page.waitForSelector('[data-daw]', { timeout: 20000 })
await page.waitForFunction(() => !!window.__parleyDawTest)
ok('an empty project renders nothing', (await pullRender(page)) === null)
const RATE = await liveRate(page)
// The DAW decodes files at the device's rate and renders at 48 kHz: at another device rate everything is resampled
// twice, so clicks smear and positions are only near.
const exact = RATE === 48000
console.log(`   (${BROWSER}: the page's audio runs at ${RATE} Hz; ${exact ? 'sample-exact checks on' : 'positions checked to 1 ms only'})`)

let lanes = []
const id = () => crypto.randomUUID()
/**
 * Replace the project's content in one change: `spec` is a list of lanes ({ ...lane fields, key, clips: [...] }),
 * `proj` project fields. Returns the lanes' ids by key, once the page has the change.
 */
async function scene(spec, proj = {}) {
  const ops = lanes.map((l) => ({ op: 'lane.del', id: l })), ids = {}
  for (const l of spec) ids[l.key] = id()
  let last = null
  const puts = [], clips = []
  spec.forEach((l, i) => {
    const { key, clips: cs = [], out, sends, automation, solo, ...rest } = l
    const fix = (m) => m && Object.fromEntries(Object.entries(m).map(([k, v]) => [k.replace(/^(send:)?(\w+)$/, (s, p, n) => (ids[n] ? (p ?? '') + ids[n] : s)), v]))
    puts.push({ op: 'lane.put', lane: { id: ids[key], name: key, position: i, ...rest, ...(out ? { output_id: ids[out] } : {}), ...(sends ? { sends: fix(sends) } : {}), ...(automation ? { automation: fix(automation) } : {}) } })
    for (const c of cs) { last = id(); clips.push({ op: 'clip.put', clip: { id: last, lane_id: ids[key], start_ms: 0, length_ms: 2000, ...c, audio_id: c.audio.id, audio: undefined } }) }
  })
  // Buses first: a lane's output and sends must exist.
  puts.sort((x, y) => (y.lane.kind === 'bus') - (x.lane.kind === 'bus'))
  const r = await callS(a.token, 'POST', `/studio/projects/${P.id}/ops`, { ops: [...ops, { op: 'project', master_gain: 1, master_effects: [], ...proj }, ...puts, ...clips] })
  if (r.status !== 200) throw new Error(`scene refused: ${r.status} ${JSON.stringify(r.body)}`)
  lanes = Object.values(ids)
  // The clip with its waveform: the page has the change and has decoded the audio (audio it had not seen is fetched
  // after the change arrives, and a render before that would leave it out).
  await page.waitForSelector(`[data-daw-clip="${last}"] [data-daw-wave="1"]`, { timeout: 10000 })
  // A solo is its listener's: it is set in the page, not in the project the server has.
  for (const l of spec) if (l.solo) await page.evaluate((lid) => window.__parleyDawTest.edit([{ op: 'lane.put', lane: { id: lid, solo: true } }]), ids[l.key])
  return ids
}
const one = (clip = {}, lane = {}) => [{ key: 'a', kind: 'audio', ...lane, clips: [{ audio: DC, ...clip }] }]
/** The steady level of both channels (mean over the middle second). */
const level = (r) => [mean(r.samples[0], r.rate, 500, 1500), mean(r.samples[1], r.rate, 500, 1500)]
const both = (r, l, rr, tol) => { const [x, y] = level(r); return near(x, l, tol) && near(y, rr, tol) }
const show = (r) => level(r).map((v) => v.toFixed(5)).join(' / ')
const C = Math.SQRT1_2

console.log('-- level and pan')
await scene(one())
let r = await pullRender(page)
ok('the render is stereo at 48 kHz, as long as the project plus a short tail', r.rate === 48000 && r.samples.length === 2 && r.frames === Math.ceil(2.1 * 48000), `${r.rate} ${r.frames}`)
ok('a mono signal in the centre is 3 dB down on each side (equal-power pan)', both(r, 0.5 * C, 0.5 * C), show(r))
ok('it starts with the clip and ends with it', near(at(r.samples[0], r.rate, 5), 0.5 * C, 2e-3) && near(at(r.samples[0], r.rate, 1995), 0.5 * C, 2e-3) && peak(r.samples[0], r.rate, 2010) < 1e-3, `${at(r.samples[0], r.rate, 5)} ${at(r.samples[0], r.rate, 1995)} ${peak(r.samples[0], r.rate, 2010)}`)
await scene(one({}, { gain: 0.5 }))
r = await pullRender(page)
ok('a fader at half is 6 dB down', both(r, 0.25 * C, 0.25 * C) && near(db(level(r)[0] / (0.5 * C)), -6.02, 0.05), show(r))
await scene(one({}, { pan: -1 })); r = await pullRender(page)
ok('panned hard left it is all on the left, at full level', both(r, 0.5, 0), show(r))
await scene(one({}, { pan: 1 })); r = await pullRender(page)
ok('panned hard right, all on the right', both(r, 0, 0.5), show(r))
await scene(one({}, { pan: 0.5 })); r = await pullRender(page)
ok('half right follows the pan law', both(r, 0.5 * panLaw(0.5)[0], 0.5 * panLaw(0.5)[1]), show(r))
await scene(one({ audio: WIDE })); r = await pullRender(page)
ok('a stereo file in the centre keeps its sides as they are', both(r, 0.5, 0.25), show(r))
await scene(one({ audio: WIDE }, { pan: -1 })); r = await pullRender(page)
ok('a stereo file panned hard left folds its right into the left', both(r, 0.75, 0), show(r))
await scene(one({ gain: 0.5 })); r = await pullRender(page)
ok('a clip\'s gain scales the clip', both(r, 0.25 * C, 0.25 * C), show(r))
await scene(one(), { master_gain: 0.5 }); r = await pullRender(page)
ok('the master fader scales the mix', both(r, 0.25 * C, 0.25 * C), show(r))
await scene([{ key: 'a', kind: 'audio', clips: [{ audio: DC }] }, { key: 'b', kind: 'audio', clips: [{ audio: DC }] }]); r = await pullRender(page)
ok('two tracks add up', both(r, C, C), show(r))

console.log('-- mute and solo')
await scene([{ key: 'a', kind: 'audio', pan: -1, clips: [{ audio: DC }] }, { key: 'b', kind: 'audio', pan: 1, mute: true, clips: [{ audio: DC }] }]); r = await pullRender(page)
ok('a muted track is not in the mix', both(r, 0.5, 0), show(r))
await scene([{ key: 'a', kind: 'audio', pan: -1, clips: [{ audio: DC }] }, { key: 'b', kind: 'audio', pan: 1, solo: true, clips: [{ audio: DC }] }]); r = await pullRender(page)
ok('solo is for listening: the render an export makes has every unmuted track', both(r, 0.5, 0.5), show(r))
r = await pullRender(page, undefined, true)
ok('what is heard has the soloed track alone', both(r, 0, 0.5), show(r))
await scene([{ key: 'a', kind: 'audio', pan: -1, clips: [{ audio: DC, muted: true }, { audio: DC, gain: 0.5 }] }]); r = await pullRender(page)
ok('a muted clip is silent, the others on its track play', both(r, 0.25, 0), show(r))

console.log('-- where clips sit')
const tol = exact ? 0 : 48
const clicks = (x) => onsets(x, 48000, 0.05, 50)
const sameAt = (got, want) => got.length === want.length && got.every((v, i) => Math.abs(v - want[i]) <= tol)
await scene(one({ audio: CLICKS }, { pan: -1 })); r = await pullRender(page)
ok('clicks at 100 and 500 ms of a clip at 0 come out at 100 and 500 ms', sameAt(clicks(r.samples[0]), [4800, 24000]), clicks(r.samples[0]).join(','))
if (exact) ok('each a single sample at its level, nothing around it', near(r.samples[0][4800], 0.9, 1e-3) && Math.abs(r.samples[0][4799]) < 1e-4 && Math.abs(r.samples[0][4801]) < 1e-4, `${r.samples[0][4799]} ${r.samples[0][4800]} ${r.samples[0][4801]}`)
await scene(one({ audio: CLICKS, start_ms: 250 }, { pan: -1 })); r = await pullRender(page)
ok('moved to 250 ms they come out 250 ms later', sameAt(clicks(r.samples[0]), [16800, 36000]), clicks(r.samples[0]).join(','))
await scene(one({ audio: CLICKS, start_ms: 250, in_ms: 300, length_ms: 400 }, { pan: -1 })); r = await pullRender(page)
ok('trimmed to start 300 ms in, only the second click plays, 200 ms into the clip', sameAt(clicks(r.samples[0]), [21600]) && r.frames === Math.ceil(0.75 * 48000), `${clicks(r.samples[0]).join(',')} ${r.frames}`)
await scene(one({ audio: CLICKS }, { pan: -1, nudge_ms: 20 })); r = await pullRender(page)
ok('a track nudged 20 ms plays 20 ms late', sameAt(clicks(r.samples[0]), [5760, 24960]), clicks(r.samples[0]).join(','))
await scene(one({ audio: TONE })); const whole = await pullRender(page)
await scene([{ key: 'a', kind: 'audio', clips: [{ audio: TONE, length_ms: 700 }, { audio: TONE, start_ms: 700, in_ms: 700, length_ms: 1300 }] }]); r = await pullRender(page)
ok('a clip split in two sounds like the clip', maxDiff(whole.samples[0], r.samples[0], 48000) < 1e-4, String(maxDiff(whole.samples[0], r.samples[0], 48000)))
ok('a sine at -6 dBFS measures as one', near(rms(whole.samples[0], 48000, 500, 1500), 0.5 * C * C, 1e-3) && near(peak(whole.samples[0], 48000, 500, 1500), 0.5 * C, 1e-3), `${rms(whole.samples[0], 48000, 500, 1500)} ${peak(whole.samples[0], 48000, 500, 1500)}`)
await scene(one({ audio: TONE44 })); r = await pullRender(page)
const crossings = (x, a0, b0) => { let n = 0; for (let i = a0 + 1; i < b0; i++) if (x[i - 1] < 0 !== x[i] < 0) n++; return n }
ok('a 44.1 kHz file plays at its pitch and level in the 48 kHz render', Math.abs(crossings(r.samples[0], 24000, 72000) - 2000) <= 2 && near(rms(r.samples[0], 48000, 500, 1500), 0.5 * C * C, 2e-3), `${crossings(r.samples[0], 24000, 72000)} ${rms(r.samples[0], 48000, 500, 1500)}`)

console.log('-- fades and automation')
await scene(one({ fade_in_ms: 500, fade_out_ms: 500 }, { pan: -1 })); r = await pullRender(page)
const L = (ms) => at(r.samples[0], r.rate, ms)
ok('a fade in rises in a straight line', near(L(125), 0.125, 2e-3) && near(L(250), 0.25, 2e-3) && near(L(375), 0.375, 2e-3) && near(L(500), 0.5, 2e-3), [125, 250, 375, 500].map(L).join(' '))
ok('between the fades the clip is at its level', near(L(1000), 0.5) && near(L(1499), 0.5, 2e-3))
ok('a fade out falls in a straight line to nothing', near(L(1510), 0.49, 2e-3) && near(L(1625), 0.375, 2e-3) && near(L(1750), 0.25, 2e-3) && near(L(1875), 0.125, 2e-3) && Math.abs(L(1999)) < 2e-3, [1510, 1625, 1750, 1875, 1999].map(L).join(' '))
await scene(one({ fade_in_ms: 500, gain: 0.5 }, { pan: -1 })); r = await pullRender(page)
ok('fades scale with the clip\'s gain', near(L(250), 0.125, 2e-3) && near(L(1000), 0.25), `${L(250)} ${L(1000)}`)
await scene(one({}, { pan: -1, automation: { gain: [[0, 1], [1000, 0], [1500, 0.5]] } })); r = await pullRender(page)
ok('volume automation ramps between its points and holds after the last', near(L(250), 0.375, 2e-3) && near(L(500), 0.25, 2e-3) && near(L(1000), 0, 2e-3) && near(L(1250), 0.125, 2e-3) && near(L(1800), 0.25, 2e-3), [250, 500, 1000, 1250, 1800].map(L).join(' '))
await scene(one({}, { automation: { pan: [[0, -1], [2000, 1]] } })); r = await pullRender(page)
ok('pan automation sweeps from one side to the other', near(at(r.samples[0], 48000, 10), 0.5, 5e-3) && near(at(r.samples[1], 48000, 10), 0, 5e-3) && near(at(r.samples[0], 48000, 1000), 0.5 * C, 2e-3) && near(at(r.samples[1], 48000, 1000), 0.5 * C, 2e-3) && near(at(r.samples[1], 48000, 1990), 0.5, 5e-3), [10, 1000, 1990].map((ms) => `${at(r.samples[0], 48000, ms)}/${at(r.samples[1], 48000, ms)}`).join(' '))

console.log('-- buses and sends')
await scene([{ key: 'bus', kind: 'bus', gain: 0.5 }, { key: 'a', kind: 'audio', pan: -1, out: 'bus', clips: [{ audio: DC }] }]); r = await pullRender(page)
ok('a track sent to a bus is heard through the bus, at the bus\'s level', both(r, 0.25, 0), show(r))
await scene([{ key: 'bus', kind: 'bus' }, { key: 'a', kind: 'audio', pan: -1, sends: { bus: 0.5 }, clips: [{ audio: DC }] }]); r = await pullRender(page)
ok('a send adds the track to the bus on top of its own output', both(r, 0.75, 0), show(r))
await scene([{ key: 'bus', kind: 'bus' }, { key: 'a', kind: 'audio', pan: -1, sends_only: true, sends: { bus: 0.5 }, clips: [{ audio: DC }] }]); r = await pullRender(page)
ok('"sends only" is heard through its sends alone', both(r, 0.25, 0), show(r))
await scene([{ key: 'bus', kind: 'bus', mute: true }, { key: 'a', kind: 'audio', pan: -1, sends: { bus: 0.5 }, clips: [{ audio: DC }] }]); r = await pullRender(page)
ok('a muted bus takes its sends out of the mix', both(r, 0.5, 0), show(r))
await scene([{ key: 'bus', kind: 'bus' }, { key: 'a', kind: 'audio', pan: -1, gain: 0.5, sends: { bus: 1 }, sends_only: true, clips: [{ audio: DC }] }]); r = await pullRender(page)
ok('sends are after the fader', both(r, 0.25, 0), show(r))

console.log('-- effects')
const eq = (on, params = { mid: 6, midFreq: 1000 }) => [{ id: 'e1', type: 'eq', on, params }]
await scene(one({ audio: TONE }, { effects: eq(false) })); r = await pullRender(page)
ok('a bypassed effect changes nothing', maxDiff(whole.samples[0], r.samples[0], 48000) < 1e-5, String(maxDiff(whole.samples[0], r.samples[0], 48000)))
await scene(one({ audio: TONE }, { effects: eq(true) })); r = await pullRender(page)
const boost = db(rms(r.samples[0], 48000, 500, 1500) / rms(whole.samples[0], 48000, 500, 1500))
ok('an EQ band lifting 1 kHz by 6 dB lifts a 1 kHz tone by 6 dB', near(boost, 6, 0.3), boost.toFixed(2))
await scene(one({ audio: TONE }), { master_effects: eq(true) }); const mastered = await pullRender(page)
ok('the same EQ on the master does the same', near(db(rms(mastered.samples[0], 48000, 500, 1500) / rms(whole.samples[0], 48000, 500, 1500)), boost, 0.05))
await scene(one({ audio: TONE }, { effects: [{ id: 'r1', type: 'reverb', on: true, params: {} }] })); r = await pullRender(page)
ok('a reverb gets three seconds to ring out, and rings', r.frames === Math.ceil(5 * 48000) && rms(r.samples[0], 48000, 2100, 2600) > 1e-4, `${r.frames} ${rms(r.samples[0], 48000, 2100, 2600)}`)

console.log('-- stems')
const three = (solo) => [{ key: 'a', kind: 'audio', pan: -1, clips: [{ audio: DC }] }, { key: 'b', kind: 'audio', pan: 1, gain: 0.5, clips: [{ audio: TONE }] }, { key: 'c', kind: 'audio', solo, clips: [{ audio: CLICKS }] }]
let ids = await scene(three(false))
const all = await pullRender(page)
const sa = await pullRender(page, [ids.a]), sb = await pullRender(page, [ids.b]), sc = await pullRender(page, [ids.c])
ok('a stem is its track alone', both(sa, 0.5, 0) && near(rms(sb.samples[1], 48000, 500, 1500), 0.25 * C, 1e-3) && rms(sb.samples[0], 48000, 500, 1500) < 1e-4 && (exact ? near(peak(sc.samples[0], 48000), 0.9 * C, 1e-3) : peak(sc.samples[0], 48000) > 0.3), `${show(sa)} ${rms(sb.samples[1], 48000, 500, 1500)} ${peak(sc.samples[0], 48000)}`)
ok('stems are as long as the mix', sa.frames === all.frames && sb.frames === all.frames && sc.frames === all.frames)
const sum = [0, 1].map((ch) => Float32Array.from(all.samples[ch], (_, i) => sa.samples[ch][i] + sb.samples[ch][i] + sc.samples[ch][i]))
ok('with nothing on the master, the stems add up to the mix', maxDiff(sum[0], all.samples[0], 48000) < 1e-4 && maxDiff(sum[1], all.samples[1], 48000) < 1e-4, `${maxDiff(sum[0], all.samples[0], 48000)} ${maxDiff(sum[1], all.samples[1], 48000)}`)
ids = await scene(three(true))
r = await pullRender(page)
ok('a solo does not change the exported mix', maxDiff(r.samples[0], all.samples[0], 48000) < 1e-6 && maxDiff(r.samples[1], all.samples[1], 48000) < 1e-6, `${maxDiff(r.samples[0], all.samples[0], 48000)}`)
r = await pullRender(page, undefined, true)
ok('heard, the soloed track is alone', maxDiff(r.samples[0], sc.samples[0], 48000) < 1e-4 && rms(r.samples[1], 48000, 600, 1500) < 1e-3, `${maxDiff(r.samples[0], sc.samples[0], 48000)}`)
r = await pullRender(page, [ids.c])
ok('the soloed track\'s stem is its track', maxDiff(r.samples[0], sc.samples[0], 48000) < 1e-4)
r = await pullRender(page, [ids.a])
ok('while a track is soloed, the stems of the others are what they were', maxDiff(r.samples[0], sa.samples[0], 48000) < 1e-6 && maxDiff(r.samples[1], sa.samples[1], 48000) < 1e-6, `${peak(r.samples[0], 48000)}`)
ids = await scene([{ key: 'a', kind: 'audio', pan: -1, clips: [{ audio: DC }] }, { key: 'b', kind: 'audio', pan: 1, mute: true, clips: [{ audio: DC }] }])
r = await pullRender(page, [ids.b])
ok('a muted track\'s stem is silent, as the track is in the mix', peak(r.samples[0], 48000) < 1e-6 && peak(r.samples[1], 48000) < 1e-6, show(r))
ids = await scene([{ key: 'bus', kind: 'bus', gain: 0.5 }, { key: 'a', kind: 'audio', pan: -1, out: 'bus', clips: [{ audio: DC }] }, { key: 'b', kind: 'audio', pan: 1, clips: [{ audio: DC }] }])
r = await pullRender(page, [ids.a])
ok('a stem of a track on a bus comes through its bus', both(r, 0.25, 0), show(r))

console.log('-- the exported file')
await scene([{ key: 'a', kind: 'audio', pan: -1, clips: [{ audio: DC }] }, { key: 'b', kind: 'audio', pan: 1, gain: 0.5, clips: [{ audio: TONE }] }])
r = await pullRender(page)
let w = await pullWav(page)
ok('the export is a 24-bit stereo 48 kHz PCM WAV', w.riff === 'RIFF' && w.wave === 'WAVE' && w.format === 1 && w.channels === 2 && w.rate === 48000 && w.bits === 24 && w.blockAlign === 6 && w.byteRate === 288000, JSON.stringify({ ...w, samples: undefined }))
ok('its sizes add up to the render\'s length', w.frames === r.frames && w.dataSize === r.frames * 6 && w.size === 44 + w.dataSize && w.riffSize === w.size - 8, `${w.frames} ${r.frames} ${w.size}`)
// Rounded to the nearest of 2^24 steps: never more than half a step off.
const STEP24 = 1 / 8388608, STEP16 = 1 / 32768
ok('its samples are the render\'s, to half a 24-bit step', maxDiff(w.samples[0], r.samples[0], 48000) <= 0.51 * STEP24 && maxDiff(w.samples[1], r.samples[1], 48000) <= 0.51 * STEP24, `${maxDiff(w.samples[0], r.samples[0], 48000) / STEP24} ${maxDiff(w.samples[1], r.samples[1], 48000) / STEP24} steps`)
let w16 = await pullWav(page, 16)
ok('asked for 16 bits, it is a 16-bit file of the same length', w16.bits === 16 && w16.blockAlign === 4 && w16.byteRate === 192000 && w16.frames === r.frames && w16.dataSize === r.frames * 4, JSON.stringify({ ...w16, samples: undefined }))
// Dither of one step either way, then rounding: never more than a step and a half off.
ok('its samples are the render\'s, to a step and a half of 16 bits', maxDiff(w16.samples[0], r.samples[0], 48000) <= 1.51 * STEP16 && maxDiff(w16.samples[1], r.samples[1], 48000) <= 1.51 * STEP16, `${maxDiff(w16.samples[0], r.samples[0], 48000) / STEP16} ${maxDiff(w16.samples[1], r.samples[1], 48000) / STEP16} steps`)
const again = await pullWav(page, 16)
ok('the same project gives the same 16-bit file twice', maxDiff(again.samples[0], w16.samples[0], 48000) === 0 && maxDiff(again.samples[1], w16.samples[1], 48000) === 0)

console.log('-- a quiet tone: 24 bits, and 16 with dither')
// A 1 kHz sine with its peak at -60 dBFS: 33 steps of 16 bits from top to bottom.
await scene(one({ audio: TONE, gain: 0.002 }, { pan: -1 }))
r = await pullRender(page); w = await pullWav(page); w16 = await pullWav(page, 16)
const QUIET = 0.001 * C
ok('the render has it at -60 dBFS', near(db(rms(r.samples[0], 48000, 500, 1500) / QUIET), 0, 0.05), db(rms(r.samples[0], 48000, 500, 1500) / QUIET).toFixed(3))
ok('the 24-bit file has it within 0.1 dB', near(db(rms(w.samples[0], 48000, 500, 1500) / QUIET), 0, 0.1), db(rms(w.samples[0], 48000, 500, 1500) / QUIET).toFixed(4))
ok('so does the 16-bit file', near(db(rms(w16.samples[0], 48000, 500, 1500) / QUIET), 0, 0.1), db(rms(w16.samples[0], 48000, 500, 1500) / QUIET).toFixed(4))
// What 16 bits took away, in steps, over the middle second: the tone repeats every 48 samples, so an error that
// followed the tone would repeat with it.
const err = Float64Array.from({ length: 48000 }, (_, i) => (w16.samples[0][24000 + i] - r.samples[0][24000 + i]) / STEP16)
const errRms = Math.sqrt(err.reduce((s, v) => s + v * v, 0) / err.length)
const corr = (x, y) => { let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += x[i] * y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i] } return sxy / Math.sqrt(sxx * syy || 1) }
const period = corr(err.subarray(0, 47952), err.subarray(48)), withTone = corr(err, Float64Array.from({ length: 48000 }, (_, i) => r.samples[0][24000 + i]))
ok('the error is noise of half a step', errRms > 0.45 && errRms < 0.55, errRms.toFixed(4))
ok('it does not repeat with the tone, and does not follow it', Math.abs(period) < 0.03 && Math.abs(withTone) < 0.03, `${period.toFixed(4)} ${withTone.toFixed(4)}`)
// The same without dither, for the measure of it: rounded only, the error repeats with the tone exactly.
const bare = Float64Array.from({ length: 48000 }, (_, i) => { const v = r.samples[0][24000 + i] / STEP16; return Math.round(v) - v })
ok('(rounded without dither, it would repeat with the tone)', corr(bare.subarray(0, 47952), bare.subarray(48)) > 0.9, corr(bare.subarray(0, 47952), bare.subarray(48)).toFixed(4))

console.log('-- over full scale')
await scene([{ key: 'a', kind: 'audio', pan: -1, clips: [{ audio: HOT }] }, { key: 'b', kind: 'audio', pan: -1, clips: [{ audio: HOT }] }])
r = await pullRender(page); w = await pullWav(page); w16 = await pullWav(page, 16)
// Nothing limits the mix: the file clips what is over full scale, and the export says by how much.
ok('a mix over full scale renders over full scale', near(level(r)[0], 1.8, 2e-3), show(r))
ok('the file clips it at full scale, at 24 bits and at 16', near(mean(w.samples[0], 48000, 500, 1500), 8388607 / 8388608, 1e-6) && near(mean(w16.samples[0], 48000, 500, 1500), 32767 / 32768, 1e-6), `${mean(w.samples[0], 48000, 500, 1500)} ${mean(w16.samples[0], 48000, 500, 1500)}`)
const downloads = mkdtempSync(join(tmpdir(), 'render-'))
const dl = async (sel) => { const [x] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click(sel)]); const path = join(downloads, `${Date.now()}-${x.suggestedFilename().replace(/[^\w.-]/g, '_')}`); await x.saveAs(path); return { name: x.suggestedFilename(), path } }
await page.click('[data-daw-export-open]')
let file = await dl('[data-daw-export-mix]')
const OVER = 20 * Math.log10(1.8)
let said = await page.evaluate(() => ({ over: window.__parleyDawOver, shown: document.querySelector('[data-daw-export-over]')?.getAttribute('data-daw-export-over') ?? null, format: window.__parleyDawFormat }))
ok('exporting it says how far over it is (5.1 dB)', near(said.over, OVER, 0.01) && near(Number(said.shown), OVER, 0.01), JSON.stringify(said))
w = parseWavFile(file.path)
ok('the file the export saves is the 24-bit WAV', file.name.endsWith('.wav') && said.format === 'wav' && w.bits === 24 && w.frames === r.frames, `${file.name} ${w.bits} ${w.frames}`)
await page.locator('[data-daw-export-format]').selectOption('wav16')
file = await dl('[data-daw-export-mix]'); w = parseWavFile(file.path)
ok('or, chosen, the 16-bit one', file.name.endsWith('.wav') && w.bits === 16 && w.frames === r.frames, `${file.name} ${w.bits} ${w.frames}`)
await page.locator('[data-daw-export-format]').selectOption('wav')
ids = await scene(three(true).concat([{ key: 'd', kind: 'audio', mute: true, clips: [{ audio: HOT }] }]))
r = await pullRender(page)
file = await dl('[data-daw-export-stems]')
const zipList = execFileSync('unzip', ['-l', file.path]).toString()
const stemBytes = await page.evaluate(() => window.__parleyDawStemBytes)
ok('stems: a 24-bit WAV for each track in the mix, the soloed and the others, not the muted', /\ba\.wav/.test(zipList) && /\bb\.wav/.test(zipList) && /\bc\.wav/.test(zipList) && !/\bd\.wav/.test(zipList), zipList)
ok('each as long as the mix', stemBytes.length === 3 && stemBytes.every((n) => n === 44 + r.frames * 6), `${stemBytes} ${r.frames}`)
ok('an export within full scale says nothing about clipping', (await page.locator('[data-daw-export-over]').count()) === 0)
await page.click('[data-daw-export-open]')

console.log('-- meters')
// A stereo sine at full scale, six seconds: its peak is 0 dBFS and its RMS 3.01 dB under.
const FULL = await importAudio('full.wav', wavFile({ seconds: 6, signal: [sine(1000, 1), sine(1000, 1)] }), 6000)
const reading = (id) => page.evaluate((i) => window.__parleyDawTest.meter(i), id)
const shown = (id) => page.evaluate((i) => { const d = document.querySelector(`[data-console-meter="${i}"]`)?.dataset; return d ? { peak: Number(d.peakDb), rms: Number(d.rmsDb), clip: d.clip } : null }, id)
const playing = () => page.waitForFunction(() => ['local', 'shared'].includes(window.__parleyDaw?.playing) && window.__parleyDaw.sources > 0, null, { timeout: 8000 })
ids = await scene([{ key: 'a', kind: 'audio', clips: [{ audio: FULL, length_ms: 6000 }] }])
ok('stopped, a meter reads nothing', (await reading(ids.a)) === null && (await reading('master')) === null)
await page.click('[data-daw-view-mixer]'); await page.waitForSelector('[data-daw-mixer]')
await page.click('[data-daw-rtz]'); await page.click('[data-daw-play]'); await playing()
await page.waitForTimeout(3000)
let m = await reading(ids.a), mm = await reading('master'), ui = await shown(ids.a)
// A device at another rate resamples the file, and the peaks between its samples come out a little over.
const ptol = exact ? 0.05 : 0.5
ok('a full-scale sine reads 0 dBFS peak on its strip', near(db(m.peak), 0, ptol), db(m.peak).toFixed(3))
ok('and -3.01 dBFS RMS, within 0.1 dB', near(db(m.rms), -3.01, 0.1), db(m.rms).toFixed(3))
ok('the master reads the same', near(db(mm.peak), 0, ptol) && near(db(mm.rms), -3.01, 0.1), `${db(mm.peak).toFixed(3)} ${db(mm.rms).toFixed(3)}`)
ok('the strip on screen shows those figures', ui && near(ui.peak, 0, ptol + 0.05) && near(ui.rms, -3.0, 0.15), JSON.stringify(ui))
if (exact) ok('at full scale and not over it, nothing is marked as clipped', m.clip === false && mm.clip === false && ui.clip === '0', JSON.stringify({ m, mm, ui }))
await page.click('[data-daw-play]')
await page.waitForFunction(() => !window.__parleyDaw?.playing, null, { timeout: 5000 })
await page.evaluate(() => window.__parleyDawTest.clearClip())
// One decibel more on the fader.
await page.click('[data-daw-view-arrange]')
ids = await scene([{ key: 'a', kind: 'audio', gain: 1.122, clips: [{ audio: FULL, length_ms: 6000 }] }])
await page.click('[data-daw-view-mixer]'); await page.waitForSelector('[data-daw-mixer]')
await page.click('[data-daw-rtz]'); await page.click('[data-daw-play]'); await playing()
await page.waitForTimeout(2500)
m = await reading(ids.a); mm = await reading('master')
ok('one dB over reads +1 dBFS', near(db(m.peak), 1, ptol) && near(db(m.rms), -2.01, 0.1), `${db(m.peak).toFixed(3)} ${db(m.rms).toFixed(3)}`)
ok('and marks the strip and the master as clipped', m.clip === true && mm.clip === true, JSON.stringify({ m, mm }))
await page.click('[data-daw-play]')
await page.waitForFunction(() => !window.__parleyDaw?.playing, null, { timeout: 5000 })
await page.waitForTimeout(300)
const led = (id) => page.evaluate((i) => document.querySelector(`[data-console-clip="${i}"]`)?.dataset.on ?? null, id)
ok('the mark stays after the music stops', (await led(ids.a)) === '1' && (await led('master')) === '1', `${await led(ids.a)} ${await led('master')}`)
await page.click(`[data-console-clip="${ids.a}"]`); await page.waitForTimeout(200)
ok('until it is clicked away, each on its own', (await led(ids.a)) === '0' && (await led('master')) === '1', `${await led(ids.a)} ${await led('master')}`)
await page.click('[data-console-clip="master"]'); await page.click('[data-daw-view-arrange]')

console.log('-- a device at another rate')
// The same project on a device that runs at 44.1 kHz: the export must be the same file.
await scene([{ key: 'a', kind: 'audio', pan: -1, clips: [{ audio: DC }, { audio: CLICKS, start_ms: 2000 }] }, { key: 'b', kind: 'audio', pan: 1, gain: 0.5, clips: [{ audio: TONE }] }, { key: 'c', kind: 'audio', clips: [{ audio: TONE44, start_ms: 500 }] }])
const ref = await pullWav(page)
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx2.addInitScript(() => { window.__parleyDawDeviceRate = 44100 })
const page2 = await ctx2.newPage(); page2.on('pageerror', (e) => errors.push(e.message))
await page2.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await page2.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await page2.goto(`${WEB}/channels/${g.id}/${st.id}`)
await page2.waitForFunction(() => document.querySelectorAll('[data-daw-clip] [data-daw-wave="1"]').length === 4, null, { timeout: 20000 })
const rate2 = await liveRate(page2)
ok('the second page\'s audio runs at 44.1 kHz', rate2 === 44100, String(rate2))
const other = await pullWav(page2)
ok('its export is a 48 kHz file of the same length', other.rate === 48000 && other.frames === ref.frames && other.bits === 24, `${other.rate} ${other.frames} ${ref.frames}`)
const d0 = maxDiff(other.samples[0], ref.samples[0], 48000), d1 = maxDiff(other.samples[1], ref.samples[1], 48000)
if (exact) ok('and the same samples, every one', d0 === 0 && d1 === 0, `${d0 / STEP24} ${d1 / STEP24} steps`)
else ok('and the same samples (both pages render from files decoded at 48 kHz)', d0 === 0 && d1 === 0, `${d0 / STEP24} ${d1 / STEP24} steps`)

console.log('-- audio that cannot be had')
await page2.route(/\/studio\/tracks\//, (rt) => rt.abort())
// WebKit answers a file it has had before from its cache without asking, past the route: the page's own fetch fails too.
await page2.evaluate(() => { const f = window.fetch; window.fetch = (u, o) => (/\/studio\/tracks\//.test(String(u?.url ?? u)) ? Promise.reject(new TypeError('offline')) : f(u, o)) })
const failed = await page2.evaluate(() => window.__parleyDawTest.wav().then((x) => ({ bytes: x?.byteLength ?? 0 }), (e) => ({ error: String(e.message ?? e) })))
ok('a render that cannot get a file fails and says which, rather than leaving it out', /Could not load "(dc|clicks|tone|tone44)\.wav"/.test(failed.error ?? ''), JSON.stringify(failed))
await page2.click('[data-daw-export-open]'); await page2.click('[data-daw-export-mix]')
const told = await page2.waitForFunction(() => /Could not load/.test(document.body.innerText), null, { timeout: 10000 }).then(() => true, () => false)
ok('the member exporting is told', told)
await page2.unroute(/\/studio\/tracks\//)
await ctx2.close()

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
