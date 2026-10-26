// Channels & Roles: Browse Channels (hide channels from your list), self-assignable roles, and onboarding questions
// whose answers grant roles and show channels.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Cust ${S}` })
const ch = g.channels.find((x) => x.kind === 'text')
const art = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'art-room', kind: 'text' })
const games = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'games-room', kind: 'text' })
const artist = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Artist' })
const gamer = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Gamer' })
const mod = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Mod', permissions: 1 << 13 })

console.log('-- api')
const bad = await raw(a.token, 'PATCH', `/guilds/${g.id}/roles/${mod.id}`, { self_assignable: true })
ok('a role with moderation powers can\'t be self-assignable', bad.status === 400, bad.status)
await call(a.token, 'PATCH', `/guilds/${g.id}/roles/${artist.id}`, { self_assignable: true })
const badOb = await raw(a.token, 'PUT', `/guilds/${g.id}/onboarding`, { enabled: true, questions: [{ title: 'x', options: [{ label: 'y', role_ids: [mod.id] }] }] })
ok('onboarding answers can\'t grant moderation roles', badOb.status === 400, badOb.status)
const ob = await call(a.token, 'PUT', `/guilds/${g.id}/onboarding`, { enabled: true, questions: [
  { title: 'What are you into?', multi: true, required: true, options: [{ label: 'Gaming', emoji: '🎮', role_ids: [gamer.id], channel_ids: [games.id] }, { label: 'Art', emoji: '🎨', role_ids: [], channel_ids: [art.id] }] },
] })
ok('questions get ids', !!ob.questions[0].id && !!ob.questions[0].options[0].id)
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
// Joined with games and art hidden; the answer should show games again.
await call(b.token, 'PUT', `/guilds/${g.id}/me/hidden-channels`, { channel_ids: [games.id, art.id] })
const notSelf = await raw(b.token, 'PUT', `/guilds/${g.id}/me/roles/${gamer.id}`)
ok('roles that aren\'t self-assignable are refused', notSelf.status === 403, notSelf.status)

const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message))
await p.goto(`${WEB}/login`); await p.evaluate(([t, gid]) => { localStorage.setItem('parley.token', t); localStorage.setItem('parley.welcomePending', JSON.stringify([gid])) }, [b.token, g.id])

console.log('-- onboarding')
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`)
await p.waitForSelector('[data-onboarding-modal]', { timeout: 8000 }).catch(() => {})
ok('just joined: the onboarding questions open', await p.locator('[data-onboarding-modal]').count() === 1)
ok('a required question can\'t be skipped', await p.locator('[data-onboarding-skip]').count() === 0 && await p.locator('[data-onboarding-next]').isDisabled())
await p.click('[data-onboarding-option="Gaming"]'); await p.click('[data-onboarding-next]'); await p.waitForTimeout(800)
const me = (await call(b.token, 'GET', `/guilds/${g.id}/members`)).find((m) => m.user_id === b.user.id)
ok('the answer granted its role', me.roles.includes(gamer.id))
const cust = await call(b.token, 'GET', `/guilds/${g.id}/me/customize`)
ok('and showed its channel', cust.onboarded && !cust.hidden_channels.includes(games.id) && cust.hidden_channels.includes(art.id), JSON.stringify(cust))
ok('games-room is in the list, art-room is not', await p.locator('[data-channel-row="games-room"]').count() === 1 && await p.locator('[data-channel-row="art-room"]').count() === 0)
await p.reload(); await p.waitForTimeout(1200)
ok('onboarding doesn\'t come back', await p.locator('[data-onboarding-modal]').count() === 0)

console.log('-- browse channels')
await p.locator(`button:has-text("Cust ${S}")`).first().click(); await p.click('text=Browse Channels'); await p.waitForSelector('[data-browse-channels]')
await p.locator(`[data-browse-channel="${art.id}"] input`).click(); await p.waitForTimeout(500)
ok('ticking a channel shows it', await p.locator('[data-channel-row="art-room"]').count() === 1)
await p.locator(`[data-browse-channel="${games.id}"] input`).click(); await p.waitForTimeout(500)
ok('unticking hides it', await p.locator('[data-channel-row="games-room"]').count() === 0 && (await call(b.token, 'GET', `/guilds/${g.id}/me/customize`)).hidden_channels.includes(games.id))

console.log('-- roles')
await p.click('[data-browse-tab="roles"]')
ok('only self-assignable roles are offered', await p.locator(`[data-browse-role="${artist.id}"]`).count() === 1 && await p.locator(`[data-browse-role="${mod.id}"]`).count() === 0)
await p.locator(`[data-browse-role="${artist.id}"] input`).click(); await p.waitForTimeout(600)
ok('picking a role gives it', (await call(b.token, 'GET', `/guilds/${g.id}/members`)).find((m) => m.user_id === b.user.id).roles.includes(artist.id))
await p.locator(`[data-browse-role="${artist.id}"] input`).click(); await p.waitForTimeout(600)
ok('and unpicking removes it', !(await call(b.token, 'GET', `/guilds/${g.id}/members`)).find((m) => m.user_id === b.user.id).roles.includes(artist.id))
await p.keyboard.press('Escape')

console.log('-- settings')
const pa = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); pa.on('pageerror', (x) => errors.push(x.message))
await pa.goto(`${WEB}/login`); await pa.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await pa.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pa.waitForTimeout(800)
await pa.locator(`button:has-text("Cust ${S}")`).first().click(); await pa.click('text=Server Settings'); await pa.locator('nav button:has-text("Onboarding"), button:has-text("Onboarding")').first().click()
await pa.waitForSelector('[data-onboarding-tab]', { timeout: 4000 }).catch(() => {})
ok('the Onboarding tab lists the saved question', await pa.locator('[data-onboarding-title="0"]').inputValue().catch(() => '') === 'What are you into?')
await pa.click('[data-onboarding-addq]'); await pa.fill('[data-onboarding-title="1"]', 'Where are you from?'); await pa.fill('[data-onboarding-label="1-0"]', 'Earth')
await pa.click('[data-onboarding-save]'); await pa.waitForTimeout(600)
const got = (await call(a.token, 'GET', `/guilds/${g.id}`)).onboarding
ok('saving adds the new question', got.questions.length === 2 && got.questions[1].options[0].label === 'Earth', JSON.stringify(got))

ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
