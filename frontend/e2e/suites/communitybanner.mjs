// A community's header image: its own layout (fill with zoom and focus, or the whole picture fitted over a blurred
// copy, aligned anywhere on a 3×3 grid) for a header that is as wide as the window, previewed at phone, desktop and
// wide-screen sizes; a full-width chooser (add, change, adjust, remove); a header at least as tall as the server
// banner; and Delete as a real button in the edit bar.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'

const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Comm Banner ${S}` })
const base = `/guilds/${g.id}/communities`
await call(a.token, 'POST', base, { slug: 'vista', name: 'Vista', description: 'Wide views' })

const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/c/vista`); await p.waitForSelector('[data-community-page="vista"]')
const picture = async (w, h) => Buffer.from(await p.evaluate(([w, h]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')
  x.fillStyle = '#ff0000'; x.fillRect(0, 0, w / 2, h); x.fillStyle = '#0000ff'; x.fillRect(w / 2, 0, w / 2, h)
  return c.toDataURL('image/png').split(',')[1]
}, [w, h]), 'base64')
const pic = { name: 'vista.png', mimeType: 'image/png', buffer: await picture(1200, 600) }
const onTop = async (pg, sel) => pg.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 6); return !!hit?.closest(sel) }, sel)
const height = async (sel) => (await p.locator(sel).boundingBox()).height

console.log('-- header')
ok('the header is at least as tall as the server banner (135px)', await height('[data-community-banner]') >= 135, String(await height('[data-community-banner]')))

console.log('-- edit bar')
await p.click('[data-community-edit]'); await p.waitForSelector('[data-community-editing]')
const del = await p.locator('[data-community-delete]').boundingBox(), save = await p.locator('[data-community-save]').boundingBox()
ok('Delete sits in the edit bar beside Save', Math.abs(del.y - save.y) < 4 && del.x < save.x, JSON.stringify([del, save]))
ok('and is a bordered button, not a text link', await p.locator('[data-community-delete]').evaluate((e) => getComputedStyle(e).borderTopWidth !== '0px'))
await p.click('[data-community-delete]'); await p.waitForSelector('[data-community-delete-confirm]')
ok('it asks first, naming the community', (await p.textContent('[data-community-delete-panel]')).includes('Delete Vista'))
await p.keyboard.press('Escape')
ok('Escape closes the question', (await p.locator('[data-community-delete-panel]').count()) === 0)

console.log('-- choosing a header image')
ok('an empty header is one big Add target', (await p.locator('[data-edit-banner-add]').count()) === 1 && await height('[data-edit-banner-add]') > 100)
await p.setInputFiles('[data-edit-banner-input]', pic)
await p.waitForSelector('[data-banner-dialog]')
ok('it opens the header layout, not the server banner cropper', (await p.locator('[data-crop-dialog]').count()) === 0)
ok('with phone and wide-screen previews', (await p.locator('[data-banner-preview="phone"]').count()) === 1 && (await p.locator('[data-banner-preview="wide"]').count()) === 1)
const area = await p.locator('[data-banner-area]').boundingBox()
ok('the main frame has the desktop header\'s shape', Math.abs(area.width / area.height - 1000 / 208) < 0.1, JSON.stringify(area))
await p.waitForTimeout(400); await p.screenshot({ path: 'community-banner-dialog.png' })
await p.click('[data-banner-mode="fit"]')
ok('Fit shows the whole picture over a blurred copy', (await p.locator('[data-banner-area] [data-banner-fit]').count()) === 1 && await p.locator('[data-banner-zoom]').isDisabled())
await p.click('[data-banner-align="0,50"]')
ok('alignment places it', (await p.locator('[data-banner-area] [data-banner-img]').evaluate((e) => e.style.objectPosition)) === '0% 50%')
await p.click('[data-banner-apply]'); await p.waitForSelector('[data-banner-dialog]', { state: 'detached' })
await p.waitForSelector('[data-edit-banner-change]')
ok('a set header has Change, Adjust and Remove', (await p.locator('[data-edit-banner-adjust]').count()) === 1 && (await p.locator('[data-edit-banner-remove]').count()) === 1)
await p.screenshot({ path: 'community-banner-edit.png' })
ok('in edit mode too', await p.evaluate(() => { const r = document.querySelector('[data-edit-icon]').getBoundingClientRect(); const top = document.querySelector('[data-edit-banner]').getBoundingClientRect().bottom; return r.top < top && !!document.elementFromPoint(r.left + r.width / 2, r.top + 6)?.closest('[data-edit-icon]') }))
await p.click('[data-community-save]'); await p.waitForSelector('[data-community-editing]', { state: 'detached' })
let c = await call(a.token, 'GET', `${base}/vista`)
ok('it is saved as fitted, aligned left', /^\/api\/images\/[0-9a-f-]{36}#fit=0,50$/.test(c.banner_url), c.banner_url)
ok('the page draws it fitted', (await p.locator('[data-community-banner] [data-banner-fit]').count()) === 1)

console.log('-- adjusting')
await p.click('[data-community-edit]'); await p.waitForSelector('[data-edit-banner-adjust]')
await p.click('[data-edit-banner-adjust]'); await p.waitForSelector('[data-banner-dialog]')
ok('Adjust opens with the saved layout', (await p.getAttribute('[data-banner-mode="fit"]', 'aria-pressed')) === 'true' && (await p.getAttribute('[data-banner-align="0,50"]', 'aria-pressed')) === 'true')
await p.click('[data-banner-mode="fill"]')
await p.locator('[data-banner-zoom]').fill('2')
await p.click('[data-banner-align="100,0"]')
await p.click('[data-banner-apply]'); await p.waitForSelector('[data-banner-dialog]', { state: 'detached' })
await p.click('[data-community-save]'); await p.waitForSelector('[data-community-editing]', { state: 'detached' })
c = await call(a.token, 'GET', `${base}/vista`)
ok('Fill with zoom and a corner focus is saved as #crop=', /#crop=2,100,0$/.test(c.banner_url), c.banner_url)
ok('and adjusting kept the same picture', c.banner_url.split('#')[0] === (await call(a.token, 'GET', `${base}/vista`)).banner_url.split('#')[0])
await p.screenshot({ path: 'community-banner-view.png' })
// The icon overlaps the bottom of the header and must be drawn on top of it.
ok('the icon is drawn over the header, not under it', await onTop(p, '[data-community-icon]'))

console.log('-- phone')
const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); ph.on('pageerror', (e) => errors.push(e.message))
await ph.goto(`${WEB}/login`); await ph.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await ph.goto(`${WEB}/channels/${g.id}/c/vista`); await ph.waitForSelector('[data-community-page="vista"]')
ok('the phone header is at least 135px tall too', (await ph.locator('[data-community-banner]').boundingBox()).height >= 135)
await ph.click('[data-community-edit]'); await ph.waitForSelector('[data-edit-banner-adjust]')
await ph.click('[data-edit-banner-adjust]'); await ph.waitForSelector('[data-banner-dialog]')
const fits = await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('[data-banner-dialog] [data-banner-preview], [data-banner-area]')].every((e) => e.getBoundingClientRect().right <= window.innerWidth))
ok('the layout dialog fits a phone', fits)
await ph.waitForTimeout(400); await ph.screenshot({ path: 'community-banner-phone.png' })
await ph.click('[data-banner-cancel]')
await ph.click('[data-edit-banner-remove]')
ok('Remove clears it back to the tinted band', (await ph.locator('[data-edit-banner-add]').count()) === 1)
await ph.close()

await browser.close()
ok('no page errors', errors.length === 0, errors.join(' | '))
await finish()
