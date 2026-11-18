// The mixer's effect windows: several open at once (each brought to the front when pressed), plug-in style knobs
// (drag, type a value, double-click to reset), handles dragged on the EQ and filter curves, bypass and reset from the
// window, and the live views: while the project plays each window listens to its effect's input and output.
import { WEB, B, S, IP, reg, call, callS, ok, finish, launchBrowser, chromiumOnly } from '../lib.mjs'

await chromiumOnly('needs a voice room and Web Audio')

const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `FX ${S}` })
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'fx', kind: 'studio' })).body
const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Racks' })).body
const st = await call(a.token, 'GET', `/channels/${P.channel_id}`)
const full = () => call(a.token, 'GET', `/studio/projects/${P.id}`)
const ops = (list) => callS(a.token, 'POST', `/studio/projects/${P.id}/ops`, { ops: list })
const wav = (sec) => {
  const n = 8000 * sec; const buf = Buffer.alloc(44 + n)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40)
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round((i % 4000 < 1500 ? 110 : 25) * Math.sin(i / 3))
  return buf
}
const beat = await (await fetch(`${B}/channels/${st.id}/studio/audio?name=Loop.wav&duration_ms=8000`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/wav', 'X-Forwarded-For': IP }, body: wav(8) })).json()
const L = crypto.randomUUID()
const types = ['eq', 'filter', 'compressor', 'gate', 'reverb', 'delay', 'drive', 'chorus']
await ops([
  { op: 'lane.put', lane: { id: L, name: 'Beat', effects: types.map((t) => ({ id: `x${t}`, type: t })) } },
  { op: 'clip.put', clip: { id: crypto.randomUUID(), lane_id: L, audio_id: beat.id, start_ms: 0, length_ms: 8000 } },
  { op: 'project', master_effects: [{ id: 'lim', type: 'limiter' }], loop_on: false },
])

const browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['microphone'] })
const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${st.id}`)
const join = p.locator('[data-project-join]').or(p.getByText('Join Voice', { exact: true })).first(); await join.waitFor(); await join.click(); await p.waitForSelector('[data-voice-leave]')
await p.waitForSelector('[data-daw]')
await p.click('[data-daw-view-mixer]'); await p.waitForSelector('[data-daw-mixer]')
const slot = (t) => p.locator(`[data-daw-fx="${L}"] [data-daw-fx-slot="${t}"] [data-daw-fx-open]`)
const win = (t) => p.locator(`[data-daw-fx-editor="${t}"]`)
const param = async (t, key) => (await full()).lanes.find((l) => l.id === L).effects.find((e) => e.type === t).params[key]
/** A saved value once it has settled to `want` (edits are sent shortly after they're made), or what it is after 5 s. */
const settle = async (t, key, want) => { let v; for (let i = 0; i < 25; i++) { v = await param(t, key); if (want(v)) return v; await p.waitForTimeout(200) } return v }

console.log('-- several windows at once')
for (const t of ['filter', 'compressor', 'eq']) await slot(t).click()
await win('eq').waitFor()
ok('three windows open together, each with its view, knobs and meters', await p.locator('[data-daw-fx-window]').count() === 3 && await win('filter').locator('[data-daw-fx-view="filter"]').count() === 1 && await win('compressor').locator('[data-daw-fx-knob]').count() === 5 && await win('eq').locator('[data-daw-fx-meter]').count() === 2)
const boxes = await Promise.all(['filter', 'compressor', 'eq'].map((t) => win(t).boundingBox()))
ok('they open a step apart, not on top of each other', boxes[0].x !== boxes[1].x && boxes[1].y !== boxes[2].y, JSON.stringify(boxes))
const z = (t) => win(t).evaluate((el) => Number(getComputedStyle(el).zIndex))
ok('the last opened is in front', await z('eq') > await z('filter'))
await win('filter').locator('[data-float-window-handle]').click({ position: { x: 60, y: 10 } })
ok('pressing one brings it to the front, still under menus', await z('filter') > await z('eq') && await z('filter') < 70, `${await z('filter')} ${await z('eq')}`)
await slot('compressor').click()
ok('clicking its slot again closes it', await p.locator('[data-daw-fx-window]').count() === 2)

console.log('-- knobs and curves')
await win('filter').locator('[data-daw-fx-value="freq"]').fill('2500')
await p.keyboard.press('Enter')
ok('typing a value sets it', await settle('filter', 'freq', (v) => v === 2500) === 2500)
await win('filter').locator('[data-daw-fx-value="freq"]').fill('3.2k'); await p.keyboard.press('Enter')
ok('with its unit, too', await settle('filter', 'freq', (v) => v === 3200) === 3200)
await win('filter').locator('[data-daw-fx-value="freq"]').fill('2.5 kHz'); await p.keyboard.press('Enter')
await settle('filter', 'freq', (v) => v === 2500)
const knob = await win('filter').locator('[data-daw-fx-param="q"]').boundingBox()
await p.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2); await p.mouse.down(); await p.mouse.move(knob.x + knob.width / 2, knob.y - 60, { steps: 6 }); await p.mouse.up()
const q = await settle('filter', 'q', (v) => v > 2)
ok('dragging a knob up turns it up', q > 2, String(q))
await win('filter').locator('[data-daw-fx-param="q"]').dblclick()
ok('double-clicking resets it', await settle('filter', 'q', (v) => v === 0.7) === 0.7)
await win('filter').locator('[data-daw-fx-mode="1"]').click()
ok('the filter type is a switch', await settle('filter', 'mode', (v) => v === 1) === 1)
await p.waitForTimeout(300)
// The cutoff handle sits on the curve at 2.5 kHz; drag it left to about 300 Hz.
const view = await win('filter').locator('[data-daw-fx-view]').boundingBox()
const xOf = (f) => view.x + (Math.log(f / 20) / Math.log(1000)) * view.width
const fview = win('filter').locator('[data-daw-fx-view]')
let found = null
for (let y = view.y + 4; y < view.y + view.height - 4 && !found; y += 3) { await p.mouse.move(xOf(2500), y); if (await fview.getAttribute('data-daw-fx-hot') === 'cut') found = y }
ok('hovering the cutoff handle lights it', found !== null)
if (found) { await p.mouse.down(); await p.mouse.move(xOf(300), found, { steps: 8 }); await p.mouse.up() }
const freq = await settle('filter', 'freq', (v) => Math.abs(v - 300) < 60)
ok('dragging the handle on the curve moves the cutoff', Math.abs(freq - 300) < 60, String(freq))

console.log('-- bypass and reset from the window')
await win('filter').locator('[data-float-window-close]').click()
await win('eq').locator('[data-daw-fx-value="mid"]').fill('9'); await p.keyboard.press('Enter'); await p.waitForTimeout(500)
await win('eq').locator('[data-daw-fx-window-power]').click(); await p.waitForTimeout(600)
let lane = (await full()).lanes.find((l) => l.id === L)
ok('the window\'s power switch bypasses it', lane.effects.find((e) => e.type === 'eq').on === false)
await win('eq').locator('[data-daw-fx-window-power]').click()
await win('eq').locator('[data-daw-fx-reset]').click(); await p.waitForTimeout(600)
lane = (await full()).lanes.find((l) => l.id === L)
ok('reset puts back the defaults', lane.effects.find((e) => e.type === 'eq').on === true && lane.effects.find((e) => e.type === 'eq').params.mid === 0)

console.log('-- live views')
// With nine windows over the mixer the slots are under them; real clicks on slots were checked above.
await p.locator(`[data-daw-fx="master"] [data-daw-fx-slot="limiter"] [data-daw-fx-open]`).dispatchEvent('click')
for (const t of ['compressor', 'reverb', 'delay', 'drive', 'chorus', 'gate']) await slot(t).dispatchEvent('click')
// Eight: the filter's was closed above.
ok('every kind of effect opens a window', await p.locator('[data-daw-fx-window]').count() === 8, String(await p.locator('[data-daw-fx-window]').count()))
ok('stopped, they say so', await p.locator('[data-daw-fx-live="yes"]').count() === 0)
await p.locator('[data-daw-rtz]').dispatchEvent('click'); await p.locator('[data-daw-play]').dispatchEvent('click')
await p.waitForFunction(() => document.querySelectorAll('[data-daw-fx-live="yes"]').length === 8, null, { timeout: 10000 }).catch(() => {})
ok('playing, every window listens to its effect', await p.locator('[data-daw-fx-live="yes"]').count() === 8, String(await p.locator('[data-daw-fx-live="yes"]').count()))
await p.waitForTimeout(1500)
// The input meter of the first effect in the chain has signal drawn on it.
const lit = await win('eq').locator('[data-daw-fx-meter="pre"]').evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 200) n++; return n })
ok('the meters move with the sound', lit > 20, String(lit))
const gr = await win('compressor').locator('[data-daw-fx-view]').evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200 && d[i + 3] > 200) n++; return n })
ok('the compressor shows where the signal sits on its curve', gr > 10, String(gr))
await p.screenshot({ path: 'fxwindows.png' })
// Each window on its own, brought to the front.
for (const t of ['eq', 'compressor', 'reverb', 'delay', 'drive', 'chorus', 'gate', 'limiter']) { await win(t).dispatchEvent('pointerdown'); await p.waitForTimeout(400); await win(t).screenshot({ path: `fxwindow-${t}.png` }) }
await p.locator('[data-daw-play]').dispatchEvent('click')
await p.waitForFunction(() => document.querySelectorAll('[data-daw-fx-live="yes"]').length === 0, null, { timeout: 5000 }).catch(() => {})
ok('stopping lets them go', await p.locator('[data-daw-fx-live="yes"]').count() === 0)

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
