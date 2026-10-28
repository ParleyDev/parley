// Phase 4 (docs/admin-access-and-server-deletion.md): one append-only audit log for the console. Every action lands in
// admin_access_log with the actor's roles, IP and user agent, IDs only; names are resolved when it is read, so deleting
// an account rewrites nothing. Retention is pruned only through a database function that never removes anything younger
// than a year. Auditors filter by admin, case, target and date.
import { execSync } from 'node:child_process'
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, ok, finish, adminToken, testContainer } from '../lib.mjs'

const sql = (q) => execSync(`docker exec ${testContainer('db')} psql -U parley -tAc "${q.replace(/"/g, '\\"')}"`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
const fails = (q, re) => { try { sql(q); return false } catch (e) { return re.test(String(e.stderr ?? e.message)) } }
const admin = await adminToken()
const role = async (name, roles) => { const u = await reg(name); await call(admin.token, 'PUT', `/admin/users/${u.user.id}/roles`, { roles }); return u }
const mod = await role('mod', ['MODERATOR']), aud = await role('aud', ['AUDITOR']), mod2 = await role('modtwo', ['MODERATOR'])
const t = await reg('target')

console.log('-- one log')
await call(mod.token, 'PATCH', `/admin/users/${t.user.id}`, { suspended: true })
const raw1 = JSON.parse(sql(`SELECT row_to_json(l) FROM (SELECT * FROM admin_access_log WHERE action = 'user.suspend' AND '${t.user.id}' = ANY(target_ids)) l`))
ok('console actions go to the access log', !!raw1 && raw1.actor_id === mod.user.id && raw1.target_kind === 'user')
ok('with the roles, IP and user agent of whoever acted', JSON.stringify(raw1.actor_roles) === '["MODERATOR"]' && raw1.ip !== '' && raw1.user_agent !== '')
ok('and no names stored', !JSON.stringify(raw1).includes(`target${S}`) && !JSON.stringify(raw1).includes(`mod${S}`))
ok('the old table is gone', fails('SELECT 1 FROM admin_audit', /does not exist/))
ok('so is the separate access-log endpoint', [404, 405].includes((await raw(aud.token, 'GET', '/admin/access-log')).status))

console.log('-- read with names resolved now')
let rows = await call(aud.token, 'GET', `/admin/audit?target_id=${t.user.id}`)
let e = rows.find((x) => x.action === 'user.suspend')
ok('the auditor sees it with names looked up', e && e.actor_name === `mod${S}` && e.target_name === `target${S}` && JSON.stringify(e.actor_roles) === '["MODERATOR"]')
ok('and, reading the whole log, IP and device', e.ip !== '' && e.user_agent !== '')
const own = (await call(mod.token, 'GET', '/admin/audit')).find((x) => x.id === e.id)
ok('moderators read their own entries without IPs', own && own.ip === '' && own.user_agent === '')
ok("but not another moderator's", !(await call(mod2.token, 'GET', '/admin/audit')).some((x) => x.id === e.id))

console.log('-- account deletion rewrites nothing')
const before = sql(`SELECT md5(row_to_json(l)::text) FROM admin_access_log l WHERE id = '${e.id}'`)
await callS(mod.token, 'DELETE', `/admin/users/${t.user.id}`)
ok('the entry is untouched', sql(`SELECT md5(row_to_json(l)::text) FROM admin_access_log l WHERE id = '${e.id}'`) === before)
e = (await call(aud.token, 'GET', `/admin/audit?target_id=${t.user.id}`)).find((x) => x.action === 'user.suspend')
ok('and now reads as the tombstone', /^deleted_user_[a-z0-9]{12}$/.test(e.target_name), e.target_name)

console.log('-- filters')
const kase = await call(mod.token, 'POST', '/admin/cases', { kind: 'investigation', subject_kind: 'user', subject_id: mod2.user.id, channel_ids: [(await call(mod2.token, 'POST', '/guilds', { name: `Aud ${S}` })).channels.find((c) => c.kind === 'text').id], justification: 'audit log filter check' })
rows = await call(aud.token, 'GET', `/admin/audit?case_id=${kase.id}`)
ok('by case', rows.length >= 1 && rows.every((x) => x.case_id === kase.id) && rows.some((x) => x.action === 'case.open'))
rows = await call(aud.token, 'GET', `/admin/audit?actor_id=${mod.user.id}`)
ok('by admin', rows.length >= 3 && rows.every((x) => x.actor_id === mod.user.id))
const tomorrow = new Date(Date.now() + 86400e3).toISOString()
ok('by date', (await call(aud.token, 'GET', `/admin/audit?actor_id=${mod.user.id}&from=${tomorrow}`)).length === 0 && (await call(aud.token, 'GET', `/admin/audit?actor_id=${mod.user.id}&to=${tomorrow}`)).length >= 3)
ok('auditors cannot act', (await raw(aud.token, 'PATCH', `/admin/users/${mod2.user.id}`, { suspended: true })).status === 403)

console.log('-- append-only and retention')
ok('updates are refused', fails(`UPDATE admin_access_log SET action = 'x' WHERE id = '${e.id}'`, /append-only/))
ok('deletes are refused', fails(`DELETE FROM admin_access_log WHERE id = '${e.id}'`, /append-only/))
ok('even with the prune switch on, for anything under a year old', fails(`BEGIN; SELECT set_config('parley.audit_prune', 'on', true); DELETE FROM admin_access_log WHERE id = '${e.id}'; COMMIT;`, /append-only/))
ok('truncation is refused', fails('TRUNCATE admin_access_log', /append-only/))
ok('pruning to less than a year is refused', fails('SELECT admin_access_log_prune(30)', /at least 365/))
const old = `00000000-0000-7000-8000-${String(S).padStart(12, '0')}`
sql(`INSERT INTO admin_access_log (id, at, actor_id, action) VALUES ('${old}', now() - interval '800 days', '${mod.user.id}', 'test.old')`)
const total = Number(sql('SELECT count(*) FROM admin_access_log'))
const removed = Number(sql('SELECT admin_access_log_prune(730)'))
ok('the prune function removes entries past retention', removed >= 1 && sql(`SELECT count(*) FROM admin_access_log WHERE id = '${old}'`) === '0')
ok('and nothing newer', Number(sql('SELECT count(*) FROM admin_access_log')) === total - removed && sql(`SELECT count(*) FROM admin_access_log WHERE id = '${e.id}'`) === '1')

console.log('-- console')
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1400, height: 900 } }); p.on('pageerror', (x) => errors.push(x.message))
await p.goto(`${WEB}/login`); await p.evaluate((tk) => localStorage.setItem('parley.token', tk), aud.token)
await p.goto(`${WEB}/admin/audit`); await p.waitForSelector('[data-admin-audit-filters]')
await p.fill('[data-admin-audit-filter="case_id"]', kase.id)
await p.waitForSelector('[data-admin-audit-row][data-audit-action="case.open"]')
ok('the auditor filters by case in the console', (await p.locator('[data-admin-audit-row]').count()) === (await call(aud.token, 'GET', `/admin/audit?case_id=${kase.id}`)).length)
ok('rows show the roles and the reason', (await p.textContent('[data-audit-action="case.open"] [data-audit-roles]')) === 'MODERATOR' && (await p.textContent('[data-audit-action="case.open"] [data-audit-why]')).includes('audit log filter check'))
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
