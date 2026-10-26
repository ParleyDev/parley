// DM list and friends: a note with a friend request (shown on the pending request), "Friends since" on profiles, a
// Wave for new friends, Close DM (back on a new message, kept across reloads), pinned DMs and pinned channels (synced
// to your other devices live).
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
await call(a.token, 'POST', '/users/@me/relationships', { user_id: c.user.id }); await call(c.token, 'PUT', `/users/@me/relationships/${a.user.id}`)
const g = await call(a.token, 'POST', '/guilds', { name: `Pins ${S}` })
const general = g.channels.find((x) => x.kind === 'text')
const browser = await chromium.launch(); const errors = []
const open = async (u, path = '/channels/@me') => {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(WEB + path); await p.waitForTimeout(900)
  return p
}
const pa = await open(a); const pb = await open(b)

console.log('-- friend request note')
await pa.click('button:has-text("Add Friend")'); await pa.fill('input[placeholder^="You can add friends"]', b.user.username); await pa.fill('[data-request-note-input]', 'We met at the jam session')
await pa.click('button:has-text("Send Friend Request")'); await pa.waitForTimeout(800)
const rel = (await call(b.token, 'GET', '/users/@me/relationships')).find((r) => r.user.id === a.user.id)
ok('the note travels with the request', rel?.kind === 'incoming' && rel.note === 'We met at the jam session')
ok('bob is told straight away', /sent you a friend request/.test(await pb.locator('body').innerText()))
await pb.click('button:has-text("Pending")').catch(() => {}); await pb.waitForTimeout(300)
ok('and sees the note on the pending request', /We met at the jam session/.test(await pb.locator('[data-request-note]').innerText().catch(() => '')))
await pb.click('button[title="Accept"]'); await pb.waitForTimeout(800)

console.log('-- friends since and wave')
await pa.click('button:has-text("All")'); await pa.waitForTimeout(400)
await pa.locator(`[data-wave-friend="${b.user.id}"]`).click(); await pa.waitForTimeout(800)
const dm = (await call(b.token, 'GET', '/users/@me/channels')).find((d) => d.recipients.some((r) => r.id === a.user.id))
ok('Wave sends a 👋 to the new friend', (await call(b.token, 'GET', `/channels/${dm.id}/messages?limit=5`)).some((m) => m.content === '👋'))
ok('and goes away once used', await pa.locator(`[data-wave-friend="${b.user.id}"]`).count() === 0)
await pa.click(`[data-dm-row="${b.user.id}"]`); await pa.waitForTimeout(500)
await pa.goto(`${WEB}/channels/@me`); await pa.waitForTimeout(600)
await pa.click('button:has-text("All")'); await pa.locator(`[data-motion-row]:has-text("Bob") button`).first().click(); await pa.waitForTimeout(500)
ok('the profile says Friends since', await pa.locator('[data-friends-since]').count() >= 1)
await pa.keyboard.press('Escape')

console.log('-- close DM')
await pa.click(`[data-dm-row="${b.user.id}"]`, { button: 'right' }); await pa.click('[data-menu-item="Close DM"]'); await pa.waitForTimeout(600)
ok('Close DM takes it off the list', await pa.locator(`[data-dm-row="${b.user.id}"]`).count() === 0)
await pa.reload(); await pa.waitForTimeout(1000)
ok('and it stays closed after a reload', await pa.locator(`[data-dm-row="${b.user.id}"]`).count() === 0)
await call(b.token, 'POST', `/channels/${dm.id}/messages`, { content: 'you there?' }); await pa.waitForTimeout(800)
ok('a new message brings it back', await pa.locator(`[data-dm-row="${b.user.id}"]`).count() === 1)

console.log('-- pins')
const pa2 = await open(a)
const cdm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: c.user.id }); await pa.waitForTimeout(500)
await pa.click(`[data-dm-row="${c.user.id}"]`, { button: 'right' }); await pa.click('[data-menu-item="Pin Conversation"]'); await pa.waitForTimeout(700)
ok('a pinned DM moves to Pinned', await pa.locator(`[data-pinned-dms] [data-dm-row="${c.user.id}"]`).count() === 1)
ok('your other devices follow live', await pa2.locator(`[data-pinned-dms] [data-dm-row="${c.user.id}"]`).count() === 1)
ok('it is saved on the account', (await call(a.token, 'GET', '/users/@me')).pinned_channels.includes(cdm.id))
await pa.goto(`${WEB}/channels/${g.id}/${general.id}`); await pa.waitForTimeout(800)
await pa.click(`[data-channel-item="${general.id}"] a`, { button: 'right' }); await pa.click('[data-menu-item="Pin Channel"]'); await pa.waitForTimeout(600)
ok('channels can be pinned to the top of the server', await pa.locator(`[data-pinned-channel="${general.id}"]`).count() === 1)
await pa.click(`[data-pinned-channel="${general.id}"] a`, { button: 'right' }); await pa.click('[data-menu-item="Unpin Channel"]'); await pa.waitForTimeout(600)
ok('and unpinned', await pa.locator('[data-pinned-channels]').count() === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
