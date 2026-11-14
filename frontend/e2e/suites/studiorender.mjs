// What the studio's DAW renders, measured: test signals (a constant level, a sine, clicks) go through a project and
// the offline render that exports use is read back as samples. Levels, the pan law, mutes and solos, clip placement
// to the sample, fades, automation, buses and sends, stems and the exported WAV are checked against what the mix
// should be, not against what the screen shows. No voice room is needed: the project's manager has the DAW without
// joining.
import { WEB, B, S, IP, BROWSER, reg, call, callS, ok, finish, launchBrowser } from '../lib.mjs'
import { wavFile, dc, sine, impulses, pullRender, pullWav, liveRate, mean, rms, peak, at, near, onsets, maxDiff, panLaw, db } from '../audio.mjs'

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
    const { key, clips: cs = [], out, sends, automation, ...rest } = l
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
ok('a soloed track is the only one in the mix', both(r, 0, 0.5), show(r))
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
// Today's behaviour, kept as the baseline: solo is part of the export.
ok('the exported mix follows the solo', near(mean(r.samples[0], 48000, 600, 1500), 0, 1e-3) && rms(r.samples[1], 48000, 600, 1500) < 1e-3 && maxDiff(r.samples[0], sc.samples[0], 48000) < 1e-4, `${mean(r.samples[0], 48000, 600, 1500)} ${rms(r.samples[1], 48000, 600, 1500)}`)
r = await pullRender(page, [ids.c])
ok('the soloed track\'s stem is its track', maxDiff(r.samples[0], sc.samples[0], 48000) < 1e-4)
r = await pullRender(page, [ids.a])
// A defect, kept as the baseline until solo stops reaching exports: the other tracks' stems come out silent.
ok('while a track is soloed, the stems of the others are silent', peak(r.samples[0], 48000) < 1e-4 && peak(r.samples[1], 48000) < 1e-4, `${peak(r.samples[0], 48000)}`)
ids = await scene([{ key: 'bus', kind: 'bus', gain: 0.5 }, { key: 'a', kind: 'audio', pan: -1, out: 'bus', clips: [{ audio: DC }] }, { key: 'b', kind: 'audio', pan: 1, clips: [{ audio: DC }] }])
r = await pullRender(page, [ids.a])
ok('a stem of a track on a bus comes through its bus', both(r, 0.25, 0), show(r))

console.log('-- the exported file')
await scene([{ key: 'a', kind: 'audio', pan: -1, clips: [{ audio: DC }] }, { key: 'b', kind: 'audio', pan: 1, gain: 0.5, clips: [{ audio: TONE }] }])
r = await pullRender(page)
let w = await pullWav(page)
ok('the export is a 16-bit stereo 48 kHz PCM WAV', w.riff === 'RIFF' && w.wave === 'WAVE' && w.format === 1 && w.channels === 2 && w.rate === 48000 && w.bits === 16 && w.blockAlign === 4 && w.byteRate === 192000, JSON.stringify({ ...w, samples: undefined }))
ok('its sizes add up to the render\'s length', w.frames === r.frames && w.dataSize === r.frames * 4 && w.size === 44 + w.dataSize && w.riffSize === w.size - 8, `${w.frames} ${r.frames} ${w.size}`)
// Samples are cut to 16 bits (not rounded) and positive ones scaled by 32767: under two steps off.
ok('its samples are the render\'s, to 16 bits', maxDiff(w.samples[0], r.samples[0], 48000) < 2 / 32768 && maxDiff(w.samples[1], r.samples[1], 48000) < 2 / 32768, `${maxDiff(w.samples[0], r.samples[0], 48000)} ${maxDiff(w.samples[1], r.samples[1], 48000)}`)
await scene([{ key: 'a', kind: 'audio', pan: -1, clips: [{ audio: HOT }] }, { key: 'b', kind: 'audio', pan: -1, clips: [{ audio: HOT }] }])
r = await pullRender(page); w = await pullWav(page)
// Today's behaviour, kept as the baseline: nothing limits the mix, and the file clips what is over full scale.
ok('a mix over full scale renders over full scale', near(level(r)[0], 1.8, 2e-3), show(r))
ok('and the 16-bit file clips it at full scale', near(mean(w.samples[0], 48000, 500, 1500), 32767 / 32768, 1e-4), String(mean(w.samples[0], 48000, 500, 1500)))

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
