// Colour themes: the 22 seeded ones (Discord's, by name), managed in the admin console (create, rename, disable,
// reorder, delete; built-ins can't be deleted; all audited) and pushed to every client live. Users pick one in
// Appearance (free), preview it (Apply / Exit), build their own, keep it per device, follow a server's theme or keep
// their own; high contrast falls back to the base. The accessibility switches (name styles, on/off indicators, sync
// contrast) and the browser theme-color follow. Every seeded theme is rendered and its text checked against the actual
// pixels behind it (WCAG AA, 4.5:1).
import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import { WEB, S, reg, call, callS, raw, ok, finish, adminToken, openDms } from '../lib.mjs'

const admin = await adminToken()
const a = await reg('alice'), b = await reg('bob')
await openDms(a, b)
const DISCORD = ['Mint Apple', 'Citrus Sherbert', 'Retro Raincloud', 'Hanami', 'Sunrise', 'Cotton Candy', 'LoFi Vibes', 'Desert Khaki', 'Sunset', 'Chroma Glow', 'Forest', 'Crimson Moon', 'Midnight Blurple', 'Mars', 'Dusk', 'Under the Sea', 'Retro Storm', 'Neon Nights', 'Strawberry Lemonade', 'Aurora', 'Sepia', 'Blurple Twilight']

console.log('-- API')
let themes = await call(a.token, 'GET', '/themes')
// (Leftovers from an interrupted run aside.)
for (const t of (await call(admin.token, 'GET', '/admin/themes')).filter((x) => !x.builtin && /Ocean/.test(x.name))) await raw(admin.token, 'DELETE', `/admin/themes/${t.id}`)
themes = await call(a.token, 'GET', '/themes')
ok("the 22 of Discord's colour themes are seeded, in Discord's order", JSON.stringify(themes.filter((t) => t.builtin).map((t) => t.name)) === JSON.stringify(DISCORD), JSON.stringify(themes.map((t) => t.name)))
const mint = themes.find((t) => t.slug === 'mint-apple')
ok('each with its base, angle, midpoint and stops', mint.base === 'light' && mint.angle === 180 && mint.midpoint === 27 && mint.stops.length === 3 && mint.stops[0].color === '#56b69f' && mint.builtin)
ok('only staff manage them', (await raw(a.token, 'GET', '/admin/themes')).status === 403 && (await raw(a.token, 'POST', '/admin/themes', { name: 'x', base: 'dark', angle: 0, midpoint: 50, stops: [] })).status === 403)
const bad = (body) => raw(admin.token, 'POST', '/admin/themes', { name: `T${S}`, base: 'dark', angle: 90, midpoint: 50, stops: [{ color: '#112233', pos: 0 }, { color: '#445566', pos: 100 }], ...body })
ok('a theme needs 2 to 5 colours, #rrggbb, a light or dark base, angle 0-360', (await bad({ stops: [{ color: '#112233', pos: 0 }] })).status === 400 && (await bad({ stops: [{ color: 'red', pos: 0 }, { color: '#445566', pos: 100 }] })).status === 400 && (await bad({ base: 'grey' })).status === 400 && (await bad({ angle: 400 })).status === 400)
let r = await callS(admin.token, 'POST', '/admin/themes', { name: `Ocean ${S}`, base: 'dark', angle: 120, midpoint: 40, stops: [{ color: '#0b3d91', pos: 10 }, { color: '#1fa2ff', pos: 90 }] })
const mine = r.body
ok('staff create one', r.status === 201 && mine.slug === `ocean-${S}` && !mine.builtin)
r = await callS(admin.token, 'PATCH', `/admin/themes/${mine.id}`, { name: `Deep Ocean ${S}` })
ok('rename it (the slug stays)', r.status === 200 && r.body.name === `Deep Ocean ${S}` && r.body.slug === `ocean-${S}`)
ok('built-in themes cannot be deleted', (await raw(admin.token, 'DELETE', `/admin/themes/${mint.id}`)).status === 400)
const all = await call(admin.token, 'GET', '/admin/themes')
await call(admin.token, 'PUT', '/admin/themes/order', { ids: [mine.id, ...all.filter((t) => t.id !== mine.id).map((t) => t.id)] })
ok('reordered: it comes first', (await call(a.token, 'GET', '/themes'))[0].id === mine.id)
const audit = await call(admin.token, 'GET', '/admin/audit')
ok('every change is in the audit log', ['theme.create', 'theme.update', 'theme.reorder'].every((x) => audit.some((e) => e.action === x)))

const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } })
const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
const htmlTheme = () => p.evaluate(() => ({ key: document.documentElement.dataset.colorTheme ?? null, base: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundImage, meta: document.querySelector('meta[name="theme-color"]')?.content }))

