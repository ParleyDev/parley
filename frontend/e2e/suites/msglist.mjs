// The message list under load: scrolling at trackpad speeds never loses the reader's place; the list's height changes
// only when a page arrives (no stand-in rows with guessed heights); history still to come shows as placeholder rows,
// and a failed load says so in place with Try again; a channel that opens on unread messages shows one bar, and Mark
// As Read (the button or Escape) goes to the newest message, marks the channel read and takes the NEW line away;
// Shift+PageUp goes to the oldest unread; following a reply offers the way back; search marks the words it matched,
// says when it could not run, and shows its results on phones.
import { chromium, devices } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const users = []; for (const n of ['alice', 'bob', 'carol', 'dave']) users.push(await reg(n))
const [a, b, c, d] = users
const g = await call(a.token, 'POST', '/guilds', { name: `List ${S}` }); const tc = g.channels.find((x) => x.kind === 'text')
const tc2 = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'other', kind: 'text' })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of users.slice(1)) await call(u.token, 'POST', `/invites/${inv.code}`)
// Uneven rows: one-liners, four lines, code blocks, long paragraphs.
const body = (i) => i % 23 === 0 ? `#${i}# ` + 'long paragraph '.repeat(60) : i % 11 === 0 ? `#${i}#\n\`\`\`js\n${'const x = 1\n'.repeat(12)}\`\`\`` : i % 7 === 0 ? `#${i}# line one\nline two\nline three\nline four` : `#${i}# pelican${i % 40} short message`
const post = async (u, content, extra) => { for (let k = 0; k < 10; k++) { const m = await call(u.token, 'POST', `/channels/${tc.id}/messages`, { content, ...extra }); if (m?.id) return m; await new Promise((r) => setTimeout(r, 900)) } throw new Error('post failed') }
const ids = []; for (let i = 0; i < 260; i++) ids.push((await post(users[1 + (Math.floor(i / 3) % 3)], body(i))).id)
const browser = await chromium.launch(); const errors = []
const mk = async (t, path, opts = { viewport: { width: 1440, height: 900 } }) => { const p = await (await browser.newContext(opts)).newPage(); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t); await p.goto(`${WEB}${path}`); await p.waitForSelector('[data-message-list]'); return p }
const LIST = '[data-message-list]'
const state = (p) => p.evaluate(() => { const el = document.querySelector('[data-message-list]'); const v = el.getBoundingClientRect(); const vis = [...el.querySelectorAll('[data-row-id]')].filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > v.top + 4 && b.top < v.bottom - 4 }); const num = (r) => Number((r?.querySelector('[data-msg-id]')?.textContent.match(/#(\d+)#/) ?? [])[1]); return { fromBottom: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight), first: num(vis[0]), last: num(vis[vis.length - 1]), banner: !!document.querySelector('[data-unread-banner]'), divider: !!document.querySelector('[data-unread-divider]'), bar: !!document.querySelector('[data-older-bar]'), back: !!document.querySelector('[data-jump-back]') } })
const toBottom = async (p) => { await p.evaluate(() => { const el = document.querySelector('[data-message-list]'); el.scrollTop = el.scrollHeight }); await p.waitForTimeout(400) }
const hover = async (p) => { const box = await p.locator(LIST).boundingBox(); await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2) }
const unreadInSidebar = (p) => p.evaluate((href) => document.querySelector(`a[href="${href}"]`)?.outerHTML.includes('data-unread="true"') ?? null, `/channels/${g.id}/${tc.id}`)

console.log('-- scrolling at trackpad speeds')
let lost = 0, worst = 0, ends = []
for (let run = 0; run < 5; run++) {
  const p = await mk(a.token, `/channels/${g.id}/${tc.id}`); await p.waitForSelector('[data-row-id]'); await p.waitForTimeout(900); await hover(p)
  // Watch the first visible message every frame: scrolling up, its number may only go down.
  await p.evaluate(() => { const el = document.querySelector('[data-message-list]'); window.__w = { back: 0, heights: new Set(), frames: 0 }; let prev = 1e9; const f = () => { const v = el.getBoundingClientRect(); const row = [...el.querySelectorAll('[data-row-id]')].find((r) => r.getBoundingClientRect().bottom > v.top + 4); const n = Number((row?.textContent.match(/#(\d+)#/) ?? [])[1]); if (Number.isFinite(n)) { if (n > prev + 3) window.__w.back++; prev = n } window.__w.heights.add(el.scrollHeight); window.__w.frames++; window.__r = requestAnimationFrame(f) }; window.__r = requestAnimationFrame(f) })
  for (let i = 0; i < 300; i++) { await p.mouse.wheel(0, -40); await p.waitForTimeout(8) }
  await p.waitForTimeout(900)
  const w = await p.evaluate(() => { cancelAnimationFrame(window.__r); return { back: window.__w.back, heights: window.__w.heights.size, pads: document.querySelectorAll('[data-virtual-pad]').length } })
  const s = await state(p)
  if (w.back || !(s.first < 200)) lost++
  worst = Math.max(worst, w.heights); ends.push(s.first)
  if (run === 0) ok('no stand-in rows: every loaded message is in the list', w.pads === 0 && await p.locator('[data-row-id]').count() >= 100)
  await p.context().close()
}
ok('12,000 px up in 40 px steps every 8 ms, five times over: the view never moves back towards the newest', lost === 0, `lost ${lost}/5, ended at ${ends.join(', ')}`)
ok('the list changes height only as pages arrive, not with every row scrolled into view', worst <= 12, `${worst} different heights`)

console.log('-- history still to come')
const pa = await mk(a.token, `/channels/${g.id}/${tc.id}`); await pa.waitForSelector('[data-row-id]'); await pa.waitForTimeout(600); await hover(pa)
ok('above the oldest loaded message, rows stand in for what is not loaded', await pa.locator('[data-history-placeholder="older"]').count() === 1)
// A page that fails
await pa.route('**/messages?before=*', (r) => r.abort())
for (let i = 0; i < 60; i++) { await pa.mouse.wheel(0, -200); await pa.waitForTimeout(12) }
await pa.waitForSelector('[data-load-failed]', { timeout: 6000 }).catch(() => {})
ok('a page that fails to load says so in the list', await pa.locator('[data-load-failed]').count() === 1 && (await pa.locator('[data-load-failed]').textContent()).includes('Messages failed to load'))
const before = await pa.locator('[data-row-id]').count()
await pa.waitForTimeout(1500)
ok('and does not keep asking by itself', await pa.locator('[data-load-failed]').count() === 1 && await pa.locator('[data-row-id]').count() === before)
await pa.screenshot({ path: 'msglist-failed.png' })
await pa.unroute('**/messages?before=*')
await pa.click('[data-load-retry]')
await pa.waitForFunction((n) => document.querySelectorAll('[data-row-id]').length > n, before, { timeout: 8000 }).catch(() => {})
ok('Try again loads it', await pa.locator('[data-row-id]').count() > before && await pa.locator('[data-load-failed]').count() === 0)
for (let i = 0; i < 40 && !(await pa.locator('h1:has-text("Welcome to")').count()); i++) { await pa.evaluate(() => { document.querySelector('[data-message-list]').scrollTop = 0 }); await pa.waitForTimeout(350) }
ok('at the beginning of the channel the stand-in rows give way to its welcome', await pa.locator('h1:has-text("Welcome to")').count() === 1 && await pa.locator('[data-history-placeholder="older"]').count() === 0)
ok('the window stopped short of the present: rows stand in below, and the bar offers the present', await pa.locator('[data-history-placeholder="newer"]').count() === 1 && await pa.locator('[data-jump-present]').count() === 1)
// A slow first page
const slow = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); slow.on('pageerror', (x) => errors.push(x.message))
await slow.goto(`${WEB}/login`); await slow.evaluate((x) => localStorage.setItem('parley.token', x), a.token)
await slow.route(`**/channels/${tc.id}/messages?limit=50`, async (r) => { await new Promise((x) => setTimeout(x, 1200)); await r.continue() })
await slow.goto(`${WEB}/channels/${g.id}/${tc.id}`); await slow.waitForSelector('[data-message-list]')
ok('a channel whose first page is still on its way shows placeholder rows, not an empty pane', await slow.waitForSelector('[data-history-placeholder]', { timeout: 1000 }).then(() => true, () => false) && await slow.locator('[data-row-id]').count() === 0)
await slow.screenshot({ path: 'msglist-loading.png' })
await slow.waitForSelector('[data-row-id]', { timeout: 6000 })
ok('and then the messages, at the newest', (await state(slow)).fromBottom < 40)
await slow.context().close()

console.log('-- opening on unread messages, and Mark As Read')
const pb = await mk(b.token, `/channels/${g.id}/${tc.id}`); await pb.waitForSelector('[data-row-id]'); await pb.waitForTimeout(500); await toBottom(pb); await pb.waitForTimeout(700)
const unreadRound = async (n) => { await pb.click(`a[href="/channels/${g.id}/${tc2.id}"]`); await pb.waitForTimeout(400); for (let i = 0; i < n; i++) await post(i % 2 ? c : d, `#${9000 + i}# unread for bob`); await pb.waitForTimeout(400); await pb.click(`a[href="/channels/${g.id}/${tc.id}"]`); await pb.waitForSelector('[data-unread-banner]'); await pb.waitForTimeout(500) }
await unreadRound(40)
let s = await state(pb)
ok('40 unread: the channel opens on the NEW line with the bar at the top', s.banner && s.divider && s.fromBottom > 300, JSON.stringify(s))
ok('and only that bar: no "older messages" bar while the reader sits where they landed', !s.bar)
await pb.screenshot({ path: 'msglist-unread.png' })
await hover(pb); await pb.mouse.wheel(0, -900); await pb.waitForTimeout(500)
ok('scrolling away brings the bar with the way to the present', (await state(pb)).bar)
await pb.click('[data-unread-dismiss]')
await pb.waitForFunction(() => { const el = document.querySelector('[data-message-list]'); return el.scrollHeight - el.scrollTop - el.clientHeight < 40 && !document.querySelector('[data-unread-divider]') }, null, { timeout: 5000 }).catch(() => {})
s = await state(pb)
ok('Mark As Read goes to the newest message', s.fromBottom < 40, JSON.stringify(s))
ok('takes the bar and the NEW line away', !s.banner && !s.divider)
const rs = async () => (await call(b.token, 'GET', '/users/@me/read-states').catch(() => null))
await pb.click(`a[href="/channels/${g.id}/${tc2.id}"]`); await pb.waitForTimeout(500)
ok('and the channel is read: no unread mark after leaving it', await unreadInSidebar(pb) === false, JSON.stringify(await rs()).slice(0, 80))
await pb.click(`a[href="/channels/${g.id}/${tc.id}"]`); await pb.waitForTimeout(700)
ok('nor a NEW line on coming back', !(await state(pb)).divider)

console.log('-- keys')
await unreadRound(30)
await pb.locator('[data-search-input]').first().click(); await pb.keyboard.type('half a search'); await pb.keyboard.press('Escape'); await pb.waitForTimeout(500)
ok('Escape in a field that has text (the search box) leaves the unread messages alone', (await state(pb)).divider && (await state(pb)).banner)
await pb.locator('[data-chat-bottom] textarea').first().click(); await pb.keyboard.type('half a thought'); await pb.keyboard.press('Escape')
await pb.waitForFunction(() => { const el = document.querySelector('[data-message-list]'); return el.scrollHeight - el.scrollTop - el.clientHeight < 40 && !document.querySelector('[data-unread-divider]') }, null, { timeout: 5000 }).catch(() => {})
s = await state(pb)
ok('Escape, even from the message box with words in it, marks the channel read and goes to the newest message', s.fromBottom < 40 && !s.divider && !s.banner, JSON.stringify(s))
ok('and keeps what was typed', (await pb.locator('[data-chat-bottom] textarea').first().inputValue()) === 'half a thought')
await pb.locator('[data-chat-bottom] textarea').first().fill('')
await pb.click(`a[href="/channels/${g.id}/${tc2.id}"]`); await pb.waitForTimeout(400)
ok('(read: no unread mark)', await unreadInSidebar(pb) === false)
await pb.click(`a[href="/channels/${g.id}/${tc.id}"]`); await pb.waitForTimeout(500)
await unreadRound(25)
await toBottom(pb); await pb.locator(LIST).focus(); await pb.keyboard.press('Shift+PageUp'); await pb.waitForTimeout(1200)
const dv = await pb.evaluate(() => { const dd = document.querySelector('[data-unread-divider]'); const v = document.querySelector('[data-message-list]').getBoundingClientRect(); return dd ? Math.round(dd.getBoundingClientRect().top - v.top) : null })
ok('Shift+PageUp goes to the oldest unread message', dv !== null && dv >= 0 && dv < 200, String(dv))
await pb.keyboard.press('Escape'); await pb.waitForTimeout(900)

console.log('-- following a reply, and the way back')
const reply = await post(c, '#9999# replying to an old one', { reply_to: ids[30] })
await pa.click('[data-jump-present]').catch(() => {}); await pa.waitForFunction((id) => !!document.querySelector(`[data-row-id="${id}"]`), reply.id, { timeout: 8000 }); await toBottom(pa)
ok('(at the newest message, nothing to go back to)', !(await state(pa)).back)
await pa.click(`[data-row-id="${reply.id}"] [data-reply-link]`)
await pa.waitForFunction((id) => !!document.querySelector(`[data-msg-id="${id}"]`), ids[30], { timeout: 8000 }).catch(() => {}); await pa.waitForTimeout(500)
s = await state(pa)
ok('following a reply shows its original, far up the history', s.first <= 30 && s.last >= 30 && s.fromBottom > 1000, JSON.stringify(s))
ok('and offers the way back', s.back)
await pa.screenshot({ path: 'msglist-back.png' })
await pa.locator(LIST).focus(); await pa.keyboard.press('Escape')
await pa.waitForFunction((id) => { const el = document.querySelector('[data-message-list]'); return !!document.querySelector(`[data-row-id="${id}"]`) && el.scrollHeight - el.scrollTop - el.clientHeight < 40 }, reply.id, { timeout: 8000 }).catch(() => {})
s = await state(pa)
ok('Escape returns to where the reader was (the newest messages)', s.fromBottom < 40 && !s.back, JSON.stringify(s))
// From a place in the history, not the bottom
await hover(pa); await pa.mouse.wheel(0, -260); await pa.waitForTimeout(500)
const was = await state(pa)
const topRow = () => pa.evaluate(() => { const el = document.querySelector('[data-message-list]'); const v = el.getBoundingClientRect(); const r = [...el.querySelectorAll('[data-row-id]')].find((x) => x.getBoundingClientRect().bottom > v.top + 4); return { id: r?.dataset.rowId, top: Math.round(r.getBoundingClientRect().top - v.top) } })
const rowWas = await topRow()
// The reply's row is partly below the fold now: press its link without the test tool scrolling it into view first.
await pa.locator(`[data-row-id="${reply.id}"] [data-reply-link]`).dispatchEvent('click')
await pa.waitForFunction((id) => !!document.querySelector(`[data-msg-id="${id}"]`), ids[30], { timeout: 8000 }).catch(() => {}); await pa.waitForTimeout(400)
await pa.click('[data-jump-back]')
await pa.waitForFunction((id) => !!document.querySelector(`[data-row-id="${id}"]`), reply.id, { timeout: 8000 }).catch(() => {}); await pa.waitForTimeout(500)
s = await state(pa)
const rowNow = await topRow()
// The same message at the top, at the same height (what is below it may have changed by a line: a Seen marker, a divider).
ok('Back returns to the same place in the history', rowNow.id === rowWas.id && Math.abs(rowNow.top - rowWas.top) <= 4 && s.fromBottom > 100, `${JSON.stringify(rowWas)} → ${JSON.stringify(rowNow)}, ${was.fromBottom} → ${s.fromBottom} px from the bottom`)

console.log('-- search')
const box = pa.locator('[data-search-input]').first(); await box.click(); await box.fill('pelican7 from:' + c.user.username); await box.press('Enter')
await pa.waitForSelector('[data-search-hit]', { timeout: 8000 }).catch(() => {})
const marks = await pa.evaluate(() => { const h = CSS.highlights?.get('search-hit'); return h ? [...h].map((r) => r.toString().toLowerCase()) : null })
ok('results mark the matched word', Array.isArray(marks) && marks.length >= 1 && marks.every((m) => m === 'pelican7'), JSON.stringify(marks))
ok('and not the filter', !marks?.some((m) => m.includes('from')))
await pa.screenshot({ path: 'msglist-search.png' })
await pa.route('**/api/search?*', (r) => r.abort())
await box.fill('pelican9'); await box.press('Enter')
await pa.waitForSelector('[data-search-failed]', { timeout: 6000 }).catch(() => {})
ok('a search that cannot be run says so, instead of "no results"', await pa.locator('[data-search-failed]').count() === 1 && await pa.locator('[data-search-empty]').count() === 0)
await pa.unroute('**/api/search?*'); await pa.click('[data-search-retry]')
ok('Try again runs it', await pa.waitForSelector('[data-search-hit]', { timeout: 8000 }).then(() => true, () => false))
// Phones
const pp = await mk(a.token, `/channels/${g.id}/${tc.id}`, { ...devices['iPhone 13'] }); await pp.waitForSelector('[data-row-id]')
await pp.evaluate(() => { const i = document.querySelector('[data-search-input]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'pelican7'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
await pp.waitForSelector('[data-search-hit]', { timeout: 8000 }).catch(() => {})
const panel = await pp.locator('[data-search-panel]').boundingBox().catch(() => null)
ok('on a phone the results fill the screen', !!panel && panel.width >= 380 && panel.height >= 600 && await pp.locator('[data-search-hit]').first().isVisible(), JSON.stringify(panel))
await pp.screenshot({ path: 'msglist-search-phone.png' })
const hit = await pp.locator('[data-search-hit]').first().getAttribute('data-search-hit')
await pp.locator('[data-search-hit] [data-jump]').first().tap()
await pp.waitForFunction((id) => !!document.querySelector(`[data-msg-id="${id}"]`), hit, { timeout: 8000 }).catch(() => {})
ok('and Jump closes them and shows the message', await pp.locator('[data-search-panel]').count() === 0 && await pp.locator(`[data-msg-id="${hit}"]`).isVisible())

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
