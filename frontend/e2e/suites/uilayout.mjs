// Layout fixes: the Friends list fills the pane, the Inbox panel is not clipped by the header, the channel sidebar
// can be dragged wider (clamped to 450 px, remembered), the voice view shows a join splash before connecting, and
// the shell pads the bottom safe area (Android's nav bar).
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Layout ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['microphone', 'camera'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)

console.log('-- friends')
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('input[placeholder="Search"]')
const widths = await p.evaluate(() => { const main = document.querySelector('main').getBoundingClientRect().width; const box = document.querySelector('input[placeholder="Search"]').getBoundingClientRect().width; return { main, box } })
ok('the friends list stretches across the pane', widths.box > widths.main - 80, JSON.stringify(widths))

console.log('-- inbox')
await p.click('[data-inbox-toggle]'); await p.waitForSelector('[data-inbox]')
const visible = await p.evaluate(() => { const el = document.querySelector('[data-inbox]'); const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 40)); return r.height > 60 && r.right <= innerWidth && !!hit && el.contains(hit) })
ok('the Inbox panel opens fully visible below the header', visible)
await p.keyboard.press('Escape'); ok('Escape closes it', await p.locator('[data-inbox]').count() === 0)

console.log('-- sidebar resize')
const aside = () => p.evaluate(() => document.querySelector('aside').getBoundingClientRect().width)
const w0 = await aside()
const h = await p.locator('[data-sidebar-resizer]').boundingBox()
await p.mouse.move(h.x + h.width / 2, h.y + 200); await p.mouse.down(); await p.mouse.move(h.x + 100, h.y + 200, { steps: 5 }); await p.mouse.up()
const w1 = await aside()
ok('dragging the edge widens the sidebar', Math.abs(w1 - (w0 + 100)) <= 4, `${w0} -> ${w1}`)
const h2 = await p.locator('[data-sidebar-resizer]').boundingBox()
await p.mouse.move(h2.x + h2.width / 2, h2.y + 200); await p.mouse.down(); await p.mouse.move(h2.x + 600, h2.y + 200, { steps: 5 }); await p.mouse.up()
ok('it stops at 450 px', await aside() === 450, String(await aside()))
await p.reload(); await p.waitForSelector('aside')
ok('the width is remembered', await aside() === 450)
await p.dblclick('[data-sidebar-resizer]'); ok('double-click resets it', await aside() === 272, String(await aside()))
await p.setViewportSize({ width: 900, height: 900 }); await p.waitForTimeout(100)
ok('tablets keep the fixed width with no handle', await p.locator('[data-sidebar-resizer]').isHidden())
await p.setViewportSize({ width: 1600, height: 900 })

console.log('-- voice pre-join')
await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('[data-voice-prejoin]')
ok('an empty channel says no one is in voice, without a control bar', (await p.textContent('[data-prejoin-who]')).includes('No one is currently in voice') && await p.locator('[data-voice-controls]').count() === 0)
const pb = await (await browser.newContext({ permissions: ['microphone', 'camera'] })).newPage()
await pb.goto(`${WEB}/login`); await pb.evaluate((t) => localStorage.setItem('parley.token', t), b.token)
await pb.goto(`${WEB}/channels/${g.id}/${vc.id}`); await pb.click('text=Join Voice'); await pb.waitForSelector('[data-voice-leave]')
await p.waitForFunction(() => document.querySelector('[data-prejoin-who]')?.textContent.includes('is currently in voice'))
ok('once bob joins, alice sees him on the splash', await p.locator('[data-prejoin-people] > div').count() === 1 && (await p.textContent('[data-prejoin-who]')).includes(b.user.display_name))
await p.screenshot({ path: 'uilayout-prejoin.png' })
await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]')
ok('joining swaps the splash for the call and its control bar', await p.locator('[data-voice-prejoin]').count() === 0 && await p.locator('[data-voice-controls] [role=group]').count() === 2)
const bar = await p.locator('[data-voice-controls]').evaluate((el) => { const last = el.querySelector('[data-voice-leave]').getBoundingClientRect(); return el.getBoundingClientRect().bottom - last.bottom })
ok('the control bar has padding below its buttons', bar >= 12, String(bar))
await p.screenshot({ path: 'uilayout-controls.png' })
await p.click('[data-voice-controls] [data-device-chevron="input"]'); await p.waitForSelector('[data-mic-menu]')
await p.waitForTimeout(250) // let the menu's open animation finish before measuring it
const menu = await p.locator('[data-call-menu]').boundingBox(); const ctl = await p.locator('[data-voice-controls]').boundingBox()
ok('the mic menu opens above the bar, inside the window', menu.y + menu.height <= ctl.y + 4 && menu.y >= 0)
await p.screenshot({ path: 'uilayout-micmenu.png' })
await p.keyboard.press('Escape'); await pb.click('[data-voice-leave]'); await p.click('[data-voice-leave]')

console.log('-- stage and studio pre-join')
const stage = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'town-hall', kind: 'stage' })
const studio = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'studio-a', kind: 'studio' })
for (const [ch, empty, word] of [[stage, 'No one is on stage', 'stage'], [studio, 'No one is in the studio', 'studio']]) {
  await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector(`[data-voice-prejoin="${word}"]`)
  ok(`${word}: an empty channel gets the splash, without a control bar`, (await p.textContent('[data-prejoin-who]')).includes(empty) && await p.locator('[data-voice-controls]').count() === 0)
  await pb.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pb.click('text=Join Voice'); await pb.waitForSelector('[data-voice-leave]')
  await p.waitForFunction(() => document.querySelector('[data-prejoin-who]')?.textContent.includes('listening'))
  ok(`${word}: bob joining as audience shows as a listener, not a card`, (await p.textContent('[data-prejoin-who]')).includes('1 listening') && await p.locator('[data-prejoin-people]').count() === 0)
  await p.screenshot({ path: `uilayout-prejoin-${word}.png` })
  await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]')
  ok(`${word}: joining shows the stage, audience and the new control bar`, await p.locator('[data-voice-prejoin]').count() === 0 && await p.locator('[data-stage-audience]').count() === 1 && await p.locator('[data-voice-controls] [role=group]').count() === 2)
  await p.screenshot({ path: `uilayout-joined-${word}.png` })
  await pb.click('[data-voice-leave]'); await p.click('[data-voice-leave]')
}

console.log('-- safe area')
ok('the shell pads the bottom safe area (Android nav bar)', await p.evaluate(() => { document.documentElement.style.setProperty('--safe-area-inset-bottom', '48px'); const pad = getComputedStyle(document.querySelector('.safe-area')).paddingBottom; document.documentElement.style.removeProperty('--safe-area-inset-bottom'); return pad === '48px' }))

ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
