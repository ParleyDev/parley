// Profile cosmetics managed in the admin console: avatar decorations, nameplates, profile effects and profile frames.
// Items with pictures live in the assets folder: adding one writes its files and an entry in that kind's metadata.json,
// editing one rewrites its entry (name, description, an effect's layer timing, a frame's layout and layers) keeping
// every other field, and adds or replaces files; with the folder mounted read-only both fail and say so. Parley's
// own colour and emoji ones, built-ins' names, and turning anything off or deleting it are Parley's alone: an item
// that is off can't be picked and stops showing on every profile at once (the admin previews still show it); deleting
// takes it off everyone, and a deleted folder item keeps its files and can be restored. All of it is audited.
// The files themselves are checked inside the test backend's container; the second backend (PARLEY_API_ORIGIN2) runs
// with the folder mounted read-only.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { B, WEB, S, FIX, call, callS, raw, ok, finish, adminToken, reg, openProfileEditor, testContainer } from '../lib.mjs'

const admin = await adminToken()
const a = await reg('alice'), b = await reg('bob')
const enc = encodeURIComponent
const list = (kind) => call(admin.token, 'GET', `/admin/cosmetics/${kind}`)
const patch = (kind, value, body) => callS(admin.token, 'PATCH', `/admin/cosmetics/${kind}/${enc(value)}`, body)
const me = (u, body) => callS(u.token, 'PATCH', '/users/@me', body)
const DIRS = { decoration: 'avatar-decorations', nameplate: 'nameplates', effect: 'profile-effects', frame: 'profile-frames' }
// A shell in the backend's assets folder (ASSETS_DIR, or ./assets beside it).
let C = null
try { C = testContainer('backend') } catch { /* no container to look in: the API checks still run */ }
const inAssets = (cmd, input) => execFileSync('docker', ['exec', ...(input === undefined ? [] : ['-i']), C, 'sh', '-c', `cd "\${ASSETS_DIR:-./assets}" && ${cmd}`], { input, encoding: 'utf8' })
const ASSETS = !!C
const metaFile = (kind) => `${DIRS[kind]}/metadata.json`
const existsSync = (p) => inAssets(`test -e '${p}' && echo y || true`).trim() === 'y'
const metaOf = (kind) => JSON.parse(inAssets(`cat '${metaFile(kind)}'`))
// Put the folder back as it was afterwards.
const before = ASSETS ? Object.fromEntries(Object.keys(DIRS).map((k) => [k, existsSync(metaFile(k)) ? inAssets(`cat '${metaFile(k)}'`) : null])) : {}
const made = []
const fixture = (...p) => new Blob([readFileSync(join(FIX, ...p))], { type: 'image/png' })
const folderForm = async (method, kind, id, meta, files, origin = B) => {
  const form = new FormData()
  form.append('meta', JSON.stringify(meta))
  for (const [name, blob] of files) form.append('file', blob, name)
  const r = await fetch(`${origin}/admin/cosmetics/${kind}/folder${id ? `/${enc(id)}` : ''}`, { method, headers: { Authorization: `Bearer ${admin.token}` }, body: form })
  return { status: r.status, body: await r.json().catch(() => null) }
}
// (Leftovers from an interrupted run.)
for (const k of Object.keys(DIRS)) for (const it of await list(k)) {
  if (it.source === 'custom' && /^E2E /.test(it.name ?? '')) await raw(admin.token, 'DELETE', `/admin/cosmetics/${k}/${enc(it.value)}`)
  else if (it.source !== 'custom' && (!it.enabled || it.deleted || (it.source === 'builtin' && it.name))) await patch(k, it.value, it.deleted ? { deleted: false } : { enabled: true, ...(it.source === 'builtin' ? { name: '', description: '' } : {}) })
}

