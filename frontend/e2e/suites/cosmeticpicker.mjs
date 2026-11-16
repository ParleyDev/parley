// The profile editor's cosmetic pickers (Discord's "Change Avatar Decoration" and friends): a searchable grid of None,
// the built-in ones and this server's collection, drawn more as it scrolls instead of a Show more button; beside it the
// choice where people see it (a decoration at every size, a nameplate in a member list, an effect or frame on the whole
// card), following the pointer, with its name and description. Apply hands it to the editor; Cancel and Escape don't.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { WEB, B, S, FIX, reg, call, ok, finish, adminToken, testContainer, openProfileEditor } from '../lib.mjs'

const admin = await adminToken()
const a = await reg('alice')
const C = testContainer('backend')
const inAssets = (cmd, input) => execFileSync('docker', ['exec', ...(input === undefined ? [] : ['-i']), C, 'sh', '-c', `cd "\${ASSETS_DIR:-./assets}" && ${cmd}`], { input, encoding: 'utf8' })
const META = 'avatar-decorations/metadata.json'
const hadMeta = inAssets(`test -e '${META}' && echo y || true`).trim() === 'y'
const before = hadMeta ? inAssets(`cat '${META}'`) : null
const n = Date.now() % 1_000_000
const made = []
let restored = false
const restore = () => {
  if (restored) return
  restored = true
  for (const f of made) inAssets(`rm -f 'avatar-decorations/${f}'`)
  if (before === null) inAssets(`rm -f '${META}'`); else inAssets(`cat > '${META}'`, before)
}
process.on('exit', restore)

// A big collection: 70 decorations, so the grid has to draw them as it scrolls.
const png = readFileSync(join(FIX, 'assets', 'avatar-decorations', 'e2e_ring.png'))
for (let i = 0; i < 70; i++) {
  const file = `lazy_${n}_${String(i).padStart(2, '0')}.png`
  const form = new FormData()
  form.append('entry', JSON.stringify({ file, name: `Lazy ${String(i).padStart(2, '0')}`, description: i === 3 ? `The fourth one ${S}` : undefined }))
  form.append('file', new Blob([png], { type: 'image/png' }), file)
  const r = await fetch(`${B}/admin/cosmetics/decoration/import`, { method: 'POST', headers: { Authorization: `Bearer ${admin.token}` }, body: form })
  if (r.ok) made.push(file)
}
ok('the collection is in place', made.length === 70, String(made.length))

const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token); await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('[data-panel-self]')
const lazy = (i) => `[data-decoration-option="asset:lazy_${n}_${String(i).padStart(2, '0')}"]`
const drawn = () => p.locator(`[data-cosmetic-grid] [data-decoration-option^="asset:lazy_${n}_"]`).count()

console.log('-- the decoration picker')
await openProfileEditor(p, { section: 'decoration' })
await p.waitForSelector(`[data-cosmetic-grid] ${lazy(0)}`)
ok('it opens as a dialog with a grid and a preview', await p.locator('[data-cosmetic-picker="decoration"] [data-cosmetic-preview-pane]').count() === 1)
ok('None comes first, then the built-in ones, then the server\'s', (await p.locator('[data-cosmetic-grid] [data-cosmetic-option]').first().getAttribute('data-cosmetic-option')) === 'none' && await p.locator('[data-cosmetic-grid] [data-decoration-option="gold"]').count() === 1)
const first = await drawn()
ok('a long collection is drawn a screenful at a time', first > 0 && first < 70, String(first))
const tileBox = await p.locator(`[data-cosmetic-grid] ${lazy(0)}`).boundingBox()
ok('tiles keep their shape however long the list', tileBox.height > 80, JSON.stringify(tileBox))
ok('with no Show more button', await p.locator('[data-decoration-more], button:has-text("Show more")').count() === 0)
await p.locator('[data-cosmetic-scroll]').evaluate((e) => { e.scrollTop = e.scrollHeight })
await p.waitForFunction((want) => document.querySelectorAll(want).length > 0, `[data-cosmetic-grid] ${lazy(69)}`, { timeout: 5000 }).catch(() => {})
ok('scrolling down draws the rest by itself', await drawn() === 70, String(await drawn()))
await p.locator('[data-cosmetic-scroll]').evaluate((e) => { e.scrollTop = 0 })

