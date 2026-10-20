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
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