console.log('-- Parley\'s own: built-ins, colours and emoji')
ok('only staff manage them', (await raw(a.token, 'GET', '/admin/cosmetics/frame')).status === 403 && (await raw(a.token, 'GET', '/admin/cosmetics-folder')).status === 403)
const frames = await list('frame')
ok('the list has the built-in frames, with how many use each', ['gold', 'neon', 'vines', 'pixel', 'frost', 'ember'].every((v) => frames.some((f) => f.value === v && f.source === 'builtin' && f.enabled && typeof f.users === 'number')))
ok('alice can wear Gilded', (await me(a, { profile_frame: 'gold' })).status === 200)
let r = await patch('frame', 'gold', { enabled: false })
ok('an admin turns Gilded off', r.status === 200 && r.body.enabled === false)
ok('then nobody can pick it', (await me(b, { profile_frame: 'gold' })).status === 400)
ok('every client hears it is off', (await call(b.token, 'GET', '/cosmetics')).some((c) => c.kind === 'frame' && c.value === 'gold' && !c.enabled))
ok('a built-in can be renamed', (await patch('frame', 'neon', { name: 'Electric' })).status === 200 && (await list('frame')).find((f) => f.value === 'neon').name === 'Electric')
ok('but not restyled', (await patch('frame', 'neon', { data: { colors: ['#000000', '#ffffff'] } })).status === 400)
ok('an unknown one is not found', (await patch('frame', 'custom:nope', { enabled: false })).status === 404)
const bad = (kind, data) => raw(admin.token, 'POST', `/admin/cosmetics/${kind}`, { name: `E2E bad ${S}`, data })
ok('colours and emoji are checked; pictures go in the folder', (await bad('frame', { colors: ['red', '#ffffff'] })).status === 400 && (await bad('decoration', { image: '/api/images/x' })).status === 400 && (await bad('effect', { glyph: '' })).status === 400)
const frame = (await callS(admin.token, 'POST', '/admin/cosmetics/frame', { name: `E2E Ring ${S}`, data: { colors: ['#00FF00', '#ff00aa'] } })).body
ok('an admin makes a frame from two colours', frame.value?.startsWith('custom:') && JSON.stringify(frame.data.colors) === '["#00ff00","#ff00aa"]', JSON.stringify(frame))
ok('people can pick it', (await me(b, { profile_frame: frame.value })).status === 200)
const effect = (await callS(admin.token, 'POST', '/admin/cosmetics/effect', { name: `E2E Petals ${S}`, data: { glyph: '🌸', fall: false } })).body
ok('an effect from an emoji, floating up', effect.data?.glyph === '🌸' && effect.data.fall === false && (await me(b, { profile_effect: effect.value })).status === 200)
const plate = (await callS(admin.token, 'POST', '/admin/cosmetics/nameplate', { name: `E2E Sunset ${S}`, data: { colors: ['#ff7700', '#7700ff'] } })).body
ok('a nameplate from two colours', (await me(b, { nameplate: plate.value })).status === 200)
ok('a frame is not a nameplate', (await me(b, { nameplate: frame.value })).status === 400)
r = await patch('effect', effect.value, { name: `E2E Blossoms ${S}`, data: { glyph: '🌼', fall: true } })
ok('a custom one can be edited', r.status === 200 && r.body.name === `E2E Blossoms ${S}` && r.body.data.glyph === '🌼')

