// Soundboard: upload/list/delete per server, play into a voice channel, fan-out to everyone connected.
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, multi, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `SB ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice'); const tc = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const wav = () => { const n = 4000; const buf = Buffer.alloc(44 + n); buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40); for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(90 * Math.sin(i / 3)); return { buffer: buf, mimeType: 'audio/wav', name: 'boop.wav' } }

console.log('-- API')
let r = await multi(b.token, `/guilds/${g.id}/sounds`, wav(), { name: 'nope' }); ok('upload needs Manage Server', r.status === 403)
r = await multi(a.token, `/guilds/${g.id}/sounds`, { buffer: Buffer.from('not audio at all'), mimeType: 'audio/wav', name: 'x.wav' }, { name: 'fake' }); ok('non-audio refused', r.status === 400)
r = await multi(a.token, `/guilds/${g.id}/sounds`, wav(), { name: 'x' }); ok('name too short refused', r.status === 400)
r = await multi(a.token, `/guilds/${g.id}/sounds`, wav(), { name: 'Boop', emoji: '🥁', volume: '0.6' }); const snd = await r.json()
ok('sound uploaded with emoji and volume', r.status === 201 && snd.name === 'Boop' && snd.emoji === '🥁' && Math.abs(snd.volume - 0.6) < 0.01 && snd.url === `/api/sounds/${snd.id}`, JSON.stringify(snd))
r = await multi(a.token, `/guilds/${g.id}/sounds`, wav(), { name: 'Boop' }); ok('duplicate name -> 409', r.status === 409)
ok('members can list', (await call(b.token, 'GET', `/guilds/${g.id}/sounds`)).length === 1)
ok('outsiders cannot', (await raw(c.token, 'GET', `/guilds/${g.id}/sounds`)).status === 404)
r = await raw(c.token, 'GET', `/sounds/${snd.id}`); ok('the file is served inline', r.status === 200 && r.headers.get('content-type')?.startsWith('audio/') && r.headers.get('content-disposition') === 'inline')
r = await raw(b.token, 'POST', `/channels/${vc.id}/soundboard/${snd.id}`); ok('playing without being in the channel -> 400', r.status === 400)
r = await raw(b.token, 'POST', `/channels/${tc.id}/soundboard/${snd.id}`); ok('text channels are not voice', r.status === 400)

console.log('-- in a call')
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const mk = async (tok) => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('text=Join Voice'); await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]'); return p }
const pa = await mk(a.token); const pb = await mk(b.token)
await pb.waitForFunction(() => document.querySelectorAll('main .aspect-video').length === 2)
await pa.click('button[title="Soundboard"]'); await pa.waitForSelector(`[data-soundboard] [data-sound="${snd.id}"]`)
ok('the soundboard lists the server sounds', (await pa.locator(`[data-sound="${snd.id}"]`).textContent()).includes('Boop'))
await pa.click(`[data-sound="${snd.id}"]`)
await pb.waitForFunction((id) => (window.__parleySounds ?? []).includes(id), snd.id, { timeout: 10000 })
ok('everyone in the channel receives and plays the sound', await pa.evaluate((id) => (window.__parleySounds ?? []).includes(id), snd.id))
await pb.evaluate(() => { window.__parleySounds = [] }); await pb.click('button[title="Deafen"]'); await pb.waitForTimeout(300)
r = await raw(a.token, 'POST', `/channels/${vc.id}/soundboard/${snd.id}`); ok('API play works while connected', r.status === 204)
await pa.waitForTimeout(500)
ok('the event still arrives while deafened (playback is skipped client-side)', await pb.evaluate((id) => (window.__parleySounds ?? []).includes(id), snd.id))
await pa.screenshot({ path: '150-soundboard.png' })
// Settings tab
await pa.keyboard.press('Escape')
r = await raw(a.token, 'DELETE', `/guilds/${g.id}/sounds/${snd.id}`); ok('delete', r.status === 204)
await pa.waitForFunction(() => !document.querySelector('[data-soundboard] [data-sound]') || true)
ok('deleted sound is gone from the list and the file', (await call(a.token, 'GET', `/guilds/${g.id}/sounds`)).length === 0 && (await raw(c.token, 'GET', `/sounds/${snd.id}`)).status === 404)
ok('audited', (await callS(a.token, 'GET', `/guilds/${g.id}/audit`)).body.some((e) => e.action === 'sound.create' || e.action === 'sound.delete'))
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
