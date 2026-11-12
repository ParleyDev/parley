// Dragging clips in the DAW's timeline: onto another track (the drag survives the clip being redrawn there), a
// multi-selection moving together and staying selected, Esc cancelling, and the timeline scrolling at its edge.
import { chromium } from 'playwright'
import { WEB, B, S, IP, reg, call, callS, ok, finish } from '../lib.mjs'

const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Drag ${S}` })
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'daw', kind: 'studio' })).body
const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Drag Song', bpm: 120 })).body
const full = () => call(a.token, 'GET', `/studio/projects/${P.id}`)
const ops = (list) => callS(a.token, 'POST', `/studio/projects/${P.id}/ops`, { ops: list })
const wav = (sec) => {
  const n = 8000 * sec; const buf = Buffer.alloc(44 + n)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40)
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round((i % 4000 < 1500 ? 100 : 15) * Math.sin(i / 3))
  return buf
}
const beat = await (await fetch(`${B}/channels/${P.channel_id}/studio/audio?name=Beat.wav&duration_ms=4000`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/wav', 'X-Forwarded-For': IP }, body: wav(4) })).json()
const LA = crypto.randomUUID(), LB = crypto.randomUUID(), CA = crypto.randomUUID(), CB = crypto.randomUUID()
await ops([{ op: 'lane.put', lane: { id: LA, name: 'One', position: 0 } }, { op: 'lane.put', lane: { id: LB, name: 'Two', position: 1 } },
  { op: 'clip.put', clip: { id: CA, lane_id: LA, audio_id: beat.id, start_ms: 0, length_ms: 2000 } }, { op: 'clip.put', clip: { id: CB, lane_id: LA, audio_id: beat.id, start_ms: 4000, length_ms: 2000 } }])

const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${P.channel_id}`); await p.waitForSelector(`[data-daw-clip="${CA}"]`, { timeout: 15000 })
const clip = (id) => full().then((f) => f.clips.find((c) => c.id === id))
const center = async (sel) => { const b = await p.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
const settle = () => p.waitForTimeout(700)

console.log('-- onto another track')
let from = await center(`[data-daw-clip="${CA}"]`), lane = await center(`[data-daw-lane="${LB}"]`)
await p.mouse.move(from.x, from.y); await p.mouse.down()
await p.mouse.move(from.x + 60, lane.y, { steps: 8 }); await p.mouse.move(from.x + 120, lane.y, { steps: 8 }); await p.mouse.up(); await settle()
let ca = await clip(CA)
ok('a clip dragged onto another track keeps following the pointer there and lands where it is let go', ca.lane_id === LB && ca.start_ms > 0 && ca.start_ms % 500 === 0, JSON.stringify(ca))
const after = await p.locator(`[data-daw-clip="${CA}"]`).boundingBox()
await p.mouse.move(after.x + 300, after.y + 200); await p.waitForTimeout(200)
ok('and the drag is over: moving the mouse afterwards leaves it alone', Math.abs((await p.locator(`[data-daw-clip="${CA}"]`).boundingBox()).x - after.x) < 1 && (await clip(CA)).start_ms === ca.start_ms)

console.log('-- several at once')
await p.click(`[data-daw-clip="${CA}"]`); await p.click(`[data-daw-clip="${CB}"]`, { modifiers: ['Shift'] })
ok('shift-click selects a second clip', await p.locator('[data-daw-clip][data-selected="1"]').count() === 2)
const a0 = (await clip(CA)).start_ms, b0 = (await clip(CB)).start_ms
from = await center(`[data-daw-clip="${CB}"]`)
await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(from.x + 90, from.y, { steps: 10 }); await p.mouse.up(); await settle()
const a1 = (await clip(CA)).start_ms, b1 = (await clip(CB)).start_ms
ok('dragging one moves the whole selection by the same amount', b1 > b0 && b1 - b0 === a1 - a0, JSON.stringify([a0, a1, b0, b1]))
ok('and both stay selected after letting go', await p.locator('[data-daw-clip][data-selected="1"]').count() === 2)

console.log('-- cancel')
from = await center(`[data-daw-clip="${CB}"]`)
await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(from.x + 150, from.y, { steps: 8 })
await p.keyboard.press('Escape'); await p.mouse.up(); await settle()
ok('Esc during a drag puts the clips back', (await clip(CB)).start_ms === b1 && (await clip(CA)).start_ms === a1)

console.log('-- at the edge')
await p.click(`[data-daw-clip="${CB}"]`)
const sc = p.locator('[data-daw-timeline]'), box = await sc.boundingBox()
from = await center(`[data-daw-clip="${CB}"]`)
await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(box.x + box.width - 8, from.y, { steps: 10 })
await p.waitForTimeout(1500)
const scrolled = await sc.evaluate((e) => e.scrollLeft)
await p.mouse.up(); await settle()
const cb = await clip(CB)
ok('holding a clip at the timeline\'s right edge scrolls it, and the clip goes along', scrolled > 100 && cb.start_ms > b1 + 2000, JSON.stringify({ scrolled, start: cb.start_ms, b1 }))

ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
