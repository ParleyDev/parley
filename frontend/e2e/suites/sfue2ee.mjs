// End-to-end encrypted calls through the LiveKit SFU: the room runs LiveKit's frame encryption with our per-participant
// keys, both sides decode each other, and they see the same safety code.
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { WEB, S, reg, call, callS, ok, finish, adminToken } from '../lib.mjs'
const COMPOSE_FILE = fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url))
const LK = 'http://localhost:7880'
let startedHere = false
const up = async () => { try { if ((await fetch(LK)).status) return } catch { /* down */ } execSync(`docker compose -f ${COMPOSE_FILE} --profile sfu up -d livekit`, { stdio: 'pipe' }); startedHere = true; for (let i = 0; i < 60; i++) { try { if ((await fetch(LK)).status) return } catch { /* wait */ } await new Promise((r) => setTimeout(r, 1000)) } throw new Error('livekit did not start') }
await up()
const admin = await adminToken()
const original = await call(admin.token, 'GET', '/admin/settings')
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `SFU Crypt ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const vc = g.channels.find((x) => x.kind === 'voice')
await callS(admin.token, 'PUT', '/admin/settings', { ...original, livekit_url: 'ws://localhost:7880', livekit_api_key: 'devkey', livekit_api_secret: 'secret' })
await callS(a.token, 'PATCH', `/channels/${vc.id}`, { e2ee: true })
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const mk = async (tok) => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('text=Join Voice'); return p }
try {
  const pa = await mk(a.token); const pb = await mk(b.token)
  for (const p of [pa, pb]) { await p.click('text=Join Voice'); await p.waitForFunction(() => window.__parleyVoice?.().room === 'connected', null, { timeout: 20000 }) }
  await pa.waitForFunction(() => window.__parleyVoice?.().remote === 1, null, { timeout: 20000 })
  const dbg = await pa.evaluate(() => window.__parleyVoice())
  ok('the call runs through the SFU with LiveKit encryption on', dbg.mode === 'sfu' && dbg.e2ee === true, JSON.stringify(dbg))
  await pa.click('button[title="Turn On Camera"]')
  const sees = await pb.waitForFunction((id) => [...document.querySelectorAll(`[data-voice-tile="${id}"] video`)].some((v) => v.videoWidth > 0), a.user.id, { timeout: 20000 }).then(() => true).catch(() => false)
  ok('bob decodes alice\'s encrypted camera from the SFU', sees)
  const heard = await pa.waitForFunction(() => document.querySelectorAll('audio[data-peer]').length === 1, null, { timeout: 20000 }).then(() => true).catch(() => false)
  ok('alice gets bob\'s encrypted audio track', heard)
  await pa.waitForTimeout(1500)
  const code = async (p) => { await p.click('[data-call-lock]'); const t = await p.locator('[data-safety-code]').innerText(); await p.keyboard.press('Escape'); await p.click('[data-call-lock]').catch(() => {}); return t }
  const ca = await code(pa), cb = await code(pb)
  ok('both see the same safety code', /^\d{4}( \d{4}){4}$/.test(ca) && ca === cb, `${ca} / ${cb}`)
  ok('no page errors', errors.length === 0, errors.join(' | '))
} finally {
  await callS(admin.token, 'PUT', '/admin/settings', original)
  await call(a.token, 'DELETE', `/guilds/${g.id}`)
  await browser.close()
  if (startedHere) execSync(`docker compose -f ${COMPOSE_FILE} --profile sfu stop livekit`, { stdio: 'pipe' })
}
await finish()