console.log('-- the assets folder')
ok('the console knows the folder is writable', (await call(admin.token, 'GET', '/admin/cosmetics-folder')).writable === true)
r = await folderForm('POST', 'decoration', null, { name: `E2E Halo ${S}`, description: 'A test halo' }, [['halo.png', fixture('assets', 'avatar-decorations', 'e2e_ring.png')]])
const halo = r.body?.value
const haloId = halo?.slice(6)
ok('adding a decoration puts its file in the folder', r.status === 201 && halo?.startsWith('asset:') && (await list('decoration')).some((d) => d.value === halo && d.source === 'folder' && d.name === `E2E Halo ${S}`), JSON.stringify(r))
if (ASSETS) {
  made.push(join('avatar-decorations', `${haloId}.png`))
  const m = metaOf('decoration')
  ok('and its entry in metadata.json (made, since that folder had none)', existsSync(join('avatar-decorations', `${haloId}.png`)) && m.items.some((i) => i.file === `${haloId}.png` && i.name === `E2E Halo ${S}` && i.description === 'A test halo'), JSON.stringify(m))
}
ok('everyone can wear it at once', (await me(b, { avatar_decoration: halo })).status === 200 && (await (await fetch(`${B}/assets/avatar-decorations`)).json()).some((d) => d.id === haloId))
r = await folderForm('PATCH', 'decoration', haloId, { name: `E2E Halo Two ${S}` }, [['other.gif', fixture('assets', 'avatar-decorations', 'e2e_pulse.png')]])
ok('editing renames it and replaces its file, keeping its id (and who wears it)', r.status === 200 && (await list('decoration')).find((d) => d.value === halo)?.name === `E2E Halo Two ${S}` && (await call(b.token, 'GET', '/users/@me')).avatar_decoration === halo, JSON.stringify(r))
if (ASSETS) {
  made.push(join('avatar-decorations', `${haloId}.gif`))
  const m = metaOf('decoration')
  ok('metadata.json follows: same entry, new name and file', m.items.filter((i) => i.file?.startsWith(`${haloId}.`)).length === 1 && m.items.some((i) => i.file === `${haloId}.gif` && i.name === `E2E Halo Two ${S}` && i.description === 'A test halo') && !existsSync(join('avatar-decorations', `${haloId}.png`)))
}
ok('file names are checked', (await folderForm('POST', 'decoration', null, { name: 'E2E x' }, [['../evil.png', fixture('pic.png')]])).status === 400 && (await folderForm('POST', 'effect', null, { name: 'E2E x', layers: [{ file: 'a.webm', start_ms: 0, duration_ms: 1, loop: false, loop_delay_ms: 0, z_index: 1 }] }, [])).status === 400)

const layers = [{ file: 'one.png', start_ms: 0, duration_ms: 800, loop: false, loop_delay_ms: 0, z_index: 100 }, { file: 'two.png', start_ms: 400, duration_ms: 600, loop: true, loop_delay_ms: 250, z_index: 101, random_variants: ['two_b.png'] }]
ok('every file a layer names must come along', (await folderForm('POST', 'effect', null, { name: `E2E Missing ${S}`, layers }, [['one.png', fixture('pic.png')]])).status === 400)
const sparkle = (f) => fixture('assets', 'profile-effects', 'e2e_sparkle', f)
r = await folderForm('POST', 'effect', null, { name: `E2E Glitter ${S}`, description: 'Layered test', layers }, [['one.png', sparkle('layer_01.png')], ['two.png', sparkle('layer_02.png')], ['two_b.png', sparkle('layer_02_variant_1.png')], ['thumbnail.png', sparkle('thumbnail.png')]])
const glitter = r.body?.value, glitterId = glitter?.slice(6)
const effects = async () => (await fetch(`${B}/assets/profile-effects?t=${Date.now()}`)).json()
let fx = (await effects()).find((e) => e.id === glitterId)
ok('adding an effect: a folder of layers and its timing', r.status === 201 && fx?.layers.length === 2 && fx.layers[1].loop_delay_ms === 250 && fx.layers[1].random_variants?.[0] === 'two_b.png' && fx.thumbnail === 'thumbnail.png', JSON.stringify(r.body) + JSON.stringify(fx))
if (ASSETS) made.push(join('profile-effects', glitterId))
r = await folderForm('PATCH', 'effect', glitterId, { layers: [{ ...layers[0], duration_ms: 1200 }, { ...layers[1], loop_delay_ms: 900, random_variants: [] }] }, [])
fx = (await effects()).find((e) => e.id === glitterId)
ok('editing its timing', r.status === 200 && fx.layers[0].duration_ms === 1200 && fx.layers[1].loop_delay_ms === 900 && !fx.layers[1].random_variants?.length && fx.name === `E2E Glitter ${S}`, JSON.stringify(fx))
const allNighter = (await list('effect')).find((e) => e.name === 'All Nighter')
if (ASSETS && allNighter) {
  const id = allNighter.value.slice(6)
  await folderForm('PATCH', 'effect', id, { description: 'Edited in the console', layers: allNighter.data.layers.map((l, i) => ({ ...l, start_ms: l.start_ms + (i === 0 ? 10 : 0) })) }, [])
  const entry = metaOf('effect').items.find((i) => i.folder === id)
  ok('fields Parley doesn\'t manage stay as they were (price, shop, key order)', entry.description === 'Edited in the console' && entry.price?.display === 'CA$5.99' && entry.in_shop === true && entry.layers[0].start_ms === 10 && !('width' in entry.layers[0]) && Object.keys(entry).join() === 'folder,name,description,in_shop,match_type,shop_item_id,price,dynamic,layers', JSON.stringify(entry))
  ok('and item_count stays true', metaOf('effect').item_count === metaOf('effect').items.length)
}
const layout = { inner_width: 1200, overflow_top: 100, overflow_bottom: 80, overflow_horizontal: 40 }
r = await folderForm('POST', 'frame', null, { name: `E2E Vines ${S}`, layout, layers: [{ file: 'top.png', order: 'front', type: 'staple', anchor: 'top', responsive: false }] }, [['top.png', fixture('assets', 'profile-frames', 'e2e_frame', 'front_staple_top.png')]])
const vines = r.body?.value, vinesId = vines?.slice(6)
const framesNow = async () => (await fetch(`${B}/assets/profile-frames?t=${Date.now()}`)).json()
ok('adding a frame: its layers and layout', r.status === 201 && (await framesNow()).find((f) => f.id === vinesId)?.layout.overflow_top === 100, JSON.stringify(r.body))
if (ASSETS) made.push(join('profile-frames', vinesId))
r = await folderForm('PATCH', 'frame', vinesId, { layout: { ...layout, overflow_top: 150 }, layers: [{ file: 'top.png', order: 'back', type: 'staple', anchor: 'top', responsive: true }] }, [])
const vf = (await framesNow()).find((f) => f.id === vinesId)
ok('editing its layout and layers', r.status === 200 && vf.layout.overflow_top === 150 && vf.layers[0].order === 'back' && vf.layers[0].responsive === true)
ok('a frame without its layout is refused', (await folderForm('POST', 'frame', null, { name: 'E2E x', layers: [{ file: 'top.png', order: 'front', type: 'staple', anchor: 'top' }] }, [['top.png', fixture('pic.png')]])).status === 400)

