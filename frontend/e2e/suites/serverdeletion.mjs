// Phase 6 (docs/admin-access-and-server-deletion.md): server deletion and takedowns. Owner deletion needs the password
// and the typed name, takes the server away from everyone at once, and can be undone by the owner (only) during the
// grace period. Takedowns need a case, can't be undone by the owner, and keep content for the case. The finalize job is
// idempotent, hard-deletes everything (files included), keeps a bare tombstone, snapshots only what open cases cover,
// and leaves forwards elsewhere in place without their pointer. Dangling references answer 410 server_unavailable.
import { execSync } from 'node:child_process'
import { chromium } from 'playwright'
import { WEB, S, PASSWORD, reg, call, callS, raw, ok, finish, adminToken, testContainer, openDms, multi, pngFile } from '../lib.mjs'

const sql = (q) => execSync(`docker exec ${testContainer('db')} psql -U parley -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim()
const admin = await adminToken()
const role = async (name, roles) => { const u = await reg(name); await call(admin.token, 'PUT', `/admin/users/${u.user.id}/roles`, { roles }); return u }
const mod = await role('mod', ['MODERATOR']), sup = await role('sup', ['SUPPORT'])
const o = await reg('owner'), m = await reg('member')
await openDms(o, m)
const run = () => call(admin.token, 'POST', '/admin/deletions/run')

const makeServer = async (name) => {
  const g = await call(o.token, 'POST', '/guilds', { name }); const ch = g.channels.find((x) => x.kind === 'text')
  const inv = await call(o.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(m.token, 'POST', `/invites/${inv.code}`)
  return { g, ch, inv }
}

console.log('-- owner deletion asks for proof')
const A = await makeServer(`Doomed ${S}`)
const msg = await call(m.token, 'POST', `/channels/${A.ch.id}/messages`, { content: `hello doomed ${S}` })
const up = await (await multi(m.token, `/channels/${A.ch.id}/attachments`, pngFile)).json()
const withFile = await call(m.token, 'POST', `/channels/${A.ch.id}/messages`, { content: 'a file', attachment_ids: [up.id] })
const hook = await call(o.token, 'POST', `/channels/${A.ch.id}/webhooks`, { name: 'hook' })
ok('members cannot delete it', (await raw(m.token, 'POST', `/guilds/${A.g.id}/deletion`, { password: PASSWORD, name: A.g.name })).status === 403)
ok('a wrong password is refused', [400, 401, 403].includes((await raw(o.token, 'POST', `/guilds/${A.g.id}/deletion`, { password: 'nope-nope', name: A.g.name })).status))
ok('so is a mistyped name', (await raw(o.token, 'POST', `/guilds/${A.g.id}/deletion`, { password: PASSWORD, name: 'Doomed' })).status === 400)
ok('DELETE without the confirmation does nothing', (await raw(o.token, 'DELETE', `/guilds/${A.g.id}`)).status >= 400 && (await call(m.token, 'GET', '/guilds')).some((x) => x.id === A.g.id))
let r = await callS(o.token, 'POST', `/guilds/${A.g.id}/deletion`, { password: PASSWORD, name: A.g.name })
ok('with both, the server is pending deletion for 7 days', r.status === 200 && r.body.state === 'pending_deletion' && Math.abs(new Date(r.body.scheduled_for) - Date.now() - 7 * 86400e3) < 120e3)

console.log('-- gone for everyone at once')
ok('it leaves the member list of servers', !(await call(m.token, 'GET', '/guilds')).some((x) => x.id === A.g.id) && !(await call(o.token, 'GET', '/guilds')).some((x) => x.id === A.g.id))
r = await callS(m.token, 'GET', `/guilds/${A.g.id}`)
ok('the server answers 410 server_unavailable', r.status === 410 && r.body.code === 'server_unavailable' && r.body.reason === 'pending_deletion')
r = await callS(m.token, 'GET', `/channels/${A.ch.id}/messages`)
ok('so do its channels and message links', r.status === 410 && r.body.code === 'server_unavailable')
ok('its invites are gone', (await raw(m.token, 'GET', `/invites/${A.inv.code}`)).status === 404)
ok('its webhooks stop', (await raw(null, 'POST', `/webhooks/${hook.webhook.id}/${hook.token}`, { content: 'still here?' })).status === 410)
ok('search drops it', !(await call(m.token, 'GET', `/search?q=doomed ${S}`)).results.some((x) => (x.message ?? x).id === msg.id))

console.log('-- only the owner restores')
ok('the owner sees it among servers pending deletion', (await call(o.token, 'GET', '/users/@me/guilds/pending-deletion')).some((x) => x.id === A.g.id))
ok('a member cannot restore it', (await raw(m.token, 'POST', `/guilds/${A.g.id}/restore`)).status === 403)
r = await callS(o.token, 'POST', `/guilds/${A.g.id}/restore`)
ok('the owner can', r.status === 200 && (await call(m.token, 'GET', '/guilds')).some((x) => x.id === A.g.id) && (await call(m.token, 'GET', `/channels/${A.ch.id}/messages?limit=5`)).some((x) => x.id === msg.id))
ok('restoring twice is refused', (await raw(o.token, 'POST', `/guilds/${A.g.id}/restore`)).status === 400)

console.log('-- account deletion and servers')
let blk = await call(o.token, 'GET', '/users/@me/deletion')
ok('owning an active server blocks account deletion', blk.blockers.guilds.some((x) => x.id === A.g.id))
await call(o.token, 'POST', `/guilds/${A.g.id}/deletion`, { password: PASSWORD, name: A.g.name })
blk = await call(o.token, 'GET', '/users/@me/deletion')
ok('a server already being deleted does not', !blk.blockers.guilds.some((x) => x.id === A.g.id))

console.log('-- forwards survive')
const dm = await call(m.token, 'POST', '/users/@me/channels', { recipient_id: o.user.id })
await call(o.token, 'POST', `/guilds/${A.g.id}/restore`)
const fwd = await call(m.token, 'POST', `/channels/${A.ch.id}/messages/${msg.id}/forward`, { channel_id: dm.id })
await call(o.token, 'POST', `/guilds/${A.g.id}/deletion`, { password: PASSWORD, name: A.g.name })

console.log('-- finalize')
sql(`UPDATE guilds SET deletion_scheduled_for = now() - interval '1 minute' WHERE id = '${A.g.id}'`)
r = await run()
ok('the job finalizes the due server', r.servers >= 1)
ok('the server row is gone; a bare tombstone stays', sql(`SELECT count(*) FROM guilds WHERE id = '${A.g.id}'`) === '0' && sql(`SELECT deletion_type FROM guild_tombstones WHERE id = '${A.g.id}'`) === 'owner')
ok('the tombstone has no name, icon, description or owner', sql("SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'guild_tombstones'") === 'deleted_at,deletion_type,id')
ok('channels, messages, attachments, invites, webhooks and members are hard-deleted', ['channels WHERE guild_id', 'messages WHERE channel_id', 'attachments WHERE channel_id', 'webhooks WHERE channel_id', 'guild_members WHERE guild_id', 'invites WHERE guild_id'].every((q) => {
  const [table, col] = q.split(' WHERE ')
  const id = col === 'guild_id' ? A.g.id : A.ch.id
  return sql(`SELECT count(*) FROM ${table} WHERE ${col} = '${id}'`) === '0'
}))
ok('stored files are removed', (await raw(m.token, 'GET', up.url)).status === 404)
r = await callS(m.token, 'GET', `/guilds/${A.g.id}`)
ok('the server now answers 410 with reason deleted', r.status === 410 && r.body.reason === 'deleted')
const f = (await call(o.token, 'GET', `/channels/${dm.id}/messages?limit=10`)).find((x) => x.id === fwd.id)
ok('the forward in the DM stays, marked as from a server no longer available', f && f.content === msg.content && f.forwarded_from === null && f.forwarded_unavailable === true)
const before = sql(`SELECT deleted_at FROM guild_tombstones WHERE id = '${A.g.id}'`)
r = await run()
ok('running the job again changes nothing', sql(`SELECT deleted_at FROM guild_tombstones WHERE id = '${A.g.id}'`) === before)

console.log('-- takedown')
const B = await makeServer(`Bad ${S}`)
const other = (await callS(o.token, 'POST', `/guilds/${B.g.id}/channels`, { name: 'other', kind: 'text' })).body
const inScope = await call(m.token, 'POST', `/channels/${B.ch.id}/messages`, { content: `evidence ${S}` })
const outScope = await call(m.token, 'POST', `/channels/${other.id}/messages`, { content: `unrelated ${S}` })
const kase = await call(mod.token, 'POST', '/admin/cases', { kind: 'investigation', subject_kind: 'server', subject_id: B.g.id, channel_ids: [B.ch.id], justification: 'illegal content in this server' })
ok('support cannot take servers down', (await raw(sup.token, 'POST', `/admin/guilds/${B.g.id}/takedown`, { case_id: kase.id, justification: 'policy violation, CSAM report' })).status === 403)
ok('a takedown needs a real case', (await raw(mod.token, 'POST', `/admin/guilds/${B.g.id}/takedown`, { case_id: '00000000-0000-4000-8000-000000000000', justification: 'policy violation here' })).status === 404)
ok('and a reason', (await raw(mod.token, 'POST', `/admin/guilds/${B.g.id}/takedown`, { case_id: kase.id })).status === 400)
r = await callS(mod.token, 'POST', `/admin/guilds/${B.g.id}/takedown`, { case_id: kase.id, justification: 'illegal content confirmed' })
ok('a moderator takes it down under the case, kept 90 days', r.status === 200 && r.body.state === 'taken_down' && Math.abs(new Date(r.body.retain_until) - Date.now() - 90 * 86400e3) < 120e3)
r = await callS(m.token, 'GET', `/guilds/${B.g.id}`)
ok('members get 410 taken_down', r.status === 410 && r.body.reason === 'taken_down' && !(await call(m.token, 'GET', '/guilds')).some((x) => x.id === B.g.id))
ok('the owner cannot restore it', (await raw(o.token, 'POST', `/guilds/${B.g.id}/restore`)).status === 400)
ok('nor delete it themselves', (await raw(o.token, 'POST', `/guilds/${B.g.id}/deletion`, { password: PASSWORD, name: B.g.name })).status === 410)
ok('the content stays reachable through the case', (await call(mod.token, 'GET', `/admin/cases/${kase.id}/messages?channel_id=${B.ch.id}`)).some((x) => x.id === inScope.id))
const tlog = JSON.parse(sql(`SELECT row_to_json(l) FROM (SELECT * FROM admin_access_log WHERE action = 'guild.takedown' AND '${B.g.id}' = ANY(target_ids)) l`))
ok('the takedown is logged with its case', tlog.case_id === kase.id && tlog.justification === 'illegal content confirmed')
ok('the admin list shows it taken down', (await call(admin.token, 'GET', `/admin/guilds?q=${encodeURIComponent(`Bad ${S}`)}`)).find((x) => x.id === B.g.id)?.state === 'taken_down')

console.log('-- legal hold snapshot')
sql(`UPDATE guilds SET deletion_scheduled_for = now() - interval '1 minute' WHERE id = '${B.g.id}'`)
await run()
const snap = JSON.parse(sql(`SELECT row_to_json(s) FROM (SELECT case_id, guild_id, messages FROM case_snapshots WHERE case_id = '${kase.id}') s`) || 'null')
ok('before finalizing, the open case gets a snapshot', snap && snap.guild_id === B.g.id)
ok('with only what the case covers', snap.messages.some((x) => x.id === inScope.id) && !snap.messages.some((x) => x.id === outScope.id))
ok('then the server is gone too', sql(`SELECT deletion_type FROM guild_tombstones WHERE id = '${B.g.id}'`) === 'takedown')

console.log('-- console')
const C = await makeServer(`Ui ${S}`)
const browser = await chromium.launch(); const errors = []
const page = async (u) => { const p = await browser.newPage({ viewport: { width: 1400, height: 900 } }); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((tk) => localStorage.setItem('parley.token', tk), u.token); return p }
const p = await page(o)
await p.goto(`${WEB}/channels/${C.g.id}/${C.ch.id}`); await p.waitForSelector(`aside button:has-text("${C.g.name}")`)
await p.click(`aside button:has-text("${C.g.name}")`)
ok('the quick menu has no Delete Server (it lives in Server Settings, like Discord)', await p.locator('button:has-text("Delete Server")').count() === 0)
await p.click('button:has-text("Server Settings")'); await p.click('[role=dialog] button[title="Delete Server"], [role=dialog] button:has-text("Delete Server")')
await p.waitForSelector('[data-delete-server]')
ok('Server Settings opens the confirmation, which waits for the name and password', await p.isDisabled('[data-delete-server-go]'))
await p.fill('[data-delete-server-name]', C.g.name); await p.fill('[data-delete-server-password]', PASSWORD)
await p.click('[data-delete-server-go]'); await p.waitForSelector('[data-delete-server]', { state: 'detached' })
ok('deleting from the dialog takes it away', (await raw(o.token, 'GET', `/guilds/${C.g.id}`)).status === 410 && (await p.locator(`aside button:has-text("${C.g.name}")`).count()) === 0)
const pm = await page(m)
await pm.goto(`${WEB}/channels/${C.g.id}/${C.ch.id}`); await pm.waitForSelector('[data-server-unavailable]')
ok('an old link shows "This server is no longer available"', (await pm.textContent('[data-server-unavailable]')).includes('no longer available'))
await p.goto(`${WEB}/channels/@me`); await p.click('[data-control="User Settings"]'); await p.waitForSelector(`[data-account-page] [data-restore-server="${C.g.id}"]`)
await p.click(`[data-restore-server="${C.g.id}"]`); await p.waitForSelector(`[data-restore-server="${C.g.id}"]`, { state: "detached" }); await p.waitForSelector(`[data-guild-icon="${C.g.id}"]`)
ok('the owner restores it from Settings › My Account, and it is back in their list', (await raw(m.token, 'GET', `/guilds/${C.g.id}`)).status === 200)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
