// The Discord review batch: first clicks never swallowed by the notification prompt, Friends rows showing the real
// status or custom status, popouts kept below the header with their frame on screen and a Message box, the channel
// header across the member list, one line of full-profile tabs, a Discord-size emoji picker, the large Inbox, the
// server menu's left icons, checkbox and no Delete, a centred settings window with a masked email, and Friends
// buttons that only get their round background on hover.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, openDms, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
await openDms(a, b, c)
for (const u of [b, c]) { await call(a.token, 'POST', '/users/@me/relationships', { username: u.user.username }); await call(u.token, 'PUT', `/users/@me/relationships/${a.user.id}`) }
await call(b.token, 'PATCH', '/users/@me', { status: 'idle' })
await call(c.token, 'PATCH', '/users/@me', { custom_status: 'shipping :rocket: today' })
await call(a.token, 'PATCH', '/users/@me', { profile_frame: 'asset:moonflowers' }).catch(() => {})
const g = await call(a.token, 'POST', '/guilds', { name: `Review ${S}` })
const text = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
const m1 = await call(b.token, 'POST', `/channels/${text.id}/messages`, { content: `hey <@${a.user.id}> **look** at this\nsecond line of the mention ${S}` })
await call(a.token, 'PUT', `/users/@me/bookmarks/${m1.id}`)

const browser = await chromium.launch(); const errors = []
const shots = process.env.SHOTS
const shot = async (p, name, clip) => { if (shots) await p.screenshot({ path: `${shots}/review-${name}.png`, ...(clip ? { clip } : {}) }) }
const ctx = await browser.newContext({ viewport: { width: 1925, height: 1289 } })
const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
// Keep friends online: bob and carol each hold a socket in a page of their own (a context each: pages in one context
// share localStorage, so they'd all be signed in as whoever logged in last).
for (const u of [b, c]) { const q = await (await browser.newContext()).newPage(); await q.goto(`${WEB}/login`); await q.evaluate((t) => localStorage.setItem('parley.token', t), u.token); await q.goto(`${WEB}/channels/@me`) }
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)

console.log('-- 1. first click')
await p.addInitScript(() => {
  window.__perm = []
  const real = window.Notification
  if (real) { Object.defineProperty(real, 'permission', { get: () => 'default', configurable: true }); real.requestPermission = () => { window.__perm.push(window.__clicked ? 'after-click' : 'before-click'); return Promise.resolve('default') } }
  window.addEventListener('click', () => { window.__clicked = true }, true)
})
await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector('[data-view-full-profile]')
await p.click('[data-view-full-profile]'); await p.waitForTimeout(400)
ok('the very first click after load opens the full profile', await p.locator('[data-full-profile]').count() === 1)
ok('and the notification prompt is asked only after that click finished', JSON.stringify(await p.evaluate(() => window.__perm)) === '["after-click"]', JSON.stringify(await p.evaluate(() => window.__perm)))
await p.keyboard.press('Escape'); await p.waitForTimeout(200)
await p.click('[data-user-panel] [data-control="User Settings"]'); await p.waitForTimeout(400)
ok('the settings gear opens settings on the first click', await p.locator('[data-settings-window]').count() === 1)

console.log('-- 9. settings window and email')
const frame = await p.locator('[data-settings-frame]').boundingBox()
ok('the settings window is centred with room above and below', frame && frame.y >= 30 && 1289 - (frame.y + frame.height) >= 30 && Math.abs(frame.y - (1289 - frame.y - frame.height)) <= 2, JSON.stringify(frame))
await p.click('[data-settings-window] button:has-text("Account")').catch(() => {}); await p.waitForTimeout(300)
const email = p.locator('[data-settings-window] [data-masked-email]').first()
ok('the email is masked (****@domain) with a Reveal link', await email.count() === 1 && /^\*+@x\.io/.test(await p.locator('[data-settings-window] [data-email-value]').first().textContent()))
await shot(p, 'settings')
await p.click('[data-email-reveal]'); ok('Reveal shows it', /^[^*]+@x\.io$/.test(await p.locator('[data-settings-window] [data-email-value]').first().textContent()))
await p.keyboard.press('Escape'); await p.waitForTimeout(300)

