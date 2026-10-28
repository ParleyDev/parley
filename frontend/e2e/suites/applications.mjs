// Membership applications: new members answer questions and can only read until a moderator approves (or rejects,
// which removes them). Members already in the server when it's turned on aren't affected.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol'), d = await reg('dave')
const g = await call(a.token, 'POST', '/guilds', { name: `Apply ${S}` })
const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
await call(b.token, 'POST', `/invites/${inv.code}`) // in before applications

console.log('-- form')
ok('the form needs a question', (await raw(a.token, 'PUT', `/guilds/${g.id}/application-form`, { enabled: true, questions: [] })).status === 400)
const browser = await chromium.launch(); const errors = []
const ctx = async (t) => { const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t); return p }
const pa = await ctx(a.token)
await pa.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pa.waitForTimeout(800)
await pa.locator(`button:has-text("Apply ${S}")`).first().click(); await pa.click('text=Server Settings'); await pa.click('[data-settings-tab="applications"]')
await pa.waitForSelector('[data-applications-tab]')
await pa.check('[data-applications-enabled]'); await pa.click('[data-app-add]'); await pa.fill('[data-app-q-title="0"]', 'Why do you want to join?')
await pa.click('[data-applications-save]'); await pa.waitForTimeout(600)
const form = (await call(a.token, 'GET', `/guilds/${g.id}`)).applications
ok('the form is saved', form.enabled && form.questions.length === 1 && !!form.questions[0].id)
ok('members already here can still chat', (await raw(b.token, 'POST', `/channels/${ch.id}/messages`, { content: 'still here' })).status === 201)

console.log('-- apply')
await call(c.token, 'POST', `/invites/${inv.code}`); await call(d.token, 'POST', `/invites/${inv.code}`)
ok('new members can\'t chat yet', (await raw(c.token, 'POST', `/channels/${ch.id}/messages`, { content: 'hi' })).status === 403)
ok('or skip it by accepting the rules', (await raw(c.token, 'POST', `/guilds/${g.id}/rules/accept`, {})).status === 400)
const pc = await ctx(c.token)
await pc.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pc.waitForSelector('[data-application-gate]')
ok('the composer explains it', (await pc.locator('[data-application-gate]').innerText()).includes('reviews new members'))
await pc.click('[data-application-open]'); await pc.waitForSelector('[data-apply-form]')
ok('a required answer is needed', await pc.locator('[data-apply-submit]').isDisabled())
await pc.fill('[data-apply-answer="0"]', `I like it ${S}`); await pc.click('[data-apply-submit]'); await pc.waitForSelector('[data-apply-pending]')
ok('submitting shows it pending', await pc.locator('[data-apply-pending]').count() === 1)
await pc.keyboard.press('Escape')
await call(d.token, 'POST', `/guilds/${g.id}/application`, { answers: [{ question_id: form.questions[0].id, answer: 'spam' }] })
ok('ordinary members can\'t see the queue', (await raw(b.token, 'GET', `/guilds/${g.id}/applications`)).status === 403)

console.log('-- review')
await pa.locator('[data-applications-tab]').waitFor(); await pa.keyboard.press('Escape'); await pa.waitForTimeout(200)
await pa.locator(`button:has-text("Apply ${S}")`).first().click(); await pa.click('text=Server Settings'); await pa.click('[data-settings-tab="applications"]')
await pa.waitForSelector(`[data-application="${c.user.id}"]`)
ok('the queue shows answers', (await pa.locator(`[data-application="${c.user.id}"]`).innerText()).includes(`I like it ${S}`))
await pa.click(`[data-application-approve="${c.user.id}"]`); await pa.waitForTimeout(800)
ok('approving lets them chat', (await raw(c.token, 'POST', `/channels/${ch.id}/messages`, { content: 'in!' })).status === 201)
ok('and tells them', await pc.locator('text=was approved').count() >= 1)
pa.once('dialog', (dl) => dl.accept('Not a fit'))
await pa.click(`[data-application-reject="${d.user.id}"]`); await pa.waitForTimeout(800)
ok('rejecting removes them from the server', !(await call(a.token, 'GET', `/guilds/${g.id}/members`)).some((m) => m.user_id === d.user.id))

ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
