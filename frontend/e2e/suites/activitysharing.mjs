// Per-server activity sharing: turning it off in a server's Privacy Settings hides your activity from that server's
// members, live and on reload, while members of your other servers, friends and people you DM with still see it.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish, openDms } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
const g1 = await call(a.token, 'POST', '/guilds', { name: `Open ${S}` }), g2 = await call(a.token, 'POST', '/guilds', { name: `Quiet ${S}` })
const i1 = await call(a.token, 'POST', `/guilds/${g1.id}/invites`, {}), i2 = await call(a.token, 'POST', `/guilds/${g2.id}/invites`, {})
await call(b.token, 'POST', `/invites/${i1.code}`); await call(c.token, 'POST', `/invites/${i2.code}`)
const browser = await chromium.launch(); const errors = []
const mk = async (u, g) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}/channels/${g.id}/${g.channels.find((x) => x.kind === 'text').id}`); await p.waitForSelector('textarea')
  return p
}
const until = async (f, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await Promise.resolve().then(f).catch(() => false)) return true; await new Promise((r) => setTimeout(r, 250)) } return false }
const pa = await mk(a, g2), pb = await mk(b, g1), pc = await mk(c, g2)
await call(a.token, 'PUT', '/users/@me/activity', { type: 'playing', name: `Chess ${S}` })
const lineB = pb.locator(`[data-member-row="${a.user.id}"] [data-member-activity]`), lineC = pc.locator(`[data-member-row="${a.user.id}"] [data-member-activity]`)
ok('both servers see it to begin with', await until(async () => (await lineB.count()) === 1 && (await lineC.count()) === 1))

console.log('-- off in one server')
await pa.locator(`button:has-text("Quiet ${S}")`).first().click(); await pa.click('text=Privacy Settings')
await pa.waitForSelector('[data-guild-activity-toggle]'); await pa.click('[data-guild-activity-toggle] button')
ok('the dialog saves it', await until(async () => (await call(a.token, 'GET', `/guilds/${g2.id}/members/@me/privacy`)).share_activity === false))
ok("that server's members stop seeing it", await until(async () => (await lineC.count()) === 0))
ok('the other server still does', await lineB.count() === 1)
await pc.reload(); await pc.waitForSelector('textarea'); await pc.waitForTimeout(1500)
ok('and it stays hidden on reload', await lineC.count() === 0)
await call(a.token, 'PUT', '/users/@me/activity', { type: 'playing', name: `Go ${S}` })
ok('changes reach only those who can see it', await until(async () => (await lineB.innerText()).includes(`Go ${S}`)) && await lineC.count() === 0)

console.log('-- DMs')
await openDms(a, c); await call(c.token, 'POST', '/users/@me/channels', { recipient_id: a.user.id })
await pc.reload(); await pc.waitForSelector('textarea')
ok('someone you DM with sees it again', await until(async () => (await lineC.count()) === 1))

console.log('-- back on')
await call(a.token, 'PATCH', `/guilds/${g2.id}/members/@me/privacy`, { share_activity: true })
ok('turning it back on keeps it shown', await until(async () => (await lineC.count()) === 1))
ok('allow_dms is left alone by the activity switch', (await call(a.token, 'GET', `/guilds/${g2.id}/members/@me/privacy`)).allow_dms === null)
ok('no page errors', errors.length === 0, errors.join(' | '))
for (const g of [g1, g2]) await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
