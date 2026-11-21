// "Hide my IP address in calls": direct calls try relayed routes only when the setting is on and the instance has a
// relay; without a relay the member is told the call is direct; the first direct call explains itself once, with the
// way to turn hiding on; Connection details and the settings say how the call travels.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Relay ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const hooks = () => {
  const Orig = window.RTCPeerConnection; window.__pcs = []
  window.RTCPeerConnection = function (...args) { const pc = new Orig(...args); window.__pcs.push(pc); return pc }
  window.RTCPeerConnection.prototype = Orig.prototype
}
// The instance's ICE list as this browser sees it: with or without a relay (a made-up one; only the policy is checked).
const TURN = [{ urls: 'stun:stun.example.test:3478' }, { urls: ['turn:relay.example.test:3478'], username: 'u', credential: 'p' }]
const mk = async (t, { relay }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(hooks)
  const p = await ctx.newPage(); p.on('pageerror', (x) => errors.push(x.message))
  await p.route('**/api/voice/ice-servers', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(relay ? TURN : [{ urls: 'stun:stun.example.test:3478' }]) }))
  await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t)
  await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('[data-voice-prejoin]')
  return p
}
const join = async (p) => { await p.click('[data-voice-prejoin] button'); await p.waitForSelector('[data-call-status="connected"]', { timeout: 15000 }) }
const policy = (p) => p.evaluate(() => { const pc = window.__pcs[window.__pcs.length - 1]; return pc ? (pc.getConfiguration().iceTransportPolicy ?? 'all') : null })

console.log('-- a direct call, with a relay available')
const pb = await mk(b.token, { relay: true }); await join(pb)
const pa = await mk(a.token, { relay: true }); await join(pa)
await pa.waitForFunction(() => window.__pcs.length >= 1)
ok('by default the connection may be direct', await policy(pa) === 'all')
const note = await pa.waitForSelector('text=Calls here connect directly', { timeout: 5000 }).then(() => true, () => false)
ok('the first direct call says people in it can see your IP address', note)
ok('and offers to hide it', await pa.locator('button:has-text("Hide my IP address")').count() === 1)
await pa.screenshot({ path: 'callrelay-note.png' })
const before = await pa.evaluate(() => window.__pcs.length)
await pa.click('button:has-text("Hide my IP address")')
await pa.waitForFunction((n) => window.__pcs.length > n, before, { timeout: 8000 }).catch(() => {})
ok('taking the offer rebuilds the connection through the relay only', await policy(pa) === 'relay')
ok('the setting is remembered', await pa.evaluate(() => JSON.parse(localStorage.getItem('parley.voiceSettings')).relayOnly === true))
await pa.click('[data-voice-details-toggle]'); await pa.waitForSelector('[data-voice-details]')
ok('Connection details say the call is relayed', (await pa.getAttribute('[data-voice-server]', 'data-voice-route')) === 'relayed' && (await pa.locator('[data-voice-server]').textContent()).includes('Relayed'))
await pa.screenshot({ path: 'callrelay-details.png' })
await pa.mouse.click(800, 300); await pa.waitForSelector('[data-voice-details]', { state: 'detached' }) // a click outside closes it
await pa.click('[data-voice-disconnect]'); await pa.waitForSelector('[data-voice-prejoin]')
const n2 = await pa.evaluate(() => window.__pcs.length)
await join(pa); await pa.waitForFunction((n) => window.__pcs.length > n, n2)
ok('the next call starts relayed', await policy(pa) === 'relay')
ok('and the note is not shown again', await pa.locator('text=Calls here connect directly').count() === 0)

console.log('-- settings')
await pa.click('button[title="User Settings"]'); await pa.click('button:has-text("Voice & Video")'); await pa.waitForSelector('[data-relay-setting]')
ok('Voice & Video has the switch, on, and says a relay is available', (await pa.getAttribute('[data-relay-setting]', 'data-relay-setting')) === 'available' && await pa.locator('[data-relay-setting] [role="switch"][aria-checked="true"], [data-relay-setting] input:checked').count() === 1)
await pa.locator('[data-relay-setting]').scrollIntoViewIfNeeded(); await pa.screenshot({ path: 'callrelay-setting.png' })
const n3 = await pa.evaluate(() => window.__pcs.length)
await pa.locator('[data-relay-setting] [role="switch"], [data-relay-setting] input[type="checkbox"]').first().click()
await pa.waitForFunction((n) => window.__pcs.length > n, n3, { timeout: 8000 }).catch(() => {})
ok('turning it off mid-call goes back to direct', await policy(pa) === 'all')
await pa.keyboard.press('Escape')

console.log('-- no relay on this instance')
const pc = await mk(b.token, { relay: false })
await pc.evaluate(() => localStorage.setItem('parley.voiceSettings', JSON.stringify({ relayOnly: true }))); await pc.reload(); await pc.waitForSelector('[data-voice-prejoin]')
await pb.click('[data-voice-disconnect]')
await join(pc); await pc.waitForFunction(() => window.__pcs.length >= 1)
ok('hiding asked for but no relay: the member is told the call is direct', await pc.waitForSelector('text=has no relay server', { timeout: 5000 }).then(() => true, () => false))
ok('and the call connects directly instead of not at all', await policy(pc) === 'all')
await pc.click('button[title="User Settings"]'); await pc.click('button:has-text("Voice & Video")'); await pc.waitForSelector('[data-relay-setting]')
ok('the setting says there is no relay to hide behind', (await pc.getAttribute('[data-relay-setting]', 'data-relay-setting')) === 'none' && (await pc.locator('[data-relay-setting]').textContent()).includes('no relay server'))

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
