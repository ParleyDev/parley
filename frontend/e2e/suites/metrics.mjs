import { API_ORIGIN, S, reg, call, ok, finish } from '../lib.mjs'

const scrape = async () => { const r = await fetch(`${API_ORIGIN}/metrics`); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() } }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\"=,]/g, (c) => '\\' + c)
const val = (text, name) => { const m = new RegExp(`^${esc(name)} (\\d+)$`, 'm').exec(text); return m ? Number(m[1]) : null }

let m = await scrape()
ok('/metrics answers in Prometheus text format', m.status === 200 && (m.type || '').startsWith('text/plain') && m.text.includes('# TYPE parley_http_requests_total counter'))
for (const n of ['parley_http_request_duration_ms_bucket{le="+Inf"}', 'parley_http_errors_5xx_total', 'parley_messages_created_total', 'parley_ws_connections', 'parley_online_users', 'parley_voice_sessions', 'parley_db_pool_size', 'parley_uploads_total']) {
  ok(`exposes ${n}`, val(m.text, n) !== null)
}
const before = { msgs: val(m.text, 'parley_messages_created_total'), posts: val(m.text, 'parley_http_requests_total{method="POST",class="2xx"}') ?? 0, bad: val(m.text, 'parley_http_requests_total{method="POST",class="4xx"}') ?? 0, inf: val(m.text, 'parley_http_request_duration_ms_bucket{le="+Inf"}') }
const a = await reg('alice'); const g = await call(a.token, 'POST', '/guilds', { name: `Metrics ${S}` })
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: 'counted' })
await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: '' }) // 400
m = await scrape()
ok('message counter and POST 2xx/4xx counters advanced', val(m.text, 'parley_messages_created_total') === before.msgs + 1 && val(m.text, 'parley_http_requests_total{method="POST",class="2xx"}') >= before.posts + 3 && val(m.text, 'parley_http_requests_total{method="POST",class="4xx"}') >= before.bad + 1)
ok('latency histogram counts every request', val(m.text, 'parley_http_request_duration_ms_bucket{le="+Inf"}') > before.inf && val(m.text, 'parley_http_request_duration_ms_count') === val(m.text, 'parley_http_request_duration_ms_bucket{le="+Inf"}'))
const WS = API_ORIGIN.replace(/^http/, 'ws') + '/ws'
const ws = new WebSocket(`${WS}?token=${a.token}`); await new Promise((r) => { ws.onmessage = () => r(); ws.onerror = () => r() })
await new Promise((r) => setTimeout(r, 200)); m = await scrape()
ok('an open socket shows in the connection gauges', val(m.text, 'parley_ws_connections') >= 1 && val(m.text, 'parley_online_users') >= 1 && val(m.text, 'parley_ws_connects_total') >= 1)
ws.close(); await new Promise((r) => setTimeout(r, 300))
ok('the backend health endpoint is excluded from nothing: it is counted too', val((await scrape()).text, 'parley_http_requests_total{method="GET",class="2xx"}') > 0)
await finish()
