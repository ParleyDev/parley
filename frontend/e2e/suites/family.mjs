// Family Center: a teen makes a one-time code (text and QR); an adult enters it and sees the teen's week (servers
// joined, friends added, who they messaged and how often — no message content); the teen sees the same; strangers
// see nothing; either side unlinks. Codes only come from teens, and only adults can use them.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const teen = await reg('teen'), parent = await reg('parent'), stranger = await reg('stranger'), unknown = await reg('unknown'), pal = await reg('pal')
const ago = (y) => { const d = new Date(); d.setFullYear(d.getFullYear() - y); return d.toISOString().slice(0, 10) }
await call(teen.token, 'PUT', '/users/@me/birthdate', { birthdate: ago(15) })
for (const u of [parent, stranger, pal]) await call(u.token, 'PUT', '/users/@me/birthdate', { birthdate: ago(40) })

console.log('-- codes')
ok('adults do not make codes', (await raw(parent.token, 'POST', '/family/code', {})).status === 400)
ok('without a birthday it says to add one', /birthday/.test(JSON.stringify(await (await raw(unknown.token, 'POST', '/family/code', {})).json())))
ok('a wrong code is refused', (await raw(parent.token, 'POST', '/family/links', { code: 'NOPE2345' })).status === 400)

console.log("-- the teen's week")
const g = await call(pal.token, 'POST', '/guilds', { name: `Hangout ${S}` }); const ch = g.channels.find((c) => c.kind === 'text')
const inv = await call(pal.token, 'POST', `/invites`.replace('/invites', `/guilds/${g.id}/invites`), {}); await call(teen.token, 'POST', `/invites/${inv.code}`)
await call(teen.token, 'POST', '/users/@me/relationships', { user_id: pal.user.id }); await call(pal.token, 'PUT', `/users/@me/relationships/${teen.user.id}`)
const dm = await call(teen.token, 'POST', '/users/@me/channels', { recipient_id: pal.user.id })
for (const m of ['secret one', 'secret two', 'secret three']) await call(teen.token, 'POST', `/channels/${dm.id}/messages`, { content: `${m} ${S}` })
for (const m of ['hi all', 'hello']) await call(teen.token, 'POST', `/channels/${ch.id}/messages`, { content: m })

const browser = await chromium.launch(); const errors = []
const mk = async (u, path = '/channels/@me') => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}${path}`); await p.waitForTimeout(1500)
  return p
}
const pt = await mk(teen)
await pt.click('button[title="User Settings"]'); await pt.click('[data-settings-tab="family"]'); await pt.waitForSelector('[data-family-role="teen"]')
await pt.click('[data-family-make-code]'); await pt.waitForSelector('[data-family-code]')
const code = await pt.locator('[data-family-code]').getAttribute('data-family-code')
ok('the teen gets a code with a QR', /^[A-Z2-9]{8}$/.test(code) && await pt.locator('[data-family-code] img').count() === 1)
ok('teens cannot link to someone', (await raw(teen.token, 'POST', '/family/links', { code })).status === 400)

console.log('-- the parent')
// Scanning the QR opens Family Center with the code filled in.
const pp = await mk(parent, `/channels/@me?family=${code}`)
await pp.waitForSelector('[data-family-role="adult"]')
ok('the QR link opens Family Center with the code', await pp.inputValue('[data-family-code-input]') === code)
await pp.click('[data-family-link]')
await pp.waitForSelector(`[data-family-teen="${teen.user.id}"] [data-family-summary]`)
const sum = pp.locator(`[data-family-teen="${teen.user.id}"]`)
ok('the parent sees the server joined', await sum.locator('[data-family-servers="1"]').count() === 1 && (await sum.innerText()).includes(`Hangout ${S}`))
ok('the friend added', await sum.locator('[data-family-friends="1"]').count() === 1)
ok('and who they messaged, with how many', await sum.locator('[data-family-messaged="1"]').count() === 1 && (await sum.locator('[data-family-messaged]').innerText()).includes('3 messages'))
ok('plus the totals', await sum.locator('[data-family-totals="3,2"]').count() === 1)
const json = JSON.stringify(await call(parent.token, 'GET', `/family/teens/${teen.user.id}/summary`))
ok('never what was said', !json.includes('secret') && !json.includes('hello'))
ok('the code works once', (await raw(stranger.token, 'POST', '/family/links', { code })).status === 400)
ok('strangers see nothing', (await raw(stranger.token, 'GET', `/family/teens/${teen.user.id}/summary`)).status === 404)

console.log('-- the teen sees it too')
await pt.waitForSelector(`[data-family-unlink="${parent.user.id}"]`, { timeout: 5000 }).catch(() => {})
ok('the teen sees the linked parent, live', await pt.locator(`[data-family-unlink="${parent.user.id}"]`).count() === 1)
ok('and the same summary of themselves', await pt.locator('[data-family-totals="3,2"]').count() === 1)
await pt.click(`[data-family-unlink="${parent.user.id}"]`)
ok('unlinking from the teen side ends it for both', await pp.waitForFunction((id) => !document.querySelector(`[data-family-teen="${id}"]`), teen.user.id, { timeout: 5000 }).then(() => true).catch(() => false))
ok('and the summary closes', (await raw(parent.token, 'GET', `/family/teens/${teen.user.id}/summary`)).status === 404)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(pal.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
