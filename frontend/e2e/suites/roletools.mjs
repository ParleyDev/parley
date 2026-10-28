// Role tools: icons (emoji or image) next to names in chat and the member list, the "Allow anyone to @mention this
// role" switch (role mentions only ping when it's on, or for members who can mention everyone), Duplicate Role, member
// counts per role, clicking a @role to see who has it, and the holographic name style.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Roles ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const ch = g.channels.find((x) => x.kind === 'text')
const helper = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Helper', permissions: 1 << 13 })
await call(a.token, 'PATCH', `/guilds/${g.id}/members/${b.user.id}`, { roles: [helper.id] })
const roleNow = async (id) => (await call(a.token, 'GET', `/guilds/${g.id}/roles`)).find((r) => r.id === id)
// @everyone can mention everyone by default (as in Discord); take that away so Bob is a plain member.
const everyone = await roleNow(g.id)
await call(a.token, 'PATCH', `/guilds/${g.id}/roles/${g.id}`, { permissions: everyone.permissions & ~(1 << 17) })

console.log('-- mentionable')
ok('new roles start unmentionable', helper.mentionable === false)
let m = await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: `hey <@&${helper.id}>` })
ok('so a plain member\'s @role does not ping', m.mention_roles.length === 0)
m = await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: `team <@&${helper.id}>` })
ok('members who can mention everyone still ping it', m.mention_roles.includes(helper.id))

const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector('[data-member-list]'); await p.waitForTimeout(600)

console.log('-- role mention popover')
await p.locator(`[data-mention-role="${helper.id}"]`).last().click(); await p.waitForSelector(`[data-role-members="${helper.id}"]`)
await p.waitForSelector(`[data-role-member="${b.user.id}"]`, { timeout: 5000 }).catch(() => {})
ok('clicking a @role lists who has it', await p.locator(`[data-role-members="${helper.id}"] [data-role-member="${b.user.id}"]`).count() === 1)
await p.mouse.click(5, 5); await p.waitForTimeout(200)

console.log('-- Roles tab')
await p.click(`aside button:has-text("Roles ${S}")`); await p.click('text=Server Settings'); await p.waitForTimeout(400)
await p.click('[role=dialog] button:has-text("Roles")'); await p.waitForTimeout(700)
ok('each role shows how many members have it', (await p.locator(`[data-role-count="${helper.id}"]`).innerText()).trim() === '1')
await p.click('[role=dialog] div.cursor-pointer:has-text("Helper")'); await p.waitForTimeout(300)
await p.click('[data-role-mentionable] [role=switch]'); await p.fill('[data-role-icon-emoji]', '🔥')
await p.click('[role=dialog] button:has-text("Save Changes")'); await p.waitForTimeout(700)
let r = await roleNow(helper.id)
ok('the switch and the emoji icon save', r.mentionable === true && r.icon === '🔥')
m = await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: `ping <@&${helper.id}>` })
ok('now anyone can ping it', m.mention_roles.includes(helper.id))
await p.click('[data-role-duplicate]'); await p.waitForTimeout(800)
const copy = (await call(a.token, 'GET', `/guilds/${g.id}/roles`)).find((x) => x.name === 'Helper (copy)')
ok('Duplicate Role copies permissions, icon and settings', !!copy && copy.permissions === helper.permissions && copy.icon === '🔥' && copy.mentionable === true)
ok('invalid icons are refused', (await raw(a.token, 'PATCH', `/guilds/${g.id}/roles/${helper.id}`, { icon: 'https://evil.example/x.png' })).status === 400)
await p.keyboard.press('Escape'); await p.waitForTimeout(400)

console.log('-- icons next to names')
ok('the member list shows the role icon', await p.locator(`[data-member-row="${b.user.id}"] [data-role-icon]`).count() === 1)
ok('so does their message', await p.locator(`[data-msg-id="${m.id}"] [data-role-icon]`).count() === 1)

console.log('-- holographic')
const holo = await raw(a.token, 'PATCH', `/guilds/${g.id}/roles/${helper.id}`, { name_style: { font: 'default', effect: 'holographic', colors: ['#a9c9ff', '#ffbbec', '#c6f7e2'] } })
ok('the holographic style is accepted', holo.status === 200 && (await holo.json()).name_style.effect === 'holographic')
await p.waitForTimeout(500)
ok('and names render with it', await p.locator(`[data-member-row="${b.user.id}"] .ne-holographic`).count() >= 1)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