console.log('-- previewing and picking')
await p.hover(`[data-cosmetic-grid] ${lazy(3)}`)
ok('hovering previews it beside the grid', (await p.getAttribute('[data-cosmetic-live]', 'data-cosmetic-live')) === `asset:lazy_${n}_03`)
ok('at several sizes', await p.locator('[data-cosmetic-preview-pane] img[data-decoration]').count() >= 4)
ok('with its name and description', (await p.textContent('[data-cosmetic-info]')).includes('Lazy 03') && (await p.textContent('[data-cosmetic-info]')).includes(`The fourth one ${S}`))
await p.mouse.move(5, 5)
ok('leaving the grid shows what is picked again', (await p.getAttribute('[data-cosmetic-live]', 'data-cosmetic-live')) === 'none')
ok('Apply waits for a change', await p.locator('[data-cosmetic-apply]').isDisabled())
await p.click(`[data-cosmetic-grid] ${lazy(3)}`)
await p.waitForTimeout(300); await p.screenshot({ path: 'cosmeticpicker-decoration.png' })
await p.keyboard.press('Escape'); await p.waitForSelector('[data-cosmetic-picker]', { state: 'detached' })
ok('Escape changes nothing', await p.locator('[data-editor-savebar]').count() === 0)
await p.click('[data-editor-section="decoration"]'); await p.waitForSelector(`[data-cosmetic-grid] ${lazy(0)}`)
await p.fill('[data-cosmetic-search]', 'Lazy 65')
ok('search finds one far down the list', await p.locator(`[data-cosmetic-grid] ${lazy(65)}`).count() === 1 && await p.locator('[data-cosmetic-grid] [data-cosmetic-option]').count() === 1)
await p.dblclick(`[data-cosmetic-grid] ${lazy(65)}`); await p.waitForSelector('[data-cosmetic-picker]', { state: 'detached' })
ok('a double click applies it', await p.locator('[data-editor-savebar]').count() === 1)
await p.click('[data-editor-savebar] button:has-text("Save Changes")'); await p.waitForSelector('text=Profile saved')
ok('and Save keeps it', (await call(a.token, 'GET', '/users/@me')).avatar_decoration === `asset:lazy_${n}_65`)
await p.click('[data-editor-section="decoration"]'); await p.waitForSelector('[data-cosmetic-picker]')
await p.waitForSelector(`[data-cosmetic-grid] ${lazy(65)}[aria-pressed="true"]`, { timeout: 5000 }).catch(() => {})
const inView = await p.locator(`[data-cosmetic-grid] ${lazy(65)}`).evaluate((e) => { const g = e.closest('[data-cosmetic-scroll]').getBoundingClientRect(), r = e.getBoundingClientRect(); return r.top >= g.top && r.bottom <= g.bottom }).catch(() => false)
ok('reopening draws far enough to show the current one, scrolled into view', inView)
ok('marked Current', (await p.textContent('[data-cosmetic-info]')).includes('Current'))
await p.click('[data-cosmetic-cancel]')

console.log('-- the other kinds')
for (const [section, live] of [['nameplate', '[data-cosmetic-preview-pane] [data-member-preview], [data-cosmetic-preview-pane] [data-cosmetic-live]'], ['effect', '[data-cosmetic-preview-pane] [data-profile-card]'], ['frame', '[data-cosmetic-preview-pane] [data-profile-card]']]) {
  await p.click(`[data-editor-section="${section}"]`); await p.waitForSelector(`[data-cosmetic-picker="${section}"]`)
  const opt = p.locator('[data-cosmetic-grid] [data-cosmetic-option]:not([data-cosmetic-option="none"])').first()
  await opt.click()
  ok(`${section}: picking one previews it`, await p.locator(live).count() >= 1 && (await p.getAttribute('[data-cosmetic-live]', 'data-cosmetic-live')) === await opt.getAttribute('data-cosmetic-option'))
  await p.waitForTimeout(300); await p.screenshot({ path: `cosmeticpicker-${section}.png` })
  await p.click('[data-cosmetic-cancel]'); await p.waitForSelector('[data-cosmetic-picker]', { state: 'detached' })
}

