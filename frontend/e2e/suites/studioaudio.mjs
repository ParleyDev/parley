// Studio audio: a stereo microphone stays stereo end to end (capture, the live call, the recorded track), and
// muting silences your recorded track as well as the call.
// The fake microphone plays a WAV with a tone in the RIGHT channel and silence in the left. Web Audio upmixes mono
// into the left channel only, so a fold to mono anywhere shows up as the tone moving left.
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WEB, S, reg, call, callS, ok, finish } from '../lib.mjs'

const wav = join(process.cwd(), `stereo-${S}.wav`)
{ const rate = 48000, secs = 30, n = rate * secs, buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) { buf.writeInt16LE(0, 44 + i * 4); buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 12000), 46 + i * 4) }
  writeFileSync(wav, buf) }

const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Stereo ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'studio-a', kind: 'studio' })).body
await callS(a.token, 'PUT', `/channels/${studio.id}/studio/engineer/${a.user.id}`)

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] }); const errors = []
// Keep the streams the app gets so the test can measure them: the raw mic, and every remote stream.
const spy = () => {
  window.__gum = []; window.__remote = []
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); window.__gum.push(s); return s }
  const O = window.RTCPeerConnection
  window.RTCPeerConnection = function (...args) { const pc = new O(...args); pc.addEventListener('track', (e) => { if (e.track.kind === 'audio') window.__remote.push(e.streams[0] ?? new MediaStream([e.track])) }); return pc }
  window.RTCPeerConnection.prototype = O.prototype
  // RMS of each channel of a stream over ~1.5 s, through a 2-channel splitter.
  window.__lr = async (stream) => {
    const ctx = new AudioContext(); await ctx.resume()
    const src = ctx.createMediaStreamSource(stream); const sp = ctx.createChannelSplitter(2); src.connect(sp)
    const an = [ctx.createAnalyser(), ctx.createAnalyser()]; sp.connect(an[0], 0); sp.connect(an[1], 1)
    const buf = new Float32Array(2048), sum = [0, 0]; let k = 0
    for (; k < 30; k++) { await new Promise((r) => setTimeout(r, 50)); an.forEach((x, i) => { x.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; sum[i] += s / buf.length }) }
    ctx.close(); return sum.map((s) => Math.sqrt(s / k))
  }
}
const mk = async (tok) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] }); await ctx.addInitScript(spy)
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}/channels/${g.id}/${studio.id}`); await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]')
  return p
}
const stereo = ([l, r]) => r > 0.02 && l < r * 0.1   // tone on the right, (near) silence on the left
const fmt = ([l, r]) => `L=${l.toFixed(4)} R=${r.toFixed(4)}`

const pa = await mk(a.token); const pb = await mk(b.token)
await callS(a.token, 'PUT', `/channels/${studio.id}/studio/role/${b.user.id}`, { role: 'artist' })
await pb.waitForSelector(`[data-voice-tile="${b.user.id}"]`); await pa.waitForTimeout(3000)

console.log('-- capture')
const cap = await pa.evaluate(async () => { const s = window.__gum.at(-1); return { ch: s.getAudioTracks()[0].getSettings().channelCount, lr: await window.__lr(s) } })
ok('the mic is captured in stereo', cap.ch === 2 && stereo(cap.lr), `channelCount=${cap.ch} ${fmt(cap.lr)}`)

console.log('-- live call')
// Each peer has two audio transceivers (microphone, and screen-share audio, silent here): measure the loudest.
const live = await pb.evaluate(async () => {
  const live = window.__remote.filter((x) => x.getAudioTracks().some((t) => t.readyState === 'live'))
  let best = null
  for (const s of live) { const lr = await window.__lr(s); if (!best || lr[0] + lr[1] > best[0] + best[1]) best = lr }
  return best
})
ok('bob hears alice in stereo', !!live && stereo(live), live ? fmt(live) : 'no remote stream')

console.log('-- recording')
const rec = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/sessions`, { name: 'take 1' })).body
await pa.waitForTimeout(3500)
await pa.click('[data-voice-controls] button[title="Mute"]'); const mutedAt = Date.now()
await pa.waitForTimeout(3500)
await callS(a.token, 'POST', `/channels/${studio.id}/studio/sessions/${rec.id}/stop`)
await pa.waitForFunction(() => !document.querySelector('[data-studio-rec]'), null, { timeout: 15000 }).catch(() => {})
await pa.waitForTimeout(2500)
const sessions = await call(a.token, 'GET', `/channels/${studio.id}/studio/sessions`)
const track = sessions.find((x) => x.id === rec.id)?.tracks.find((t) => t.user_id === a.user.id && t.done)
ok("alice's track was recorded", !!track, JSON.stringify(sessions.find((x) => x.id === rec.id)?.tracks ?? []))
if (track) {
  const res = await pa.evaluate(async ({ url, tok }) => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } }); const buf = await new AudioContext().decodeAudioData(await r.arrayBuffer())
    const rms = (ch, from, to) => { const d = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1)); let s = 0, n = 0; for (let i = Math.floor(from * buf.sampleRate); i < Math.min(d.length, to * buf.sampleRate); i++) { s += d[i] * d[i]; n++ } return Math.sqrt(s / Math.max(1, n)) }
    const dur = buf.duration
    return { channels: buf.numberOfChannels, dur, before: [rms(0, 0.5, 2.5), buf.numberOfChannels > 1 ? rms(1, 0.5, 2.5) : 0], tail: [rms(0, dur - 1.5, dur), buf.numberOfChannels > 1 ? rms(1, dur - 1.5, dur) : 0] }
  }, { url: `/api/studio/tracks/${track.id}`, tok: a.token })
  ok('the recorded track is stereo', res.channels === 2 && stereo(res.before), `channels=${res.channels} ${fmt(res.before)}`)
  ok('muting silences the recording', Math.max(...res.tail) < 0.005 && Math.max(...res.before) > 0.02, `before ${fmt(res.before)} muted tail ${fmt(res.tail)} (muted ${((Date.now() - mutedAt) / 1000).toFixed(1)}s ago, track ${res.dur.toFixed(1)}s)`)
}
await pa.click('[data-voice-leave]'); await pb.click('[data-voice-leave]')
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
