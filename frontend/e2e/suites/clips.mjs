// Clips: off until turned on in Settings → Clips; then the keybind (or the scissors in the call bar) saves the last
// stretch of the call: the stream you're watching with its sound, or just the call's sound when nothing is shared.
// Clips stay on the device (IndexedDB), play back, download and delete. The clip length is shortened for the test.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Clips ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const vc = g.channels.find((x) => x.kind === 'voice')
await call(a.token, 'PATCH', `/channels/${vc.id}`, { e2ee: false })
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const hooks = () => {
  window.__parleyClipSeconds = 4
  navigator.mediaDevices.getDisplayMedia = async () => {
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180
    const x = cv.getContext('2d'); let n = 0
    setInterval(() => { x.fillStyle = `hsl(${(n += 7) % 360} 70% 50%)`; x.fillRect(0, 0, 320, 180) }, 60)
    const ac = new AudioContext(); const osc = ac.createOscillator(); const dst = ac.createMediaStreamDestination()
    osc.frequency.value = 440; osc.connect(dst); osc.start()
    return new MediaStream([...cv.captureStream(15).getVideoTracks(), ...dst.stream.getAudioTracks()])
  }
  // The saved clips, straight from IndexedDB: kind, size, length and loudness of the sound.
  window.__clips = () => new Promise((resolve) => {
    const req = indexedDB.open('parley-clips', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('clips', { keyPath: 'id' })
    req.onsuccess = () => { const r = req.result.transaction('clips').objectStore('clips').getAll(); r.onsuccess = () => resolve(r.result) }
  })
  window.__clipInfo = async () => {
    const list = (await window.__clips()).sort((x, y) => y.at - x.at); const c = list[0]
    if (!c) return null
    let peak = 0, dur = 0
    try { const buf = await new AudioContext().decodeAudioData(await c.blob.arrayBuffer()); dur = buf.duration; const d = buf.getChannelData(0); for (let i = 0; i < d.length; i += 10) peak = Math.max(peak, Math.abs(d[i])) } catch { /* no sound track */ }
    return { n: list.length, mime: c.mime, size: c.blob.size, seconds: c.seconds, dur, peak }
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
const pa = await mk(a.token), pb = await mk(b.token)
await pa.waitForFunction(() => document.querySelectorAll('[data-voice-tile]').length === 2, null, { timeout: 15000 })

console.log('-- off by default')
ok('no scissors in the call bar', await pb.locator('[data-clip-save]').count() === 0)
await pb.keyboard.press('Control+Alt+c')
ok('the keybind says to turn Clips on', await pb.waitForSelector('text=Turn on Clips', { timeout: 3000 }).then(() => true).catch(() => false))

console.log('-- a stream')
await pa.click('button[aria-label="Share Your Screen"], button[title="Share Your Screen"]')
await pb.waitForSelector('[data-watch-stream]', { timeout: 10000 }); await pb.click('[data-watch-stream]')
await pb.click('button[title="User Settings"]'); await pb.click('[data-settings-tab="clips"]'); await pb.click('[data-clips-enable] button')
await pb.keyboard.press('Escape')
ok('turning Clips on adds the scissors', await pb.waitForSelector('[data-clip-save]', { timeout: 3000 }).then(() => true).catch(() => false))
await pb.waitForTimeout(7000)
await pb.click('[data-clip-save]')
await pb.waitForFunction(async () => ((await window.__clips()).length === 1), null, { timeout: 8000 }).catch(() => {})
const v = await pb.evaluate(() => window.__clipInfo())
ok('saving keeps the stream as a video', v?.mime.startsWith('video/') && v.size > 20000, JSON.stringify(v))
ok('about the clip length', v && v.seconds >= 4 && v.seconds <= 8, JSON.stringify(v))
ok('with the sound', v && v.peak > 0.05, JSON.stringify(v))

console.log('-- just the call')
await pb.click('[data-watch-stream]').catch(() => {})
await pa.click('button[aria-label="Stop Sharing"], button[title="Stop Sharing"]')
await pb.waitForTimeout(7000)
await pb.keyboard.press('Control+Alt+c')
await pb.waitForFunction(async () => ((await window.__clips()).length === 2), null, { timeout: 8000 }).catch(() => {})
const s = await pb.evaluate(() => window.__clipInfo())
ok('with nothing shared, the keybind keeps the call sound', s?.n === 2 && s.mime.startsWith('audio/') && s.size > 2000, JSON.stringify(s))

console.log('-- the list')
await pb.click('button[title="User Settings"]'); await pb.click('[data-settings-tab="clips"]'); await pb.waitForSelector('[data-clip]')
ok('Settings → Clips lists both, newest first', await pb.locator('[data-clip]').count() === 2 && await pb.locator('[data-clip]').first().getAttribute('data-clip-kind') === 'audio')
ok('each can be downloaded', (await pb.locator('[data-clip-download]').first().getAttribute('download')).startsWith('parley-clip-'))
await pb.locator('[data-clip-delete]').first().click()
ok('and deleted', await pb.waitForFunction(() => document.querySelectorAll('[data-clip]').length === 1, null, { timeout: 3000 }).then(() => true).catch(() => false) && (await pb.evaluate(async () => (await window.__clips()).length)) === 1)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
