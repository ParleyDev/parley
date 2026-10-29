// Richer desktop notifications (server/channel in the title, mentions rendered by name, avatar icon, one per
// channel, click jumps to the message), dark palettes and UI density, and the Inbox's Mentions / Unreads tabs.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Notes ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const general = g.channels.find((x) => x.kind === 'text')
const other = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'side-room', kind: 'text' })
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
await ctx.addInitScript(() => {
  window.__notes = []
  class FakeNote { constructor(title, opts) { this.title = title; Object.assign(this, opts); window.__notes.push(this) } close() {} }
  FakeNote.permission = 'granted'; FakeNote.requestPermission = async () => 'granted'
  window.Notification = FakeNote
  Object.defineProperty(document, 'visibilityState', { get: () => window.__vis ?? 'visible' })
})
const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${general.id}`); await p.waitForSelector('[data-composer-box] textarea'); await p.waitForTimeout(800)

console.log('-- desktop notifications')
await p.evaluate(() => { window.__vis = 'hidden' })
const m1 = await call(b.token, 'POST', `/channels/${other.id}/messages`, { content: `hey <@${a.user.id}> see **this** in <#${general.id}>` }); await p.waitForTimeout(800)
let notes = await p.evaluate(() => window.__notes.map((n) => ({ title: n.title, body: n.body, tag: n.tag, icon: n.icon ?? null })))
const n1 = notes.at(-1)
ok('the title names the author, channel and server', n1?.title === `${b.user.display_name} (#side-room, Notes ${S})`, JSON.stringify(n1))
ok('mentions and channels read as names, markdown dropped', n1?.body === `hey @${a.user.display_name} see this in #general`, n1?.body)
ok('one notification per channel (tagged)', n1?.tag === other.id)
await p.evaluate(() => { window.__vis = 'visible'; window.__notes.at(-1).onclick() }); await p.waitForTimeout(1200)
ok('clicking it opens the message', new URL(p.url()).pathname === `/channels/${g.id}/${other.id}` && await p.locator(`[data-msg-id="${m1.id}"]`).isVisible())

console.log('-- themes and density')
await p.click('[data-control="User Settings"]'); await p.click('button:has-text("Appearance")'); await p.waitForSelector('[data-appearance]')
await p.click('[data-default-theme="onyx"]')
ok('a dark palette re-colours the app', await p.evaluate(() => document.documentElement.dataset.palette === 'onyx' && getComputedStyle(document.documentElement).getPropertyValue('--color-bg-2').trim() === '#0f0f11'))
await p.click('[data-color-theme-option="aurora"] [data-color-theme-pick]')
ok('colour themes paint the window', await p.evaluate(() => getComputedStyle(document.body).backgroundImage.includes('gradient')))
await p.click('[data-color-theme-clear]')
await p.click('[data-ui-density-option="compact"]')
ok('UI density is saved', await p.evaluate(() => JSON.parse(localStorage.getItem('parley.appearance')).uiDensity === 'compact' && document.documentElement.dataset.uiDensity === 'compact'))
await p.keyboard.press('Escape'); await p.waitForTimeout(300)
ok('compact rows are tighter', await p.evaluate((id) => getComputedStyle(document.querySelector(`[data-channel-item="${id}"] > a`)).paddingTop === '2px', general.id))
await p.evaluate(() => { const a = JSON.parse(localStorage.getItem('parley.appearance')); a.palette = 'default'; a.uiDensity = 'default'; localStorage.setItem('parley.appearance', JSON.stringify(a)) })

console.log('-- inbox')
await p.goto(`${WEB}/channels/${g.id}/${general.id}`); await p.waitForTimeout(900)
await call(b.token, 'POST', `/channels/${other.id}/messages`, { content: 'something new' }); await p.waitForTimeout(700)
await p.click('[data-inbox-toggle]'); await p.waitForSelector('[data-inbox]')
await p.waitForSelector(`[data-inbox-item="${m1.id}"]`, { timeout: 5000 }).catch(() => {}) // the list loads after the panel opens
ok('Mentions lists the mention', await p.locator(`[data-inbox-item="${m1.id}"]`).count() === 1)
await p.hover(`[data-inbox-row="${m1.id}"]`); await p.click(`[data-inbox-remove="${m1.id}"]`)
ok('a mention can be removed from the inbox', await p.locator(`[data-inbox-item="${m1.id}"]`).count() === 0)
await p.click('[data-inbox-tab="unreads"]')
ok('Unreads lists channels with new messages', await p.locator(`[data-inbox-unread="${other.id}"]`).count() === 1)
await p.click('[data-inbox-read-all]'); await p.waitForTimeout(700)
ok('Mark all read clears them', await p.locator('[data-inbox-unread]').count() === 0 && /all caught up/.test(await p.locator('[data-inbox]').innerText()))
await p.click('[data-inbox-tab="mentions"]'); await p.keyboard.press('Escape'); await p.waitForTimeout(200)
await p.click('[data-inbox-toggle]'); await p.waitForSelector('[data-inbox]'); await p.waitForTimeout(500)
ok('removed mentions stay removed', await p.locator(`[data-inbox-item="${m1.id}"]`).count() === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
