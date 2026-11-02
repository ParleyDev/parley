// Coming back to a channel with unread messages: "N new messages since …" over the top of the chat (tap to jump,
// ✕ / Mark As Read to dismiss) and the NEW MESSAGES divider; on phones the update banner is a full-size bar.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Unread ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const ch = g.channels.find((x) => x.kind === 'text')
const other = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'elsewhere', kind: 'text' })
for (let i = 0; i < 30; i++) await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: `old message ${i}` })
const browser = await chromium.launch(); const errors = []

/** Alice reads the channel, goes elsewhere, bob posts `n` more, alice comes back. */
async function comeBack(p, n) {
  await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector('[data-msg-id]'); await p.waitForTimeout(1200)
  await p.goto(`${WEB}/channels/${g.id}/${other.id}`); await p.waitForTimeout(800)
  for (let i = 0; i < n; i++) await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: `fresh message ${i}` })
  await p.waitForTimeout(500)
  await p.goto(`${WEB}/channels/${g.id}/${ch.id}`)
  await p.waitForSelector('[data-unread-divider]', { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(500)
}
const login = async (ctxOpts) => {
  const ctx = await browser.newContext(ctxOpts); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
  return p
}

console.log('-- phone')
const pp = await login({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await comeBack(pp, 9)
const banner = pp.locator('[data-unread-banner]')
ok('phone: a banner says how many are new and since when', /^9 new messages since \d{1,2}:\d{2}/.test(await banner.innerText()), await banner.innerText().catch(() => ''))
const bb = await banner.boundingBox()
ok('phone: it runs edge to edge across the top of the chat, tall enough to tap', bb && bb.x === 0 && bb.width >= 389 && bb.height >= 40, JSON.stringify(bb))
ok('phone: the divider reads NEW MESSAGES between two lines', /new messages/i.test(await pp.locator('[data-unread-divider]').innerText()) && await pp.locator('[data-unread-divider] .bg-danger').count() === 2)
await pp.screenshot({ path: 'unread-phone.png' })
await pp.evaluate(() => { const l = document.querySelector('[data-message-list]'); l.scrollTop = 0 }); await pp.waitForTimeout(300)
await pp.locator('[data-unread-jump]').tap(); await pp.waitForTimeout(900)
const div = await pp.locator('[data-unread-divider]').boundingBox()
ok('phone: tapping the banner jumps to the first new message', div && div.y > 0 && div.y < 844, JSON.stringify(div))
await pp.locator('[data-unread-dismiss]').tap()
ok('phone: ✕ dismisses it', await banner.count() === 0)
ok('phone: the divider stays', await pp.locator('[data-unread-divider]').count() === 1)
await comeBack(pp, 40)
ok('phone: back with 40 more, the banner is up', await banner.count() === 1)
const atBottom = () => pp.evaluate(() => { const l = document.querySelector('[data-message-list]'); return l.scrollHeight - l.scrollTop - l.clientHeight < 40 })
ok('phone: (the newest messages are below the fold)', !(await atBottom()))
for (let i = 0; i < 12 && !(await atBottom()); i++) { await pp.mouse.move(200, 500); await pp.mouse.wheel(0, 600); await pp.waitForTimeout(150) }
await pp.waitForTimeout(1200)
ok('phone: reading down to the newest message clears the banner', await banner.count() === 0)
ok('phone: the divider still marks where they were', await pp.locator('[data-unread-divider]').count() === 1)

console.log('-- update banner on phones')
const built = await fetch(`${WEB}/version.json`).then((r) => r.ok ? r.json() : null).then((j) => j?.version ?? 'dev').catch(() => 'dev')
if (built !== 'dev') {
  await pp.route('**/version.json*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '9.9.9' }) }))
  await pp.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pp.waitForSelector('[data-update-banner]', { timeout: 5000 }).catch(() => {})
  const ub = await pp.locator('[data-update-banner]').boundingBox(), rb = await pp.locator('[data-update-reload]').boundingBox()
  const size = await pp.locator('[data-update-banner]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  ok('phone: the update banner is a full-size bar with readable text', ub && ub.height >= 48 && size >= 15, JSON.stringify({ ub, size }))
  ok('phone: Reload is thumb-sized', rb && rb.height >= 40, JSON.stringify(rb))
  await pp.screenshot({ path: 'update-phone.png' })
} else console.log('  (dev build: no version to compare, update banner skipped)')

await pp.context().close()

console.log('-- desktop')
const pd = await login({ viewport: { width: 1440, height: 900 } })
await comeBack(pd, 1)
ok('desktop: one new message reads in the singular', /^1 new message since/.test(await pd.locator('[data-unread-banner]').innerText().catch(() => '')), await pd.locator('[data-unread-banner]').innerText().catch(() => ''))
ok('desktop: Mark As Read dismisses it', /Mark As Read/.test(await pd.locator('[data-unread-dismiss]').innerText()))
ok('desktop: the divider ends in a NEW tag', (await pd.locator('[data-unread-divider]').innerText()).trim() === 'NEW' || /^new$/i.test((await pd.locator('[data-unread-divider]').innerText()).trim()))
await pd.screenshot({ path: 'unread-desktop.png' })
await pd.click('[data-unread-dismiss]')
ok('desktop: and it is gone', await pd.locator('[data-unread-banner]').count() === 0)
await pd.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pd.waitForSelector('[data-msg-id]'); await pd.waitForTimeout(1200)
ok('no banner when nothing is unread', await pd.locator('[data-unread-banner]').count() === 0)
await comeBack(pd, 2)
ok('desktop: two new messages that fit on screen: the banner shows', await pd.locator('[data-unread-banner]').count() === 1)
await pd.waitForTimeout(4500)
ok('desktop: and goes by itself once they have been on screen a few seconds', await pd.locator('[data-unread-banner]').count() === 0 && await pd.locator('[data-unread-divider]').count() === 1)

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
