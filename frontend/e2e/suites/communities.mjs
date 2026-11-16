// Communities: a named group of channels in a server, backed by one ordinary category. Create, read, edit, delete,
// the guard on deleting the backing category, and bots with Manage Channels.
import { execSync } from 'node:child_process'
import { B, H, S, reg, call, raw, ok, finish, testContainer } from '../lib.mjs'
const sql = (q) => execSync(`docker exec ${testContainer('db')} psql -U parley -tAc "${q.replace(/"/g, '\\"')}"`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
// Poll a read until it satisfies `pred` (up to ~2 s): message-send touches last_activity_at in a spawned task.
const until = async (read, pred) => { let v; for (let i = 0; i < 20; i++) { v = await read(); if (pred(v)) return v; await new Promise((r) => setTimeout(r, 100)) } return v }
const WS = B.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws'

const a = await reg('alice'), b = await reg('bob'), dev = await reg('dev')
const g = await call(a.token, 'POST', '/guilds', { name: `Communities ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const base = `/guilds/${g.id}/communities`

let r = await raw(a.token, 'POST', base, { slug: 'metallica', name: 'Metallica', description: 'Thrash', external_ref: 'mb:65f4f0c5' }); let m = await r.json()
ok('created with a chat channel', r.status === 201 && m.slug === 'metallica' && m.channel_ids.length === 1 && m.follower_count === 1 && m.following === true)
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
console.log('-- follow, list, activity')
ok('follow', (await raw(b.token, 'PUT', `${base}/pavement/follow`)).status === 204 && (await raw(b.token, 'PUT', `${base}/pavement/follow`)).status === 204)
let one = await call(b.token, 'GET', `${base}/pavement`)
ok('follow is reflected', one.following === true && one.follower_count === 2)
ok('the creator still follows, independently of bob', (await call(a.token, 'GET', `${base}/pavement`)).following === true)
await call(a.token, 'POST', `/channels/${one.channel_ids[0]}/messages`, { content: 'hello' })
let list = await until(() => call(b.token, 'GET', base), (l) => l.items[0]?.last_activity_at != null)
ok('list sorts by recent activity', list.items[0].slug === 'pavement' && list.items[0].last_activity_at !== null && list.items[1].last_activity_at === null && list.next === null)
ok('list carries counts and channels', list.items[0].follower_count === 2 && list.items[0].following === true && list.items[0].channel_ids.length === 2 && list.items[1].following === false)
ok('search', (await call(b.token, 'GET', `${base}?q=PAVE`)).items.length === 1 && (await call(b.token, 'GET', `${base}?q=zzz`)).items.length === 0)
ok('lookup by external_ref', (await call(b.token, 'GET', `${base}?external_ref=${encodeURIComponent('mb:65f4f0c5')}`)).items[0].slug === 'metallica')
ok('name sort and paging', await (async () => { const p1 = await call(b.token, 'GET', `${base}?sort=name&limit=1`); const p2 = await call(b.token, 'GET', `${base}?sort=name&limit=1&after=${encodeURIComponent(p1.next)}`); return p1.items[0].slug === 'metallica' && p2.items[0].slug === 'pavement' && p2.next === null })())
ok('activity paging covers nulls', await (async () => { const p1 = await call(b.token, 'GET', `${base}?limit=1`); const p2 = await call(b.token, 'GET', `${base}?limit=1&after=${encodeURIComponent(p1.next)}`); return p1.items[0].slug === 'pavement' && p2.items[0].slug === 'metallica' && p2.next === null })())
ok('bad limit, sort and cursor refused', (await raw(b.token, 'GET', `${base}?limit=0`)).status === 400 && (await raw(b.token, 'GET', `${base}?sort=x`)).status === 400 && (await raw(b.token, 'GET', `${base}?after=zzz`)).status === 400)
ok('unfollow', (await raw(b.token, 'DELETE', `${base}/pavement/follow`)).status === 204 && (await call(b.token, 'GET', `${base}/pavement`)).following === false)
ok('unfollow is idempotent', (await raw(b.token, 'DELETE', `${base}/pavement/follow`)).status === 204)
ok('limit 100 is accepted and 101 refused', (await raw(b.token, 'GET', `${base}?limit=100`)).status === 200 && (await raw(b.token, 'GET', `${base}?limit=101`)).status === 400)

console.log('-- list: search wildcards and shared activity')
const mk = async (slug, name) => call(a.token, 'POST', base, { slug, name })
const extras = [await mk('pct', 'Pct%x'), await mk('pcty', 'PctYx'), await mk('under', 'un_der'), await mk('unxder', 'unXder')]
const hits = async (qs) => (await call(b.token, 'GET', `${base}?q=${encodeURIComponent(qs)}`)).items.map((c) => c.slug).sort().join()
ok('q with % matches literally', await hits('t%x') === 'pct' && await hits('%') === 'pct')
ok('q with _ matches literally', await hits('n_d') === 'under' && await hits('_') === 'under')
const ties = [await mk('tie-a', 'Tie B'), await mk('tie-b', 'Tie A'), await mk('tie-c', 'Tie C'), await mk('tie-d', 'Tie D')]
sql(`UPDATE communities SET last_activity_at = '2030-01-01 00:00:00+00' WHERE guild_id = '${g.id}' AND slug LIKE 'tie-%'`)
const seenTies = []
for (let after = '', n = 0; n < 5; n++) { const pg = await call(b.token, 'GET', `${base}?q=tie&limit=3${after}`); seenTies.push(...pg.items.map((c) => c.slug)); if (!pg.next) break; after = `&after=${encodeURIComponent(pg.next)}` }
ok('pages over a shared last_activity_at return each item once, in name order', seenTies.join() === 'tie-b,tie-a,tie-c,tie-d', seenTies.join())
const hook = await call(a.token, 'POST', `/channels/${extras[0].channel_ids[0]}/webhooks`, { name: 'CI' })
const actOf = async (slug) => (await call(a.token, 'GET', `${base}/${slug}`)).last_activity_at
ok('a community with no messages has no activity', await actOf('pct') === null && await actOf('pcty') === null && await actOf('under') === null)
ok('a webhook post bumps last_activity_at', (await fetch(`${B}/webhooks/${hook.webhook.id}/${hook.token}`, { method: 'POST', headers: H, body: JSON.stringify({ content: 'deployed' }) })).ok && await actOf('pct') !== null)
const th = await call(a.token, 'POST', `/channels/${extras[1].channel_ids[0]}/threads`, { name: 'jam' })
await call(a.token, 'POST', `/channels/${th.id}/messages`, { content: 'in a thread' })
ok('a message in a thread under a community channel bumps it', await until(() => actOf('pcty'), (x) => x !== null) !== null)
const src = await call(a.token, 'POST', `/channels/${extras[2].channel_ids[0]}/messages`, { content: 'to forward' })
sql(`UPDATE communities SET last_activity_at = NULL WHERE id = '${extras[3].id}'`)
await call(a.token, 'POST', `/channels/${extras[2].channel_ids[0]}/messages/${src.id}/forward`, { channel_id: extras[3].channel_ids[0] })
ok('a forwarded message bumps the target community', await until(() => actOf('unxder'), (x) => x !== null) !== null)
for (const c of [...extras, ...ties]) await raw(a.token, 'DELETE', `${base}/${c.slug}`)

console.log('-- follow: hidden category')
await call(a.token, 'PUT', `/channels/${one.category_id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: 1024 })
ok('hidden: get is 404 for a member', (await raw(b.token, 'GET', `${base}/pavement`)).status === 404)
ok('hidden: follow is 404', (await raw(b.token, 'PUT', `${base}/pavement/follow`)).status === 404)
ok('hidden: list omits it', !(await call(b.token, 'GET', base)).items.some((c) => c.slug === 'pavement') && !(await call(b.token, 'GET', `${base}?q=pave`)).items.length)
ok('hidden: still listed for the owner', (await call(a.token, 'GET', base)).items.some((c) => c.slug === 'pavement'))
await call(a.token, 'DELETE', `/channels/${one.category_id}/permissions/${g.id}`)
ok('visible again once the overwrite is gone', (await raw(b.token, 'GET', `${base}/pavement`)).status === 200)

console.log('-- follow: leave and rejoin')
ok('bob follows metallica', (await raw(b.token, 'PUT', `${base}/metallica/follow`)).status === 204 && (await call(a.token, 'GET', `${base}/metallica`)).follower_count === 2)
ok('bob leaves', (await raw(b.token, 'DELETE', `/guilds/${g.id}/members/@me`)).status === 204)
await call(b.token, 'POST', `/invites/${inv.code}`)
const back = await call(b.token, 'GET', `${base}/metallica`)
ok('rejoining follows nothing', back.following === false && back.follower_count === 1)

console.log('-- follow: connect payload and event')
{
  await raw(b.token, 'PUT', `${base}/pavement/follow`)
  const evs = []
  let first
  const sock = await new Promise((resolve) => { const w = new WebSocket(`${WS}?token=${b.token}`); w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'READY') { first = m.d; resolve(w) } else evs.push(m) } })
  const slimM = first.communities.find((c) => c.slug === 'metallica')
  ok('READY carries communities in slim form', slimM && slimM.guild_id === g.id && slimM.name === 'Metallica' && slimM.category_id && !('follower_count' in slimM), JSON.stringify(first.communities))
  ok('READY carries community_follows for the guild', JSON.stringify(first.community_follows.find((f) => f.guild_id === g.id)?.community_ids) === JSON.stringify([one.id]), JSON.stringify(first.community_follows))
  await raw(b.token, 'PUT', `${base}/metallica/follow`)
  await new Promise((r2) => setTimeout(r2, 1000))
  ok('follow pushes COMMUNITY_FOLLOW_UPDATE to the caller', evs.some((m) => m.t === 'COMMUNITY_FOLLOW_UPDATE' && m.d.following === true && m.d.community_id === slimM.id && m.d.guild_id === g.id), JSON.stringify(evs.map((m) => m.t)))
  sock.close()
  const sock2 = await new Promise((resolve) => { let w = new WebSocket(`${WS}?token=${b.token}`); w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'READY') { first = m.d; resolve(w) } } })
  const f = first.community_follows.find((x) => x.guild_id === g.id)
  ok('a later READY lists the follow', f && JSON.stringify(f.community_ids) === JSON.stringify([one.id, slimM.id]))
  sock2.close()
}

