// Enhanced noise suppression (RNNoise in an AudioWorklet): with a microphone that only picks up noise, the other
// side hears far less in Enhanced than in Standard; Enhanced turns the browser's own suppressor off; the setting
// switches live during a call.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Noise ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
// Alice's "microphone": steady brown noise (a fan or rumble), no speech at all. Requested constraints are recorded.
const noiseMic = () => {
  window.__gum = []
  navigator.mediaDevices.getUserMedia = async (c) => {
    window.__gum.push(c)
    const ac = new AudioContext({ sampleRate: 48000 }); const len = ac.sampleRate * 2
    const buf = ac.createBuffer(1, len, ac.sampleRate); const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3 }
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true
    const dst = ac.createMediaStreamDestination(); src.connect(dst); src.start()
    return dst.stream
  }
}
const level = () => window.__lvl ??= (el) => new Promise((resolve) => {
  if (!el?.srcObject) return resolve(0)
  const ac = new AudioContext(); const an = ac.createAnalyser(); ac.createMediaStreamSource(el.srcObject).connect(an)
  const buf = new Float32Array(an.fftSize); let sum = 0, n = 0
  const t = setInterval(() => { an.getFloatTimeDomainData(buf); for (const v of buf) { sum += v * v; n++ } if (n > an.fftSize * 25) { clearInterval(t); ac.close(); resolve(Math.sqrt(sum / n)) } }, 40)
})
const mk = async (tok, mic) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] })
  if (mic) await ctx.addInitScript(noiseMic)
  // Always transmit (no voice gate), so what the suppressor does is all that changes.
  await ctx.addInitScript(() => { try { localStorage.setItem('parley.voiceSettings', JSON.stringify({ inputMode: 'open', noiseSuppression: true, noiseSuppressionMode: 'standard' })) } catch { /* ignore */ } })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('text=Join Voice')
  await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]')
  return p
}
const pa = await mk(a.token, true), pb = await mk(b.token, false)
await pb.waitForFunction((u) => !!document.querySelector(`audio[data-peer="${u}"]`)?.srcObject, a.user.id, { timeout: 15000 })
await pb.waitForTimeout(2500)
await pb.evaluate(level)
const heard = () => pb.evaluate((u) => window.__lvl(document.querySelector(`audio[data-peer="${u}"]:not([data-stream-audio])`)), a.user.id)

const std = await heard()
ok('Standard: bob hears the noise', std > 0.01, String(std))
ok('Standard asks the browser for noise suppression', (await pa.evaluate(() => window.__gum.at(-1)?.audio?.noiseSuppression)) === true)

console.log('-- switch to Enhanced mid-call')
await pa.click('[aria-label="User Settings"], button[title="User Settings"]')
await pa.locator('button:has-text("Voice & Video")').first().click(); await pa.waitForSelector('[data-ns-mode]')
await pa.click('[data-ns-mode-option="enhanced"]'); await pa.waitForTimeout(3000)
ok('Enhanced turns the browser suppressor off', (await pa.evaluate(() => window.__gum.at(-1)?.audio?.noiseSuppression)) === false)
const enh = await heard()
ok('Enhanced: most of the noise is gone', enh < std * 0.35, `${std.toFixed(4)} → ${enh.toFixed(4)}`)
await pa.click('[data-ns-mode-option="standard"]'); await pa.waitForTimeout(3000)
const back = await heard()
ok('back to Standard: the noise is back', back > std * 0.5, `${back.toFixed(4)}`)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
