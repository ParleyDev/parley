// Discover → Profile Style: the assets folder's cosmetics with what a shop sync adds (colours, themes, collections,
// variants, bundles) for browsing. Bundles come from bundles.json with Profile Studio's bundles.local.json over it;
// Parley reads both and never writes them, and a metadata.json rewrite keeps the file's own layout.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import { chromium } from 'playwright'
import { WEB, B, reg, call, callS, ok, finish, adminToken, testContainer } from '../lib.mjs'

const admin = await adminToken()
const a = await reg('stylist')
const C = testContainer('backend')
const inAssets = (cmd, input) => execFileSync('docker', ['exec', ...(input === undefined ? [] : ['-i']), C, 'sh', '-c', `cd "\${ASSETS_DIR:-./assets}" && ${cmd}`], { input, encoding: 'utf8' })
const N = Date.now() % 1_000_000
const FILES = ['avatar-decorations/metadata.json', 'nameplates/metadata.json', 'profile-effects/metadata.json', 'profile-frames/metadata.json', 'bundles.json', 'bundles.local.json']
const saved = Object.fromEntries(FILES.map((f) => [f, inAssets(`test -e '${f}' && cat '${f}' || echo __none__`)]))
let restored = false
const restore = () => {
  if (restored) return
  restored = true
  for (const [f, body] of Object.entries(saved)) { if (body === '__none__\n') inAssets(`rm -f '${f}'`); else inAssets(`cat > '${f}'`, body) }
  inAssets(`rm -rf avatar-decorations/*_${N}.png nameplates/sky_${N}.webm profile-effects/rain_${N} profile-frames/vines_${N}`)
}
process.on('exit', restore)

// The items: two variants of one design, a star, a homemade halo (no shop fields), a nameplate, an effect and a frame.
for (const f of [`moon_${N}`, `moonred_${N}`, `star_${N}`, `halo_${N}`]) inAssets(`cp avatar-decorations/e2e_ring.png avatar-decorations/${f}.png`)
inAssets(`cp nameplates/e2e_wave.webm nameplates/sky_${N}.webm && cp -r profile-effects/e2e_sparkle profile-effects/rain_${N} && cp -r profile-frames/e2e_frame profile-frames/vines_${N}`)
const meta = (f) => (saved[f] === '__none__\n' ? { items: [] } : JSON.parse(saved[f]))
const write = (f, v, indent = 1, newline = true) => inAssets(`cat > '${f}'`, JSON.stringify(v, null, indent) + (newline ? '\n' : ''))
const deco = meta(FILES[0])
deco.tag_labels = ['Blue', 'Red', 'White', 'Cute & Cozy', 'Sci-Fi', 'Fantasy']
deco.collections = { ...(deco.collections ?? {}), [`c1_${N}`]: { items: [`moon_${N}.png`] } }
deco.items.push(
  { file: `moon_${N}.png`, name: `Moon ${N}`, description: 'A pale moon.', shop_item_id: `11${N}`, collection_id: `c1_${N}`, base_name: `Moon ${N}`, variant_label: 'Blue', colors: ['blue', 'white'], themes: ['cute_cozy', 'sci_fi'], bundles: [{ id: `b1_${N}`, name: 'Night Bundle' }], tags: ['night'], price: { amount: 5.99 }, in_shop: true },
  { file: `moonred_${N}.png`, name: `Moon ${N}`, description: null, base_name: `Moon ${N}`, variant_label: 'Red', colors: ['red'], themes: 'not a list' },
  { file: `star_${N}.png`, name: `Star ${N}`, shop_item_id: `12${N}`, collection_id: `c2_${N}`, themes: ['fantasy'], bundles: [{ id: `b2_${N}`, name: 'Day Bundle' }] },
  { file: `halo_${N}.png`, name: `Halo ${N}`, tags: ['halo', 'color:Light Blue', 'theme:holiday', 'foo:bar'] },
)
write(FILES[0], deco)
const plates = meta(FILES[1]); plates.items.push({ file: `sky_${N}.webm`, name: `Sky ${N}`, shop_item_id: `21${N}`, palette: 'cobalt', bundles: [{ id: `b1_${N}`, name: 'Night Bundle' }] }); write(FILES[1], plates)
const effects = meta(FILES[2]); const sparkle = effects.items.find((x) => x.folder === 'e2e_sparkle')
effects.items.push({ ...sparkle, folder: `rain_${N}`, name: `Rain ${N}`, shop_item_id: `31${N}`, dynamic: true }); write(FILES[2], effects)
// The frames' file as a sync script writes it: two spaces, no final newline.
const frames = meta(FILES[3]); const frame = frames.items.find((x) => x.folder === 'e2e_frame')
frames.items.push({ ...frame, folder: `vines_${N}`, name: `Vines ${N}` }); if ('item_count' in frames) frames.item_count = frames.items.length
write(FILES[3], frames, 2, false)
const framesText = inAssets(`cat '${FILES[3]}'`)
write('bundles.json', { source: 'test', bundle_count: 3, bundles: [
  { id: `b1_${N}`, name: 'Night Bundle', price: { amount: 10.99 }, owned: false, collection_id: `c1_${N}`, items: [{ shop_item_id: `11${N}`, type: 'avatar_decoration' }, { shop_item_id: `21${N}`, type: 'nameplate' }, { shop_item_id: '99', type: 'profile_frame' }] },
  { id: `b2_${N}`, name: 'Day Bundle', collection_id: `c2_${N}`, items: [{ shop_item_id: `12${N}`, type: 'avatar_decoration' }] },
  { id: `b3_${N}`, name: `Untouched ${N}`, items: [{ shop_item_id: `31${N}`, type: 'profile_effect' }] },
] }, 2)
write('bundles.local.json', { bundles: [
  { id: `b1_${N}`, name: `Night Pack ${N}`, items: [{ shop_item_id: `11${N}`, type: 'avatar_decoration' }, { shop_item_id: `12${N}`, type: 'avatar_decoration' }, { type: 'avatar_decoration', key: `halo_${N}.png` }] },
  { id: `b2_${N}`, deleted: true },
  { id: `local_${N}`, name: `Starter Set ${N}`, items: [{ shop_item_id: `21${N}`, type: 'nameplate' }, { type: 'profile_frame', key: `vines_${N}` }] },
] }, 2)
const bundlesText = inAssets("cat bundles.json bundles.local.json")

