// k6 load test: message send + list through the REST API.
//   docker run --rm -i --network host -e BASE=http://localhost:8080 -e VUS=20 -e DURATION=60s grafana/k6 run - < ops/load/messages.js
// Each VU registers its own user, joins one shared server (created by VU 1 via setup) and alternates POST / GET.
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend } from 'k6/metrics'

const BASE = __ENV.BASE || 'http://localhost:8080'
const API = `${BASE}/api`
export const options = { vus: Number(__ENV.VUS || 10), duration: __ENV.DURATION || '30s', thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{name:send}': ['p(95)<300'], 'http_req_duration{name:list}': ['p(95)<300'] } }
const sendT = new Trend('send_ms'), listT = new Trend('list_ms')
const H = (t) => ({ headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` } })
const S = Math.floor(Math.random() * 1e6)
const register = (name) => http.post(`${API}/auth/register`, JSON.stringify({ username: `${name}${S}`, email: `${name}${S}@load.test`, password: 'password1', display_name: name }), { headers: { 'Content-Type': 'application/json' } }).json()

export function setup() {
  const owner = register('loadowner')
  const g = http.post(`${API}/guilds`, JSON.stringify({ name: `Load ${S}` }), H(owner.token)).json()
  const inv = http.post(`${API}/guilds/${g.id}/invites`, '{}', H(owner.token)).json()
  const tc = g.channels.find((c) => c.kind === 'text')
  return { code: inv.code, channel: tc.id }
}

export default function (data) {
  if (!__ITER) {
    const u = register(`vu${__VU}`)
    http.post(`${API}/invites/${data.code}`, '{}', H(u.token))
    globalThis.token = u.token
  }
  const h = H(globalThis.token)
  const s = http.post(`${API}/channels/${data.channel}/messages`, JSON.stringify({ content: `load ${__VU}/${__ITER}` }), { ...h, tags: { name: 'send' } })
  sendT.add(s.timings.duration); check(s, { 'sent 201': (r) => r.status === 201 })
  const l = http.get(`${API}/channels/${data.channel}/messages?limit=50`, { ...h, tags: { name: 'list' } })
  listT.add(l.timings.duration); check(l, { 'list 200': (r) => r.status === 200 })
  sleep(0.5)   // ~2 req/s per VU; the default message rate limit is 10 per 5 s per user
}
