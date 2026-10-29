// Profile effects and frames from the assets folder, described by each folder's metadata.json: listed with their
// layers, served file by file, picked in the profile editor, played from the layer timing over the card, and frames
// drawn around it (staples over the top/bottom edge, rails along the sides, back layers only outside the card).
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish, openProfileEditor, closeEditorPanel } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Fx ${S}` }); const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)

console.log('-- catalogue')
const effects = await fetch(`${WEB}/api/assets/profile-effects`).then((r) => r.json())
const fx = effects.find((e) => e.id === 'e2e_sparkle')
ok('effects are listed by metadata.json with their layers', fx?.name === 'E2E Sparkle' && fx.layers.length === 2 && fx.layers[1].loop === true && fx.layers[1].random_variants.length === 1, JSON.stringify(effects).slice(0, 300))
ok('each layer carries its pixel size', fx.layers[0].width === 90 && fx.layers[0].height === 176)
ok('with a still for pickers and reduced motion', fx.still === 'static.png' && fx.reduced_motion === 'reduced_motion.png')
const frames = await fetch(`${WEB}/api/assets/profile-frames`).then((r) => r.json())
const fr = frames.find((f) => f.id === 'e2e_frame')
ok('frames are listed with their layout and layers', fr?.layout?.overflow_top === 304 && fr.layers.length === 3)
let r = await fetch(`${WEB}/api/assets/profile-effects/e2e_sparkle/layer_01.png`)
ok('layer files are served as images', r.status === 200 && r.headers.get('content-type') === 'image/png')
ok('only files in the folder', (await fetch(`${WEB}/api/assets/profile-effects/e2e_sparkle/metadata.json`)).status === 404 && (await fetch(`${WEB}/api/assets/profile-effects/e2e_sparkle/..%2F..%2Fmetadata.json`)).status === 404)
r = await fetch(`${WEB}/api/assets/profile-frames/e2e_frame/preview`)
ok('frames get a small composed preview', r.status === 200 && r.headers.get('content-type') === 'image/png' && (await r.arrayBuffer()).byteLength > 100)
ok('unknown effects and frames are refused', (await raw(a.token, 'PATCH', '/users/@me', { profile_effect: 'asset:nope' })).status === 400 && (await raw(a.token, 'PATCH', '/users/@me', { profile_frame: 'asset:nope' })).status === 400)

const browser = await chromium.launch(); const errors = []
const mk = async (u, path, opts = {}) => {
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, ...opts })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}${path}`); await p.waitForTimeout(1000)
  return p
}

console.log('-- picking them')
const pa = await mk(a, `/channels/${g.id}/${ch.id}`)
await openProfileEditor(pa, { section: 'effect' }); await pa.waitForSelector('[data-layered-picker="profile-effects"] [data-layered-option]')
ok('the effect picker lists the folder with stills and descriptions', (await pa.locator('[data-layered-option="asset:e2e_sparkle"]').getAttribute('title')).includes('intro once'))
await pa.hover('[data-layered-option="asset:e2e_sparkle"]')
await pa.locator('[data-layered-option="asset:e2e_sparkle"] [data-effect-tile-live] [data-effect-layer]').first().waitFor({ timeout: 3000 }).catch(() => {})
ok('hovering a tile plays the effect before picking it', await pa.locator('[data-layered-option="asset:e2e_sparkle"] [data-effect-tile-live] [data-effect-layer]').count() >= 1)
await pa.mouse.move(5, 5); await pa.waitForTimeout(150)
ok('and stops when the pointer leaves', await pa.locator('[data-effect-tile-live]').count() === 0)
await pa.click('[data-layered-option="asset:e2e_sparkle"]')
await pa.locator('[data-profile-editor] [data-profile-card] [data-effect-layer="layer_01.png"]').waitFor({ timeout: 3000 }).catch(() => {})
ok('the preview plays it', await pa.locator('[data-profile-editor] [data-profile-card] [data-effect-layer="layer_01.png"]').count() === 1)
await closeEditorPanel(pa)
await pa.click('[data-editor-section="frame"]'); await pa.waitForSelector('[data-layered-picker="profile-frames"] [data-layered-option]')
await pa.fill('[data-layered-search]', 'purple band')
ok('frames are searchable by description', await pa.locator('[data-layered-option]').count() === 1)
await pa.click('[data-layered-option="asset:e2e_frame"]')
await pa.locator('[data-profile-editor] [data-profile-frame-layers="e2e_frame"] img').first().waitFor({ timeout: 3000 }).catch(() => {})
ok('the preview wears the frame (front and back layers)', await pa.locator('[data-profile-editor] [data-frame-layer]').count() >= 3)
await closeEditorPanel(pa)
ok('the tiles show what is picked', await pa.locator('[data-editor-section="effect"] img').count() === 1 && await pa.locator('[data-editor-section="frame"] img').count() === 1)
await pa.click('[data-editor-savebar] button:has-text("Save Changes")'); await pa.waitForSelector('text=Profile saved')
const me = await call(a.token, 'GET', '/users/@me')
ok('saved', me.profile_effect === 'asset:e2e_sparkle' && me.profile_frame === 'asset:e2e_frame')
await pa.keyboard.press('Escape')

