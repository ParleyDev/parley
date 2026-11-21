// A call's connection the member can see and act on: connecting / connected / reconnecting in the Voice Connected
// panel, "Reconnecting…" over the call, a dropped call reconnecting by itself a few times and then failing with Try
// again and Dismiss (and leaving the call for everyone else), a join that can't open a microphone, a microphone
// unplugged mid-call, a device plugged in mid-call, and the offer to rejoin after a reload.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Status ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
// The microphone can be made to refuse, and one real input can be hidden from the device list until "plugged in".
const hooks = () => {
  const md = navigator.mediaDevices
  const gum = md.getUserMedia.bind(md); const list = md.enumerateDevices.bind(md)
  window.__mic = { deny: false, hide: null, extra: [] }
  md.getUserMedia = (c) => (window.__mic.deny && c && c.audio ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) : gum(c))
  md.enumerateDevices = async () => [...(await list()).filter((d) => d.deviceId !== window.__mic.hide), ...window.__mic.extra]
}
const mk = async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(hooks)
  const p = await ctx.newPage(); p.on('pageerror', (x) => errors.push(x.message))
  await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t)
  await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('[data-voice-prejoin]')
  return p
}
const pa = await mk(a.token), pb = await mk(b.token)
const status = (p) => p.locator('[data-call-status]').getAttribute('data-call-status').catch(() => null)
const until = (p, want, ms = 12000) => p.waitForSelector(`[data-call-status="${want}"]`, { timeout: ms }).then(() => true, () => false)
const join = (p) => p.click('[data-voice-prejoin] button')
const seenByBob = () => pb.locator('[data-prejoin-people] > div').count()

console.log('-- connecting and connected')
await join(pa)
ok('the panel says the call is connected', await until(pa, 'connected'))
ok('and words it', (await pa.locator('[data-call-status]').textContent()) === 'Voice Connected')
ok('nothing is shown as failed or reconnecting', await pa.locator('[data-call-failed], [data-call-reconnecting]').count() === 0)
await pb.waitForFunction(() => document.querySelectorAll('[data-prejoin-people] > div').length === 1)

console.log('-- the app loses the server')
await pa.evaluate(() => window.__parleyWs.drop())
ok('losing the socket shows as reconnecting', await until(pa, 'reconnecting', 4000))
ok('over the call too', await pa.locator('[data-call-reconnecting]').count() === 1)
ok('and it comes back by itself', await until(pa, 'connected'))
ok('the overlay goes away', await pa.locator('[data-call-reconnecting]').count() === 0)

console.log('-- the call drops')
await pa.evaluate(() => window.__parleyCall.drop('wire pulled'))
ok('a dropped call says reconnecting', await status(pa) === 'reconnecting')
ok('and reconnects without being asked', await until(pa, 'connected'))
ok('still in the same call', await pa.evaluate((id) => window.__parleyVoice().channel === id, vc.id))
ok('the log remembers why', (await pa.evaluate(() => window.__parleyCall.events())).some((l) => l.includes('wire pulled')))

console.log('-- it keeps dropping')
for (let i = 0; i < 6; i++) await pa.evaluate(() => window.__parleyCall.drop('flapping'))
await pa.waitForSelector('[data-call-failed]', { timeout: 5000 }).catch(() => {})
ok('after the last attempt the call is shown as failed', await pa.locator('[data-call-failed="transport"]').count() === 1)
ok('with words, not an error code', (await pa.locator('[data-call-failed-why]').textContent()).includes("couldn't be restored"))
ok('and where it was', (await pa.locator('[data-call-failed-where]').textContent()).includes(vc.name))
ok('the member is out of the call', await pa.evaluate(() => window.__parleyVoice().channel === null) && await pa.locator('[data-voice-connected]').count() === 0)
await pb.waitForFunction(() => document.querySelectorAll('[data-prejoin-people] > div').length === 0, null, { timeout: 6000 }).catch(() => {})
ok('and nobody else sees them in it', await seenByBob() === 0)
await pa.waitForTimeout(5000)
ok('the failure stays until it is dealt with', await pa.locator('[data-call-failed]').count() === 1)
await pa.screenshot({ path: 'callstatus-failed.png' })
await pa.click('[data-call-retry]')
ok('Try again rejoins', await until(pa, 'connected') && await pa.locator('[data-call-failed]').count() === 0)
for (let i = 0; i < 6; i++) await pa.evaluate(() => window.__parleyCall.drop('again'))
await pa.waitForSelector('[data-call-failed]')
await pa.click('[data-call-dismiss]')
ok('Dismiss clears it', await pa.locator('[data-call-failed]').count() === 0 && await pa.locator('[data-voice-prejoin]').count() === 1)

