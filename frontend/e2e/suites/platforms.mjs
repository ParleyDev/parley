// Presence platforms: each socket says where it runs (web / desktop / mobile / vr); READY and PRESENCE_UPDATE carry the
// set; the avatar shows a phone when someone is only on mobile, a headset when only in VR, a dot otherwise.
import { chromium } from 'playwright'
import { B, WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Plat ${S}` }); const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const tc = g.channels.find((x) => x.kind === 'text')
const WS = B.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws'
const open = (token, platform) => new Promise((resolve) => { const ws = new WebSocket(`${WS}?token=${token}&platform=${platform}`); const events = []; ws.onmessage = (e) => { const ev = JSON.parse(e.data); events.push(ev); if (ev.t === 'READY') resolve({ ws, events }) }; ws.onerror = () => resolve({ ws, events }) })
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token); await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('[data-member-list]')
const bobBadge = () => p.locator('[data-member-list] button:has-text("Bob") [data-presence]').first()
ok('bob offline: grey dot', (await bobBadge().getAttribute('data-presence')) === 'dot' && /Offline/.test(await bobBadge().getAttribute('title')))

console.log('-- mobile only')
let m = await open(b.token, 'mobile')
await p.waitForFunction(() => [...document.querySelectorAll('[data-member-list] button')].some((x) => x.textContent.includes('Bob') && x.querySelector('[data-presence="mobile"]')), null, { timeout: 10000 })
ok('bob on mobile only: phone indicator with a tooltip', /Online on mobile/.test(await bobBadge().getAttribute('title')))
ok('the mobile socket\'s own READY lists platforms', m.events.find((e) => e.t === 'READY').d.platforms?.[b.user.id]?.includes('mobile'))

console.log('-- mobile + web')
const w = await open(b.token, 'web')
await p.waitForFunction(() => [...document.querySelectorAll('[data-member-list] button')].some((x) => x.textContent.includes('Bob') && x.querySelector('[data-presence="dot"]')), null, { timeout: 10000 })
ok('adding a web session turns it back into a dot, tooltip lists both', /mobile/.test(await bobBadge().getAttribute('title')) && /web/.test(await bobBadge().getAttribute('title')))
w.ws.close()
await p.waitForFunction(() => [...document.querySelectorAll('[data-member-list] button')].some((x) => x.textContent.includes('Bob') && x.querySelector('[data-presence="mobile"]')), null, { timeout: 10000 })
ok('closing the web session goes back to the phone', true)
m.ws.close()
await p.waitForFunction(() => [...document.querySelectorAll('[data-member-list] button')].some((x) => x.textContent.includes('Bob') && x.querySelector('[data-presence="dot"]') && /Offline/.test(x.querySelector('[data-presence]').getAttribute('title'))), null, { timeout: 10000 })
ok('closing the last socket: offline dot', true)

console.log('-- desktop shell')
const dctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ParleyDesktop/0.1.0' })
const pd = await dctx.newPage(); await pd.goto(`${WEB}/login`); await pd.evaluate((t) => localStorage.setItem('parley.token', t), b.token); await pd.goto(`${WEB}/channels/@me`); await pd.waitForSelector('[data-user-panel-bar]')
await p.waitForFunction(() => [...document.querySelectorAll('[data-member-list] button')].some((x) => x.textContent.includes('Bob') && /on desktop/.test(x.querySelector('[data-presence]')?.getAttribute('title') ?? '')), null, { timeout: 10000 })
ok('the desktop shell\'s user agent makes the client report desktop', (await bobBadge().getAttribute('data-presence')) === 'dot')
await pd.click('button[title="User Settings"]'); ok('the desktop shell gets a Switch server entry', await pd.locator('[data-switch-server]').count() === 1)
await dctx.close(); await new Promise((r) => setTimeout(r, 300))

console.log('-- vr + unknown')
const v = await open(b.token, 'vr')
await p.waitForFunction(() => [...document.querySelectorAll('[data-member-list] button')].some((x) => x.textContent.includes('Bob') && x.querySelector('[data-presence="vr"]')), null, { timeout: 10000 })
ok('VR only: headset indicator', /on VR/.test(await bobBadge().getAttribute('title')))
await p.screenshot({ path: '181-presence-vr.png' })
v.ws.close(); await new Promise((r) => setTimeout(r, 300))
const u = await open(b.token, 'toaster')
ok('an unknown platform counts as web', u.events.find((e) => e.t === 'READY').d.platforms?.[b.user.id]?.join() === 'web')
u.ws.close()
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
