// Message components (buttons, select menus), forms (modals), command autocomplete, and user/message commands from
// the Apps menus.
import { chromium } from 'playwright'
import { B, H, WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const WS = B.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Comp ${S}` })
const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const app = await call(a.token, 'POST', '/applications', { name: `Picker ${S}`, redirect_uris: ['https://bot.example/cb'] })
const bot = await call(a.token, 'POST', `/applications/${app.id}/bot`, {})
await raw(a.token, 'POST', '/oauth2/authorize', { client_id: app.client_id, scope: 'bot', guild_id: g.id })
const asBot = (m, p, body) => fetch(B + p, { method: m, headers: { ...H, Authorization: 'Bot ' + bot.token }, body: body ? JSON.stringify(body) : undefined })
const cb = (ev, body) => fetch(`${B}/interactions/${ev.d.id}/${ev.d.token}/callback`, { method: 'POST', headers: H, body: JSON.stringify(body) })
const ws = await new Promise((resolve) => { const w = new WebSocket(`${WS}?token=${bot.token}`); w.onmessage = (e) => { if (JSON.parse(e.data).t === 'READY') resolve(w) } })
const got = []
let ephSource

console.log('-- api')
ok('people can\'t send buttons', (await raw(a.token, 'POST', `/channels/${ch.id}/messages`, { content: 'x', components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Hi', custom_id: 'hi' }] }] })).status === 400)
ok('components are checked', (await asBot('POST', `/channels/${ch.id}/messages`, { content: 'x', components: [{ type: 1, components: [{ type: 2, style: 5, label: 'bad', url: 'javascript:1' }] }] })).status === 400)
const pm = await (await asBot('POST', `/channels/${ch.id}/messages`, { content: `Vote ${S}`, components: [
  { type: 1, components: [{ type: 2, style: 3, label: 'Yes', custom_id: 'yes' }, { type: 2, style: 4, label: 'No', custom_id: 'no' }, { type: 2, style: 2, label: 'Feedback', custom_id: 'form' }, { type: 2, style: 5, label: 'Docs', url: 'https://docs.example' }] },
  { type: 1, components: [{ type: 3, custom_id: 'colour', placeholder: 'Pick colours', min_values: 1, max_values: 2, options: [{ label: 'Red', value: 'red' }, { label: 'Green', value: 'green' }, { label: 'Blue', value: 'blue' }] }] },
] })).json()
ok('bots send buttons and menus', pm.components?.length === 2)
await asBot('PUT', `/applications/${app.id}/commands`, [
  { name: 'city', description: 'Weather for a city', options: [{ type: 3, name: 'name', description: 'City', required: true, autocomplete: true }] },
  { type: 2, name: 'High five' },
  { type: 3, name: 'Bookmark it' },
  { name: 'ask', description: 'Ask privately' },
])
ok('menu picks must be real options', (await raw(b.token, 'POST', '/interactions/component', { channel_id: ch.id, message_id: pm.id, custom_id: 'colour', values: ['purple'] })).status === 400)
ok('unknown buttons are refused', (await raw(b.token, 'POST', '/interactions/component', { channel_id: ch.id, message_id: pm.id, custom_id: 'nope' })).status === 400)

ws.onmessage = async (e) => {
  const ev = JSON.parse(e.data); if (ev.t !== 'INTERACTION_CREATE') return; got.push(ev)
  const d = ev.d.data
  if (ev.d.type === 3 && d.custom_id === 'yes') await cb(ev, { type: 7, data: { content: `Vote ${S}: ${ev.d.user.display_name} said yes`, components: [{ type: 1, components: [{ type: 2, style: 3, label: 'Yes', custom_id: 'yes', disabled: true }] }] } })
  if (ev.d.type === 3 && d.custom_id === 'colour') await cb(ev, { type: 4, data: { content: `you picked ${d.values.join(' and ')}`, flags: 64 } })
  if (ev.d.type === 3 && d.custom_id === 'form') await cb(ev, { type: 9, data: { title: 'Feedback', custom_id: 'fb', components: [{ type: 1, components: [{ type: 4, custom_id: 'what', label: 'What do you think?', style: 2, required: true }] }] } })
  if (ev.d.type === 5) await cb(ev, { type: 4, data: { content: `thanks: ${d.components[0].value}` } })
  if (ev.d.type === 4) { const q = d.options.find((o) => o.focused).value.toLowerCase(); await cb(ev, { type: 8, data: { choices: ['London', 'Lisbon', 'Lima', 'Paris'].filter((c) => c.toLowerCase().startsWith(q)).map((c) => ({ name: c, value: c })) } }) }
  if (ev.d.type === 2 && d.name === 'ask') await cb(ev, { type: 4, data: { content: `private question ${S}`, flags: 64, components: [{ type: 1, components: [{ type: 2, style: 1, label: 'OK', custom_id: 'eph-ok' }] }] } })
  if (ev.d.type === 3 && d.custom_id === 'eph-ok') { ephSource = ev.d.message; await cb(ev, { type: 7, data: { content: `answered privately ${S}`, components: [] } }) }
  if (ev.d.type === 2 && d.name === 'city') await cb(ev, { type: 4, data: { content: `sunny in ${d.options[0].value}` } })
  if (ev.d.type === 2 && d.name === 'High five') await cb(ev, { type: 4, data: { content: `high five <@${d.target_id}>!` } })
  if (ev.d.type === 2 && d.name === 'Bookmark it') await cb(ev, { type: 4, data: { content: `bookmarked: ${d.resolved.messages[d.target_id].content}`, flags: 64 } })
}

const browser = await chromium.launch(); const errors = []
const ctx = async (t) => { const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t); return p }
const pb = await ctx(b.token)
await pb.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pb.waitForSelector(`[data-msg-id="${pm.id}"] [data-components]`)

console.log('-- buttons and menus')
ok('buttons and the menu render', await pb.locator(`[data-msg-id="${pm.id}"] [data-component-button]`).count() === 3 && await pb.locator(`[data-msg-id="${pm.id}"] [data-component-link="Docs"]`).count() === 1)
await pb.click(`[data-msg-id="${pm.id}"] [data-component-button="yes"]`)
await pb.waitForSelector(`[data-msg-id="${pm.id}"]:has-text("said yes")`, { timeout: 5000 }).catch(() => {})
ok('a button can update its message', (await pb.locator(`[data-msg-id="${pm.id}"]`).innerText()).includes('Bob said yes') && await pb.locator(`[data-msg-id="${pm.id}"] [data-component-button="yes"]`).isDisabled())
const pm2 = await (await asBot('POST', `/channels/${ch.id}/messages`, { content: 'Menu', components: [{ type: 1, components: [{ type: 3, custom_id: 'colour', min_values: 1, max_values: 2, options: [{ label: 'Red', value: 'red' }, { label: 'Green', value: 'green' }] }] }, { type: 1, components: [{ type: 2, style: 2, label: 'Feedback', custom_id: 'form' }] }] })).json()
await pb.waitForSelector(`[data-msg-id="${pm2.id}"] [data-component-select="colour"]`)
await pb.click(`[data-msg-id="${pm2.id}"] [data-component-select="colour"] button`); await pb.click('[data-select-option="red"]'); await pb.click('[data-select-option="green"]'); await pb.click('[data-select-done]')
await pb.waitForSelector('text=you picked red and green', { timeout: 5000 }).catch(() => {})
ok('a multi-select sends its picks', await pb.locator('[data-message-list] [data-msg-id]:has-text("you picked red and green")').count() === 1)

console.log('-- forms')
await pb.click(`[data-msg-id="${pm2.id}"] [data-component-button="form"]`)
await pb.waitForSelector('[data-app-modal="fb"]', { timeout: 5000 }).catch(() => {})
ok('a bot can open a form', await pb.locator('[data-app-modal="fb"]').count() === 1)
ok('required fields block submit', await pb.locator('[data-app-modal-submit]').isDisabled())
await pb.fill('[data-app-modal-input="what"]', 'love it'); await pb.click('[data-app-modal-submit]')
await pb.waitForSelector('text=thanks: love it', { timeout: 5000 }).catch(() => {})
ok('the answers reach the bot', await pb.locator('[data-message-list] [data-msg-id]:has-text("thanks: love it")').count() === 1)

console.log('-- autocomplete')
const box = pb.locator('textarea[placeholder^="Message"]')
await box.fill('/city '); await pb.waitForSelector('[data-option-hints]')
ok('typing a command shows its options', (await pb.locator('[data-option-hints]').innerText()).includes('name'))
await box.fill('/city name:li'); await pb.waitForSelector('[data-option-choice="Lisbon"]', { timeout: 5000 }).catch(() => {})
ok('the app suggests values as you type', await pb.locator('[data-option-choice="Lisbon"]').count() === 1 && await pb.locator('[data-option-choice="Lima"]').count() === 1 && await pb.locator('[data-option-choice="London"]').count() === 0)
await pb.click('[data-option-choice="Lisbon"]'); ok('picking fills it in', (await box.inputValue()) === '/city name:Lisbon ')
await box.press('Enter'); await pb.waitForSelector('text=sunny in Lisbon', { timeout: 5000 }).catch(() => {})
ok('and the command runs', await pb.locator('[data-message-list] [data-msg-id]:has-text("sunny in Lisbon")').count() === 1)

console.log('-- private answers')
await box.fill('/ask '); await box.press('Enter')
const q = pb.locator(`[data-message-list] [data-msg-id]:has-text("private question ${S}")`)
await q.waitFor({ timeout: 5000 }).catch(() => {})
await q.locator('[data-component-button="eph-ok"]').click()
const done = pb.locator(`[data-message-list] [data-msg-id]:has-text("answered privately ${S}")`)
await done.waitFor({ timeout: 5000 }).catch(() => {})
ok('a button on a private answer updates it in place', await done.count() === 1 && await q.count() === 0 && await done.locator('[data-component-button]').count() === 0)
ok('the bot is sent the private answer it is on', ephSource?.content === `private question ${S}` && ephSource?.ephemeral === true)

console.log('-- bots edit embeds and buttons')
const edit = (m, body, as = asBot) => as('PATCH', `/channels/${ch.id}/messages/${m.id}`, body)
const mine = await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: `just text ${S}` })
ok('people can\'t edit embeds', (await raw(a.token, 'PATCH', `/channels/${ch.id}/messages/${mine.id}`, { embeds: [{ title: 'x' }] })).status === 400)
await call(a.token, 'DELETE', `/channels/${ch.id}/messages/${mine.id}`)
ok('nor another\'s message\'s buttons', (await raw(a.token, 'PATCH', `/channels/${ch.id}/messages/${pm2.id}`, { components: [] })).status === 403)
let r = await edit(pm2, { embeds: [{ title: `Poll closed ${S}`, description: 'Thanks for voting' }], components: [{ type: 1, components: [{ type: 2, style: 2, label: 'Closed', custom_id: 'closed', disabled: true }] }] })
const em = await r.json()
ok('a bot changes its message\'s embeds and buttons', r.status === 200 && em.embeds?.[0]?.title === `Poll closed ${S}` && em.components?.[0]?.components?.[0]?.custom_id === 'closed' && em.content === 'Menu')
await pb.waitForSelector(`[data-msg-id="${pm2.id}"] [data-component-button="closed"]`, { timeout: 5000 }).catch(() => {})
ok('and people see it change', await pb.locator(`[data-msg-id="${pm2.id}"]:has-text("Poll closed ${S}")`).count() === 1 && await pb.locator(`[data-msg-id="${pm2.id}"] [data-component-select]`).count() === 0)
r = await edit(pm2, { components: [] }); const nc = await r.json()
ok('an empty list removes the buttons and keeps the rest', r.status === 200 && !nc.components && nc.embeds?.length === 1)
ok('components are checked on edit', (await edit(pm2, { components: [{ type: 1, components: [{ type: 2, style: 5, label: 'bad', url: 'javascript:1' }] }] })).status === 400)
r = await edit(pm2, { content: '' }); ok('a message with an embed can lose its text', r.status === 200 && (await r.json()).content === '')
ok('but not its last embed too', (await edit(pm2, { embeds: [] })).status === 400)
r = await edit(pm2, { content: 'Menu again', embeds: null }); const back = await r.json()
ok('text and no embeds', r.status === 200 && back.content === 'Menu again' && !back.embeds?.length)

console.log('-- apps menus')
const target = await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: `remember this ${S}` })
await pb.waitForSelector(`[data-msg-id="${target.id}"]`)
await pb.click(`[data-msg-id="${target.id}"] .msg-content`, { button: 'right' }); await pb.hover('[data-context-menu] [data-menu-item="Apps"]')
await pb.click('[data-context-menu] [data-menu-item="Bookmark it"]')
await pb.waitForSelector(`text=bookmarked: remember this ${S}`, { timeout: 5000 }).catch(() => {})
ok('message commands from the Apps menu', await pb.locator(`[data-message-list] [data-msg-id]:has-text("bookmarked: remember this ${S}")`).count() === 1)
await pb.click(`[data-msg-id="${target.id}"] [data-msg-author]`, { button: 'right' }); await pb.hover('[data-context-menu] [data-menu-item="Apps"]')
await pb.click('[data-context-menu] [data-menu-item="High five"]')
await pb.waitForSelector('text=high five', { timeout: 5000 }).catch(() => {})
ok('user commands from the Apps menu', await pb.locator('[data-message-list] [data-msg-id]:has-text("high five")').count() >= 1)

ok('no page errors', errors.length === 0, errors.join(' | '))
ws.close()
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