console.log('-- reading the folder')
// An admin's no-change edit of the frame rescans it (and keeps the file as it was laid out).
const form = new FormData(); form.append('meta', JSON.stringify({ name: `Vines ${N}` }))
const r = await fetch(`${process.env.PARLEY_API_ORIGIN ?? 'http://localhost:18080'}/api/admin/cosmetics/frame/folder/vines_${N}`, { method: 'PATCH', headers: { Authorization: `Bearer ${admin.token}` }, body: form })
ok('an admin edits a synced item', r.status === 200, String(r.status))
ok('and the file keeps its layout (two spaces, no final newline)', inAssets(`cat '${FILES[3]}'`) === framesText)
let cat = null
for (let i = 0; i < 50; i++) {
  cat = await call(a.token, 'GET', '/cosmetics/explore')
  if (cat?.items?.some((x) => x.value === `asset:moon_${N}`) && cat.items.some((x) => x.value === `asset:sky_${N}`) && cat.items.some((x) => x.value === `asset:rain_${N}`)) break
  await new Promise((res) => setTimeout(res, 2000))
}
const it = (v) => cat.items.find((x) => x.value === `asset:${v}`)
const moon = it(`moon_${N}`)
ok('items carry colours, themes, collection and variant', moon && moon.colors.join() === 'blue,white' && moon.themes.join() === 'cute_cozy,sci_fi' && moon.collection_id === `c1_${N}` && moon.variant_label === 'Blue' && moon.tags?.[0] === 'night', JSON.stringify(moon))
ok('prices stay out of it', !JSON.stringify(cat).includes('10.99') && !('price' in moon))
ok('a null description and a wrong-typed field are fine', it(`moonred_${N}`) && !it(`moonred_${N}`).description && !it(`moonred_${N}`).themes)
ok('theme labels come from tag_labels', cat.labels.cute_cozy === 'Cute & Cozy' && cat.labels.sci_fi === 'Sci-Fi')
const bundle = (id) => cat.bundles.find((b) => b.id === id)
ok('the local file renames and refills a bundle', bundle(`b1_${N}`)?.name === `Night Pack ${N}` && bundle(`b1_${N}`).items.map((x) => x.value).join() === [`asset:moon_${N}`, `asset:star_${N}`, `asset:halo_${N}`].join(), JSON.stringify(bundle(`b1_${N}`)))
const halo = cat.items.find((x) => x.value === `asset:halo_${N}`)
ok('color: and theme: tags give a hand-made item its colours and themes', JSON.stringify(halo?.colors) === '["light_blue"]' && JSON.stringify(halo?.themes) === '["holiday"]' && halo.tags.includes('foo:bar'), JSON.stringify(halo))
ok('keeps the rest from bundles.json', bundle(`b1_${N}`).collection_id === `c1_${N}` && bundle(`b3_${N}`)?.items[0].value === `asset:rain_${N}`)
ok('hides a deleted one, even from its items', !bundle(`b2_${N}`) && !it(`star_${N}`).bundles?.includes(`b2_${N}`))
ok('and adds its own sets', bundle(`local_${N}`)?.items.map((x) => x.kind).join() === 'nameplate,frame')
ok('an item is in the sets that name it', it(`sky_${N}`).bundles.join() === `local_${N}`)
ok('collections are named after their set', cat.collections.find((c) => c.id === `c1_${N}`)?.name === `Night Pack ${N}`)
// Turned off: gone from the catalogue and from every set.
await callS(admin.token, 'PATCH', `/admin/cosmetics/decoration/asset:star_${N}`, { enabled: false })
cat = await call(a.token, 'GET', '/cosmetics/explore')
ok('an item turned off is left out', !it(`star_${N}`) && !bundle(`b1_${N}`).items.some((x) => x.value === `asset:star_${N}`))
await callS(admin.token, 'PATCH', `/admin/cosmetics/decoration/asset:star_${N}`, { enabled: true })
ok('signed-in only', (await callS('nope', 'GET', '/cosmetics/explore')).status === 401)

