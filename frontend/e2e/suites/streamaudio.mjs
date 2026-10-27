// Screen share sound: the share asks for tab/system audio, and its sound goes only to people watching the stream
// (like the picture), plays on its own element that follows deafen, and stops with the share.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish, adminToken } from '../lib.mjs'
const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Sound ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
await call(b.token, 'POST', `/invites/${inv.code}`); await call(c.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
// A canvas plus a 440 Hz tone stands in for a shared tab with sound; the requested constraints are recorded.
const hooks = () => {
  const Orig = window.RTCPeerConnection
  window.__pcs = []
  window.RTCPeerConnection = function (...args) { const pc = new Orig(...args); window.__pcs.push(pc); return pc }
  window.RTCPeerConnection.prototype = Orig.prototype
  navigator.mediaDevices.getDisplayMedia = async (opts) => {
    window.__displayOpts = opts
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180
    const x = cv.getContext('2d'); let n = 0
    setInterval(() => { x.fillStyle = `hsl(${(n += 7) % 360} 70% 50%)`; x.fillRect(0, 0, 320, 180) }, 60)
    const ac = new AudioContext(); const osc = ac.createOscillator(); const dst = ac.createMediaStreamDestination()
    osc.frequency.value = 440; osc.connect(dst); osc.start()
    return new MediaStream([...cv.captureStream(15).getVideoTracks(), ...dst.stream.getAudioTracks()])
  }
  // Loudness of whatever an <audio> element is playing.
  window.__level = (el) => new Promise((resolve) => {
    if (!el?.srcObject) return resolve(0)
    const ac = new AudioContext(); const an = ac.createAnalyser(); ac.createMediaStreamSource(el.srcObject).connect(an)
    const buf = new Float32Array(an.fftSize); let peak = 0, n = 0
    const t = setInterval(() => { an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); if (++n > 15) { clearInterval(t); ac.close(); resolve(peak) } }, 60)
  })
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
const sendingSound = (p) => p.evaluate(() => window.__pcs.filter((pc) => pc.connectionState !== 'closed').reduce((n, pc) => n + pc.getTransceivers().filter((t) => t.receiver.track.kind === 'audio').slice(1).filter((t) => t.sender.track).length, 0))
const level = (p, uid) => p.evaluate((u) => window.__level(document.querySelector(`audio[data-stream-audio="${u}"]`)), uid)
const pa = await mk(a.token); const pb = await mk(b.token); const pc = await mk(c.token)
await pa.waitForFunction(() => document.querySelectorAll('[data-voice-tile]').length === 3, null, { timeout: 15000 })
await pa.waitForTimeout(1500)

console.log('-- share with sound')
await pa.click('button[aria-label="Share Your Screen"], button[title="Share Your Screen"]')
await pb.waitForSelector('[data-stream-gate]', { timeout: 10000 })
const opts = await pa.evaluate(() => window.__displayOpts)
ok('the share asks for tab and system audio, unprocessed', opts?.audio && opts.audio.echoCancellation === false && opts.systemAudio === 'include', JSON.stringify(opts))
await pa.waitForTimeout(800)
ok('nobody gets the sound before watching', (await sendingSound(pa)) === 0)
ok('so nothing plays for bob', (await level(pb, a.user.id)) < 0.01)

console.log('-- watch')
await pb.click('[data-watch-stream]')
await pb.waitForFunction((u) => !!document.querySelector(`audio[data-stream-audio="${u}"]`), a.user.id, { timeout: 10000 }).catch(() => {})
await pb.waitForTimeout(1500)
ok('bob is sent the sound once he watches', (await sendingSound(pa)) === 1, String(await sendingSound(pa)))
const lb = await level(pb, a.user.id)
ok('and hears it', lb > 0.05, String(lb))
ok('carol, not watching, hears nothing', (await level(pc, a.user.id)) < 0.01)
await pb.locator('button[title="Deafen"]').first().click()
await pb.waitForTimeout(300)
ok('deafening mutes the stream sound too', await pb.evaluate((u) => document.querySelector(`audio[data-stream-audio="${u}"]`)?.muted === true, a.user.id))
await pb.locator('button[title="Undeafen"]').first().click()

console.log('-- stop')
await pa.click('button[aria-label="Stop Sharing"], button[title="Stop Sharing"]'); await pa.waitForTimeout(1000)
ok('stopping the share stops sending sound', (await sendingSound(pa)) === 0)
ok('the microphone still flows both ways', await pb.evaluate(() => window.__pcs.some((pc) => pc.connectionState === 'connected' && pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio')?.sender.track)))
for (const p of [pa, pb, pc]) await p.close()

// The same through a LiveKit SFU, when the dev server is up (compose profile "sfu"): the sound is its own
// screen_share_audio track, subscribed only while watching.
let lk = false; try { lk = !!(await fetch('http://localhost:7880')).status } catch { /* no SFU here */ }
if (lk) {
  console.log('-- SFU')
  const admin = await adminToken(); const original = await call(admin.token, 'GET', '/admin/settings')
  await call(admin.token, 'PUT', '/admin/settings', { ...original, livekit_url: 'ws://localhost:7880', livekit_api_key: 'devkey', livekit_api_secret: 'secret' })
  try {
    const sa = await mk(a.token); const sb = await mk(b.token)
    await sa.waitForFunction(() => document.querySelectorAll('[data-voice-tile]').length === 2, null, { timeout: 15000 }); await sa.waitForTimeout(1500)
    await sa.click('button[aria-label="Share Your Screen"], button[title="Share Your Screen"]')
    await sb.waitForSelector('[data-stream-gate]', { timeout: 10000 }); await sb.waitForTimeout(1000)
    ok('SFU: no sound before watching', (await level(sb, a.user.id)) < 0.01)
    await sb.click('[data-watch-stream]')
    await sb.waitForFunction((u) => !!document.querySelector(`audio[data-stream-audio="${u}"]`), a.user.id, { timeout: 10000 }).catch(() => {})
    await sb.waitForTimeout(1500)
    const l = await level(sb, a.user.id)
    ok('SFU: the stream sound plays after Watch Stream', l > 0.05, String(l))
    await sb.locator('[data-voice-tile]:has-text("\'s screen")').first().hover(); await sb.click('[data-stop-watching]'); await sb.waitForTimeout(1000)
    ok('SFU: Stop Watching stops it', await sb.locator(`audio[data-stream-audio="${a.user.id}"]`).count() === 0)
  } finally { await call(admin.token, 'PUT', '/admin/settings', original) }
}
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
