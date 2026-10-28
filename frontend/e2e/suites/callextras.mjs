// Call extras: declining a DM call (the caller is told, your other devices stop ringing), ringing people again from a
// group call, stream preview stills on Watch Stream, video numbers and connection quality, and the floating mini call.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
const friend = async (x, y) => { await call(x.token, 'POST', '/users/@me/relationships', { user_id: y.user.id }); await call(y.token, 'PUT', `/users/@me/relationships/${x.user.id}`) }
await friend(a, b); await friend(a, c); await friend(b, c)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
const trio = await call(a.token, 'POST', '/users/@me/channels', { recipient_ids: [b.user.id, c.user.id], name: `Trio ${S}` })
const g = await call(a.token, 'POST', '/guilds', { name: `Calls ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const vc = g.channels.find((x) => x.kind === 'voice'), general = g.channels.find((x) => x.kind === 'text')
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const mk = async (tok, path) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone', 'camera'] })
  await ctx.addInitScript(() => { navigator.mediaDevices.getDisplayMedia = async () => { const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; const x = cv.getContext('2d'); let n = 0; setInterval(() => { x.fillStyle = `hsl(${(n += 9) % 360} 70% 50%)`; x.fillRect(0, 0, 640, 360) }, 60); return cv.captureStream(15) } })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}${path}`); await p.waitForTimeout(900)
  return p
}

console.log('-- decline')
const pa = await mk(a.token, `/channels/@me/${dm.id}`), pb = await mk(b.token, '/channels/@me'), pb2 = await mk(b.token, '/channels/@me')
await pa.click('[data-start-call]'); await pa.waitForSelector('[data-dm-call]')
await pb.waitForSelector('[data-incoming-call]', { timeout: 8000 }); await pb2.waitForSelector('[data-incoming-call]', { timeout: 8000 })
await pb.click('[data-call-decline]'); await pa.waitForTimeout(800)
ok('the caller is told you declined', (await pa.locator('body').innerText()).includes(`${b.user.display_name} declined the call`))
ok('and your other devices stop ringing', await pb2.locator('[data-incoming-call]').count() === 0)
ok('declining a server channel is refused', (await raw(b.token, 'POST', `/channels/${general.id}/call/decline`)).status === 400)
await pa.click('[aria-label="Leave Call"]'); await pa.waitForTimeout(500)

console.log('-- ring again')
const pc = await mk(c.token, '/channels/@me')
ok('ringing needs you in the call', (await raw(a.token, 'POST', `/channels/${trio.id}/call/ring`, { user_ids: [c.user.id] })).status === 400)
await pa.goto(`${WEB}/channels/@me/${trio.id}`); await pa.waitForTimeout(600)
await pa.click('[data-start-call]'); await pa.click('button:has-text("Start Call")').catch(() => {}); await pa.waitForSelector('[data-dm-call]')
await pc.waitForSelector('[data-incoming-call]', { timeout: 8000 }); await pc.click('[data-call-decline]'); await pc.waitForTimeout(500)
ok('people not in the call get a Ring button', await pa.locator(`[data-ring="${c.user.id}"]`).count() === 1)
await pa.click(`[data-ring="${c.user.id}"]`)
ok('ringing them brings the banner back', await pc.waitForSelector('[data-incoming-call]', { timeout: 8000 }).then(() => true).catch(() => false))
await pa.click('[aria-label="Leave Call"]'); await pa.waitForTimeout(500)

console.log('-- streams and stats')
await pa.goto(`${WEB}/channels/${g.id}/${vc.id}`); await pa.click('text=Join Voice'); await pa.waitForSelector('[data-voice-leave]')
await pb.goto(`${WEB}/channels/${g.id}/${vc.id}`); await pb.click('text=Join Voice'); await pb.waitForSelector('[data-voice-leave]')
await pa.click('button[aria-label="Share Your Screen"]')
ok('Watch Stream shows a recent still of the stream', await pb.waitForSelector('[data-stream-gate][data-stream-preview="1"]', { timeout: 25000 }).then(() => true).catch(() => false))
ok('only the streamer can post a still', (await fetch(`${process.env.PARLEY_API_ORIGIN ?? 'http://localhost:18080'}/api/channels/${vc.id}/stream-preview`, { method: 'PUT', headers: { Authorization: `Bearer ${b.token}`, 'Content-Type': 'image/jpeg' }, body: new Uint8Array([1, 2, 3]) })).status === 400)
await pa.click('button[aria-label="Stop Sharing"]'); await pb.click('button[aria-label="Turn On Camera"]'); await pa.waitForTimeout(4500)
ok('call tiles show connection quality', await pa.locator(`[data-voice-tile="${b.user.id}"] [data-conn-quality]`).count() === 1)
await pa.click('[data-audio-stats-toggle]'); await pa.click('[data-voice-debug]'); await pa.waitForSelector('[data-audio-stats]')
ok('stats include the video you receive', await pa.waitForSelector('[data-video-in]', { timeout: 6000 }).then(() => true).catch(() => false))
await pa.click('[data-audio-stats-toggle]').catch(() => {}); await pa.mouse.click(640, 100)

console.log('-- mini call')
await pa.click(`a[href="/channels/${g.id}/${general.id}"]`); await pa.waitForTimeout(800)
ok('looking elsewhere, the call floats in a corner', await pa.locator(`[data-mini-call="${b.user.id}"]`).count() === 1)
await pa.click('[data-mini-back]'); await pa.waitForTimeout(600)
ok('and one click takes you back', new URL(pa.url()).pathname === `/channels/${g.id}/${vc.id}` && await pa.locator('[data-mini-call]').count() === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
