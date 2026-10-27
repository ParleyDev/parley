// Undeliverable DMs (red message + Ribbit notice with Retry / Delete / Dismiss) and the "viewing older messages" bar.
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { WEB, S, reg, call, callS, raw, ok, finish, openDms, testContainer } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob')
await openDms(a, b)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: `before the block ${S}` })
await callS(b.token, 'PUT', `/users/@me/relationships/${a.user.id}/block`)

console.log('-- API')
let r = await raw(a.token, 'POST', `/channels/${dm.id}/messages`, { content: 'hello?' }); let j = await r.json()
ok('blocked DM send is 403 with code "undeliverable" and a friendly message', r.status === 403 && j.code === 'undeliverable' && j.error === 'Your message could not be delivered.', JSON.stringify(j))
r = await raw(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id }); ok('opening the DM itself still plain 403', r.status === 403 && (await r.json()).code === undefined)

console.log('-- UI')
const browser = await chromium.launch(); const errors = []
const mk = async (tok, url) => { const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(url); await p.waitForSelector('textarea'); return p }
const pa = await mk(a.token, `${WEB}/channels/@me/${dm.id}`)
await pa.fill('textarea', `are you there ${S}`); await pa.press('textarea', 'Enter')
await pa.waitForSelector('[data-ribbit]')
const failed = pa.locator('[data-local="failed"]')
const act = async (row, label) => { await row.hover(); await row.locator(`[data-failed-actions] button[title="${label}"]`).click() }
ok('the message stays in the list, marked failed and red', await failed.count() === 1 && (await failed.locator('.msg-content').getAttribute('class')).includes('text-danger') && (await failed.locator('.msg-content').textContent()) === `are you there ${S}`)
ok('no NEW divider above the local rows', await pa.locator('[data-unread-divider]').count() === 0)
ok('no Forbidden toast', !(await pa.locator('body').textContent()).includes('Forbidden'))
ok('composer is cleared (message moved to the failed row)', (await pa.inputValue('textarea')) === '')
ok('Ribbit explains it with an App badge and a frog avatar', (await pa.locator('[data-ribbit] [data-msg-header]').textContent()).startsWith('RibbitApp') && (await pa.locator('[data-ribbit] [data-msg-avatar]').getAttribute('src')).startsWith('data:image/svg+xml') && (await pa.locator('[data-ribbit]').textContent()).includes('Send a friend request first') && (await pa.locator('[data-ribbit]').textContent()).includes('Only you can see this'))
await pa.click('[data-ribbit-reasons]'); ok('the reasons list expands inline', await pa.locator('[data-ribbit-list] li').count() >= 4)
await failed.hover()
ok('hovering a failed row shows Retry and Delete instead of the usual tools', await failed.locator('[data-failed-actions] button[title="Retry"]').isVisible() && await failed.locator('[data-failed-actions] button[title="Delete"]').isVisible() && await failed.locator('[data-quick-react], button[title="Reply"]').count() === 0)
ok('Ribbit notice has the tinted background and left accent bar', (await pa.locator('[data-ribbit]').getAttribute('class')).includes('border-l-2') && (await pa.locator('[data-ribbit]').getAttribute('class')).includes('bg-accent/10'))
await failed.hover(); await pa.screenshot({ path: '137-ribbit.png' })
ok('bob never received it', !(await call(b.token, 'GET', `/channels/${dm.id}/messages?limit=10`)).some((m) => m.content === `are you there ${S}`))
await act(failed, 'Retry'); await pa.waitForTimeout(600)
ok('Retry while still blocked keeps it failed, no toast', await pa.locator('[data-local="failed"]').count() === 1 && await pa.locator('[data-ribbit]').count() === 1 && !(await pa.locator('body').textContent()).includes('Forbidden'))
// A second failed message, then dismiss only its notice, then delete it.
await pa.fill('textarea', `second try ${S}`); await pa.press('textarea', 'Enter'); await pa.waitForFunction(() => document.querySelectorAll('[data-ribbit]').length === 2)
await pa.locator('[data-ribbit-dismiss]').nth(1).click()
ok('Dismiss removes just the notice', await pa.locator('[data-ribbit]').count() === 1 && await pa.locator('[data-local="failed"]').count() === 2)
await act(pa.locator('[data-local="failed"]').nth(1), 'Delete')
ok('Delete removes the failed message', await pa.locator('[data-local="failed"]').count() === 1)
await act(pa.locator('[data-local="failed"]').first(), 'Delete')
ok('deleting the first one also removes its notice', await pa.locator('[data-local="failed"]').count() === 0 && await pa.locator('[data-ribbit]').count() === 0)
// The rows survive leaving the chat, a reload, and a fresh socket; only Retry/Delete/Dismiss remove them.
await pa.fill('textarea', `sticky ${S}`); await pa.press('textarea', 'Enter'); await pa.waitForSelector('[data-ribbit]')
await pa.click('text=Friends'); await pa.waitForURL(/channels\/@me$/); await pa.goBack(); await pa.waitForSelector('textarea')
ok('switching away and back keeps the failed message and notice', await pa.locator('[data-local="failed"]').count() === 1 && await pa.locator('[data-ribbit]').count() === 1)
await pa.reload(); await pa.waitForSelector('textarea'); await pa.waitForSelector('[data-ribbit]')
ok('a reload keeps them too', await pa.locator('[data-local="failed"]').count() === 1 && (await pa.locator('[data-local="failed"] .msg-content').textContent()) === `sticky ${S}`)
await act(pa.locator('[data-local="failed"]').first(), 'Delete'); await pa.reload(); await pa.waitForSelector('textarea'); await pa.waitForTimeout(500)
ok('deleted rows stay gone after a reload', await pa.locator('[data-local="failed"]').count() === 0 && await pa.locator('[data-ribbit]').count() === 0)
// Unblock, fail once more, then Retry delivers for real.
await pa.fill('textarea', `third time ${S}`); await pa.press('textarea', 'Enter'); await pa.waitForSelector('[data-ribbit]')
await callS(b.token, 'DELETE', `/users/@me/relationships/${a.user.id}`)
await act(pa.locator('[data-local="failed"]').first(), 'Retry')
await pa.waitForFunction(() => document.querySelectorAll('[data-local="failed"]').length === 0 && document.querySelectorAll('[data-ribbit]').length === 0)
const delivered = (await call(b.token, 'GET', `/channels/${dm.id}/messages?limit=10`)).find((m) => m.content === `third time ${S}`)
ok('after unblocking, Retry delivers and the row becomes a normal message', !!delivered && await pa.locator(`[data-msg-id="${delivered.id}"]`).count() === 1 && !(await pa.locator(`[data-msg-id="${delivered.id}"] .msg-content`).getAttribute('class')).includes('text-danger'))

