// Moderation tools: kick and ban reasons, deleting a banned member's recent messages, bulk delete (API and /purge),
// slowmode (setting, enforcement, exemptions and the composer countdown) and X-Audit-Log-Reason.
import { chromium } from 'playwright'
import { B, WEB, S, H, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol'), d = await reg('dave')
const g = await call(a.token, 'POST', '/guilds', { name: `Mod ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const u of [b, c, d]) await call(u.token, 'POST', `/invites/${inv.code}`)
const ch = g.channels.find((x) => x.kind === 'text')
const audit = async () => (await call(a.token, 'GET', `/guilds/${g.id}/audit`)) ?? []
const msgs = async () => await call(a.token, 'GET', `/channels/${ch.id}/messages?limit=50`)
const post = (u, content) => call(u.token, 'POST', `/channels/${ch.id}/messages`, { content })

console.log('-- X-Audit-Log-Reason')
await fetch(`${B}/channels/${ch.id}`, { method: 'PATCH', headers: { ...H, Authorization: 'Bearer ' + a.token, 'X-Audit-Log-Reason': encodeURIComponent('Tidying up & more') }, body: JSON.stringify({ topic: 'Rules first' }) })
let entry = (await audit()).find((e) => e.action === 'channel.update')
ok('a reason in the header lands in the audit entry', entry?.details?.reason === 'Tidying up & more', JSON.stringify(entry?.details))

console.log('-- bulk delete')
for (let i = 0; i < 5; i++) await post(c, `carol ${i}`)
ok('members without Manage Messages cannot bulk delete', (await raw(b.token, 'POST', `/channels/${ch.id}/messages/bulk-delete`, { limit: 2 })).status === 403)
ok('limits stay within 1-100', (await raw(a.token, 'POST', `/channels/${ch.id}/messages/bulk-delete`, { limit: 101 })).status === 400)
const byAuthor = await call(a.token, 'POST', `/channels/${ch.id}/messages/bulk-delete`, { limit: 2, author_id: c.user.id })
ok('the newest N of one member', byAuthor.deleted === 2 && (await msgs()).filter((m) => m.content.startsWith('carol')).length === 3)
const ids = (await msgs()).filter((m) => m.content.startsWith('carol')).map((m) => m.id)
const byId = await call(a.token, 'POST', `/channels/${ch.id}/messages/bulk-delete`, { messages: ids })
ok('or specific messages by id', byId.deleted === 3 && !(await msgs()).some((m) => m.content.startsWith('carol')))
ok('bulk deletes are in the audit log', (await audit()).some((e) => e.action === 'message.bulk_delete' && e.details.count === 3))

const browser = await chromium.launch(); const errors = []
const open = async (u) => {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector('[data-composer-box] textarea'); await p.waitForTimeout(700)
  return p
}
const pa = await open(a)
const box = '[data-composer-box] textarea'

console.log('-- /purge')
for (let i = 0; i < 3; i++) await post(b, `bob ${i}`)
await pa.waitForTimeout(500)
await pa.fill(box, '/pur'); await pa.waitForTimeout(150)
ok('moderators see /purge', await pa.locator('[data-command="purge"]').count() === 1)
await pa.fill(box, '/purge 2'); await pa.keyboard.press('Enter'); await pa.waitForSelector('[role=dialog]')
ok('/purge asks first', /newest 2 messages/.test(await pa.locator('[role=dialog]').innerText()))
await pa.click('[role=dialog] button:has-text("Delete")'); await pa.waitForTimeout(800)
ok('then deletes them, live', (await msgs()).filter((m) => m.content.startsWith('bob')).length === 1 && await pa.locator('[data-msg-id]:has-text("bob 2")').count() === 0)

console.log('-- ban deleting history')
for (let i = 0; i < 3; i++) await post(d, `dave ${i}`)
await pa.waitForTimeout(500)
await pa.click(`[data-member-row="${d.user.id}"]`, { button: 'right' }); await pa.click('[data-menu-item^="Ban"]')
await pa.selectOption('[data-ban-history]', String(3600)); await pa.fill('[data-mod-reason]', 'spam'); await pa.click('[data-mod-confirm]'); await pa.waitForTimeout(900)
ok('banning with "previous hour" deletes their recent messages', !(await msgs()).some((m) => m.content.startsWith('dave')))
ok('and they disappear from the open chat', await pa.locator('[data-msg-id]:has-text("dave 1")').count() === 0)
entry = (await audit()).find((e) => e.action === 'member.ban')
// Their three messages plus the "joined the server" notice, which is theirs too.
ok('the audit entry has the reason and the count', entry?.details?.reason === 'spam' && entry?.details?.messages_deleted === 4, JSON.stringify(entry?.details))

console.log('-- kick reason')
await pa.click(`[data-member-row="${b.user.id}"]`, { button: 'right' }); await pa.click('[data-menu-item^="Kick"]')
await pa.fill('[data-mod-reason]', 'cooling off'); await pa.click('[data-mod-confirm]'); await pa.waitForTimeout(700)
entry = (await audit()).find((e) => e.action === 'member.kick')
ok('a kick records its reason', entry?.details?.reason === 'cooling off')
await pa.click('aside button:has-text("Mod")').catch(() => {})

console.log('-- slowmode')
ok('slowmode is limited to 6 hours', (await raw(a.token, 'PATCH', `/channels/${ch.id}`, { rate_limit_per_user: 99999 })).status === 400)
// Someone who just joined (carol posted earlier, so slowmode would already hold her). Their join notice doesn't count.
const e = await reg('erin'); await call(e.token, 'POST', `/invites/${inv.code}`)
await call(a.token, 'PATCH', `/channels/${ch.id}`, { rate_limit_per_user: 30 })
ok('a member who just joined can send straight away', !!(await post(e, 'first')).id)
const second = await raw(e.token, 'POST', `/channels/${ch.id}/messages`, { content: 'second' })
ok('the next message within 30s is refused with how long to wait', second.status === 429 && /in (29|30) seconds/.test((await second.json()).error))
ok('moderators are exempt', !!(await post(a, 'mod one')).id && !!(await post(a, 'mod two')).id)
const pc = await open(c)
ok('the composer shows the slowmode', /Slowmode 30s|\d+s/.test(await pc.locator('[data-slowmode]').innerText()))
await pc.fill(box, 'allowed'); await pc.keyboard.press('Enter'); await pc.waitForTimeout(600)
ok('sending starts the countdown', await pc.locator('[data-slowmode="cooling"]').count() === 1 && /^\d+s$/.test((await pc.locator('[data-slowmode]').innerText()).trim()))
await pc.fill(box, 'too soon'); await pc.keyboard.press('Enter'); await pc.waitForTimeout(500)
ok('while it runs, Enter waits and keeps the text', await pc.inputValue(box) === 'too soon' && !(await msgs()).some((m) => m.content === 'too soon'))
ok('the owner sees that they are exempt', /exempt/.test(await pa.locator('[data-slowmode]').innerText()))
await call(a.token, 'PATCH', `/channels/${ch.id}`, { rate_limit_per_user: 0 })
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
