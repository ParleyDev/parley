// Moderator tools: warnings (the member sees them; they count toward account standing), the Moderator View of a
// member (account age, join method, messages, warnings, history), the members list for moderators (join and account
// dates, role filter, sorting) and bulk bans.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol'), d = await reg('dave')
const g = await call(a.token, 'POST', '/guilds', { name: `Mods ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const u of [b, c, d]) { await call(u.token, 'POST', `/invites/${inv.code}`); await new Promise((r) => setTimeout(r, 30)) }
const general = g.channels.find((x) => x.kind === 'text')
await call(c.token, 'POST', `/channels/${general.id}/messages`, { content: 'hello from carol' })
const role = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: `Helpers ${S}` })
await call(a.token, 'PATCH', `/guilds/${g.id}/members/${c.user.id}`, { roles: [role.id] })
const browser = await chromium.launch(); const errors = []
const mk = async (tok, path) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}${path}`); await p.waitForTimeout(1000)
  return p
}

console.log('-- warnings')
ok('members who aren\'t moderators can\'t warn', (await raw(b.token, 'POST', `/guilds/${g.id}/members/${c.user.id}/warnings`, { reason: 'x' })).status === 403)
ok('a warning needs a reason', (await raw(a.token, 'POST', `/guilds/${g.id}/members/${c.user.id}/warnings`, { reason: ' ' })).status === 400)
const pc = await mk(c.token, `/channels/${g.id}/${general.id}`)
const pa = await mk(a.token, `/channels/${g.id}/${general.id}`)
await pa.locator(`button:has-text("Mods ${S}")`).first().click(); await pa.click('text=Server Settings'); await pa.click('[data-settings-tab="members"]'); await pa.waitForSelector(`[data-members-row="${c.user.id}"]`)
await pa.waitForTimeout(500)
ok('moderators see join and account dates', await pa.locator(`[data-member-ages="${c.user.id}"]`).count() === 1)
await pa.click(`[data-members-modview="${c.user.id}"]`); await pa.waitForSelector('[data-mod-facts]')
ok('the Moderator View shows the join method', (await pa.locator('[data-mod-join-method]').innerText()).includes(`Invite ${inv.code} from ${a.user.display_name}`))
ok('and their messages here', (await pa.locator('[data-mod-messages]').innerText()) === '1')
ok('a brand-new account is flagged', await pa.locator('[data-mod-new-account]').count() === 1)
await pa.fill('[data-mod-warn-reason]', 'Please keep it civil'); await pa.click('[data-mod-warn]'); await pa.waitForTimeout(800)
ok('the warning is listed', await pa.locator('[data-mod-warning]').count() === 1)
ok('and in the moderation history', /Warned/.test(await pa.locator('[data-mod-history]').innerText()))
ok('the member is shown the warning', (await pc.locator('[data-warning-reason]').innerText().catch(() => '')) === 'Please keep it civil')
const st = await call(c.token, 'GET', '/users/@me/standing')
ok('it counts toward their account standing', st.warnings === 1 && st.level === 'limited', JSON.stringify(st))
await pa.click('[data-mod-unwarn]'); await pa.waitForTimeout(500)
ok('moderators can remove a warning', await pa.locator('[data-mod-warning]').count() === 0)
await pa.keyboard.press('Escape'); await pa.waitForTimeout(300)
ok('Escape closes the Moderator View but not Settings', await pa.locator('[data-mod-view]').count() === 0 && await pa.locator(`[data-members-row="${d.user.id}"]`).count() === 1)

console.log('-- members list')
await pa.selectOption('[data-members-sort]', 'joined_new'); await pa.waitForTimeout(200)
ok('sorting by newest members puts the latest joiner first', (await pa.locator('[data-members-row]').first().getAttribute('data-members-row')) === d.user.id)
await pa.selectOption('[data-members-role-filter]', role.id); await pa.waitForTimeout(200)
ok('the role filter narrows the list', await pa.locator('[data-members-row]').count() === 1 && await pa.locator(`[data-members-row="${c.user.id}"]`).count() === 1)
await pa.selectOption('[data-members-role-filter]', '')

console.log('-- bulk ban')
ok('bulk ban needs Ban Members', (await raw(b.token, 'POST', `/guilds/${g.id}/bulk-ban`, { user_ids: [d.user.id] })).status === 403)
ok('you can\'t pick yourself', await pa.locator(`[data-members-pick="${a.user.id}"]`).isDisabled())
await pa.check(`[data-members-pick="${c.user.id}"]`); await pa.check(`[data-members-pick="${d.user.id}"]`)
ok('picking members shows the bulk bar', /2 selected/.test(await pa.locator('[data-members-bulk]').innerText()))
await pa.click('[data-members-bulk-ban]'); await pa.locator('.backdrop-blur-sm button.btn-danger').click(); await pa.waitForTimeout(1200)
const bans = await call(a.token, 'GET', `/guilds/${g.id}/bans`)
ok('everyone picked is banned', [c.user.id, d.user.id].every((id) => bans.some((x) => x.user_id === id)), JSON.stringify(bans.map((x) => x.user_id)))
const r = await call(a.token, 'POST', `/guilds/${g.id}/bulk-ban`, { user_ids: [b.user.id, a.user.id] })
ok('bulk results report who could not be banned', r.banned.length === 1 && r.failed.length === 1 && r.failed[0].user_id === a.user.id)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
