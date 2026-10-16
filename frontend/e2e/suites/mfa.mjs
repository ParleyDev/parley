import { chromium } from 'playwright'
import { createHmac } from 'node:crypto'
import { B, H, WEB, S, PASSWORD, reg, call, callS, loginRaw, ok, finish, adminToken } from '../lib.mjs'

// RFC 6238 TOTP in node, so the suite can act as the authenticator app.
const b32 = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, val = 0; const out = []; for (const ch of s.toUpperCase()) { val = (val << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8 } } return Buffer.from(out) }
const totp = (secret, step = Math.floor(Date.now() / 30000)) => { const msg = Buffer.alloc(8); msg.writeBigInt64BE(BigInt(step)); const h = createHmac('sha1', b32(secret)).update(msg).digest(); const o = h[19] & 15; const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]; return String(n % 1e6).padStart(6, '0') }
const step = () => Math.floor(Date.now() / 30000)
// Failed second-factor attempts spend the per-IP login_fail bucket (5/min); negative checks use a second IP so the
// positive ones further down are not throttled by the brute-force guard they are proving.
const IP2 = H['X-Forwarded-For'].replace(/\d+$/, (n) => String((Number(n) + 1) % 256))
const post = (p, b, bad = false) => fetch(B + p, { method: 'POST', headers: bad ? { ...H, 'X-Forwarded-For': IP2 } : H, body: JSON.stringify(b) })
const jpost = async (p, b, bad = false) => { const r = await post(p, b, bad); return { status: r.status, body: await r.json().catch(() => null) } }

const admin = await adminToken()
const a = await reg('alice')

console.log('-- enrol (API)')
ok('fresh account has 2FA off', (await call(a.token, 'GET', '/users/@me')).mfa_enabled === false)
let r = await callS(a.token, 'POST', '/users/@me/mfa/confirm', { code: '000000' }); ok('confirm before enrol refused', r.status === 400)
r = await callS(a.token, 'POST', '/users/@me/mfa/enroll', { password: 'wrong-pass' }); ok('enrol needs the password', r.status === 400 && /password/i.test(r.body?.error))
r = await callS(a.token, 'POST', '/users/@me/mfa/enroll', { password: PASSWORD }); ok('enrol returns a base32 secret and otpauth URL', r.status === 200 && /^[A-Z2-7]{32}$/.test(r.body?.secret) && r.body?.otpauth_url?.startsWith('otpauth://totp/Parley:'))
const secret = r.body.secret
ok('otpauth URL carries the secret and account', r.body.otpauth_url.includes(`secret=${secret}`) && r.body.otpauth_url.includes(`alice${S}`))
ok('pending enrolment does not enable 2FA yet', (await call(a.token, 'GET', '/users/@me')).mfa_enabled === false)
r = await callS(a.token, 'POST', '/users/@me/mfa/confirm', { code: '123456' }); ok('wrong first code refused', r.status === 400)
const s0 = step()
r = await callS(a.token, 'POST', '/users/@me/mfa/confirm', { code: totp(secret, s0) }); ok('right code activates 2FA and returns 10 backup codes', r.status === 200 && r.body?.backup_codes?.length === 10 && r.body.user?.mfa_enabled === true)
const backup = r.body.backup_codes
ok('backup codes look like xxxxx-xxxxx', backup.every((c) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c)))
r = await callS(a.token, 'POST', '/users/@me/mfa/enroll', { password: PASSWORD }); ok('cannot enrol twice', r.status === 400)
ok('/users/@me now reports mfa_enabled', (await call(a.token, 'GET', '/users/@me')).mfa_enabled === true)

