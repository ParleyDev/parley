// Spotify as a status and Listen Along, against a stub Spotify: linking keeps tokens with playback scopes; while the
// host is online their song shows in the member list and on their profile; Listen Along starts it on the listener's
// Spotify at the host's position and follows track changes; Premium / no-device errors come back readably; turning
// the status off, or going offline, clears it.
import http from 'node:http'
import { chromium } from 'playwright'
import { B, WEB, S, reg, call, raw, ok, finish, adminToken } from '../lib.mjs'
const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
const admin = await adminToken()
const alice = await reg('alice'), bob = await reg('bob'), carol = await reg('carol'), dave = await reg('dave')
const who = new Map([[alice, 'alice'], [bob, 'bob'], [carol, 'carol'], [dave, 'dave']])
const track = (id, name, ms = 200000) => ({ id, name, duration_ms: ms, artists: [{ name: 'The Stubs' }, { name: 'Mock' }], album: { name: 'Fixtures', images: [{ url: 'https://i.scdn.co/image/x' }] }, external_urls: { spotify: `https://open.spotify.com/track/${id}` } })
// What each account is playing (null = nothing), and how its player answers a play request.
const playing = { alice: null }
const playStatus = { bob: 204, carol: 403, dave: 404 }
const plays = []; const seen = { scopes: [], refreshes: 0 }
const json = (res, v, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)) }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname; const auth = (req.headers.authorization ?? '').replace('Bearer ', '')
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    if (p === '/authorize') { seen.scopes.push(u.searchParams.get('scope')); res.writeHead(302, { Location: `${u.searchParams.get('redirect_uri')}?code=${u.searchParams.get('login_hint')}&state=${encodeURIComponent(u.searchParams.get('state'))}` }); return res.end() }
    if (p === '/api/token') {
      const f = new URLSearchParams(body)
      if (f.get('grant_type') === 'refresh_token') { seen.refreshes++; return json(res, { access_token: `tok-${f.get('refresh_token').replace('ref-', '')}`, expires_in: 3600 }) }
      return json(res, { access_token: `tok-${f.get('code')}`, refresh_token: `ref-${f.get('code')}`, expires_in: 3600 })
    }
    const name = auth.replace('tok-', '')
    if (p === '/v1/me') return json(res, { id: `sp-${name}`, display_name: `${name} ${S}`, external_urls: { spotify: `https://open.spotify.com/user/sp-${name}` } })
    if (p === '/v1/me/player/currently-playing') {
      const st = playing[name]
      if (!st) { res.writeHead(204); return res.end() }
      return json(res, { is_playing: !st.paused, currently_playing_type: 'track', progress_ms: Date.now() - st.since, item: st.item })
    }
    if (p === '/v1/me/player/play' && req.method === 'PUT') { plays.push({ who: name, ...JSON.parse(body || '{}') }); res.writeHead(playStatus[name] ?? 204); return res.end(playStatus[name] >= 400 ? JSON.stringify({ error: { status: playStatus[name] } }) : '') }
    res.writeHead(404); res.end()
  })
})
await new Promise((r) => server.listen(0, '0.0.0.0', r)); const PORT = server.address().port
const settings = await call(admin.token, 'GET', '/admin/settings')
await raw(admin.token, 'PUT', '/admin/settings', { ...settings, oauth_providers: { ...(settings.oauth_providers ?? {}), spotify: { client_id: 'sid', client_secret: 'ssec' } }, oauth_endpoint_override: `http://${HOST}:${PORT}` })
const link = async (u) => {
  const st = await call(u.token, 'GET', '/connections/spotify/start')
  const hop = await fetch(st.url + `&login_hint=${who.get(u)}`, { redirect: 'manual' })
  return (await fetch(hop.headers.get('location').replace(/^https?:\/\/[^/]+\/api/, B), { redirect: 'manual' })).headers.get('location') ?? ''
}
const g = await call(alice.token, 'POST', '/guilds', { name: `Tunes ${S}` }); const ch = g.channels.find((c) => c.kind === 'text')
const inv = await call(alice.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const u of [bob, carol, dave]) await call(u.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch(); const errors = []
const mk = async (u) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector('textarea')
  return p
}
const until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await new Promise((r) => setTimeout(r, 300)) } return false }

