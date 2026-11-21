// Call controls that explain themselves, and calls that are easier to take: a control you can't use stays in place and
// says why (no permission, a moderator's mute, still connecting); the mute shortcut is in its tooltip and explains a
// moderator's mute; a microphone that can't be opened is worded by cause and you can join to listen; an incoming call
// can be answered or ignored from the keyboard, ignored without declining, and says when others are waiting; a call
// you are in on another device offers to move here.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Controls ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
for (const x of [b, c]) { await call(a.token, 'POST', '/users/@me/relationships', { user_id: x.user.id }); await call(x.token, 'PUT', `/users/@me/relationships/${a.user.id}`) }
await call(c.token, 'POST', '/users/@me/relationships', { user_id: b.user.id }); await call(b.token, 'PUT', `/users/@me/relationships/${c.user.id}`)
const dmAB = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
const dmCB = await call(c.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const hooks = () => {
  const md = navigator.mediaDevices; const gum = md.getUserMedia.bind(md)
  window.__mic = { fail: null }
  md.getUserMedia = (q) => (window.__mic.fail && q && q.audio ? Promise.reject(new DOMException('raw browser words', window.__mic.fail)) : gum(q))
}
const mk = async (t, path) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(hooks)
  const p = await ctx.newPage(); p.on('pageerror', (x) => errors.push(x.message))
  await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t)
  await p.goto(`${WEB}${path}`); return p
}
const connected = (p) => p.waitForSelector('[data-call-status="connected"]', { timeout: 15000 }).then(() => true, () => false)
const toast = (p, text) => p.waitForSelector(`text=${text}`, { timeout: 4000 }).then(() => true, () => false)
const vcPath = `/channels/${g.id}/${vc.id}`

