// Webhooks (secret URLs that post into a channel), rich embeds from webhooks and bots, and rate-limit headers.
import { chromium } from 'playwright'
import { B, H, WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Hook ${S}` })
const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const post = (url, body) => fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) })

console.log('-- manage')
ok('members without Manage Channels can\'t make webhooks', (await raw(b.token, 'POST', `/channels/${ch.id}/webhooks`, { name: 'x' })).status === 403)
const browser = await chromium.launch(); const errors = []
const ctx = async (t) => { const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t); return p }
const pa = await ctx(a.token)
await pa.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pa.waitForTimeout(800)
await pa.locator(`[data-channel-row="${ch.name}"]`).click({ button: 'right' }); await pa.click('[data-context-menu] [data-menu-item="Edit Channel"]')
await pa.locator('button:has-text("Integrations")').first().click(); await pa.waitForSelector('[data-webhooks]')
await pa.click('[data-webhook-new]'); await pa.waitForSelector('[data-webhook-url]')
const url = await pa.inputValue('[data-webhook-url]')
ok('New Webhook shows its secret URL once', /\/api\/webhooks\/[0-9a-f-]{36}\/\w+$/.test(url), url)
const [, id, token] = url.match(/webhooks\/([0-9a-f-]{36})\/(\w+)$/)
await pa.fill(`[data-webhook-name="${id}"]`, 'CI'); await pa.locator('[data-webhooks] h2').click(); await pa.waitForTimeout(500)
ok('renaming it sticks', (await call(a.token, 'GET', `/channels/${ch.id}/webhooks`))[0].name === 'CI')
await pa.keyboard.press('Escape'); await pa.waitForTimeout(300); await pa.keyboard.press('Escape')

console.log('-- execute')
const hook = `${B}/webhooks/${id}/${token}`
ok('a wrong token is refused', (await post(`${B}/webhooks/${id}/nope`, { content: 'x' })).status === 404)
ok('empty posts are refused', (await post(hook, { content: '' })).status === 400)
ok('embeds are checked', (await post(hook, { embeds: [{ url: 'javascript:alert(1)' }] })).status === 400)
const r = await post(`${hook}?wait=true`, { content: `deploy done ${S} <@${b.user.id}>`, username: 'Deploy Bot', embeds: [{ title: 'Build #42 passed', description: 'All **green**', color: 0x2ecc71, fields: [{ name: 'Branch', value: 'main', inline: true }, { name: 'Time', value: '3m', inline: true }], footer: { text: 'ci' } }] })
const m = await r.json()
ok('posting works without logging in, with ?wait returning the message', r.status === 200 && m.webhook_id === id && m.author.bot === true)
ok('the name can be overridden per message', m.author.display_name === 'Deploy Bot')
ok('user mentions ping by default', m.mentions.includes(b.user.id))
ok('the embed is stored cleaned', m.embeds?.[0]?.title === 'Build #42 passed' && m.embeds[0].fields.length === 2)
await pa.waitForSelector(`[data-msg-id="${m.id}"] [data-rich-embed]`)
ok('the embed renders with its fields', (await pa.locator(`[data-msg-id="${m.id}"] [data-rich-embed]`).innerText()).includes('Branch') && await pa.locator(`[data-msg-id="${m.id}"] [data-bot-tag]`).count() === 1)
ok('responses say how much rate limit is left', r.headers.get('x-ratelimit-bucket') === 'webhooks' && Number(r.headers.get('x-ratelimit-remaining')) >= 0 && r.headers.get('x-ratelimit-limit') !== null)
const sent = await raw(a.token, 'POST', `/channels/${ch.id}/messages`, { content: 'normal message' })
ok('normal message sends carry them too', sent.headers.get('x-ratelimit-bucket') === 'messages')
let limited = false
for (let i = 0; i < 40 && !limited; i++) { const x = await post(hook, { content: `spam ${i}` }); if (x.status === 429) limited = !!x.headers.get('retry-after') }
ok('each webhook is rate limited', limited)

console.log('-- bots')
ok('people can\'t send embeds', (await raw(a.token, 'POST', `/channels/${ch.id}/messages`, { content: 'x', embeds: [{ title: 'fake' }] })).status === 400)
const app = await call(a.token, 'POST', '/applications', { name: `Bot ${S}`, redirect_uris: ['https://bot.example/cb'] })
const bot = await call(a.token, 'POST', `/applications/${app.id}/bot`, {})
const au = await raw(a.token, 'POST', '/oauth2/authorize', { client_id: app.client_id, scope: 'bot', guild_id: g.id }); if (au.status !== 200) console.log('authorize', au.status, await au.text())
const br = await fetch(`${B}/channels/${ch.id}/messages`, { method: 'POST', headers: { ...H, Authorization: 'Bot ' + bot.token }, body: JSON.stringify({ embeds: [{ title: 'Hello from a bot', color: 0x5865f2 }] }) })
const bj = await br.json(); ok('bots can send embeds without text', br.status === 201 && bj.embeds?.[0]?.title === 'Hello from a bot', br.status + ' ' + JSON.stringify(bj).slice(0, 200))

console.log('-- integrations tab')
const integ = await call(a.token, 'GET', `/guilds/${g.id}/integrations`)
ok('Integrations lists the bot and the webhook', integ.bots.some((x) => x.id === bot.bot.id) && integ.webhooks.some((w) => w.id === id))
await pa.locator(`button:has-text("Hook ${S}")`).first().click(); await pa.click('text=Server Settings'); await pa.locator('button:has-text("Integrations")').first().click()
await pa.waitForSelector(`[data-integration-bot="${bot.bot.id}"]`)
ok('the tab shows them', await pa.locator(`[data-integration-webhook="${id}"]`).count() === 1)
await pa.keyboard.press('Escape')

console.log('-- delete')
await call(a.token, 'DELETE', `/webhooks/${id}`)
ok('a deleted webhook\'s URL stops working', (await fetch(hook)).status === 404) // GET isn't rate limited
ok('webhook users never show in user search', !(await call(a.token, 'GET', '/users/search?q=webhook')).some((u) => u.username.startsWith('webhook_')))
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
