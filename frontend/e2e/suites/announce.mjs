// Release announcements are posted as the official Parley account: an instance admin posts through
// POST /admin/announce (or the MCP `announce` tool, scope mcp.admin) into a server's channel. @everyone pings, an
// announcement channel publishes it to its followers, and it is audited. Nobody else can use it.
import crypto from 'node:crypto'
import { API_ORIGIN, S, reg, call, raw, ok, finish, adminToken } from '../lib.mjs'
const WEB = API_ORIGIN // MCP and its OAuth discovery live on the API origin
const admin = await adminToken(), a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `News ${S}` }); const src = g.channels.find((x) => x.kind === 'text')
await call(a.token, 'PATCH', `/channels/${src.id}`, { news: true })
const g2 = await call(b.token, 'POST', '/guilds', { name: `Follower ${S}` }); const dst = g2.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const f = await raw(b.token, 'POST', `/channels/${src.id}/followers`, { channel_id: dst.id })
ok('bob follows the announcement channel', f.status < 300, String(f.status))

console.log('-- REST')
const text = `@everyone **Parley ${S} is here!** Big things.\n\nFull release notes: https://github.com/ParleyDev/parley/releases/tag/v${S}`
let r = await raw(a.token, 'POST', '/admin/announce', { channel_id: src.id, content: text })
ok('a non-admin cannot announce', r.status === 403, String(r.status))
r = await raw(admin.token, 'POST', '/admin/announce', { channel_id: src.id, content: text })
const res = await r.json()
ok('an admin posts it', r.status === 201, JSON.stringify(res).slice(0, 300))
const m = res.message
ok('as the verified Parley system account', m.author.display_name === 'Parley' && m.author.system === true && m.author.bot === true, JSON.stringify(m.author))
ok('@everyone pings', m.mention_everyone === true)
ok('published to the following channel', res.published_to === 1)
const copies = await call(b.token, 'GET', `/channels/${dst.id}/messages?limit=5`)
ok('the follower got the post, from Parley', copies.some((x) => x.content === text && x.author.display_name === 'Parley'), JSON.stringify(copies.map((x) => x.author.display_name)))
const seen = await call(a.token, 'GET', `/channels/${src.id}/messages?limit=5`)
ok('members see it in the channel', seen.some((x) => x.id === m.id && x.author.system))
const audit = await call(admin.token, 'GET', '/admin/audit?limit=20')
ok('it is audited', (Array.isArray(audit) ? audit : audit.entries ?? []).some((e) => e.action === 'announce.post' && e.target_id === src.id), JSON.stringify(audit).slice(0, 200))
r = await raw(admin.token, 'POST', '/admin/announce', { channel_id: src.id, content: '   ' })
ok('empty is refused', r.status === 400)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
r = await raw(admin.token, 'POST', '/admin/announce', { channel_id: dm?.id ?? crypto.randomUUID(), content: 'hi' })
ok('only server channels', r.status === 400 || r.status === 404, String(r.status))

console.log('-- MCP')
const local = (u) => u.replace(/^https?:\/\/[^/]+/, WEB) // APP_URL may name the public host; talk to this stack
const asm = await (await fetch(`${WEB}/.well-known/oauth-authorization-server`)).json()
const www = (await fetch(`${WEB}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).headers.get('www-authenticate') ?? ''
const prm = await (await fetch(local(/resource_metadata="([^"]+)"/.exec(www)[1]))).json()
ok('the mcp.admin scope is offered', prm.scopes_supported.includes('mcp.admin'))
const redirect = 'http://localhost:7777/callback'
const client = await (await fetch(local(asm.registration_endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: `Release bot ${S}`, redirect_uris: [redirect], token_endpoint_auth_method: 'none' }) })).json()
const grant = async (who, scopes) => {
  const v = crypto.randomBytes(32).toString('base64url'), c = crypto.createHash('sha256').update(v).digest('base64url')
  const res = await call(who.token, 'POST', '/mcp/consent', { response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: c, code_challenge_method: 'S256', resource: prm.resource, approve: true, scopes })
  const code = new URL(res.redirect).searchParams.get('code')
  const t = await (await fetch(local(asm.token_endpoint), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: client.client_id, code_verifier: v, resource: prm.resource }) })).json()
  return t.access_token
}
let rid = 1
const mcp = async (tok, method, params) => (await (await fetch(`${WEB}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${tok}`, 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) })).json()).result
const plain = await grant(admin, ['mcp.read', 'mcp.send'])
ok('without mcp.admin there is no announce tool', !(await mcp(plain, 'tools/list', {})).tools.some((t) => t.name === 'announce'))
const tok = await grant(admin, ['mcp.read', 'mcp.admin'])
ok('with it, the announce tool is listed', (await mcp(tok, 'tools/list', {})).tools.some((t) => t.name === 'announce'))
const out = await mcp(tok, 'tools/call', { name: 'announce', arguments: { channel_id: src.id, content: `Second ${S}`, publish: false } })
const j = JSON.parse(out.content[0].text)
ok('the tool posts as Parley', !out.isError && j.author?.display_name === 'Parley' && j.published_to === null, out.content[0].text.slice(0, 300))
const otherTok = await grant(a, ['mcp.read', 'mcp.admin'])
const denied = await mcp(otherTok, 'tools/call', { name: 'announce', arguments: { channel_id: src.id, content: 'nope' } })
ok('a non-admin with the scope is still refused', denied.isError === true, denied.content?.[0]?.text)
ok('and the scope reaches nothing else of the admin API', (await raw(tok, 'GET', '/admin/users')).status >= 401)
finish()
