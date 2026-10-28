// Screen shares are opt-in to watch, like Discord: others see "<name> is streaming" with Watch Stream, and (mesh) the
// streamer sends its screen video only to people who clicked it. Stop Watching and the streamer stopping both reset it.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Stream ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
await call(b.token, 'POST', `/invites/${inv.code}`); await call(c.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
// Record peer connections, and fake getDisplayMedia with an animated canvas so a screen share needs no picker.
const hooks = () => {
  const Orig = window.RTCPeerConnection
  window.__pcs = []
  window.RTCPeerConnection = function (...args) { const pc = new Orig(...args); window.__pcs.push(pc); return pc }
  window.RTCPeerConnection.prototype = Orig.prototype
  navigator.mediaDevices.getDisplayMedia = async () => {
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360
    const x = cv.getContext('2d'); let n = 0
    setInterval(() => { x.fillStyle = `hsl(${(n += 7) % 360} 70% 50%)`; x.fillRect(0, 0, 640, 360) }, 60)
    return cv.captureStream(15)
  }
}
// How many open peer connections are sending a live video track (camera is off, so that is the screen share).
const sendingScreen = (p) => p.evaluate(() => window.__pcs.filter((pc) => pc.connectionState !== 'closed').reduce((n, pc) => n + pc.getSenders().filter((s) => s.track?.kind === 'video').length, 0))
const mk = async (tok, join = true) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] })
  await ctx.addInitScript(hooks)
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('text=Join Voice')
  if (join) { await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]') }
  return p
}
const pa = await mk(a.token); const pb = await mk(b.token); const pc = await mk(c.token)
await pa.waitForFunction(() => document.querySelectorAll('[data-voice-tile]').length === 3, null, { timeout: 15000 })
await pa.waitForTimeout(1500)

console.log('-- start sharing')
await pa.click('button[aria-label="Share Your Screen"], button[title="Share Your Screen"]')
const screenTile = (p, uid) => p.locator(`[data-voice-tile="${uid}"]:has-text("'s screen")`)
await pb.waitForSelector('[data-stream-gate]', { timeout: 10000 })
ok('viewers see the stream gate, not the video', await screenTile(pb, a.user.id).locator('[data-stream-gate]').count() === 1 && await screenTile(pb, a.user.id).locator('video').count() === 0)
ok('gate names the streamer', /Alice is streaming/.test(await pb.locator('[data-stream-gate]').innerText()))
ok('the streamer sees their own share', await screenTile(pa, a.user.id).locator('video').count() === 1 && await pa.locator('[data-stream-gate]').count() === 0)
await pa.waitForTimeout(800)
ok('nobody is sent the screen before watching', (await sendingScreen(pa)) === 0, String(await sendingScreen(pa)))

console.log('-- watch')
await pb.click('[data-watch-stream]')
await pb.waitForFunction((uid) => { const v = [...document.querySelectorAll(`[data-voice-tile="${uid}"] video`)].find((x) => x.closest('[data-voice-tile]')?.textContent?.includes("'s screen")); return !!v && v.videoWidth > 0 }, a.user.id, { timeout: 15000 }).catch(() => {})
ok('bob sees the stream after Watch Stream', await screenTile(pb, a.user.id).locator('video').count() === 1 && await pb.evaluate((uid) => [...document.querySelectorAll(`[data-voice-tile="${uid}"] video`)].some((v) => v.videoWidth > 0), a.user.id))
ok('only bob is sent the screen', (await sendingScreen(pa)) === 1, String(await sendingScreen(pa)))
ok('carol still sees the gate', await screenTile(pc, a.user.id).locator('[data-stream-gate]').count() === 1)

console.log('-- stop watching')
await screenTile(pb, a.user.id).hover(); await pb.click('[data-stop-watching]'); await pb.waitForTimeout(800)
ok('Stop Watching brings the gate back', await screenTile(pb, a.user.id).locator('[data-stream-gate]').count() === 1)
ok('and alice stops sending to bob', (await sendingScreen(pa)) === 0, String(await sendingScreen(pa)))

console.log('-- streamer stops and restarts')
await pb.click('[data-watch-stream]'); await pb.waitForTimeout(1000)
await pa.click('button[aria-label="Stop Sharing"], button[title="Stop Sharing"]'); await pb.waitForTimeout(1000)
ok('the screen tile goes away when sharing stops', await screenTile(pb, a.user.id).count() === 0)
await pa.click('button[aria-label="Share Your Screen"], button[title="Share Your Screen"]'); await pb.waitForSelector('[data-stream-gate]', { timeout: 10000 })
ok('a new share needs Watch Stream again', await screenTile(pb, a.user.id).locator('[data-stream-gate]').count() === 1)
await pa.waitForTimeout(800)
ok('and is not sent until then', (await sendingScreen(pa)) === 0, String(await sendingScreen(pa)))

console.log('-- not in the call')
await pc.click('[data-voice-leave]'); await pc.waitForTimeout(800)
ok('outside the call: nothing plays, the sidebar shows LIVE', await pc.locator('video').count() === 0 && await pc.locator('aside >> text=LIVE').count() >= 1)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close()
await finish()
