// Staying in a call while looking elsewhere: the floating call window can be moved to any corner and resized (both
// remembered), has mute, stop watching and hang up, shows your own share with who is watching, and can be turned off;
// the Voice Connected panel's channel name and a shortcut lead back to the call.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Mini ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice'); const tc = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const hooks = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360
    const x = cv.getContext('2d'); let n = 0
    setInterval(() => { x.fillStyle = `hsl(${(n += 7) % 360} 70% 50%)`; x.fillRect(0, 0, 640, 360) }, 60)
    return cv.captureStream(15)
  }
}
const mk = async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(hooks)
  const p = await ctx.newPage(); p.on('pageerror', (x) => errors.push(x.message))
  await p.goto(`${WEB}/login`); await p.evaluate((x) => { localStorage.setItem('parley.token', x); localStorage.setItem('parley.directCallNote', '1') }, t)
  await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('[data-voice-prejoin]')
  await p.click('[data-voice-prejoin] button'); await p.waitForSelector('[data-call-status="connected"]', { timeout: 15000 })
  return p
}
const pa = await mk(a.token), pb = await mk(b.token)
const toText = (p) => p.click(`a[href="/channels/${g.id}/${tc.id}"]`).then(() => p.waitForSelector('textarea'))
const mini = (p) => p.evaluate(() => { const el = document.querySelector('[data-mini-call]'); if (!el) return null; const r = el.getBoundingClientRect(); return { who: el.dataset.miniCall, corner: el.dataset.miniCorner, w: Math.round(r.width), x: Math.round(r.left), y: Math.round(r.top), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), own: el.dataset.miniOwn === '1' } })
const center = async (p) => { const m = await mini(p); return { x: m.x + m.w / 2, y: m.y + 40 } }

console.log('-- the floating call window')
await pb.click('[data-voice-connected] [data-voice-camera]')
await pa.waitForSelector(`[data-voice-tile="${b.user.id}"] video`, { timeout: 15000 })
await toText(pa); await pa.waitForSelector('[data-mini-call]', { timeout: 8000 }); await pa.waitForTimeout(400) // its entrance animation
let m = await mini(pa)
ok('looking elsewhere, the call floats bottom right with the other person\'s camera', m.who === b.user.id && m.corner === 'br' && m.w === 288 && m.right === 16, JSON.stringify(m))
ok('the call is still on', await pa.evaluate((id) => window.__parleyVoice().channel === id, vc.id))

console.log('-- its controls')
let c = await center(pa); await pa.mouse.move(c.x, c.y)
ok('pointing at it shows mute and hang up', await pa.locator('[data-mini-controls] [data-mini-mute]').isVisible() && await pa.locator('[data-mini-controls] [data-mini-leave]').isVisible())
await pa.click('[data-mini-mute]')
ok('mute works from it', await pa.locator('[data-mini-mute][aria-pressed="true"]').count() === 1)
await pa.click('[data-mini-mute]')
ok('and unmute', await pa.locator('[data-mini-mute][aria-pressed="false"]').count() === 1)
await pa.waitForTimeout(300); await pa.screenshot({ path: 'callmini-controls.png' })

console.log('-- moving and resizing')
c = await center(pa); await pa.mouse.move(c.x, c.y); await pa.mouse.down(); await pa.mouse.move(600, 400, { steps: 6 }); await pa.mouse.move(180, 160, { steps: 8 }); await pa.mouse.up()
await pa.waitForSelector('[data-mini-call][data-mini-corner="tl"]', { timeout: 3000 }).catch(() => {}); await pa.waitForTimeout(250)
m = await mini(pa)
ok('dragged towards the top left, it snaps to that corner', m.corner === 'tl' && m.x === 16 && m.y === 64, JSON.stringify(m))
ok('dragging did not count as a click (still elsewhere)', new URL(pa.url()).pathname === `/channels/${g.id}/${tc.id}`)
ok('the corner is remembered', await pa.evaluate(() => JSON.parse(localStorage.getItem('parley.miniCall')).corner === 'tl'))
const grip = await pa.locator('[data-mini-grip]').boundingBox()
await pa.mouse.move(grip.x + 8, grip.y + 8); await pa.mouse.down(); await pa.mouse.move(grip.x + 128, grip.y + 80, { steps: 6 }); await pa.mouse.up(); await pa.waitForTimeout(200)
m = await mini(pa)
ok('dragging the grip makes it bigger, keeping 16:9 and its corner', m.w >= 400 && m.w <= 412 && m.x === 16 && m.corner === 'tl', JSON.stringify(m))
ok('the size is remembered', await pa.evaluate((w) => JSON.parse(localStorage.getItem('parley.miniCall')).w === w, m.w))
await pa.focus('[data-mini-grip]'); await pa.keyboard.press('ArrowDown'); await pa.waitForTimeout(100)
ok('the grip also answers the arrow keys', (await mini(pa)).w === m.w - 16)
await pa.setViewportSize({ width: 900, height: 700 }); await pa.waitForTimeout(250)
const small = await mini(pa)
ok('it stays inside a smaller window', small.x >= 0 && small.x + small.w <= 900, JSON.stringify(small))
await pa.setViewportSize({ width: 1440, height: 900 })

