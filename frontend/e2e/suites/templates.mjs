// Server templates: snapshot a server (roles, channels, categories, role overwrites, settings), share the link, and
// create a new server from it.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Tpl ${S}` })
const cat = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'Staff', kind: 'category' })
const staff = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'staff-chat', kind: 'text', parent_id: cat.id })
const role = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Helper', color: '#3498db' })
await call(a.token, 'PUT', `/channels/${staff.id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: 1 << 10 })
await call(a.token, 'PUT', `/channels/${staff.id}/permissions/${role.id}`, { kind: 'role', allow: 1 << 10, deny: 0 })
await call(a.token, 'PUT', `/channels/${staff.id}/permissions/${b.user.id}`, { kind: 'member', allow: 1 << 10, deny: 0 }).catch(() => {})

console.log('-- api')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
ok('members without Manage Server can\'t make one', (await raw(b.token, 'POST', `/guilds/${g.id}/template`, { name: 'x' })).status === 403)

const browser = await chromium.launch(); const errors = []
const ctx = async (t) => { const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t); return p }

console.log('-- settings')
const pa = await ctx(a.token)
await pa.goto(`${WEB}/channels/${g.id}`); await pa.waitForTimeout(800)
await pa.locator(`button:has-text("Tpl ${S}")`).first().click(); await pa.click('text=Server Settings'); await pa.locator('button:has-text("Server Template")').first().click()
await pa.waitForSelector('[data-template-tab]')
await pa.fill('[data-template-title]', `Study group ${S}`); await pa.fill('[data-template-desc]', 'For study groups')
await pa.click('[data-template-generate]'); await pa.waitForSelector('[data-template-link]')
const link = await pa.inputValue('[data-template-link]')
const code = link.split('/').pop()
ok('generating gives a link', /\/template\/\w{12}$/.test(link), link)
ok('a second template is refused', (await raw(a.token, 'POST', `/guilds/${g.id}/template`, { name: 'again' })).status === 409)
await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'added-later', kind: 'text' })
ok('the template is a snapshot', !(await call(b.token, 'GET', `/templates/${code}`)).snapshot.channels.some((c) => c.name === 'added-later'))
await pa.click('[data-template-sync]'); await pa.waitForTimeout(500)
const pv = await call(b.token, 'GET', `/templates/${code}`)
ok('Sync picks up changes', pv.snapshot.channels.some((c) => c.name === 'added-later'))
ok('member overwrites aren\'t copied', pv.snapshot.channels.find((c) => c.name === 'staff-chat').overwrites.length === 2)

console.log('-- use')
const pb = await ctx(b.token)
await pb.goto(`${WEB}/template/${code}`); await pb.waitForSelector('[data-template-page] [data-template-name]')
ok('the template page shows its name, channels and roles', (await pb.locator('[data-template-name]').innerText()) === `Study group ${S}` && (await pb.locator('[data-template-channels]').innerText()).includes('staff-chat') && (await pb.locator('[data-template-roles]').innerText()).includes('Helper'))
await pb.fill('[data-template-server-name]', `Copy ${S}`); await pb.click('[data-template-create]')
await pb.waitForURL(/\/channels\/[0-9a-f-]{36}/, { timeout: 8000 }).catch(() => {})
const ngId = pb.url().match(/\/channels\/([0-9a-f-]{36})/)?.[1]
const ng = ngId ? await call(b.token, 'GET', `/guilds/${ngId}`) : null
ok('Create Server makes a new server owned by you', !!ng && ng.owner_id === b.user.id && ng.name === `Copy ${S}`)
if (ng) {
  const full = await call(b.token, 'GET', `/guilds/${ng.id}/channels`)
  const nstaff = full.find((c) => c.name === 'staff-chat'), ncat = full.find((c) => c.name === 'Staff')
  ok('channels and categories are copied', !!nstaff && !!ncat && nstaff.parent_id === ncat.id && full.some((c) => c.name === 'added-later'))
  const nroles = await call(b.token, 'GET', `/guilds/${ng.id}/roles`)
  const helper = nroles.find((r) => r.name === 'Helper')
  ok('roles are copied', !!helper && helper.color === '#3498db')
  const ows = nstaff?.overwrites ?? []
  ok('role overwrites point at the new roles', ows.some((o) => o.id === ng.id && o.deny === 1 << 10) && ows.some((o) => o.id === helper?.id && o.allow === 1 << 10) && ows.length === 2, JSON.stringify(ows))
  await pb.waitForTimeout(800)
  ok('the sidebar shows the new server', await pb.locator(`[data-channel-row="staff-chat"]`).count() === 1, await pb.evaluate(() => [...document.querySelectorAll('[data-channel-row]')].map((e) => e.getAttribute('data-channel-row')).join(',') + ' ' + location.pathname))
  await call(b.token, 'DELETE', `/guilds/${ng.id}`)
}
ok('usage is counted', (await call(a.token, 'GET', `/guilds/${g.id}/template`)).usage_count === 1)
await call(a.token, 'DELETE', `/guilds/${g.id}/template`)
ok('a deleted template\'s link stops working', (await raw(b.token, 'GET', `/templates/${code}`)).status === 404)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
