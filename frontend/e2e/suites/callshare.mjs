// Screen share choices where the share is started: the arrow beside the share button sets quality and whether sound
// is shared; while sharing it says what is going out, changes quality on the running share, shares something else
// without stopping, and stops.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Share ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const hooks = () => {
  const Orig = window.RTCPeerConnection; window.__pcs = []
  window.RTCPeerConnection = function (...args) { const pc = new Orig(...args); window.__pcs.push(pc); return pc }
  window.RTCPeerConnection.prototype = Orig.prototype
  window.__picks = []; window.__cancelPick = false
  navigator.mediaDevices.getDisplayMedia = async (opts) => {
    if (window.__cancelPick) throw new DOMException('Permission denied', 'NotAllowedError')
    window.__picks.push(opts)
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360
    const x = cv.getContext('2d'); let n = window.__picks.length * 90
    setInterval(() => { x.fillStyle = `hsl(${(n += 7) % 360} 70% 50%)`; x.fillRect(0, 0, 640, 360) }, 60)
    const tracks = [...cv.captureStream(15).getVideoTracks()]
    if (opts.audio) { const ac = new AudioContext(); const osc = ac.createOscillator(); const dst = ac.createMediaStreamDestination(); osc.connect(dst); osc.start(); tracks.push(...dst.stream.getAudioTracks()) }
    return new MediaStream(tracks)
  }
}
const mk = async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(hooks)
  const p = await ctx.newPage(); p.on('pageerror', (x) => errors.push(x.message))
  await p.goto(`${WEB}/login`); await p.evaluate((x) => { localStorage.setItem('parley.token', x); localStorage.setItem('parley.directCallNote', '1'); localStorage.setItem('parley.voiceChat', '0') }, t)
  await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('[data-voice-prejoin]')
  await p.click('[data-voice-prejoin] button'); await p.waitForSelector('[data-call-status="connected"]', { timeout: 15000 })
  return p
}
const pa = await mk(a.token), pb = await mk(b.token)
const menu = async () => { if (!(await pa.locator('[data-screen-menu]').count())) await pa.click('[data-voice-controls] [data-device-chevron="screen"]'); await pa.waitForSelector('[data-screen-menu]') }
const closeMenu = async () => { await pa.keyboard.press('Escape'); await pa.waitForSelector('[data-screen-menu]', { state: 'detached' }) }
const setting = (k) => pa.evaluate((key) => JSON.parse(localStorage.getItem('parley.voiceSettings') ?? '{}')[key], k)
const screenBitrate = () => pa.evaluate(() => Math.max(0, ...window.__pcs.flatMap((pc) => pc.getSenders().filter((s) => s.track?.kind === 'video').map((s) => s.getParameters().encodings?.[0]?.maxBitrate ?? 0))))

console.log('-- choices before sharing')
await menu()
ok('the arrow beside the share button opens its choices', await pa.locator('[data-screen-menu] [data-stream-quality-option]').count() === 5 && await pa.locator('[data-stream-sound]').count() === 1)
ok('nothing is being shared yet, so no "going out" line', await pa.locator('[data-stream-info]').count() === 0)
await pa.click('[data-stream-quality-option="720p30"]')
ok('a quality picked here is the setting', await setting('streamQuality') === '720p30' && (await pa.getAttribute('[data-stream-quality-option="720p30"]', 'aria-checked')) === 'true')
await pa.click('[data-stream-sound]')
ok('sound can be left out', await setting('streamAudio') === false && (await pa.getAttribute('[data-stream-sound]', 'aria-checked')) === 'false')
await pa.screenshot({ path: 'callshare-menu.png' })
await closeMenu()

console.log('-- sharing with those choices')
await pa.click('[data-voice-controls] [data-call-screen]'); await pa.waitForSelector(`[data-voice-tile="${a.user.id}"] video`, { timeout: 8000 })
const first = await pa.evaluate(() => window.__picks[0])
ok('the picker is asked for the chosen size and frame rate', first.video.height.max === 720 && first.video.frameRate.max === 30, JSON.stringify(first.video))
ok('and for no sound', first.audio === false && !('systemAudio' in first))
await pb.click('button:has-text("Watch Stream")'); await pb.waitForSelector(`[data-voice-tile="${a.user.id}"] video`, { timeout: 15000 })
await pa.waitForFunction(() => window.__pcs.some((pc) => pc.getSenders().some((s) => s.track?.kind === 'video')), null, { timeout: 8000 })
ok('the bitrate cap matches the quality (2 Mbps)', await screenBitrate() === 2_000_000, String(await screenBitrate()))
await menu()
const info = await pa.locator('[data-stream-info]').textContent()
ok('the menu says what is going out', /640×360/.test(info) && /fps/.test(info) && /without sound/.test(info), info)

console.log('-- changing a running share')
await pa.click('[data-stream-quality-option="1080p60"]')
await pa.waitForFunction(() => Math.max(0, ...window.__pcs.flatMap((pc) => pc.getSenders().filter((s) => s.track?.kind === 'video').map((s) => s.getParameters().encodings?.[0]?.maxBitrate ?? 0))) === 6_000_000, null, { timeout: 5000 }).catch(() => {})
ok('a new quality applies to the share that is running (6 Mbps)', await screenBitrate() === 6_000_000, String(await screenBitrate()))
ok('without asking to pick again', (await pa.evaluate(() => window.__picks.length)) === 1)
await pa.click('[data-stream-sound]')
const shownTrack = () => pa.evaluate((id) => document.querySelector(`[data-voice-tile="${id}"] video`)?.srcObject?.getVideoTracks()[0]?.id ?? null, a.user.id)
const before = await shownTrack()
await pa.click('[data-stream-change]')
await pa.waitForFunction(() => window.__picks.length === 2, null, { timeout: 5000 }).catch(() => {})
const second = await pa.evaluate(() => window.__picks[1])
ok('Share Something Else opens the picker again, now with sound', !!second && typeof second.audio === 'object' && second.systemAudio === 'include' && second.video.frameRate.max === 60)
await pa.waitForTimeout(800)
ok('the share never stopped for the viewer', await pb.locator(`[data-voice-tile="${a.user.id}"] video`).count() === 1 && await pb.locator('button:has-text("Watch Stream")').count() === 0)
const after = await shownTrack()
ok('and is a different source', !!before && !!after && after !== before, `${before} → ${after}`)
await menu()
ok('the menu now says it is going out with sound', /with sound/.test(await pa.locator('[data-stream-info]').textContent()) && !/without sound/.test(await pa.locator('[data-stream-info]').textContent()))
await pa.evaluate(() => { window.__cancelPick = true })
await pa.click('[data-stream-change]'); await pa.waitForTimeout(600)
ok('cancelling the picker leaves the share as it was', await pa.locator(`[data-voice-tile="${a.user.id}"] video`).count() === 1 && await pb.locator(`[data-voice-tile="${a.user.id}"] video`).count() === 1)
await menu(); await pa.click('[data-stream-stop]')
await pa.waitForFunction((id) => !document.querySelector(`[data-voice-tile="${id}"] video`), a.user.id, { timeout: 5000 }).catch(() => {})
ok('Stop Sharing in the menu stops it', await pa.locator(`[data-voice-tile="${a.user.id}"] video`).count() === 0)

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