if (process.env.PARLEY_API_ORIGIN2) {
  const B2 = `${process.env.PARLEY_API_ORIGIN2}/api`
  const ro = await (await fetch(`${B2}/admin/cosmetics-folder`, { headers: { Authorization: `Bearer ${admin.token}` } })).json()
  r = await folderForm('POST', 'decoration', null, { name: `E2E Nope ${S}` }, [['nope.png', fixture('pic.png')]], B2)
  ok('with the folder mounted read-only: the console is told, and adding fails and says why', ro.writable === false && r.status === 409 && /read-write/.test(r.body?.error ?? ''), JSON.stringify(ro) + JSON.stringify(r))
  ok('so does editing', (await folderForm('PATCH', 'decoration', haloId, { name: 'E2E nope' }, [], B2)).status === 409)
  ok('turning off is Parley\'s, and still works', (await fetch(`${B2}/admin/cosmetics/frame/neon`, { method: 'PATCH', headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) })).status === 200)
  await patch('frame', 'neon', { enabled: true })
}

console.log('-- deleting and turning off folder items: Parley\'s alone')
ok('a folder item\'s name is edited in the folder, not here', (await patch('decoration', halo, { name: 'x' })).status === 400)
r = await raw(admin.token, 'DELETE', `/admin/cosmetics/decoration/${enc(halo)}`)
ok('deleting it hides it and takes it off everyone', r.status === 204 && (await list('decoration')).find((d) => d.value === halo)?.deleted && !(await call(b.token, 'GET', '/users/@me')).avatar_decoration && !(await (await fetch(`${B}/assets/avatar-decorations`)).json()).some((d) => d.id === haloId))
ok('it can\'t be picked', (await me(b, { avatar_decoration: halo })).status === 400)
if (ASSETS) ok('its file and entry stay in the folder', existsSync(join('avatar-decorations', `${haloId}.gif`)) && metaOf('decoration').items.some((i) => i.file === `${haloId}.gif`))
r = await patch('decoration', halo, { deleted: false })
ok('restoring it brings it back', r.status === 200 && (await list('decoration')).find((d) => d.value === halo)?.deleted === false && (await me(b, { avatar_decoration: halo })).status === 200)
ok('built-ins can be deleted (hidden) and restored too', (await raw(admin.token, 'DELETE', '/admin/cosmetics/frame/pixel')).status === 204 && (await list('frame')).find((f) => f.value === 'pixel').deleted && (await patch('frame', 'pixel', { deleted: false })).status === 200)
const audit = await call(admin.token, 'GET', '/admin/audit')
ok('it is all in the audit log', ['cosmetic.create', 'cosmetic.update', 'cosmetic.delete', 'cosmetic.folder_add', 'cosmetic.folder_edit'].every((x) => audit.some((e) => e.action === x)))

