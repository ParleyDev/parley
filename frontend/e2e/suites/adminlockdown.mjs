// Phase 0 admin lockdown (docs/admin-access-and-server-deletion.md): reading message content from the admin console
// needs SUPER_ADMIN_TEMP (ADMIN_EMAILS admins, or a granted row), a justification each time, and is written to the
// append-only admin_access_log (query, filters, justification, ids returned or opened, IP, user agent). The database
// refuses to change that log. User-facing search is a separate path and behaves exactly as before.
import { execSync } from 'node:child_process'
import { S, reg, call, callS, raw, ok, finish, adminToken, testContainer, openDms } from '../lib.mjs'

const sql = (q) => execSync(`docker exec ${testContainer('db')} psql -U parley -tAc "${q.replace(/"/g, '\\"')}"`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
const sqlFails = (q) => { try { sql(q); return false } catch (e) { return /append-only/.test(String(e.stderr ?? e.message)) } }
const why = encodeURIComponent('report follow-up: spam check')

const admin = await adminToken()
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol'), helper = await reg('helper')
await openDms(a, b)
const g = await call(a.token, 'POST', '/guilds', { name: `Lock ${S}` }); const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const pub = await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: `lockdown public ${S}` })
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
const priv = await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: `lockdown private ${S}` })
// User search, before any admin activity.
const userSearch = async (u, q) => { const r = await call(u.token, 'GET', `/search?q=${encodeURIComponent(q)}`); return { total: r.total, ids: r.results.map((x) => (x.message ?? x).id).sort() } }
const before = { a: await userSearch(a, `lockdown ${S}`), b: await userSearch(b, `lockdown ${S}`), c: await userSearch(c, `lockdown ${S}`) }

console.log('-- who may')
ok('ADMIN_EMAILS admins hold SUPER_ADMIN_TEMP', (await call(admin.token, 'GET', '/admin/access')).content_search === true)
await callS(admin.token, 'PATCH', `/admin/users/${helper.user.id}`, { is_admin: true })
const h = await call(helper.token, 'GET', '/admin/access')
ok('other admins do not', h.content_search === false && !h.roles.includes('SUPER_ADMIN_TEMP'))
ok('they cannot search messages', (await raw(helper.token, 'GET', `/admin/messages?q=lockdown&justification=${why}`)).status === 403)
ok("nor open someone's content", (await raw(helper.token, 'GET', `/admin/users/${a.user.id}/content?justification=${why}`)).status === 403)
ok('nor open a message', (await raw(helper.token, 'GET', `/admin/messages/${pub.id}/open?justification=${why}`)).status === 403)
ok('nor read the access log', (await raw(helper.token, 'GET', '/admin/access-log')).status === 403)
ok('non-admins get nothing either', (await raw(c.token, 'GET', `/admin/messages?q=lockdown&justification=${why}`)).status === 403 && (await raw(c.token, 'GET', '/admin/access')).status === 403)

console.log('-- justification')
let r = await callS(admin.token, 'GET', `/admin/messages?q=lockdown ${S}`)
ok('a search needs a reason', r.status === 400 && /reason|why/i.test(r.body.error))
r = await callS(admin.token, 'GET', `/admin/messages?q=lockdown ${S}&justification=because`)
ok('a real one (10+ characters)', r.status === 400)
ok('the user-content view too', (await raw(admin.token, 'GET', `/admin/users/${a.user.id}/content`)).status === 400)
const logCount = () => Number(sql('SELECT count(*) FROM admin_access_log'))
const n0 = logCount()
const hits = await call(admin.token, 'GET', `/admin/messages?q=lockdown ${S}&justification=${why}`)
ok('with one, it works', hits.some((m) => m.id === pub.id) && hits.some((m) => m.id === priv.id))

console.log('-- logged')
const last = (action) => JSON.parse(sql(`SELECT row_to_json(l) FROM (SELECT * FROM admin_access_log WHERE action = '${action}' ORDER BY at DESC LIMIT 1) l`) || 'null')
let e = last('content.search')
ok('every search is logged: who, as what, why, what and the ids returned', logCount() === n0 + 1 && e.actor_id === (await call(admin.token, 'GET', '/users/@me')).id && e.actor_roles.includes('SUPER_ADMIN_TEMP') && e.query === `lockdown ${S}` && e.justification === 'report follow-up: spam check' && e.target_ids.includes(pub.id) && e.target_ids.includes(priv.id))
ok('with IP and user agent', e.ip !== undefined && typeof e.user_agent === 'string')
const opened = await call(admin.token, 'GET', `/admin/messages/${priv.id}/open?justification=${why}`)
e = last('content.open')
ok('opening a result is its own entry', opened.id === priv.id && e.target_ids.length === 1 && e.target_ids[0] === priv.id)
await call(admin.token, 'GET', `/admin/users/${a.user.id}/content?justification=${why}`)
e = last('content.user')
ok("opening someone's content is logged with the messages shown", e.filters.user_id === a.user.id && e.target_ids.includes(pub.id))
const log = await call(admin.token, 'GET', '/admin/access-log?limit=5')
ok('content-access holders can read the log', log.length >= 3 && log[0].action === 'content.user')

console.log('-- append-only')
ok('the database refuses to change entries', sqlFails('UPDATE admin_access_log SET justification = \'x\''))
ok('or delete them', sqlFails('DELETE FROM admin_access_log'))
ok('or truncate the table', sqlFails('TRUNCATE admin_access_log'))
ok('nothing was lost', logCount() >= n0 + 3)

console.log('-- granting the role')
sql(`INSERT INTO admin_roles (user_id, role) VALUES ('${helper.user.id}', 'SUPER_ADMIN_TEMP')`)
ok('a granted admin can search (still with a reason)', (await raw(helper.token, 'GET', `/admin/messages?q=lockdown ${S}&justification=${why}`)).status === 200 && (await raw(helper.token, 'GET', `/admin/messages?q=lockdown ${S}`)).status === 400)

console.log('-- user search is unchanged')
const after = { a: await userSearch(a, `lockdown ${S}`), b: await userSearch(b, `lockdown ${S}`), c: await userSearch(c, `lockdown ${S}`) }
ok('same results and totals as before, for everyone', JSON.stringify(after) === JSON.stringify(before), JSON.stringify({ before, after }))
ok('members find server and DM messages', after.a.ids.includes(pub.id) && after.a.ids.includes(priv.id) && after.b.ids.includes(priv.id))
ok("outsiders find nothing (and no count leaks)", after.c.total === 0 && after.c.ids.length === 0)
const n2 = logCount()
ok('an admin searching as a user needs no reason and leaves no log', (await raw(admin.token, 'GET', `/search?q=lockdown`)).status === 200 && logCount() === n2)
const n1 = logCount(); await userSearch(a, `lockdown ${S}`)
ok('user searches are not admin-logged', logCount() === n1)
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await finish()
