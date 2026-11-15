// Logged-out invite preview: GET /invites/:code answers without a token (public fields only), still refuses bad tokens.
import { B, H, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Public Invite ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, { max_age: 0, max_uses: 0 })
const anon = (p) => fetch(B + p, { headers: H })

let r = await anon(`/invites/${inv.code}`); let j = await r.json()
ok('anonymous preview answers', r.status === 200 && j.guild.name === g.name && j.guild.member_count === 1 && typeof j.guild.online_count === 'number')
ok('anonymous preview has no per-user fields', !('already_member' in j) && !('banned' in j) && !('rules' in j.guild))
ok('anonymous preview is CORS readable', r.headers.get('access-control-allow-origin') === '*')
ok('anonymous preview is cacheable', r.headers.get('cache-control') === 'public, max-age=30')
ok('anonymous preview reports paused and preview_channel', j.paused === false && j.preview_channel === null)
ok('unknown code is 404', (await anon('/invites/nope-nope')).status === 404)
ok('invalid token is refused', (await fetch(B + `/invites/${inv.code}`, { headers: { ...H, Authorization: 'Bearer garbage' } })).status === 401)
j = await call(b.token, 'GET', `/invites/${inv.code}`)
ok('logged-in preview unchanged', j.already_member === false && j.banned === false && 'rules' in j.guild && j.preview_channel === null)
const once = await call(a.token, 'POST', `/guilds/${g.id}/invites`, { max_uses: 1 })
await call(b.token, 'POST', `/invites/${once.code}`)
ok('used-up invite shows expired to anonymous', (await (await anon(`/invites/${once.code}`)).json()).expired === true)

const c = await reg('carol')
for (const x of [b, c]) { await call(a.token, 'POST', '/users/@me/relationships', { user_id: x.user.id }); await call(x.token, 'PUT', `/users/@me/relationships/${a.user.id}`) }
const grp = await call(a.token, 'POST', '/users/@me/channels', { recipient_ids: [b.user.id, c.user.id] })
const gdm = await call(a.token, 'POST', `/channels/${grp.id}/group-invites`, {})
ok('group invite code is still private', !!gdm.code && (await anon(`/group-invites/${gdm.code}`)).status === 401)
await finish()
