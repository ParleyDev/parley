// Mentions in short previews read as names, not ids: the header over a reply, the message's accessible label, a forum
// post's preview, and the role and channel mentions alongside.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'

const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Replies ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const tc = g.channels.find((c) => c.kind === 'text')
const role = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: `Crew${S}` })
const orig = await call(b.token, 'POST', `/channels/${tc.id}/messages`, { content: `hey <@${a.user.id}> and <@&${role.id}>, see <#${tc.id}>` })
await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: 'on it', reply_to: orig.id })
const forum = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'board', kind: 'forum' })
await call(a.token, 'POST', `/channels/${forum.id}/threads`, { name: `Post ${S}`, content: `thanks <@${b.user.id}>` })

const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('[data-reply-preview]')
const head = await p.locator('[data-reply-preview]').first().textContent()
ok('the reply header shows the mention as @name', head.includes('@Alice') && !head.includes(a.user.id), head)
ok('roles and channels by name too', head.includes(`@Crew${S}`) && head.includes('#general') && !head.includes(role.id), head)
const label = await p.locator(`[data-msg-id="${orig.id}"]`).getAttribute('aria-label')
ok("the message's accessible label reads names", label.includes('@Alice') && !label.includes(a.user.id), label)
await p.goto(`${WEB}/channels/${g.id}/${forum.id}`); await p.waitForSelector(`text=Post ${S}`); await p.waitForTimeout(400)
const post = await p.locator('main').innerText()
ok("a forum post's preview shows @name", post.includes('thanks @Bob') && !post.includes(b.user.id))

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