console.log('-- login (API)')
r = await loginRaw(`alice${S}`); const l1 = await r.json(); ok('password login returns an MFA ticket instead of a token', r.status === 200 && l1.mfa === true && typeof l1.ticket === 'string' && !l1.token)
r = await callS(l1.ticket, 'GET', '/users/@me'); ok('the ticket is not a session token', r.status === 401)
r = await jpost('/auth/mfa', { ticket: l1.ticket, code: '000000' }, true); ok('wrong code refused', r.status === 400 && r.body.error === 'Invalid code')
r = await jpost('/auth/mfa', { ticket: 'bogus', code: totp(secret) }); ok('bad ticket refused', r.status === 400)
r = await jpost('/auth/mfa', { ticket: l1.ticket, code: totp(secret, s0) }, true); ok('the code used to enrol cannot be replayed', r.status === 400)
r = await jpost('/auth/mfa', { ticket: l1.ticket, code: totp(secret, s0 + 1) }); ok('a fresh code (one step of drift allowed) logs in', r.status === 200 && typeof r.body.token === 'string' && r.body.user?.mfa_enabled === true)
const tok2 = r.body.token
ok('the issued token works', (await callS(tok2, 'GET', '/users/@me')).status === 200)
r = await jpost('/auth/mfa', { ticket: l1.ticket, code: totp(secret, s0 + 1) }, true); ok('same code refused the second time', r.status === 400)
r = await jpost('/auth/mfa', { ticket: l1.ticket, code: backup[0].toUpperCase() }); ok('a backup code logs in (any case)', r.status === 200 && !!r.body.token)
r = await jpost('/auth/mfa', { ticket: l1.ticket, code: backup[0] }, true); ok('a backup code is single-use', r.status === 400)
r = await callS(a.token, 'POST', '/users/@me/mfa/backup-codes', { password: 'nope-nope' }); ok('regenerating backup codes needs the password', r.status === 400)
r = await callS(a.token, 'POST', '/users/@me/mfa/backup-codes', { password: PASSWORD }); ok('regenerate returns 10 new codes', r.status === 200 && r.body.backup_codes?.length === 10 && !r.body.backup_codes.includes(backup[1]))
const backup2 = r.body.backup_codes
r = await jpost('/auth/mfa', { ticket: l1.ticket, code: backup[1] }, true); ok('old backup codes stop working', r.status === 400)
r = await jpost('/auth/mfa', { ticket: l1.ticket, code: backup2[0] }); ok('new backup code works', r.status === 200)

console.log('-- disable (API)')
r = await callS(a.token, 'POST', '/users/@me/mfa/disable', { password: 'wrong-pass', code: backup2[1] }); ok('disable needs the password', r.status === 400 && /password/i.test(r.body.error))
r = await callS(a.token, 'POST', '/users/@me/mfa/disable', { password: PASSWORD, code: '000000' }); ok('disable needs a valid code', r.status === 400 && r.body.error === 'Invalid code')
r = await callS(a.token, 'POST', '/users/@me/mfa/disable', { password: PASSWORD, code: backup2[1] }); ok('disable with a backup code', r.status === 200 && r.body.mfa_enabled === false)
r = await loginRaw(`alice${S}`); const l2 = await r.json(); ok('password login issues a token again', r.status === 200 && !!l2.token && !l2.mfa)
r = await jpost('/auth/mfa', { ticket: l1.ticket, code: backup2[2] }); ok('old ticket is useless once 2FA is off', r.status === 400)

console.log('-- admin clear')
r = await callS(a.token, 'POST', '/users/@me/mfa/enroll', { password: PASSWORD }); const sec2 = r.body.secret
r = await callS(a.token, 'POST', '/users/@me/mfa/confirm', { code: totp(sec2) }); ok('re-enrol with a new secret', r.status === 200)
let list = await call(admin.token, 'GET', `/admin/users?q=alice${S}`); ok('admin user list shows mfa_enabled', list.find((u) => u.id === a.user.id)?.mfa_enabled === true)
r = await callS(admin.token, 'PATCH', `/admin/users/${a.user.id}`, { mfa: true }); ok('admin cannot enable 2FA for someone', r.status === 400)
r = await callS(admin.token, 'PATCH', `/admin/users/${a.user.id}`, { mfa: false }); ok('admin clears 2FA', r.status === 200 && r.body.mfa_enabled === false)
r = await loginRaw(`alice${S}`); ok('user logs in with just the password after the admin cleared 2FA', r.status === 200 && !!(await r.json()).token)

