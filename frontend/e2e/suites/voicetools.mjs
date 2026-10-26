// Per-person call controls and stream quality: a user's menu in a call has User Volume, Mute and Hide Video, applied
// only on your side (the audio element's volume and mute, the tile's camera) and remembered; right-clicking a call tile
// opens the same menu; Settings › Voice & Video › Screen share quality sets the capture size, frame rate and bitrate.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Vol ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const hooks = () => {
  const Orig = window.RTCPeerConnection
  window.__pcs = []
  window.RTCPeerConnection = function (...args) { const pc = new Orig(...args); window.__pcs.push(pc); return pc }
  window.RTCPeerConnection.prototype = Orig.prototype
  navigator.mediaDevices.getDisplayMedia = async (c) => {
    window.__displayConstraints = c
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360
    const x = cv.getContext('2d'); let n = 0
    setInterval(() => { x.fillStyle = `hsl(${(n += 7) % 360} 70% 50%)`; x.fillRect(0, 0, 640, 360) }, 60)
    return cv.captureStream(15)
  }
}
const mk = async (tok) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] })
  await ctx.addInitScript(hooks)
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('text=Join Voice')
  await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]')
  return p
}
const pa = await mk(a.token); const pb = await mk(b.token)
await pa.waitForFunction(() => document.querySelectorAll('[data-voice-tile]').length === 2, null, { timeout: 15000 })
await pa.waitForFunction((id) => document.querySelector(`audio[data-peer="${id}"]`), b.user.id, { timeout: 15000 })
const bobAudio = () => pa.evaluate((id) => { const el = document.querySelector(`audio[data-peer="${id}"]`); return { volume: el.volume, muted: el.muted } }, b.user.id)

console.log('-- user menu in a call')
const openBobMenu = async () => { await pa.click(`[data-voice-tile="${b.user.id}"]`, { button: 'right' }); await pa.waitForSelector('[data-context-menu]') }
await openBobMenu()
ok('the menu starts with User Volume, Mute and Hide Video', await pa.locator('[data-context-menu] [data-user-volume]').count() === 1 && await pa.locator('[data-context-menu] [data-menu-item="Mute"]').count() === 1 && await pa.locator('[data-context-menu] [data-menu-item="Hide Video"]').count() === 1)
await pa.locator('[data-user-volume] input').fill('40'); await pa.waitForTimeout(200)
ok('the slider shows the new volume', /40%/.test(await pa.locator('[data-user-volume]').innerText()))
ok('and only that person gets quieter', Math.abs((await bobAudio()).volume - 0.4) < 0.01, JSON.stringify(await bobAudio()))
await pa.click('[data-context-menu] [data-menu-item="Mute"]'); await pa.waitForTimeout(200)
ok('Mute silences them for you', (await bobAudio()).muted === true)
await openBobMenu()
ok('and shows ticked', await pa.locator('[data-context-menu] [data-menu-item="✓ Mute"]').count() === 1)
await pa.click('[data-context-menu] [data-menu-item="✓ Mute"]'); await pa.waitForTimeout(200)
ok('unmuting brings them back', (await bobAudio()).muted === false)
ok('nothing changes on their side', !(await pb.evaluate(() => localStorage.getItem('parley.userAudio'))))

console.log('-- hide video')
await pb.click('button[aria-label="Turn On Camera"], button[title="Turn On Camera"]'); await pb.waitForTimeout(2500)
const tileVideo = () => pa.evaluate((id) => !!document.querySelector(`[data-voice-tile="${id}"] video`)?.srcObject, b.user.id)
await pa.waitForFunction((id) => !!document.querySelector(`[data-voice-tile="${id}"] video`)?.srcObject, b.user.id, { timeout: 10000 }).catch(() => {})
ok('their camera shows', await tileVideo())
await openBobMenu(); await pa.click('[data-context-menu] [data-menu-item="Hide Video"]'); await pa.waitForTimeout(400)
ok('Hide Video shows their avatar instead, just for you', !(await tileVideo()) && await pb.evaluate((id) => !!document.querySelector(`[data-voice-tile="${id}"] video`)?.srcObject, b.user.id))
await pa.reload(); await pa.waitForTimeout(1000)
const saved = await pa.evaluate((id) => JSON.parse(localStorage.getItem('parley.userAudio') || '{}')[id], b.user.id)
ok('your choices are remembered', saved?.volume === 40 && saved?.hideVideo === true, JSON.stringify(saved))

console.log('-- stream quality')
await pa.click('button[title="User Settings"]'); await pa.click('[role=dialog] button:has-text("Voice & Video")'); await pa.waitForSelector('[data-stream-quality]')
await pa.selectOption('#stream-quality', '1080p60'); await pa.keyboard.press('Escape'); await pa.waitForTimeout(300)
await pa.click('text=Join Voice').catch(() => {}); await pa.waitForSelector('[data-voice-leave]')
await pa.click('button[aria-label="Share Your Screen"], button[title="Share Your Screen"]'); await pa.waitForTimeout(800)
const cons = await pa.evaluate(() => window.__displayConstraints)
ok('sharing asks for 1080p at 60 fps', cons?.video?.frameRate?.max === 60 && cons?.video?.height?.ideal === 1080, JSON.stringify(cons))
await pb.click('[data-watch-stream], button:has-text("Watch Stream")').catch(() => {}); await pb.waitForTimeout(2500)
const caps = await pa.evaluate(() => window.__pcs.filter((pc) => pc.connectionState !== 'closed').flatMap((pc) => pc.getSenders().filter((s) => s.track?.kind === 'video').map((s) => s.getParameters().encodings?.[0]?.maxBitrate)))
ok('and sends it with the matching bitrate cap', caps.includes(6_000_000), JSON.stringify(caps))
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
