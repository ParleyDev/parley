// Voice message transcription (stub OpenAI-compatible STT server) and listened state.
import http from 'node:http'
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, multi, adminToken, ok, finish } from '../lib.mjs'

const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
const seen = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c.toString('latin1') })
  req.on('end', () => {
    const model = /name="model"\r\n\r\n([^\r]+)/.exec(body)?.[1]
    seen.push({ url: req.url, auth: req.headers.authorization, model, hasFile: /name="file"; filename="voice-message\.wav"/.test(body) && body.includes('RIFF') })
    if (model === 'fail') { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"boom"}'); return }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ text: `  hello from the stub ${S}  ` }))
  })
})
await new Promise((r) => server.listen(0, '0.0.0.0', r)); const PORT = server.address().port
const STT = `http://${HOST}:${PORT}`

const admin = await adminToken()
const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Voice tx ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
const wav = () => { const n = 1600; const buf = Buffer.alloc(44 + n); buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40); for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(100 * Math.sin(i / 4)); return { buffer: buf, mimeType: 'audio/wav', name: 'voice-message.wav' } }
const wave = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37) % 256)).toString('base64')
let settings = await call(admin.token, 'GET', '/admin/settings')
const put = async (patch) => { const r = await callS(admin.token, 'PUT', '/admin/settings', { ...settings, ...patch }); if (r.status === 200) settings = r.body; return r }
const sendVoice = async (tok, dur = 2500) => { const att = await (await multi(tok, `/channels/${tc.id}/attachments`, wav(), { duration_ms: String(dur), waveform: wave })).json(); return (await callS(tok, 'POST', `/channels/${tc.id}/messages`, { content: '', attachment_ids: [att.id] })).body }
const untilStatus = async (tok, mid, want) => { for (let i = 0; i < 40; i++) { const m = (await call(tok, 'GET', `/channels/${tc.id}/messages?limit=10`)).find((x) => x.id === mid); if (m?.attachments[0].transcript_status === want) return m; await new Promise((r) => setTimeout(r, 150)) } return null }

console.log('-- transcription settings')
let r = await put({ stt_url: 'ftp://nope' }); ok('STT URL must be http(s)', r.status === 400)
r = await put({ stt_url: STT + '/', stt_api_key: `key-${S}`, stt_model: 'stub' })
ok('admin turns transcription on (trailing slash trimmed)', r.status === 200 && r.body.stt_url === STT && r.body.transcription === true && r.body.stt_api_key === `key-${S}`)
const pub = await call(a.token, 'GET', '/instance'); ok('/instance says transcription is on but hides the server and key', pub.transcription === true && pub.stt_url === '' && pub.stt_api_key === '')
ok('setting change is audited without the key', (await call(admin.token, 'GET', '/admin/audit')).some((e) => e.action === 'settings.update' && e.details?.stt_url === STT && e.details?.stt_api_key === 'set'))

console.log('-- transcription')
let m = await sendVoice(a.token)
ok('new voice message starts pending', m.attachments[0].transcript_status === 'pending' && m.attachments[0].transcript === undefined, JSON.stringify(m.attachments))
m = await untilStatus(b.token, m.id, 'done')
ok('transcript arrives, trimmed', m?.attachments[0].transcript === `hello from the stub ${S}`, JSON.stringify(m?.attachments))
const req = seen[0]
ok('stub got an OpenAI-style multipart with bearer key, model and the file', req?.url === '/v1/audio/transcriptions' && req.auth === `Bearer key-${S}` && req.model === 'stub' && req.hasFile === true, JSON.stringify(req))
const plain = await (await multi(a.token, `/channels/${tc.id}/attachments`, wav(), {})).json()
const pm = (await callS(a.token, 'POST', `/channels/${tc.id}/messages`, { content: '', attachment_ids: [plain.id] })).body
ok('ordinary audio files are not transcribed', pm.attachments[0].transcript_status === undefined && seen.length === 1)
await put({ stt_model: 'fail' })
let fm = await sendVoice(a.token); fm = await untilStatus(a.token, fm.id, 'failed')
ok('a failing server marks the transcript failed, message still fine', fm?.attachments[0].transcript_status === 'failed' && fm.attachments[0].transcript === undefined)
await put({ stt_model: 'stub' })

