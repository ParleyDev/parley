// Voice messages play on every browser, iPhones included: WebM/Opus recordings are converted to AAC .m4a on upload
// (needs ffmpeg in the backend image), iPhone recordings (audio/mp4) count as voice messages, and attachments answer
// HTTP Range requests (iOS will not play media without them).
import { chromium, webkit } from 'playwright'
import { B, reg, call, ok, finish } from '../lib.mjs'

const a = await reg('vmaudio')
const g = await call(a.token, 'POST', '/guilds', { name: 'VM audio' }); const tc = g.channels.find((c) => c.kind === 'text').id

// A real recorder WebM (Opus, no duration or cues), the kind Chrome and Android produce.
const rec = await chromium.launch(); const rp = await rec.newPage()
const webm = Buffer.from(await rp.evaluate(async () => {
  const ctx = new AudioContext(); const osc = ctx.createOscillator(); const dest = ctx.createMediaStreamDestination(); osc.connect(dest); osc.start()
  const mr = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' }); const chunks = []
  mr.ondataavailable = (e) => chunks.push(e.data); mr.start()
  await new Promise((r) => setTimeout(r, 1500)); await new Promise((r) => { mr.onstop = r; mr.stop() })
  return [...new Uint8Array(await new Blob(chunks).arrayBuffer())]
}))
await rec.close()
ok('recorded a WebM/Opus clip', webm.subarray(0, 4).toString('hex') === '1a45dfa3' && webm.length > 1000)

const upload = async (bytes, name, type, fields = {}) => {
  const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); f.append('file', new Blob([bytes], { type }), name)
  return (await fetch(`${B}/channels/${tc}/attachments`, { method: 'POST', headers: { Authorization: 'Bearer ' + a.token }, body: f })).json()
}
const vm = await upload(webm, 'voice-message.webm', 'audio/webm;codecs=opus', { duration_ms: '1500', waveform: 'abcdefgh' })
ok('voice message converted to AAC .m4a on upload', vm.content_type === 'audio/mp4' && vm.filename === 'voice-message.m4a' && vm.duration_ms === 1500 && vm.size > 1000, JSON.stringify(vm).slice(0, 200))
const url = `${B}/attachments/${vm.id}/${vm.filename}`
const m4a = Buffer.from(await (await fetch(url)).arrayBuffer())
ok('stored file is MP4 audio', m4a.subarray(4, 8).toString() === 'ftyp' && m4a.length === vm.size)

let r = await fetch(url, { headers: { Range: 'bytes=0-99' } })
ok('Range request answers 206 with the slice', r.status === 206 && r.headers.get('content-range') === `bytes 0-99/${vm.size}` && r.headers.get('accept-ranges') === 'bytes' && (await r.arrayBuffer()).byteLength === 100)
r = await fetch(url, { headers: { Range: `bytes=${vm.size - 10}-` } })
ok('open-ended range returns the tail', r.status === 206 && Buffer.from(await r.arrayBuffer()).equals(m4a.subarray(vm.size - 10)))
r = await fetch(url, { headers: { Range: `bytes=${vm.size + 5}-` } })
ok('a range past the end is 416', r.status === 416 && r.headers.get('content-range') === `bytes */${vm.size}`)
r = await fetch(url)
ok('no Range: whole file, 200, advertises ranges', r.status === 200 && r.headers.get('accept-ranges') === 'bytes' && Number(r.headers.get('content-length')) === vm.size)

for (const [name, bt] of [['Chromium', chromium], ['WebKit', webkit]]) {
  const br = await bt.launch(); const p = await br.newPage(); await p.goto(url.replace(/\/attachments\/.*/, '/instance'))
  const res = await p.evaluate(async (u) => { const el = new Audio(); el.muted = true; el.src = u; const s = await new Promise((done) => { el.onloadedmetadata = () => done('ok'); el.onerror = () => done('error'); setTimeout(() => done('timeout'), 5000) }); if (s !== 'ok') return { s }; try { await el.play() } catch (e) { return { s: 'play:' + e.name } } return { s, d: el.duration } }, url)
  ok(`${name} loads and plays it with a real duration`, res.s === 'ok' && Number.isFinite(res.d) && Math.abs(res.d - 1.5) < 0.5, JSON.stringify(res))
  await br.close()
}

const iphone = await upload(m4a, 'voice-message.mp4', 'audio/mp4', { duration_ms: '1500' })
ok('an iPhone recording (audio/mp4) is a voice message, kept as is', iphone.content_type === 'audio/mp4' && iphone.duration_ms === 1500 && iphone.filename === 'voice-message.mp4', JSON.stringify(iphone).slice(0, 200))
const plain = await upload(webm, 'song.webm', 'audio/webm')
ok('ordinary audio files are not converted', plain.content_type.startsWith('audio/webm') && plain.filename === 'song.webm' && plain.duration_ms == null, JSON.stringify(plain).slice(0, 160))
await finish()
