// Parley as a remote MCP server: discovery (401 → protected resource → authorization server metadata), dynamic client
// registration, the PKCE authorization code flow through the consent page, refresh rotation with reuse detection,
// tools per scope, REST scope enforcement for MCP tokens, unreads, and disconnecting from Settings.
import { chromium } from 'playwright'
import crypto from 'node:crypto'
import { API_ORIGIN, WEB, reg, call, ok, finish, openDms } from '../lib.mjs'

const a = await reg('mcpuser'), b = await reg('mcpbuddy')
await openDms(a, b)
const g = await call(a.token, 'POST', '/guilds', { name: 'MCP Lab' }); const tc = g.channels.find((c) => c.kind === 'text').id
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const S = Date.now().toString(36)

console.log('-- discovery')
let r = await fetch(`${WEB}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) })
const www = r.headers.get('www-authenticate') ?? ''
const rm = /resource_metadata="([^"]+)"/.exec(www)?.[1]
ok('no token: 401 pointing at the protected resource metadata', r.status === 401 && !!rm && rm.endsWith('/.well-known/oauth-protected-resource/mcp'), www)
const prm = await (await fetch(rm.replace(/^https?:\/\/[^/]+/, WEB))).json()
ok('protected resource metadata names /mcp and the authorization server', prm.resource.endsWith('/mcp') && prm.authorization_servers.length === 1 && prm.scopes_supported.includes('mcp.manage'), JSON.stringify(prm))
const asm = await (await fetch(`${WEB}/.well-known/oauth-authorization-server`)).json()
ok('authorization server metadata: code + PKCE S256 + registration + refresh', asm.code_challenge_methods_supported?.[0] === 'S256' && asm.grant_types_supported.includes('refresh_token') && !!asm.registration_endpoint && asm.token_endpoint_auth_methods_supported.includes('none'), JSON.stringify(asm))
const local = (u) => u.replace(/^https?:\/\/[^/]+/, WEB) // APP_URL may name the public host; talk to this stack
// Straight to the backend: a dev server may answer preflights itself (nginx passes them through).
r = await fetch(`${API_ORIGIN}/.well-known/oauth-authorization-server`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:6274', 'Access-Control-Request-Method': 'GET' } })
ok('discovery allows cross-origin callers (browser-based MCP clients)', r.headers.get('access-control-allow-origin') === '*')

console.log('-- registration')
const redirect = 'http://localhost:7777/callback'
r = await fetch(local(asm.registration_endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: `E2E Assistant ${S}`, redirect_uris: [redirect], token_endpoint_auth_method: 'none' }) })
const client = await r.json()
ok('dynamic client registration: public client', r.status === 201 && client.client_id?.startsWith('mcpc_') && client.token_endpoint_auth_method === 'none', JSON.stringify(client))
r = await fetch(local(asm.registration_endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Evil', redirect_uris: ['http://evil.example/cb'] }) })
ok('non-loopback http redirect refused', r.status === 400 && (await r.json()).error === 'invalid_redirect_uri')

const pkce = () => { const v = crypto.randomBytes(32).toString('base64url'); return { v, c: crypto.createHash('sha256').update(v).digest('base64url') } }
const token = async (form) => { const res = await fetch(local(asm.token_endpoint), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) }); return { status: res.status, body: await res.json() } }

console.log('-- consent page')
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1280, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
let landed = null
await p.route('http://localhost:7777/**', (rt) => { landed = rt.request().url(); rt.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }) })
const k1 = pkce()
const authUrl = local(asm.authorization_endpoint) + '?' + new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: k1.c, code_challenge_method: 'S256', state: 'st8', scope: 'mcp.read mcp.send', resource: prm.resource })
await p.goto(authUrl); await p.waitForSelector('[data-mcp-client]')
ok('authorization endpoint lands on the consent page', p.url().includes('/oauth2/mcp/authorize') && (await p.textContent('[data-mcp-client]')) === `E2E Assistant ${S}`)
const ticked = async (id) => p.locator(`[data-mcp-scope="${id}"] input`).isChecked()
ok('requested permissions are ticked, the rest are not', await ticked('mcp.read') && await ticked('mcp.send') && !(await ticked('mcp.notifications')) && !(await ticked('mcp.manage')))
ok('the page names where it will return to', (await p.textContent('[data-mcp-redirect-host]')) === 'localhost')
await p.click('[data-mcp-scope="mcp.manage"]'); ok('ticking Manage shows a warning', await p.locator('[data-mcp-manage-warning]').count() === 1)
await p.click('[data-mcp-scope="mcp.manage"]')
await p.screenshot({ path: 'mcp-consent.png' })
await p.click('[data-mcp-approve]'); await p.waitForFunction(() => true); for (let i = 0; i < 50 && !landed; i++) await p.waitForTimeout(100)
const back = new URL(landed)
ok('Allow returns to the client with code, state and iss', !!back.searchParams.get('code') && back.searchParams.get('state') === 'st8' && !!back.searchParams.get('iss'), landed)

console.log('-- tokens')
const code = back.searchParams.get('code')
let t = await token({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: client.client_id, code_verifier: 'x'.repeat(43), resource: prm.resource })
ok('wrong PKCE verifier is refused (and burns the code)', t.status === 400 && t.body.error === 'invalid_grant')
// A fresh code for the rest (the consent endpoint is what the page calls).
const k2 = pkce()
const consent = async (k, scopes) => {
  const res = await call(a.token, 'POST', '/mcp/consent', { response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: k.c, code_challenge_method: 'S256', resource: prm.resource, approve: true, scopes })
  return new URL(res.redirect).searchParams.get('code')
}
const code2 = await consent(k2, ['mcp.read', 'mcp.send'])
t = await token({ grant_type: 'authorization_code', code: code2, redirect_uri: redirect, client_id: client.client_id, code_verifier: k2.v, resource: prm.resource })
ok('code + verifier → access and refresh tokens with the granted scopes', t.status === 200 && t.body.access_token.startsWith('mcp_') && t.body.refresh_token.startsWith('mcpr_') && t.body.scope === 'mcp.read mcp.send' && t.body.expires_in > 0, JSON.stringify(t.body))
ok('a code works once', (await token({ grant_type: 'authorization_code', code: code2, redirect_uri: redirect, client_id: client.client_id, code_verifier: k2.v })).body.error === 'invalid_grant')
let access = t.body.access_token; const refresh1 = t.body.refresh_token

let rid = 10
const mcp = async (method, params, tok = access) => {
  const res = await fetch(`${WEB}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${tok}`, 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) })
  return { status: res.status, body: res.status === 200 ? await res.json() : null }
}
const tool = async (name, args = {}, tok = access) => { const res = await mcp('tools/call', { name, arguments: args }, tok); const c = res.body?.result; return { error: c?.isError, text: c?.content?.[0]?.text ?? JSON.stringify(res.body?.error ?? res.status), json: (() => { try { return JSON.parse(c?.content?.[0]?.text) } catch { return null } })() } }

console.log('-- MCP')
let res = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } })
ok('initialize negotiates the protocol and names the server', res.body?.result?.protocolVersion === '2025-06-18' && res.body.result.serverInfo.name === 'parley' && !!res.body.result.capabilities.tools && res.body.result.instructions.includes('<@USER_ID>'), JSON.stringify(res.body).slice(0, 200))
r = await fetch(`${WEB}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
ok('notifications get 202 Accepted', r.status === 202)
ok('GET /mcp: no server stream (405)', (await fetch(`${WEB}/mcp`, { headers: { Authorization: `Bearer ${access}` } })).status === 405)
res = await mcp('tools/list', {})
const names = res.body.result.tools.map((x) => x.name)
ok('tools/list offers read and send tools only', names.includes('read_messages') && names.includes('send_message') && !names.includes('get_unreads') && !names.includes('kick_member'), names.join(','))
ok('read tools are annotated read-only', res.body.result.tools.find((x) => x.name === 'search_messages').annotations.readOnlyHint === true)
ok('unknown method → -32601', (await mcp('resources/list', {})).body.error?.code === -32601)

let x = await tool('whoami'); ok('whoami is the approving user', x.json?.id === a.user.id, x.text)
x = await tool('list_servers'); ok('list_servers includes the server', x.json?.servers.some((s) => s.id === g.id), x.text)
x = await tool('list_channels', { server_id: g.id }); ok('list_channels lists its channels', x.json?.channels.some((c) => c.id === tc), x.text)
x = await tool('send_message', { channel_id: tc, content: `hello from the assistant ${S}` })
ok('send_message posts as the user', !x.error && x.json?.author.id === a.user.id, x.text)
const sent = x.json?.id
const seen = await call(b.token, 'GET', `/channels/${tc}/messages?limit=5`)
ok('other members see it', seen.some((m) => m.id === sent && m.author.id === a.user.id))
x = await tool('read_messages', { channel_id: tc, limit: 10 }); ok('read_messages returns it, oldest first', x.json?.messages.at(-1)?.id === sent, x.text.slice(0, 200))
x = await tool('search_messages', { query: `assistant ${S}` }); ok('search_messages finds it', x.json?.results.some((m) => m.id === sent), x.text.slice(0, 200))
x = await tool('send_dm', { user_id: b.user.id, content: `psst ${S}` })
const dms = await call(b.token, 'GET', '/users/@me/channels')
ok('send_dm delivers a DM', !x.error && dms.some((d) => d.id === x.json?.channel_id), x.text)
x = await tool('add_reaction', { channel_id: tc, message_id: sent, emoji: '👍' }); ok('add_reaction works', !x.error, x.text)
x = await tool('get_unreads'); ok('a tool outside the granted scopes says which permission is missing', x.error && x.text.includes('mcp.notifications'), x.text)
x = await tool('read_messages', { channel_id: 'nope' }); ok('bad ids are explained', x.error && x.text.includes('UUID'), x.text)

console.log('-- REST with an MCP token')
const rest = (m, path, body) => fetch(`${WEB}/api${path}`, { method: m, headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((q) => q.status)
ok('allowed: reading messages', await rest('GET', `/channels/${tc}/messages`) === 200)
ok('refused: creating a channel without manage', await rest('POST', `/guilds/${g.id}/channels`, { name: 'nope' }) === 403)
const refused = (st) => st === 401 || st === 403
ok('refused: account changes, sessions, MCP grants', refused(await rest('PATCH', '/users/@me', { display_name: 'pwned' })) && refused(await rest('GET', '/users/@me/sessions')) && refused(await rest('GET', '/users/@me/mcp-grants')))
ok('the display name is unchanged', (await call(a.token, 'GET', '/users/@me')).display_name !== 'pwned')

console.log('-- refresh')
t = await token({ grant_type: 'refresh_token', refresh_token: refresh1, client_id: client.client_id })
ok('refresh gives new tokens', t.status === 200 && t.body.access_token !== access && t.body.refresh_token !== refresh1, JSON.stringify(t.body))
access = t.body.access_token
ok('the new access token works', (await tool('whoami')).json?.id === a.user.id)
t = await token({ grant_type: 'refresh_token', refresh_token: refresh1, client_id: client.client_id })
ok('replaying a used refresh token is refused…', t.status === 400 && t.body.error === 'invalid_grant')
ok('…and ends the whole connection', (await mcp('tools/list', {})).status === 401)

console.log('-- everything allowed')
const k3 = pkce()
t = await token({ grant_type: 'authorization_code', code: await consent(k3, ['mcp.read', 'mcp.notifications', 'mcp.send', 'mcp.manage']), redirect_uri: redirect, client_id: client.client_id, code_verifier: k3.v })
access = t.body.access_token
ok('all four scopes granted', t.body.scope.split(' ').length === 4)
await call(b.token, 'POST', `/channels/${tc}/messages`, { content: `hey <@${a.user.id}> are you there ${S}` })
x = await tool('get_unreads')
const row = x.json?.channels.find((c) => c.channel_id === tc)
ok('get_unreads shows the channel with a mention', row?.unread >= 1 && row.mentions >= 1 && row.server_name === 'MCP Lab', x.text)
x = await tool('get_mentions'); ok('get_mentions lists the mention', x.json?.mentions.some((m) => m.content.includes(`are you there ${S}`)), x.text.slice(0, 200))
x = await tool('mark_read', { channel_id: tc }); ok('mark_read', !x.error, x.text)
x = await tool('get_unreads'); ok('…and the channel is no longer unread', !x.json?.channels.some((c) => c.channel_id === tc), x.text)
x = await tool('create_channel', { server_id: g.id, name: `bot-made-${S}`, topic: 'made over MCP' }); ok('create_channel', x.json?.name === `bot-made-${S}`, x.text)
x = await tool('pin_message', { channel_id: tc, message_id: sent }); ok('pin_message', !x.error, x.text)
x = await tool('list_pins', { channel_id: tc }); ok('list_pins shows it', x.json?.pins.some((m) => m.id === sent), x.text.slice(0, 200))
x = await tool('timeout_member', { server_id: g.id, user_id: b.user.id, minutes: 5 }); ok('timeout_member', !x.error, x.text)
x = await tool('create_invite', { server_id: g.id }); ok('create_invite returns a link', x.json?.url?.includes('/invite/'), x.text)
x = await tool('kick_member', { server_id: g.id, user_id: b.user.id }); ok('kick_member', !x.error && !(await call(a.token, 'GET', `/guilds/${g.id}/members`)).some((m) => m.user_id === b.user.id), x.text)
x = await tool('delete_message', { channel_id: tc, message_id: sent }); ok('delete_message', !x.error, x.text)

console.log('-- Settings')
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('[data-panel-self]')
await p.click('button[title="User Settings"]'); await p.click('button:has-text("Authorized Apps")'); await p.waitForSelector('[data-mcp-section]')
ok('Settings shows the MCP address', (await p.textContent('[data-mcp-url]')).endsWith('/mcp'))
const grants = p.locator('[data-mcp-grant]'); await grants.first().waitFor({ timeout: 5000 }).catch(() => {}) // the list loads after the section
ok('and the connected assistant with its permissions', await grants.count() >= 1 && (await grants.first().textContent()).includes(`E2E Assistant ${S}`))
await p.screenshot({ path: 'mcp-settings.png' })
await grants.first().locator('[data-mcp-disconnect]').click(); await p.waitForTimeout(500)
ok('Disconnect ends access at once', (await mcp('tools/list', {})).status === 401)
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