console.log('-- picking, previewing, building')
await p.goto(`${WEB}/channels/@me`); await p.waitForTimeout(800)
await p.click('[data-user-panel] [data-control="User Settings"]'); await p.click('[data-settings-window] button:has-text("Appearance")'); await p.waitForSelector('[data-color-themes]')
ok('Appearance lists every enabled theme, free', await p.locator('[data-color-theme-pick]').count() === themes.length + 1)
ok('and the default themes: Light, Ash, Dark, Onyx', (await p.locator('[data-default-theme]').evaluateAll((els) => els.map((e) => e.dataset.defaultTheme))).join() === 'light,ash,default,onyx,midnight')
await p.click(`[data-color-theme-pick="${mint.id}"]`); await p.waitForTimeout(300)
let h = await htmlTheme()
ok('picking Mint Apple paints its gradient on a light base', h.key === mint.id && h.base === 'light' && /linear-gradient\((180deg, )?rgb\(86, 182, 159\)/.test(h.bg), JSON.stringify(h))
ok('and the browser theme-color follows', /^#[0-9a-f]{6}$/.test(h.meta) && h.meta !== '#0b0c10', h.meta)
const crimson = themes.find((t) => t.slug === 'crimson-moon')
await p.hover(`[data-color-theme-option="crimson-moon"]`); await p.click(`[data-color-theme-preview="${crimson.id}"]`); await p.waitForSelector('[data-theme-preview-bar]')
h = await htmlTheme()
ok('Preview Theme tries one on (dark base) with an Apply / Exit Preview bar', h.key === 'preview' && h.base === 'dark' && (await p.locator('[data-theme-preview-bar]').innerText()).includes('Crimson Moon'))
await p.click('[data-theme-preview-exit]'); await p.waitForTimeout(200)
ok('Exit Preview goes back to Mint Apple', (await htmlTheme()).key === mint.id)
await p.hover(`[data-color-theme-option="crimson-moon"]`); await p.click(`[data-color-theme-preview="${crimson.id}"]`); await p.click("[data-theme-preview-apply]"); await p.waitForTimeout(200)
ok('Apply keeps it', (await htmlTheme()).key === crimson.id)
await p.click('[data-custom-theme-open]'); await p.waitForSelector('[data-custom-theme-builder] [data-theme-editor]')
await p.fill('[data-custom-theme-builder] [data-theme-angle]', '33'); await p.click('[data-custom-theme-builder] [data-theme-add-stop]'); await p.click('[data-custom-theme-use]'); await p.waitForTimeout(200)
h = await htmlTheme()
ok('a custom theme of your own (3 colours at 33°) is free too', h.key === 'custom' && /linear-gradient\(33deg/.test(h.bg) && (h.bg.match(/rgb/g) ?? []).length === 3, h.bg)
await p.click(`[data-color-theme-pick="${mint.id}"]`); await p.keyboard.press('Escape'); await p.waitForTimeout(300)
await p.reload(); await p.waitForTimeout(1200)
ok('the choice survives a reload', (await htmlTheme()).key === mint.id)

console.log('-- live updates')
await call(admin.token, 'PATCH', `/admin/themes/${mint.id}`, { enabled: false }); await p.waitForTimeout(800)
h = await htmlTheme()
ok('staff disabling the theme you use: you fall back to the plain base at once', h.key === null && (await p.evaluate(() => getComputedStyle(document.body).backgroundImage)) === 'none', JSON.stringify(h))
await call(admin.token, 'PATCH', `/admin/themes/${mint.id}`, { enabled: true }); await p.waitForTimeout(800)
ok('and get it back when it returns', (await htmlTheme()).key === mint.id)

console.log('-- servers')
const g = await call(b.token, 'POST', '/guilds', { name: `Themed ${S}` }); const tc = g.channels.find((c) => c.kind === 'text')
await call(a.token, 'POST', `/invites/${(await call(b.token, 'POST', `/guilds/${g.id}/invites`, {})).code}`)
ok('a server theme must be a known theme or a valid gradient', (await raw(b.token, 'PATCH', `/guilds/${g.id}`, { theme: { id: crypto.randomUUID() } })).status === 400 && (await raw(b.token, 'PATCH', `/guilds/${g.id}`, { theme: { custom: { base: 'dark', angle: 1, midpoint: 1, stops: [] } } })).status === 400)
r = await callS(b.token, 'PATCH', `/guilds/${g.id}`, { theme: { id: crimson.id } })
ok('the owner sets one', r.status === 200 && r.body.theme?.id === crimson.id)
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('.msg-content, [data-message-list]'); await p.waitForTimeout(800)
ok("inside the server you see its theme", (await htmlTheme()).key === 'server' && (await htmlTheme()).base === 'dark')
await p.goto(`${WEB}/channels/@me`); await p.waitForTimeout(600)
ok('and your own again outside it', (await htmlTheme()).key === mint.id)
await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('parley.appearance') ?? '{}'); v.serverThemes = 'mine'; localStorage.setItem('parley.appearance', JSON.stringify(v)) })
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForTimeout(1000)
ok("with 'use mine' you keep yours in the server too", (await htmlTheme()).key === mint.id)

