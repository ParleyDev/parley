// Passkeys: add one in My Account (password, plus the 2FA code when 2FA is on), sign in with it from the login page
// with and without a username, rename and remove it. Chrome's virtual authenticator (DevTools protocol) stands in for
// a platform passkey with user verification. A passkey replaces both the password and the second factor.
import { chromium } from 'playwright'
import { createHmac } from 'node:crypto'
import { WEB, S, PASSWORD, reg, call, callS, raw, ok, finish, adminToken } from '../lib.mjs'
const b32 = (s) => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out) }
const totp = (secret, step = Math.floor(Date.now() / 30000)) => { const msg = Buffer.alloc(8); msg.writeBigInt64BE(BigInt(step)); const h = createHmac('sha1', b32(secret)).update(msg).digest(); const o = h[19] & 15; const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]; return String(n % 1e6).padStart(6, '0') }
const admin = await adminToken()
const a = await reg('pk')

console.log('-- API guards')
let r = await callS(a.token, 'POST', '/users/@me/passkeys/begin', { password: 'wrong-password' }); ok('adding a passkey needs the right password', r.status === 400)
r = await callS(a.token, 'POST', '/auth/passkey/begin', { login: `nobody${S}` })
ok('an unknown username gets an ordinary usernameless challenge (no account enumeration)', r.status === 200 && !(r.body.options.publicKey.allowCredentials?.length))
r = await callS(a.token, 'POST', '/auth/passkey/finish', { id: '00000000-0000-7000-8000-000000000000', credential: { id: 'x', rawId: 'eA', type: 'public-key', extensions: {}, response: { authenticatorData: 'eA', clientDataJSON: 'eA', signature: 'eA' } } })
ok('an unknown or expired challenge is refused', r.status === 400)

const browser = await chromium.launch(); const errors = []
/** A page with its own virtual authenticator; `autofill: false` hides conditional UI so only the button signs in. */
const mkPage = async ({ autofill = true, copyFrom } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  if (!autofill) await ctx.addInitScript(() => { if (window.PublicKeyCredential) window.PublicKeyCredential.isConditionalMediationAvailable = async () => false })
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message))
  const cdp = await ctx.newCDPSession(page); await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
  for (const credential of copyFrom ?? []) await cdp.send('WebAuthn.addCredential', { authenticatorId, credential })
  return { page, cdp, authenticatorId }
}
const { page: p, cdp, authenticatorId } = await mkPage()

console.log('-- browsers without a passkey device')
{
  const plain = await (await browser.newContext()).newPage(); plain.on('pageerror', (e) => errors.push(e.message))
  await plain.goto(`${WEB}/login`); await plain.waitForSelector('[data-passkey-login]'); await plain.waitForTimeout(1500)
  const shown = await plain.locator('[data-auth-error]').count()
  ok('the login page loads without a passkey error when the browser has nothing to offer', shown === 0, shown ? await plain.locator('[data-auth-error]').textContent() : '')
  await plain.context().close()
}

console.log('-- add a passkey')
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/@me`); await p.click('[data-control="User Settings"]'); await p.waitForSelector('[data-passkeys-section]')
await p.click('[data-passkey-add]'); await p.fill('[data-passkey-name-input]', 'Test laptop'); await p.fill('[data-passkey-password]', PASSWORD); await p.click('[data-passkey-create]')
await p.waitForSelector('[data-passkey]')
ok('the new passkey is listed with its name', (await p.textContent('[data-passkey-name]')) === 'Test laptop')
const mails = await call(admin.token, 'GET', `/admin/mail?to=${encodeURIComponent(a.user.email)}`)
ok('a security email says a passkey was added', mails.some((m) => /passkey was added/i.test(m.subject)))
r = await callS(a.token, 'POST', '/auth/passkey/begin', { login: a.user.username })
ok('with the username typed, the challenge lists that account\'s passkey (security keys work)', r.body.options.publicKey.allowCredentials?.length === 1)
const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId })
ok('the device stored a discoverable passkey (usernameless sign-in works)', credentials.length === 1 && credentials[0].isResidentCredential === true)

console.log('-- sign in')
// Autofill: the virtual authenticator answers the login page's conditional request by itself, as picking the
// passkey from the username field's suggestions would.
await p.evaluate(() => localStorage.removeItem('parley.token')); await p.goto(`${WEB}/login`)
await p.waitForURL('**/channels/**', { timeout: 10000 }).catch(() => {})
ok('the username field\'s autofill signs in with the passkey', p.url().includes('/channels/') && !!(await p.evaluate(() => localStorage.getItem('parley.token'))))

const { page: q } = await mkPage({ autofill: false, copyFrom: (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials })
const signOut = async () => { await q.evaluate(() => localStorage.removeItem('parley.token')); await q.goto(`${WEB}/login`); await q.waitForSelector('[data-passkey-login]') }
await q.goto(`${WEB}/login`); await q.waitForSelector('[data-passkey-login]')
ok('the login page offers passkey sign-in and marks the field for autofill', await q.getAttribute('[data-login-input]', 'autocomplete') === 'username webauthn')
await q.click('[data-passkey-login]'); await q.waitForURL('**/channels/**', { timeout: 10000 }).catch(() => {})
ok('the button signs in without typing anything', q.url().includes('/channels/') && !!(await q.evaluate(() => localStorage.getItem('parley.token'))))
await signOut()
await q.fill('[data-login-input]', a.user.username); await q.click('[data-passkey-login]'); await q.waitForURL('**/channels/**', { timeout: 10000 }).catch(() => {})
ok('and with the username typed first', q.url().includes('/channels/'))
const list = await call(a.token, 'GET', '/users/@me/passkeys')
ok('sign-in records when the passkey was last used', !!list.passkeys[0]?.last_used_at)

console.log('-- with two-factor on')
const en = await call(a.token, 'POST', '/users/@me/mfa/enroll', { password: PASSWORD }); await call(a.token, 'POST', '/users/@me/mfa/confirm', { code: totp(en.secret) })
r = await callS(a.token, 'POST', '/users/@me/passkeys/begin', { password: PASSWORD }); ok('with 2FA on, adding a passkey also needs a code', r.status === 400)
await signOut()
await q.click('[data-passkey-login]'); await q.waitForURL('**/channels/**', { timeout: 10000 }).catch(() => {})
ok('a passkey stands in for the second factor too (no code asked)', q.url().includes('/channels/') && await q.locator('[data-mfa-form]').count() === 0)

console.log('-- rename and remove')
await q.click('[data-control="User Settings"]'); await q.waitForSelector('[data-passkey]')
await q.click('[data-passkey-rename]'); await q.fill('[data-passkey-rename-input]', 'Work laptop'); await q.keyboard.press('Enter'); await q.waitForTimeout(400)
ok('renaming updates the list', (await q.textContent('[data-passkey-name]')) === 'Work laptop')
await q.click('[data-passkey-remove]'); await q.click('[data-passkey-remove-confirm]'); await q.waitForFunction(() => !document.querySelector('[data-passkey]'))
ok('removing it empties the list', (await call(a.token, 'GET', '/users/@me/passkeys')).passkeys.length === 0)
await signOut()
await q.click('[data-passkey-login]'); await q.waitForTimeout(1500)
ok('a removed passkey no longer signs in', !q.url().includes('/channels/') && /isn't registered|could not be verified/.test(await q.textContent('form') ?? ''))
r = await raw(a.token, 'DELETE', '/users/@me/passkeys/00000000-0000-7000-8000-000000000000'); ok('removing someone else\'s or a missing passkey is a 404', r.status === 404)

ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
