// Voice view layout: tiles toggle between grid and focused on click, fullscreen on the corner button; the chat panel
// is resizable by dragging its edge and the width sticks.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Layout ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const mk = async (tok) => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('text=Join Voice'); await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]'); return p }
const pa = await mk(a.token); const pb = await mk(b.token)
await pa.waitForFunction(() => document.querySelectorAll('[data-voice-tile]').length === 2)
ok('two tiles in a grid, none focused', await pa.locator('[data-voice-tile][data-tile-big="1"]').count() === 0)
await pa.locator(`[data-voice-tile="${b.user.id}"]`).click()
await pa.waitForSelector(`[data-voice-tile="${b.user.id}"][data-tile-big="1"]`)
ok('clicking a feed focuses it full-size with the others in a strip', await pa.locator('[data-tile-big="1"]').count() === 1 && await pa.locator(`[data-voice-tile="${a.user.id}"][data-tile-big="0"]`).count() === 1)
await pa.locator(`[data-voice-tile="${a.user.id}"]`).click(); await pa.waitForSelector(`[data-voice-tile="${a.user.id}"][data-tile-big="1"]`)
ok('clicking a strip feed swaps the focus', await pa.locator(`[data-voice-tile="${b.user.id}"][data-tile-big="0"]`).count() === 1)
await pa.locator(`[data-voice-tile="${a.user.id}"][data-tile-big="1"]`).click()
await pa.waitForFunction(() => !document.querySelector('[data-tile-big="1"]'))
ok('clicking the focused feed returns to the grid', await pa.locator('[data-voice-tile]').count() === 2)
await pa.locator(`[data-voice-tile="${b.user.id}"]`).hover(); await pa.locator(`[data-voice-tile="${b.user.id}"] [data-tile-fullscreen]`).click()
await pa.waitForFunction((id) => document.fullscreenElement?.getAttribute('data-voice-tile') === id, b.user.id)
ok('the corner button puts the feed in real fullscreen', true)
await pa.locator(`[data-voice-tile="${b.user.id}"] [data-tile-fullscreen]`).click(); await pa.waitForFunction(() => !document.fullscreenElement)
ok('the button toggles back out of fullscreen', true)
// Resizable chat
await pa.click('button[title="Show Chat"]'); await pa.waitForSelector('[data-voice-chat-panel]')
const w0 = (await pa.locator('[data-voice-chat-panel]').boundingBox()).width
const h = await pa.locator('[data-resize-handle="voiceChat"]').boundingBox()
await pa.mouse.move(h.x + h.width / 2, h.y + 200); await pa.mouse.down(); await pa.mouse.move(h.x - 150, h.y + 200, { steps: 8 }); await pa.mouse.up()
const w1 = (await pa.locator('[data-voice-chat-panel]').boundingBox()).width
ok('dragging the edge widens the chat', w1 > w0 + 100, `${w0} -> ${w1}`)
await pa.reload(); await pa.waitForSelector('[data-voice-chat-panel]')
ok('the width is remembered', Math.abs((await pa.locator('[data-voice-chat-panel]').boundingBox()).width - w1) < 2)
await pa.locator('[data-resize-handle="voiceChat"]').dblclick()
ok('double-click resets it', Math.abs((await pa.locator('[data-voice-chat-panel]').boundingBox()).width - 400) < 2)
await pa.locator('[data-resize-handle="voiceChat"]').focus(); await pa.keyboard.press('ArrowLeft'); await pa.keyboard.press('ArrowLeft')
ok('keyboard resizing works', Math.abs((await pa.locator('[data-voice-chat-panel]').boundingBox()).width - 448) < 2)
await pa.screenshot({ path: '158-voice-resize.png' })
// Fit vs fill: a camera feed letterboxes by default; the hover button flips every tile to cover, and it sticks.
const rejoin = async () => { await pa.waitForSelector('text=Join Voice'); await pa.click('text=Join Voice'); await pa.waitForSelector('[data-voice-leave]') }
await pa.click('button[title="Hide Chat"]'); await rejoin(); await pa.click('button[title="Turn On Camera"]'); await pa.waitForSelector(`[data-voice-tile="${a.user.id}"] video`)
ok('a camera feed fits the frame by default', await pa.locator(`[data-voice-tile="${a.user.id}"] video.object-contain`).count() === 1)
await pa.locator(`[data-voice-tile="${a.user.id}"]`).hover(); await pa.locator(`[data-voice-tile="${a.user.id}"] [data-tile-fit="fit"]`).click()
await pa.waitForSelector(`[data-voice-tile="${a.user.id}"] video.object-cover`)
ok('the fit button switches the feed to fill (cropping)', await pa.locator('[data-tile-fit="fill"]').count() === 1)
await pa.reload(); await rejoin(); await pa.click('button[title="Turn On Camera"]'); await pa.waitForSelector(`[data-voice-tile="${a.user.id}"] video`)
ok('the fill preference is remembered', await pa.locator(`[data-voice-tile="${a.user.id}"] video.object-cover`).count() === 1)
await pa.locator(`[data-voice-tile="${a.user.id}"]`).hover(); await pa.locator(`[data-voice-tile="${a.user.id}"] [data-tile-fit="fill"]`).click(); await pa.waitForSelector(`[data-voice-tile="${a.user.id}"] video.object-contain`)
// DM call: the stage is tall by default, resizable at its bottom edge, and tiles focus on click.
await pa.click('[data-voice-leave]'); await pb.click('[data-voice-leave]')
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
await pa.goto(`${WEB}/channels/@me/${dm.id}`); await pa.waitForSelector('[data-start-call]'); await pa.click('[data-start-call]'); await pa.waitForSelector('[data-dm-call] [data-call-participant]')
await pb.goto(`${WEB}/channels/@me/${dm.id}`); await pb.waitForSelector('[data-join-call]'); await pb.click('[data-join-call]')
await pa.waitForFunction(() => document.querySelectorAll('[data-dm-call] [data-call-participant]').length === 2)
const h0 = (await pa.locator('[data-dm-call]').boundingBox()).height
ok('the DM call stage starts at a usable height', Math.abs(h0 - 360) < 2, String(h0))
const hb = await pa.locator('[data-resize-handle="dmCall"]').boundingBox()
await pa.mouse.move(hb.x + 300, hb.y + hb.height / 2); await pa.mouse.down(); await pa.mouse.move(hb.x + 300, hb.y + 150, { steps: 8 }); await pa.mouse.up()
const h1 = (await pa.locator('[data-dm-call]').boundingBox()).height
ok('dragging the bottom edge makes the call taller', h1 > h0 + 100, `${h0} -> ${h1}`)
await pa.reload(); await pa.waitForSelector('[data-dm-call] [data-call-participant]')
ok('the call height is remembered', Math.abs((await pa.locator('[data-dm-call]').boundingBox()).height - h1) < 2)
await pa.locator('[data-resize-handle="dmCall"]').dblclick()
ok('double-click resets the height', Math.abs((await pa.locator('[data-dm-call]').boundingBox()).height - 360) < 2)
await pa.locator('[data-resize-handle="dmCall"]').focus(); await pa.keyboard.press('ArrowDown'); await pa.keyboard.press('ArrowDown')
ok('keyboard resizing works on the call too', Math.abs((await pa.locator('[data-dm-call]').boundingBox()).height - 408) < 2)
await pa.locator(`[data-dm-call] [data-call-participant="${b.user.id}"]`).click(); await pa.waitForSelector(`[data-dm-call] [data-call-participant="${b.user.id}"][data-tile-big="1"]`)
ok('clicking a DM call tile focuses it', await pa.locator('[data-dm-call] [data-tile-big="1"]').count() === 1)
await pa.screenshot({ path: '159-dm-call-resize.png' })
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
