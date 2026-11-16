// A community's page: header, formatted about, safe links, channels, counts and managers; following from it; live
// updates and deletion while it is open; a community the member cannot view is simply not found.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'

const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Comm Page ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
await call(b.token, 'POST', `/invites/${inv.code}`); await call(c.token, 'POST', `/invites/${inv.code}`)
const base = `/guilds/${g.id}/communities`
const metal = await call(a.token, 'POST', base, { slug: 'metal', name: 'Metal', description: 'Loud music' })
await call(a.token, 'PATCH', `${base}/metal`, {
  about: 'Welcome to **metal**. <img src=x onerror="window.__x=1">',
  links: [{ label: 'Home', url: 'https://www.example.com/a' }, { label: 'Docs', url: 'http://docs.example.org/b' }],
})
const hid = await call(a.token, 'POST', base, { slug: 'hidden', name: 'Hidden' })
await call(a.token, 'PUT', `/channels/${hid.category_id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: 1024 })
await call(a.token, 'POST', base, { slug: 'bare', name: 'Bare', channels: [] })
await call(a.token, 'PUT', `${base}/metal/managers/${c.user.id}`, { kind: 'member' })
await call(a.token, 'POST', `/channels/${metal.channel_ids[0]}/messages`, { content: 'first post here' })

const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), b.token)

console.log('-- viewing')
await p.goto(`${WEB}/channels/${g.id}/c/metal`)
await p.waitForSelector('[data-community-page="metal"]')
ok('name and description shown', (await p.textContent('[data-community-page]')).includes('Metal') && (await p.textContent('[data-community-page]')).includes('Loud music'))
ok('a tinted band stands in for a missing header image', (await p.locator('[data-community-banner]').count()) === 1)
ok('about is formatted, not raw html', (await p.locator('[data-community-about] strong').count()) === 1 && (await p.locator('[data-community-about] img').count()) === 0 && (await p.evaluate(() => window.__x)) === undefined)
ok('link shows label and host, opens safely', await p.$eval('[data-community-link]', (a) => a.textContent.includes('example.com') && a.target === '_blank' && a.rel.includes('noopener')))
ok('every link is listed', (await p.locator('[data-community-link]').count()) === 2)
ok('channels listed', (await p.locator('[data-community-channel]').count()) === 1)
ok('manager listed', (await p.textContent('[data-community-managers]')).includes('Carol'))
ok('not following by just opening', (await p.textContent('[data-community-follow]')).trim() === 'Follow' && !(await call(b.token, 'GET', `${base}/metal`)).following)
await p.click('[data-community-follow]')
await p.waitForFunction(() => document.querySelector('[data-community-follow]').textContent.trim() === 'Following')
ok('follow from the page', (await call(b.token, 'GET', `${base}/metal`)).following === true)
ok('the followed community shows in the sidebar', (await p.locator('[data-community="metal"]').count()) === 1)

console.log('-- phone width')
await p.setViewportSize({ width: 390, height: 800 })
ok('no sideways scroll', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await p.setViewportSize({ width: 1440, height: 900 })

console.log('-- opening a channel')
await p.click('[data-community-channel]'); await p.waitForURL(new RegExp(`/channels/${g.id}/[0-9a-f-]{36}`))
ok('channel row opens the channel', /[0-9a-f-]{36}$/.test(new URL(p.url()).pathname))

console.log('-- not found')
await p.goto(`${WEB}/channels/${g.id}/c/hidden`); await p.waitForSelector('[data-community-missing]')
ok('hidden community is not found', (await p.locator('[data-community-page]').count()) === 0)
ok('and says nothing about it', !(await p.textContent('[data-community-missing]')).includes('Hidden'))
await p.goto(`${WEB}/channels/${g.id}/c/nope`); await p.waitForSelector('[data-community-missing]')
ok('unknown address is not found', await p.isVisible('[data-community-missing]'))

console.log('-- a community with no channels, links, about or managers')
await p.goto(`${WEB}/channels/${g.id}/c/bare`); await p.waitForSelector('[data-community-page="bare"]')
ok('renders with nothing in it', (await p.locator('[data-community-channel]').count()) === 0 && (await p.locator('[data-community-link]').count()) === 0 && (await p.locator('[data-community-managers]').count()) === 0)

console.log('-- live updates')
await p.goto(`${WEB}/channels/${g.id}/c/metal`); await p.waitForSelector('[data-community-page="metal"]')
await call(a.token, 'PATCH', `${base}/metal`, { description: 'Louder music' })
await p.waitForFunction(() => document.querySelector('[data-community-page]')?.textContent?.includes('Louder music'), null, { timeout: 8000 }).catch(() => {})
ok('a description change shows without reload', (await p.textContent('[data-community-page]')).includes('Louder music'))
await call(a.token, 'DELETE', `${base}/metal`)
await p.waitForSelector('[data-community-missing]', { timeout: 8000 }).catch(() => {})
ok('deleting it while open shows the not-found state', (await p.locator('[data-community-missing]').count()) === 1)

console.log('-- follow prompt links to the page')
const two = await call(a.token, 'POST', base, { slug: 'jazz', name: 'Jazz' })
await p.goto(`${WEB}/channels/${g.id}/${two.channel_ids[0]}`)
await p.waitForSelector('[data-community-about-link]')
await p.click('[data-community-about-link]')
await p.waitForSelector('[data-community-page="jazz"]')
ok('About this community leads to the page', p.url().endsWith(`/channels/${g.id}/c/jazz`))

ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
