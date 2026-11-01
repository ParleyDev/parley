// Long device lists: with many microphones/speakers/cameras the pickers stay compact, fit the window and scroll, so
// every device can be reached (user panel menus and the call control sub-panels).
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Devs ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1280, height: 600 }, permissions: ['microphone', 'camera'] })
// 30 devices of each kind, far more than fit in a 600px window.
await ctx.addInitScript(() => {
  const fake = ['audioinput', 'audiooutput', 'videoinput'].flatMap((kind) => Array.from({ length: 30 }, (_, i) => ({ kind, deviceId: `${kind}-${i}`, groupId: 'g', label: kind === 'audioinput' ? `Microphone Array (Realtek High Definition Audio with Intel Smart Sound Technology) - Port ${i + 1}` : `${kind} device number ${i + 1}`, toJSON() { return this } })))
  const md = navigator.mediaDevices
  if (md) md.enumerateDevices = async () => fake
})
const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
const H = 600
const fits = (sel) => p.locator(sel).first().evaluate((el, h) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= h }, H)
const scrolls = (sel) => p.locator(sel).first().evaluate((el) => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'auto')
/** Scroll the list to the end and pick the last device; it must be visible inside the menu when clicked. */
async function pickLast(menu) {
  const last = p.locator(`${menu} [data-device-option]`).last()
  await last.scrollIntoViewIfNeeded()
  const visible = await last.evaluate((el, h) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= h }, H)
  const id = await last.getAttribute('data-device-option')
  await last.click()
  return { visible, id }
}
const settings = () => p.evaluate(() => JSON.parse(localStorage.getItem('parley.voiceSettings') ?? '{}'))

// User panel mic menu
await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('[data-control-menu="Mute"]')
await p.click('[data-control-menu="Mute"]'); await p.waitForSelector('[data-device-menu="input"] [data-device-option]')
ok('user panel: all 31 input options are listed (Default + 30)', await p.locator('[data-device-menu="input"] [data-device-option]').count() === 31)
ok('user panel: the menu fits in the window', await fits('[data-device-menu="input"]'))
ok('user panel: the device list scrolls inside the menu', await scrolls('[data-device-menu="input"] [data-device-list]'))
const panelMenuH = await p.locator('[data-device-menu="input"]').evaluate((el) => el.getBoundingClientRect().height)
ok('user panel: the menu stays compact', panelMenuH < 360, String(panelMenuH))
await p.waitForTimeout(400); await p.screenshot({ path: 'devicelist-panel.png' })
const label = p.locator('[data-device-menu="input"] [data-device-option="audioinput-29"] [data-device-label]')
ok('user panel: a long device name is shown whole, wrapped, not cut off', await label.evaluate((el) => el.scrollWidth <= el.clientWidth && getComputedStyle(el).textOverflow !== 'ellipsis' && el.getBoundingClientRect().height > 30))
ok('user panel: the ending that tells devices apart is visible', (await label.innerText()).endsWith('Port 30'))
ok('user panel: the full name is also in the tooltip', (await p.locator('[data-device-option="audioinput-29"]').getAttribute('title'))?.endsWith('Port 30'))
const pick1 = await pickLast('[data-device-menu="input"]')
ok('user panel: the last input device can be reached and picked', pick1.visible && (await settings()).inputDeviceId === 'audioinput-29', JSON.stringify(pick1))

// Call controls: mic menu sub-panels and the camera sub-panel
await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]')
await p.click('[data-voice-controls] [data-device-chevron="input"]'); await p.click('[data-device-row="output"]'); await p.waitForSelector('[data-device-menu="output"] [data-device-option]')
ok('call: the menu fits in the window', await fits('[data-call-menu]'))
ok('call: the output list scrolls inside the menu', await scrolls('[data-device-menu="output"] [data-device-list]'))
ok('call: the back button stays visible', await fits('[data-device-menu="output"] [data-menu-back]'))
await p.screenshot({ path: 'devicelist-call.png' })
const pick2 = await pickLast('[data-device-menu="output"]')
ok('call: the last output device can be reached and picked', pick2.visible && (await settings()).outputDeviceId === 'audiooutput-29', JSON.stringify(pick2))
await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('[data-call-menu]'))
await p.click('[data-voice-controls] [data-device-chevron="camera"]'); await p.click('[data-device-row="camera"]'); await p.waitForSelector('[data-device-menu="camera"] [data-device-option]')
ok('call: the camera menu fits in the window', await fits('[data-call-menu]'))
const pick3 = await pickLast('[data-device-menu="camera"]')
ok('call: the last camera can be reached and picked', pick3.visible && (await settings()).cameraDeviceId === 'videoinput-29', JSON.stringify(pick3))
await p.keyboard.press('Escape')
await p.click('[data-voice-leave]')
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
