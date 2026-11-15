// Communities: a named group of channels in a server, backed by one ordinary category. Create, read, edit, delete,
// the guard on deleting the backing category, and bots with Manage Channels.
import { B, H, S, reg, call, raw, ok, finish } from '../lib.mjs'

const a = await reg('alice'), b = await reg('bob'), dev = await reg('dev')
const g = await call(a.token, 'POST', '/guilds', { name: `Communities ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const base = `/guilds/${g.id}/communities`

let r = await raw(a.token, 'POST', base, { slug: 'metallica', name: 'Metallica', description: 'Thrash', external_ref: 'mb:65f4f0c5' }); let m = await r.json()
ok('created with a chat channel', r.status === 201 && m.slug === 'metallica' && m.channel_ids.length === 1 && m.follower_count === 0 && m.following === false)
const chans = await call(a.token, 'GET', `/guilds/${g.id}/channels`)
ok('backed by a category', chans.find((c) => c.id === m.category_id)?.kind === 'category' && chans.find((c) => c.id === m.channel_ids[0])?.parent_id === m.category_id)
ok('duplicate slug refused', (await raw(a.token, 'POST', base, { slug: 'metallica', name: 'X' })).status === 409)
ok('duplicate external_ref refused', (await raw(a.token, 'POST', base, { slug: 'other', name: 'X', external_ref: 'mb:65f4f0c5' })).status === 409)
ok('a refused create leaves no category behind', (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).filter((c) => c.kind === 'category').length === 1)
for (const bad of ['Metallica', '-x', 'a b', '', 'x'.repeat(64)]) ok(`slug ${JSON.stringify(bad)} refused`, (await raw(a.token, 'POST', base, { slug: bad, name: 'X' })).status === 400)
ok('member without Manage Channels cannot create', (await raw(b.token, 'POST', base, { slug: 'slayer', name: 'Slayer' })).status === 403)
ok('member can read one', (await call(b.token, 'GET', `${base}/metallica`)).id === m.id)
r = await raw(a.token, 'POST', base, { slug: 'pavement', name: 'Pavement', channels: [{ name: 'chat', kind: 'text' }, { name: 'setlists', kind: 'forum' }] })
ok('custom channels', (await r.json()).channel_ids.length === 2)
ok('unsupported channel kind refused', (await raw(a.token, 'POST', base, { slug: 'z', name: 'Z', channels: [{ name: 'c', kind: 'category' }] })).status === 400)
r = await raw(a.token, 'PATCH', `${base}/metallica`, { name: 'Metallica!', slug: 'metallica-band' }); m = await r.json()
ok('edit renames slug and category', r.status === 200 && m.slug === 'metallica-band' && (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((c) => c.id === m.category_id).name === 'Metallica!')
ok('backing category cannot be deleted directly', (await raw(a.token, 'DELETE', `/channels/${m.category_id}`)).status === 400)
await call(a.token, 'DELETE', `/channels/${m.channel_ids[0]}`)
ok('community survives losing its last channel', (await call(a.token, 'GET', `${base}/metallica-band`)).channel_ids.length === 0)
ok('delete removes it', (await raw(a.token, 'DELETE', `${base}/metallica-band`)).status === 204 && (await raw(a.token, 'GET', `${base}/metallica-band`)).status === 404)
ok('delete removed the category', !(await call(a.token, 'GET', `/guilds/${g.id}/channels`)).some((c) => c.id === m.category_id))
const pav = await call(a.token, 'GET', `${base}/pavement`)
ok('delete removes its channels too', (await raw(a.token, 'DELETE', `${base}/pavement`)).status === 204 && !(await call(a.token, 'GET', `/guilds/${g.id}/channels`)).some((c) => pav.channel_ids.includes(c.id)))

console.log('-- bots')
const botPost = (tok, body) => fetch(B + base, { method: 'POST', headers: { ...H, Authorization: 'Bot ' + tok }, body: JSON.stringify(body) })
const addBot = async (name, perms) => {
  const app = await call(dev.token, 'POST', '/applications', { name: `${name} ${S}` })
  const bot = await call(dev.token, 'POST', `/applications/${app.id}/bot`, {})
  await raw(a.token, 'POST', '/oauth2/authorize', { client_id: app.client_id, scope: 'bot', guild_id: g.id, permissions: String(perms) })
  return bot.token
}
const VIEW = 1 << 10, MANAGE = 1 << 4
const strong = await addBot('Maker', VIEW | MANAGE), weak = await addBot('Reader', VIEW)
r = await botPost(strong, { slug: 'by-bot', name: 'By Bot' })
ok('a bot with Manage Channels can create a community', r.status === 201 && (await r.json()).slug === 'by-bot')
ok('a bot without Manage Channels gets 403', (await botPost(weak, { slug: 'nope', name: 'Nope' })).status === 403)
await finish()
