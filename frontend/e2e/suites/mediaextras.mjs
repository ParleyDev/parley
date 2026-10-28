// /tts messages (read aloud to people viewing the channel, behind Send TTS Messages), marking attachments as spoilers
// after sending, spoiler channels (a warning, media hidden), suggested reactions, double-tap to react, and zooming
// into screen shares.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Media ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const ch = g.channels.find((x) => x.kind === 'text'), vc = g.channels.find((x) => x.kind === 'voice')
const spoilers = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'finale-talk', kind: 'text', topic: 'The season finale' })
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const hooks = () => {
  navigator.mediaDevices.getDisplayMedia = async () => { const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; const x = cv.getContext('2d'); let n = 0; setInterval(() => { x.fillStyle = `hsl(${(n += 7) % 360} 70% 50%)`; x.fillRect(0, 0, 640, 360) }, 60); return cv.captureStream(15) }
}
const mk = async (tok, path) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone', 'camera'] })
  await ctx.addInitScript(hooks)
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}${path}`); await p.waitForTimeout(900)
  return p
}
const pa = await mk(a.token, `/channels/${g.id}/${ch.id}`)
const pb = await mk(b.token, `/channels/${g.id}/${ch.id}`)
const box = '[data-composer-box] textarea'
const latest = async () => (await call(a.token, 'GET', `/channels/${ch.id}/messages?limit=5`)).sort((x, y) => (x.id < y.id ? 1 : -1))[0]

console.log('-- tts')
await pa.fill(box, `/tts hello there ${S}`); await pa.keyboard.press('Enter'); await pb.waitForTimeout(900)
ok('/tts sends the text as a TTS message', (await latest()).tts === true && (await latest()).content === `hello there ${S}`)
ok('people viewing the channel hear it', await pb.evaluate((t) => (window.__parleyTts ?? []).includes(t), `${a.user.display_name} says hello there ${S}`), JSON.stringify(await pb.evaluate(() => window.__parleyTts)))
const everyone = (await call(a.token, 'GET', `/guilds/${g.id}/roles`)).find((r) => r.id === g.id)
ok('@everyone can send TTS by default', (everyone.permissions & (1 << 12)) !== 0)
await call(a.token, 'PATCH', `/guilds/${g.id}/roles/${g.id}`, { permissions: everyone.permissions & ~(1 << 12) })
const quiet = await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: 'not read aloud', tts: true })
ok('without Send TTS Messages the flag is dropped', !quiet.tts)

console.log('-- spoilers after sending')
const png = async (hue) => Buffer.from(await pa.evaluate((h) => { const cv = document.createElement('canvas'); cv.width = 80; cv.height = 60; const x = cv.getContext('2d'); x.fillStyle = `hsl(${h} 70% 50%)`; x.fillRect(0, 0, 80, 60); return cv.toDataURL('image/png').split(',')[1] }, hue), 'base64')
await pa.setInputFiles('[data-file-input="files"]', [{ name: 'plot.png', mimeType: 'image/png', buffer: await png(10) }])
await pa.waitForFunction(() => [...document.querySelectorAll('[data-pending]')].filter((e) => /B$/.test(e.textContent)).length === 1, null, { timeout: 15000 })
await pa.focus(box); await pa.keyboard.press('Enter'); await pa.waitForTimeout(900)
const pic = await latest()
await pa.locator(`[data-msg-id="${pic.id}"]`).click({ button: 'right', position: { x: 300, y: 10 } }); await pa.click('[data-menu-item="Edit Attachments"]')
await pa.check(`[data-spoiler-edit="${pic.attachments[0].id}"]`); await pa.click('[data-alt-save]'); await pa.waitForTimeout(800)
ok('an attachment can be marked as a spoiler after sending', (await latest()).attachments[0].filename === 'SPOILER_plot.png')
ok('and is hidden for others', await pb.locator(`[data-msg-id="${pic.id}"] [data-blur="spoiler"]`).count() === 1)

console.log('-- spoiler channels')
ok('only managers can make a spoiler channel', (await raw(b.token, 'PATCH', `/channels/${spoilers.id}`, { spoiler: true })).status === 403)
await call(a.token, 'PATCH', `/channels/${spoilers.id}`, { spoiler: true })
await call(a.token, 'POST', `/channels/${spoilers.id}/messages`, { content: 'big reveal', attachment_ids: [] })
await pb.goto(`${WEB}/channels/${g.id}/${spoilers.id}`); await pb.waitForTimeout(900)
ok('a spoiler channel warns first, with its topic', /The season finale/.test(await pb.locator('[data-spoiler-gate]').innerText().catch(() => '')))
await pb.click('[data-spoiler-continue]'); await pb.waitForTimeout(500)
ok('continuing shows the channel', await pb.locator('[data-spoiler-gate]').count() === 0 && /big reveal/.test(await pb.locator('main').innerText()))
await pb.goto(`${WEB}/channels/${g.id}/${spoilers.id}`); await pb.waitForTimeout(700)
ok('and it is remembered', await pb.locator('[data-spoiler-gate]').count() === 0)

console.log('-- reactions')
const cg = await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: 'we shipped it, congrats everyone!' }); await pa.waitForTimeout(700)
await pa.locator(`[data-msg-id="${cg.id}"]`).click({ button: 'right', position: { x: 300, y: 10 } })
ok('suggested reactions fit the message', (await pa.locator('[data-context-menu] [data-quick-row] button').first().getAttribute('title')) === 'React with 🎉')
await pa.keyboard.press('Escape'); await pa.waitForTimeout(200)
const tap = () => pa.evaluate((id) => { const el = document.querySelector(`[data-msg-id="${id}"] .msg-content`); for (const t of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(t, { pointerType: 'touch', bubbles: true })) }, cg.id)
await tap(); await pa.waitForTimeout(80); await tap(); await pa.waitForTimeout(800)
const reacted = (await call(a.token, 'GET', `/channels/${ch.id}/messages?limit=5`)).find((x) => x.id === cg.id)
ok('double-tapping a message reacts with ❤️', reacted.reactions.some((r) => r.emoji === '❤️' && r.me), JSON.stringify(reacted.reactions))

console.log('-- zoom into a stream')
await pa.goto(`${WEB}/channels/${g.id}/${vc.id}`); await pa.click('text=Join Voice'); await pa.waitForSelector('[data-voice-leave]')
await pb.goto(`${WEB}/channels/${g.id}/${vc.id}`); await pb.click('text=Join Voice'); await pb.waitForSelector('[data-voice-leave]')
await pa.click('button[aria-label="Share Your Screen"]'); await pb.waitForTimeout(1500)
await pb.click('[data-watch-stream]'); await pb.waitForSelector('[data-zoom]', { timeout: 15000 })
const zoomBox = pb.locator('[data-zoom]').first()
await zoomBox.hover(); await pb.mouse.wheel(0, -300); await pb.waitForTimeout(300)
ok('the wheel zooms into a screen share', Number(await zoomBox.getAttribute('data-zoom')) > 1)
await zoomBox.hover(); await pb.click('[data-zoom-reset]'); await pb.waitForTimeout(200)
ok('and the reset button goes back to 100%', (await zoomBox.getAttribute('data-zoom')) === '1.00')
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