console.log('-- accessibility')
await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('parley.appearance') ?? '{}'); v.highContrast = true; v.serverThemes = 'server'; localStorage.setItem('parley.appearance', JSON.stringify(v)) })
await p.reload(); await p.waitForTimeout(800)
ok('high contrast shows the plain base instead of a gradient', (await htmlTheme()).key === null)
await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('parley.appearance') ?? '{}'); v.highContrast = false; v.syncContrast = true; localStorage.setItem('parley.appearance', JSON.stringify(v)) })
await p.emulateMedia({ contrast: 'more' }); await p.reload(); await p.waitForTimeout(800)
ok('Sync contrast settings follows the device asking for more contrast', await p.evaluate(() => document.documentElement.dataset.contrast) === 'high')
await p.emulateMedia({ contrast: 'no-preference' }); await p.reload(); await p.waitForTimeout(600)
ok('(and lets go when it stops)', await p.evaluate(() => document.documentElement.dataset.contrast) === 'normal')
await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('parley.prefs') ?? '{}'); v.toggleIndicators = true; v.nameStyles = false; localStorage.setItem('parley.prefs', JSON.stringify(v)) })
await call(b.token, 'PATCH', '/users/@me', { name_style: { font: 'script', effect: 'gradient', colors: ['#ff0000', '#00ff00'] } })
await p.reload(); await p.waitForTimeout(1000)
await p.click('[data-user-panel] [data-control="User Settings"]'); await p.click('[data-settings-window] button:has-text("Accessibility")'); await p.waitForSelector('[data-name-styles-row]')
ok('Show on/off indicators puts a check or cross in every switch', await p.locator('[data-settings-window] .toggle-icon').first().isVisible())
await p.keyboard.press('Escape'); await p.waitForTimeout(300)
const nameFont = await p.locator(`[data-member-list] .nf-script, [data-msg-author] .nf-script`).first().evaluate((e) => getComputedStyle(e).webkitTextFillColor).catch(() => 'none')
ok('Enable display name styles off: names show plainly', !/rgba\(0, 0, 0, 0\)|transparent/.test(nameFont), nameFont)
await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('parley.prefs') ?? '{}'); v.toggleIndicators = false; v.nameStyles = true; localStorage.setItem('parley.prefs', JSON.stringify(v)) })

console.log('-- every theme: text against the pixels behind it')
const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
const ratio = (x, y) => { const [m, n] = [lum(x), lum(y)].sort((s, t) => t - s); return (m + 0.05) / (n + 0.05) }
await call(b.token, 'POST', `/channels/${tc.id}/messages`, { content: `checking contrast ${S}` })
await call(b.token, 'PATCH', `/guilds/${g.id}`, { theme: null })
const fails = []; let measured = 0
const SAMPLES = [['.msg-content', 'message text'], ['[data-member-list] h3', 'member list heading'], ['[data-channel-item] a', 'channel name'], ['[data-msg-header] span.text-text-2, [data-msg-id] .text-text-2', 'timestamp']]
for (const th of themes.filter((t) => t.builtin)) {
  await p.evaluate((id) => { const v = JSON.parse(localStorage.getItem('parley.appearance') ?? '{}'); v.colorTheme = id; v.syncContrast = false; localStorage.setItem('parley.appearance', JSON.stringify(v)) }, th.id)
  await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector(`text=checking contrast ${S}`); await p.waitForTimeout(500)
  for (const [sel, what] of SAMPLES) {
    const el = p.locator(sel).first(); if (!(await el.count())) continue
    const box = await el.boundingBox(); if (!box || box.width < 4) continue
    const color = (await el.evaluate((e) => getComputedStyle(e).color)).match(/\d+/g).slice(0, 3).map(Number)
    const png = PNG.sync.read(await p.screenshot({ clip: { x: box.x, y: box.y, width: Math.min(box.width, 300), height: box.height } }))
    // The background is the commonest colour in the box (text covers far less of it).
    const counts = new Map(); for (let i = 0; i < png.data.length; i += 4) { const k = `${png.data[i] >> 2},${png.data[i + 1] >> 2},${png.data[i + 2] >> 2}`; counts.set(k, (counts.get(k) ?? 0) + 1) }
    const bg = [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0].split(',').map((v) => Number(v) * 4 + 2)
    const c = ratio(color, bg); measured++
    if (c < 4.5) fails.push(`${th.name}: ${what} ${c.toFixed(2)}:1`)
  }
}
ok(`every seeded theme keeps its text at WCAG AA (4.5:1) against what is really behind it (${measured} samples)`, fails.length === 0 && measured >= 22 * 3, fails.join('; '))

await call(admin.token, 'DELETE', `/admin/themes/${mine.id}`)
ok('a theme staff made can be deleted', !(await call(a.token, 'GET', '/themes')).some((t) => t.id === mine.id))
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