console.log('-- follow survives losing and regaining view')
{
  const evs = []
  const sock = await new Promise((resolve) => { const w = new WebSocket(`${WS}?token=${b.token}`); w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'READY') resolve(w); else evs.push(m) } })
  await call(a.token, 'PUT', `/channels/${one.category_id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: 1024 })
  await call(a.token, 'DELETE', `/channels/${one.category_id}/permissions/${g.id}`)
  await new Promise((r2) => setTimeout(r2, 1500))
  const ours = evs.filter((m) => (m.t === 'COMMUNITY_DELETE' || m.t === 'COMMUNITY_CREATE') && m.d.id === one.id || m.t === 'COMMUNITY_FOLLOW_UPDATE' && m.d.community_id === one.id).map((m) => m.t + (m.t === 'COMMUNITY_FOLLOW_UPDATE' ? `:${m.d.following}` : ''))
  ok('regaining view re-sends the follow after the community', ours.join() === 'COMMUNITY_DELETE,COMMUNITY_CREATE,COMMUNITY_FOLLOW_UPDATE:true', ours.join())
  sock.close()
}

r = await raw(a.token, 'PATCH', `${base}/metallica`, { name: 'Metallica!', slug: 'metallica-band' }); m = await r.json()
ok('edit renames slug and category', r.status === 200 && m.slug === 'metallica-band' && (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((c) => c.id === m.category_id).name === 'Metallica!')
ok('backing category cannot be deleted directly', (await raw(a.token, 'DELETE', `/channels/${m.category_id}`)).status === 400)
await call(a.token, 'DELETE', `/channels/${m.channel_ids[0]}`)
ok('community survives losing its last channel', (await call(a.token, 'GET', `${base}/metallica-band`)).channel_ids.length === 0)
ok('delete removes it', (await raw(a.token, 'DELETE', `${base}/metallica-band`)).status === 204 && (await raw(a.token, 'GET', `${base}/metallica-band`)).status === 404)
ok('delete removed the category', !(await call(a.token, 'GET', `/guilds/${g.id}/channels`)).some((c) => c.id === m.category_id))
const pav = await call(a.token, 'GET', `${base}/pavement`)
ok('delete removes its channels too', (await raw(a.token, 'DELETE', `${base}/pavement`)).status === 204 && !(await call(a.token, 'GET', `/guilds/${g.id}/channels`)).some((c) => pav.channel_ids.includes(c.id)))

console.log('-- page fields, flags, creator follow')
{
  let pg = await call(a.token, 'POST', base, { slug: 'pagey', name: 'Pagey', about: 'Hello **there**', links: [{ label: 'Site', url: 'https://example.com/x', junk: 1 }] })
  ok('create carries page fields', pg.about === 'Hello **there**' && pg.links.length === 1 && pg.links[0].label === 'Site' && !('junk' in pg.links[0]) && pg.banner_url === null)
  ok('creator follows automatically', pg.following === true && pg.follower_count === 1)
  ok('creator flags', pg.can_edit === true && pg.can_delete === true && pg.can_manage_managers === false)
  let asBob = await call(b.token, 'GET', `${base}/pagey`)
  ok('member flags', asBob.can_edit === false && asBob.can_delete === false && asBob.following === false)
  const inList = (await call(a.token, 'GET', `${base}?q=pagey`)).items[0]
  ok('list items carry the flags', inList.can_edit === true && inList.can_delete === true && inList.about === 'Hello **there**')
  ok('about too long refused', (await raw(a.token, 'PATCH', `${base}/pagey`, { about: 'x'.repeat(4001) })).status === 400)
  ok('about at the limit accepted', (await raw(a.token, 'PATCH', `${base}/pagey`, { about: 'x'.repeat(4000) })).status === 200)
  ok('eleven links refused', (await raw(a.token, 'PATCH', `${base}/pagey`, { links: Array.from({ length: 11 }, (_, i) => ({ label: `L${i}`, url: 'https://example.com' })) })).status === 400)
  for (const url of ['javascript:alert(1)', 'ftp://example.com', 'example.com', 'https://' + 'a'.repeat(500)]) ok(`link url ${url.slice(0, 20)} refused`, (await raw(a.token, 'PATCH', `${base}/pagey`, { links: [{ label: 'X', url }] })).status === 400)
  for (const label of ['', 'x'.repeat(81)]) ok(`link label length ${label.length} refused`, (await raw(a.token, 'PATCH', `${base}/pagey`, { links: [{ label, url: 'https://example.com' }] })).status === 400)
  ok('links replace as a whole and keep order', (await call(a.token, 'PATCH', `${base}/pagey`, { links: [{ label: 'B', url: 'https://b.example' }, { label: 'A', url: 'https://a.example' }] })).links.map((l) => l.label).join() === 'B,A')
  ok('banner must be an image', (await raw(a.token, 'PATCH', `${base}/pagey`, { banner_url: 'javascript:alert(1)' })).status === 400)
  ok('banner is set and cleared', (await call(a.token, 'PATCH', `${base}/pagey`, { banner_url: 'https://example.com/b.png' })).banner_url === 'https://example.com/b.png' && (await call(a.token, 'PATCH', `${base}/pagey`, { banner_url: '' })).banner_url === null)
  {
    const evs = []
    const sock = await new Promise((resolve) => { const w = new WebSocket(`${WS}?token=${b.token}`); w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'READY') resolve(w); else evs.push(m) } })
    await call(a.token, 'PATCH', `${base}/pagey`, { banner_url: 'https://example.com/c.png' })
    await new Promise((r2) => setTimeout(r2, 800))
    const up = evs.find((m) => m.t === 'COMMUNITY_UPDATE' && m.d.slug === 'pagey')?.d
    ok('the slim form has banner_url and neither about nor links', up?.banner_url === 'https://example.com/c.png' && !('about' in up) && !('links' in up), JSON.stringify(up))
    sock.close()
    const first = await new Promise((resolve) => { const w = new WebSocket(`${WS}?token=${b.token}`); w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'READY') { w.close(); resolve(m.d) } } })
    const sl = first.communities.find((c) => c.slug === 'pagey')
    ok('the connect payload slim form likewise', sl && 'banner_url' in sl && !('about' in sl) && !('links' in sl), JSON.stringify(sl))
  }
  const log = await call(a.token, 'GET', `/guilds/${g.id}/audit?action=community.update`)
  const upd = (Array.isArray(log) ? log : log.items ?? []).filter((e) => e.target_id === pg.id)
  ok('update audit names the page fields that changed, not their contents', upd.some((e) => (e.details?.changed ?? []).includes('links')) && !JSON.stringify(upd.map((e) => e.details)).includes('b.example'))
  // delete: only the owner or an Administrator
  const cm = await reg('carol'), ad = await reg('dave')
  for (const u of [cm, ad]) await call(u.token, 'POST', `/invites/${inv.code}`)
  const mr = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Chan', permissions: (1 << 4) | (1 << 10) })
  const ar = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Boss', permissions: (1 << 3) | (1 << 10) })
  await call(a.token, 'PATCH', `/guilds/${g.id}/members/${cm.user.id}`, { roles: [mr.id] })
  await call(a.token, 'PATCH', `/guilds/${g.id}/members/${ad.user.id}`, { roles: [ar.id] })
  const asCarol = await call(cm.token, 'GET', `${base}/pagey`)
  ok('a Manage Channels holder can edit but not delete', asCarol.can_edit === true && asCarol.can_delete === false)
  ok('Manage Channels does not delete a community', (await raw(cm.token, 'DELETE', `${base}/pagey`)).status === 403 && (await raw(a.token, 'GET', `${base}/pagey`)).status === 200)
  ok('an Administrator sees can_delete', (await call(ad.token, 'GET', `${base}/pagey`)).can_delete === true)
  ok('an Administrator deletes it', (await raw(ad.token, 'DELETE', `${base}/pagey`)).status === 204)
  await call(a.token, 'POST', base, { slug: 'pagey2', name: 'Pagey Two' })
  ok('the owner deletes it', (await raw(a.token, 'DELETE', `${base}/pagey2`)).status === 204)
}

console.log('-- validation')
ok('name of 101 chars refused', (await raw(a.token, 'POST', base, { slug: 'v1', name: 'n'.repeat(101) })).status === 400)
ok('description of 301 chars refused', (await raw(a.token, 'POST', base, { slug: 'v2', name: 'X', description: 'd'.repeat(301) })).status === 400)
ok('external_ref of 201 chars refused', (await raw(a.token, 'POST', base, { slug: 'v3', name: 'X', external_ref: 'e'.repeat(201) })).status === 400)
ok('icon must be an image url', (await raw(a.token, 'POST', base, { slug: 'v4', name: 'X', icon_url: 'javascript:alert(1)' })).status === 400)
const v = await (await raw(a.token, 'POST', base, { slug: 'visible', name: 'Visible', external_ref: 'ref:v' })).json()
await raw(a.token, 'POST', base, { slug: 'taken', name: 'Taken' })
ok('PATCH with an invalid slug refused', (await raw(a.token, 'PATCH', `${base}/visible`, { slug: 'Bad Slug' })).status === 400)
ok('PATCH with a bad icon refused', (await raw(a.token, 'PATCH', `${base}/visible`, { icon_url: 'ftp://x/y.png' })).status === 400)
r = await raw(a.token, 'PATCH', `${base}/visible`, { slug: 'taken' }); const rb = await r.json()
ok('PATCH to a taken slug is 409 with the create message', r.status === 409 && JSON.stringify(rb).includes('A community with that address already exists'), JSON.stringify(rb))
ok('PATCH by a member without Manage Channels is 403', (await raw(b.token, 'PATCH', `${base}/visible`, { name: 'Hacked' })).status === 403)
ok('DELETE by a plain member is 403', (await raw(b.token, 'DELETE', `${base}/visible`)).status === 403)

console.log('-- hidden category')
const hid = await (await raw(a.token, 'POST', base, { slug: 'hidden', name: 'Hidden' })).json()
await call(a.token, 'PUT', `/channels/${hid.category_id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: 1024 })
ok('a member who cannot view the category gets 404', (await raw(b.token, 'GET', `${base}/hidden`)).status === 404)
ok('the owner still gets it', (await call(a.token, 'GET', `${base}/hidden`)).id === hid.id)
const seen = []
const ws = await new Promise((resolve) => { const w = new WebSocket(`${WS}?token=${b.token}`); w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'READY') resolve(w); else seen.push(m) } })
await raw(a.token, 'PATCH', `${base}/hidden`, { name: 'Hidden Renamed' })
await raw(a.token, 'PATCH', `${base}/visible`, { name: 'Visible Renamed' })
await new Promise((r2) => setTimeout(r2, 1500))
const about = (id) => seen.filter((m) => (m.t === 'COMMUNITY_UPDATE' || m.t === 'CHANNEL_UPDATE') && m.d?.id === id).map((m) => m.t)
ok('a visible community update reaches a member', about(v.id).includes('COMMUNITY_UPDATE') && about(v.category_id).includes('CHANNEL_UPDATE'), JSON.stringify(seen.map((m) => m.t)))
ok('a hidden community update does not', about(hid.id).length === 0 && about(hid.category_id).length === 0)
const hidAfter = await raw(a.token, 'DELETE', `${base}/hidden`)
await new Promise((r2) => setTimeout(r2, 800))
ok('hidden delete is silent for the member too', hidAfter.status === 204 && !seen.some((m) => m.t === 'COMMUNITY_DELETE' && m.d?.id === hid.id))
ws.close()
// a writer who cannot view the category still gets their write back
const mgr = await reg('mgr')
await call(mgr.token, 'POST', `/invites/${inv.code}`)
const role = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Maker', permissions: (1 << 4) | (1 << 10) })
await call(a.token, 'PATCH', `/guilds/${g.id}/members/${mgr.user.id}`, { roles: [role.id] })
const priv = await (await raw(mgr.token, 'POST', base, { slug: 'priv', name: 'Priv' })).json()
await call(a.token, 'PUT', `/channels/${priv.category_id}/permissions/${role.id}`, { kind: 'role', allow: 0, deny: 1024 })
await call(a.token, 'PUT', `/channels/${priv.category_id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: 1024 })
r = await raw(mgr.token, 'PATCH', `${base}/priv`, { description: 'still mine' })
ok('a manager who can no longer view the category cannot edit its community (as for the channel itself)', r.status === 404, String(r.status))
ok('nor delete it (404: not visible to them)', (await raw(mgr.token, 'DELETE', `${base}/priv`)).status === 404 && (await call(a.token, 'GET', `${base}/priv`))?.slug === 'priv')

console.log('-- Manage Channels is checked in the category')
{
  const MANAGE_CH = 1 << 4
  const cm = await reg('chmgr'); await call(cm.token, 'POST', `/invites/${inv.code}`)
  const mrole = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Channel boss', permissions: (1 << 4) | (1 << 10) })
  await call(a.token, 'PATCH', `/guilds/${g.id}/members/${cm.user.id}`, { roles: [mrole.id] })
  const guarded = await (await raw(a.token, 'POST', base, { slug: 'guarded', name: 'Guarded' })).json()
  ok('a Manage Channels member can edit it at first', (await raw(cm.token, 'PATCH', `${base}/guarded`, { description: 'one' })).status === 200)
  await call(a.token, 'PUT', `/channels/${guarded.category_id}/permissions/${mrole.id}`, { kind: 'role', allow: 0, deny: MANAGE_CH })
  r = await raw(cm.token, 'PATCH', `${base}/guarded`, { description: 'two' })
  ok('denied Manage Channels by an overwrite on the category: PATCH is 403', r.status === 403, String(r.status))
  r = await raw(cm.token, 'DELETE', `${base}/guarded`)
  ok('and DELETE is 403, nothing removed', r.status === 403 && (await call(a.token, 'GET', `${base}/guarded`))?.channel_ids?.length === 1)
  await call(a.token, 'DELETE', `/channels/${guarded.category_id}/permissions/${mrole.id}`)
  const kid = guarded.channel_ids[0]
  await call(a.token, 'PUT', `/channels/${kid}/permissions/${mrole.id}`, { kind: 'role', allow: 0, deny: MANAGE_CH })
  await call(a.token, 'DELETE', `/channels/${kid}/permissions/${mrole.id}`)
  ok('with the overwrites gone the member still cannot delete it, only the owner can', (await raw(cm.token, 'DELETE', `${base}/guarded`)).status === 403 && (await raw(a.token, 'DELETE', `${base}/guarded`)).status === 204)
}

console.log('-- renaming the backing category')
{
  const ren = await (await raw(a.token, 'POST', base, { slug: 'ren', name: 'Ren' })).json()
  r = await raw(a.token, 'PATCH', `/channels/${ren.category_id}`, { name: 'Elsewhere' })
  ok('renaming a category that backs a community is refused', r.status === 400 && JSON.stringify(await r.json()).includes('This category belongs to a community. Rename the community instead.'), String(r.status))
  ok('and the name did not change', (await call(a.token, 'GET', `${base}/ren`)).name === 'Ren' && (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((c) => c.id === ren.category_id).name === 'Ren')
  ok('other edits to it are still allowed', (await raw(a.token, 'PATCH', `/channels/${ren.category_id}`, { position: 7 })).status === 200 && (await raw(a.token, 'PATCH', `/channels/${ren.category_id}`, { name: 'Ren' })).status === 200)
  ok('an ordinary category still renames', await (async () => { const c = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'Plain', kind: 'category' }); return (await raw(a.token, 'PATCH', `/channels/${c.id}`, { name: 'Plainer' })).status === 200 })())
  await raw(a.token, 'DELETE', `${base}/ren`)
}

console.log('-- the last text channel')
{
  const g3 = await call(a.token, 'POST', '/guilds', { name: `Solo ${S}` })
  const b3 = `/guilds/${g3.id}/communities`
  const solo = await (await raw(a.token, 'POST', b3, { slug: 'solo', name: 'Solo' })).json()
  const general = g3.channels.find((c) => c.kind === 'text')
  ok('with a community chat in place the default text channel can go', (await raw(a.token, 'DELETE', `/channels/${general.id}`)).status === 204)
  r = await raw(a.token, 'DELETE', `${b3}/solo`)
  ok('deleting the community that holds the last text channel is 400 with the channel rule\'s message', r.status === 400 && JSON.stringify(await r.json()).includes('A server must keep at least one text channel'), String(r.status))
  ok('and nothing was removed', (await call(a.token, 'GET', `${b3}/solo`))?.channel_ids?.length === 1)
  await call(a.token, 'POST', `/guilds/${g3.id}/channels`, { name: 'lobby', kind: 'text' })
  ok('once another text channel exists it can be deleted', (await raw(a.token, 'DELETE', `${b3}/solo`)).status === 204)
  ok('a community with only voice channels never blocks', await (async () => { const v = await (await raw(a.token, 'POST', b3, { slug: 'voice', name: 'Voice', channels: [{ name: 'Lounge', kind: 'voice' }] })).json(); return v.channel_ids.length === 1 && (await raw(a.token, 'DELETE', `${b3}/voice`)).status === 204 })())
}

console.log('-- audit log')
{
  const au = await (await raw(a.token, 'POST', base, { slug: 'audited', name: 'Audited', channels: [{ name: 'one', kind: 'text' }, { name: 'two', kind: 'text' }] })).json()
  await raw(a.token, 'PATCH', `${base}/audited`, { name: 'Audited Two' })
  await raw(a.token, 'DELETE', `${base}/audited`)
  const log = await call(a.token, 'GET', `/guilds/${g.id}/audit?action=community.`)
  const rows = (Array.isArray(log) ? log : log.items ?? []).filter((e) => e.target_id === au.id)
  const by = (act) => rows.find((e) => e.action === act)
  ok('create, update and delete are logged for the community', !!by('community.create') && !!by('community.update') && !!by('community.delete'), rows.map((e) => e.action).join())
  ok('with actor, target and name', by('community.create')?.actor_id === a.user.id && by('community.create')?.target_kind === 'community' && by('community.create')?.target_name === 'Audited' && by('community.update')?.target_name === 'Audited Two')
  ok('delete records how many channels went', by('community.delete')?.details?.channels === 2, JSON.stringify(by('community.delete')?.details))
}

console.log('-- visibility changes send community events')
{
  const vis = await (await raw(a.token, 'POST', base, { slug: 'vis', name: 'Vis' })).json()
  const evs = []
  const sock = await new Promise((resolve) => { const w = new WebSocket(`${WS}?token=${b.token}`); w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'READY') resolve(w); else evs.push(m) } })
  const mine = () => evs.filter((m) => m.t.startsWith('COMMUNITY_') && (m.d?.id === vis.id))
  await call(a.token, 'PUT', `/channels/${vis.category_id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: 1024 })
  await new Promise((r2) => setTimeout(r2, 1200))
  ok('losing view of the category sends COMMUNITY_DELETE', mine().map((m) => m.t).join() === 'COMMUNITY_DELETE' && mine()[0].d.guild_id === g.id, JSON.stringify(mine()))
  await call(a.token, 'PUT', `/channels/${vis.category_id}/permissions/${g.id}`, { kind: 'role', allow: 1024, deny: 0 })
  await new Promise((r2) => setTimeout(r2, 1200))
  const got = mine().map((m) => m.t).join()
  ok('regaining it sends COMMUNITY_CREATE (slim form)', got === 'COMMUNITY_DELETE,COMMUNITY_CREATE' && mine()[1].d.slug === 'vis' && mine()[1].d.category_id === vis.category_id && !('follower_count' in mine()[1].d), got)
  sock.close()
  await raw(a.token, 'DELETE', `${base}/vis`)
}

