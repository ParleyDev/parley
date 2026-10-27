// Two tabs on different accounts (web only: the token lives in localStorage, shared by every tab). Switching in one
// tab moves the others to the same account, and a reconnect (a deploy restarting the server) must never save one
// account under another's token, which showed both as current in the switcher and made switching do nothing.
import { execSync } from 'node:child_process'
import { WEB, PASSWORD, reg, ok, finish, launchBrowser, testContainer } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const browser = await launchBrowser(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const tab = async () => { const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); return p }
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('parley.accounts') || '[]').map((x) => ({ u: x.username, t: x.token })))
const panelName = (p) => p.locator('[data-panel-self] .text-\\[16px\\]').innerText()
const consistent = (list) => list.length === 2 && new Set(list.map((x) => x.t)).size === 2 && list.find((x) => x.u === a.user.username)?.t === a.token

const p1 = await tab()
await p1.goto(`${WEB}/login`); await p1.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p1.goto(`${WEB}/channels/@me`); await p1.waitForSelector('[data-panel-self]'); await p1.waitForTimeout(800)
// A second tab adds bob, the way people do: Add an account, then log in.
const p2 = await tab()
await p2.goto(`${WEB}/channels/@me`); await p2.waitForSelector('[data-panel-self]')
await p2.click('[data-panel-self]'); await p2.click('[data-account-add]'); await p2.waitForSelector('[data-login-input]')
await p2.fill('[data-login-input]', b.user.username); await p2.fill('input[type=password]', PASSWORD); await p2.click('button:has-text("Log In")')
await p2.waitForSelector('[data-panel-self]'); await p2.waitForTimeout(1500)
ok('second tab is bob', await panelName(p2) === 'Bob')
ok('the first tab follows to bob instead of acting as alice on bob\'s session', await p1.waitForFunction(() => document.querySelector('[data-panel-self]')?.textContent?.includes('Bob'), null, { timeout: 8000 }).then(() => true).catch(() => false))
ok('both saved with their own tokens', consistent(await saved(p2)), JSON.stringify(await saved(p2)))

// The server restarts (a deploy): every tab reconnects and gets a fresh READY.
execSync(`docker restart ${testContainer('backend')}`)
await p1.waitForTimeout(9000)
ok('after a reconnect, still one token per account', consistent(await saved(p1)), JSON.stringify(await saved(p1)))
await p2.click('[data-panel-self]'); await p2.waitForSelector('[data-account-switcher]')
ok('the switcher marks only one account as current', await p2.locator('[data-account-switcher] svg.text-success').count() === 1)
await p2.click(`[data-account-switcher] [data-account-row="${a.user.username}"] button >> nth=0`)
await p2.waitForFunction(() => document.querySelector('[data-panel-self]')?.textContent?.includes('Alice'), null, { timeout: 10000 }).catch(() => {})
ok('switching to alice works', await panelName(p2) === 'Alice', await panelName(p2))
ok('and the other tab comes along', await p1.waitForFunction(() => document.querySelector('[data-panel-self]')?.textContent?.includes('Alice'), null, { timeout: 8000 }).then(() => true).catch(() => false))
// Lists already broken by older builds (alice saved under bob's token) repair themselves on the next READY.
await p2.evaluate(([a, b, tok]) => { localStorage.setItem('parley.token', tok); localStorage.setItem('parley.accounts', JSON.stringify([{ ...a, token: tok }, { ...b, token: tok }])) }, [{ id: a.user.id, username: a.user.username, display_name: 'Alice', avatar_url: null }, { id: b.user.id, username: b.user.username, display_name: 'Bob', avatar_url: null }, b.token])
await p2.reload(); await p2.waitForSelector('[data-panel-self]'); await p2.waitForTimeout(1500)
const healed = await saved(p2)
ok('a broken list keeps bob and drops the entry holding his token under alice\'s name', healed.length === 1 && healed[0].u === b.user.username, JSON.stringify(healed.map((x) => x.u)))
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