console.log('-- the page')
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/discover`); await p.click('[data-discover-style]')
await p.waitForSelector('[data-style-page] [data-style-card]')
ok('Discover has Profile Style', p.url().endsWith('/discover/style'))
{
  const pin = await p.evaluate(async () => {
    const h = document.querySelector('[data-style-header]'), sc = h.closest('.overflow-y-auto')
    const pad = document.createElement('div'); pad.style.height = '3000px'; h.parentElement.appendChild(pad)
    sc.scrollTop = 1500; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const r = { after: h.getBoundingClientRect().top, top: sc.getBoundingClientRect().top }
    pad.remove(); sc.scrollTop = 0; return r
  })
  ok('the header stays at the top while scrolling', Math.abs(pin.after - pin.top) <= 1, JSON.stringify(pin))
}
await p.fill('[data-style-search]', `${N}`)
await p.waitForFunction(() => document.querySelectorAll('[data-style-card]').length > 0)
const cards = async () => p.locator('[data-style-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-style-card')))
let shown = await cards()
ok('variants share a card', shown.filter((v) => v.includes('moon')).length === 1 && await p.locator(`[data-style-card*="moon"][data-style-variants="2"]`).count() === 1, shown.join())
await p.click('[data-style-filter-theme="cute_cozy"]')
await p.waitForFunction(() => document.querySelectorAll('[data-style-card]').length === 1)
ok('a theme filters', (await cards()).join().includes('moon'))
await p.click('[data-style-clear]'); await p.fill('[data-style-search]', `${N}`)
await p.click('[data-style-filter-color="red"]')
await p.waitForFunction(() => document.querySelectorAll('[data-style-card]').length === 1)
ok('a colour filters', (await cards())[0] === `asset:moonred_${N}`)
await p.click('[data-style-clear]'); await p.fill('[data-style-search]', '#halo')
await p.waitForFunction(() => document.querySelectorAll('[data-style-card]').length >= 1)
ok('#tag searches tags', (await cards()).includes(`asset:halo_${N}`))
await p.fill('[data-style-search]', `${N}`)
await p.click('[data-style-filter-theme="holiday"]')
await p.waitForFunction(() => document.querySelectorAll('[data-style-card]').length === 1, null, { timeout: 5000 }).catch(() => {})
ok('a theme from a tag is a filter, labelled from its code', (await cards()).join() === `asset:halo_${N}` && (await p.locator('[data-style-filter-theme="holiday"]').textContent()).trim() === 'Holiday', (await cards()).join())
await p.click('[data-style-clear]'); await p.fill('[data-style-search]', `${N}`)
await p.click('[data-style-filter-color="light_blue"]')
await p.waitForFunction(() => document.querySelectorAll('[data-style-card]').length === 1, null, { timeout: 5000 }).catch(() => {})
ok('a colour without a swatch is listed by name and filters', (await cards()).join() === `asset:halo_${N}` && (await p.locator('[data-style-filter-color="light_blue"]').textContent()).trim() === 'Light Blue')
ok('and color:/theme: tags are not in the tag list', await p.locator('[data-style-filter-tag^="color:"], [data-style-filter-tag^="theme:"]').count() === 0 && await p.locator('[data-style-filter-tag="foo:bar"]').count() === 1)
await p.click('[data-style-clear]')
await p.fill('[data-style-search]', `${N}`)
const countIs = (n) => p.waitForFunction((n) => document.querySelector('[data-style-count]')?.getAttribute('data-style-count') === n, n, { timeout: 5000 }).catch(() => {})
const kindsShown = () => p.locator('[data-style-card]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-style-kind')))].sort().join())
await p.click('[data-style-filter-kind="nameplate"]'); await p.click('[data-style-filter-kind="frame"]')
await p.waitForFunction(() => new Set([...document.querySelectorAll('[data-style-card]')].map((e) => e.getAttribute('data-style-kind'))).size === 2, null, { timeout: 5000 }).catch(() => {})
ok('Item Type can tick two kinds together', await kindsShown() === 'frame,nameplate' && !new URL(p.url()).searchParams.get('tab'), await kindsShown())
await p.click('[data-style-filter-kind="nameplate"]'); await p.click('[data-style-filter-kind="frame"]')
await p.click('[data-style-filter-kind="decoration"]')
await countIs('4')
ok('one kind ticked counts its items and is in the link', await p.locator('[data-style-count]').getAttribute('data-style-count') === '4' && new URL(p.url()).searchParams.get('tab') === 'decoration', await p.locator('[data-style-count]').getAttribute('data-style-count'))
ok('cards draw the item over its name', await p.locator('[data-style-card*="moon"] img').count() >= 1 && await p.locator('[data-style-card*="moon"] [data-style-card-name]').count() === 1)
await p.click(`[data-style-card*="moon"]`); await p.waitForSelector('[data-style-dialog]')
await p.click(`[data-style-variant="asset:moonred_${N}"]`)
ok('the dialog switches styles', await p.locator('[data-style-dialog-name]').textContent() === `Moon ${N}` && await p.locator(`[data-style-preview="asset:moonred_${N}"]`).count() === 1)
await p.click(`[data-style-variant="asset:moon_${N}"]`)
await p.click(`[data-style-item-bundle="b1_${N}"] [data-style-try-set]`)
ok('tries on the whole set', await p.locator(`[data-style-preview="set:b1_${N}"] [data-style-set-preview]`).count() === 1)
await p.screenshot({ path: 'profilestyle-dialog.png' })
await p.click('[data-style-wear]')
await p.waitForSelector('[data-style-take-off]')
ok('wears it', (await call(a.token, 'GET', '/users/@me')).avatar_decoration === `asset:moon_${N}`)
await p.click('[data-style-take-off]'); await p.waitForSelector('[data-style-wear]')
ok('and takes it off', (await call(a.token, 'GET', '/users/@me')).avatar_decoration === '')
await p.click(`[data-style-see-collection]`); await p.waitForSelector('[data-style-collection-chip]')
ok('the collection link filters to it', (await cards()).join() === `asset:moon_${N}`)
await p.click('[data-style-collection-chip]')
await p.click('[data-style-tab="bundles"]'); await p.waitForSelector(`[data-style-bundle="local_${N}"]`)
await p.screenshot({ path: 'profilestyle-bundles.png' })
await p.click(`[data-style-bundle="local_${N}"]`); await p.waitForSelector('[data-style-bundle-dialog] [data-style-wear-set]')
await p.click('[data-style-bundle-dialog] [data-style-wear-set]')
let me = null
for (let i = 0; i < 20 && me?.profile_frame !== `asset:vines_${N}`; i++) { await new Promise((res) => setTimeout(res, 250)); me = await call(a.token, 'GET', '/users/@me') }
ok('Wear all puts on the whole set', me.nameplate === `asset:sky_${N}` && me.profile_frame === `asset:vines_${N}`, JSON.stringify([me.nameplate, me.profile_frame]))
await p.keyboard.press('Escape')
await p.click('[data-style-tab="collections"]'); await p.waitForSelector(`[data-style-collection="c1_${N}"]`)
await p.click(`[data-style-collection="c1_${N}"]`); await p.waitForSelector('[data-style-collection-chip]')
await p.waitForFunction(() => document.querySelectorAll('[data-style-card]').length === 1, null, { timeout: 5000 }).catch(() => {})
ok('a collection card opens its items', (await cards()).join() === `asset:moon_${N}`, (await cards()).join())
// Phones: filters fold away.
const ph = await browser.newPage({ viewport: { width: 390, height: 844 } }); ph.on('pageerror', (e) => errors.push(e.message))
await ph.goto(`${WEB}/login`); await ph.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await ph.goto(`${WEB}/discover/style`); await ph.waitForSelector('[data-style-card]')
ok('on a phone the filters start folded', await ph.locator('[data-style-filters]').count() === 0)
ok('and nothing scrolls sideways', await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await ph.locator('[data-style-page] button[title="Channels"]').click()
await ph.waitForFunction(() => { const l = document.querySelector('[data-discover-style]'); return !!l && l.getBoundingClientRect().width > 0 }, null, { timeout: 5000 }).catch(() => {})
ok('on a phone, back leads out to the Discover menu', await ph.locator('[data-discover-style]').isVisible())
await ph.click('[data-discover-style]'); await ph.waitForSelector('[data-style-card]')
// The header stays put while the grid scrolls (a scroller made long enough to scroll, whatever the fixture holds).
const pinned = async (pg) => pg.evaluate(async () => {
  const h = document.querySelector('[data-style-header]'), sc = h.closest('.overflow-y-auto')
  const pad = document.createElement('div'); pad.style.height = '3000px'; h.parentElement.appendChild(pad)
  const before = h.getBoundingClientRect().top
  sc.scrollTop = 1500; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const after = h.getBoundingClientRect().top, top = sc.getBoundingClientRect().top
  pad.remove(); sc.scrollTop = 0
  return { before, after, top, scrolled: sc.scrollTop === 0 }
})
let pin = await pinned(ph)
ok('on a phone the header stays at the top while scrolling', Math.abs(pin.after - pin.top) <= 1 && pin.before <= pin.top + 1, JSON.stringify(pin))
ok('and is two rows: back, title and filters, then search and sort', await ph.evaluate(() => { const h = document.querySelector('[data-style-header]').getBoundingClientRect(); return h.height < 120 }), String(await ph.evaluate(() => document.querySelector('[data-style-header]').getBoundingClientRect().height)))
await ph.screenshot({ path: 'profilestyle-phone.png' })
await ph.click('[data-style-toggle-filters]'); await ph.waitForSelector('[data-style-filters]')
const sheet = await ph.locator('[data-style-filters]').boundingBox()
ok('opened, they fill the screen', sheet && sheet.width >= 389 && sheet.height >= 820, JSON.stringify(sheet))
await ph.screenshot({ path: 'profilestyle-phone-filters.png' })
await ph.click('[data-style-filters-done]')
ok('and Show folds them away again', await ph.locator('[data-style-filters]').count() === 0)
// A phone's status bar (the app's WebView reports it as --safe-area-inset-top): the dialog's close button stays below it.
await ph.evaluate(() => document.documentElement.style.setProperty('--safe-area-inset-top', '47px'))
await ph.click('[data-style-card]'); await ph.waitForSelector('[data-style-dialog]')
const closeBox = await ph.locator('[data-style-close]').boundingBox()
await ph.screenshot({ path: 'profilestyle-phone-dialog.png' })
ok('on a phone the dialog\'s close button sits below the status bar', closeBox && closeBox.y >= 47 && closeBox.height >= 40, JSON.stringify(closeBox))
await ph.click('[data-style-close]')
ok('and closes it', await ph.locator('[data-style-dialog]').count() === 0)
await browser.close()

console.log('-- never written')
ok('bundles.json and bundles.local.json are untouched', inAssets('cat bundles.json bundles.local.json') === bundlesText)

console.log('-- assistants (MCP)')
const asm = await (await fetch(`${WEB}/.well-known/oauth-authorization-server`)).json()
const local = (u) => u.replace(/^https?:\/\/[^/]+/, WEB)
const prm = await (await fetch(`${WEB}/.well-known/oauth-protected-resource/mcp`)).json()
const redirect = 'http://localhost:7777/callback'
const grant = async (who, scopes) => {
  const client = await (await fetch(local(asm.registration_endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: `Style ${N}`, redirect_uris: [redirect], token_endpoint_auth_method: 'none' }) })).json()
  const v = crypto.randomBytes(32).toString('base64url'), ch = crypto.createHash('sha256').update(v).digest('base64url')
  const g = await call(who.token, 'POST', '/mcp/consent', { response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: ch, code_challenge_method: 'S256', resource: prm.resource, scope: scopes.join(' '), approve: true, scopes })
  return (await (await fetch(local(asm.token_endpoint), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: new URL(g.redirect).searchParams.get('code'), redirect_uri: redirect, client_id: client.client_id, code_verifier: v, resource: prm.resource }) })).json()).access_token
}
let rid = 0
const tool = async (tok, name, args = {}) => {
  const res = await fetch(`${WEB}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${tok}`, 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: name === '@list' ? 'tools/list' : 'tools/call', params: name === '@list' ? {} : { name, arguments: args } }) })
  const body = await res.json(); if (name === '@list') return body.result?.tools?.map((x) => x.name) ?? []
  const c = body.result; let json = null; try { json = JSON.parse(c?.content?.[0]?.text) } catch { /* text */ }
  return { error: !!c?.isError, text: c?.content?.[0]?.text ?? '', json }
}
const readTok = await grant(a, ['mcp.read'])
const wearTok = await grant(a, ['mcp.read', 'mcp.profile'])
const readTools = await tool(readTok, '@list'), wearTools = await tool(wearTok, '@list')
ok('browsing comes with Read, wearing with Profile style', readTools.includes('browse_profile_style') && !readTools.includes('wear_profile_items') && wearTools.includes('wear_profile_items'))
let t = await tool(readTok, 'browse_profile_style', { query: `${N}`, theme: 'cute_cozy' })
ok('an assistant browses by theme', t.json?.results?.length === 1 && t.json.results[0].value === `asset:moon_${N}`, t.text)
t = await tool(readTok, 'browse_profile_style', { query: '#halo', kind: 'decoration' })
ok('and by #tag', t.json?.results?.some((x) => x.value === `asset:halo_${N}`), t.text)
t = await tool(readTok, 'browse_profile_style', { show: 'bundles' })
ok('lists sets with their items named', t.json?.results?.find((b) => b.id === `local_${N}`)?.items?.some((x) => x.name === `Sky ${N}`), t.text.slice(0, 300))
t = await tool(wearTok, 'wear_profile_items', { bundle_id: `local_${N}`, values: [`asset:moon_${N}`] })
me = await call(a.token, 'GET', '/users/@me')
ok('wears a set and an item', !t.error && me.nameplate === `asset:sky_${N}` && me.profile_frame === `asset:vines_${N}` && me.avatar_decoration === `asset:moon_${N}`, t.text)
t = await tool(wearTok, 'browse_profile_style', { query: `moon ${N}` })
ok('and says what is worn', t.json?.results?.find((x) => x.value === `asset:moon_${N}`)?.wearing === true)
t = await tool(wearTok, 'wear_profile_items', { take_off: ['decoration', 'nameplate', 'frame'] })
me = await call(a.token, 'GET', '/users/@me')
ok('takes things off', !t.error && !me.avatar_decoration && !me.nameplate && !me.profile_frame, t.text)
t = await tool(wearTok, 'wear_profile_items', { values: ['asset:nope'] })
ok('refuses what does not exist', t.error)
// The wear token can change only what's worn: not the rest of the profile.
const wearH = { Authorization: `Bearer ${wearTok}`, 'Content-Type': 'application/json' }
ok('an mcp.profile token can\'t edit the rest of the profile', (await fetch(`${B}/users/@me`, { method: 'PATCH', headers: wearH, body: JSON.stringify({ bio: 'x' }) })).status === 403)
ok('and the endpoint takes only the four', (await fetch(`${B}/users/@me/cosmetics`, { method: 'PATCH', headers: wearH, body: JSON.stringify({ bio: 'x' }) })).status === 400)

console.log('-- Profile Studio sync')
const sTok = await grant(admin, ['cosmetics.manage'])
const sH = { Authorization: `Bearer ${sTok}`, 'Content-Type': 'application/json' }
const sreq = async (m, path, body, extra = {}) => { const res = await fetch(`${B}${path}`, { method: m, headers: { ...sH, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await res.json() } catch { /* empty */ } return { status: res.status, body: j } }
let sr = await sreq('GET', '/admin/cosmetics/bundles')
const etag = sr.body?.files?.['bundles.local.json']?.etag
ok('reads both bundle files with etags', sr.status === 200 && sr.body.files['bundles.json'].json.bundles.length === 3 && /^[0-9a-f]{64}$/.test(etag ?? ''), JSON.stringify(sr.body).slice(0, 200))
const nextLocal = { bundles: [{ id: `local_${N}`, name: `Starter Set ${N}`, items: [{ type: 'nameplate', shop_item_id: `21${N}` }], extra: { kept: true } }] }
sr = await sreq('PUT', '/admin/cosmetics/bundles/bundles.local.json', nextLocal, { 'If-Match': '"0000"' })
ok('a stale etag is refused with the current file', sr.status === 412 && sr.body?.etag === etag)
sr = await sreq('PUT', '/admin/cosmetics/bundles/bundles.local.json', { bundles: [{ name: 'no id' }] }, { 'If-Match': `"${etag}"` })
ok('a bundle needs an id', sr.status === 400)
ok('only the two bundle files', (await sreq('PUT', '/admin/cosmetics/bundles/other.json', nextLocal)).status === 404)
sr = await sreq('PUT', '/admin/cosmetics/bundles/bundles.local.json', nextLocal, { 'If-Match': `"${etag}"` })
const written = inAssets('cat bundles.local.json')
ok('writes it, keeping its layout and every field', sr.status === 200 && written === JSON.stringify(nextLocal, null, 2) + '\n' && sr.body.etag === crypto.createHash('sha256').update(written).digest('hex'), written.slice(0, 120))
cat = await call(a.token, 'GET', '/cosmetics/explore')
ok('Discover follows at once (the overlay is gone, b2 is back)', !!bundle(`b2_${N}`) && bundle(`b1_${N}`)?.name === 'Night Bundle' && bundle(`local_${N}`)?.items.length === 1)
ok('creating needs If-None-Match: * to be honest', (await sreq('PUT', '/admin/cosmetics/bundles/bundles.local.json', nextLocal, { 'If-None-Match': '*' })).status === 412)
sr = await sreq('DELETE', '/admin/cosmetics/bundles/bundles.local.json', undefined, { 'If-Match': `"${crypto.createHash('sha256').update(written).digest('hex')}"` })
ok('and deletes it', sr.status === 204 && inAssets('test -e bundles.local.json && echo y || echo n').trim() === 'n')
// Entries: the admin list carries them whole, and fields set what Parley doesn't manage.
const list = (await sreq('GET', '/admin/cosmetics/decoration')).body
const moonRow = list.find((x) => x.value === `asset:moon_${N}`)
ok('the admin list carries each folder entry whole', moonRow?.entry?.shop_item_id === `11${N}` && moonRow.entry.price?.amount === 5.99 && Array.isArray(list.find((x) => x.value === `asset:halo_${N}`)?.tags))
const ff = new FormData(); ff.append('meta', JSON.stringify({ fields: { colors: ['green'], collection_id: `c3_${N}`, price: null } }))
const fr = await fetch(`${B}/admin/cosmetics/decoration/folder/moon_${N}`, { method: 'PATCH', headers: { Authorization: `Bearer ${sTok}` }, body: ff })
const decoNow = JSON.parse(inAssets(`cat '${FILES[0]}'`))
const moonNow = decoNow.items.find((x) => x.file === `moon_${N}.png`)
ok('fields set and remove entry keys', fr.status === 200 && moonNow.colors.join() === 'green' && !('price' in moonNow) && moonNow.shop_item_id === `11${N}`, JSON.stringify(moonNow))
ok('and collections follow the entries', JSON.stringify(decoNow.collections[`c3_${N}`]) === JSON.stringify({ items: [`moon_${N}.png`] }) && !decoNow.collections[`c1_${N}`])
const bf = new FormData(); bf.append('meta', JSON.stringify({ fields: { layers: [] } }))
ok('fields can\'t touch what Parley manages', (await fetch(`${B}/admin/cosmetics/decoration/folder/moon_${N}`, { method: 'PATCH', headers: { Authorization: `Bearer ${sTok}` }, body: bf })).status === 400)
// Top-level fields.
sr = await sreq('GET', '/admin/cosmetics/frame/metadata')
ok('reads a kind\'s top-level fields', sr.status === 200 && !('items' in sr.body.fields) && sr.body.etag === crypto.createHash('sha256').update(inAssets(`cat '${FILES[3]}'`)).digest('hex'))
const fe = sr.body.etag
ok('a stale etag is refused', (await sreq('PATCH', '/admin/cosmetics/frame/metadata', { fields: { tag_labels: ['Green'] } }, { 'If-Match': '"0"' })).status === 412)
ok('items are refused', (await sreq('PATCH', '/admin/cosmetics/frame/metadata', { fields: { items: [] } }, { 'If-Match': `"${fe}"` })).status === 400)
sr = await sreq('PATCH', '/admin/cosmetics/frame/metadata', { fields: { tag_labels: ['Green'], source: null } }, { 'If-Match': `"${fe}"` })
const framesNow = inAssets(`cat '${FILES[3]}'`)
ok('sets and removes them, keeping the layout', sr.status === 200 && JSON.parse(framesNow).tag_labels.join() === 'Green' && !('source' in JSON.parse(framesNow)) && framesNow.startsWith('{\n  "') && !framesNow.endsWith('\n'), framesNow.slice(0, 80))
const spec = await (await fetch(`${B}/v1/openapi.json`)).json()
ok('the API reference documents them', !!spec.paths['/admin/cosmetics/bundles/{file}']?.put && !!spec.paths['/admin/cosmetics/{kind}/metadata']?.patch && !!spec.paths['/cosmetics/explore']?.get && JSON.stringify(spec.paths['/users/@me/cosmetics']?.patch?.security ?? '').includes('mcp.profile'))

await call(a.token, 'PATCH', '/users/@me/cosmetics', { nameplate: '', profile_frame: '', avatar_decoration: '' })
restore()
ok('no page errors', errors.length === 0, errors.join(' | '))
await finish()
