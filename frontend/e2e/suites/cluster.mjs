import { execSync } from 'node:child_process'
import { API_ORIGIN, S, reg, call, callS, ok, finish, adminToken } from '../lib.mjs'

// Two backend instances sharing Postgres: events and presence must cross between them.
const A = API_ORIGIN, Bb = process.env.PARLEY_API_ORIGIN2 ?? 'http://localhost:18081'
const compose = (args) => execSync(`docker compose -f /git/vic10us/y99-bot/docker-compose.yml ${args}`, { stdio: 'pipe' }).toString()
let startedHere = false
const up = async () => { try { if ((await fetch(`${Bb}/health`)).ok) return } catch { /* not up */ } compose('--profile cluster up -d backend2'); startedHere = true; for (let i = 0; i < 60; i++) { try { if ((await fetch(`${Bb}/health`)).ok) return } catch { /* wait */ } await new Promise((r) => setTimeout(r, 1000)) } throw new Error('backend2 did not come up') }
await up()
const admin = await adminToken()
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Cluster ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
const api2 = async (t, m, p, body) => { const r = await fetch(`${Bb}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: body ? JSON.stringify(body) : undefined }); return r.json().catch(() => null) }
const sock = (origin, token, extra = '') => new Promise((resolve) => { const ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/ws?token=${token}${extra}`); const events = []; ws.onmessage = (e) => events.push(JSON.parse(e.data)); ws.onopen = () => setTimeout(() => resolve({ ws, events }), 400); ws.onerror = () => resolve({ ws, events }) })
const waitFor = (events, pred, ms = 5000) => new Promise((resolve) => { const t0 = Date.now(); const i = setInterval(() => { if (events.some(pred)) { clearInterval(i); resolve(true) } else if (Date.now() - t0 > ms) { clearInterval(i); resolve(false) } }, 50) })

console.log('-- two instances')
const h1 = await (await fetch(`${A}/metrics`)).text(); const h2 = await (await fetch(`${Bb}/metrics`)).text()
ok('both instances answer', h1.includes('parley_http_requests_total') && h2.includes('parley_http_requests_total'))
const sa = await sock(A, a.token); const sb = await sock(Bb, b.token)
const readyA = sa.events.find((e) => e.t === 'READY'), readyB = sb.events.find((e) => e.t === 'READY')
ok('each READY names its instance, and they differ', typeof readyA?.i === 'string' && typeof readyB?.i === 'string' && readyA.i !== readyB.i)
ok('alice (instance 1) is listed online in bob\'s READY on instance 2', readyB.d.online.includes(a.user.id))
ok('bob connecting on instance 2 reaches alice on instance 1 as PRESENCE_UPDATE', await waitFor(sa.events, (e) => e.t === 'PRESENCE_UPDATE' && e.d.user_id === b.user.id && e.d.online === true))
const m = await api2(b.token, 'POST', `/channels/${tc.id}/messages`, { content: `hello from instance two ${S}` })
ok('a message posted through instance 2 arrives on alice\'s socket on instance 1', await waitFor(sa.events, (e) => e.t === 'MESSAGE_CREATE' && e.d.message.id === m.id))
const m2 = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `and back ${S}` })
ok('…and the other way round', await waitFor(sb.events, (e) => e.t === 'MESSAGE_CREATE' && e.d.message.id === m2.id))
await call(a.token, 'PUT', `/channels/${tc.id}/messages/${m.id}/reactions/%F0%9F%91%8D`)
ok('reactions cross too', await waitFor(sb.events, (e) => e.t === 'REACTION_ADD' && e.d.message_id === m.id))
const big = await api2(b.token, 'POST', `/channels/${tc.id}/messages`, { content: '🦀'.repeat(1990) }) // ~8 KB of JSON: over the NOTIFY inline cap
ok('oversized events go through the outbox and still arrive', await waitFor(sa.events, (e) => e.t === 'MESSAGE_CREATE' && e.d.message.id === big.id))
ok('admin stats count online users across instances', (await call(admin.token, 'GET', '/admin/stats')).online >= 2 && (await api2(admin.token, 'GET', '/admin/stats')).online >= 2)
ok('metrics report cross-instance online users', /parley_online_users [2-9]\d*/.test(await (await fetch(`${Bb}/metrics`)).text()))
// a second socket for bob on instance 1: no extra PRESENCE event, and closing one keeps him online
const sb1 = await sock(A, b.token)
await new Promise((r) => setTimeout(r, 400))
const presenceBefore = sa.events.filter((e) => e.t === 'PRESENCE_UPDATE' && e.d.user_id === b.user.id).length
sb1.ws.close(); await new Promise((r) => setTimeout(r, 600))
ok('closing one of two sockets (other instance still open) emits no offline', sa.events.filter((e) => e.t === 'PRESENCE_UPDATE' && e.d.user_id === b.user.id).length === presenceBefore)
sb.ws.close()
ok('closing the last socket (on instance 2) tells instance 1 he went offline', await waitFor(sa.events, (e) => e.t === 'PRESENCE_UPDATE' && e.d.user_id === b.user.id && e.d.online === false))
// resume: a seq from instance 1 presented to instance 2 must yield READY, not a bogus replay
const lastSeq = Math.max(...sa.events.map((e) => e.s ?? 0))
const cross = await sock(Bb, a.token, `&seq=${lastSeq}&instance=${readyA.i}`)
ok('resuming against another instance falls back to READY', cross.events[0]?.t === 'READY')
cross.ws.close()
const same = await sock(A, a.token, `&seq=${lastSeq}&instance=${readyA.i}`)
ok('resuming against the same instance replays', same.events[0]?.t === 'RESUMED')
same.ws.close(); sa.ws.close()
await new Promise((r) => setTimeout(r, 300))
if (startedHere) { try { compose('stop backend2') } catch { /* ignore */ } }
await finish()
