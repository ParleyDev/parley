// Twitch / YouTube subscriber roles: a creator links their channel with subscriber access, adds it to their server,
// and members whose linked account subscribes (Twitch) or is a channel member (YouTube) get a managed role; it
// follows the subscriber list on sync, on linking / unlinking, and can't be handed out by hand. Stub providers.
import http from 'node:http'
import { chromium } from 'playwright'
import { B, WEB, S, reg, call, raw, ok, finish, adminToken } from '../lib.mjs'
const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
const admin = await adminToken()
const owner = await reg('streamer'), fan = await reg('fan'), lurker = await reg('lurker'), ytfan = await reg('ytfan')
// Who each token belongs to, by the code the authorize step hands back (?login_hint=<who>).
const people = { streamer: { tw: 'b-1', yt: 'UCcreator' }, fan: { tw: 't-fan', yt: 'UCfan' }, lurker: { tw: 't-lurk', yt: 'UClurk' }, ytfan: { tw: 't-yt', yt: 'UCyt' } }
let twitchSubs = ['t-fan', 'b-1']; let ytMembers = ['UCyt']
const seen = { scopes: [], refreshes: 0 }
let expired = false
const json = (res, v, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)) }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname; const auth = (req.headers.authorization ?? '').replace('Bearer ', '')
  if (p === '/oauth2/authorize' || p === '/o/oauth2/v2/auth') { seen.scopes.push(u.searchParams.get('scope') + (u.searchParams.get('access_type') ? ` [${u.searchParams.get('access_type')}]` : '')); res.writeHead(302, { Location: `${u.searchParams.get('redirect_uri')}?code=${u.searchParams.get('login_hint')}&state=${encodeURIComponent(u.searchParams.get('state'))}` }); res.end(); return }
  if (p === '/oauth2/token' || p === '/token') {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const f = new URLSearchParams(body)
      if (f.get('grant_type') === 'refresh_token') { seen.refreshes++; expired = false; return json(res, { access_token: `tok-${f.get('refresh_token').replace('ref-', '')}`, expires_in: 3600 }) }
      json(res, { access_token: `tok-${f.get('code')}`, refresh_token: `ref-${f.get('code')}`, expires_in: 3600 })
    }); return
  }
  const who = auth.replace('tok-', '')
  if (p === '/helix/users') return json(res, { data: [{ id: people[who].tw, login: `${who}${S}`, display_name: `${who} ${S}` }] })
  if (p === '/youtube/v3/channels') return json(res, { items: [{ id: people[who].yt, snippet: { title: `${who} channel` } }] })
  if (p === '/helix/subscriptions') {
    if (expired) return json(res, { error: 'Unauthorized' }, 401)
    if (u.searchParams.get('broadcaster_id') !== 'b-1' || who !== 'streamer') return json(res, {}, 403)
    // Two pages, to check the cursor is followed.
    const after = u.searchParams.get('after'); const page = after ? twitchSubs.slice(1) : twitchSubs.slice(0, 1)
    return json(res, { data: page.map((id) => ({ user_id: id, broadcaster_id: 'b-1' })), pagination: after || twitchSubs.length < 2 ? {} : { cursor: 'p2' } })
  }
  if (p === '/youtube/v3/members') return json(res, { items: ytMembers.map((c) => ({ snippet: { memberDetails: { channelId: c } } })) })
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(0, '0.0.0.0', r)); const PORT = server.address().port
const settings = await call(admin.token, 'GET', '/admin/settings')
await raw(admin.token, 'PUT', '/admin/settings', { ...settings, oauth_providers: { twitch: { client_id: 'tid', client_secret: 'tsec' }, youtube: { client_id: 'yid', client_secret: 'ysec' } }, oauth_endpoint_override: `http://${HOST}:${PORT}` })
const link = async (u, provider, creator = false) => {
  const st = await call(u.token, 'GET', `/connections/${provider}/start${creator ? '?creator=1' : ''}`)
  const who = Object.keys(people).find((k) => u === { streamer: owner, fan, lurker, ytfan }[k])
  const hop = await fetch(st.url + `&login_hint=${who}`, { redirect: 'manual' })
  const back = await fetch(hop.headers.get('location').replace(/^https?:\/\/[^/]+\/api/, B), { redirect: 'manual' })
  return back.headers.get('location') ?? ''
}
const g = await call(owner.token, 'POST', '/guilds', { name: `Stream ${S}` })
const inv = await call(owner.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const u of [fan, lurker, ytfan]) await call(u.token, 'POST', `/invites/${inv.code}`)
const roles = async (u) => ((await call(owner.token, 'GET', `/guilds/${g.id}/members`)).find((m) => m.user_id === u.user.id)?.roles ?? [])