console.log('-- linking')
for (const u of [alice, bob, carol]) await link(u)
ok('Spotify asks for what is playing and for playback control', /user-read-currently-playing/.test(seen.scopes[0]) && /user-modify-playback-state/.test(seen.scopes[0]), seen.scopes[0])
const conns = await call(alice.token, 'GET', '/users/@me/connections')
ok('the link keeps its access, and shows as a status by default', conns[0]?.provider === 'spotify' && conns[0].live === true && conns[0].show_activity === true, JSON.stringify(conns))

console.log('-- listening')
playing.alice = { since: Date.now() - 30000, item: track('T1', `Song One ${S}`) }
const pa = await mk(alice), pb = await mk(bob)
const row = pb.locator(`[data-member-row="${alice.user.id}"] [data-member-activity]`)
ok('the member list shows "Listening to Spotify"', await until(async () => (await row.count()) === 1) && (await row.innerText()).includes('Spotify'))
await pb.click(`[data-member-row="${alice.user.id}"]`); await pb.waitForSelector('[data-activity="spotify"]')
const card = await pb.locator('[data-activity="spotify"]').innerText()
ok('the profile shows the song, its artists and how far in', card.includes(`Song One ${S}`) && card.includes('The Stubs, Mock') && /0:3\d/.test(card), card)
ok('with Play on Spotify', await pb.locator('[data-activity-play]').getAttribute('href') === 'https://open.spotify.com/track/T1')

console.log('-- listen along')
ok('not with yourself', (await raw(alice.token, 'POST', `/users/${alice.user.id}/listen-along`, {})).status === 400)
await pb.click('[data-listen-along="start"]')
await until(() => plays.some((x) => x.who === 'bob'))
const first = plays.find((x) => x.who === 'bob')
ok('Listen Along starts the song on the listener\'s Spotify where the host is', first?.uris?.[0] === 'spotify:track:T1' && first.position_ms >= 29000 && first.position_ms < 45000, JSON.stringify(first))
ok('the host\'s card shows who listens along', await until(async () => (await pb.locator('[data-activity-party="1"]').count()) === 1) && await pb.locator('[data-listen-along="stop"]').count() === 1)
playing.alice = { since: Date.now(), item: track('T2', `Song Two ${S}`) }
ok('when the host changes song, the listener follows', await until(() => plays.some((x) => x.who === 'bob' && x.uris?.[0] === 'spotify:track:T2')), JSON.stringify(plays))
ok('and the card updates', await until(async () => (await pb.locator('[data-activity-title]').innerText().catch(() => '')).includes('Song Two')))
const r403 = await raw(carol.token, 'POST', `/users/${alice.user.id}/listen-along`, {})
ok('without Premium it says so', r403.status === 400 && /Premium/.test(JSON.stringify(await r403.json())))
await link(dave); playStatus.dave = 404
const r404 = await raw(dave.token, 'POST', `/users/${alice.user.id}/listen-along`, {})
ok('with Spotify closed it says to open it', r404.status === 400 && /Open Spotify/.test(JSON.stringify(await r404.json())))
const eve = await reg('eve'); await call(eve.token, 'POST', `/invites/${inv.code}`)
ok('without a Spotify link it says to link one', /Link your Spotify/.test(JSON.stringify(await (await raw(eve.token, 'POST', `/users/${alice.user.id}/listen-along`, {})).json())))
await pb.click('[data-listen-along="stop"]')
ok('Stop Listening leaves the party', await until(async () => (await pb.locator('[data-listen-along="start"]').count()) === 1 && (await pb.locator('[data-activity-party]').count()) === 0))
await pb.keyboard.press('Escape')

console.log('-- privacy')
await pa.click('button[title="User Settings"]'); await pa.click('[data-settings-tab="connections"]')
await pa.waitForSelector('[data-connection-activity="1"]'); await pa.click('[data-connection-activity] button')
ok('turning off "Display Spotify as your status" clears it for everyone', await until(async () => (await row.count()) === 0))
await pa.click('[data-connection-activity] button')
ok('and back on shows it again', await until(async () => (await row.count()) === 1))
playing.alice.paused = true
ok('pausing clears it', await until(async () => (await row.count()) === 0))
playing.alice.paused = false
ok('playing again brings it back', await until(async () => (await row.count()) === 1))
await pb.reload(); await pb.waitForSelector('textarea')
ok('a fresh session gets it from READY', await until(async () => (await row.count()) === 1, 3000))
await pa.context().close()
ok('going offline clears it', await until(async () => (await row.count()) === 0, 30000))
ok('no page errors', errors.length === 0, errors.join(' | '))
await raw(admin.token, 'PUT', '/admin/settings', settings)
await call(alice.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); server.close(); await finish()