console.log('-- on profiles')
const browser = await chromium.launch(); const errors = []
const open = async (u, path = '/channels/@me') => {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token); await p.goto(`${WEB}${path}`); await p.waitForTimeout(1500)
  return p
}
const pb = await open(b)
const shadow = (p, cls, preview = false) => p.evaluate(([cls, preview]) => { const w = document.createElement('div'); if (preview) w.dataset.cosmeticPreview = ''; const d = document.createElement('div'); d.className = cls; w.append(d); document.body.append(w); const s = getComputedStyle(d).boxShadow; w.remove(); return s }, [cls, preview])
const cls = (value) => `pf pf-c-${value.slice(7)}`
ok('a custom frame draws its colours', (await shadow(pb, cls(frame.value))).includes('rgb(0, 255, 0)'))
ok('a frame that is off draws nothing', (await shadow(pb, 'pf pf-gold')) === 'none')
const decoImg = pb.locator(`[data-decoration="${halo}"]`).first()
ok("bob's folder decoration shows on his avatar", await decoImg.isVisible().catch(() => false))
const panelPlate = pb.locator(`[data-panel-nameplate="${plate.value}"]`)
ok('and his colour nameplate behind his name', (await panelPlate.count()) === 1 && /gradient/.test(await panelPlate.evaluate((e) => getComputedStyle(e).backgroundImage)))
await patch('decoration', halo, { enabled: false }); await pb.waitForTimeout(800)
ok('an admin turns his decoration off: gone from his avatar at once', !(await decoImg.isVisible().catch(() => false)))
await patch('frame', frame.value, { enabled: false }); await pb.waitForTimeout(800)
ok('a custom frame that is off draws nothing on profiles', (await shadow(pb, cls(frame.value))) === 'none')
ok('but still in the admin preview', (await shadow(pb, cls(frame.value), true)).includes('rgb(0, 255, 0)'))
await patch('frame', frame.value, { enabled: true }); await patch('decoration', halo, { enabled: true }); await pb.waitForTimeout(800)
ok('back on: shown again', (await shadow(pb, cls(frame.value))).includes('rgb(0, 255, 0)') && await decoImg.isVisible().catch(() => false))

console.log('-- the profile editor')
await openProfileEditor(pb, { section: 'frame' })
await pb.waitForSelector('[data-layered-picker="profile-frames"] [data-layered-option]', { timeout: 5000 }).catch(() => {})
const options = await pb.locator('[data-frame-option]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-frame-option'), e.textContent.trim()]))
ok('the frame picker offers the custom one and the renamed one, not the one that is off', options.some(([v, l]) => v === frame.value && l === `E2E Ring ${S}`) && options.some(([v, l]) => v === 'neon' && l === 'Electric') && !options.some(([v]) => v === 'gold'), JSON.stringify(options))
ok('and the frame just added to the folder', await pb.locator(`[data-layered-picker="profile-frames"] [data-layered-option="${vines}"]`).count() === 1, await pb.locator('[data-layered-option]').evaluateAll((els) => els.map((e) => e.getAttribute('data-layered-option')).join()))
await pb.screenshot({ path: 'cosmetics-editor.png' })

