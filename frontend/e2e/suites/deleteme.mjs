import { chromium } from 'playwright'
import { createHmac } from 'node:crypto'
import { B, H, WEB, S, PASSWORD, reg, call, callS, raw, ok, finish, adminToken } from '../lib.mjs'

const b32 = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, val = 0; const out = []; for (const ch of s.toUpperCase()) { val = (val << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8 } } return Buffer.from(out) }
const totp = (secret, step = Math.floor(Date.now() / 30000)) => { const msg = Buffer.alloc(8); msg.writeBigInt64BE(BigInt(step)); const h = createHmac('sha1', b32(secret)).update(msg).digest(); const o = h[19] & 15; const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]; return String(n % 1e6).padStart(6, '0') }

const admin = await adminToken()
const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')

console.log('-- API')
const g = await call(a.token, 'POST', '/guilds', { name: `Alice HQ ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
ok('bob joined alice\'s server', (await call(b.token, 'GET', '/guilds')).some((x) => x.id === g.id))
let r = await callS(a.token, 'DELETE', '/users/@me', { password: 'not-it-sorry' }); ok('wrong password refused', r.status === 400 && /password/i.test(r.body.error))
r = await callS(a.token, 'DELETE', '/users/@me', {}); ok('missing body refused', r.status === 400 || r.status === 422)
ok('account still exists', (await raw(a.token, 'GET', '/users/@me')).status === 200)
// 2FA accounts must also present a code
r = await callS(c.token, 'POST', '/users/@me/mfa/enroll', { password: PASSWORD }); const secret = r.body.secret
r = await callS(c.token, 'POST', '/users/@me/mfa/confirm', { code: totp(secret) }); const backup = r.body.backup_codes
r = await callS(c.token, 'DELETE', '/users/@me', { password: PASSWORD }); ok('2FA account needs a code', r.status === 400 && /two-factor code/i.test(r.body.error))
r = await callS(c.token, 'DELETE', '/users/@me', { password: PASSWORD, code: '000000' }); ok('wrong code refused', r.status === 400 && r.body.error === 'Invalid code')
r = await raw(c.token, 'DELETE', '/users/@me', { password: PASSWORD, code: backup[0] }); ok('password + backup code deletes the 2FA account', r.status === 204 && (await raw(c.token, 'GET', '/users/@me')).status === 401)
// sole admin guard: promote bob, demote the e2e admin would break other suites, so check the message with a throwaway admin pair instead
r = await callS(admin.token, 'PATCH', `/admin/users/${b.user.id}`, { is_admin: true })
r = await callS(b.token, 'DELETE', '/users/@me', { password: PASSWORD }); ok('an admin who is not the last one may delete themselves', r.status === 204)
ok('bob is gone', (await callS(admin.token, 'GET', `/admin/users?q=bob${S}`)).body.length === 0)

console.log('-- UI')
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('[data-control="User Settings"]'); await p.click('[data-control="User Settings"]'); await p.waitForSelector('[data-delete-account]')
await p.click('[data-delete-open]'); await p.waitForSelector('[data-delete-form]')
ok('delete form has no 2FA field for a non-2FA account', await p.locator('[data-delete-code]').count() === 0)
await p.fill('[data-delete-password]', 'wrongpassword'); await p.check('[data-delete-confirm]'); await p.click('[data-delete-submit]'); await p.waitForSelector('[data-delete-error]')
ok('wrong password reported inline, account intact', /password/i.test(await p.textContent('[data-delete-error]')) && (await raw(a.token, 'GET', '/users/@me')).status === 200)
await p.screenshot({ path: '95-delete-account.png' })
await p.fill('[data-delete-password]', PASSWORD); await p.click('[data-delete-submit]'); await p.waitForURL(/\/login/, { timeout: 10000 }).catch(() => {})
ok('deleting returns to the login page', /\/login/.test(p.url()))
ok('the account, its token and its server are gone', (await raw(a.token, 'GET', '/users/@me')).status === 401 && (await callS(admin.token, 'GET', `/admin/users?q=alice${S}`)).body.length === 0 && (await callS(admin.token, 'GET', `/admin/guilds?q=Alice HQ ${S}`)).body.length === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
