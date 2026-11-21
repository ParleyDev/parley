// The call's layout: tiles sized to the space with nothing to scroll, "+N" when there are more people than fit at a
// size worth looking at; a click focuses and a double click goes fullscreen without the focus flipping twice;
// fullscreen is the whole call with its controls, which step aside when the pointer rests and stay while a menu is open.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const names = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank']
const users = []; for (const n of names) users.push(await reg(n))
const [a, b] = users
const g = await call(a.token, 'POST', '/guilds', { name: `Layout ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of users.slice(1)) await call(u.token, 'POST', `/invites/${inv.code}`)
await call(a.token, 'POST', '/users/@me/relationships', { user_id: b.user.id }); await call(b.token, 'PUT', `/users/@me/relationships/${a.user.id}`)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const mk = async (t, path, viewport = { width: 1440, height: 900 }) => {
  const p = await (await browser.newContext({ viewport })).newPage(); p.on('pageerror', (x) => errors.push(x.message))
  await p.goto(`${WEB}/login`); await p.evaluate((x) => { localStorage.setItem('parley.token', x); localStorage.setItem('parley.voiceChat', '0') }, t)
  await p.goto(`${WEB}${path}`); return p
}
const vcPath = `/channels/${g.id}/${vc.id}`
const joinVoice = async (p) => { await p.waitForSelector('[data-voice-prejoin]'); await p.click('[data-voice-prejoin] button'); await p.waitForSelector('[data-call-status="connected"]', { timeout: 15000 }) }
const pa = await mk(a.token, vcPath); await joinVoice(pa)
const pages = [pa]
const grid = (p) => p.evaluate(() => {
  const box = document.querySelector('[data-voice-grid-box]'); const g = document.querySelector('[data-voice-grid]')
  const tiles = [...document.querySelectorAll('[data-voice-grid] [data-voice-tile]')].map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), right: r.right, bottom: r.bottom, left: r.left, top: r.top } })
  const b = box.getBoundingClientRect()
  return { boxW: Math.round(b.width), boxH: Math.round(b.height), scrolls: box.scrollHeight > box.clientHeight + 1, cols: Number(g.dataset.gridCols), more: g.dataset.gridMore ? Number(g.dataset.gridMore) : 0, tiles, inside: tiles.every((t) => t.left >= b.left - 1 && t.right <= b.right + 1 && t.top >= b.top - 1 && t.bottom <= b.bottom + 1) }
})

console.log('-- tiles sized to the space')
let gr = await grid(pa)
ok('alone: one large tile, no scrolling', gr.tiles.length === 1 && gr.tiles[0].w >= 600 && !gr.scrolls && gr.inside, JSON.stringify(gr))
ok('16:9', Math.abs(gr.tiles[0].w / gr.tiles[0].h - 16 / 9) < 0.03)
const pb = await mk(b.token, vcPath); await joinVoice(pb); pages.push(pb)
await pa.waitForFunction(() => document.querySelectorAll('[data-voice-grid] [data-voice-tile]').length === 2)
gr = await grid(pa)
ok('two: both fit, larger than the old fixed 480px where the space allows', gr.tiles.length === 2 && gr.inside && !gr.scrolls && gr.tiles[0].w > 480, JSON.stringify(gr.tiles))
await pa.setViewportSize({ width: 1440, height: 520 }); await pa.waitForTimeout(250)
const short = await grid(pa)
ok('a shorter window rearranges and shrinks them to fit', short.inside && !short.scrolls && short.cols === 2 && short.tiles[0].w < gr.tiles[0].w, JSON.stringify(short))
await pa.setViewportSize({ width: 1440, height: 900 })
for (const u of users.slice(2)) { const p = await mk(u.token, vcPath, { width: 900, height: 600 }); await joinVoice(p); pages.push(p) }
await pa.waitForFunction(() => document.querySelectorAll('[data-voice-grid] [data-voice-tile]').length === 6, null, { timeout: 15000 })
gr = await grid(pa)
ok('six: all shown, all inside, nothing to scroll', gr.tiles.length === 6 && gr.inside && !gr.scrolls && gr.more === 0, JSON.stringify({ cols: gr.cols, w: gr.tiles[0].w }))
await pa.screenshot({ path: 'calllayout-six.png' })

console.log('-- more people than fit')
await pa.setViewportSize({ width: 1280, height: 560 }); await pa.waitForFunction(() => !!document.querySelector('[data-grid-more-tile]'), null, { timeout: 5000 }).catch(() => {})
gr = await grid(pa)
ok('a small window shows those that fit and "+N" for the rest', gr.more > 0 && gr.tiles.length + gr.more === 6 && gr.inside && !gr.scrolls, JSON.stringify({ shown: gr.tiles.length, more: gr.more, w: gr.tiles[0]?.w }))
ok('no tile below the least size', gr.tiles.every((t) => t.w >= 220), JSON.stringify({ box: [gr.boxW, gr.boxH], cols: gr.cols, tiles: gr.tiles.map((t) => [t.w, t.h]) }))
ok('"+N" says how many', (await pa.locator('[data-grid-more-tile]').textContent()).includes(`+${gr.more}`))
await pa.screenshot({ path: 'calllayout-more.png' })
await pa.click('[data-grid-more-tile]')
await pa.waitForFunction(() => document.querySelectorAll('[data-voice-grid] [data-voice-tile]').length === 6)
ok('pressing it shows everyone, scrolling', (await grid(pa)).tiles.length === 6 && await pa.locator('[data-grid-fit]').count() === 1)
await pa.click('[data-grid-fit]')
ok('and Fit to window goes back', await pa.locator('[data-grid-more-tile]').count() === 1)
await pa.setViewportSize({ width: 1440, height: 900 }); await pa.waitForTimeout(250)

console.log('-- click and double click')
const tileB = `[data-voice-tile="${b.user.id}"]`
await pa.evaluate(() => { window.__flips = 0; new MutationObserver((ms) => { for (const m of ms) if (m.attributeName === 'data-tile-big' || [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches?.('[data-tile-big="1"]') || n.querySelector?.('[data-tile-big="1"]')))) window.__flips++ }).observe(document.querySelector('main'), { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tile-big'] }) })
await pa.click(tileB)
await pa.waitForSelector(`${tileB}[data-tile-big="1"]`, { timeout: 3000 }).catch(() => {})
ok('a click focuses the tile', await pa.locator(`${tileB}[data-tile-big="1"]`).count() === 1)
await pa.click(`${tileB}[data-tile-big="1"]`); await pa.waitForFunction(() => !document.querySelector('[data-tile-big="1"]'))
ok('and a click on it returns to the grid', true)
await pa.evaluate(() => { window.__flips = 0 })
await pa.dblclick(tileB)
await pa.waitForFunction(() => !!document.fullscreenElement && !!document.querySelector('[data-call-fullscreen]'), null, { timeout: 5000 }).catch(() => {})
ok('a double click goes fullscreen', await pa.evaluate(() => !!document.fullscreenElement) && await pa.locator('[data-call-fullscreen]').count() === 1)
ok('with that tile in front', await pa.locator(`${tileB}[data-tile-big="1"]`).count() === 1)
await pa.waitForTimeout(500)
ok('and the layout changed once, not back and forth', await pa.evaluate(() => window.__flips) <= 2, String(await pa.evaluate(() => window.__flips)))

console.log('-- fullscreen is the whole call')
const cover = await pa.evaluate(() => { const r = document.querySelector('[data-call-fullscreen]').getBoundingClientRect(); const at = (x, y) => !!document.elementFromPoint(x, y)?.closest('[data-call-fullscreen]'); return { full: r.left === 0 && r.top === 0 && Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight, corners: at(4, 4) && at(innerWidth - 4, 4) && at(4, innerHeight / 2) && at(innerWidth - 4, innerHeight / 2) } })
ok('the call covers the whole screen, over the sidebars', cover.full && cover.corners, JSON.stringify(cover))
ok('the controls are there', await pa.locator('[data-call-fullscreen] [data-voice-controls] [data-call-mic]').isVisible() && await pa.locator('[data-call-fullscreen] [data-voice-leave]').isVisible())
ok('everyone else is still shown (the strip)', await pa.locator('[data-call-fullscreen] [data-voice-tile]').count() === 6)
await pa.mouse.move(700, 400); await pa.waitForTimeout(350); await pa.screenshot({ path: 'calllayout-fullscreen.png' })
await pa.click('[data-call-fullscreen] [data-call-mic]')
ok('mute works from fullscreen', await pa.locator('[data-call-fullscreen] [data-call-mic][aria-pressed="true"]').count() === 1)
await pa.click('[data-call-fullscreen] [data-call-mic]')
await pa.mouse.move(700, 300); await pa.waitForSelector('[data-controls-hidden="1"]', { timeout: 6000 }).catch(() => {})
ok('the controls step aside when the pointer rests', await pa.locator('[data-controls-hidden="1"]').count() === 1 && await pa.evaluate(() => getComputedStyle(document.querySelector('[data-voice-controls]')).opacity === '0'))
await pa.mouse.move(720, 320); await pa.waitForSelector('[data-controls-hidden]', { state: 'detached', timeout: 2000 }).catch(() => {})
ok('and return when it moves', await pa.locator('[data-controls-hidden]').count() === 0)
await pa.click('[data-call-fullscreen] button[aria-label="Microphone options"]'); await pa.waitForSelector('[data-call-menu]')
ok('a menu from the controls shows in fullscreen', await pa.locator('[data-call-menu]').isVisible())
await pa.mouse.move(100, 100); await pa.waitForTimeout(3600)
ok('and keeps the controls while it is open', await pa.locator('[data-controls-hidden]').count() === 0 && await pa.locator('[data-call-menu]').isVisible())
await pa.keyboard.press('Escape'); await pa.waitForSelector('[data-call-menu]', { state: 'detached' })
ok('closing the menu leaves fullscreen on', await pa.evaluate(() => !!document.fullscreenElement))
await pa.hover(tileB); await pa.click(`${tileB} [data-tile-fullscreen]`)
await pa.waitForFunction(() => !document.fullscreenElement && !document.querySelector('[data-call-fullscreen]'), null, { timeout: 4000 }).catch(() => {})
ok('the tile\'s button leaves fullscreen', await pa.evaluate(() => !document.fullscreenElement) && await pa.locator('[data-call-fullscreen]').count() === 0)
await pa.dblclick(tileB); await pa.waitForSelector('[data-call-fullscreen]')
await pa.mouse.move(700, 700); await pa.click('[data-voice-leave]')
await pa.waitForFunction(() => !document.fullscreenElement, null, { timeout: 4000 }).catch(() => {})
ok('hanging up leaves fullscreen as well as the call', await pa.evaluate(() => !document.fullscreenElement) && await pa.locator('[data-voice-prejoin]').count() === 1)

console.log('-- a DM call')
await pb.click('[data-voice-disconnect]')
await pa.goto(`${WEB}/channels/@me/${dm.id}`); await pa.waitForSelector('[data-start-call]'); await pa.click('[data-start-call]')
await pb.waitForSelector('[data-incoming-call]'); await pb.click('[data-call-join]')
await pa.waitForSelector(`[data-dm-call] [data-call-participant="${b.user.id}"]`, { timeout: 15000 })
await pa.dblclick(`[data-dm-call] [data-call-participant="${b.user.id}"]`)
await pa.waitForSelector('[data-dm-call][data-call-fullscreen]', { timeout: 5000 }).catch(() => {})
const dmCover = await pa.evaluate(() => { const el = document.querySelector('[data-dm-call][data-call-fullscreen]'); if (!el) return null; const r = el.getBoundingClientRect(); return Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight && !!document.fullscreenElement })
ok('a double click puts the DM call fullscreen, controls included', dmCover === true && await pa.locator('[data-dm-call] [data-call-leave]').isVisible())
await pa.mouse.move(600, 300); await pa.waitForSelector('[data-dm-controls][data-controls-hidden="1"]', { timeout: 6000 }).catch(() => {})
ok('its controls step aside too', await pa.locator('[data-dm-controls][data-controls-hidden="1"]').count() === 1)
await pa.mouse.move(620, 320); await pa.click('[data-dm-call] [data-call-leave]')
await pa.waitForFunction(() => !document.fullscreenElement, null, { timeout: 4000 }).catch(() => {})
ok('leaving the call leaves fullscreen', await pa.evaluate(() => !document.fullscreenElement))

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
