import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { WEB, B, S, reg, call, callS, raw, ok, finish, adminToken } from '../lib.mjs'

// LiveKit SFU: start the dev server (compose profile "sfu"), point the instance at it, make two browsers
// join a voice channel and check media flows through the room instead of peer connections.
const compose = (args) => execSync(`docker compose -f /git/vic10us/reChat-bot/docker-compose.yml ${args}`, { stdio: 'pipe' }).toString()
const LK = 'http://localhost:7880'
let startedHere = false
const up = async () => { try { if ((await fetch(LK)).status) return } catch { /* down */ } compose('--profile sfu up -d livekit'); startedHere = true; for (let i = 0; i < 60; i++) { try { if ((await fetch(LK)).status) return } catch { /* wait */ } await new Promise((r) => setTimeout(r, 1000)) } throw new Error('livekit did not start') }
await up()
const admin = await adminToken()
const original = await call(admin.token, 'GET', '/admin/settings')
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `SFU ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const chans = await call(a.token, 'GET', `/guilds/${g.id}/channels`); const vc = chans.find((x) => x.kind === 'voice'); const tc = chans.find((x) => x.kind === 'text')

console.log('-- settings')
let r = await callS(a.token, 'POST', '/voice/token', { channel_id: vc.id }); ok('without an SFU configured tokens are refused', r.status === 400)
ok('/instance reports mesh', (await (await fetch(`${B}/instance`)).json()).voice_mode === 'mesh')
r = await callS(admin.token, 'PUT', '/admin/settings', { ...original, livekit_url: 'ftp://nope', livekit_api_key: 'k', livekit_api_secret: 's' }); ok('LiveKit URL must be ws/http', r.status === 400)
r = await callS(admin.token, 'PUT', '/admin/settings', { ...original, livekit_url: 'ws://localhost:7880', livekit_api_key: 'devkey', livekit_api_secret: 'secret' }); ok('admin configures LiveKit', r.status === 200 && r.body.voice_mode === 'sfu')
const pub = await (await fetch(`${B}/instance`)).json()
ok('/instance exposes the URL and mode but never the credentials', pub.voice_mode === 'sfu' && pub.livekit_url === 'ws://localhost:7880' && pub.livekit_api_key === '' && pub.livekit_api_secret === '')
r = await callS(a.token, 'POST', '/voice/token', { channel_id: vc.id }); ok('members get a room token for the voice channel', r.status === 200 && r.body.url === 'ws://localhost:7880' && r.body.room === vc.id && r.body.token.split('.').length === 3 && r.body.can_publish === true && r.body.can_video === true)
const claims = JSON.parse(Buffer.from(r.body.token.split('.')[1], 'base64url').toString())
ok('token claims name the room, the user and LiveKit grants', claims.iss === 'devkey' && claims.sub === a.user.id && claims.video.room === vc.id && claims.video.roomJoin === true && claims.video.canPublishSources.includes('camera'))
r = await callS(a.token, 'POST', '/voice/token', { channel_id: tc.id }); ok('text channels do not get tokens', r.status === 403)
const c = await reg('carol'); r = await callS(c.token, 'POST', '/voice/token', { channel_id: vc.id }); ok('non-members do not', r.status === 403 || r.status === 404)
await callS(a.token, 'PUT', `/channels/${vc.id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: (1 << 21) | (1 << 9) })
r = await callS(b.token, 'POST', '/voice/token', { channel_id: vc.id }); ok('without SPEAK/STREAM the token is listen-only', r.status === 200 && r.body.can_publish === false && r.body.can_video === false && !JSON.parse(Buffer.from(r.body.token.split('.')[1], 'base64url').toString()).video.canPublishSources)
await callS(a.token, 'DELETE', `/channels/${vc.id}/permissions/${g.id}`)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
r = await callS(b.token, 'POST', '/voice/token', { channel_id: dm.id }); ok('DM calls get full tokens', r.status === 200 && r.body.can_publish && r.body.can_video)
ok('audit does not record the secret value', (await call(admin.token, 'GET', '/admin/audit')).some((e) => e.action === 'settings.update' && e.details.livekit_api_secret === 'set'))

console.log('-- UI: two browsers in the room')
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const mk = async (tok) => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('text=Join Voice'); return p }
const pa = await mk(a.token); const pb = await mk(b.token)
await pa.click('text=Join Voice'); await pa.waitForSelector('text=Voice Connected')
await pa.waitForFunction(() => window.__parleyVoice?.().room === 'connected', null, { timeout: 20000 })
ok('alice joins through the SFU (room connected, no peer connections)', (await pa.evaluate(() => window.__parleyVoice())).mode === 'sfu')
await pb.click('text=Join Voice'); await pb.waitForSelector('text=Voice Connected')
await pb.waitForFunction(() => window.__parleyVoice?.().room === 'connected', null, { timeout: 20000 })
await pa.waitForFunction(() => window.__parleyVoice?.().remote === 1, null, { timeout: 20000 })
ok('bob appears as a remote participant for alice via the room', (await pa.evaluate(() => window.__parleyVoice())).remote === 1)
await pa.waitForFunction(() => document.querySelectorAll('audio[data-peer]').length === 1, null, { timeout: 20000 })
ok('alice plays bob\'s audio track subscribed from the SFU', await pa.locator('audio[data-peer]').count() === 1 && (await pa.getAttribute('audio[data-peer]', 'data-peer')) === b.user.id)
ok('the participant list still shows both (voice states unchanged)', await pa.locator('main .aspect-video').count() === 2)
await pa.screenshot({ path: '115-sfu.png' })
await pb.click('main button[title="Leave"], main button[title="Disconnect"]').catch(() => {})
await pb.evaluate(() => { const b = [...document.querySelectorAll('main button')].find((x) => /leave|disconnect/i.test(x.title || x.textContent || '')); b?.click() })
await pa.waitForFunction(() => window.__parleyVoice?.().remote === 0, null, { timeout: 20000 })
ok('leaving removes the remote participant', (await pa.evaluate(() => window.__parleyVoice())).remote === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await callS(admin.token, 'PUT', '/admin/settings', { ...original, livekit_url: '', livekit_api_key: '', livekit_api_secret: '' })
ok('clearing the fields returns to mesh', (await (await fetch(`${B}/instance`)).json()).voice_mode === 'mesh')
if (startedHere) { try { compose('stop livekit') } catch { /* ignore */ } }
await finish()
