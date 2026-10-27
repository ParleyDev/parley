// Stage discovery and stage moderators: live stages (someone speaking) in your servers and in Discover servers whose
// stage @everyone can see, joinable from Discover › Stages; stage moderators (Mute + Move Members on the stage, set
// from Channel Settings › Stage Moderators) join as speakers and run the stage without Manage Channels.
import { chromium } from 'playwright'
import { B, WEB, S, reg, call, raw, ok, finish, adminToken } from '../lib.mjs'
const WS = B.replace(/^http/, 'ws').replace(/\/api$/, '/ws')
const admin = await adminToken()
const host = await reg('host'), mod = await reg('mod'), fan = await reg('fan'), outsider = await reg('outsider')
const g = await call(host.token, 'POST', '/guilds', { name: `Talks ${S}` })
const stage = await call(host.token, 'POST', `/guilds/${g.id}/channels`, { name: 'Main Stage', kind: 'stage' })
await call(host.token, 'PATCH', `/channels/${stage.id}`, { topic: `Ask me anything ${S}` })
const inv = await call(host.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const u of [mod, fan]) await call(u.token, 'POST', `/invites/${inv.code}`)
await call(host.token, 'PUT', `/guilds/${g.id}/discovery`, { description: 'Weekly talks and Q&As for testing.', category: 'education' })
await raw(admin.token, 'POST', `/admin/discovery/${g.id}/review`, { status: 'approved' })
const sock = (tok) => new Promise((res) => { const w = new WebSocket(`${WS}?token=${tok}`); const ev = []; w.onmessage = (m) => ev.push(JSON.parse(m.data)); w.onopen = () => setTimeout(() => res({ w, ev }), 300) })
const join = async (s) => { s.w.send(JSON.stringify({ op: 'voice_join', channel_id: stage.id, e2ee: true })); await new Promise((r) => setTimeout(r, 600)) }
const mine = (s, uid) => s.ev.filter((e) => e.t === 'VOICE_STATE_UPDATE' && e.d.user_id === uid && e.d.channel_id === stage.id).at(-1)?.d
const live = async (u) => (await call(u.token, 'GET', '/discover/stages')).find((x) => x.channel.id === stage.id)

console.log('-- discovery')
ok('an empty stage isn\'t listed', !(await live(fan)))
const sf = await sock(fan.token); await join(sf)
ok('nor one with only an audience', !(await live(fan)) && mine(sf, fan.user.id)?.suppress === true)
const sh = await sock(host.token); await join(sh)
let l = await live(fan)
ok('with someone speaking it is live, for members', l && l.member === true && l.speaker_count === 1 && l.listeners === 2 && l.channel.topic === `Ask me anything ${S}` && l.speakers[0].id === host.user.id, JSON.stringify(l))
l = await live(outsider)
ok('and for anyone, since the server is in Discover', l && l.member === false && l.guild.name === `Talks ${S}`)
await call(host.token, 'PUT', `/channels/${stage.id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: 1 << 10 })
ok('a private stage is only listed for members who can see it', !(await live(outsider)) && !!(await live(host)))
await call(host.token, 'DELETE', `/channels/${stage.id}/permissions/${g.id}`)
await join(sf) // hiding the stage moved the audience out

console.log('-- stage moderators')
ok('without moderator rights, members can\'t bring people up', (await raw(fan.token, 'PUT', `/channels/${stage.id}/stage/speakers/${fan.user.id}`)).status === 403)
const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), host.token)
await p.goto(`${WEB}/channels/${g.id}/${stage.id}`); await p.waitForTimeout(1200)
await p.locator(`[data-channel-item] a[href$="${stage.id}"]`).first().click({ button: 'right' }); await p.click('[data-context-menu] [data-menu-item="Edit Channel"]')
await p.locator('button:has-text("Stage Moderators")').first().click(); await p.waitForSelector('[data-stage-mods]')
await p.selectOption('[data-stage-mod-pick]', `member:${mod.user.id}`); await p.click('[data-stage-mod-add]')
await p.waitForSelector(`[data-stage-mod="${mod.user.id}"]`, { timeout: 5000 }).catch(() => {})
const ow = (await call(host.token, 'GET', `/guilds/${g.id}/channels`)).find((c) => c.id === stage.id).overwrites.find((o) => o.id === mod.user.id)
ok('Channel Settings › Stage Moderators grants Mute + Move Members on the stage', ow && (ow.allow & (1 << 22)) && (ow.allow & (1 << 24)), JSON.stringify(ow))
const sm = await sock(mod.token); await join(sm)
ok('a stage moderator joins as a speaker', mine(sm, mod.user.id)?.suppress === false)
{ const r = await raw(mod.token, 'PUT', `/channels/${stage.id}/stage/speakers/${fan.user.id}`); ok('and can invite someone up', r.status === 204, r.status + ' ' + await r.text()) }
ok('and move them back', (await raw(mod.token, 'DELETE', `/channels/${stage.id}/stage/speakers/${fan.user.id}`)).status === 204)
ok('but still can\'t edit the channel', (await raw(mod.token, 'PATCH', `/channels/${stage.id}`, { topic: 'x' })).status === 403)
await p.click(`[data-stage-mod-remove="${mod.user.id}"]`); await p.waitForTimeout(600)
ok('removing them takes the rights away', (await raw(mod.token, 'PUT', `/channels/${stage.id}/stage/speakers/${fan.user.id}`)).status === 403)
ok('permission changes don\'t lift the audience onto the stage', mine(sf, fan.user.id)?.suppress === true)

console.log('-- Discover › Stages')
const po = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); po.on('pageerror', (e) => errors.push(e.message))
await po.goto(`${WEB}/login`); await po.evaluate((t) => localStorage.setItem('parley.token', t), outsider.token)
await po.goto(`${WEB}/discover`); await po.click('[data-discover-stages]'); await po.waitForSelector(`[data-live-stage="${stage.id}"]`)
{ const card = await po.locator(`[data-live-stage="${stage.id}"]`).innerText(); ok('the stage shows as live with its topic and counts', card.includes(`Ask me anything ${S}`) && /2 speaking · 3 people/.test(card), card) }
await po.click(`[data-live-stage-open="${stage.id}"]`); await po.waitForURL(new RegExp(stage.id), { timeout: 8000 }).catch(() => {})
ok('Join Server & Listen joins and opens the stage', po.url().includes(stage.id) && (await call(host.token, 'GET', `/guilds/${g.id}/members`)).some((m) => m.user_id === outsider.user.id))
ok('no page errors', errors.length === 0, errors.join(' | '))
for (const s of [sf, sh, sm]) s.w.close()
await call(host.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
