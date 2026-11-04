// Profile cosmetics managed in the admin console: avatar decorations, nameplates, profile effects and profile frames.
// Built-in ones can be renamed and turned off (not deleted); admins make their own from a picture, colours or an
// emoji, edit and delete them (deleting takes one off everyone who had it). A cosmetic that is off can't be picked and
// stops showing on every profile at once; the admin previews still show it. All of it is audited.
import { chromium } from 'playwright'
import { API_ORIGIN, WEB, S, reg, call, callS, raw, ok, finish, adminToken, pngFile, multi, openProfileEditor } from '../lib.mjs'

const admin = await adminToken()
const a = await reg('alice'), b = await reg('bob')
const enc = encodeURIComponent
const list = (kind) => call(admin.token, 'GET', `/admin/cosmetics/${kind}`)
const patch = (kind, value, body) => callS(admin.token, 'PATCH', `/admin/cosmetics/${kind}/${enc(value)}`, body)
const me = (u, body) => callS(u.token, 'PATCH', '/users/@me', body)
// (Leftovers from an interrupted run.)
for (const k of ['decoration', 'nameplate', 'effect', 'frame']) for (const it of await list(k)) {
  if (it.source === 'custom' && /^E2E /.test(it.name ?? '')) await raw(admin.token, 'DELETE', `/admin/cosmetics/${k}/${enc(it.value)}`)
  else if (it.source !== 'custom' && (!it.enabled || it.name)) await patch(k, it.value, { enabled: true, name: '', description: '' })
}

console.log('-- API')
ok('only staff manage them', (await raw(a.token, 'GET', '/admin/cosmetics/frame')).status === 403 && (await raw(a.token, 'POST', '/admin/cosmetics/frame', { name: 'x', data: { colors: ['#000000', '#ffffff'] } })).status === 403)
let frames = await list('frame')
ok('the list has the built-in frames, with how many use each', ['gold', 'neon', 'vines', 'pixel', 'frost', 'ember'].every((v) => frames.some((f) => f.value === v && f.source === 'builtin' && f.enabled && typeof f.users === 'number')), JSON.stringify(frames.map((f) => f.value)))
ok('alice can wear Gilded', (await me(a, { profile_frame: 'gold' })).status === 200)
let r = await patch('frame', 'gold', { enabled: false })
ok('an admin turns Gilded off', r.status === 200 && r.body.enabled === false)
ok('then nobody can pick it', (await me(b, { profile_frame: 'gold' })).status === 400)
ok('every client hears it is off', (await call(b.token, 'GET', '/cosmetics')).some((c) => c.kind === 'frame' && c.value === 'gold' && !c.enabled))
r = await patch('frame', 'neon', { name: 'Electric' })
ok('a built-in can be renamed', r.status === 200 && (await list('frame')).find((f) => f.value === 'neon').name === 'Electric')
ok('but not deleted', (await raw(admin.token, 'DELETE', '/admin/cosmetics/frame/neon')).status === 400)
ok('nor given a custom look', (await patch('frame', 'neon', { data: { colors: ['#000000', '#ffffff'] } })).status === 400)
ok('an unknown one is not found', (await patch('frame', 'custom:nope', { enabled: false })).status === 404)

