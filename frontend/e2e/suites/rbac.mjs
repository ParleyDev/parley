// Phase 1 roles and permissions (docs/admin-access-and-server-deletion.md): every admin endpoint asks the server for a
// permission, and roles map to permissions in one place. This suite walks a role × endpoint matrix over every admin
// route in the backend (it fails if a route is added without a row here), then checks role management, masked PII
// with a logged reveal, and that the console hides what a role cannot use.
import { readFileSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, ok, finish, adminToken, testContainer } from '../lib.mjs'

const sql = (q) => execSync(`docker exec ${testContainer('db')} psql -U parley -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim()
// Mirrors perms_for() in backend/src/routes/admin_access.rs.
const PERMS = {
  SUPPORT: ['account_metadata_read', 'account_pii_reveal'],
  MODERATOR: ['account_metadata_read', 'conversation_metadata_read', 'report_context_read', 'report_context_expand', 'content_search_public', 'content_action', 'audit_read_own'],
  TS_LEAD: ['account_metadata_read', 'account_pii_reveal', 'conversation_metadata_read', 'report_context_read', 'report_context_expand', 'content_search_public', 'content_search_private', 'content_action', 'case_approve', 'audit_read_team'],
  LEGAL: ['account_metadata_read', 'account_pii_reveal', 'conversation_metadata_read', 'report_context_read', 'report_context_expand', 'content_search_public', 'content_search_private', 'content_export', 'audit_read_all'],
  SUPER_ADMIN: ['account_metadata_read', 'admin_roles_manage', 'audit_read_all', 'instance_manage'],
  AUDITOR: ['audit_read_all'],
}
const ROLES = Object.keys(PERMS)
const admin = await adminToken()
const as = {}
for (const r of ROLES) {
  as[r] = await reg(r.toLowerCase().replace('_', ''))
  await call(admin.token, 'PUT', `/admin/users/${as[r].user.id}/roles`, { roles: [r] })
}
const plain = await reg('plain')
const target = await reg('target', `target${S}@example.org`)

console.log('-- each role holds exactly its permissions')
for (const r of ROLES) {
  const a = await call(as[r].token, 'GET', '/admin/access')
  ok(`${r}`, JSON.stringify(a.roles) === JSON.stringify([r]) && JSON.stringify([...a.perms].sort()) === JSON.stringify([...PERMS[r]].sort()) && a.content_search === false, JSON.stringify(a))
}

// Nonexistent targets keep allowed calls harmless: the permission check comes first, so a refused role gets 403 and an
// allowed one gets past it (404, 400 or 200).
const X = '00000000-0000-4000-8000-0000000000ff'
const why = 'rbac matrix: checking access'
const J = encodeURIComponent(why)
const settings = await call(admin.token, 'GET', '/admin/settings')
const mailSettings = await call(admin.token, 'GET', '/admin/mail/settings')
const TEMP = 'SUPER_ADMIN_TEMP'
const ANY = 'any'
// [method, route pattern, concrete path, body, permission(s) (any of)]
const M = [
  ['GET', '/admin/access', '/admin/access', null, ANY],
  ['GET', '/admin/access-log', '/admin/access-log?limit=1', null, 'audit_read_all'],
  ['GET', '/admin/applications', '/admin/applications', null, 'instance_manage'],
  ['PATCH', '/admin/applications/:id', `/admin/applications/${X}`, { verified: false }, 'instance_manage'],
  ['GET', '/admin/audit', '/admin/audit', null, ['audit_read_own', 'audit_read_team', 'audit_read_all']],
  ['GET', '/admin/blocked-domains', '/admin/blocked-domains', null, 'instance_manage'],
  ['POST', '/admin/blocked-domains', '/admin/blocked-domains', { domain: `rbac${S}.example` }, 'instance_manage'],
  ['DELETE', '/admin/blocked-domains/:domain', `/admin/blocked-domains/rbac${S}.example`, null, 'instance_manage'],
  ['POST', '/admin/deletions/run', '/admin/deletions/run', null, 'instance_manage'],
  ['GET', '/admin/discovery', '/admin/discovery', null, 'instance_manage'],
  ['PATCH', '/admin/discovery/:gid', `/admin/discovery/${X}`, {}, 'instance_manage'],
  ['POST', '/admin/discovery/:gid/review', `/admin/discovery/${X}/review`, { status: 'approved' }, 'instance_manage'],
  ['GET', '/admin/guilds', '/admin/guilds', null, 'conversation_metadata_read'],
  ['DELETE', '/admin/guilds/:id', `/admin/guilds/${X}`, null, 'content_action'],
  ['GET', '/admin/mail', '/admin/mail?limit=1', null, 'account_pii_reveal'],
  ['DELETE', '/admin/mail', `/admin/mail?to=nobody-rbac${S}@example.org`, null, 'instance_manage'],
  ['DELETE', '/admin/mail/:id', `/admin/mail/${X}`, null, 'instance_manage'],
  ['GET', '/admin/mail/settings', '/admin/mail/settings', null, 'instance_manage'],
  ['PUT', '/admin/mail/settings', '/admin/mail/settings', mailSettings, 'instance_manage'],
  ['POST', '/admin/maintenance/sweep-images', '/admin/maintenance/sweep-images', null, 'instance_manage'],
  ['GET', '/admin/messages', `/admin/messages?q=rbac-matrix-${S}&justification=${J}`, null, TEMP],
  ['DELETE', '/admin/messages/:id', `/admin/messages/${X}`, null, 'content_action'],
  ['GET', '/admin/messages/:id/open', `/admin/messages/${X}/open?justification=${J}`, null, TEMP],
  ['GET', '/admin/reports', '/admin/reports', null, 'report_context_read'],
  ['PATCH', '/admin/reports/:id', `/admin/reports/${X}`, { status: 'resolved' }, 'content_action'],
  ['GET', '/admin/roles', '/admin/roles', null, 'admin_roles_manage'],
  ['GET', '/admin/settings', '/admin/settings', null, 'instance_manage'],
  ['PUT', '/admin/settings', '/admin/settings', settings, 'instance_manage'],
  ['GET', '/admin/stats', '/admin/stats', null, ANY],
  ['GET', '/admin/users', `/admin/users?q=${S}`, null, 'account_metadata_read'],
  ['PATCH', '/admin/users/:id', `/admin/users/${X}`, { suspended: true }, 'content_action'],
  ['PATCH', '/admin/users/:id', `/admin/users/${X}`, { is_admin: true }, 'admin_roles_manage'],
  ['PATCH', '/admin/users/:id', `/admin/users/${X}`, { upload_quota_bytes: null }, 'instance_manage'],
  ['DELETE', '/admin/users/:id', `/admin/users/${X}`, null, 'content_action'],
  ['GET', '/admin/users/:id/content', `/admin/users/${X}/content?justification=${J}`, null, TEMP],
  ['DELETE', '/admin/users/:id/messages', `/admin/users/${X}/messages`, null, 'content_action'],
  ['POST', '/admin/users/:id/purge', `/admin/users/${X}/purge`, null, 'content_action'],
  ['POST', '/admin/users/:id/reveal', `/admin/users/${X}/reveal`, { justification: why }, 'account_pii_reveal'],
  ['PUT', '/admin/users/:id/roles', `/admin/users/${X}/roles`, { roles: [] }, 'admin_roles_manage'],
  ['GET', '/admin/users/:id/sessions', `/admin/users/${X}/sessions`, null, 'account_metadata_read'],
  ['DELETE', '/admin/users/:id/sessions', `/admin/users/${X}/sessions`, null, 'content_action'],
  ['DELETE', '/admin/users/:id/sessions/:sid', `/admin/users/${X}/sessions/${X}`, null, 'content_action'],
  ['DELETE', '/admin/users/:id/uploads', `/admin/users/${X}/uploads`, null, 'content_action'],
  ['POST', '/admin/users/bulk', '/admin/users/bulk', { ids: [X], action: 'suspend' }, 'content_action'],
  ['POST', '/admin/users/bulk', '/admin/users/bulk', { ids: [X], action: 'quota', upload_quota_bytes: null }, 'instance_manage'],
]

console.log('-- the matrix covers every admin route')
const dir = new URL('../../../backend/src/routes/', import.meta.url)
const routes = new Set()
for (const f of readdirSync(dir).filter((f) => f.endsWith('.rs'))) {
  const src = readFileSync(new URL(f, dir), 'utf8')
  for (const m of src.matchAll(/\.route\(\s*"(\/admin[^"]*)",\s*([^\n]+)/g)) {
    for (const verb of m[2].matchAll(/\b(get|post|put|patch|delete)\(/g)) routes.add(`${verb[1].toUpperCase()} ${m[1]}`)
  }
}
const covered = new Set(M.map(([m, r]) => `${m} ${r}`))
const missing = [...routes].filter((r) => !covered.has(r))
ok(`${routes.size} admin routes found, all in the matrix`, routes.size > 40 && missing.length === 0, missing.join(', '))

console.log('-- role × endpoint')
const allowed = (role, need) => need === ANY || (need !== TEMP && [need].flat().some((p) => PERMS[role].includes(p)))
for (const [method, route, path, body, need] of M) {
  const res = {}
  for (const r of ROLES) res[r] = (await raw(as[r].token, method, path, body)).status
  res.none = (await raw(plain.token, method, path, body)).status
  const bad = ROLES.filter((r) => allowed(r, need) ? [401, 403].includes(res[r]) : res[r] !== 403)
  const label = `${method} ${route}${body?.action ? ` (${body.action})` : body && method === 'PATCH' && route === '/admin/users/:id' ? ` (${Object.keys(body)[0]})` : ''}`
  ok(`${label}: ${ROLES.filter((r) => allowed(r, need)).join(', ') || 'nobody yet'}`, bad.length === 0 && res.none === 403, JSON.stringify(res))
}
await call(admin.token, 'DELETE', `/admin/blocked-domains/rbac${S}.example`).catch(() => {})

console.log('-- role management')
const last = (action) => JSON.parse(sql(`SELECT row_to_json(l) FROM (SELECT * FROM admin_access_log WHERE action = '${action}' ORDER BY at DESC LIMIT 1) l`) || 'null')
const sup = as.SUPER_ADMIN
let r = await callS(sup.token, 'PUT', `/admin/users/${plain.user.id}/roles`, { roles: ['MODERATOR', 'AUDITOR'] })
ok('a super admin grants roles', r.status === 200 && JSON.stringify(r.body.roles) === '["MODERATOR","AUDITOR"]')
let e = last('roles.set')
ok('the change is logged with before and after', e.actor_id === sup.user.id && e.target_ids[0] === plain.user.id && JSON.stringify(e.filters.before) === '[]' && JSON.stringify(e.filters.after) === '["MODERATOR","AUDITOR"]')
ok('the grantee now opens the console', (await raw(plain.token, 'GET', '/admin/access')).status === 200)
ok('unknown roles are refused', (await raw(sup.token, 'PUT', `/admin/users/${plain.user.id}/roles`, { roles: ['GOD'] })).status === 400)
ok('moderators cannot grant roles, even to themselves', (await raw(as.MODERATOR.token, 'PUT', `/admin/users/${as.MODERATOR.user.id}/roles`, { roles: ['SUPER_ADMIN'] })).status === 403)
r = await callS(sup.token, 'PUT', `/admin/users/${plain.user.id}/roles`, { roles: [] })
ok('taking every role away closes the console', r.status === 200 && (await raw(plain.token, 'GET', '/admin/access')).status === 403)
const gone = await reg('gone')
sql(`UPDATE users SET account_state = 'pending_deletion' WHERE id = '${gone.user.id}'`)
ok('only active accounts can hold roles', (await raw(sup.token, 'PUT', `/admin/users/${gone.user.id}/roles`, { roles: ['SUPPORT'] })).status === 400)
const listed = await call(sup.token, 'GET', '/admin/roles')
ok('the roles list shows who holds what', listed.find((x) => x.id === as.LEGAL.user.id)?.roles.includes('LEGAL'))
ok('SUPER_ADMIN reads no content', (await raw(sup.token, 'GET', `/admin/users/${target.user.id}/content?justification=${J}`)).status === 403 && (await raw(sup.token, 'GET', `/admin/messages?q=anything-at-all&justification=${J}`)).status === 403)

console.log('-- PII is masked; reveal is logged')
const row = async (u) => (await call(u.token, 'GET', `/admin/users?q=target${S}`)).find((x) => x.id === target.user.id)
ok('support sees a masked email', (await row(as.SUPPORT)).email === 't***@example.org', (await row(as.SUPPORT)).email)
ok('moderators too', (await row(as.MODERATOR)).email === 't***@example.org')
ok('T&S leads and legal see it', (await row(as.TS_LEAD)).email === `target${S}@example.org` && (await row(as.LEGAL)).email === `target${S}@example.org`)
ok('searching by email needs PII access', !(await call(as.MODERATOR.token, 'GET', `/admin/users?q=${encodeURIComponent(`target${S}@example.org`)}`)).some((x) => x.id === target.user.id) && (await call(as.TS_LEAD.token, 'GET', `/admin/users?q=${encodeURIComponent(`target${S}@example.org`)}`)).some((x) => x.id === target.user.id))
const sess = await call(as.SUPPORT.token, 'GET', `/admin/users/${target.user.id}/sessions`)
ok('session lists hide IPs and devices', sess.length > 0 && sess.every((x) => x.ip === 'hidden' && x.user_agent === 'hidden'))
ok('a reveal needs a reason', (await raw(as.SUPPORT.token, 'POST', `/admin/users/${target.user.id}/reveal`, {})).status === 400)
r = await callS(as.SUPPORT.token, 'POST', `/admin/users/${target.user.id}/reveal`, { justification: 'ticket 4411: login help' })
ok('with one, support sees the email and devices', r.status === 200 && r.body.email === `target${S}@example.org` && r.body.sessions.length > 0 && r.body.sessions[0].ip !== 'hidden')
e = last('pii.reveal')
ok('and the reveal is logged', e.actor_id === as.SUPPORT.user.id && e.target_ids[0] === target.user.id && e.justification === 'ticket 4411: login help' && e.actor_roles.includes('SUPPORT'))

console.log('-- audit scope')
await call(as.MODERATOR.token, 'PATCH', `/admin/users/${target.user.id}`, { suspended: true })
await call(as.MODERATOR.token, 'PATCH', `/admin/users/${target.user.id}`, { suspended: false })
const own = await call(as.MODERATOR.token, 'GET', '/admin/audit')
ok('moderators read only their own entries', own.length > 0 && own.every((x) => x.actor_id === as.MODERATOR.user.id))
const team = await call(as.TS_LEAD.token, 'GET', '/admin/audit')
ok("T&S leads read their team's", team.some((x) => x.actor_id === as.MODERATOR.user.id) && !team.some((x) => x.actor_id === sup.user.id))
const all = await call(as.AUDITOR.token, 'GET', '/admin/audit')
ok('auditors read everything', all.some((x) => x.actor_id === as.MODERATOR.user.id) && all.some((x) => x.actor_id === sup.user.id))

console.log('-- console follows the role')
const browser = await chromium.launch(); const errors = []
const navFor = async (u) => {
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } }); p.on('pageerror', (x) => errors.push(x.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}/admin`); await p.waitForSelector('[data-admin-nav="overview"]'); await p.waitForTimeout(600)
  return { p, nav: await p.$$eval('[data-admin-nav]', (l) => l.map((x) => x.getAttribute('data-admin-nav')).sort()) }
}
let v = await navFor(as.AUDITOR)
ok('auditors see the audit log only', JSON.stringify(v.nav) === '["audit","overview"]', JSON.stringify(v.nav)); await v.p.close()
v = await navFor(as.MODERATOR)
ok('moderators see users, servers, reports and audit', JSON.stringify(v.nav) === '["audit","overview","reports","servers","users"]', JSON.stringify(v.nav))
await v.p.goto(`${WEB}/admin/users`); await v.p.fill('[data-admin-user-search]', `target${S}`); await v.p.waitForSelector(`[data-admin-user="target${S}"]`)
const tools = async (p) => p.$$eval(`[data-admin-user="target${S}"] [data-admin-action]`, (l) => l.map((x) => x.getAttribute("data-admin-action")))
let tl = await tools(v.p)
ok('their row tools are moderation ones', tl.includes('toggle-suspend') && tl.includes('delete-user') && !tl.includes('roles') && !tl.includes('quota') && !tl.includes('content'), JSON.stringify(tl))
ok('no reveal for them', (await v.p.locator(`[data-admin-user="target${S}"] [data-admin-reveal]`).count()) === 0); await v.p.close()
v = await navFor(as.SUPPORT)
await v.p.goto(`${WEB}/admin/users`); await v.p.fill('[data-admin-user-search]', `target${S}`); await v.p.waitForSelector(`[data-admin-user="target${S}"]`)
ok('support sees no action tools', (await tools(v.p)).length === 0)
await v.p.click(`[data-admin-user="target${S}"] [data-admin-reveal]`); await v.p.waitForSelector('[data-admin-reveal-dialog]')
ok('reveal stays disabled without a real reason', await v.p.isDisabled('[data-admin-reveal-go]'))
await v.p.fill('[data-admin-reveal-why]', 'ticket 4412: email change'); await v.p.click('[data-admin-reveal-go]')
await v.p.waitForSelector('[data-admin-revealed-email]')
ok('then shows the email', (await v.p.textContent('[data-admin-revealed-email]')) === `target${S}@example.org`); await v.p.close()
v = await navFor(sup)
ok('super admins see instance tools, not messages or reports', v.nav.includes('settings') && v.nav.includes('users') && !v.nav.includes('messages') && !v.nav.includes('reports'), JSON.stringify(v.nav))
await v.p.goto(`${WEB}/admin/users`); await v.p.fill('[data-admin-user-search]', `target${S}`); await v.p.waitForSelector(`[data-admin-user="target${S}"]`)
await v.p.click(`[data-admin-user="target${S}"] [data-admin-action="roles"]`); await v.p.waitForSelector('[data-admin-roles-dialog] [data-admin-role="SUPPORT"]')
await v.p.check('[data-admin-role="SUPPORT"]'); await v.p.check('[data-admin-role="AUDITOR"]'); await v.p.click('[data-admin-roles-save]')
await v.p.waitForSelector('[data-admin-roles-dialog]', { state: 'detached' })
ok('the roles dialog grants roles', JSON.stringify((await call(target.token, 'GET', '/admin/access')).roles) === '["SUPPORT","AUDITOR"]')
await v.p.click(`[data-admin-user="target${S}"] [data-admin-action="roles"]`); await v.p.waitForSelector('[data-admin-role="SUPPORT"]:checked')
ok('and shows what someone holds', await v.p.isChecked('[data-admin-role="AUDITOR"]') && !(await v.p.isChecked('[data-admin-role="LEGAL"]')))
await v.p.close()
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
