import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Forum ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)

console.log('-- API')
let r = await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'Help Desk', kind: 'forum' }); ok('create a forum channel (name normalised like text)', r.status === 201 && r.body.kind === 'forum' && r.body.name === 'help-desk'); const f = r.body
r = await callS(a.token, 'POST', `/channels/${f.id}/messages`, { content: 'hi' }); ok('plain messages are refused in a forum', r.status === 400)
r = await callS(b.token, 'POST', `/channels/${f.id}/tags`, { name: 'bug' }); ok('tags need Manage Channels', r.status === 403)
r = await callS(a.token, 'POST', `/channels/${f.id}/tags`, { name: 'bug', emoji: '🐛' }); ok('create a tag', r.status === 201 && r.body.name === 'bug'); const bug = r.body
const idea = (await callS(a.token, 'POST', `/channels/${f.id}/tags`, { name: 'idea', emoji: '💡' })).body
r = await callS(a.token, 'POST', `/channels/${f.id}/tags`, { name: '' }); ok('tag name required', r.status === 400)
ok('tags list', (await call(b.token, 'GET', `/channels/${f.id}/tags`)).map((t) => t.name).join(',') === 'bug,idea')
r = await callS(b.token, 'POST', `/channels/${f.id}/threads`, { name: 'Login broken', content: '' }); ok('a post needs a message', r.status === 400)
r = await callS(b.token, 'POST', `/channels/${f.id}/threads`, { name: 'Login broken', content: `I cannot log in since today ${S}`, tags: [bug.id] })
ok('bob creates a post with a tag; body becomes the first message', r.status === 201 && r.body.tags.join() === bug.id && r.body.message_count === 1 && r.body.preview === `I cannot log in since today ${S}`); const p1 = r.body
r = await callS(b.token, 'POST', `/channels/${f.id}/threads`, { name: 'x', content: 'y', tags: [g.id] }); ok('unknown tag refused', r.status === 400)
const p2 = (await callS(a.token, 'POST', `/channels/${f.id}/threads`, { name: 'Dark mode please', content: 'Would love a dark theme', tags: [idea.id] })).body
const p3 = (await callS(a.token, 'POST', `/channels/${f.id}/threads`, { name: 'Welcome! Read me first', content: 'Rules of the forum' })).body
ok('first messages are in the post threads', (await call(b.token, 'GET', `/channels/${p1.id}/messages`))[0]?.content === `I cannot log in since today ${S}`)
let list = await call(b.token, 'GET', `/channels/${f.id}/threads`); ok('list orders by latest activity', list.map((t) => t.id).join() === [p3.id, p2.id, p1.id].join())
await callS(b.token, 'POST', `/channels/${p1.id}/messages`, { content: 'bump' })
list = await call(b.token, 'GET', `/channels/${f.id}/threads`); ok('a reply moves the post up', list[0].id === p1.id && list[0].message_count === 2)
list = await call(b.token, 'GET', `/channels/${f.id}/threads?sort=created`); ok('sort=created keeps creation order', list.map((t) => t.id).join() === [p3.id, p2.id, p1.id].join())
list = await call(b.token, 'GET', `/channels/${f.id}/threads?tag=${idea.id}`); ok('tag filter', list.length === 1 && list[0].id === p2.id)
r = await callS(b.token, 'PATCH', `/threads/${p3.id}`, { pinned: true }); ok('pinning needs Manage Messages', r.status === 403)
r = await callS(a.token, 'PATCH', `/threads/${p3.id}`, { pinned: true }); ok('owner pins the welcome post', r.status === 200 && !!r.body.pinned_at)
list = await call(b.token, 'GET', `/channels/${f.id}/threads`); ok('pinned posts come first', list[0].id === p3.id && list[1].id === p1.id)
r = await callS(b.token, 'PATCH', `/threads/${p1.id}`, { tags: [bug.id, idea.id] }); ok('the poster retags their post', r.status === 200 && r.body.tags.length === 2)
r = await callS(a.token, 'DELETE', `/channels/${f.id}/tags/${idea.id}`); ok('deleting a tag', r.status === 204)
ok('deleted tags vanish from posts', (await call(b.token, 'GET', `/channels/${f.id}/threads/${p1.id}`)).thread.tags.join() === bug.id)
ok('forum posts are searchable', (await call(a.token, 'GET', `/search?q=dark&guild_id=${g.id}`)).results.some((h) => h.channel_id === p2.id))

