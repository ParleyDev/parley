import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Cats ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const general = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
const mk = (body, t = a.token) => callS(t, 'POST', `/guilds/${g.id}/channels`, body)
const vis = async (t) => (await call(t, 'GET', `/guilds/${g.id}/channels`)).map((c) => c.name)

console.log('-- API')
let r = await mk({ name: 'Staff Zone', kind: 'category' }); ok('create a category (name kept as typed)', r.status === 201 && r.body.kind === 'category' && r.body.name === 'Staff Zone' && r.body.parent_id === null); const cat = r.body
r = await mk({ name: 'nested', kind: 'category', parent_id: cat.id }); ok('categories cannot nest', r.status === 400)
r = await mk({ name: 'staff-chat', parent_id: cat.id }); ok('text channel created inside the category', r.status === 201 && r.body.parent_id === cat.id); const chat = r.body
r = await mk({ name: 'Staff Voice', kind: 'voice', parent_id: cat.id }); ok('voice channel inside too', r.status === 201 && r.body.parent_id === cat.id); const vc = r.body
r = await mk({ name: 'bad', parent_id: general.id }); ok('parent must be a category', r.status === 400)
r = await mk({ name: 'bad', parent_id: g.id }); ok('unknown parent refused', r.status === 400)
r = await mk({ name: 'x', kind: 'category' }, b.token); ok('needs Manage Channels', r.status === 403)
r = await callS(a.token, 'POST', `/channels/${cat.id}/messages`, { content: 'hi' }); ok('categories hold no messages', r.status === 400)
// inherited overwrites: make the category private
await callS(a.token, 'PUT', `/channels/${cat.id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: 1024 })
let names = await vis(b.token)
ok('a private category hides its channels from members without their own overwrites', !names.includes('Staff Zone') && !names.includes('staff-chat') && !names.includes('Staff Voice') && names.includes(general.name))
ok('the channel reports the inherited overwrites', (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((c) => c.id === chat.id).overwrites.some((o) => o.id === g.id && o.deny === 1024))
await callS(a.token, 'PUT', `/channels/${chat.id}/permissions/${g.id}`, { kind: 'role', allow: 1024, deny: 0 })
names = await vis(b.token); ok('a channel with its own overwrites stops inheriting', names.includes('staff-chat') && !names.includes('Staff Voice'))
await callS(a.token, 'DELETE', `/channels/${chat.id}/permissions/${g.id}`)
// move out via PATCH
r = await callS(a.token, 'PATCH', `/channels/${vc.id}`, { parent_id: null }); ok('PATCH parent_id null moves a channel to the top level', r.status === 200 && r.body.parent_id === null)
ok('…and bob can see it again', (await vis(b.token)).includes('Staff Voice'))
r = await callS(a.token, 'PATCH', `/channels/${vc.id}`, { parent_id: cat.id }); ok('PATCH parent_id moves it back', r.body.parent_id === cat.id)
// bulk reorder
const extra = (await mk({ name: 'zeta' })).body
r = await callS(a.token, 'PATCH', `/guilds/${g.id}/channels/positions`, { items: [{ id: extra.id, position: 0, parent_id: null }, { id: general.id, position: 1 }, { id: chat.id, position: 2, parent_id: null }, { id: vc.id, position: 3 }] })
ok('bulk reorder returns the guild channels with new positions and parents', r.status === 200 && r.body.find((c) => c.id === extra.id).position === 0 && r.body.find((c) => c.id === chat.id).parent_id === null && r.body.find((c) => c.id === vc.id).parent_id === cat.id)
r = await callS(b.token, 'PATCH', `/guilds/${g.id}/channels/positions`, { items: [{ id: extra.id, position: 5 }] }); ok('reorder needs Manage Channels', r.status === 403)
r = await callS(a.token, 'PATCH', `/guilds/${g.id}/channels/positions`, { items: [{ id: cat.id, position: 9, parent_id: cat.id }] }); ok('a category cannot be given a parent', r.status === 400)
await callS(a.token, 'PATCH', `/guilds/${g.id}/channels/positions`, { items: [{ id: chat.id, position: 2, parent_id: cat.id }] })
await callS(a.token, 'DELETE', `/channels/${cat.id}/permissions/${g.id}`)
r = await callS(a.token, 'DELETE', `/channels/${cat.id}`); ok('deleting a category keeps its channels', r.status === 204 && (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((c) => c.id === chat.id)?.parent_id === null)
ok('audit log records the reorder', (await call(a.token, 'GET', `/guilds/${g.id}/audit`)).some((e) => e.action === 'channel.reorder'))

console.log('-- UI')
const cat2 = (await mk({ name: 'Games', kind: 'category' })).body
await callS(a.token, 'PATCH', `/channels/${chat.id}`, { parent_id: cat2.id })
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${general.id}`); await p.waitForSelector(`[data-category="${cat2.id}"]`)
ok('sidebar shows the category with its channel nested and others on top', await p.locator(`[data-category="${cat2.id}"] [data-channel-item="${chat.id}"]`).count() === 1 && await p.locator(`[data-channel-group=""] [data-channel-item="${general.id}"]`).count() === 1)
await p.click(`[data-category="${cat2.id}"] [data-category-toggle]`); await p.waitForSelector(`[data-category="${cat2.id}"][data-category-open="0"]`)
ok('collapsing hides the read channel', await p.locator(`[data-category="${cat2.id}"] [data-channel-item="${chat.id}"]`).count() === 0)
await p.reload(); await p.waitForSelector(`[data-category="${cat2.id}"][data-category-open="0"]`)
ok('collapse state persists', true)
await p.click(`[data-category="${cat2.id}"] [data-category-toggle]`); await p.waitForSelector(`[data-category="${cat2.id}"] [data-channel-item="${chat.id}"]`)
// drag #zeta onto the category header
await p.locator(`[data-channel-item="${extra.id}"]`).dragTo(p.locator(`[data-category="${cat2.id}"]`), { targetPosition: { x: 40, y: 8 } })
await p.waitForSelector(`[data-category="${cat2.id}"] [data-channel-item="${extra.id}"]`)
await p.waitForFunction((id) => true, extra.id); await p.waitForTimeout(400)
ok('dragging a channel onto a category moves it there and persists', (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((c) => c.id === extra.id)?.parent_id === cat2.id)
await p.screenshot({ path: '111-categories.png' })
// category context menu -> create channel inside
await p.click(`[data-category="${cat2.id}"] [data-category-toggle]`, { button: 'right' }); await p.waitForSelector('[data-context-menu] [data-menu-item="Create Channel"]'); await p.click('[data-context-menu] [data-menu-item="Create Channel"]')
await p.waitForSelector('[data-channel-name]'); ok('Create Channel from a category preselects it', await p.inputValue('select[data-channel-parent]') === cat2.id)
await p.fill('[data-channel-name]', 'lounge'); await p.click('form#create-channel button[type=submit], button:has-text("Create Channel") >> nth=-1'); await p.waitForSelector(`[data-category="${cat2.id}"] [data-channel-row="lounge"]`)
ok('the new channel lands in the category', true)
// create a category from the modal
await p.click('[data-create-category-hint]'); await p.waitForSelector('[data-channel-kind="category"]'); await p.click('[data-channel-kind="category"]'); await p.fill('[data-channel-name]', 'Off Topic'); await p.click('button:has-text("Create Channel") >> nth=-1')
await p.waitForFunction(() => [...document.querySelectorAll('[data-category] [data-category-toggle]')].some((e) => e.textContent?.includes('Off Topic')))
ok('categories can be created from the modal', true)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