console.log('-- the admin console')
const pa = await open(admin, '/admin/cosmetics')
await pa.waitForSelector('[data-cosmetic-list="decoration"]')
ok('Cosmetics is in the admin console, with the folder items', await pa.locator(`[data-cosmetic-row="${halo}"] [data-cosmetic-source="folder"]`).count() === 1 && await pa.locator('[data-cosmetic-row="gold"]').count() === 1 && await pa.locator('[data-cosmetics-read-only]').count() === 0)
await pa.click('[data-cosmetic-new-folder]'); await pa.fill('[data-cosmetic-name-input]', `E2E From Console ${S}`)
await pa.setInputFiles('[data-cosmetic-file="single"]', join(FIX, 'assets', 'avatar-decorations', 'e2e_ring.png'))
await pa.click('[data-cosmetic-save]'); await pa.waitForTimeout(1000)
const fromConsole = (await list('decoration')).find((d) => d.name === `E2E From Console ${S}`)
ok('adding a decoration from the console writes it to the folder', fromConsole?.source === 'folder' && await pa.locator(`[data-cosmetic-row="${fromConsole.value}"]`).count() === 1, JSON.stringify(fromConsole))
if (ASSETS && fromConsole) made.push(join('avatar-decorations', `${fromConsole.value.slice(6)}.png`))
await pa.click('[data-cosmetic-kind="effect"]'); await pa.waitForSelector(`[data-cosmetic-row="${glitter}"]`)
await pa.click(`[data-cosmetic-edit="${glitter}"]`); await pa.waitForSelector('[data-cosmetic-layer="1"]')
await pa.fill('[data-cosmetic-field="loop_delay_ms-1"]', '1500'); await pa.click('[data-cosmetic-save]'); await pa.waitForTimeout(1000)
ok('editing an effect\'s timing from the console', (await effects()).find((e) => e.id === glitterId)?.layers[1].loop_delay_ms === 1500)
await pa.click('[data-cosmetic-kind="frame"]'); await pa.waitForSelector('[data-cosmetic-list="frame"] [data-cosmetic-row="gold"]')
ok('a built-in that is off shows as off, its preview still drawn', (await pa.getAttribute('[data-cosmetic-row="gold"]', 'data-cosmetic-enabled')) === '0' && (await pa.locator('[data-cosmetic-row="gold"] [data-cosmetic-preview] .pf').evaluate((e) => getComputedStyle(e).boxShadow)) !== 'none')
await pa.click('[data-cosmetic-toggle="gold"]'); await pa.waitForTimeout(600)
ok('turning it back on', (await list('frame')).find((f) => f.value === 'gold').enabled)
pa.once('dialog', (d) => d.accept())
await pa.click(`[data-cosmetic-delete="${vines}"]`); await pa.waitForTimeout(800)
ok('deleting a folder frame hides it from the list', await pa.locator(`[data-cosmetic-row="${vines}"]`).count() === 0)
await pa.click('[data-cosmetic-show-deleted]'); await pa.click(`[data-cosmetic-restore="${vines}"]`); await pa.waitForTimeout(800)
ok('Show deleted lists it, and Restore brings it back', !(await list('frame')).find((f) => f.value === vines).deleted)
await pa.click('[data-cosmetic-kind="effect"]'); await pa.waitForSelector(`[data-cosmetic-row="${glitter}"]`); await pa.waitForTimeout(400)
await pa.screenshot({ path: 'cosmetics-admin.png' })

console.log('-- deleting Parley\'s own')
r = await raw(admin.token, 'DELETE', `/admin/cosmetics/frame/${enc(frame.value)}`)
ok('deleting a custom frame takes it off everyone who had it', r.status === 204 && !(await call(b.token, 'GET', '/users/@me')).profile_frame && !(await list('frame')).some((f) => f.value === frame.value))

for (const [k, v] of [['effect', effect.value], ['nameplate', plate.value]]) await raw(admin.token, 'DELETE', `/admin/cosmetics/${k}/${enc(v)}`)
await patch('frame', 'neon', { name: '' }); await patch('frame', 'gold', { enabled: true })
// The folder as it was: this run's files gone, each metadata.json back to its old text.
if (ASSETS) {
  for (const p of made) inAssets(`rm -rf '${p}'`)
  for (const [k, text] of Object.entries(before)) { if (text === null) inAssets(`rm -f '${metaFile(k)}'`); else inAssets(`cat > '${metaFile(k)}'`, text) }
}
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
