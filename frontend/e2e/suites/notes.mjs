// Profile notes, like Discord's: private to their author. The server returns a note only to the person who wrote it
// (no profile, relationship, member, export, admin or socket payload carries it to anyone else). In the app a note
// lives only in the full profile ("Note (only visible to you)", saved as you type), never in the popout or the DM
// panel, never on your own profile and not at all in Streamer Mode; "Add Note" / "Edit Note" in the user menus open
// the full profile with the cursor in it.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish, openDms, adminToken } from '../lib.mjs'

const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
await openDms(a, b, c)
await call(a.token, 'POST', '/users/@me/relationships', { username: b.user.username }); await call(b.token, 'PUT', `/users/@me/relationships/${a.user.id}`)
const g = await call(a.token, 'POST', '/guilds', { name: `Notes ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const SECRET = `private-note-${S}`
const browser = await chromium.launch(); const errors = []

console.log('-- server: notes reach only their author')
// Bob keeps a page open: every socket frame he receives while Alice writes her note about him is checked.
const pb = await (await browser.newContext()).newPage(); const frames = []
pb.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))))
await pb.goto(`${WEB}/login`); await pb.evaluate((t) => localStorage.setItem('parley.token', t), b.token); await pb.goto(`${WEB}/channels/@me`); await pb.waitForTimeout(1500)
let r = await raw(a.token, 'PUT', `/users/@me/notes/${b.user.id}`, { note: SECRET }); ok('Alice writes a note about Bob', r.status === 200 && (await r.json()).note === SECRET)
ok('nobody writes a note about themselves', (await raw(a.token, 'PUT', `/users/@me/notes/${a.user.id}`, { note: 'me' })).status === 400)
ok('Alice reads it back', (await call(a.token, 'GET', '/users/@me/notes')).some((n) => n.user_id === b.user.id && n.note === SECRET))
const leaks = []
const look = async (who, path) => { const res = await raw(who.token, 'GET', path); const txt = await res.text(); if (txt.includes(SECRET)) leaks.push(`${who === b ? 'bob' : 'carol'} ${path}`) }
for (const who of [b, c]) {
  for (const path of ['/users/@me/notes', `/users/${a.user.id}`, `/users/${b.user.id}`, '/users/@me', '/users/@me/relationships', `/guilds/${g.id}/members`, `/guilds/${g.id}`, '/users/@me/channels']) await look(who, path)
}
ok("no profile, relationship, member or channel response gives it to anyone else (Bob included)", leaks.length === 0, leaks.join(', '))
await pb.waitForTimeout(800)
ok("no socket frame carries it to Bob", !frames.some((f) => f.includes(SECRET)), `${frames.length} frames`)
// Bob's own data export: his notes only, not the ones written about him.
r = await raw(b.token, 'POST', '/users/@me/data-exports', {}); const ex = await r.json()
let list; for (let i = 0; i < 20; i++) { list = await call(b.token, 'GET', '/users/@me/data-exports'); if (list[0]?.status !== 'pending') break; await new Promise((res) => setTimeout(res, 500)) }
const doc = await (await raw(b.token, 'GET', `/users/@me/data-exports/${ex.id}/download`)).text()
ok("Bob's data export doesn't contain Alice's note about him", list[0]?.status === 'ready' && !doc.includes(SECRET))
const admin = await adminToken()
const adm = await (await raw(admin.token, 'GET', `/admin/users?q=${encodeURIComponent(b.user.username)}`)).text() + await (await raw(admin.token, 'GET', `/admin/users?q=${encodeURIComponent(a.user.username)}`)).text()
ok("the admin console's user views don't show it", !adm.includes(SECRET))

console.log('-- app')
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
await call(b.token, 'POST', `/channels/${dm.id}/messages`, { content: 'hi' })
await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector('[data-dm-profile] [data-profile-name]', { state: 'attached' }); await p.waitForTimeout(600)
ok('the DM profile panel has no note field and shows no note', await p.locator('[data-dm-profile] [data-profile-note]').count() === 0 && !(await p.locator('[data-dm-profile]').innerText()).includes(SECRET))
await p.click('[data-msg-avatar]'); await p.waitForSelector('[data-profile-popout]'); await p.waitForTimeout(300)
ok('neither has the popout', await p.locator('[data-profile-popout] [data-profile-note]').count() === 0 && !(await p.locator('[data-profile-popout]').innerText()).includes(SECRET))
await p.click('[data-profile-popout] button[aria-label="More"]'); await p.waitForSelector('[data-context-menu]')
ok("the popout's … menu offers Edit Note", await p.locator('[data-context-menu] button:has-text("Edit Note")').count() === 1)
await p.click('[data-context-menu] button:has-text("Edit Note")'); await p.waitForSelector('[data-full-profile] [data-profile-note]'); await p.waitForTimeout(400)
ok('it opens the full profile with the cursor in the note', await p.evaluate(() => document.activeElement?.hasAttribute('data-profile-note')) && (await p.inputValue('[data-full-profile] [data-profile-note]')) === SECRET)
ok("labelled 'Note (only visible to you)'", (await p.locator('[data-profile-note-section]').innerText()).includes('Note (only visible to you)'))
await p.fill('[data-full-profile] [data-profile-note]', `${SECRET} edited`); await p.waitForTimeout(1500)
ok('typing saves it on its own (no blur needed)', (await call(a.token, 'GET', '/users/@me/notes')).some((n) => n.user_id === b.user.id && n.note === `${SECRET} edited`))
await p.keyboard.press('Escape'); await p.waitForTimeout(300)
// The context menu on a member row: Add Note for someone without one.
await p.goto(`${WEB}/channels/${g.id}`); await p.waitForSelector('[data-member-list]'); await p.waitForTimeout(600)
await p.click(`[data-member-list] button:has-text("Carol")`, { button: 'right' }); await p.waitForSelector('[data-context-menu]')
ok('right-clicking someone without a note offers Add Note', await p.locator('[data-context-menu] button:has-text("Add Note")').count() === 1)
await p.click('[data-context-menu] button:has-text("Add Note")'); await p.waitForSelector('[data-full-profile] [data-profile-note]')
ok('which opens their full profile on an empty note', (await p.inputValue('[data-full-profile] [data-profile-note]')) === '' && await p.evaluate(() => document.activeElement?.hasAttribute('data-profile-note')))
await p.keyboard.press('Escape'); await p.waitForTimeout(300)
// Your own full profile: no note.
await p.goto(`${WEB}/users/${a.user.id}`); await p.waitForSelector('[data-full-profile]'); await p.waitForTimeout(500)
ok('your own full profile never shows a note field', await p.locator('[data-full-profile]').count() === 1 && await p.locator('[data-full-profile] [data-profile-note]').count() === 0)
await p.goto(`${WEB}/users/${b.user.id}`); await p.waitForSelector('[data-full-profile] [data-profile-note]')
ok('(while someone else\'s does)', (await p.inputValue('[data-full-profile] [data-profile-note]')).startsWith(SECRET))
await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200)

console.log('-- Streamer Mode')
await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('parley.prefs') ?? '{}'); v.streamer = true; localStorage.setItem('parley.prefs', JSON.stringify(v)) })
await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector('[data-view-full-profile]'); await p.click('[data-view-full-profile]'); await p.waitForSelector('[data-full-profile]'); await p.waitForTimeout(400)
ok('in Streamer Mode the full profile hides the note entirely', await p.locator('[data-full-profile] [data-profile-note-section]').count() === 0 && !(await p.locator('[data-full-profile]').innerText()).includes(SECRET))
await p.keyboard.press('Escape'); await p.waitForTimeout(200)
await p.click(`[data-dm-profile] [data-profile-name]`, { button: 'right' }).catch(() => {})
await p.click('[data-msg-avatar]', { button: 'right' }); await p.waitForSelector('[data-context-menu]')
ok('and the menus offer no note', await p.locator('[data-context-menu] button:has-text("Note")').count() === 0)

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
