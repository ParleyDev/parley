// Soundboard extras: built-in sounds, sounds from your other servers, the soundboard in DM calls, entrance sounds,
// Priority Speaker (others turned down while they talk) and the per-channel camera quality.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, multi, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
await call(a.token, 'POST', '/users/@me/relationships', { user_id: b.user.id }); await call(b.token, 'PUT', `/users/@me/relationships/${a.user.id}`)
const g = await call(a.token, 'POST', '/guilds', { name: `Snd ${S}` }), g2 = await call(a.token, 'POST', '/guilds', { name: `Other ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const vc = g.channels.find((x) => x.kind === 'voice')
const wav = () => { const n = 4000; const buf = Buffer.alloc(44 + n); buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40); for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(90 * Math.sin(i / 3)); return { buffer: buf, mimeType: 'audio/wav', name: 'boop.wav' } }
const other = await (await multi(a.token, `/guilds/${g2.id}/sounds`, wav(), { name: 'Faraway', emoji: '🛸' })).json()
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const mk = async (tok, path, join = true) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone', 'camera'] })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}${path}`); await p.waitForTimeout(900)
  if (join) { await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]') }
  return p
}
const heard = (p, id) => p.waitForFunction((x) => (window.__parleySounds ?? []).includes(x), id, { timeout: 8000 }).then(() => true).catch(() => false)

console.log('-- soundboard')
const pa = await mk(a.token, `/channels/${g.id}/${vc.id}`), pb = await mk(b.token, `/channels/${g.id}/${vc.id}`)
await pa.click('button[title="Soundboard"]'); await pa.waitForSelector('[data-soundboard-picker]')
ok('built-in sounds are always there', await pa.locator('[data-sound^="builtin:"]').count() === 8)
await pa.click('[data-sound="builtin:airhorn"]')
ok('a built-in plays for everyone in the channel', await heard(pb, 'builtin:airhorn'))
await pa.waitForSelector(`[data-soundboard-guild="${g2.id}"]`)
await pa.click(`[data-sound="${other.id}"]`)
ok('sounds from your other servers play too', await heard(pb, other.id))
ok('but only from servers you are in', (await raw(b.token, 'POST', `/channels/${vc.id}/soundboard/${other.id}`)).status === 404)
ok('unknown built-ins are refused', (await raw(a.token, 'POST', `/channels/${vc.id}/soundboard/builtin:nope`)).status === 404)

console.log('-- entrance sounds')
await pb.click('[data-voice-leave]'); await pb.waitForTimeout(300)
ok('an entrance sound must be one you can use', (await raw(b.token, 'PATCH', '/users/@me', { entrance_sound: other.id })).status === 400)
await call(b.token, 'PATCH', '/users/@me', { entrance_sound: 'builtin:quack' })
await pa.evaluate(() => { window.__parleySounds = [] })
await pb.click('text=Join Voice'); await pb.waitForSelector('[data-voice-leave]')
ok('joining plays your entrance sound to the channel', await heard(pa, 'builtin:quack'))

console.log('-- priority speaker')
const role = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Host', permissions: 1 << 8 })
await call(a.token, 'PATCH', `/guilds/${g.id}/members/${c.user.id}`, { roles: [role.id] })
const pc = await mk(c.token, `/channels/${g.id}/${vc.id}`)
await pb.waitForFunction((id) => document.querySelector(`audio[data-peer="${id}"]`), c.user.id, { timeout: 15000 })
ok('only people with the permission get the Priority Speaker switch', await pc.locator('[data-priority-toggle]').count() === 1 && await pb.locator('[data-priority-toggle]').count() === 0)
await pc.click('[data-priority-toggle]'); await pb.waitForTimeout(800)
const vol = (id) => pb.evaluate((x) => document.querySelector(`audio[data-peer="${x}"]`)?.volume, id)
await pb.evaluate((id) => window.__parleySpeaking(id, true), c.user.id); await pb.waitForTimeout(200)
ok('while a priority speaker talks, others are turned down', (await vol(c.user.id)) === 1 && (await vol(a.user.id)) < 0.5, JSON.stringify(await pb.evaluate(() => window.__parleyDuck())))
await pb.evaluate((id) => window.__parleySpeaking(id, false), c.user.id); await pb.waitForTimeout(200)
ok('and back up when they stop', (await vol(a.user.id)) === 1)

console.log('-- DM calls and video quality')
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
await pa.mouse.click(640, 120); await pa.click('[data-voice-leave]'); await pb.click('[data-voice-leave]'); await pc.click('[data-voice-leave]').catch(() => {})
await pa.goto(`${WEB}/channels/@me/${dm.id}`); await pa.click('[data-start-call]'); await pa.waitForSelector('[data-dm-call]')
await pb.goto(`${WEB}/channels/@me/${dm.id}`); await pb.click('[data-start-call]').catch(() => {}); await pb.waitForTimeout(1500)
await pa.evaluate(() => { window.__parleySounds = [] }); await pb.evaluate(() => { window.__parleySounds = [] })
await pa.click('[data-dm-soundboard]'); await pa.click('[data-sound="builtin:tada"]')
ok('the soundboard works in DM calls', await heard(pb, 'builtin:tada'))
ok('video quality must be auto or full', (await raw(a.token, 'PATCH', `/channels/${vc.id}`, { video_quality: '4k' })).status === 400)
ok('a voice channel can be set to full quality', (await call(a.token, 'PATCH', `/channels/${vc.id}`, { video_quality: 'full' })).video_quality === 'full')
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`); await call(a.token, 'DELETE', `/guilds/${g2.id}`)
await browser.close(); await finish()