console.log('-- phone')
const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); ph.on('pageerror', (e) => errors.push(e.message))
await ph.goto(`${WEB}/login`); await ph.evaluate((t) => localStorage.setItem('parley.token', t), a.token); await ph.goto(`${WEB}/channels/@me`)
await openProfileEditor(ph, { section: 'effect' })
const fits = await ph.evaluate(() => { const d = document.querySelector('[data-cosmetic-picker]').getBoundingClientRect(); return d.right <= window.innerWidth + 1 && d.bottom <= window.innerHeight + 1 && document.documentElement.scrollWidth <= window.innerWidth })
ok('the picker fills a phone without spilling over', fits)
ok('and its tiles keep their shape', (await ph.locator('[data-cosmetic-grid] [data-cosmetic-option]').first().boundingBox()).height > 80)
ok('with the preview and the grid both on screen', await ph.locator('[data-cosmetic-preview-pane]').isVisible() && await ph.locator('[data-cosmetic-grid] [data-cosmetic-option]').first().isVisible())
await ph.waitForTimeout(300); await ph.screenshot({ path: 'cosmeticpicker-phone.png' })
await ph.close()

console.log('-- admin console')
const pa = await browser.newPage({ viewport: { width: 1440, height: 900 } }); pa.on('pageerror', (e) => errors.push(e.message))
await pa.goto(`${WEB}/login`); await pa.evaluate((t) => localStorage.setItem('parley.token', t), admin.token); await pa.goto(`${WEB}/admin/cosmetics`)
await pa.waitForSelector(`[data-cosmetic-row="asset:lazy_${n}_00"]`)
const rows = () => pa.locator('[data-cosmetic-list="decoration"] [data-cosmetic-row]').count()
const total = (await call(admin.token, 'GET', '/admin/cosmetics/decoration')).filter((i) => !i.deleted).length
ok('a long list is drawn a page at a time', await rows() < total, `${await rows()} of ${total}`)
for (let i = 0; i < 6 && await rows() < total; i++) { await pa.locator('[data-cosmetic-list] [data-cosmetic-row]').last().scrollIntoViewIfNeeded(); await pa.waitForTimeout(250) }
ok('and the rest as it scrolls, no button', await rows() === total && await pa.locator('button:has-text("Show more"), button:has-text("Load more")').count() === 0, `${await rows()} of ${total}`)
await pa.fill('[data-cosmetic-search]', `fourth one ${S}`)
ok('search finds by description', await rows() === 1 && await pa.locator(`[data-cosmetic-row="asset:lazy_${n}_03"]`).count() === 1)
await pa.click(`[data-cosmetic-preview-open="asset:lazy_${n}_03"]`); await pa.waitForSelector('[data-cosmetic-preview-dialog]')
ok('the preview shows it on the admin\'s own avatar at every size', (await pa.getAttribute('[data-cosmetic-preview-dialog] [data-cosmetic-live]', 'data-cosmetic-live')) === `asset:lazy_${n}_03` && await pa.locator('[data-cosmetic-preview-dialog] img[data-decoration]').count() >= 4)
await pa.waitForTimeout(300); await pa.screenshot({ path: 'cosmeticpicker-admin.png' })
await pa.keyboard.press('Escape'); await pa.waitForSelector('[data-cosmetic-preview-dialog]', { state: 'detached' })
await pa.fill('[data-cosmetic-search]', 'no such thing at all')
ok('nothing matching says so', await pa.locator('[data-cosmetic-empty]').count() === 1)
await pa.close()

await browser.close()
restore()
ok('no page errors', errors.length === 0, errors.join(' | '))
await finish()
