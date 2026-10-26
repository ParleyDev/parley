// Voice extras: emoji reactions floating over call tiles, stream viewer counts, the voice channel "active for" timer,
// a sound when someone turns their camera on, and Invite to Voice (suggestions plus a join banner for the invitee).
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `VoiceX ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const general = g.channels.find((x) => x.kind === 'text')
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const hooks = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360
    const x = cv.getContext('2d'); let n = 0
    setInterval(() => { x.fillStyle = `hsl(${(n += 7) % 360} 70% 50%)`; x.fillRect(0, 0, 640, 360) }, 60)
    return cv.captureStream(15)
  }
}
const mk = async (tok, path, join) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] })
  await ctx.addInitScript(hooks)
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}${path}`); await p.waitForTimeout(1000)
  if (join) { await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]') }
  return p
}
const pa = await mk(a.token, `/channels/${g.id}/${vc.id}`, true)
const pb = await mk(b.token, `/channels/${g.id}/${vc.id}`, true)
await pa.waitForTimeout(1500)

console.log('-- timer')
const timer = await pa.locator(`[data-voice-timer="${vc.id}"]`).textContent().catch(() => '')
ok('a busy voice channel shows how long it has been active', /^\d+:\d\d$/.test(timer ?? ''), timer)
ok('an empty one shows nothing', await pa.locator('[data-voice-timer]').count() === 1)

console.log('-- reactions')
await pa.click('[data-call-react-open]'); await pa.click('[data-call-react="🎉"]'); await pb.waitForTimeout(500)
ok('a reaction floats over the sender\'s tile for others', await pb.locator(`[data-voice-tile="${a.user.id}"] [data-call-reaction="🎉"]`).count() === 1)
ok('and for the sender', await pa.locator(`[data-voice-tile="${a.user.id}"] [data-call-reaction="🎉"]`).count() === 1)
await pb.waitForTimeout(2800)
ok('then fades away', await pb.locator('[data-call-reaction]').count() === 0)

console.log('-- camera sound')
await pa.evaluate(() => { window.__parleySfx = [] })
await pb.click('button[aria-label="Turn On Camera"]'); await pa.waitForTimeout(1200)
ok('someone turning their camera on plays a sound', await pa.evaluate(() => (window.__parleySfx ?? []).includes('camera_on')), JSON.stringify(await pa.evaluate(() => window.__parleySfx)))
await pb.click('button[aria-label="Turn Off Camera"]'); await pa.waitForTimeout(300)

console.log('-- stream viewers')
await pa.click('button[aria-label="Share Your Screen"]'); await pa.waitForTimeout(1500)
ok('a new stream has no viewers', (await pa.getAttribute(`[data-voice-tile="${a.user.id}"] [data-stream-viewers]`, 'data-stream-viewers').catch(() => null)) === '0')
await pb.click('[data-watch-stream]'); await pa.waitForTimeout(1200)
ok('watching it counts you as a viewer, for the streamer', (await pa.getAttribute(`[data-voice-tile="${a.user.id}"] [data-stream-viewers]`, 'data-stream-viewers')) === '1')
ok('with your name on hover', ((await pa.getAttribute(`[data-voice-tile="${a.user.id}"] [data-stream-viewers]`, 'title')) ?? '').includes(b.user.display_name))
await pa.click('button[aria-label="Stop Sharing"]'); await pa.waitForTimeout(400)

console.log('-- invite to voice')
const pc = await mk(c.token, `/channels/${g.id}/${general.id}`, false)
ok('you can\'t invite from outside the channel', (await raw(c.token, 'POST', `/channels/${vc.id}/voice-invite`, { user_id: a.user.id })).status === 400)
await pa.click('[data-voice-invite-open]'); await pa.waitForSelector('[data-voice-invite]'); await pa.waitForTimeout(500)
ok('suggestions list online members who aren\'t here', await pa.locator(`[data-voice-invite-row="${c.user.id}"]`).count() === 1 && await pa.locator(`[data-voice-invite-row="${b.user.id}"]`).count() === 0)
await pa.click(`[data-voice-invite-send="${c.user.id}"]`); await pc.waitForTimeout(800)
ok('the invite button marks them invited', /Invited/.test(await pa.locator(`[data-voice-invite-send="${c.user.id}"]`).innerText()))
ok('they get a banner', await pc.locator(`[data-voice-invite-banner="${vc.id}"]`).count() === 1)
ok('inviting again right away is refused', (await raw(a.token, 'POST', `/channels/${vc.id}/voice-invite`, { user_id: c.user.id })).status === 429)
await pc.click('[data-voice-invite-join]'); await pc.waitForSelector('[data-voice-leave]', { timeout: 10000 }).catch(() => {})
ok('Join puts them in the channel', (await pc.evaluate(() => window.__parleyVoice().channel)) === vc.id)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
