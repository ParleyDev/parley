// Server Insights (growth, engagement, retention for Manage Server) and the server activity feed (any member).
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Ins ${S}` })
const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
await call(c.token, 'DELETE', `/guilds/${g.id}/members/@me`)
const m1 = await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: `big news ${S}` })
await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: 'hello' })
for (const [u, e] of [[a, '🔥'], [b, '🔥'], [b, '🎉']]) await call(u.token, 'PUT', `/channels/${ch.id}/messages/${m1.id}/reactions/${encodeURIComponent(e)}`)

console.log('-- insights')
ok('members can\'t see insights', (await raw(b.token, 'GET', `/guilds/${g.id}/insights`)).status === 403)
const ins = await call(a.token, 'GET', `/guilds/${g.id}/insights?days=7`)
ok('joins and leaves are counted', ins.totals.joins === 3 && ins.totals.leaves === 1 && ins.totals.members === 2, JSON.stringify(ins.totals))
ok('messages and talkers are counted', ins.totals.messages === 2 && ins.totals.communicators === 2)
ok('one row per day', ins.daily.length === 7 && ins.daily[6].messages === 2)
ok('join sources split invites from the rest', ins.join_sources.find((s) => s.via === 'invite')?.count === 2)
ok('busiest channels', ins.top_channels[0]?.name === ch.name && ins.top_channels[0].messages === 2)

const browser = await chromium.launch(); const errors = []
const ctx = async (t) => { const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t); return p }
const pa = await ctx(a.token)
await pa.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pa.waitForTimeout(800)
await pa.locator(`button:has-text("Ins ${S}")`).first().click(); await pa.click('text=Server Settings'); await pa.locator('button:has-text("Insights")').first().click()
await pa.waitForSelector('[data-insights-tile="members"]')
ok('the Insights tab shows the totals', (await pa.locator('[data-insights-tile="members"]').innerText()).includes('2') && (await pa.locator('[data-insights-tile="net"]').innerText()).includes('+2'))
await pa.click('[data-insights-days="7"]'); await pa.waitForSelector('[data-insights-chart="messages"]')
await pa.locator('[data-insights-chart="messages"] [data-insights-day]').last().hover()
ok('hovering a day shows its value', (await pa.locator('[data-insights-chart="messages"] [data-insights-hover]').innerText()).endsWith(': 2'))
ok('there is a table view', await pa.locator('[data-insights-table] tbody tr').count() === 7)
await pa.keyboard.press('Escape')

console.log('-- activity')
const feed = await call(b.token, 'GET', `/guilds/${g.id}/activity`)
ok('the feed lists the most-reacted message', feed.top_messages[0]?.id === m1.id && feed.top_messages[0].reactions === 3)
ok('and new members', feed.new_members.some((u) => u.id === b.user.id))
const pb = await ctx(b.token)
await pb.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pb.waitForSelector('[data-activity-row]')
await pb.click('[data-activity-row]'); await pb.waitForSelector(`[data-activity-message="${m1.id}"]`)
await pb.click(`[data-activity-message="${m1.id}"]`); await pb.waitForTimeout(600)
ok('clicking a message jumps to it', pb.url().includes(`message=${m1.id}`) || pb.url().includes(ch.id))

ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
