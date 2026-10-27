// Account switcher: accounts signed in on this device are remembered, switching swaps sessions without logging
// anyone out, and logging out (or removing an entry) drops it from the list.
import { WEB, PASSWORD, reg, call, ok, finish, launchBrowser } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const browser = await launchBrowser(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
const saved = () => p.evaluate(() => JSON.parse(localStorage.getItem('parley.accounts') || '[]').map((x) => x.username))
const panelName = () => p.locator('[data-panel-self] .text-\\[16px\\]').innerText()
const openPanel = async () => { await p.click('[data-panel-self]'); await p.click('[data-switch-accounts]'); await p.waitForSelector('[data-account-switcher]') }

await p.goto(`${WEB}/login`); await p.waitForSelector('[data-login-input]')
ok('login page shows no saved accounts on a fresh device', await p.locator('[data-saved-accounts]').count() === 0)
await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('[data-panel-self]'); await p.waitForTimeout(800)
ok('signed-in account is remembered after READY', JSON.stringify(await saved()) === JSON.stringify([a.user.username]), JSON.stringify(await saved()))

await openPanel()
ok('self menu lists the current account (checked) and Add an account', await p.locator('[data-account-row]').count() === 1 && await p.locator('[data-account-add]').count() === 1)
await p.screenshot({ path: 'accounts-1-menu.png', clip: { x: 0, y: 300, width: 360, height: 500 } })
await p.click('[data-account-add]'); await p.waitForURL('**/login'); await p.waitForSelector('[data-saved-accounts]')
ok('Add an account goes to login and offers to continue as alice', await p.locator(`[data-saved-accounts] [data-account-row="${a.user.username}"]`).count() === 1)
ok('adding an account did not end alice\'s session', (await call(a.token, 'GET', '/users/@me')).id === a.user.id)
await p.fill('[data-login-input]', b.user.username); await p.fill('input[type=password]', PASSWORD); await p.click('button:has-text("Log In")')
await p.waitForSelector('[data-panel-self]'); await p.waitForTimeout(800)
ok('signed in as bob', await panelName() === 'Bob', await panelName())
ok('both accounts remembered, newest first', JSON.stringify(await saved()) === JSON.stringify([b.user.username, a.user.username]), JSON.stringify(await saved()))

await openPanel(); await p.screenshot({ path: 'accounts-2-two.png', clip: { x: 0, y: 300, width: 360, height: 500 } })
await p.click(`[data-account-row="${a.user.username}"] button >> nth=0`); await p.waitForURL('**/channels/@me'); await p.waitForSelector('[data-panel-self]'); await p.waitForTimeout(800)
ok('switching to alice needs no password', await panelName() === 'Alice', await panelName())
await openPanel(); await p.click(`[data-account-row="${b.user.username}"] button >> nth=0`); await p.waitForSelector('[data-panel-self]'); await p.waitForTimeout(800)
ok('and back to bob', await panelName() === 'Bob', await panelName())

await openPanel(); await p.click(`[data-account-row="${a.user.username}"] [data-account-forget]`)
ok('× removes alice from this device only', JSON.stringify(await saved()) === JSON.stringify([b.user.username]) && (await call(a.token, 'GET', '/users/@me')).id === a.user.id)
await p.keyboard.press('Escape'); await p.mouse.click(700, 300)
await p.click('[data-control="User Settings"]'); await p.locator('button[title="Log Out"]').evaluate((n) => n.click()); await p.waitForURL('**/login'); await p.waitForTimeout(300)
ok('logging out forgets bob too', (await saved()).length === 0 && await p.locator('[data-saved-accounts]').count() === 0)

// Connect screen (native shells): the hosted service is the default; a custom address is one tap away.
for (const shell of ['mobile', 'desktop']) {
  const c = await browser.newPage(); await c.goto(new URL(`../../../${shell}/www/index.html#switch`, import.meta.url).href)
  ok(`${shell}: hosted button shown, custom form hidden`, await c.locator('#hosted').isVisible() && !(await c.locator('#f').isVisible()))
  await c.click('#custom'); ok(`${shell}: "Use a different server" shows the address form`, await c.locator('#url').isVisible() && !(await c.locator('#hosted').isVisible()))
  await c.click('#back'); ok(`${shell}: back returns to the hosted option`, await c.locator('#hosted').isVisible())
  await c.close()
}
ok('no page errors', errors.length === 0, errors.join('|'))
await browser.close(); await finish()
