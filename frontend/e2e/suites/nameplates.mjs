// Nameplates: video ones from the assets folder (listed, picked in Profiles, refused when unknown), shown behind a
// member list row and playing on hover; not for members who appear offline; in the DM list only on hover or for
// the open conversation. Also: snow and confetti profile effects fall, hearts rise.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish, openDms, openProfileEditor } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
await openDms(a, b, c)
const g = await call(a.token, 'POST', '/guilds', { name: `Plates ${S}` }); const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errors = []
const mk = async (u, path) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}${path}`); await p.waitForTimeout(1200)
  return p
}

console.log('-- from the assets folder')
const list = await fetch(`${WEB}/api/assets/nameplates`).then((r) => r.json())
ok('the instance lists its nameplate files, named by metadata.json', list.some((n) => n.id === 'e2e_wave' && n.name === 'Ocean wave' && n.description === 'A gentle test wave.' && n.animated), JSON.stringify(list))
ok('and serves them as video', (await fetch(`${WEB}/api/assets/nameplates/e2e_wave`)).headers.get('content-type') === 'video/webm')
ok('unknown asset nameplates are refused', (await raw(a.token, 'PATCH', '/users/@me', { nameplate: 'asset:nope' })).status === 400)
const pa = await mk(a, `/channels/${g.id}/${ch.id}`)
await openProfileEditor(pa, { section: 'nameplate' }); await pa.waitForSelector('[data-asset-nameplates]')
await pa.click('[data-nameplate-option="asset:e2e_wave"]')
await pa.locator('button:has-text("Save Changes"), button[type="submit"]:has-text("Save")').first().click().catch(() => {})
ok('Profiles picks one', await (async () => { for (let i = 0; i < 20; i++) { if ((await call(a.token, 'GET', '/users/@me')).nameplate === 'asset:e2e_wave') return true; await new Promise((r) => setTimeout(r, 250)) } return false })())
await pa.keyboard.press('Escape')

console.log('-- member list')
const pb = await mk(b, `/channels/${g.id}/${ch.id}`)
const row = pb.locator(`[data-member-row="${a.user.id}"]`)
await row.locator('[data-nameplate-video]').waitFor({ timeout: 8000 }).catch(() => {})
ok('shows behind an online member', await row.locator('[data-nameplate-video="e2e_wave"]').count() === 1)
ok('still until hovered', await row.locator('video').evaluate((v) => v.paused))
await row.hover(); await pb.waitForTimeout(600)
ok('playing on hover', await row.locator('video').evaluate((v) => !v.paused))
await pb.mouse.move(5, 5)
await call(c.token, 'PATCH', '/users/@me', { nameplate: 'dusk' })
await call(c.token, 'PATCH', '/users/@me', { status: 'invisible' })
await pb.reload(); await pb.waitForTimeout(1500)
const carol = pb.locator(`[data-member-row="${c.user.id}"]`)
ok('not for someone who appears offline', await carol.getAttribute('data-nameplate') === null && !(await carol.getAttribute('class')).includes('np-dusk'))

console.log('-- DM list')
await call(b.token, 'POST', '/users/@me/channels', { recipient_id: a.user.id })
await pb.goto(`${WEB}/channels/@me`); await pb.waitForSelector(`[data-dm-row="${a.user.id}"]`)
const dmRow = pb.locator(`[data-dm-row="${a.user.id}"]`)
const visible = () => dmRow.locator('video').evaluate((v) => getComputedStyle(v).opacity)
ok('hidden in the DM list until hovered', await visible() === '0')
await dmRow.hover(); await pb.waitForTimeout(300)
ok('shown on hover', Number(await visible()) > 0)
await dmRow.click(); await pb.mouse.move(5, 5); await pb.waitForTimeout(300)
ok('and on the open conversation', Number(await visible()) > 0)

console.log('-- group chat members')
for (const u of [a, c]) { await call(b.token, 'POST', '/users/@me/relationships', { user_id: u.user.id }); await call(u.token, 'PUT', `/users/@me/relationships/${b.user.id}`) }
const grp = await call(b.token, 'POST', '/users/@me/channels', { recipient_ids: [a.user.id, c.user.id] })
await pb.goto(`${WEB}/channels/@me/${grp.id}`); await pb.waitForSelector('[data-group-members]'); await pb.waitForTimeout(600)
const gm = pb.locator(`[data-group-members] [data-group-member="${a.user.id}"]`)
ok('the group member list shows nameplates', await gm.locator('[data-nameplate-video="e2e_wave"]').count() === 1, String(grp?.id))
ok('but not for someone who appears offline', await pb.locator(`[data-group-members] [data-group-member="${c.user.id}"]`).getAttribute('data-nameplate') === null)

console.log('-- profile effects')
await call(a.token, 'PATCH', '/users/@me', { profile_effect: 'snow' })
await pb.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pb.waitForTimeout(1200)
await pb.click(`[data-member-row="${a.user.id}"]`); await pb.waitForSelector('[data-profile-effect="snow"]')
ok('snow falls', await pb.locator('[data-profile-effect="snow"]').getAttribute('data-effect-motion') === 'fall' && await pb.locator('[data-profile-effect="snow"] .pe-bit').first().evaluate((e) => getComputedStyle(e).animationName) === 'pe-fall')
await pb.keyboard.press('Escape')
await call(a.token, 'PATCH', '/users/@me', { profile_effect: 'hearts' })
await pb.reload(); await pb.waitForTimeout(1200); await pb.click(`[data-member-row="${a.user.id}"]`); await pb.waitForSelector('[data-profile-effect="hearts"]')
ok('hearts rise', await pb.locator('[data-profile-effect="hearts"] .pe-bit').first().evaluate((e) => getComputedStyle(e).animationName) === 'pe-rise')
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
