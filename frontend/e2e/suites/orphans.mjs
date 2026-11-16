import { API_ORIGIN, S, reg, call, callS, raw, ok, finish, adminToken, multi, pngFile } from '../lib.mjs'

// Server, community and Discover pictures must survive the orphan-image sweep; stray uploads must not.
const admin = await adminToken()
const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Banners ${S}` })
const up = async (kind) => { const r = await multi(a.token, `/images?kind=${kind}`, pngFile); return r.json() }
const icon = await up('icon'), banner = await up('banner'), listing = await up('banner'), avatar = await up('avatar'), profileBanner = await up('banner'), stray = await up('banner')
const cIcon = await up('icon'), cBanner = await up('banner')
await callS(a.token, 'POST', `/guilds/${g.id}/communities`, { slug: 'pics', name: 'Pics', icon_url: cIcon.url, banner_url: cBanner.url })
await callS(a.token, 'PATCH', `/guilds/${g.id}`, { icon_url: icon.url, banner_url: banner.url })
await callS(a.token, 'PUT', `/guilds/${g.id}/discovery`, { description: 'A server with a lovely banner.', category: 'gaming', banner_url: listing.url })
await callS(a.token, 'PATCH', '/users/@me', { avatar_url: avatar.url, banner_url: profileBanner.url })
let r = await raw(a.token, 'POST', '/admin/maintenance/sweep-images?min_age_secs=0'); ok('the sweep is admin only', r.status === 403)
r = await callS(admin.token, 'POST', '/admin/maintenance/sweep-images?min_age_secs=0'); ok('an immediate sweep removes exactly the stray upload', r.status === 200 && r.body.removed === 1)
const status = async (u) => (await fetch(`${API_ORIGIN}${u}`)).status
ok('server icon and banner survive', await status(icon.url) === 200 && await status(banner.url) === 200)
ok('community icon and banner survive', await status(cIcon.url) === 200 && await status(cBanner.url) === 200)
ok('the Discover listing banner survives', await status(listing.url) === 200)
ok('profile avatar and banner survive', await status(avatar.url) === 200 && await status(profileBanner.url) === 200)
ok('the stray upload is gone', await status(stray.url) === 404)
ok('the server still has its banner', (await call(a.token, 'GET', `/guilds/${g.id}`)).banner_url === banner.url)
ok('audit records the sweep', (await call(admin.token, 'GET', '/admin/audit')).some((e) => e.action === 'maintenance.sweep_images' && e.details.removed === 1))

// The Discover listing set up with the server's own banner (the settings tab's default), then the server banner changed:
// the listing still shows the old picture, so it must stay.
const g2 = await call(a.token, 'POST', '/guilds', { name: `Shared ${S}` })
const shared = await up('banner'), next = await up('banner')
await callS(a.token, 'PATCH', `/guilds/${g2.id}`, { banner_url: shared.url })
await callS(a.token, 'PUT', `/guilds/${g2.id}/discovery`, { description: 'A banner shared with the listing.', category: 'gaming', banner_url: shared.url })
await callS(a.token, 'PATCH', `/guilds/${g2.id}`, { banner_url: next.url })
ok('changing the server banner keeps a picture its Discover listing still shows', await status(shared.url) === 200)
await callS(a.token, 'PUT', `/guilds/${g2.id}/discovery`, { description: 'A banner shared with the listing.', category: 'gaming', banner_url: next.url })
ok('the listing moving to the server\'s new banner frees the old one', await status(shared.url) === 404 && await status(next.url) === 200)

// A community's pictures go when they are replaced or the community is deleted, unless something else shows them.
const cNext = await up('banner')
await callS(a.token, 'PATCH', `/guilds/${g.id}/communities/pics`, { banner_url: cNext.url, icon_url: icon.url })
ok('a replaced community banner is freed', await status(cBanner.url) === 404 && await status(cNext.url) === 200)
ok('as is a replaced community icon', await status(cIcon.url) === 404)
r = await raw(a.token, 'DELETE', `/guilds/${g.id}/communities/pics`)
ok('deleting the community frees its banner', r.status === 204 && await status(cNext.url) === 404)
ok('but keeps an icon the server itself still shows', await status(icon.url) === 200)
await finish()
