import { B, S, reg, raw, ok, finish } from '../lib.mjs'

// Failed logins are limited per client IP. nginx is not in front of the API here, so the backend
// trusts X-Forwarded-For; use a private address unique to this run so other suites are not throttled.
const ip = `10.77.${Math.floor(S / 256) % 256}.${S % 256}`
const loginRaw = (login, password = 'wrong-password') => fetch(`${B}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ login, password }) })

// Limits as the backend sees them (compose defaults); override via env when running against other values.
const [msgCount, msgSecs] = (process.env.RL_MESSAGES ?? '60/5').split('/').map(Number)
const failCount = Number((process.env.RL_LOGIN_FAIL ?? '5/60').split('/')[0])

const a = await reg('alice'), b = await reg('bob')
const g = await (await raw(a.token, 'POST', '/guilds', { name: `RL ${S}` })).json()
const tc = g.channels.find((c) => c.kind === 'text').id

console.log('-- messages (per user)')
// Fire the burst concurrently so the bucket cannot refill in between.
const burst = await Promise.all(Array.from({ length: msgCount + 20 }, (_, i) => raw(a.token, 'POST', `/channels/${tc}/messages`, { content: `burst ${i + 1}` })))
const okCount = burst.filter((r) => r.status === 201).length, limited = burst.filter((r) => r.status === 429)
ok(`a burst of ${msgCount + 20} messages lets about ${msgCount} through and throttles the rest`, okCount >= msgCount && okCount <= msgCount + 5 && limited.length >= 15, JSON.stringify({ okCount, limited: limited.length }))
const retryAfter = limited[0]?.headers.get('retry-after'), body = await limited[0]?.json()
ok('429 carries Retry-After and a JSON error', retryAfter !== null && Number(retryAfter) >= 1 && /Too many requests/.test(body?.error ?? ''), JSON.stringify({ retryAfter, body }))
const rb = await raw(b.token, 'POST', `/channels/${tc}/messages`, { content: 'bob is fine' }).catch(() => null)
ok('limits are per user: another user still posts (or is a non-member 404), never 429', rb && rb.status !== 429, String(rb?.status))
await new Promise((r) => setTimeout(r, (msgSecs / msgCount) * 1000 * 2 + 300))
const again = await raw(a.token, 'POST', `/channels/${tc}/messages`, { content: 'after refill' })
ok('the bucket refills: a message goes through after a short wait', again.status === 201, String(again.status))

console.log('-- failed logins (per IP)')
let blockedAt = null
for (let i = 1; i <= failCount + 2; i++) {
  const r = await loginRaw(`nobody${S}`)
  if (r.status === 429) { blockedAt = i; break }
}
ok(`wrong logins are throttled with 429 within ${failCount + 1} attempts (earlier failures from this IP count too)`, blockedAt !== null && blockedAt <= failCount + 1, String(blockedAt))
const good = await loginRaw(`alice${S}`, 'password1')
ok('even a correct login is held back while the failure bucket is exhausted', good.status === 429, String(good.status))

await finish()