console.log('-- 2, 10. Friends')
await p.goto(`${WEB}/channels/@me`); await p.waitForTimeout(1500)
await p.waitForSelector('[data-friend-sub]', { timeout: 8000 })
const subOf = (name) => p.locator(`main [data-motion-row]:has-text("${name}") [data-friend-sub]`).first().textContent()
ok('an idle friend reads Idle, not Online', (await subOf('Bob')).trim() === 'Idle', await subOf('Bob'))
ok('a friend with a custom status shows it (emoji rendered)', (await p.locator('[data-motion-row]:has-text("Carol") [data-status-text="custom"]').count()) === 1)
const actionBg = () => p.locator('main [data-motion-row]:has-text("Bob") [data-friend-action]').first().evaluate((e) => getComputedStyle(e).backgroundColor)
await p.mouse.move(5, 5); await p.waitForTimeout(200)
ok('row buttons are plain icons until the row is hovered', (await actionBg()) === 'rgba(0, 0, 0, 0)', await actionBg())
await p.hover('main [data-motion-row]:has-text("Bob")'); await p.waitForTimeout(200)
ok('and get their round background on hover', (await actionBg()) !== 'rgba(0, 0, 0, 0)')
await shot(p, 'friends')

console.log('-- 4. server layout')
await p.goto(`${WEB}/channels/${g.id}/${text.id}`); await p.waitForSelector('[data-member-list]'); await p.waitForTimeout(800)
const lay = await p.evaluate(() => { const h = document.querySelector('[data-header-spans] > header')?.getBoundingClientRect(), m = document.querySelector('[data-member-list]').getBoundingClientRect(), stats = document.querySelector('[data-member-stats]')?.getBoundingClientRect(), first = document.querySelector('[data-member-list] h3')?.getBoundingClientRect(); return { h: h && [h.right, h.bottom], m: [m.top, m.right], stats: stats && stats.top, first: first && first.top, vw: innerWidth } })
ok('the channel header runs across the member list, which starts under it', lay.h && lay.h[0] >= lay.vw - 1 && lay.m[0] >= lay.h[1] - 1, JSON.stringify(lay))
ok('the list opens on its groups; the counts sit below them', lay.first < (lay.stats ?? Infinity), JSON.stringify(lay))
ok('members show their custom status under the name', await p.locator('[data-member-list] [data-member-status]:has-text("shipping")').count() === 1)
await shot(p, 'server')

console.log('-- 3. popout')
const row = p.locator(`[data-member-list] button:has-text("Alice")`).first()
await row.click(); await p.waitForSelector('[data-profile-popout]'); await p.waitForTimeout(700)
const pop = await p.evaluate(() => { const b = document.querySelector('[data-profile-popout]').getBoundingClientRect(), h = document.querySelector('[data-header-spans] > header').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, header: h.bottom, vh: innerHeight } })
ok('the popout (frame included) stays below the header and on screen', pop.top >= pop.header && pop.bottom <= pop.vh, JSON.stringify(pop))
await p.keyboard.press('Escape'); await p.waitForTimeout(200)
await p.locator(`[data-member-list] button:has-text("Bob")`).first().click(); await p.waitForSelector('[data-profile-popout]'); await p.waitForTimeout(600)
ok("someone else's popout ends with a Message @name box", await p.locator('[data-profile-popout] [data-quick-message]').count() === 1)
await shot(p, 'popout')
await p.keyboard.press('Escape'); await p.waitForTimeout(200)