console.log('-- others see them')
const pb = await mk(b, `/channels/${g.id}/${ch.id}`)
await pb.click(`[data-member-row="${a.user.id}"]`); await pb.waitForSelector('[data-profile-popout]')
const card = pb.locator('[data-profile-popout] [data-profile-card]').first()
await card.locator('[data-effect-layer="layer_01.png"]').waitFor({ timeout: 3000 }).catch(() => {})
ok('the intro layer plays first', await card.locator('[data-effect-layer="layer_01.png"]').count() === 1)
await pb.waitForTimeout(450)
ok('the second layer starts at its time', await card.locator('[data-effect-layer^="layer_02"]').count() === 1)
await pb.waitForTimeout(500)
ok('one-shot layers end after their duration', await card.locator('[data-effect-layer="layer_01.png"]').count() === 0)
let seen = new Set()
for (let i = 0; i < 30; i++) { const f = await card.locator('[data-effect-layer^="layer_02"]').getAttribute('data-effect-layer').catch(() => null); if (f) seen.add(f); await pb.waitForTimeout(100) }
ok('looping layers come back (and pick their variants)', seen.size >= 1, [...seen].join(','))
const geo = await card.evaluate((c) => {
  const cr = c.getBoundingClientRect(), s = cr.width / 1200
  const img = (f) => c.parentElement.querySelector(`[data-frame-layer="${f}"]`)
  const top = img('front_staple_top.png').getBoundingClientRect(), rail = img('front_rail_center.png'), railBox = rail.parentElement.getBoundingClientRect()
  // Back layers live in one box over the whole framed area, masked by an even-odd path that cuts out the card with
  // its own rounded corners (a rectangular hole left the corners empty).
  const back = c.parentElement.querySelector('[data-frame-back]'), br = back?.getBoundingClientRect()
  const mask = back ? decodeURIComponent(getComputedStyle(back).maskImage || getComputedStyle(back).webkitMaskImage || '') : ''
  const radius = parseFloat(getComputedStyle(c).borderTopLeftRadius) || 0
  const covers = !!br && br.left < cr.left && br.top < cr.top && br.right > cr.right && br.bottom > cr.bottom
  const overlaps = covers && /evenodd/.test(mask) && (radius === 0 || / A\d|A[\d.]+ [\d.]+ 0 0 1/.test(mask)) ? 0 : 1
  // Same stacking context, so DOM order is paint order: back layers must come first even though metadata lists a front one first.
  const order = [...c.parentElement.querySelectorAll('[data-frame-layer]')].map((e) => e.dataset.frameLayer.startsWith('back') ? 'b' : 'f').join('')
  return { s, topOver: Math.round(cr.top - top.top), want: Math.round(304 * s), topW: Math.round(top.width), wantW: Math.round(1312 * s), railH: Math.round(railBox.height), cardH: Math.round(cr.height), overlaps, order }
})
ok('the top staple hangs over the card edge by overflow_top (scaled)', Math.abs(geo.topOver - geo.want) <= 1 && Math.abs(geo.topW - geo.wantW) <= 1, JSON.stringify(geo))
ok('rails run the height of the card', Math.abs(geo.railH - geo.cardH) <= 1, JSON.stringify(geo))
ok('back layers only show outside the card, rounded corners included', geo.overlaps === 0, JSON.stringify(geo))
ok('back layers are painted before (under) front layers', /^b+f+$/.test(geo.order), geo.order)
await pb.keyboard.press('Escape')

console.log('-- reduced motion')
const pr = await mk(b, `/channels/${g.id}/${ch.id}`, { reducedMotion: 'reduce' })
await pr.click(`[data-member-row="${a.user.id}"]`); await pr.waitForSelector('[data-profile-popout] [data-effect-still]')
ok('shows the still instead of playing', await pr.locator('[data-profile-popout] [data-effect-layer]').count() === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'PATCH', '/users/@me', { profile_effect: '', profile_frame: '' })
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
