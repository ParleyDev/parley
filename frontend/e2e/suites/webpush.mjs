// Installable web app and browser push: VAPID key, subscriptions tied to a session, encrypted payloads (decrypted
// here with the browser's keys), signed VAPID JWTs, Mark as Read / Reply from the notification, dead endpoints
// dropped, sign-out stops pushes; the service worker serves an offline shell and shows pushed notifications.
import { createServer } from 'node:http'
import { createECDH, createHmac, createPublicKey, createVerify, randomBytes, createDecipheriv } from 'node:crypto'
import { execSync } from 'node:child_process'
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, openDms, finish, login } from '../lib.mjs'

const DB = process.env.PARLEY_TEST_DB ?? 'parley-inv-db'
const sql = (q) => execSync(`docker exec ${DB} psql -U parley -tAc "${q}"`).toString().trim()
// Where the test backend (in Docker) reaches this process; the backend allow-lists it with PUSH_ALLOW_HOSTS.
const HOST = process.env.PUSH_TEST_HOST ?? '172.30.0.1'
const PORT = 19100 + (S % 800)
const got = []; const status = {}
const srv = createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { got.push({ url: req.url, headers: req.headers, body: Buffer.concat(parts) }); res.statusCode = status[req.url] ?? 201; res.end() }) })
await new Promise((r) => srv.listen(PORT, '0.0.0.0', r))
const wait = async (n, ms = 8000) => { const t = Date.now(); while (got.length < n && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 100)); return got.length >= n }

const b64u = (b) => Buffer.from(b).toString('base64url')
const hkdf = (salt, ikm, info, len) => { const prk = createHmac('sha256', salt).update(ikm).digest(); return createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len) }
const browserKeys = () => { const e = createECDH('prime256v1'); e.generateKeys(); return { e, auth: randomBytes(16) } }
function decrypt({ e, auth }, body) {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen)
  const secret = e.computeSecret(asPub)
  const ikm = hkdf(auth, secret, Buffer.concat([Buffer.from('WebPush: info\0'), e.getPublicKey(), asPub]), 32)
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)
  const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16))
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString())
}
function vapidOk(header, aud) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header ?? ''); if (!m) return false
  const [h, p, sig] = m[1].split('.'); const claims = JSON.parse(Buffer.from(p, 'base64url'))
  const pub = Buffer.from(m[2], 'base64url')
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' })
  const v = createVerify('SHA256'); v.update(`${h}.${p}`)
  return claims.aud === aud && claims.exp > Date.now() / 1000 && v.verify({ key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))
}

const alice = await reg('alice'), bob = await reg('bob')
await openDms(alice, bob)
const dm = await call(alice.token, 'POST', '/users/@me/channels', { recipient_id: bob.user.id })

console.log('-- subscribing')
const { public_key } = await call(bob.token, 'GET', '/push/web/key')
ok('the server has a VAPID key', Buffer.from(public_key, 'base64url').length === 65)
const k1 = browserKeys()
const ep = `http://${HOST}:${PORT}/push/${S}-a`
const sub = (endpoint, k) => ({ endpoint, keys: { p256dh: b64u(k.e.getPublicKey()), auth: b64u(k.auth) } })
ok('a browser subscribes', (await raw(bob.token, 'PUT', '/users/@me/web-push', sub(ep, k1))).status === 204)
ok('plain-http push services are refused', (await raw(bob.token, 'PUT', '/users/@me/web-push', sub('http://example.com/push', k1))).status === 400)
ok('private addresses are refused', (await raw(bob.token, 'PUT', '/users/@me/web-push', sub('https://127.0.0.1/push', k1))).status === 400)
ok('bad keys are refused', (await raw(bob.token, 'PUT', '/users/@me/web-push', { endpoint: ep, keys: { p256dh: 'abc', auth: 'def' } })).status === 400)

console.log('-- a DM while away')
const m1 = await call(alice.token, 'POST', `/channels/${dm.id}/messages`, { content: `ping ${S}` })
ok('the push service gets a request', await wait(1))
const r = got[0]
ok('aes128gcm with a topic and TTL', r.headers['content-encoding'] === 'aes128gcm' && r.headers.ttl && r.headers.topic === dm.id.replace(/-/g, ''))
ok('the VAPID JWT is signed for that push service', vapidOk(r.headers.authorization, `http://${HOST}:${PORT}`))
let p = null; try { p = decrypt(k1, r.body) } catch (e) { console.log(e) }
ok('the payload decrypts with the browser keys', !!p)
ok('it names the sender and carries the message', p?.title?.includes(alice.user.display_name ?? alice.user.username) && p?.body === `ping ${S}` && p?.data?.channel_id === dm.id && p?.data?.message_id === m1.id)
ok('grouped per channel', p?.tag === dm.id)

