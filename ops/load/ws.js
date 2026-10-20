// k6 load test: websocket fan-out. N VUs hold sockets in one server while one publisher posts messages; measures how long
// a MESSAGE_CREATE takes to reach every listener.
//   docker run --rm -i --network host -e BASE=http://localhost:8080 -e VUS=100 -e DURATION=60s grafana/k6 run - < ops/load/ws.js
import http from 'k6/http'
import ws from 'k6/ws'
import { check } from 'k6'
import { Trend, Counter } from 'k6/metrics'

const BASE = __ENV.BASE || 'http://localhost:8080'
const API = `${BASE}/api`
const WS = BASE.replace(/^http/, 'ws') + '/ws'
export const options = { vus: Number(__ENV.VUS || 50), duration: __ENV.DURATION || '30s', thresholds: { fanout_ms: ['p(95)<500'] } }
const fanout = new Trend('fanout_ms'), received = new Counter('events_received')
const H = (t) => ({ headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` } })
const S = Math.floor(Math.random() * 1e6)
const register = (name) => http.post(`${API}/auth/register`, JSON.stringify({ username: `${name}${S}`, email: `${name}${S}@load.test`, password: 'password1', display_name: name }), { headers: { 'Content-Type': 'application/json' } }).json()

export function setup() {
  const owner = register('wsowner')
  const g = http.post(`${API}/guilds`, JSON.stringify({ name: `WS load ${S}` }), H(owner.token)).json()
  const inv = http.post(`${API}/guilds/${g.id}/invites`, '{}', H(owner.token)).json()
  return { code: inv.code, channel: g.channels.find((c) => c.kind === 'text').id, owner: owner.token }
}

export default function (data) {
  const u = register(`ws${__VU}`)
  http.post(`${API}/invites/${data.code}`, '{}', H(u.token))
  const res = ws.connect(`${WS}?token=${u.token}`, {}, (socket) => {
    socket.on('message', (raw) => {
      const ev = JSON.parse(raw)
      if (ev.t === 'MESSAGE_CREATE' && ev.d?.message?.content?.startsWith('t:')) {
        received.add(1); fanout.add(Date.now() - Number(ev.d.message.content.slice(2)))
      }
    })
    // VU 1 is the publisher: one message a second carrying its send time.
    if (__VU === 1) socket.setInterval(() => http.post(`${API}/channels/${data.channel}/messages`, JSON.stringify({ content: `t:${Date.now()}` }), H(data.owner)), 1000)
    socket.setTimeout(() => socket.close(), (Number((__ENV.DURATION || '30s').replace('s', '')) - 2) * 1000)
  })
  check(res, { 'ws 101': (r) => r && r.status === 101 })
}