console.log('-- controls say why they are unavailable')
const pa = await mk(a.token, vcPath); await pa.waitForSelector('[data-voice-prejoin]')
await pa.click('[data-voice-prejoin] button'); await connected(pa)
ok('the mute button shows its shortcut', (await pa.getAttribute('[data-voice-controls] [data-call-mic]', 'title')) === 'Mute (Ctrl+Shift+M)')
ok('someone who may use the camera and share gets plain buttons', await pa.locator('[data-voice-controls] [data-control-why]').count() === 0)
// Everyone but the owner: no Speak (1 << 21), no Stream (1 << 9) in this channel.
await raw(a.token, 'PUT', `/channels/${vc.id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: (1 << 21) | (1 << 9) })
const pb = await mk(b.token, vcPath); await pb.waitForSelector('[data-voice-prejoin]')
await pb.click('[data-voice-prejoin] button'); await connected(pb)
const why = (sel) => pb.getAttribute(`[data-voice-controls] ${sel}`, 'data-control-why').catch(() => null)
ok('without Stream the camera button is still there, saying why', (await why('[data-call-camera]')) === "You can't turn on your camera in this channel.")
ok('and so is screen share', (await why('[data-call-screen]')) === "You can't share your screen in this channel.")
ok('without Speak the microphone says why', (await why('[data-call-mic]')) === "You can't speak in this channel.")
await pb.click('[data-voice-controls] [data-call-camera]', { force: true }) // marked unavailable for assistive tech, still answers a press
ok('pressing one says the reason', await toast(pb, "You can't turn on your camera in this channel."))
ok('and turns nothing on', await pb.locator(`[data-voice-tile="${b.user.id}"] video`).count() === 0)
await pb.screenshot({ path: 'callcontrols-why.png' })
await raw(a.token, 'DELETE', `/channels/${vc.id}/permissions/${g.id}`)
await pb.waitForFunction(() => document.querySelectorAll('[data-voice-controls] [data-control-why]').length === 0, null, { timeout: 6000 }).catch(() => {})
ok('the controls come back when the permission does', await pb.locator('[data-voice-controls] [data-control-why]').count() === 0)

console.log('-- a moderator\'s mute')
await raw(a.token, 'PATCH', `/guilds/${g.id}/members/${b.user.id}`, { mute: true })
await pb.waitForSelector('[data-voice-controls] [data-call-mic][data-control-why]', { timeout: 6000 }).catch(() => {})
ok('the microphone says a moderator muted you', (await why('[data-call-mic]')) === 'A moderator muted you. Only a moderator can unmute you.')
await pb.keyboard.press('Control+Shift+M')
ok('the mute shortcut explains it too', await toast(pb, 'A moderator muted you. Only a moderator can unmute you.'))
ok('and does not flip your own mute', await pb.evaluate(() => !document.querySelector('[data-voice-connected]')?.textContent?.includes('Unmute')))
await raw(a.token, 'PATCH', `/guilds/${g.id}/members/${b.user.id}`, { mute: false })
await pb.click('[data-voice-disconnect]'); await pa.click('[data-voice-disconnect]')

console.log('-- a microphone that cannot be opened')
await pb.waitForSelector('[data-voice-prejoin]')
await pb.evaluate(() => { window.__mic.fail = 'NotAllowedError' })
await pb.click('[data-voice-prejoin] button'); await pb.waitForSelector('[data-call-failed="microphone"]')
const said = () => pb.locator('[data-call-failed-why]').textContent()
ok('not allowed: says to allow it', (await said()).includes("isn't allowed to use your microphone"))
ok('never the browser\'s own words', !(await pb.locator('[data-call-failed]').textContent()).includes('raw browser words'))
await pb.click('[data-call-dismiss]')
await pb.evaluate(() => { window.__mic.fail = 'NotFoundError' })
await pb.click('[data-voice-prejoin] button'); await pb.waitForSelector('[data-call-failed="microphone"]')
ok('none found: says to connect one', (await said()).includes('No microphone was found'))
await pb.click('[data-call-dismiss]')
await pb.evaluate(() => { window.__mic.fail = 'NotReadableError' })
await pb.click('[data-voice-prejoin] button'); await pb.waitForSelector('[data-call-failed="microphone"]')
ok('busy: says another app may be using it', (await said()).includes("isn't responding"))
await pb.waitForTimeout(350); await pb.screenshot({ path: 'callcontrols-nomic.png' })
await pb.click('[data-call-listen-only]')
ok('Join without a microphone joins to listen', await connected(pb) && await pb.evaluate((id) => window.__parleyVoice().channel === id, vc.id))
ok('and the call says there is no microphone', await pb.waitForSelector('[data-mic-lost]', { timeout: 4000 }).then(() => true, () => false))
await pb.evaluate(() => { window.__mic.fail = null; navigator.mediaDevices.dispatchEvent(new Event('devicechange')) })
await pb.waitForSelector('[data-mic-lost]', { state: 'detached', timeout: 6000 }).catch(() => {})
ok('a microphone connected later is picked up', await pb.locator('[data-mic-lost]').count() === 0 && (await pb.evaluate(() => window.__parleyMic.info())).state === 'live')
await pb.click('[data-voice-disconnect]')

console.log('-- incoming calls')
await pb.goto(`${WEB}/channels/${g.id}/${g.channels.find((x) => x.kind === 'text').id}`); await pb.waitForSelector('textarea')
await pa.goto(`${WEB}/channels/@me/${dmAB.id}`); await pa.waitForSelector('[data-start-call]'); await pa.click('[data-start-call]')
await pb.waitForSelector('[data-incoming-call]')
ok('the card offers Ignore beside Join and Decline', await pb.locator('[data-incoming-call] [data-call-ignore]').count() === 1 && await pb.locator('[data-call-join]').count() === 1 && await pb.locator('[data-call-decline]').count() === 1)
ok('and names the keys', (await pb.locator('[data-call-keys]').textContent()).includes('Enter') && (await pb.locator('[data-call-keys]').textContent()).includes('Esc'))
ok('one call: nothing waiting', await pb.locator('[data-calls-waiting]').count() === 0)
const pc = await mk(c.token, `/channels/@me/${dmCB.id}`); await pc.waitForSelector('[data-start-call]'); await pc.click('[data-start-call]')
await pb.waitForSelector('[data-calls-waiting="1"]', { timeout: 8000 }).catch(() => {})
ok('a second caller is counted as waiting', await pb.locator('[data-calls-waiting="1"]').count() === 1)
await pb.waitForTimeout(350); await pb.screenshot({ path: 'callcontrols-incoming.png' })
const first = await pb.locator('[data-incoming-call] .font-bold').first().textContent()
await pb.evaluate(() => document.activeElement?.blur?.()); await pb.keyboard.press('Escape')
await pb.waitForSelector('[data-calls-waiting]', { state: 'detached', timeout: 4000 }).catch(() => {})
const second = await pb.locator('[data-incoming-call] .font-bold').first().textContent().catch(() => null)
ok('Escape ignores the call shown and the other takes its place', !!second && second !== first && await pb.locator('[data-calls-waiting]').count() === 0, `${first} → ${second}`)
ok('the ignored caller is still ringing (not declined)', await (first === 'Alice' ? pa : pc).locator('[data-voice-connected]').count() === 1)
// Escape while typing belongs to the field, not the call.
await pb.click('textarea'); await pb.keyboard.type('hello')
await pb.keyboard.press('Escape'); await pb.waitForTimeout(300)
ok('Escape in the composer leaves the call ringing', await pb.locator('[data-incoming-call]').count() === 1)
await pb.keyboard.press('Control+Enter')
ok('Ctrl+Enter answers, even from the composer', await connected(pb) && /channels\/@me\//.test(pb.url()))
ok('and the card is gone', await pb.locator('[data-incoming-call]').count() === 0)

console.log('-- in a call on another device')
const here = await pb.evaluate(() => window.__parleyVoice().channel)
const pb2 = await mk(b.token, `/channels/@me/${here}`)
await pb2.waitForSelector('[data-join-call]', { timeout: 8000 }).catch(() => {})
ok('a second window offers to join on this device', (await pb2.locator('[data-join-call]').textContent().catch(() => '')).includes('Join on this device') && (await pb2.getAttribute('[data-join-call]', 'data-call-elsewhere')) === '1')
ok('and does not ring for a call you are already in', await pb2.locator('[data-incoming-call]').count() === 0 || !(await pb2.locator('[data-incoming-call]').textContent()).includes(here === dmAB.id ? 'Alice' : 'Carol'))
await pb2.click('[data-join-call]')
ok('joining here works', await connected(pb2))

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
