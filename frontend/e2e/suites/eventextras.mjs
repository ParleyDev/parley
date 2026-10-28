// Event extras: cover images, repeating events, Start / End (with a heads-up to everyone interested), editing, and the
// interested list.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Ev ${S}` })
const ch = g.channels.find((x) => x.kind === 'text'), vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const at = (h) => new Date(Date.now() + h * 3600e3).toISOString()
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

console.log('-- api')
ok('unknown repeat values are refused', (await raw(a.token, 'POST', `/guilds/${g.id}/events`, { name: 'x y', starts_at: at(1), channel_id: vc.id, recurrence: 'hourly' })).status === 400)
const weekly = await call(a.token, 'POST', `/guilds/${g.id}/events`, { name: `Weekly ${S}`, starts_at: at(2), ends_at: at(3), channel_id: vc.id, recurrence: 'weekly' })
ok('repeating events are saved', weekly.recurrence === 'weekly' && weekly.status === 'scheduled')
await call(b.token, 'PUT', `/guilds/${g.id}/events/${weekly.id}/rsvp`)
ok('members can see who\'s interested', (await call(b.token, 'GET', `/guilds/${g.id}/events/${weekly.id}/rsvps`)).map((u) => u.id).sort().join() === [a.user.id, b.user.id].sort().join())
ok('members can\'t start events', (await raw(b.token, 'POST', `/guilds/${g.id}/events/${weekly.id}/start`)).status === 403)

const browser = await chromium.launch(); const errors = []
const ctx = async (t) => { const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t); return p }
const pb = await ctx(b.token); await pb.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pb.waitForTimeout(1000)
const pa = await ctx(a.token); await pa.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pa.waitForSelector('[data-events-row]')
await pa.click('[data-events-row]'); await pa.waitForSelector(`[data-event="${weekly.id}"]`)
ok('repeating events say so', (await pa.locator(`[data-event="${weekly.id}"] [data-event-repeats]`).innerText()) === 'Every week')

console.log('-- start and end')
await pa.click(`[data-event="${weekly.id}"] [data-event-start]`); await pa.waitForSelector(`[data-event="${weekly.id}"][data-event-status="active"]`)
ok('Start marks it happening now', (await pa.locator(`[data-event="${weekly.id}"]`).innerText()).toLowerCase().includes('happening now'))
await pb.waitForSelector('text=is happening now', { timeout: 5000 }).catch(() => {})
ok('people interested are told', await pb.locator(`text=Weekly ${S} is happening now`).count() >= 1)
await pa.click(`[data-event="${weekly.id}"] [data-event-end]`); await pa.waitForTimeout(800)
const next = (await call(a.token, 'GET', `/guilds/${g.id}/events`)).find((e) => e.id === weekly.id)
ok('ending a weekly event moves it a week on, keeping RSVPs', next?.status === 'scheduled' && Math.round((new Date(next.starts_at) - new Date(weekly.starts_at)) / 86400e3) === 7 && next.rsvp_count === 2, JSON.stringify(next))
const once = await call(a.token, 'POST', `/guilds/${g.id}/events`, { name: `Once ${S}`, starts_at: at(1), location: 'the park' })
await call(a.token, 'POST', `/guilds/${g.id}/events/${once.id}/start`); await call(a.token, 'POST', `/guilds/${g.id}/events/${once.id}/end`)
ok('a one-off event is gone once ended', !(await call(a.token, 'GET', `/guilds/${g.id}/events`)).some((e) => e.id === once.id))

console.log('-- edit and cover')
await pa.click(`[data-event="${weekly.id}"] [data-event-edit]`); await pa.waitForSelector(`[data-event-form="${weekly.id}"]`)
ok('edit fills the form', (await pa.inputValue('[data-event-name]')) === `Weekly ${S}` && (await pa.inputValue('[data-event-repeat]')) === 'weekly')
await pa.fill('[data-event-name]', `Weekly jam ${S}`)
await pa.setInputFiles('[data-event-cover]', { name: 'c.png', mimeType: 'image/png', buffer: PNG }); await pa.waitForFunction(() => !!document.querySelector('[data-event-cover-preview]')?.getAttribute('data-event-cover-preview'))
await pa.click('[data-event-submit]'); await pa.waitForTimeout(800)
const edited = (await call(b.token, 'GET', `/guilds/${g.id}/events`)).find((e) => e.id === weekly.id)
ok('saving updates the name and cover', edited.name === `Weekly jam ${S}` && /^\/api\/images\//.test(edited.cover_url ?? ''))
ok('the cover shows on the card', await pa.locator(`[data-event="${weekly.id}"] [data-event-cover-img]`).count() === 1)
await pa.click(`[data-event="${weekly.id}"] [data-event-people]`); await pa.waitForSelector('[data-event-people-list]')
ok('the interested list opens', (await pa.locator('[data-event-people-list]').innerText()).includes('Bob'))

ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
