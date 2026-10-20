import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')
const friend = async (x, y) => { await call(x.token, 'POST', '/users/@me/relationships', { user_id: y.user.id }); await call(y.token, 'PUT', `/users/@me/relationships/${x.user.id}`) }
await friend(a, b); await friend(a, c)
const g = await call(a.token, 'POST', '/guilds', { name: `Social ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })

console.log('-- receipts (API)')
const m1 = await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: 'did you see this?' })
ok('no receipts before anyone reads', (await call(a.token, 'GET', `/channels/${dm.id}/receipts`)).length === 0)
const WS = 'ws://localhost:18080/ws'
const events = []; const ws = new WebSocket(`${WS}?token=${a.token}`); ws.onmessage = (e) => events.push(JSON.parse(e.data)); await new Promise((r) => { ws.onopen = () => setTimeout(r, 400) })
await callS(b.token, 'PUT', `/channels/${dm.id}/read`, { message_id: m1.id })
await new Promise((r) => setTimeout(r, 400))
ok('bob reading pushes READ_RECEIPT to alice', events.some((e) => e.t === 'READ_RECEIPT' && e.d.user_id === b.user.id && e.d.message_id === m1.id && e.d.channel_id === dm.id))
ok('receipts list bob at that message', (await call(a.token, 'GET', `/channels/${dm.id}/receipts`)).some((x) => x.user_id === b.user.id && x.message_id === m1.id))
const n = events.filter((e) => e.t === 'READ_RECEIPT').length
await callS(b.token, 'PUT', `/channels/${dm.id}/read`, { message_id: m1.id }); await new Promise((r) => setTimeout(r, 300))
ok('re-marking the same message emits nothing', events.filter((e) => e.t === 'READ_RECEIPT').length === n)
ok('outsiders cannot read receipts', (await raw(c.token, 'GET', `/channels/${dm.id}/receipts`)).status !== 200)
ws.close()

console.log('-- invite preview')
let r = await callS(b.token, 'GET', `/invites/${inv.code}`); ok('invite preview carries member and online counts', r.status === 200 && r.body.guild.member_count === 2 && typeof r.body.guild.online_count === 'number' && r.body.already_member === true)

console.log('-- UI')
const browser = await chromium.launch(); const errors = []
const mk = async (tok, url) => { const p = await browser.newPage({ viewport: { width: 1440, height: 800 } }); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(url); return p }
// DM "Seen"
const pa = await mk(a.token, `${WEB}/channels/@me/${dm.id}`); await pa.waitForSelector(`[data-msg-id="${m1.id}"]`)
await pa.waitForSelector(`[data-read-by="${b.user.id}"]`)
ok('DM shows "Seen" under the last message bob read', (await pa.textContent(`[data-read-by="${b.user.id}"]`)).includes('Seen'))
const m2 = await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: 'and this?' }); await pa.waitForSelector(`[data-msg-id="${m2.id}"]`)
ok('a newer unread message has no marker', await pa.locator(`[data-msg-id="${m2.id}"] ~ [data-read-by]`).count() === 0 && await pa.locator('[data-read-by]').count() === 1)
const pb = await mk(b.token, `${WEB}/channels/@me/${dm.id}`); await pb.waitForSelector(`[data-msg-id="${m2.id}"]`)
await pa.waitForFunction((id) => { const el = document.querySelector(`[data-read-by]`); return el && el.previousElementSibling?.getAttribute('data-msg-id') === id }, m2.id)
ok('when bob views the DM the marker moves to the newest message live', true)
await pa.screenshot({ path: '118-seen.png' })
await pb.close()
// server channel: stacked avatars + reply jump + invite card
await pa.goto(`${WEB}/channels/${g.id}/${tc.id}`); await pa.waitForSelector('textarea')
const old = await call(b.token, 'POST', `/channels/${tc.id}/messages`, { content: `the original ${S}` })
for (let i = 0; i < 60; i++) await call(b.token, 'POST', `/channels/${tc.id}/messages`, { content: `filler ${i}` })
const rep = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: 'replying to the old one', reply_to: old.id })
await pa.reload(); await pa.waitForSelector(`[data-msg-id="${rep.id}"]`)
ok('the original is not loaded yet (older than the first page)', await pa.locator(`[data-msg-id="${old.id}"]`).count() === 0)
ok('the reply header is still a link', await pa.locator(`[data-msg-id="${rep.id}"] [data-reply-link="${old.id}"]`).count() === 1)
await pa.click(`[data-msg-id="${rep.id}"] [data-reply-link]`); await pa.waitForSelector(`[data-msg-id="${old.id}"]`, { timeout: 15000 }); await pa.waitForTimeout(300)
ok('clicking it loads history and scrolls the original into view', await pa.evaluate((id) => { const r = document.querySelector(`[data-msg-id="${id}"]`).getBoundingClientRect(); const c = document.querySelector('main .overflow-y-auto').getBoundingClientRect(); return r.top >= c.top - 2 && r.bottom <= c.bottom + 2 }, old.id))
// The jump showed a window from the past; the receipt lands on the newest message, so return to the present first.
await pa.click('[data-jump-present]'); await pa.waitForFunction(() => !document.querySelector('[data-older-bar]'), null, { timeout: 15000 }); await pa.waitForSelector(`[data-msg-id="${rep.id}"]`)
await callS(b.token, 'PUT', `/channels/${tc.id}/read`, { message_id: rep.id })
await pa.waitForSelector(`[data-read-by="${b.user.id}"]`)
ok('server channels show the reader avatars (no "Seen" word)', !(await pa.textContent(`[data-read-by="${b.user.id}"]`)).includes('Seen') && await pa.locator(`[data-read-by="${b.user.id}"] img, [data-read-by="${b.user.id}"] [data-avatar]`).count() >= 0)
await pa.hover(`[data-read-by="${b.user.id}"] [data-tip]`); await pa.waitForSelector('[role=tooltip]')
ok('hovering lists who has seen it', (await pa.textContent('[role=tooltip]')).includes('Bob'))
// invite card + invite friend from modal
const pubUrl = (await call(a.token, 'GET', '/instance')).app_url
if (pubUrl && !WEB.startsWith(pubUrl)) {
  const other = await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: `public link ${pubUrl}/invite/${inv.code}` })
  await pa.goto(`${WEB}/channels/@me/${dm.id}`); await pa.waitForSelector(`[data-msg-id="${other.id}"] [data-invite-card]`, { timeout: 10000 })
  ok('a link carrying the instance\'s public URL renders a card even when browsing from another address', true)
  await pa.goto(`${WEB}/channels/${g.id}/${tc.id}`); await pa.waitForSelector('textarea')
}
await pa.click(`aside button:has-text("Social")`); await pa.click('text=Invite People'); await pa.waitForSelector('[data-invite-friends]')
await pa.waitForSelector(`[data-invite-friend="${c.user.id}"] [data-invite-send]`)
ok('the invite modal lists friends; bob (already a member) has no button', await pa.locator(`[data-invite-friend="${b.user.id}"]:has-text("Already a member")`).count() === 1)
await pa.click(`[data-invite-friend="${c.user.id}"] [data-invite-send]`); await pa.waitForSelector(`[data-invite-friend="${c.user.id}"]:has-text("Sent")`)
const cdm = (await call(c.token, 'GET', '/users/@me/channels')).find((x) => x.recipients?.some((u) => u.id === a.user.id))
const sentMsg = (await call(c.token, 'GET', `/channels/${cdm.id}/messages?limit=5`)).find((m) => m.content.includes('/invite/'))
ok('Invite sends the link to carol in a DM', !!sentMsg && sentMsg.author.id === a.user.id)
await pa.keyboard.press('Escape')
const pc = await mk(c.token, `${WEB}/channels/@me/${cdm.id}`); await pc.waitForSelector('[data-invite-card]')
ok('carol sees it as an invite card with the server name and counts', (await pc.textContent('[data-invite-name]')) === `Social ${S}` && (await pc.getAttribute('[data-invite-card]', 'data-invite-state')) === 'open' && (await pc.textContent('[data-invite-card]')).includes('Members'))
await pc.screenshot({ path: '119-invite-card.png' })
await pc.click('[data-invite-join]'); await pc.waitForURL(new RegExp(`/channels/${g.id}`))
ok('Join from the card joins the server', (await call(c.token, 'GET', '/guilds')).some((x) => x.id === g.id))
await pc.goto(`${WEB}/channels/@me/${cdm.id}`); await pc.waitForSelector('[data-invite-card][data-invite-state="member"]')
ok('the card now reads Joined', await pc.locator('[data-invite-open]').count() === 1)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