const bad = (kind, data) => raw(admin.token, 'POST', `/admin/cosmetics/${kind}`, { name: `E2E bad ${S}`, data })
ok('custom looks are checked', (await bad('frame', { colors: ['red', '#ffffff'] })).status === 400 && (await bad('decoration', {})).status === 400 && (await bad('decoration', { image: 'https://example.com/x.png' })).status === 400 && (await bad('effect', { glyph: '' })).status === 400)
const frame = (await callS(admin.token, 'POST', '/admin/cosmetics/frame', { name: `E2E Ring ${S}`, description: 'Lime and pink', data: { colors: ['#00FF00', '#ff00aa'] } })).body
ok('an admin makes a frame from two colours', frame.value?.startsWith('custom:') && frame.custom && JSON.stringify(frame.data.colors) === '["#00ff00","#ff00aa"]', JSON.stringify(frame))
ok('people can pick it', (await me(b, { profile_frame: frame.value })).status === 200)
const pic = await (await multi(admin.token, '/images?kind=cosmetic', pngFile)).json()
const deco = (await callS(admin.token, 'POST', '/admin/cosmetics/decoration', { name: `E2E Halo ${S}`, data: { image: pic.url } })).body
ok('a decoration from an uploaded picture', deco.data?.image === pic.url && (await me(b, { avatar_decoration: deco.value })).status === 200)
const effect = (await callS(admin.token, 'POST', '/admin/cosmetics/effect', { name: `E2E Petals ${S}`, data: { glyph: '🌸', fall: false } })).body
ok('an effect from an emoji, floating up', effect.data?.glyph === '🌸' && effect.data.fall === false && (await me(b, { profile_effect: effect.value })).status === 200)
const plate = (await callS(admin.token, 'POST', '/admin/cosmetics/nameplate', { name: `E2E Sunset ${S}`, data: { colors: ['#ff7700', '#7700ff'] } })).body
ok('a nameplate from two colours', plate.value?.startsWith('custom:') && (await me(b, { nameplate: plate.value })).status === 200)
ok('a frame is not a nameplate', (await me(b, { nameplate: frame.value })).status === 400)
ok('the picture survives the orphan sweep', (await callS(admin.token, 'POST', '/admin/maintenance/sweep-images?min_age_secs=0')).status === 200 && (await fetch(`${API_ORIGIN}${pic.url}`)).status === 200)
r = await patch('effect', effect.value, { name: `E2E Blossoms ${S}`, data: { glyph: '🌼', fall: true } })
ok('a custom one can be edited', r.status === 200 && r.body.name === `E2E Blossoms ${S}` && r.body.data.glyph === '🌼')
ok('the list counts who uses it', (await list('frame')).find((f) => f.value === frame.value)?.users === 1)
const audit = await call(admin.token, 'GET', '/admin/audit')
ok('it is all in the audit log', ['cosmetic.create', 'cosmetic.update'].every((x) => audit.some((e) => e.action === x)))

console.log('-- on profiles')
const browser = await chromium.launch(); const errors = []
const open = async (u, path = '/channels/@me') => {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token); await p.goto(`${WEB}${path}`); await p.waitForTimeout(1500)
  return p
}
const pb = await open(b)
// What a profile card with this frame looks like, here and now.
const shadow = (p, cls, preview = false) => p.evaluate(([cls, preview]) => { const w = document.createElement('div'); if (preview) w.dataset.cosmeticPreview = ''; const d = document.createElement('div'); d.className = cls; w.append(d); document.body.append(w); const s = getComputedStyle(d).boxShadow; w.remove(); return s }, [cls, preview])
const cls = (value) => `pf pf-c-${value.slice(7)}`
ok('a custom frame draws its colours', (await shadow(pb, cls(frame.value))).includes('rgb(0, 255, 0)'), await shadow(pb, cls(frame.value)))
ok('a frame that is off draws nothing', (await shadow(pb, 'pf pf-gold')) === 'none', await shadow(pb, 'pf pf-gold'))
const decoImg = pb.locator(`[data-panel] [data-decoration="${deco.value}"], [data-decoration="${deco.value}"]`).first()
ok("bob's custom decoration shows on his avatar", await decoImg.isVisible().catch(() => false))
const panelPlate = pb.locator(`[data-panel-nameplate="${plate.value}"]`)
ok('and his custom nameplate behind his name', (await panelPlate.count()) === 1 && /gradient/.test(await panelPlate.evaluate((e) => getComputedStyle(e).backgroundImage)), await panelPlate.evaluate((e) => getComputedStyle(e).backgroundImage).catch(() => 'none'))

await patch('decoration', deco.value, { enabled: false }); await pb.waitForTimeout(800)
ok('an admin turns his decoration off: gone from his avatar at once', !(await decoImg.isVisible().catch(() => false)))
ok("and he can't pick it again", (await me(b, { avatar_decoration: deco.value })).status === 400)
await patch('frame', frame.value, { enabled: false }); await pb.waitForTimeout(800)
ok('a custom frame that is off draws nothing on profiles', (await shadow(pb, cls(frame.value))) === 'none', await shadow(pb, cls(frame.value)))
ok('but still in the admin preview', (await shadow(pb, cls(frame.value), true)).includes('rgb(0, 255, 0)'))
await patch('frame', frame.value, { enabled: true }); await patch('decoration', deco.value, { enabled: true }); await pb.waitForTimeout(800)
ok('back on: shown again', (await shadow(pb, cls(frame.value))).includes('rgb(0, 255, 0)') && await decoImg.isVisible().catch(() => false))