console.log('-- listened')
const vid = m.attachments[0].id
r = await raw(b.token, 'POST', `/attachments/${vid}/listened`); ok('bob marks it listened', r.status === 204)
r = await raw(b.token, 'POST', `/attachments/${vid}/listened`); ok('idempotent', r.status === 204)
ok('message shows who listened', (await call(a.token, 'GET', `/channels/${tc.id}/messages?limit=10`)).find((x) => x.id === m.id).attachments[0].listened_by?.join() === b.user.id)
r = await raw(b.token, 'POST', `/attachments/${plain.id}/listened`); ok('not a voice message -> 404', r.status === 404)
r = await raw(c.token, 'POST', `/attachments/${vid}/listened`); ok('non-members cannot mark', r.status === 403 || r.status === 404)
r = await raw(b.token, 'POST', `/attachments/${g.id}/listened`); ok('unknown attachment -> 404', r.status === 404)

console.log('-- UI')
const browser = await chromium.launch(); const errors = []
const mk = async (tok) => { const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('textarea'); return p }
const pa = await mk(a.token); const pb = await mk(b.token)
const cardB = pb.locator(`[data-voice-message="${vid}"]`); await cardB.waitFor()
ok('bob (already listened) has no unplayed dot', await cardB.locator('[data-voice-unplayed]').count() === 0 && (await cardB.getAttribute('data-listened')) === '1')
ok('transcript is collapsed behind a toggle', await cardB.locator('[data-voice-transcript-toggle]').count() === 1 && await cardB.locator('[data-voice-transcript]').count() === 0)
await cardB.locator('[data-voice-transcript-toggle]').click()
ok('toggle expands the transcript under the player', (await cardB.locator('[data-voice-transcript]').textContent()) === `hello from the stub ${S}`)
await pb.screenshot({ path: '132-voice-transcript.png' })
ok('failed one says unavailable', await pb.locator(`[data-voice-message="${fm.attachments[0].id}"] [data-voice-transcript-failed]`).count() === 1)
const cardA = pa.locator(`[data-voice-message="${vid}"]`); await cardA.waitFor()
ok('alice sees one listener with names on hover', (await cardA.getAttribute('data-listeners')) === '1' && (await cardA.locator('[data-voice-listeners]').locator('xpath=..').getAttribute('data-tip')) === 'Listened by Bob')
// A fresh one: bob sees the dot, "Transcribing…" until the stub answers, and playing it through marks it listened live for alice.
server.slow = true
const fresh = await sendVoice(a.token, 1000)
const fid = fresh.attachments[0].id
const fB = pb.locator(`[data-voice-message="${fid}"]`); await fB.waitFor()
ok('unheard voice message shows the dot', await fB.locator('[data-voice-unplayed]').count() === 1)
await pb.waitForFunction((id) => document.querySelector(`[data-voice-message="${id}"]`)?.getAttribute('data-transcript') === 'done', fid)
ok('transcript lands live via MESSAGE_UPDATE', await fB.locator('[data-voice-transcript-toggle]').count() === 1)
await fB.locator('[data-voice-play]').click()
await pb.waitForFunction((id) => document.querySelector(`[data-voice-message="${id}"]`)?.getAttribute('data-listened') === '1', fid, { timeout: 15000 })
ok('playing it to the end marks it listened and drops the dot', await fB.locator('[data-voice-unplayed]').count() === 0)
await pa.waitForFunction((id) => document.querySelector(`[data-voice-message="${id}"]`)?.getAttribute('data-listeners') === '1', fid)
ok('alice sees the listener badge appear live', await pa.locator(`[data-voice-message="${fid}"] [data-voice-listeners]`).count() === 1)
await pa.screenshot({ path: '133-voice-listened.png' })
ok('no page errors', errors.length === 0, errors.join('\n'))

r = await put({ stt_url: '', stt_api_key: '', stt_model: '' }); ok('turning it off', r.status === 200 && r.body.transcription === false)
const after = await sendVoice(a.token); ok('with STT off nothing is pending', after.attachments[0].transcript_status === undefined)
await browser.close(); server.close(); await finish()
