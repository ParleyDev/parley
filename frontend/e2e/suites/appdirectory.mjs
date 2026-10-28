// User-installable apps (their commands work for you anywhere) and the App Directory.
import { chromium } from 'playwright'
import { B, H, WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const WS = B.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws'
const dev = await reg('dev'), u = await reg('user'), f = await reg('friend'), o = await reg('owner')
await call(u.token, 'POST', '/users/@me/relationships', { user_id: f.user.id }); await call(f.token, 'PUT', `/users/@me/relationships/${u.user.id}`)
const app = await call(dev.token, 'POST', '/applications', { name: `Dice ${S}`, description: 'Rolls dice for you' })
const bot = await call(dev.token, 'POST', `/applications/${app.id}/bot`, {})
await fetch(`${B}/applications/${app.id}/commands`, { method: 'PUT', headers: { ...H, Authorization: 'Bot ' + bot.token }, body: JSON.stringify([{ name: 'roll', description: 'Roll a die' }]) })
const ws = await new Promise((resolve) => { const w = new WebSocket(`${WS}?token=${bot.token}`); w.onmessage = (e) => { if (JSON.parse(e.data).t === 'READY') resolve(w) } })
ws.onmessage = async (e) => { const ev = JSON.parse(e.data); if (ev.t !== 'INTERACTION_CREATE') return; await fetch(`${B}/interactions/${ev.d.id}/${ev.d.token}/callback`, { method: 'POST', headers: H, body: JSON.stringify({ type: 4, data: { content: `rolled a 4 for ${ev.d.user.display_name}` } }) }) }

console.log('-- directory')
ok('unlisted apps stay out of the directory', !(await call(u.token, 'GET', `/app-directory?q=${encodeURIComponent(`Dice ${S}`)}`)).length)
await call(dev.token, 'PATCH', `/applications/${app.id}`, { listed: true, tags: ['Games', 'fun'], install_permissions: String((1 << 10) | (1 << 11)) })
const found = await call(u.token, 'GET', `/app-directory?q=${encodeURIComponent(`Dice ${S}`)}`)
ok('listed public apps show up, with tags and commands', found.length === 1 && found[0].tags.includes('games') && found[0].commands === 1)
ok('and can be filtered by tag', (await call(u.token, 'GET', `/app-directory?q=${encodeURIComponent(`Dice ${S}`)}&tag=music`)).length === 0)

const browser = await chromium.launch(); const errors = []
const ctx = async (t) => { const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t); return p }
const pu = await ctx(u.token)
await pu.goto(`${WEB}/app-directory`); await pu.fill('[data-app-search]', `Dice ${S}`); await pu.waitForSelector(`[data-directory-app="${app.id}"]`)
ok('the directory page lists it', (await pu.locator(`[data-directory-app="${app.id}"]`).innerText()).includes('Rolls dice'))
await pu.click(`[data-directory-add-me="${app.id}"]`); await pu.waitForSelector('[data-oauth-page]')
await pu.click('[data-oauth-approve]'); await pu.waitForSelector('[data-oauth-installed]')
ok('Add to My Apps installs it to your account', (await call(u.token, 'GET', '/users/@me/app-installs')).some((a) => a.id === app.id))

console.log('-- anywhere')
const dm = await call(u.token, 'POST', '/users/@me/channels', { recipient_id: f.user.id })
const cmds = await call(u.token, 'GET', `/channels/${dm.id}/commands`)
ok('its commands work in a DM without the bot', cmds.some((c) => c.name === 'roll' && c.user_installed))
ok('but not for people who didn\'t install it', !(await call(f.token, 'GET', `/channels/${dm.id}/commands`)).some((c) => c.name === 'roll'))
await pu.goto(`${WEB}/channels/@me/${dm.id}`); await pu.waitForSelector('textarea[placeholder^="Message"]')
await pu.locator('textarea[placeholder^="Message"]').fill('/roll '); await pu.locator('textarea[placeholder^="Message"]').press('Enter')
await pu.waitForSelector('text=rolled a 4', { timeout: 5000 }).catch(() => {})
ok('using it in a DM answers there', await pu.locator('[data-message-list] [data-msg-id]:has-text("rolled a 4")').count() === 1)
const g = await call(o.token, 'POST', '/guilds', { name: `Other ${S}` }); const inv = await call(o.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(u.token, 'POST', `/invites/${inv.code}`)
const gch = g.channels.find((x) => x.kind === 'text')
await pu.goto(`${WEB}/channels/${g.id}/${gch.id}`); await pu.waitForSelector('textarea[placeholder^="Message"]')
await pu.locator('textarea[placeholder^="Message"]').fill('/roll '); await pu.locator('textarea[placeholder^="Message"]').press('Enter')
await pu.waitForSelector('[data-ephemeral]', { timeout: 5000 }).catch(() => {})
ok('in a server without the bot, the answer is only for you', await pu.locator('[data-msg-id]:has([data-ephemeral])').count() === 1 && !(await call(o.token, 'GET', `/channels/${gch.id}/messages`)).some((m) => m.content.includes('rolled')))
await pu.goto(`${WEB}/channels/@me`); await pu.click('[data-control="User Settings"]'); await pu.locator('button:has-text("Authorized Apps")').first().click()
await pu.waitForSelector(`[data-installed-app="${app.id}"]`)
await pu.click(`[data-uninstall-app="${app.id}"]`); await pu.waitForTimeout(500)
ok('removing it from My Apps', !(await call(u.token, 'GET', '/users/@me/app-installs')).length && !(await call(u.token, 'GET', `/channels/${dm.id}/commands`)).some((c) => c.name === 'roll'))
ok('no page errors', errors.length === 0, errors.join(' | '))
ws.close()
await call(o.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
