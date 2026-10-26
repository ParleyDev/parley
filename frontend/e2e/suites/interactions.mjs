// The bot platform: bots on the gateway with intents, slash commands, interactions (answer, ephemeral, deferred
// then filled in, follow-ups) and the "didn't respond" notice.
import { chromium } from 'playwright'
import { B, H, WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const WS = B.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Bots ${S}` })
const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const app = await call(a.token, 'POST', '/applications', { name: `Helper ${S}`, redirect_uris: ['https://bot.example/cb'] })
const bot = await call(a.token, 'POST', `/applications/${app.id}/bot`, {})
await raw(a.token, 'POST', '/oauth2/authorize', { client_id: app.client_id, scope: 'bot', guild_id: g.id })
const asBot = (m, p, body) => fetch(B + p, { method: m, headers: { ...H, Authorization: 'Bot ' + bot.token }, body: body ? JSON.stringify(body) : undefined })
const gateway = (intents) => new Promise((resolve) => {
  const ws = new WebSocket(`${WS}?token=${bot.token}${intents !== undefined ? `&intents=${intents}` : ''}`); const events = []
  ws.onmessage = (e) => { const ev = JSON.parse(e.data); events.push(ev); if (ev.t === 'READY') resolve({ ws, events }) }
  ws.onerror = () => resolve({ ws: null, events }); ws.onclose = () => resolve({ ws: null, events })
})
const until = async (f, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 50)) } return null }

console.log('-- gateway and intents')
ok('privileged intents need switching on', (await gateway(1 << 15)).ws === null)
await call(a.token, 'PATCH', `/applications/${app.id}`, { privileged_intents: 1 << 15 })
const plain = await gateway((1 << 0) | (1 << 9))
ok('a bot connects with its token', !!plain.ws)
await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: `secret plans ${S}` })
const seen = await until(() => plain.events.find((e) => e.t === 'MESSAGE_CREATE' && e.d.message.author.id === b.user.id))
ok('without Message Content it sees the message but not its text', !!seen && seen.d.message.content === '')
await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: `hey <@${bot.bot.id}> help` })
const ment = await until(() => plain.events.find((e) => e.t === 'MESSAGE_CREATE' && e.d.message.content.includes('help')))
ok('unless it is mentioned', !!ment)
await call(b.token, 'POST', `/channels/${ch.id}/typing`)
await new Promise((r) => setTimeout(r, 300))
ok('events it did not ask for are left out', !plain.events.some((e) => e.t === 'TYPING_START'))
plain.ws.close()
const full = await gateway((1 << 0) | (1 << 9) | (1 << 15))
await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: `open plans ${S}` })
ok('with Message Content it reads everything', !!(await until(() => full.events.find((e) => e.t === 'MESSAGE_CREATE' && e.d.message.content === `open plans ${S}`))))

console.log('-- commands')
ok('commands are checked', (await asBot('PUT', `/applications/${app.id}/commands`, [{ name: 'Bad Name', description: 'x' }])).status === 400)
const put = await asBot('PUT', `/applications/${app.id}/commands`, [
  { name: 'echo', description: 'Say it back', options: [{ type: 3, name: 'text', description: 'What to say', required: true }, { type: 3, name: 'mode', description: 'How', choices: [{ name: 'Loud', value: 'loud' }, { name: 'Quiet', value: 'quiet' }] }] },
  { name: 'secret', description: 'Only you see the answer' },
  { name: 'slow', description: 'Takes a moment' },
  { name: 'ignored', description: 'The bot never answers' },
])
ok('the bot registers its slash commands', put.status === 200)
const cmds = await call(b.token, 'GET', `/channels/${ch.id}/commands`)
ok('members see the commands of bots in the server', cmds.length === 4 && cmds.every((c) => c.application.name === `Helper ${S}`))
const id = (n) => cmds.find((c) => c.name === n).id
ok('required options are enforced', (await raw(b.token, 'POST', '/interactions', { command_id: id('echo'), channel_id: ch.id, options: [] })).status === 400)
ok('and choices', (await raw(b.token, 'POST', '/interactions', { command_id: id('echo'), channel_id: ch.id, options: [{ name: 'text', value: 'hi' }, { name: 'mode', value: 'shouty' }] })).status === 400)

// The bot answers: echo (a message), secret (ephemeral), slow (defer, then fill in, then a follow-up).
full.ws.onmessage = async (e) => {
  const ev = JSON.parse(e.data); full.events.push(ev)
  if (ev.t !== 'INTERACTION_CREATE') return
  const { id: iid, token, data } = ev.d
  const cb = (body) => fetch(`${B}/interactions/${iid}/${token}/callback`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  if (data.name === 'echo') await cb({ type: 4, data: { content: `${data.options.find((o) => o.name === 'text').value}${data.options.find((o) => o.name === 'mode')?.value === 'loud' ? '!!!' : ''}` } })
  if (data.name === 'secret') await cb({ type: 4, data: { content: 'just for you', flags: 64 } })
  if (data.name === 'slow') {
    await cb({ type: 5 })
    await new Promise((r) => setTimeout(r, 600))
    await fetch(`${B}/interactions/${iid}/${token}/messages/@original`, { method: 'PATCH', headers: H, body: JSON.stringify({ content: 'done thinking', embeds: [{ title: 'Result', description: '42' }] }) })
    await fetch(`${B}/interactions/${iid}/${token}/followup`, { method: 'POST', headers: H, body: JSON.stringify({ content: 'one more thing' }) })
  }
}

console.log('-- using them')
const browser = await chromium.launch(); const errors = []
const ctx = async (t) => { const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t); return p }
const pb = await ctx(b.token), pa = await ctx(a.token)
await pa.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pb.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pb.waitForSelector('textarea[placeholder^="Message"]')
const box = pb.locator('textarea[placeholder^="Message"]')
await box.fill('/ec'); await pb.waitForSelector('[data-command="echo"]')
ok('app commands show in the / menu with the app name', (await pb.locator('[data-command="echo"] [data-command-app]').innerText()) === `Helper ${S}`)
await box.fill('/echo text:hello there mode:Loud'); await box.press('Enter')
await pb.waitForSelector('[data-interaction-header="echo"]', { timeout: 5000 }).catch(() => {})
const echoRow = pb.locator('[data-msg-id]:has([data-interaction-header="echo"])').last()
const echoText = (await echoRow.innerText()).replace(/\s+/g, ' ')
ok('the bot answers, showing who used which command', echoText.includes('Bob used /echo') && echoText.includes('hello there!!!'), echoText)
ok('everyone sees the answer', await pa.locator('[data-interaction-header="echo"]').count() >= 1)
await box.fill('/secret '); await box.press('Enter')
await pb.waitForSelector('[data-ephemeral]', { timeout: 5000 }).catch(() => {})
ok('an ephemeral answer only shows for the user', (await pb.locator('[data-msg-id]:has([data-ephemeral])').innerText()).includes('just for you'))
await pa.waitForTimeout(500)
ok('not for anyone else', await pa.locator('text=just for you').count() === 0)
ok('and is never stored', !(await call(b.token, 'GET', `/channels/${ch.id}/messages`)).some((m) => m.content === 'just for you'))
await pb.click('[data-ephemeral-dismiss]'); ok('Dismiss removes it', await pb.locator('[data-ephemeral]').count() === 0)
await box.fill('/slow '); await box.press('Enter')
await pb.waitForSelector('[data-interaction-thinking]', { timeout: 5000 }).catch(() => {})
ok('a deferred answer shows the bot thinking', await pb.locator('[data-interaction-thinking]').count() >= 1)
await pb.waitForSelector('text=done thinking', { timeout: 5000 }).catch(() => {})
ok('then fills in, with an embed', await pb.locator('[data-interaction-thinking]').count() === 0 && await pb.locator('[data-msg-id]:has-text("done thinking") [data-rich-embed]').count() === 1)
await pb.waitForSelector('text=one more thing', { timeout: 5000 }).catch(() => {})
ok('follow-ups arrive as more messages', await pb.locator('[data-message-list] [data-msg-id]:has-text("one more thing")').count() === 1, String(await pb.locator('[data-message-list] [data-msg-id]:has-text("one more thing")').count()))
await box.fill('/ignored '); await box.press('Enter')
await pb.waitForSelector("text=didn't respond", { timeout: 6000 }).catch(() => {})
ok("silence is reported after 3 seconds", await pb.locator("text=didn't respond").count() >= 1)
const late = await until(() => full.events.find((e) => e.t === 'INTERACTION_CREATE' && e.d.data.name === 'ignored'))
await new Promise((r) => setTimeout(r, 1000))
ok('answering too late is refused', late && (await fetch(`${B}/interactions/${late.d.id}/${late.d.token}/callback`, { method: 'POST', headers: H, body: JSON.stringify({ type: 4, data: { content: 'sorry' } }) })).status === 400)

ok('no page errors', errors.length === 0, errors.join(' | '))
full.ws.close()
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