console.log('-- 8. server menu')
await p.click(`aside button:has-text("Review ${S}")`); await p.waitForTimeout(300)
const menu = await p.evaluate(() => [...document.querySelectorAll('aside [role=menuitem], aside [role=menuitemcheckbox]')].map((b) => ({ text: b.textContent.trim(), iconFirst: b.firstElementChild?.hasAttribute('data-menu-icon'), check: b.querySelector('[data-menu-check]')?.dataset.menuCheck ?? null })))
ok('icons sit at the left of every item', menu.length > 4 && menu.every((x) => x.iconFirst), JSON.stringify(menu))
ok('Hide Muted Channels has a checkbox (off)', menu.some((x) => x.text.includes('Hide Muted Channels') && x.check === 'off'))
ok('no Delete Server in the quick menu', !menu.some((x) => /Delete Server/.test(x.text)))
await shot(p, 'servermenu')
await p.keyboard.press('Escape'); await p.mouse.click(900, 600); await p.waitForTimeout(200)

console.log('-- 6. emoji picker')
await p.click('[data-emoji-button]'); await p.waitForSelector('[data-emoji-btn]'); await p.waitForTimeout(500)
const pk = await p.evaluate(() => { const r = document.querySelector('[data-expression-picker]').getBoundingClientRect(), cell = document.querySelector('[data-section^="u-"] [data-emoji-btn]'), g = cell.firstElementChild; return { h: r.height, cell: cell.getBoundingClientRect().width, glyph: parseFloat(getComputedStyle(g).fontSize), rail: !!document.querySelector('[data-emoji-rail]'), sticky: getComputedStyle(document.querySelector('[data-section] > div')).position } })
ok('picker ~440px tall, 40px cells, ~30px emoji, a rail and sticky headers', pk.h >= 430 && pk.cell === 40 && pk.glyph >= 29 && pk.rail && pk.sticky === 'sticky', JSON.stringify(pk))
await p.hover('[data-section="frequent"] [data-emoji-btn]').catch(() => p.hover('[data-emoji-btn]')); await p.waitForTimeout(150)
ok('hovering names the emoji in the preview strip', /^:[a-z0-9_+-]+:$/.test((await p.locator('[data-emoji-preview]').textContent()).trim()), await p.locator('[data-emoji-preview]').textContent())
await shot(p, 'emoji', await p.locator('[data-expression-picker]').boundingBox())
await p.keyboard.press('Escape'); await p.waitForTimeout(200)

console.log('-- 7. inbox')
await p.click('[data-inbox-toggle]'); await p.waitForSelector('[data-inbox]'); await p.waitForTimeout(400)
const ib = await p.locator('[data-inbox]').boundingBox()
ok('the inbox is a large panel (~480px, most of the window tall)', ib.width >= 470 && ib.height >= 1289 * 0.75, JSON.stringify(ib))
const tabs = await p.locator('[data-inbox-tab]').evaluateAll((els) => els.map((e) => e.dataset.inboxTab))
ok('tabs: Unreads, Mentions, Bookmarks, Reminders (and Highlights)', ['unreads', 'mentions', 'bookmarks', 'reminders'].every((x, i) => tabs[i] === x), JSON.stringify(tabs))
await p.click('[data-inbox-tab="mentions"]'); await p.waitForSelector(`[data-inbox-item="${m1.id}"]`)
ok('a mention shows in full, with where it was and a Jump button', (await p.locator(`[data-inbox-item="${m1.id}"] [data-inbox-text]`).textContent()).includes('second line') && await p.locator(`[data-inbox-row="${m1.id}"]:has-text("general")`).count() === 1 && await p.locator(`[data-inbox-jump="${m1.id}"]`).count() === 1)
await shot(p, 'inbox')
await p.click('[data-inbox-tab="bookmarks"]'); await p.waitForTimeout(500)
ok('Bookmarks lists the bookmarked message', await p.locator(`[data-inbox-bookmark="${m1.id}"]`).count() === 1)
await p.click('[data-inbox-tab="unreads"]'); await p.waitForTimeout(400)
await p.keyboard.press('Escape')

console.log('-- 5. full profile tabs')
await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector('[data-view-full-profile]'); await p.click('[data-view-full-profile]'); await p.waitForSelector('[data-profile-tab]')
const tops = await p.locator('[data-profile-tab]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
ok('the full profile tabs stay on one line', new Set(tops).size === 1 && tops.length >= 4, JSON.stringify(tops))
await shot(p, 'fullprofile')

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
