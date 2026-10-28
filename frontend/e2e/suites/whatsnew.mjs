// What's New: release notes pop up once when a new entry lands (never on a device's first visit), and Settings
// opens them any time. House badges: pick one in the profile editor, it shows on your profile for everyone, click again to
// leave.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish, openProfileEditor } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `News ${S}` }); const ch = g.channels.find((c) => c.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector('textarea'); await p.waitForTimeout(1200)

console.log("-- what's new")
ok('a first visit gets no pop-up', await p.locator('[data-whats-new]').count() === 0)
const latest = await p.evaluate(() => localStorage.getItem('parley.whatsNewSeen'))
ok('but remembers the latest notes', !!latest)
await p.evaluate(() => localStorage.setItem('parley.whatsNewSeen', '2000-01-01')); await p.reload()
await p.waitForSelector('[data-whats-new]', { timeout: 8000 }).catch(() => {})
ok('a new entry pops up once', await p.locator(`[data-whats-new] [data-changelog-entry="${latest}"]`).count() === 1)
ok('newest first, with older ones below', await p.locator('[data-changelog-entry]').count() >= 2)
await p.click('[data-whats-new-close]'); await p.reload(); await p.waitForSelector('textarea'); await p.waitForTimeout(1200)
ok('and not again', await p.locator('[data-whats-new]').count() === 0)
// The link sits at the foot of the settings menu, where a toast can float over it on a slow machine.
await p.click('button[title="User Settings"]'); await p.locator('[data-whats-new-link]').evaluate((el) => el.click())
ok('Settings opens it any time', await p.locator('[data-whats-new]').isVisible())
await p.click('[data-whats-new-close]')

console.log('-- house badges')
ok('only the three houses', (await raw(a.token, 'PATCH', '/users/@me', { house: 'slytherin' })).status === 400)
await openProfileEditor(p, { section: 'badges' }); await p.waitForSelector('[data-house-picker]')
await p.click('[data-house-option="ember"]')
await p.waitForSelector('[data-house-option="ember"][aria-pressed="true"]', { timeout: 5000 }).catch(() => {})
ok('picking a house saves it', await p.locator('[data-house-option="ember"][aria-pressed="true"]').count() === 1 && (await call(a.token, 'GET', '/users/@me')).house === 'ember')
ok('others see the badge on the profile', (await call(b.token, 'GET', `/users/${a.user.id}`)).badges.includes('house_ember'))
await p.click('[data-house-option="tide"]'); await p.waitForSelector('[data-house-option="tide"][aria-pressed="true"]', { timeout: 5000 }).catch(() => {})
ok('one house at a time', (await call(b.token, 'GET', `/users/${a.user.id}`)).badges.filter((x) => x.startsWith('house_')).join() === 'house_tide')
await p.click('[data-house-option="tide"]'); await p.waitForSelector('[data-house-option="tide"][aria-pressed="false"]', { timeout: 5000 }).catch(() => {})
ok('clicking it again leaves', !(await call(b.token, 'GET', `/users/${a.user.id}`)).badges.some((x) => x.startsWith('house_')))
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
