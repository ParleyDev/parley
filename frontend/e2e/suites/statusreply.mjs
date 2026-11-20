// Custom statuses on the profile popout: the whole status shows in a thought bubble instead of being cut off, and
// someone else's has Send Reaction and Reply. Either sends a DM quoting the status ("Replied to Roro's status"), with
// the text as it was then; the owner sees "Replied to your status". The server reads the status itself and only
// takes these in a 1:1 DM with its owner.
import { chromium } from 'playwright'
import { WEB, reg, call, callS, ok, openDms, finish } from '../lib.mjs'

const a = await reg('alice'), b = await reg('roro'), c = await reg('cleo')
await openDms(a, b, c)
const STATUS = 'i js called my 2 year old brother a fart knocker and now he will not stop saying it at the dinner table :sob:'
await call(b.token, 'PATCH', '/users/@me', { custom_status: STATUS })
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
await call(b.token, 'POST', `/channels/${dm.id}/messages`, { content: 'hi' })

console.log('-- API')
const self = await callS(b.token, 'POST', `/channels/${dm.id}/messages`, { content: 'me', status_reply: { user_id: b.user.id } })
ok('a status cannot be answered by its owner', self.status === 400, JSON.stringify(self))
const other = await callS(a.token, 'POST', `/channels/${dm.id}/messages`, { content: 'x', status_reply: { user_id: c.user.id } })
ok('or in a DM its owner is not in', other.status === 400, JSON.stringify(other))
const none = await callS(b.token, 'POST', `/channels/${dm.id}/messages`, { content: 'x', status_reply: { user_id: a.user.id } })
ok('or when there is no status to answer', none.status === 400 && /no longer have a status/.test(JSON.stringify(none.body)), JSON.stringify(none))
const g = await call(a.token, 'POST', '/guilds', { name: 'Statuses' }); const gch = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
const inGuild = await callS(a.token, 'POST', `/channels/${gch.id}/messages`, { content: 'x', status_reply: { user_id: b.user.id } })
ok('or in a server channel', inGuild.status === 400, JSON.stringify(inGuild))
const r = await callS(a.token, 'POST', `/channels/${dm.id}/messages`, { content: '🙏', status_reply: { user_id: b.user.id, reaction: true } })
ok('a reaction quotes the status as the server has it', r.status === 201 && r.body.status_reply?.text === STATUS && r.body.status_reply.reaction === true && r.body.status_reply.user_id === b.user.id, JSON.stringify(r.body?.status_reply))

const browser = await chromium.launch(); const errors = []
const page = async (who) => { const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), who.token); return p }
const p = await page(a)
await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector('[data-msg-avatar]')

console.log('-- popout')
await p.locator('[data-msg-avatar]').first().click(); await p.waitForSelector('[data-profile-popout] [data-custom-status]')
const bubble = await p.locator('[data-profile-popout] [data-custom-status]').evaluate((e) => ({ text: e.textContent + [...e.querySelectorAll('img[alt]')].map((i) => i.alt).join(''), sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight, h: e.getBoundingClientRect().height }))
ok('the whole status shows, wrapped over several lines', bubble.sw <= bubble.cw && bubble.sh <= bubble.ch + 1 && bubble.h > 40 && bubble.text.includes('dinner table') && bubble.text.includes('😭'), JSON.stringify(bubble))
const opacity = () => p.locator('[data-profile-popout] [data-status-actions]').evaluate((e) => getComputedStyle(e).opacity)
ok('its actions stay hidden until hovered', (await opacity()) === '0')
await p.hover('[data-profile-popout] [data-custom-status]'); await p.waitForTimeout(250)
ok('and show on hover', (await opacity()) === '1')
await p.click('[data-profile-popout] [data-status-react]'); await p.waitForSelector('[data-emoji-search]')
await p.fill('[data-emoji-search]', 'fire'); await p.waitForTimeout(150); await p.click('[data-emoji-btn=":fire:"]')
await p.waitForTimeout(600)
const sent = (await call(a.token, 'GET', `/channels/${dm.id}/messages?limit=5`)).find((m) => m.content === '🔥')
ok('Send Reaction sends the emoji as a reaction to the status', sent?.status_reply?.reaction === true && sent.status_reply.text === STATUS, JSON.stringify(sent))

ok('the bubble sits beside the avatar, from just under the banner down', await p.locator('[data-profile-popout] [data-custom-status-wrap]').evaluate((e) => { const banner = e.parentElement.getBoundingClientRect(), r = e.getBoundingClientRect(); return r.top >= banner.bottom - 8 && r.top <= banner.bottom }))
await p.hover('[data-profile-popout] [data-custom-status]'); await p.click('[data-profile-popout] [data-status-reply]')
ok('Reply drops a card in under the bubble', await p.locator('[data-status-reply-card]').isVisible())
ok('with the cursor in its box', await p.locator('[data-status-reply-input]').evaluate((e) => e === document.activeElement && e.placeholder === "Reply to Roro's status"))
await p.waitForTimeout(250)
ok('the buttons stay up while replying', (await opacity()) === '1')
await p.keyboard.press('Escape'); await p.waitForTimeout(150)
ok('Escape closes the card but not the popout', (await p.locator('[data-status-reply-card]').count()) === 0 && (await p.locator('[data-profile-popout]').count()) === 1)
await p.hover('[data-profile-popout] [data-custom-status]'); await p.click('[data-profile-popout] [data-status-reply]')
await p.mouse.click(5, 5); await p.waitForTimeout(150)
ok('so does a click outside', (await p.locator('[data-status-reply-card]').count()) === 0)
await p.locator('[data-msg-avatar]').first().click().catch(() => {}); await p.waitForSelector('[data-profile-popout] [data-custom-status]')
await p.hover('[data-profile-popout] [data-custom-status]'); await p.click('[data-profile-popout] [data-status-reply]')
await p.fill('[data-status-reply-input]', 'oop'); await p.keyboard.press('Enter')
await p.waitForTimeout(600)
ok('Enter sends it and closes the card', (await p.locator('[data-status-reply-card]').count()) === 0)
await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector('[data-status-reply-quote="reply"]')
const quote = p.locator('[data-msg-id]', { hasText: 'oop' }).locator('[data-status-reply-quote="reply"]')
ok('the reply shows "Replied to Roro\'s status" with the status above the message', /Replied to Roro's status/.test(await quote.textContent()) && (await quote.textContent()).includes('dinner table'), await quote.textContent())
ok('a reaction shows "Reacted to"', /Reacted to Roro's status/.test(await p.locator('[data-status-reply-quote="reaction"]').first().textContent()))

console.log('-- the owner')
await call(b.token, 'PATCH', '/users/@me', { custom_status: 'new status' })
const q = await page(b)
await q.goto(`${WEB}/channels/@me/${dm.id}`); await q.waitForSelector('[data-status-reply-quote="reply"]')
const theirs = await q.locator('[data-status-reply-quote="reply"]').last().textContent()
ok('sees "Replied to your status", quoting the status as it was', /Replied to your status/.test(theirs) && theirs.includes('dinner table') && !theirs.includes('new status'), theirs)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
finish()
