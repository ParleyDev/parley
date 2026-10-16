import { S, reg, call, callS, raw, ok, finish, adminToken, multi, pngFile } from '../lib.mjs'

// Server banners and Discover banners must survive the orphan-image sweep; stray uploads must not.
const admin = await adminToken()
const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Banners ${S}` })
const up = async (kind) => { const r = await multi(a.token, `/images?kind=${kind}`, pngFile); return r.json() }
const icon = await up('icon'), banner = await up('banner'), listing = await up('banner'), avatar = await up('avatar'), profileBanner = await up('banner'), stray = await up('banner')
await callS(a.token, 'PATCH', `/guilds/${g.id}`, { icon_url: icon.url, banner_url: banner.url })
await callS(a.token, 'PUT', `/guilds/${g.id}/discovery`, { description: 'A server with a lovely banner.', category: 'gaming', banner_url: listing.url })
await callS(a.token, 'PATCH', '/users/@me', { avatar_url: avatar.url, banner_url: profileBanner.url })
let r = await raw(a.token, 'POST', '/admin/maintenance/sweep-images?min_age_secs=0'); ok('the sweep is admin only', r.status === 403)
r = await callS(admin.token, 'POST', '/admin/maintenance/sweep-images?min_age_secs=0'); ok('an immediate sweep removes exactly the stray upload', r.status === 200 && r.body.removed === 1)
const status = async (u) => (await fetch(`http://localhost:18080${u}`)).status
ok('server icon and banner survive', await status(icon.url) === 200 && await status(banner.url) === 200)
ok('the Discover listing banner survives', await status(listing.url) === 200)
ok('profile avatar and banner survive', await status(avatar.url) === 200 && await status(profileBanner.url) === 200)
ok('the stray upload is gone', await status(stray.url) === 404)
ok('the server still has its banner', (await call(a.token, 'GET', `/guilds/${g.id}`)).banner_url === banner.url)
ok('audit records the sweep', (await call(admin.token, 'GET', '/admin/audit')).some((e) => e.action === 'maintenance.sweep_images' && e.details.removed === 1))
await finish()