console.log('-- joining carries communities')
{
  const j = await reg('joiner')
  const gj = await call(a.token, 'POST', '/guilds', { name: `Join ${S}` })
  await raw(a.token, 'POST', `/guilds/${gj.id}/communities`, { slug: 'one', name: 'One' })
  await raw(a.token, 'POST', `/guilds/${gj.id}/communities`, { slug: 'two', name: 'Two' })
  const hid2 = await (await raw(a.token, 'POST', `/guilds/${gj.id}/communities`, { slug: 'secret', name: 'Secret' })).json()
  await call(a.token, 'PUT', `/channels/${hid2.category_id}/permissions/${gj.id}`, { kind: 'role', allow: 0, deny: 1024 })
  const ji = await call(a.token, 'POST', `/guilds/${gj.id}/invites`, {})
  const evs = []
  const sock = await new Promise((resolve) => { const w = new WebSocket(`${WS}?token=${j.token}`); w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'READY') resolve(w); else evs.push(m) } })
  const resp = await call(j.token, 'POST', `/invites/${ji.code}`)
  await new Promise((r2) => setTimeout(r2, 800))
  const gc = evs.find((m) => m.t === 'GUILD_CREATE')?.d
  const slugs = (x) => (x?.communities ?? []).map((c) => c.slug).sort().join()
  ok('GUILD_CREATE carries the communities the member can view', slugs(gc) === 'one,two', slugs(gc))
  ok('and their follows (none for a fresh join)', Array.isArray(gc?.community_follows) && gc.community_follows.length === 0)
  ok('the join response carries them too', slugs(resp) === 'one,two' && Array.isArray(resp.community_follows))
  const sl = gc?.communities?.[0]
  ok('slim form', !!sl?.category_id && !('follower_count' in sl) && sl.guild_id === gj.id)
  sock.close()
}

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
const byBot = await r.json()
ok('a bot with Manage Channels can create a community, without following it', r.status === 201 && byBot.slug === 'by-bot' && byBot.following === false && byBot.follower_count === 0, JSON.stringify(byBot))
ok('a bot without Manage Channels gets 403', (await botPost(weak, { slug: 'nope', name: 'Nope' })).status === 403)
await finish()
