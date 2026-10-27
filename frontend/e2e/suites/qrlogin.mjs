// Log in with a QR code (approve on a signed-in device), and a security key as the second factor.
import { chromium } from 'playwright'
import { createHmac } from 'node:crypto'
import { WEB, PASSWORD, reg, call, raw, ok, finish } from '../lib.mjs'
const b32 = (s) => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out) }
const totp = (secret, step = Math.floor(Date.now() / 30000)) => { const msg = Buffer.alloc(8); msg.writeBigInt64BE(BigInt(step)); const h = createHmac('sha1', b32(secret)).update(msg).digest(); const o = h[19] & 15; const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]; return String(n % 1e6).padStart(6, '0') }
const a = await reg('qr'), x = await reg('other')
const browser = await chromium.launch(); const errors = []
const mk = async (token, { authenticator, copyFrom } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(() => { if (window.PublicKeyCredential) window.PublicKeyCredential.isConditionalMediationAvailable = async () => false })
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message))
  let cdp, authenticatorId
  if (authenticator) { cdp = await ctx.newCDPSession(page); await cdp.send('WebAuthn.enable'); ({ authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'usb', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })); for (const c of copyFrom ?? []) await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: c }) }
  await page.goto(`${WEB}/login`); if (token) await page.evaluate((t) => localStorage.setItem('parley.token', t), token)
  return { page, cdp, authenticatorId }
}

console.log('-- QR login')
const { page: out } = await mk(null)
await out.goto(`${WEB}/login`); await out.waitForSelector('[data-qr-code]')
const id = await out.getAttribute('[data-qr-code]', 'data-qr-code')
ok('the login page shows a QR code', /^[0-9a-f-]{36}$/.test(id))
ok('polling needs the screen\'s secret', (await raw(x.token, 'GET', `/auth/qr/${id}?secret=wrong`)).status === 404)
const { page: phone } = await mk(a.token)
await phone.goto(`${WEB}/login/qr/${id}`); await phone.waitForSelector('[data-qr-yes]')
await out.waitForSelector('[data-qr-status="scanned"]', { timeout: 5000 }).catch(() => {})
ok('scanning tells the waiting screen to check the other device', (await out.getAttribute('[data-qr-login]', 'data-qr-status')) === 'scanned')
ok('someone else can\'t approve a code you scanned', (await raw(x.token, 'POST', `/auth/qr/${id}/approve`)).status === 404)
await phone.click('[data-qr-yes]'); await phone.waitForSelector('text=Signed in')
await out.waitForURL(/\/channels\//, { timeout: 8000 }).catch(() => {})
const tok = await out.evaluate(() => localStorage.getItem('parley.token'))
ok('approving signs the waiting screen in as you', !!tok && (await call(tok, 'GET', '/users/@me')).id === a.user.id)
ok('a used code can\'t be approved again', (await raw(a.token, 'POST', `/auth/qr/${id}/approve`)).status === 404)
const { page: out2 } = await mk(null); await out2.goto(`${WEB}/login`); await out2.waitForSelector('[data-qr-code]')
const id2 = await out2.getAttribute('[data-qr-code]', 'data-qr-code')
await phone.goto(`${WEB}/login/qr/${id2}`); await phone.click('[data-qr-deny]'); await out2.waitForSelector('[data-qr-status="denied"]', { timeout: 5000 }).catch(() => {})
ok('"not me" refuses it', (await out2.getAttribute('[data-qr-login]', 'data-qr-status')) === 'denied')

console.log('-- security key as the second factor')
const { page: p, cdp, authenticatorId } = await mk(a.token, { authenticator: true })
await p.goto(`${WEB}/channels/@me`); await p.click('[data-control="User Settings"]'); await p.waitForSelector('[data-passkeys-section]')
await p.click('[data-passkey-add]'); await p.fill('[data-passkey-name-input]', 'YubiKey'); await p.fill('[data-passkey-password]', PASSWORD); await p.click('[data-passkey-create]'); await p.waitForSelector('[data-passkey]')
const en = await call(a.token, 'POST', '/users/@me/mfa/enroll', { password: PASSWORD }); await call(a.token, 'POST', '/users/@me/mfa/confirm', { code: totp(en.secret) })
const creds = (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials
const login = await (await raw(null, 'POST', '/auth/login', { login: a.user.username, password: PASSWORD })).json()
ok('the password step says a key can be used', login.mfa === true && login.security_keys === true)
const { page: q } = await mk(null, { authenticator: true, copyFrom: creds })
await q.goto(`${WEB}/login`); await q.fill('input[autocomplete="username"], input[name="login"]', a.user.username).catch(async () => { await q.locator('input').first().fill(a.user.username) })
await q.locator('input[type="password"]').fill(PASSWORD); await q.locator('form button.btn-primary').first().click()
await q.waitForSelector('[data-mfa-key]')
await q.click('[data-mfa-key]'); await q.waitForURL(/\/channels\//, { timeout: 8000 }).catch(() => {})
ok('"Use a security key" signs in without a code', q.url().includes('/channels/'), await q.locator('[data-mfa-error]').textContent().catch(() => q.url()))
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