console.log('-- UI')
const browser = await chromium.launch(); const errors = []
const mk = async (tok) => { const p = await browser.newPage({ viewport: { width: 1600, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(`${WEB}/channels/${g.id}/${f.id}`); await p.waitForSelector('[data-forum]'); return p }
const pa = await mk(a.token); const pb = await mk(b.token)
await pa.waitForSelector('[data-forum-post]')
ok('the forum shows posts, pinned first, with tags', (await pa.locator('[data-forum-post]').first().getAttribute('data-forum-pinned')) === '1' && await pa.locator(`[data-forum-post="${p1.id}"] [data-forum-post-tag="${bug.id}"]`).count() === 1 && await pa.locator('textarea').count() === 0)
await pa.screenshot({ path: '114-forum.png' })
await pb.click('[data-forum-new]'); await pb.waitForSelector('[data-new-post]'); await pb.fill('[data-post-title]', 'Mobile crashes'); await pb.fill('[data-post-content]', 'App closes when I open settings'); await pb.click(`[data-post-tag="${bug.id}"]`); await pb.click('[data-post-submit]')
await pb.waitForSelector('[data-thread-panel]'); await pb.waitForSelector('[data-thread-panel] >> text=App closes when I open settings', { timeout: 5000 }).catch(() => {})
ok('New Post opens the post thread with the body as its first message', (await pb.textContent('[data-thread-title]')) === 'Mobile crashes' && await pb.locator('[data-thread-panel] >> text=App closes when I open settings').count() === 1)
await pa.waitForFunction(() => [...document.querySelectorAll('[data-forum-post-title]')].some((e) => e.textContent === 'Mobile crashes'))
ok('alice sees the new post appear live with its tag', await pa.locator(`[data-forum-post]:has-text("Mobile crashes") [data-forum-post-tag="${bug.id}"]`).count() === 1)
await pa.click(`[data-forum-post]:has-text("Mobile crashes")`); await pa.waitForSelector('[data-thread-panel] [data-thread-pin]'); await pa.click('[data-thread-pin]')
await pa.waitForFunction(() => document.querySelector('[data-forum-post]')?.textContent?.includes('Mobile crashes'))
ok('pinning from the panel moves the post to the front', true)
await pa.click(`[data-forum-tag="${bug.id}"]`); await pa.waitForFunction((id) => [...document.querySelectorAll('[data-forum-post]')].every((e) => e.querySelector(`[data-forum-post-tag="${id}"]`)), bug.id)
ok('tag filter narrows the grid', await pa.locator('[data-forum-post]').count() === 2)
await pa.click('aside [data-channel-row="help-desk"]', { button: 'right' }); await pa.waitForSelector('[data-context-menu] [data-menu-item="Edit Channel"]'); await pa.click('[data-context-menu] [data-menu-item="Edit Channel"]'); await pa.waitForSelector('[role=dialog]'); await pa.click('[role=dialog] button:has-text("Tags")'); await pa.waitForSelector('[data-forum-tags]')
await pa.fill('[data-forum-tag-name]', 'question'); await pa.click('[data-forum-tag-add]'); await pa.waitForSelector('[data-forum-tag-row]:has-text("question")')
ok('tags are managed from Channel Settings', (await call(a.token, 'GET', `/channels/${f.id}/tags`)).some((t) => t.name === 'question'))
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
