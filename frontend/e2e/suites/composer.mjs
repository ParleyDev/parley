// The message box at any text size and on phones: empty, it stays one line however long its placeholder; narrow boxes
// fold GIF and stickers into the emoji button; on touch devices "+" opens a sheet whose Photos, Camera and Files
// tiles open the phone's own pickers (and Poll / Voice message), while desktop keeps its menu.
import { chromium } from 'playwright'
import { WEB, S, PNG, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('composer')
const g = await call(a.token, 'POST', '/guilds', { name: `Compose ${S}` })
const long = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'stems-and-samples-and-more-stems', kind: 'text' })
const browser = await chromium.launch(); const errors = []
const mk = async (phone) => {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
  await p.goto(`${WEB}/channels/${g.id}/${long.id}`); await p.waitForSelector('textarea'); await p.waitForTimeout(500)
  return p
}

console.log('-- desktop')
const d = await mk(false)
ok('GIF, sticker and emoji buttons are all there', await d.isVisible('[data-gif-button]') && await d.isVisible('[data-sticker-button]') && await d.isVisible('[data-emoji-button]'))
await d.click('[data-composer-plus]'); await d.waitForSelector('[data-context-menu]')
ok('"+" opens the menu', await d.locator('[data-context-menu] [data-menu-item="Upload a File"]').count() === 1 && await d.locator('[data-attach-sheet]').count() === 0)
await d.keyboard.press('Escape')

console.log('-- phone, larger text')
const p = await mk(true)
await p.evaluate(() => document.documentElement.style.setProperty('--font-scale', '1.2')); await p.waitForTimeout(200)
const box = () => p.evaluate(() => { const t = document.querySelector('textarea'); const cs = getComputedStyle(t); return { h: t.offsetHeight, line: parseFloat(cs.lineHeight), pad: parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) } })
const empty = await box()
ok('the empty box is one line at 120% text, despite a long placeholder', empty.h <= empty.line + empty.pad + 2, JSON.stringify(empty))
ok('GIF and sticker fold away on a narrow box; emoji stays', await p.locator('[data-gif-button]').count() === 0 && await p.locator('[data-sticker-button]').count() === 0 && await p.isVisible('[data-emoji-button]'))
await p.click('[data-emoji-button]'); await p.waitForTimeout(300)
ok('and the emoji picker still offers GIFs and stickers', await p.locator('text=GIFs').count() + await p.locator('text=Stickers').count() >= 1)
await p.keyboard.press('Escape'); await p.mouse.click(200, 200); await p.waitForTimeout(200)
await p.fill('textarea', 'one\ntwo\nthree'); await p.waitForTimeout(150)
ok('typed lines still grow the box', (await box()).h > empty.h * 2)
await p.fill('textarea', ''); await p.waitForTimeout(150)
ok('and clearing it goes back to one line', (await box()).h === empty.h)

console.log('-- phone attach sheet')
await p.tap('[data-composer-plus]'); await p.waitForSelector('[data-attach-sheet]')
ok('"+" opens the attach sheet, not the menu', await p.locator('[data-context-menu]').count() === 0)
const tiles = await p.locator('[data-attach-sheet] [data-attach]').evaluateAll((els) => els.map((e) => e.dataset.attach))
ok('with Photos & videos, Take photo, Record video, Files, Poll and Voice message', ['media', 'camera', 'video', 'files', 'poll', 'voice'].every((t) => tiles.includes(t)), JSON.stringify(tiles))
await p.keyboard.press('Escape'); await p.waitForSelector('[data-attach-sheet]', { state: 'detached' })
const pick = async (what) => { await p.tap('[data-composer-plus]'); await p.waitForSelector('[data-attach-sheet]'); const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.tap(`[data-attach="${what}"]`)]); return fc }
let fc = await pick('media')
ok('Photos & videos opens the photo picker (images and videos)', (await fc.element().getAttribute('accept')) === 'image/*,video/*' && fc.isMultiple())
await fc.setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(800)
ok('a picked photo attaches to the message', await p.locator('text=dot.png').count() >= 1)
fc = await pick('camera')
// One type per capture input: with image/* and video/* together Android's WebView opens only the video recorder.
ok('Take photo opens the camera for photos only', (await fc.element().getAttribute('capture')) === 'environment' && (await fc.element().getAttribute('accept')) === 'image/*')
await fc.setFiles([])
fc = await pick('video')
ok('Record video opens the camera for video only', (await fc.element().getAttribute('capture')) === 'environment' && (await fc.element().getAttribute('accept')) === 'video/*')
await fc.setFiles([])
fc = await pick('files')
ok('Files opens the file picker (any kind of file)', (await fc.element().getAttribute('accept')) === null)
await fc.setFiles([])
await p.tap('[data-composer-plus]'); await p.tap('[data-attach="poll"]'); await p.waitForTimeout(400)
ok('Poll opens the poll dialog', await p.locator('text=Create Poll').count() + await p.locator('[data-poll-question], input[placeholder*="question" i]').count() >= 1)
await p.screenshot({ path: 'composer-phone.png' })

ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