console.log('-- creator link')
ok('members can only link a creator channel for Twitch and YouTube', (await raw(fan.token, 'GET', '/connections/github/start?creator=1')).status === 400)
ok('adding needs a creator link first', (await raw(owner.token, 'POST', `/guilds/${g.id}/integrations/creators`, { provider: 'twitch' })).status === 400)
const back = await link(owner, 'twitch', true)
ok('the creator link asks Twitch for subscriber access', seen.scopes.at(-1) === 'channel:read:subscriptions' && /creator=1/.test(back), seen.scopes.at(-1))
await link(owner, 'youtube', true)
ok('and YouTube for channel memberships, offline', /youtube\.channel-memberships\.creator/.test(seen.scopes.at(-1)) && /\[offline\]/.test(seen.scopes.at(-1)), seen.scopes.at(-1))
ok('a creator link is marked as such', (await call(owner.token, 'GET', '/users/@me/connections')).filter((c) => c.creator).length === 2)
ok('non-managers can\'t add one', (await raw(fan.token, 'POST', `/guilds/${g.id}/integrations/creators`, { provider: 'twitch' })).status === 403)

console.log('-- Twitch')
await link(fan, 'twitch'); await link(lurker, 'twitch')
ok('a plain link stores no tokens', !(await call(fan.token, 'GET', '/users/@me/connections'))[0].creator)
const tw = await call(owner.token, 'POST', `/guilds/${g.id}/integrations/creators`, { provider: 'twitch' })
ok('the integration is added with a managed role', tw.provider === 'twitch' && tw.role_id && tw.account_name === `streamer ${S}`, JSON.stringify(tw))
const role = (await call(owner.token, 'GET', `/guilds/${g.id}/roles`)).find((x) => x.id === tw.role_id)
ok('called Twitch Subscriber', role?.name === 'Twitch Subscriber')
ok('subscribers get it (across pages), others don\'t', (await roles(fan)).includes(tw.role_id) && !(await roles(lurker)).includes(tw.role_id) && tw.member_count === 1, JSON.stringify(tw))
ok('the streamer isn\'t counted as their own subscriber', !(await roles(owner)).includes(tw.role_id))
ok('it can\'t be handed out by hand', (await raw(owner.token, 'PATCH', `/guilds/${g.id}/members/${lurker.user.id}`, { roles: [tw.role_id] })).status === 400)
ok('or deleted on its own', (await raw(owner.token, 'DELETE', `/guilds/${g.id}/roles/${tw.role_id}`)).status === 400)
twitchSubs = ['t-lurk']
let s1 = await call(owner.token, 'POST', `/guilds/${g.id}/integrations/creators/${tw.id}/sync`)
ok('a sync follows the subscriber list', (await roles(lurker)).includes(tw.role_id) && !(await roles(fan)).includes(tw.role_id) && s1.member_count === 1)
await call(lurker.token, 'DELETE', `/users/@me/connections/${(await call(lurker.token, 'GET', '/users/@me/connections'))[0].id}`)
ok('unlinking the account drops the role', !(await roles(lurker)).includes(tw.role_id))
twitchSubs = ['t-fan']; await link(lurker, 'twitch')
await call(owner.token, 'POST', `/guilds/${g.id}/integrations/creators/${tw.id}/sync`)
ok('back to fan', (await roles(fan)).includes(tw.role_id))
expired = true
s1 = await call(owner.token, 'POST', `/guilds/${g.id}/integrations/creators/${tw.id}/sync`)
ok('revoked access shows as an error and keeps roles as they were', /link it again/.test(s1.last_error) && (await roles(fan)).includes(tw.role_id), JSON.stringify(s1))

console.log('-- YouTube')
await link(ytfan, 'youtube')
const yt = await call(owner.token, 'POST', `/guilds/${g.id}/integrations/creators`, { provider: 'youtube' })
ok('channel members get YouTube Member', yt.member_count === 1 && (await roles(ytfan)).includes(yt.role_id))
ok('one integration per provider', (await raw(owner.token, 'POST', `/guilds/${g.id}/integrations/creators`, { provider: 'youtube' })).status === 409)
ytMembers = []; await link(fan, 'youtube')
ytMembers = ['UCfan', 'UCyt']
await new Promise((r) => setTimeout(r, 1500))
ok('linking an account syncs right away', (await roles(fan)).includes(yt.role_id))

console.log('-- settings UI')
const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), owner.token)
await p.goto(`${WEB}/channels/${g.id}`)
await p.locator(`button:has-text("Stream ${S}")`).first().click(); await p.click('text=Server Settings')
await p.locator('button:has-text("Integrations")').first().click(); await p.waitForSelector('[data-integration-creator="youtube"]')
ok('both integrations show with their status', (await p.locator('[data-integration-creator="twitch"] [data-creator-status]').innerText()).includes('link it again') && (await p.locator('[data-integration-creator="youtube"] [data-creator-status]').innerText()).includes('2 members have YouTube Member'))
await p.click('[data-creator-remove="youtube"]'); await p.click('button.btn-danger:has-text("Remove")'); await p.waitForTimeout(1000)
ok('removing takes the role with it', !(await call(owner.token, 'GET', `/guilds/${g.id}/roles`)).some((x) => x.id === yt.role_id) && !(await roles(ytfan)).includes(yt.role_id))
ok('no page errors', errors.length === 0, errors.join(' | '))
await raw(admin.token, 'PUT', '/admin/settings', settings)
await call(owner.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); server.close(); await finish()
