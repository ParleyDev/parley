// Activities set by hand ("Playing Factorio"): set from the status dialog, shown in the member list and on the
// profile with how long; changes and clears reach others live; offline, invisible and "Share my activity" off
// hide it, and it comes back with them.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Act ${S}` }); const ch = g.channels.find((c) => c.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch(); const errors = []
const mk = async (u) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector('textarea')
  return p
}
const until = async (f, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await Promise.resolve().then(f).catch(() => false)) return true; await new Promise((r) => setTimeout(r, 250)) } return false }

console.log('-- API')
ok('types are checked', (await raw(a.token, 'PUT', '/users/@me/activity', { type: 'sleeping', name: 'x' })).status === 400)
ok('names too', (await raw(a.token, 'PUT', '/users/@me/activity', { type: 'playing', name: ' ' })).status === 400)
ok('Spotify is left to the connection', (await raw(a.token, 'PUT', '/users/@me/activity', { type: 'listening', name: 'Spotify' })).status === 400)

console.log('-- setting it')
const pa = await mk(a), pb = await mk(b)
await pa.click('[data-panel-self]'); await pa.waitForTimeout(200); await pa.click('[data-set-status]'); await pa.waitForSelector('[data-custom-activity]')
await pa.selectOption('[data-activity-type-select]', 'playing'); await pa.fill('[data-activity-name-input]', `Factorio ${S}`); await pa.click('[data-activity-save]')
ok('the status dialog sets it', await until(async () => (await call(a.token, 'GET', '/users/@me')).custom_activity?.name === `Factorio ${S}`))
await pa.keyboard.press('Escape')
const line = pb.locator(`[data-member-row="${a.user.id}"] [data-member-activity]`)
ok('others see "Playing …" in the member list', await until(async () => (await line.innerText()).includes(`Playing Factorio ${S}`)), await line.innerText().catch(() => 'none'))
await pb.click(`[data-member-row="${a.user.id}"]`); await pb.waitForSelector('[data-activity="manual"]')
const card = await pb.locator('[data-activity="manual"]').innerText()
ok('the profile shows it with how long', card.includes('Playing') && card.includes(`Factorio ${S}`) && /just started|for 1 minute/.test(card), card)
await pb.keyboard.press('Escape')
await call(a.token, 'PUT', '/users/@me/activity', { type: 'watching', name: 'The Expanse' })
ok('a change shows live', await until(async () => (await line.innerText()).includes('Watching The Expanse')))

console.log('-- privacy')
await call(a.token, 'PATCH', '/users/@me/privacy', { share_activity: false })
ok('"Share my activity" off hides it', await until(async () => (await line.count()) === 0))
await call(a.token, 'PATCH', '/users/@me/privacy', { share_activity: true })
ok('on again shows it', await until(async () => (await line.count()) === 1))
await call(a.token, 'PATCH', '/users/@me', { status: 'invisible' })
ok('invisible hides it', await until(async () => (await line.count()) === 0))
await call(a.token, 'PATCH', '/users/@me', { status: 'online' })
ok('and back', await until(async () => (await line.count()) === 1))
await pa.context().close()
ok('offline hides it', await until(async () => (await line.count()) === 0, 30000))
const pa2 = await mk(a)
ok('coming back online brings it back', await until(async () => (await line.count()) === 1))
await pb.reload(); await pb.waitForSelector('textarea')
ok('fresh sessions get it from READY', await until(async () => (await line.count()) === 1, 3000))

console.log('-- clearing')
await pa2.click('[data-panel-self]'); await pa2.waitForTimeout(200); await pa2.click('[data-set-status]'); await pa2.waitForSelector('[data-activity-clear]')
await pa2.click('[data-activity-clear]')
ok('Clear activity removes it for everyone', await until(async () => (await line.count()) === 0))
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
