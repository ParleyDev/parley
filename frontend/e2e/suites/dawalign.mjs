// Placing clips precisely and finding one's way along the timeline: the grid drawn as it is snapped to (Auto
// following the zoom), a press that wobbles leaving a clip where it was, edges drawn to other clips' edges with a
// guide and a readout while dragging, the clip's start typed in, snapping a selection to the grid, moving it to the
// playhead and starting clips together, the playhead stepped, jumped between edges and typed in, zoom about the
// playhead, to the selection and to half a millisecond a pixel, where the waveform is drawn from the samples.
// Each edit is checked on the server.
import { WEB, B, S, IP, reg, call, callS, ok, finish, launchBrowser } from '../lib.mjs'
import { sine, wavFile } from '../audio.mjs'

const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Align ${S}` })
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'daw', kind: 'studio' })).body
const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Align Song', bpm: 120 })).body
const full = () => call(a.token, 'GET', `/studio/projects/${P.id}`)
const ops = (list) => callS(a.token, 'POST', `/studio/projects/${P.id}/ops`, { ops: list })
const upload = async (name) => (await fetch(`${B}/channels/${P.channel_id}/studio/audio?name=${name}&duration_ms=4000`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/wav', 'X-Forwarded-For': IP }, body: wavFile({ seconds: 4, signal: sine(440, 0.5) }) })).json()
const one = await upload('One.wav')
const id = () => crypto.randomUUID()
const LA = id(), LB = id(), CA = id(), CB = id()
// A at the start; B off the grid (3137 ms: the beat is 500 ms at 120 BPM); a marker off it too.
const r0 = await ops([{ op: 'lane.put', lane: { id: LA, name: 'One', position: 0 } }, { op: 'lane.put', lane: { id: LB, name: 'Two', position: 1 } },
  { op: 'clip.put', clip: { id: CA, lane_id: LA, audio_id: one.id, start_ms: 0, length_ms: 2000 } }, { op: 'clip.put', clip: { id: CB, lane_id: LB, audio_id: one.id, start_ms: 3137, length_ms: 1000 } },
  { op: 'project', markers: [{ id: 'm1', ms: 6123, name: 'Bridge' }] }])
ok('the project is set up', r0.status === 200, JSON.stringify(r0.body).slice(0, 200))

const browser = await launchBrowser(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await p.evaluate((t) => { localStorage.setItem('parley.token', t); localStorage.setItem('parley.dawZoom', '40') }, a.token)
await p.goto(`${WEB}/channels/${g.id}/${P.channel_id}`); await p.waitForSelector(`[data-daw-clip="${CA}"]`, { timeout: 15000 })
const settle = () => p.waitForTimeout(700)
const ver = async () => (await full()).project.version
const clip = async (cid) => (await full()).clips.find((c) => c.id === cid)
const box = (sel) => p.locator(sel).boundingBox()
// The timeline's geometry: where its time 0 is on the screen and how many pixels a second (from clip A's width).
const geo = async () => {
  const len = (await clip(CA)).length_ms
  return p.evaluate(([ca, len]) => { const s = document.querySelector('[data-daw-timeline]'), r = s.getBoundingClientRect(); return { left: r.left - s.scrollLeft, width: r.width, view: r.left, pps: document.querySelector(`[data-daw-clip="${ca}"]`).getBoundingClientRect().width / (len / 1000) } }, [CA, len])
}
const xOf = async (ms) => { const q = await geo(); return q.left + (ms / 1000) * q.pps }
// The playhead, from the time shown (to the millisecond).
const head = async () => { const [m, s] = (await p.locator('[data-daw-time]').textContent()).split(':'); return Math.round(Number(m) * 60000 + Number(s) * 1000) }
const yOf = async (lane) => { const b = await box(`[data-daw-lane="${lane}"]`); return b.y + b.height / 2 }
const blur = () => p.evaluate(() => document.activeElement?.blur())
const undo = async () => { await p.keyboard.press('Control+z'); await settle() }

console.log('-- the grid as it is snapped to')
ok('beats are drawn between the bars, and ticked on the ruler', await p.locator('[data-daw-grid="beat"]').count() > 10 && await p.locator('[data-daw-tick="beat"]').count() > 10)
ok('with a beat grid there are no finer lines', await p.locator('[data-daw-grid="sub"]').count() === 0)
await p.selectOption('[data-daw-snap]', 'sixteenth'); await blur(); await p.keyboard.press('='); await p.keyboard.press('='); await p.waitForTimeout(200)
ok('a 1/16 grid draws its lines where they are far enough apart to see', await p.locator('[data-daw-grid="sub"]').count() > 10)
await p.selectOption('[data-daw-snap]', 'beat'); await blur()
await p.keyboard.press('-'); await p.keyboard.press('-'); await p.waitForTimeout(200)

console.log('-- the tracks stay put')
const y0 = (await box(`[data-daw-lane="${LA}"]`)).y
await p.click(`[data-daw-clip="${CA}"]`); await p.waitForTimeout(150)
const y1 = (await box(`[data-daw-lane="${LA}"]`)).y, iw = await p.locator('[data-daw-inspector]').evaluate((e) => e.getBoundingClientRect().width)
await p.click(`[data-daw-clip="${CB}"]`, { modifiers: ['Shift'] }); await p.waitForTimeout(150)
const y2 = (await box(`[data-daw-lane="${LA}"]`)).y
await p.keyboard.press('Escape'); await p.waitForTimeout(150)
ok('selecting a clip, or two, does not move the tracks (the toolbar keeps its shape)', y1 === y0 && y2 === y0, JSON.stringify({ y0, y1, y2, iw }))

console.log('-- a press that wobbles')
let v = await ver()
let b = await box(`[data-daw-clip="${CB}"]`)
await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2, { steps: 2 }); await p.mouse.up(); await settle()
ok('leaves an off-grid clip exactly where it was (it no longer jumps onto the grid)', (await clip(CB)).start_ms === 3137 && await ver() === v, String((await clip(CB)).start_ms))
ok('and selects it', await p.locator(`[data-daw-clip="${CB}"][data-selected="1"]`).count() === 1)

console.log('-- drawn to another clip')
// Drag A right so that its end comes 4 px short of B's start: it is drawn to it.
let q = await geo()
const want = 3137 - 2000, dx = ((want / 1000) * q.pps) - 4
b = await box(`[data-daw-clip="${CA}"]`)
await p.mouse.move(b.x + 20, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + 20 + dx / 2, b.y + b.height / 2, { steps: 5 }); await p.mouse.move(b.x + 20 + dx, b.y + b.height / 2, { steps: 5 })
const guide = await p.locator('[data-daw-guide]').getAttribute('data-daw-guide').catch(() => null)
const read = await p.locator('[data-daw-drag-readout]').textContent().catch(() => '')
ok('a guide shows where it is drawn to (the other clip’s start)', guide === '3137', String(guide))
ok('and a readout says where it goes and how far it moved', read.includes('0:01.137') && read.includes('+1137 ms') && /^\d+\.\d\.\d{3}/.test(read), read)
await p.mouse.up(); await settle()
ok('let go, its end meets the other clip’s start to the millisecond', (await clip(CA)).start_ms === want, String((await clip(CA)).start_ms))
ok('the guide and the readout are gone', await p.locator('[data-daw-guide], [data-daw-drag-readout]').count() === 0)
await undo()
await p.click('[data-daw-magnet]')
ok('snapping to clips can be turned off', await p.getAttribute('[data-daw-magnet]', 'aria-pressed') === 'false')
b = await box(`[data-daw-clip="${CA}"]`)
await p.mouse.move(b.x + 20, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + 20 + dx, b.y + b.height / 2, { steps: 8 })
ok('then nothing guides it', await p.locator('[data-daw-guide]').count() === 0)
await p.mouse.up(); await settle()
let s = (await clip(CA)).start_ms
ok('and it goes onto the grid', s > 0 && s % 500 === 0, String(s))
await undo(); await p.click('[data-daw-magnet]')
// A clip's start drawn to a marker, with a track dragged across.
q = await geo(); b = await box(`[data-daw-clip="${CA}"]`)
await p.mouse.move(b.x + 10, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + 10 + (6.123 * q.pps) + 3, await yOf(LB), { steps: 10 }); await p.mouse.up(); await settle()
let ca = await clip(CA)
ok('onto a marker, on another track', ca.start_ms === 6123 && ca.lane_id === LB, JSON.stringify([ca.start_ms, ca.lane_id === LB]))
await undo()

console.log('-- the start typed in')
await p.click(`[data-daw-clip="${CB}"]`)
const field = p.locator('[data-daw-clip-start]')
ok('the selected clip’s start is shown as a time and as bar.beat.tick', await field.inputValue() === '0:03.137' && await p.locator('[data-daw-clip-pos]').textContent() === '2.3.263', `${await field.inputValue()} ${await p.locator('[data-daw-clip-pos]').textContent()}`)
v = await ver()
await field.click(); await field.fill('2.1'); await field.press('Enter'); await settle()
ok('a bar.beat puts it there', (await clip(CB)).start_ms === 2000 && await ver() === v + 1, String((await clip(CB)).start_ms))
await field.click(); await field.fill('0:04.321'); await field.press('Enter'); await settle()
ok('a time to the millisecond puts it there', (await clip(CB)).start_ms === 4321, String((await clip(CB)).start_ms))
await field.click(); await field.fill('nonsense'); await field.press('Enter'); await settle()
ok('anything else is refused and changes nothing', (await clip(CB)).start_ms === 4321 && await field.inputValue() === '0:04.321')

console.log('-- aligning a selection')
await p.click(`[data-daw-clip="${CB}"]`); v = await ver()
await p.keyboard.press('q'); await settle()
ok('Q puts the selection on the grid by its start', (await clip(CB)).start_ms === 4500 && await ver() === v + 1, String((await clip(CB)).start_ms))
await p.click('[data-daw-time]'); await p.fill('[data-daw-goto]', '5.1'); await p.press('[data-daw-goto]', 'Enter'); await p.waitForTimeout(200)
ok('the time can be typed to put the playhead at a bar', await head() === 8000, String(await head()))
await p.click(`[data-daw-clip="${CB}"]`); await p.click('[data-daw-to-playhead]'); await settle()
ok('the selection moves to the playhead', (await clip(CB)).start_ms === 8000, String((await clip(CB)).start_ms))
await p.click(`[data-daw-clip="${CA}"]`); await p.click(`[data-daw-clip="${CB}"]`, { modifiers: ['Shift'] }); v = await ver()
await p.click('[data-daw-align-starts]'); await settle()
ok('clips start together, where the earliest starts, in one change', (await clip(CA)).start_ms === 0 && (await clip(CB)).start_ms === 0 && await ver() === v + 1)
await undo()
ok('undone in one step', (await clip(CB)).start_ms === 8000)

console.log('-- moving the playhead')
await p.keyboard.press('Escape'); await p.keyboard.press('Home'); await p.waitForTimeout(150)
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(150)
ok('with nothing selected the arrow steps the playhead a grid step', await head() === 500, String(await head()))
await p.keyboard.press('Shift+ArrowRight'); await p.waitForTimeout(150)
ok('with Shift, 10 ms', await head() === 510, String(await head()))
await p.keyboard.press('Control+ArrowRight'); await p.waitForTimeout(150)
ok('Ctrl and the arrow jump to the next clip edge', await head() === 2000, String(await head()))
await p.keyboard.press('Control+ArrowRight'); await p.waitForTimeout(150)
ok('then to the next: a marker', await head() === 6123, String(await head()))
await p.keyboard.press('Control+ArrowLeft'); await p.waitForTimeout(150)
ok('and back', await head() === 2000, String(await head()))
await p.keyboard.press('End'); await p.waitForTimeout(150)
ok('End goes to the end of the song', await head() === 9000, String(await head()))
q = await geo(); const r = await box('[data-daw-ruler]')
await p.mouse.click(q.left + 8 * q.pps + 3, r.y + r.height - 4); await p.waitForTimeout(150)
ok('a click on the ruler near a clip’s start puts the playhead on it exactly', await head() === 8000, String(await head()))
await p.click('[data-daw-time]'); await p.fill('[data-daw-goto]', '1:02.345'); await p.press('[data-daw-goto]', 'Enter'); await p.waitForTimeout(150)
ok('a time typed in, to the millisecond', await head() === 62345, String(await head()))
await p.keyboard.press('Home')

console.log('-- zoom')
await p.keyboard.press('z'); await p.waitForTimeout(300)
q = await geo()
let ba = await box(`[data-daw-clip="${CA}"]`), bb = await box(`[data-daw-clip="${CB}"]`)
ok('Z with nothing selected fits the whole song in view', ba.x >= q.view - 1 && bb.x + bb.width <= q.view + q.width + 1 && bb.x + bb.width > q.view + q.width * 0.8, JSON.stringify([ba.x, bb.x + bb.width, q.view, q.width]))
await p.click(`[data-daw-clip="${CB}"]`); await p.keyboard.press('z'); await p.waitForTimeout(300)
q = await geo(); bb = await box(`[data-daw-clip="${CB}"]`)
ok('with a clip selected, that clip fills the view', bb.width / q.width > 0.85 && bb.width / q.width < 0.95 && bb.x >= q.view, String(bb.width / q.width))
await p.keyboard.press('Escape'); await p.click('[data-daw-time]'); await p.fill('[data-daw-goto]', '0:08.500'); await p.press('[data-daw-goto]', 'Enter'); await p.waitForTimeout(150)
const h0 = (await box('[data-daw-playhead]')).x
await p.keyboard.press('='); await p.waitForTimeout(300)
const h1 = (await box('[data-daw-playhead]')).x, z1 = (await geo()).pps
ok('+ zooms in about the playhead: it stays where it is on the screen', Math.abs(h1 - h0) < 2 && z1 > q.pps * 1.4, JSON.stringify([h0, h1, q.pps, z1]))
for (let i = 0; i < 6; i++) await p.keyboard.press('=')
await p.waitForTimeout(300)
q = await geo()
ok('zoom goes to 2000 px a second (half a millisecond a pixel)', Math.abs(q.pps - 2000) < 1, String(q.pps))
ok('zoomed in, the ruler is ticked finely though the grid is a beat; the tracks show only what is snapped to', await p.locator('[data-daw-tick="sub"]').count() > 3 && await p.locator('[data-daw-grid="sub"]').count() === 0)
await p.waitForSelector(`[data-daw-clip="${CB}"] [data-daw-wave="1"]`, { timeout: 10000 }).catch(() => {})
const wave = await p.locator(`[data-daw-clip="${CB}"] canvas`).evaluate((cv) => {
  const g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height).data
  // Columns painted, and how many rows the tallest covers: drawn from the samples, a 440 Hz sine at 2000 px/s is a
  // wave about 4.5 px a cycle wide, its columns of different heights.
  const heights = new Set()
  for (let x = 0; x < cv.width; x += 1) { let n = 0; for (let y = 0; y < cv.height; y++) if (d[(y * cv.width + x) * 4 + 3] > 0) n++; if (n) heights.add(n) }
  return { w: cv.width, heights: heights.size }
}).catch((e) => ({ err: String(e) }))
ok('at that zoom the waveform is drawn from the samples, its shape and all', wave.w > 0 && wave.heights > 3, JSON.stringify(wave))

console.log('-- Auto grid')
await p.selectOption('[data-daw-snap]', 'auto'); await blur(); await p.click('[data-daw-magnet]')
await p.click('[data-daw-time]'); await p.fill('[data-daw-goto]', '0:08.000'); await p.press('[data-daw-goto]', 'Enter'); await p.waitForTimeout(300)
bb = await box(`[data-daw-clip="${CB}"]`)
await p.mouse.move(bb.x + 40, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + 40 + 100, bb.y + bb.height / 2, { steps: 6 }); await p.mouse.up(); await settle()
s = (await clip(CB)).start_ms
ok('zoomed in, Auto snaps to 1/32 of a beat (62.5 ms here)', s > 8000 && s < 8100 && Math.abs(s - Math.round(s / 62.5) * 62.5) <= 0.5, String(s))
await p.click('[data-daw-magnet]')

console.log('-- playing on iOS')
{
  // iOS mutes the studio with the ringer on silent unless it asks for the playback session while it plays, where the
  // browser has one (WebKit): asked for while it plays, given back when it stops.
  const has = await p.evaluate(() => !!navigator.audioSession)
  await p.keyboard.press('Home'); await p.click('[data-daw-play]'); await p.waitForSelector('[data-daw][data-daw-state="playing"]', { timeout: 8000 })
  const during = await p.evaluate(() => navigator.audioSession?.type ?? null), running = await p.evaluate(() => window.__parleyDawTest?.ctxState?.() ?? null)
  await p.click('[data-daw-play]'); await p.waitForSelector('[data-daw][data-daw-state="stopped"]', { timeout: 8000 })
  const after = await p.evaluate(() => navigator.audioSession?.type ?? null)
  if (has) ok('while it plays it asks for the playback audio session, and gives it back when it stops', during === 'playback' && after === 'auto', JSON.stringify({ during, after }))
  else console.log('   (this browser has no audio session to ask for)')
  ok('pressing play wakes the audio and it plays', running === 'running', String(running))
}

console.log('-- on a phone')
{
  // The channel list lies over the open channel on a phone: nothing of the DAW behind it may show through.
  const pp = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); pp.on('pageerror', (e) => errors.push(e.message))
  await pp.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await pp.evaluate((t) => { localStorage.setItem('parley.token', t); localStorage.setItem('parley.dawView', 'arrange') }, a.token)
  await pp.goto(`${WEB}/channels/${g.id}/${P.channel_id}`); await pp.waitForSelector('[data-daw-playhead]', { timeout: 15000 })
  await pp.click('main button[title="Channels"]'); await pp.waitForTimeout(500)
  const hb = await pp.locator('[data-daw-playhead]').boundingBox()
  const shot = await pp.screenshot()
  // Rows where the playhead's column is far brighter than the pixels either side of it: the line, drawn over the list.
  const seen = await pp.evaluate(async ([b64, x, y0, y1]) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const k = img.width / innerWidth, lum = (xx, y) => { const d = g.getImageData(Math.floor(xx * k), Math.floor(y * k), 1, 1).data; return d[0] + d[1] + d[2] }
    let line = 0, rows = 0
    for (let y = Math.max(0, y0); y < Math.min(innerHeight, y1); y += 2) { rows++; if (lum(x, y) - Math.max(lum(x - 3, y), lum(x + 3, y)) > 150) line++ }
    return { line, rows }
  }, [shot.toString('base64'), hb.x + hb.width / 2, hb.y, hb.y + hb.height])
  ok('the DAW’s playhead is not drawn over the channel list', seen.rows > 20 && seen.line <= seen.rows * 0.05, JSON.stringify(seen))
  await pp.close()
}

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