console.log('-- no microphone at join')
await pa.evaluate(() => { window.__mic.deny = true })
await join(pa); await pa.waitForSelector('[data-call-failed]', { timeout: 5000 }).catch(() => {})
ok('a join without a microphone fails where the call is shown', await pa.locator('[data-call-failed="microphone"]').count() === 1)
ok('saying so plainly', (await pa.locator('[data-call-failed-why]').textContent()).includes('microphone') && !(await pa.locator('[data-call-failed]').textContent()).includes('NotAllowedError'))
ok('without a raw error toast', await pa.locator('text=Microphone unavailable').count() === 0)
await pa.evaluate(() => { window.__mic.deny = false })
await pa.click('[data-call-retry]')
ok('Try again joins once the microphone works', await until(pa, 'connected'))

console.log('-- the microphone is unplugged mid-call')
const before = await pa.evaluate(() => window.__parleyMic.info())
await pa.evaluate(() => window.__parleyMic.unplug())
await pa.waitForFunction((id) => { const m = window.__parleyMic.info(); return m.state === 'live' && m.id !== id }, before.id, { timeout: 6000 }).catch(() => {})
const after = await pa.evaluate(() => window.__parleyMic.info())
ok('another microphone is opened', after.state === 'live' && after.id !== before.id, JSON.stringify(after))
ok('and the member is told', await pa.locator('text=Your microphone was disconnected').count() >= 1)
ok('the call carries on', await status(pa) === 'connected' && await pa.locator('[data-mic-lost]').count() === 0)
await pa.evaluate(() => { window.__mic.deny = true; window.__parleyMic.unplug() })
await pa.waitForSelector('[data-mic-lost]', { timeout: 6000 }).catch(() => {})
ok('with no microphone left, the call says nobody can hear you', await pa.locator('[data-mic-lost]').count() === 1)
await pa.waitForTimeout(350); await pa.screenshot({ path: 'callstatus-nomic.png' })
await pa.evaluate(() => { window.__mic.deny = false; navigator.mediaDevices.dispatchEvent(new Event('devicechange')) })
await pa.waitForSelector('[data-mic-lost]', { state: 'detached', timeout: 6000 }).catch(() => {})
ok('a microphone coming back is picked up by itself', await pa.locator('[data-mic-lost]').count() === 0 && (await pa.evaluate(() => window.__parleyMic.info())).state === 'live')

