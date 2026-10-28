// Server admin tools: temporary-membership invites (removed when they go offline unless given a role), how each
// member joined (invite code and inviter, for moderators), audit log filters by user and action, Hide Muted Channels,
// and joining a server sends its full settings (the verification gate shows without a reload).
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), d = await reg('dave'), e = await reg('erin')
const g = await call(a.token, 'POST', '/guilds', { name: `Tools ${S}` })
const general = g.channels.find((x) => x.kind === 'text')
const quiet = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'quiet', kind: 'text' })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, { max_age: 0, max_uses: 0 }); await call(b.token, 'POST', `/invites/${inv.code}`)
const members = async () => (await call(a.token, 'GET', `/guilds/${g.id}/members`)).map((m) => m.user_id)
const browser = await chromium.launch(); const errors = []
const open = async (u, path) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const p = await ctx.newPage(); p.on('pageerror', (er) => errors.push(er.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(WEB + path); await p.waitForTimeout(900)
  return { p, ctx }
}

console.log('-- temporary membership')
const temp = await call(a.token, 'POST', `/guilds/${g.id}/invites`, { max_age: 0, max_uses: 0, temporary: true })
ok('invites can grant temporary membership', temp.temporary === true)
await call(d.token, 'POST', `/invites/${temp.code}`); await call(e.token, 'POST', `/invites/${temp.code}`)
const joins = await call(a.token, 'GET', `/guilds/${g.id}/member-joins`)
const dj = joins.find((j) => j.user_id === d.user.id)
ok('moderators can see how someone joined and who invited them', dj?.joined_via === temp.code && dj.inviter_id === a.user.id && dj.temporary === true)
ok('others cannot', (await raw(b.token, 'GET', `/guilds/${g.id}/member-joins`)).status === 403)
const role = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Keeper' })
await call(a.token, 'PATCH', `/guilds/${g.id}/members/${e.user.id}`, { roles: [role.id] })
const dave = await open(d, `/channels/${g.id}/${general.id}`); const erin = await open(e, `/channels/${g.id}/${general.id}`)
await dave.ctx.close(); await erin.ctx.close(); await new Promise((r) => setTimeout(r, 1500))
const left = await members()
ok('going offline removes a temporary member without a role', !left.includes(d.user.id))
ok('but not one who was given a role', left.includes(e.user.id))

console.log('-- audit filters')
await call(a.token, 'DELETE', `/guilds/${g.id}/members/${b.user.id}`, { reason: 'test' })
const kicks = await call(a.token, 'GET', `/guilds/${g.id}/audit?action=member.kick`)
ok('filtering by an action returns only that', kicks.length >= 1 && kicks.every((r) => r.action === 'member.kick'))
const fam = await call(a.token, 'GET', `/guilds/${g.id}/audit?action=role.`)
ok('a family like "role." matches all role actions', fam.length >= 1 && fam.every((r) => r.action.startsWith('role.')))
ok('filtering by user returns only their actions', (await call(a.token, 'GET', `/guilds/${g.id}/audit?actor=${b.user.id}`)).length === 0 && (await call(a.token, 'GET', `/guilds/${g.id}/audit?actor=${a.user.id}`)).length >= 2)

console.log('-- hide muted channels')
await call(a.token, 'PUT', `/users/@me/notification-settings/${quiet.id}`, { mute_minutes: 0 })
const { p: pa } = await open(a, `/channels/${g.id}/${general.id}`)
await pa.click(`aside button:has-text("Tools ${S}")`); await pa.click('text=Hide Muted Channels'); await pa.waitForTimeout(300)
ok('Hide Muted Channels hides them', await pa.locator(`[data-channel-item="${quiet.id}"]`).count() === 0)
await pa.reload(); await pa.waitForTimeout(900)
ok('and is remembered', await pa.locator(`[data-channel-item="${quiet.id}"]`).count() === 0)
await pa.click(`aside button:has-text("Tools ${S}")`); await pa.click('text=Show Muted Channels'); await pa.waitForTimeout(300)
ok('Show brings them back', await pa.locator(`[data-channel-item="${quiet.id}"]`).count() === 1)

console.log('-- joining sends the full settings')
await call(a.token, 'PATCH', `/guilds/${g.id}`, { verification_level: 1 })
const f = await reg('frank')
const { p: pf } = await open(f, `/invite/${inv.code}`)
await pf.click('button:has-text("Accept Invite"), button:has-text("Join")').catch(() => {})
await pf.waitForTimeout(1500)
ok('a new member sees the verification gate straight away', await pf.locator('[data-verification-gate]').count() === 1)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