console.log('-- the profile editor')
await openProfileEditor(pb, { section: 'frame' })
const options = await pb.locator('[data-frame-option]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-frame-option'), e.textContent.trim()]))
ok('the frame picker offers the custom one and the renamed one, not the one that is off', options.some(([v, l]) => v === frame.value && l === `E2E Ring ${S}`) && options.some(([v, l]) => v === 'neon' && l === 'Electric') && !options.some(([v]) => v === 'gold'), JSON.stringify(options))
await pb.screenshot({ path: 'cosmetics-editor.png' })

console.log('-- the admin console')
const pa = await open(admin, '/admin/cosmetics')
await pa.waitForSelector('[data-cosmetic-list="decoration"]')
ok('Cosmetics is in the admin console, decorations first', await pa.locator(`[data-cosmetic-row="${deco.value}"]`).count() === 1 && await pa.locator('[data-cosmetic-row="gold"]').count() === 1)
await pa.click('[data-cosmetic-kind="frame"]'); await pa.waitForSelector('[data-cosmetic-list="frame"]')
ok('a built-in that is off shows as off, its preview still drawn', (await pa.getAttribute('[data-cosmetic-row="gold"]', 'data-cosmetic-enabled')) === '0' && (await pa.locator('[data-cosmetic-row="gold"] [data-cosmetic-preview] .pf').evaluate((e) => getComputedStyle(e).boxShadow)) !== 'none')
await pa.click('[data-cosmetic-toggle="gold"]'); await pa.waitForTimeout(600)
ok('turning it back on', (await list('frame')).find((f) => f.value === 'gold').enabled && (await pa.getAttribute('[data-cosmetic-row="gold"]', 'data-cosmetic-enabled')) === '1')
ok('its delete button is disabled', await pa.locator('[data-cosmetic-delete="gold"]').isDisabled())
await pa.click('[data-cosmetic-kind="nameplate"]'); await pa.waitForSelector('[data-cosmetic-list="nameplate"]')
await pa.click('[data-cosmetic-new]'); await pa.fill('[data-cosmetic-name-input]', `E2E Made Here ${S}`)
await pa.locator('[data-cosmetic-color="0"]').evaluate((e) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, '#123456'); e.dispatchEvent(new Event('input', { bubbles: true })) })
await pa.click('[data-cosmetic-save]'); await pa.waitForTimeout(800)
const made = (await list('nameplate')).find((n) => n.name === `E2E Made Here ${S}`)
ok('adding a nameplate from the console', made?.source === 'custom' && made.data.colors[0] === '#123456' && await pa.locator(`[data-cosmetic-row="${made.value}"]`).count() === 1, JSON.stringify(made))
await pa.click(`[data-cosmetic-edit="${made.value}"]`); await pa.fill('[data-cosmetic-name-input]', `E2E Renamed ${S}`); await pa.click('[data-cosmetic-save]'); await pa.waitForTimeout(800)
ok('editing its name', (await pa.locator(`[data-cosmetic-row="${made.value}"] [data-cosmetic-name]`).innerText()) === `E2E Renamed ${S}`)
pa.once('dialog', (d) => d.accept())
await pa.click(`[data-cosmetic-delete="${made.value}"]`); await pa.waitForTimeout(800)
ok('deleting it', await pa.locator(`[data-cosmetic-row="${made.value}"]`).count() === 0 && !(await list('nameplate')).some((n) => n.value === made.value))
await pa.click('[data-cosmetic-kind="effect"]'); await pa.waitForSelector(`[data-cosmetic-row="${effect.value}"]`); await pa.waitForTimeout(500)
await pa.screenshot({ path: 'cosmetics-admin.png' })

console.log('-- deleting')
r = await raw(admin.token, 'DELETE', `/admin/cosmetics/frame/${enc(frame.value)}`)
ok('deleting a custom frame takes it off everyone who had it', r.status === 204 && !(await call(b.token, 'GET', '/users/@me')).profile_frame)
await raw(admin.token, 'DELETE', `/admin/cosmetics/decoration/${enc(deco.value)}`)
await callS(admin.token, 'POST', '/admin/maintenance/sweep-images?min_age_secs=0')
ok('a deleted decoration frees its picture', (await fetch(`${API_ORIGIN}${pic.url}`)).status === 404)
ok('the delete is audited', (await call(admin.token, 'GET', '/admin/audit')).some((e) => e.action === 'cosmetic.delete'))

for (const [k, v] of [['effect', effect.value], ['nameplate', plate.value]]) await raw(admin.token, 'DELETE', `/admin/cosmetics/${k}/${enc(v)}`)
await patch('frame', 'neon', { name: '' }); await patch('frame', 'gold', { enabled: true })
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