console.log('-- actions')
ok('a forged token is refused', (await fetch(`${process.env.PARLEY_API_ORIGIN}/api/push/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: p.action_token.slice(0, -3) + 'AAA', action: 'read' }) })).status === 401)
const act = (body) => fetch(`${process.env.PARLEY_API_ORIGIN}/api/push/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.7.${S % 250}.1` }, body: JSON.stringify({ token: p.action_token, ...body }) })
ok('Mark as Read works without a session token', (await act({ action: 'read' })).status === 204)
ok('the channel is read', sql(`SELECT last_read_msg FROM read_states WHERE user_id = '${bob.user.id}' AND channel_id = '${dm.id}'`) === m1.id)
ok('Reply sends a reply', (await act({ action: 'reply', content: `pong ${S}`, message_id: m1.id })).status === 204)
const msgs = await call(alice.token, 'GET', `/channels/${dm.id}/messages`)
ok('as Bob, replying to the message', msgs.some((m) => m.content === `pong ${S}` && m.author.id === bob.user.id && (m.reply_to === m1.id || m.referenced_message?.id === m1.id)))

console.log('-- read on another device')
// Bob's browser (session 1) got the DM; he reads it on his other device (session 2).
const m2 = await call(alice.token, 'POST', `/channels/${dm.id}/messages`, { content: `again ${S}` })
const atNotify = got.length
await wait(atNotify + 1)
const other = await login(bob.user.username)
const beforeRead = got.length
await call(other.token, 'PUT', `/channels/${dm.id}/read`, { message_id: m2.id })
ok('the browser that was notified gets a push', await wait(beforeRead + 1))
let cl = null; try { cl = decrypt(k1, got.at(-1).body) } catch { /* not ours */ }
ok('that only says to clear the channel', cl?.clear === dm.id && !cl.title && !cl.body, JSON.stringify(cl))
ok('under the same topic, so a waiting notification is replaced', got.at(-1).headers.topic === dm.id.replace(/-/g, ''))
const settled = got.length
await call(other.token, 'PUT', `/channels/${dm.id}/read`, { message_id: m2.id })
await new Promise((r) => setTimeout(r, 1500))
ok('reading again sends nothing more (nothing left to clear)', got.length === settled)

console.log('-- dead endpoints and sign-out')
const k2 = browserKeys(); const ep2 = `http://${HOST}:${PORT}/push/${S}-gone`; status[`/push/${S}-gone`] = 410
await raw(bob.token, 'PUT', '/users/@me/web-push', sub(ep2, k2))
const before = got.length
await call(alice.token, 'POST', `/channels/${dm.id}/messages`, { content: 'two' })
await wait(before + 2)
await new Promise((r) => setTimeout(r, 500))
ok('a 410 drops the subscription', sql(`SELECT count(*) FROM web_push_subs WHERE endpoint = '${ep2}'`) === '0')
await call(bob.token, 'POST', '/auth/logout')
ok('after sign-out the action token stops working', (await act({ action: 'read' })).status === 401)
const n = got.length
await call(alice.token, 'POST', `/channels/${dm.id}/messages`, { content: 'three' })
await new Promise((r) => setTimeout(r, 2500))
ok('and that browser gets no more pushes', got.length === n)

console.log('-- service worker')
// Full Chromium (not the headless shell) so notification permission can be granted.
const browser = await chromium.launch({ channel: 'chromium' }); const errors = []
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await context.grantPermissions(['notifications'], { origin: WEB })
const page = await context.newPage(); page.on('pageerror', (x) => errors.push(x.message))
const fresh = await reg('carol')
await page.goto(`${WEB}/login`); await page.evaluate((x) => localStorage.setItem('parley.token', x), fresh.token)
await page.goto(`${WEB}/channels/@me`); await page.waitForSelector('[data-guild-bar], nav', { timeout: 15000 })
await page.waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(() => true), null, { timeout: 10000 })
const regd = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/')))
ok('the service worker registers', regd)
await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 })
await context.setOffline(true)
await page.reload().catch(() => {})
ok('offline, the app shell still loads', await page.locator('#root').evaluate((el) => el.childElementCount > 0).catch(() => false))
await context.setOffline(false)
// Deliver a push straight to the worker (DevTools protocol). Headless Chrome drops notifications, so record what
// the worker asks to show instead.
const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
await sw.evaluate(() => {
  self.__shown = []; self.__closed = []
  self.registration.showNotification = async (title, o) => { self.__shown.push({ title, body: o.body, tag: o.tag, actions: o.actions.map((a) => a.action), data: o.data }) }
  self.registration.getNotifications = async () => self.__shown.map((n) => ({ ...n, close: () => self.__closed.push(n.tag) }))
})
const cdp = await context.newCDPSession(page)
const regId = new Promise((resolve) => { cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => { const x = e.registrations.find((r) => r.scopeURL.startsWith(WEB)); if (x) resolve(x.registrationId) }) })
await cdp.send('ServiceWorker.enable')
await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(WEB).origin, registrationId: await regId, data: JSON.stringify({ title: 'Dana (#general · Club)', body: 'hello there', tag: 'chan-1', action_token: 'x', data: { channel_id: 'chan-1', guild_id: 'g1', message_id: 'm1' } }) })
const shownAt = Date.now(); let shown = []
while (!shown.length && Date.now() - shownAt < 5000) { shown = await sw.evaluate(() => self.__shown); await new Promise((r) => setTimeout(r, 100)) }
ok('a pushed message becomes a notification', shown[0]?.title === 'Dana (#general · Club)' && shown[0]?.body === 'hello there' && shown[0]?.tag === 'chan-1')
ok('with Reply and Mark as Read', JSON.stringify(shown[0]?.actions) === '["reply","read"]')
await page.evaluate(() => navigator.serviceWorker.controller.postMessage({ type: 'parley-read', channel_id: 'chan-1' }))
await new Promise((r) => setTimeout(r, 500))
ok('reading the channel clears it', JSON.stringify(await sw.evaluate(() => self.__closed)) === '["chan-1"]')
await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(WEB).origin, registrationId: await regId, data: JSON.stringify({ title: 'Dana', body: 'more', tag: 'chan-2', data: { channel_id: 'chan-2' } }) })
await new Promise((r) => setTimeout(r, 500))
await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(WEB).origin, registrationId: await regId, data: JSON.stringify({ clear: 'chan-2' }) })
await new Promise((r) => setTimeout(r, 500))
const after = await sw.evaluate(() => ({ shown: self.__shown.length, closed: self.__closed }))
ok('a clear push from another device closes that channel and shows nothing', after.shown === 2 && after.closed.includes('chan-2'), JSON.stringify(after))
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); srv.close()
await finish()
