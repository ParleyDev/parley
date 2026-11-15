// How communities hold up at the size a partner server is meant to carry: 1,000 communities (each a category with one
// channel, so about 2,000 channels) in one server, one owner and one member following 10. Stand-alone, not in run.mjs:
//   PARLEY_API_ORIGIN=… PARLEY_WEB=… npm run perf:communities      (COMMUNITIES=1000 by default)
// Prints one JSON line { communities, connect_ms, connect_bytes, list_p95_ms, search_p95_ms, sidebar_ms, unread_ms }
// and exits non-zero when a threshold is exceeded. Figures depend on the machine; creating the communities may need the
// RL_* limits raised on the backend (see the README). The users it registers are purged at the end.
import { B, WEB, S, reg, call, raw, callS, launchBrowser, cleanup } from './lib.mjs'

const N = Number(process.env.COMMUNITIES ?? 1000), CONC = 4, FOLLOWED = 10
const LIMITS = { connect_ms: 2000, connect_bytes: 3 * 1024 * 1024, list_p95_ms: 300, search_p95_ms: 300, sidebar_ms: 3000, unread_ms: 5 }
const WSURL = B.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws'
const WORDS = ['iron', 'velvet', 'neon', 'crimson', 'hollow', 'silver', 'wild', 'paper', 'static', 'ember', 'lunar', 'rusty', 'glass', 'north', 'tidal', 'amber']
const r2 = (v) => Math.round(v * 100) / 100
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]
const timed = async (fn) => { const t = performance.now(); await fn(); return performance.now() - t }
const log = (...a) => console.error(...a)

// The first payload of a fresh socket: how long until it arrives and how large it is.
const connect = (token) => new Promise((resolve, reject) => {
  const t = performance.now(); const ws = new WebSocket(`${WSURL}?token=${token}`)
  ws.onmessage = (e) => { const first = typeof e.data === 'string' ? e.data : null; if (first === null || JSON.parse(first).t !== 'READY') return; ws.close(); resolve({ ms: performance.now() - t, bytes: Buffer.byteLength(first) }) }
  ws.onerror = () => reject(new Error('socket error')); setTimeout(() => reject(new Error('no READY in 60 s')), 60_000)
})

let report = null, code = 1
try {
  const a = await reg('owner'), b = await reg('member')
  const g = await call(a.token, 'POST', '/guilds', { name: `Scale ${S}` })
  const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
  const base = `/guilds/${g.id}/communities`

  // The member's socket stays open through creation and counts what it is sent.
  let events = 0; const ws = new WebSocket(`${WSURL}?token=${b.token}`); ws.onmessage = () => { events++ }
  await new Promise((res) => { ws.onopen = res }); await new Promise((r) => setTimeout(r, 500)); events = 0

  log(`-- creating ${N} communities (${CONC} at a time)`)
  let next = 0, failed = 0; const slugs = []
  const t0 = performance.now()
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (next < N) {
      const i = next++, name = `${WORDS[i % WORDS.length]} ${WORDS[(i * 7 + 3) % WORDS.length]} ${i}`
      for (let tries = 0; ; tries++) {
        const r = await callS(a.token, 'POST', base, { slug: `c${i}`, name })
        if (r.status === 201) { slugs.push(`c${i}`); break }
        if (r.status === 429 && tries < 5) { await new Promise((res) => setTimeout(res, 2000)); continue }
        failed++; if (failed <= 3) log('   create failed:', r.status, JSON.stringify(r.body)); break
      }
      if (i % 100 === 99) log(`   ${i + 1}`)
    }
  }))
  const created_ms = Math.round(performance.now() - t0)
  if (failed) throw new Error(`${failed} communities could not be created (rate limited? raise RL_*)`)
  await new Promise((r) => setTimeout(r, 1000)); const created_events = events; ws.close()

  for (const s of slugs.slice(0, FOLLOWED)) await raw(b.token, 'PUT', `${base}/${s}/follow`)

  log('-- connect')
  const c = await connect(b.token)

  log('-- list and search')
  const lists = [], searches = []
  for (let i = 0; i < 50; i++) lists.push(await timed(async () => { const r = await raw(b.token, 'GET', `${base}?limit=50`); await r.arrayBuffer() }))
  const frags = WORDS.map((w) => w.slice(0, 3))
  for (let i = 0; i < 50; i++) searches.push(await timed(async () => { const r = await raw(b.token, 'GET', `${base}?q=${frags[i % frags.length]}&limit=50`); await r.arrayBuffer() }))

  log('-- sidebar')
  const browser = await launchBrowser(); const errors = []
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await p.evaluate((t) => localStorage.setItem('parley.token', t), b.token)
  const t1 = performance.now(); await p.goto(`${WEB}/channels/${g.id}`)
  await p.waitForSelector('[data-browse-communities]', { timeout: 60_000 }); const sidebar_ms = performance.now() - t1
  const shown = await p.locator('[data-community]').count()
  const unread = await p.evaluate((id) => window.__parleyUnread?.(id) ?? null, g.id)
  await browser.close()
  if (unread === null) throw new Error('the page has no __parleyUnread hook (rebuild the frontend)')
  if (shown !== FOLLOWED) log(`   note: ${shown} community blocks shown, expected ${FOLLOWED}`)
  if (errors.length) log('   page errors:', errors.join(' | '))

  report = { communities: N, connect_ms: Math.round(c.ms), connect_bytes: c.bytes, list_p95_ms: r2(p95(lists)), search_p95_ms: r2(p95(searches)), sidebar_ms: Math.round(sidebar_ms), unread_ms: r2(unread) }
  log(`-- creating took ${created_ms} ms; the member's socket received ${created_events} events meanwhile`)
  code = Object.entries(LIMITS).some(([k, v]) => report[k] > v) ? 1 : 0
  if (code) log('   over the threshold:', Object.entries(LIMITS).filter(([k, v]) => report[k] > v).map(([k, v]) => `${k} ${report[k]} > ${v}`).join(', '))
} catch (e) { log('FAILED:', e.message) }
console.log(JSON.stringify(report))
await cleanup()
process.exit(code)
