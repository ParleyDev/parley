// Admin lockdown, as of Phase 3 (docs/admin-access-and-server-deletion.md): the global admin message search and the
// temporary role that guarded it are gone. Content is reached through cases and the public-server search; the access
// log stays append-only in the database, and user-facing search is a separate path that behaves exactly as before.
import { execSync } from 'node:child_process'
import { S, reg, call, callS, raw, ok, finish, adminToken, testContainer, openDms } from '../lib.mjs'

const sql = (q) => execSync(`docker exec ${testContainer('db')} psql -U parley -tAc "${q.replace(/"/g, '\\"')}"`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
const sqlFails = (q, re) => { try { sql(q); return false } catch (e) { return re.test(String(e.stderr ?? e.message)) } }
const why = encodeURIComponent('report follow-up: spam check')

const admin = await adminToken()
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol'), helper = await reg('helper')
await openDms(a, b)
const g = await call(a.token, 'POST', '/guilds', { name: `Lock ${S}` }); const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const pub = await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: `lockdown public ${S}` })
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
const priv = await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: `lockdown private ${S}` })
const userSearch = async (u, q) => { const r = await call(u.token, 'GET', `/search?q=${encodeURIComponent(q)}`); return { total: r.total, ids: r.results.map((x) => (x.message ?? x).id).sort() } }
const before = { a: await userSearch(a, `lockdown ${S}`), b: await userSearch(b, `lockdown ${S}`), c: await userSearch(c, `lockdown ${S}`) }

console.log('-- no global search')
ok('admin message search is gone, for every admin', [404, 405].includes((await raw(admin.token, 'GET', `/admin/messages?q=lockdown&justification=${why}`)).status))
ok('so is opening any message by id', [404, 405].includes((await raw(admin.token, 'GET', `/admin/messages/${priv.id}/open?justification=${why}`)).status))
const u = await call(admin.token, 'GET', `/admin/users/${a.user.id}/content`)
ok("someone's account view carries no messages", !('messages' in u) && u.totals.messages === 2)
ok('the public search never reaches a DM', !(await call(admin.token, 'GET', `/admin/search/public?q=lockdown ${S}&justification=${why}`)).some((h) => h.id === priv.id))

console.log('-- the temporary role is gone')
const acc = await call(admin.token, 'GET', '/admin/access')
ok('ADMIN_EMAILS admins hold SUPER_ADMIN and TS_LEAD, nothing temporary', JSON.stringify(acc.roles) === '["TS_LEAD","SUPER_ADMIN"]' && !('content_search' in acc) && !acc.all_roles.includes('SUPER_ADMIN_TEMP'))
ok('it cannot be granted', (await raw(admin.token, 'PUT', `/admin/users/${helper.user.id}/roles`, { roles: ['SUPER_ADMIN_TEMP'] })).status === 400)
ok('not even through the database', sqlFails(`INSERT INTO admin_roles (user_id, role) VALUES ('${helper.user.id}', 'SUPER_ADMIN_TEMP')`, /admin_roles_role_check/))
ok('non-admins get nothing', (await raw(c.token, 'GET', '/admin/access')).status === 403 && (await raw(c.token, 'GET', `/admin/search/public?q=lockdown&justification=${why}`)).status === 403)

console.log('-- append-only log')
const logCount = () => Number(sql('SELECT count(*) FROM admin_access_log'))
await call(admin.token, 'GET', `/admin/search/public?q=lockdown ${S}&justification=${why}`)
const n0 = logCount()
ok('the database refuses to change entries', sqlFails("UPDATE admin_access_log SET justification = 'x'", /append-only/))
ok('or delete them', sqlFails('DELETE FROM admin_access_log', /append-only/))
ok('or truncate the table', sqlFails('TRUNCATE admin_access_log', /append-only/))
ok('nothing was lost', logCount() === n0 && n0 > 0)

console.log('-- user search is unchanged')
const after = { a: await userSearch(a, `lockdown ${S}`), b: await userSearch(b, `lockdown ${S}`), c: await userSearch(c, `lockdown ${S}`) }
ok('same results and totals as before, for everyone', JSON.stringify(after) === JSON.stringify(before), JSON.stringify({ before, after }))
ok('members find server and DM messages', after.a.ids.includes(pub.id) && after.a.ids.includes(priv.id) && after.b.ids.includes(priv.id))
ok('outsiders find nothing (and no count leaks)', after.c.total === 0 && after.c.ids.length === 0)
const n2 = logCount()
ok('an admin searching as a user needs no reason and leaves no admin log', (await raw(admin.token, 'GET', '/search?q=lockdown')).status === 200 && logCount() === n2)
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await finish()
