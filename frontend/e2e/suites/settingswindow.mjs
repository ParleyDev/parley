// User settings as Discord's settings window: you and Edit Profiles at the top, a search box, pages with icons in
// groups, the Account page in sections (listed and followed in the sidebar), no profile card on it any more, rows
// with Edit buttons, and Logged-in Devices linking to Devices.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice')
const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('[data-control="User Settings"]'); await p.waitForTimeout(600)
await p.click('[data-control="User Settings"]'); await p.waitForSelector('[data-settings-window] [data-account-page]')

console.log('-- layout')
ok('a window with margin around it, not the whole screen', await p.evaluate(() => { const w = document.querySelector('[data-settings-nav]').parentElement.getBoundingClientRect(); return w.top >= 12 && w.left >= 12 }))
ok('you at the top with Edit Profiles', (await p.locator('[data-settings-me]').innerText()).includes('Alice') && await p.locator('[data-settings-edit-profiles]').count() === 1)
ok('Account opens first, titled in the bar', (await p.textContent('[data-settings-title]')) === 'Account')
ok('no profile card on the Account page any more', await p.locator('[data-account-page] [data-profile-card]').count() === 0)
ok('its sections are listed under Account', await p.locator('[data-settings-subs] [data-settings-sub]').count() === 6)
ok('rows with Edit buttons for display name, username, email and password', await p.locator('[data-account-page] [data-account-row] button:has-text("Edit")').count() === 4)

console.log('-- sections')
await p.click('[data-settings-sub="status"]'); await p.waitForTimeout(700)
ok('picking a section scrolls to it', await p.evaluate(() => { const b = document.querySelector('[data-settings-body]'), s = document.querySelector('[data-settings-section-id="status"]'); return Math.abs(s.getBoundingClientRect().top - b.getBoundingClientRect().top) < 60 }))
ok('and marks it', await p.locator('[data-settings-sub="status"][aria-current="true"]').count() === 1)
await p.evaluate(() => { const b = document.querySelector('[data-settings-body]'); b.scrollTo({ top: 0 }) }); await p.waitForTimeout(300)
ok('scrolling back follows along', await p.locator('[data-settings-sub="account-info"][aria-current="true"]').count() === 1)

console.log('-- display name in place')
await p.click('[data-display-name-edit]'); await p.fill('[data-display-name-input]', `Ally ${S}`); await p.click('[data-display-name-save]')
await p.waitForSelector('[data-display-name-edit]')
ok('saves without leaving the page', (await call(a.token, 'GET', '/users/@me')).display_name === `Ally ${S}` && await p.locator('[data-settings-window]').count() === 1)

console.log('-- devices and search')
await p.click('[data-open-devices]')
ok('Logged-in Devices opens Devices', (await p.textContent('[data-settings-title]')) === 'Devices')
await p.fill('[data-settings-search]', 'passkey')
ok('search finds pages by what is on them', await p.locator('[data-settings-nav] [data-settings-tab]').count() === 1 && await p.locator('[data-settings-nav] [data-settings-tab="account"]').count() === 1)
await p.keyboard.press('Enter')
ok('Enter opens the match', (await p.textContent('[data-settings-title]')) === 'Account' && (await p.inputValue('[data-settings-search]')) === '')
await p.fill('[data-settings-search]', 'zzzz-nothing')
ok('and says when nothing matches', await p.locator('[data-settings-no-results]').count() === 1)
await p.fill('[data-settings-search]', '')
await p.click('[data-settings-edit-profiles]')
ok('Edit Profiles opens the profile editor', await p.waitForSelector('[data-profile-editor]').then(() => true).catch(() => false) && await p.locator('[data-settings-window]').count() === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