console.log('-- older messages bar')
let lastFiller = null
for (let i = 0; i < 80; i++) lastFiller = await call(b.token, 'POST', `/channels/${dm.id}/messages`, { content: `scroll filler ${i}` })
// Alice is watching, so she reads them as they arrive; let that catch up before reloading (otherwise she rightly
// lands on the NEW line, above the bottom).
for (let i = 0; i < 60; i++) {
  if (execSync(`docker exec ${testContainer('db')} psql -U parley -tAc "SELECT last_read_msg FROM read_states WHERE user_id = '${a.user.id}' AND channel_id = '${dm.id}'"`).toString().trim() === lastFiller.id) break
  await new Promise((r) => setTimeout(r, 250))
}
await pa.reload(); await pa.waitForSelector('textarea'); await pa.waitForFunction(() => document.querySelectorAll('[data-msg-id]').length > 40)
await pa.waitForFunction(() => !document.querySelector('[data-older-bar]'), null, { timeout: 10000 }).catch(() => {})
ok('no bar at the bottom', await pa.locator('[data-older-bar]').count() === 0)
await pa.evaluate(() => { const el = document.querySelector('[data-msg-id]').closest('.overflow-y-auto'); el.scrollTop = 0 })
await pa.waitForSelector('[data-older-bar]')
ok('scrolling up shows "You\'re viewing older messages" with Jump to Present', (await pa.locator('[data-older-bar]').textContent()).includes("You're viewing older messages") && await pa.locator('[data-jump-present]').count() === 1)
await pa.screenshot({ path: '138-older-bar.png' })
await pa.click('[data-jump-present]')
await pa.waitForFunction(() => { const el = document.querySelector('[data-msg-id]').closest('.overflow-y-auto'); return !document.querySelector('[data-older-bar]') && el.scrollHeight - el.scrollTop - el.clientHeight < 40 })
ok('Jump to Present scrolls to the bottom and hides the bar', true)
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
