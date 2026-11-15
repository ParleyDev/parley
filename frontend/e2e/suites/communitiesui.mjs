// Followed communities in the sidebar: blocks appear and go live with follow changes, in follow order; the browse
// entry counts the server's communities; channels of communities I don't follow stay off the server icon's unread
// marker, but a mention still shows. Browse lists, searches and follows communities; a channel of one I don't follow
// offers to follow it from its header.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'

const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Comm UI ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const base = `/guilds/${g.id}/communities`
const metal = await call(a.token, 'POST', base, { slug: 'metallica', name: 'Metallica' })
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

console.log('-- positive control and a server without communities')
await call(b.token, 'PUT', `${base}/pavement/follow`)
await call(a.token, 'POST', `/channels/${chan}/messages`, { content: 'now followed' })
await p.waitForFunction((id) => document.querySelector(`[data-guild-icon="${id}"] [data-pill]`)?.getAttribute('data-pill') === 'unread', g.id, { timeout: 5000 }).catch(() => {})
ok('once followed, a message there marks the server unread', (await pill()) === 'unread', await pill())
ok('a server with no communities has no browse entry', (await p.locator('[data-browse-communities]').count()) === 0)
await call(b.token, 'DELETE', `${base}/pavement/follow`); await call(b.token, 'DELETE', `${base}/metallica/follow`)

console.log('-- browse')
await p.goto(`${WEB}/channels/${g.id}`)
await p.click('[data-browse-communities]'); await p.waitForSelector('[data-browse-communities-modal]')
await p.waitForFunction(() => document.querySelectorAll('[data-community-card]').length === 2)
ok('cards listed', (await p.locator('[data-community-card]').count()) === 2)
await p.fill('[data-community-search]', 'pave'); await p.waitForFunction(() => document.querySelectorAll('[data-community-card]').length === 1)
ok('search narrows', (await p.getAttribute('[data-community-card]', 'data-community-card')) === 'pavement')
await p.click('[data-community-card="pavement"] [data-community-follow-btn]')
await p.waitForSelector('[data-community="pavement"]')
ok('follow from browse', (await p.textContent('[data-community-card="pavement"] [data-community-follow-btn]')).includes('Following'))
ok('following does not close the modal', (await p.locator('[data-browse-communities-modal]').count()) === 1)
await p.fill('[data-community-search]', 'qqqq'); await p.waitForFunction(() => document.querySelectorAll('[data-community-card]').length === 0)
ok('empty state', (await p.textContent('[data-browse-communities-modal]')).includes('No communities match'))
await p.fill('[data-community-search]', ''); await p.waitForFunction(() => document.querySelectorAll('[data-community-card]').length === 2)
await p.click('[data-community-card="pavement"] [data-community-open]')
await p.waitForSelector('[data-browse-communities-modal]', { state: 'detached' })
ok('a card opens the community\'s first channel', p.url().endsWith(`/channels/${g.id}/${pave.channel_ids[0]}`), p.url())
ok('no follow prompt for a followed community', (await p.locator('[data-community-follow-prompt]').count()) === 0)

console.log('-- follow prompt in a channel header')
await p.goto(`${WEB}/channels/${g.id}/${metal.channel_ids[0]}`)
await p.waitForSelector('[data-community-follow-prompt]')
ok('the channel loads for a non-follower with a follow prompt', (await p.textContent('[data-community-follow-prompt]')).includes('Metallica'))
await p.click('[data-community-follow-prompt]')
await p.waitForSelector('[data-community="metallica"]')
await p.waitForSelector('[data-community-follow-prompt]', { state: 'detached' })
ok('pressing it follows and the prompt goes away', true)

ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
