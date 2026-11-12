// Every unread or mention that lights a server up can be found in its channel list: voice and project chats, threads
// that mention you; channels you've hidden don't light it up at all.
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, ok, finish } from '../lib.mjs'

const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Where ${S}` }); const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const g2 = await call(b.token, 'POST', '/guilds', { name: `Mine ${S}` })
const tc = g.channels.find((x) => x.kind === 'text'), vc = g.channels.find((x) => x.kind === 'voice')
const studio = (await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'studio', kind: 'studio' })).body
const P = (await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Side Song' })).body
const forum = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'ideas', kind: 'forum' })
const g3 = await call(a.token, 'POST', '/guilds', { name: `Hidden ${S}` }); const inv3 = await call(a.token, 'POST', `/guilds/${g3.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv3.code}`)
const seen = g3.channels.find((x) => x.kind === 'text'), quiet = await call(a.token, 'POST', `/guilds/${g3.id}/channels`, { name: 'quiet-room', kind: 'text' })
await call(b.token, 'PUT', `/guilds/${g3.id}/me/hidden-channels`, { channel_ids: [quiet.id] })

const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), b.token)
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('[data-channel-row="general"]'); await p.waitForTimeout(800)

console.log('-- in the channel list')
ok('a project I have nothing to do with is not listed', await p.locator(`[data-sidebar-project="${P.channel_id}"]`).count() === 0)
await call(a.token, 'POST', `/channels/${P.channel_id}/messages`, { content: 'listen to this take' })
await p.waitForSelector(`[data-sidebar-project="${P.channel_id}"]`, { timeout: 5000 }).catch(() => {})
ok('a message in its chat lists it under the studio, unread', await p.locator(`[data-sidebar-project="${P.channel_id}"] a[data-unread="true"]`).count() === 1)
ok('and the studio row is unread too', await p.locator(`[data-channel-item="${studio.id}"] > a[data-unread="true"]`).count() === 1)
await call(a.token, 'POST', `/channels/${vc.id}/messages`, { content: `<@${b.user.id}> you there?` })
await p.waitForSelector(`[data-channel-item="${vc.id}"] [data-has-mention="true"]`, { timeout: 5000 }).catch(() => {})
ok('a mention in a voice channel\'s chat shows on its row', await p.locator(`[data-channel-item="${vc.id}"] [data-has-mention="true"]`).count() === 1)
const post = await call(a.token, 'POST', `/channels/${forum.id}/threads`, { name: 'Tour poster', content: 'what do we think' })
ok('a forum post that doesn\'t mention me stays out of the list', await p.locator(`[data-sidebar-thread="${post.id}"]`).count() === 0)
await call(a.token, 'POST', `/channels/${post.id}/messages`, { content: `<@${b.user.id}> thoughts?` })
await p.waitForSelector(`[data-sidebar-thread-mentions="1"]`, { timeout: 5000 }).catch(() => {})
ok('a thread that mentions me is listed under its channel, with the count', await p.locator(`[data-channel-item="${forum.id}"] [data-sidebar-thread="${post.id}"] [data-sidebar-thread-mentions="1"]`).count() === 1)
await p.click(`[data-sidebar-thread="${post.id}"]`); await p.waitForTimeout(1000)
ok('clicking it opens the thread and reads the mention', await p.locator(`[data-sidebar-thread-mentions]`).count() === 0)

console.log('-- the server icon')
await p.goto(`${WEB}/channels/${g3.id}/${seen.id}`); await p.waitForSelector('[data-channel-row]'); await p.waitForTimeout(800)
ok('the hidden channel is not in my list', await p.locator('[data-channel-row="quiet-room"]').count() === 0)
await p.goto(`${WEB}/channels/${g2.id}/${g2.channels.find((x) => x.kind === 'text').id}`); await p.waitForTimeout(1200)
const pill = () => p.locator(`[data-guild-icon="${g3.id}"] [data-pill]`).getAttribute('data-pill')
ok('clean start', (await pill()) === 'none')
await call(a.token, 'POST', `/channels/${quiet.id}/messages`, { content: 'nobody reads this' }); await p.waitForTimeout(800)
ok('a message in a channel I hid does not mark the server unread', (await pill()) === 'none', await pill())
await call(a.token, 'POST', `/channels/${seen.id}/messages`, { content: 'hello' }); await p.waitForTimeout(800)
ok('one in a channel I can see does', (await pill()) === 'unread')

ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