console.log('-- a device is plugged in mid-call')
await pa.click('[data-voice-disconnect]'); await pa.waitForSelector('[data-voice-prejoin]')
const inputs = await pa.evaluate(async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => ({ id: d.deviceId, label: d.label, group: d.groupId })))
const late = inputs[inputs.length - 1]
ok('(the browser offers more than one microphone)', inputs.length >= 2, JSON.stringify(inputs))
await pa.evaluate((id) => { window.__mic.hide = id }, late.id)
await join(pa); await until(pa, 'connected')
ok('no offer just for joining', await pa.locator('[data-device-offer]').count() === 0)
await pa.evaluate(() => { window.__mic.hide = null; navigator.mediaDevices.dispatchEvent(new Event('devicechange')) })
await pa.waitForSelector('[data-device-offer]', { timeout: 5000 }).catch(() => {})
ok('a device that appears is offered by name', (await pa.locator('[data-device-offer]').getAttribute('data-device-offer').catch(() => null)) === late.label)
await pa.waitForTimeout(350); await pa.screenshot({ path: 'callstatus-device.png' })
await pa.click('[data-device-switch]')
await pa.waitForFunction((id) => JSON.parse(localStorage.getItem('parley.voiceSettings') ?? '{}').inputDeviceId === id, late.id, { timeout: 4000 }).catch(() => {})
ok('Switch makes it the microphone', await pa.evaluate((id) => JSON.parse(localStorage.getItem('parley.voiceSettings') ?? '{}').inputDeviceId === id, late.id) && await pa.locator('[data-device-offer]').count() === 0)
ok('and the call keeps going on it', await status(pa) === 'connected' && (await pa.evaluate(() => window.__parleyMic.info())).state === 'live')
// Unplugged and plugged in again: offered again, and "don't suggest" ends that.
const fake = (n) => [{ deviceId: `dock-in-${n}`, groupId: `dock-${n}`, kind: 'audioinput', label: `Dock ${n}`, toJSON() { return this } }]
await pa.evaluate((x) => { window.__mic.extra = x; navigator.mediaDevices.dispatchEvent(new Event('devicechange')) }, fake(1).map((d) => ({ deviceId: d.deviceId, groupId: d.groupId, kind: d.kind, label: d.label })))
await pa.waitForSelector('[data-device-offer="Dock 1"]', { timeout: 5000 }).catch(() => {})
ok('another new device is offered', await pa.locator('[data-device-offer="Dock 1"]').count() === 1)
await pa.click('[data-device-never]')
await pa.evaluate(() => { window.__mic.extra = []; navigator.mediaDevices.dispatchEvent(new Event('devicechange')) }); await pa.waitForTimeout(300)
await pa.evaluate(() => { window.__mic.extra = [{ deviceId: 'dock-in-1', groupId: 'dock-1', kind: 'audioinput', label: 'Dock 1' }]; navigator.mediaDevices.dispatchEvent(new Event('devicechange')) }); await pa.waitForTimeout(600)
ok('"Don\'t suggest this device again" is kept', await pa.locator('[data-device-offer]').count() === 0)
await pa.evaluate(() => { window.__mic.extra = [...window.__mic.extra, { deviceId: 'x1', groupId: 'gx1', kind: 'audioinput', label: 'Hub mic' }, { deviceId: 'x2', groupId: 'gx2', kind: 'audiooutput', label: 'Hub speakers' }]; navigator.mediaDevices.dispatchEvent(new Event('devicechange')) }); await pa.waitForTimeout(600)
ok('several devices arriving together (a dock) are not offered', await pa.locator('[data-device-offer]').count() === 0)

console.log('-- reloading in the middle of a call')
await pa.reload(); await pa.waitForSelector('[data-call-rejoin]', { timeout: 8000 }).catch(() => {})
ok('after a reload Parley offers to rejoin', await pa.locator(`[data-call-rejoin="${vc.id}"]`).count() === 1)
ok('without rejoining by itself', await pa.locator('[data-voice-connected]').count() === 0)
await pa.waitForTimeout(350); await pa.screenshot({ path: 'callstatus-rejoin.png' })
await pa.click('[data-call-rejoin-yes]')
ok('Rejoin goes back into the call', await until(pa, 'connected') && await pa.evaluate((id) => window.__parleyVoice().channel === id, vc.id))
await pa.reload(); await pa.waitForSelector('[data-call-rejoin]')
await pa.click('[data-call-rejoin-no]')
ok('Not now dismisses the offer', await pa.locator('[data-call-rejoin]').count() === 0)
await pa.reload(); await pa.waitForSelector('[data-voice-prejoin]'); await pa.waitForTimeout(800)
ok('and it is not offered again', await pa.locator('[data-call-rejoin]').count() === 0)
await join(pa); await until(pa, 'connected'); await pa.click('[data-voice-disconnect]'); await pa.waitForSelector('[data-voice-prejoin]')
await pa.reload(); await pa.waitForSelector('[data-voice-prejoin]'); await pa.waitForTimeout(800)
ok('a call left on purpose is not offered after a reload', await pa.locator('[data-call-rejoin]').count() === 0)

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
