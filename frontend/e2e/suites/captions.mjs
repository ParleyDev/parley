// Live captions: someone in the call turns them on, speakers' clients send short clips of their speech to the
// server's speech-to-text (a stub here), and the lines show for everyone with captions on, not for anyone else.
// Off in end-to-end encrypted calls; clips stop when nobody wants captions.
import http from 'node:http'
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, adminToken, ok, finish } from '../lib.mjs'

const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
const clips = []
const server = http.createServer((req, res) => {
  const parts = []; req.on('data', (c) => parts.push(c))
  req.on('end', () => {
    const body = Buffer.concat(parts).toString('latin1')
    clips.push({ url: req.url, file: /filename="(caption\.\w+)"/.exec(body)?.[1], size: body.length })
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ text: ` testing one two ${S} ` }))
  })
})
await new Promise((r) => server.listen(0, '0.0.0.0', r))
const admin = await adminToken()
const original = await call(admin.token, 'GET', '/admin/settings')
await callS(admin.token, 'PUT', '/admin/settings', { ...original, stt_url: `http://${HOST}:${server.address().port}`, stt_model: 'stub' })
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Captions ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const vc = g.channels.find((x) => x.kind === 'voice')
await call(a.token, 'PATCH', `/channels/${vc.id}`, { e2ee: false })
const secret = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'Secret', kind: 'voice' })

console.log('-- API')
ok('not in the call: refused', (await raw(a.token, 'POST', `/channels/${vc.id}/captions`, new Uint8Array(2048))).status === 400)

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const mk = async (tok, ch) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}/channels/${g.id}/${ch}`); await p.waitForSelector('text=Join Voice')
  await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]')
  return p
}
const pa = await mk(a.token, vc.id), pb = await mk(b.token, vc.id), pc = await mk(c.token, vc.id)
await pa.waitForFunction(() => document.querySelectorAll('[data-voice-tile]').length === 3, null, { timeout: 15000 })
await pa.waitForTimeout(3000)

console.log('-- captions')
ok('nobody wants captions, so nothing is sent', clips.length === 0)
ok('the CC button is ready in an unencrypted call', await pb.locator('[data-captions-toggle="off"]').isEnabled())
await pb.click('[data-captions-toggle]')
await pb.waitForSelector('[data-captions-toggle="on"]')
await pb.waitForSelector('[data-captions] [data-caption-line]', { timeout: 20000 }).catch(() => {})
ok('speakers send short clips of their speech', clips.length > 0 && clips.every((x) => x.url === '/v1/audio/transcriptions' && /^caption\.(webm|ogg|m4a)$/.test(x.file)), JSON.stringify(clips.slice(0, 3)))
const text = await pb.locator('[data-captions]').innerText().catch(() => '')
ok('the line shows with who said it', text.includes(`testing one two ${S}`) && /(Alice|Carol|Bob):/.test(text), text)
ok('people without captions on see nothing', await pc.locator('[data-captions]').count() === 0)
await pb.click('[data-captions-toggle]'); await pb.waitForSelector('[data-captions-toggle="off"]')
await pb.waitForTimeout(5000); const n = clips.length; await pb.waitForTimeout(6000)
ok('turning it off stops the clips', clips.length === n, `${n} → ${clips.length}`)

console.log('-- encrypted calls')
// Alice leaves the first call before her other window joins the encrypted one, so the two don't race.
await pa.click('[data-voice-leave]'); await pa.waitForSelector('text=Join Voice')
const pe = await mk(a.token, secret.id)
ok('the CC button is off in an end-to-end encrypted call', await pe.locator('[data-captions-toggle]').isDisabled() && /end-to-end/.test(await pe.locator('[data-captions-toggle]').getAttribute('title') ?? ''))
await pe.waitForTimeout(800)
ok('and the server refuses clips there', (await raw(a.token, 'POST', `/channels/${secret.id}/captions`, new Uint8Array(2048))).status === 400)
ok('no page errors', errors.length === 0, errors.join(' | '))
await callS(admin.token, 'PUT', '/admin/settings', original)
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); server.close(); await finish()