console.log('-- the way back')
c = await center(pa); await pa.mouse.click(c.x, c.y)
await pa.waitForFunction((path) => location.pathname === path, `/channels/${g.id}/${vc.id}`, { timeout: 4000 }).catch(() => {})
ok('a click on the picture returns to the call', new URL(pa.url()).pathname === `/channels/${g.id}/${vc.id}` && await pa.locator('[data-mini-call]').count() === 0)
await toText(pa)
await pa.click('[data-voice-connected] [data-voice-where]')
await pa.waitForFunction((path) => location.pathname === path, `/channels/${g.id}/${vc.id}`, { timeout: 4000 }).catch(() => {})
ok('the channel name in Voice Connected goes to the call', new URL(pa.url()).pathname === `/channels/${g.id}/${vc.id}`)
ok('and its status line still opens Connection details', await pa.click('[data-call-status]').then(() => pa.waitForSelector('[data-voice-details]', { timeout: 3000 })).then(() => true, () => false))
await pa.mouse.click(800, 300); await pa.waitForSelector('[data-voice-details]', { state: 'detached' })
await toText(pa); await pa.keyboard.press('Control+Alt+V')
await pa.waitForFunction((path) => location.pathname === path, `/channels/${g.id}/${vc.id}`, { timeout: 4000 }).catch(() => {})
ok('so does the Jump to the call shortcut', new URL(pa.url()).pathname === `/channels/${g.id}/${vc.id}`)

console.log('-- your own share')
await pb.click('[data-voice-connected] [data-voice-camera]')
await pa.waitForFunction((id) => !document.querySelector(`[data-voice-tile="${id}"] video`), b.user.id, { timeout: 8000 }).catch(() => {})
await pa.click('[data-voice-connected] [data-voice-screen]'); await pa.waitForSelector(`[data-voice-tile="${a.user.id}"] video`, { timeout: 8000 })
await toText(pa); await pa.waitForSelector('[data-mini-call][data-mini-own="1"]', { timeout: 8000 }).catch(() => {})
m = await mini(pa)
ok('sharing and looking elsewhere: the window shows your own screen', !!m && m.own && m.who === a.user.id, JSON.stringify(m))
ok('with nobody watching yet', (await pa.getAttribute('[data-mini-viewers]', 'data-mini-viewers')) === '0')
await pb.click('button:has-text("Watch Stream")')
await pa.waitForSelector('[data-mini-viewers="1"]', { timeout: 8000 }).catch(() => {})
ok('and counts who is watching', (await pa.getAttribute('[data-mini-viewers]', 'data-mini-viewers')) === '1')
await pa.waitForTimeout(300); await pa.screenshot({ path: 'callmini-own.png' })
c = await center(pa); await pa.mouse.move(c.x, c.y); await pa.click('[data-mini-stop-share]')
await pa.waitForSelector('[data-mini-call]', { state: 'detached', timeout: 5000 }).catch(() => {})
ok('Stop Sharing from the window ends the share', await pa.locator('[data-mini-call]').count() === 0 && await pa.locator('[data-voice-connected] [data-voice-screen][title="Share Your Screen"]').count() === 1)

console.log('-- turning it off, and hanging up from it')
await pb.click('[data-voice-connected] [data-voice-camera]'); await pa.waitForSelector('[data-mini-call]', { timeout: 15000 })
await pa.click('button[title="User Settings"]'); await pa.click('button:has-text("Voice & Video")'); await pa.waitForSelector('[data-minicall-setting]')
await pa.click('[data-minicall-setting] [role="switch"]'); await pa.keyboard.press('Escape'); await pa.waitForTimeout(300)
ok('with the setting off there is no floating window', await pa.locator('[data-mini-call]').count() === 0 && await pa.evaluate(() => JSON.parse(localStorage.getItem('parley.voiceSettings')).miniCall === false))
await pa.click('button[title="User Settings"]'); await pa.click('button:has-text("Voice & Video")'); await pa.click('[data-minicall-setting] [role="switch"]'); await pa.keyboard.press('Escape')
await pa.waitForSelector('[data-mini-call]', { timeout: 5000 }).catch(() => {})
ok('and it is back when turned on', await pa.locator('[data-mini-call]').count() === 1)
c = await center(pa); await pa.mouse.move(c.x, c.y); await pa.click('[data-mini-leave]')
await pa.waitForFunction(() => window.__parleyVoice().channel === null, null, { timeout: 5000 }).catch(() => {})
ok('hang up from the window leaves the call', await pa.evaluate(() => window.__parleyVoice().channel === null) && await pa.locator('[data-mini-call]').count() === 0)

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