console.log('-- UI')
const browser = await chromium.launch(); const errors = []
const mk = async (tok) => { const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); if (tok) await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); return p }
const p = await mk(a.token)
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('[data-control="User Settings"]'); await p.click('[data-control="User Settings"]'); await p.waitForSelector('[data-mfa-section]')
ok('My Account shows the 2FA card, off', await p.getAttribute('[data-mfa-section]', 'data-mfa-enabled') === '0' && await p.locator('[data-mfa-enable]').count() === 1)
await p.click('[data-mfa-enable]'); await p.fill('[data-mfa-password]', 'wrongpassword'); await p.click('[data-mfa-password-submit]'); await p.waitForSelector('[data-mfa-error]')
ok('wrong password is reported inline', /password/i.test(await p.textContent('[data-mfa-error]')))
await p.fill('[data-mfa-password]', PASSWORD); await p.click('[data-mfa-password-submit]'); await p.waitForSelector('[data-mfa-scan]')
const uiSecret = (await p.textContent('[data-mfa-secret]')).trim()
ok('scan step shows a QR image and the manual key', /^[A-Z2-7]{32}$/.test(uiSecret) && (await p.getAttribute('[data-mfa-qr]', 'src'))?.startsWith('data:image/png'))
await p.screenshot({ path: '91-mfa-enrol.png' })
await p.fill('[data-mfa-confirm-code]', '999999'); await p.click('[data-mfa-confirm]'); await p.waitForSelector('[data-mfa-error]')
ok('a wrong code keeps you on the scan step', await p.locator('[data-mfa-scan]').count() === 1)
const s1 = step()
await p.fill('[data-mfa-confirm-code]', totp(uiSecret, s1)); await p.click('[data-mfa-confirm]'); await p.waitForSelector('[data-mfa-codes]')
const uiCodes = await p.locator('[data-mfa-backup-code]').allTextContents()
ok('activation shows 10 backup codes once', uiCodes.length === 10 && await p.getAttribute('[data-mfa-section]', 'data-mfa-enabled') === '1')
await p.screenshot({ path: '92-mfa-codes.png' })
await p.click('[data-mfa-codes-done]'); await p.waitForSelector('[data-mfa-disable]')
ok('enabled card offers View Backup Codes and Remove 2FA', await p.locator('[data-mfa-regen]').count() === 1 && await p.locator('[data-mfa-enable]').count() === 0)
await p.close()

const pl = await mk()
await pl.goto(`${WEB}/login`); await pl.waitForSelector('input[autocomplete="username"]')
await pl.fill('input[autocomplete="username"]', `alice${S}`); await pl.fill('input[type="password"]', PASSWORD); await pl.click('button[type="submit"], form button.btn-primary'); await pl.waitForSelector('[data-mfa-form]')
ok('login page asks for the second factor', await pl.locator('[data-mfa-code]').count() === 1)
await pl.screenshot({ path: '93-mfa-login.png' })
await pl.fill('[data-mfa-code]', '000000'); await pl.click('[data-mfa-form] button.btn-primary'); await pl.waitForSelector('[data-mfa-error]')
ok('wrong code shows an error and stays on the step', /invalid/i.test(await pl.textContent('[data-mfa-error]')))
await pl.fill('[data-mfa-code]', uiCodes[0]); await pl.click('[data-mfa-form] button.btn-primary'); await pl.waitForSelector('[data-control="User Settings"]')
ok('a backup code completes the login', (await pl.evaluate(() => localStorage.getItem('parley.token')))?.length > 20)
await pl.click('[data-control="User Settings"]'); await pl.waitForSelector('[data-mfa-section]')
await pl.click('[data-mfa-disable]'); await pl.fill('[data-mfa-disable-form] [data-mfa-password]', PASSWORD); await pl.fill('[data-mfa-disable-code]', totp(uiSecret, s1 + 1)); await pl.click('[data-mfa-disable-submit]'); await pl.waitForSelector('[data-mfa-enable]')
ok('Remove 2FA turns it off from the UI', await pl.getAttribute('[data-mfa-section]', 'data-mfa-enabled') === '0')
ok('backend agrees 2FA is off', (await call(a.token, 'GET', '/users/@me')).mfa_enabled === false)
await pl.close()

// admin console: badge and clear button
r = await callS(a.token, 'POST', '/users/@me/mfa/enroll', { password: PASSWORD }); await callS(a.token, 'POST', '/users/@me/mfa/confirm', { code: totp(r.body.secret) })
const pa = await mk(admin.token)
await pa.goto(`${WEB}/admin/users`); await pa.waitForSelector('[data-admin-user-search]'); await pa.fill('[data-admin-user-search]', `alice${S}`); await pa.waitForSelector(`[data-admin-user="alice${S}"]`)
const row = pa.locator(`[data-admin-user="alice${S}"]`)
ok('admin list badges 2FA accounts', await row.locator('[data-badge="mfa"]').count() === 1 && await row.locator('[data-admin-action="clear-mfa"]').count() === 1)
await row.locator('[data-admin-action="clear-mfa"]').click(); await pa.waitForFunction((u) => !document.querySelector(`[data-admin-user="${u}"] [data-badge="mfa"]`), `alice${S}`)
ok('Clear two-factor auth removes it', (await call(a.token, 'GET', '/users/@me')).mfa_enabled === false)
await pa.close()
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
