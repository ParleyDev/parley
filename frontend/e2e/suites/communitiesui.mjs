// Followed communities in the sidebar: blocks appear and go live with follow changes, in follow order; the browse
// entry counts the server's communities; channels of communities I don't follow stay off the server icon's unread
// marker, but a mention still shows.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'

const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Comm UI ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const base = `/guilds/${g.id}/communities`
await call(a.token, 'POST', base, { slug: 'metallica', name: 'Metallica' })
const pave = await call(a.token, 'POST', base, { slug: 'pavement', name: 'Pavement' })
const g2 = await call(b.token, 'POST', '/guilds', { name: `Mine ${S}` })

const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), b.token)

console.log('-- sidebar blocks')
await p.goto(`${WEB}/channels/${g.id}`)
await p.waitForSelector('[data-browse-communities]')
ok('new member sees no community blocks', (await p.locator('[data-community]').count()) === 0)
ok('browse entry shows the count', (await p.textContent('[data-browse-communities]')).includes('2'))
await call(b.token, 'PUT', `${base}/pavement/follow`)
await p.waitForSelector('[data-community="pavement"]')
ok('following from elsewhere adds the block live', (await p.locator('[data-community]').count()) === 1)
await call(b.token, 'PUT', `${base}/metallica/follow`)
await p.waitForSelector('[data-community="metallica"]')
ok('blocks are in follow order', (await p.locator('[data-community]').evaluateAll((els) => els.map((e) => e.dataset.community))).join() === 'pavement,metallica')
ok('a community block is not draggable', (await p.locator('[data-community="pavement"]').getAttribute('draggable')) === null)
await call(b.token, 'DELETE', `${base}/pavement/follow`)
await p.waitForSelector('[data-community="pavement"]', { state: 'detached' })
ok('unfollow removes it', true)

console.log('-- the server icon')
await p.goto(`${WEB}/channels/${g2.id}/${g2.channels.find((x) => x.kind === 'text').id}`); await p.waitForTimeout(1200)
const pill = () => p.locator(`[data-guild-icon="${g.id}"] [data-pill]`).getAttribute('data-pill')
ok('clean start', (await pill()) === 'none')
const chan = pave.channel_ids[0]
await call(a.token, 'POST', `/channels/${chan}/messages`, { content: 'nobody follows this' }); await p.waitForTimeout(800)
ok('a message in an unfollowed community does not mark the server unread', (await pill()) === 'none', await pill())
await call(a.token, 'POST', `/channels/${chan}/messages`, { content: `<@${b.user.id}> hello` })
await p.waitForSelector(`[data-guild-icon="${g.id}"] [data-guild-mentions]`, { timeout: 5000 }).catch(() => {})
ok('a mention there still shows the badge', await p.locator(`[data-guild-icon="${g.id}"] [data-guild-mentions]`).count() === 1)

ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
