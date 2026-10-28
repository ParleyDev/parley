// Friends extras: the Active Now panel (friends in voice / streaming), Ignore (hides messages, no notifications,
// nothing changes for them), friend-online alerts, a confirmation before ringing a group (with "Don't ask again"),
// and leaving many group DMs at once.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
const friend = async (x, y) => { await call(x.token, 'POST', '/users/@me/relationships', { user_id: y.user.id }); await call(y.token, 'PUT', `/users/@me/relationships/${x.user.id}`) }
await friend(a, b); await friend(a, c); await friend(b, c)
const g = await call(a.token, 'POST', '/guilds', { name: `Social ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const general = g.channels.find((x) => x.kind === 'text'), vc = g.channels.find((x) => x.kind === 'voice')
const trio = await call(a.token, 'POST', '/users/@me/channels', { recipient_ids: [b.user.id, c.user.id], name: `Trio ${S}` })
const duo = await call(a.token, 'POST', '/users/@me/channels', { recipient_ids: [b.user.id, c.user.id], name: `Old ${S}` })
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const mk = async (tok, path) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}${path}`); await p.waitForTimeout(1200)
  return p
}
const pa = await mk(a.token, '/channels/@me')

console.log('-- online alerts')
await pa.click('button:has-text("All")'); await pa.waitForTimeout(200)
await pa.locator('[data-motion-row]', { hasText: b.user.display_name }).locator('button[title="More"]').click()
await pa.click(`[data-friend-alert="${b.user.id}"]`); await pa.waitForTimeout(500)
ok('Notify When Online is saved on the account', (await call(a.token, 'GET', '/users/@me')).online_alerts?.includes(b.user.id))
const pb = await mk(b.token, `/channels/${g.id}/${vc.id}`)
await pa.waitForFunction((n) => document.body.innerText.includes(`${n} is now online`), b.user.display_name, { timeout: 8000 }).catch(() => {})
ok('when they come online you are told', (await pa.locator('body').innerText()).includes(`${b.user.display_name} is now online`))

console.log('-- active now')
ok('Active Now is quiet to start', /quiet for now/.test(await pa.locator('[data-active-now]').innerText()))
await pb.click('text=Join Voice'); await pb.waitForSelector('[data-voice-leave]'); await pa.waitForTimeout(1200)
ok('a friend in voice shows up in Active Now', await pa.locator(`[data-active-now] [data-active-friend="${b.user.id}"]`).count() === 1)
await pa.click(`[data-active-friend="${b.user.id}"] [data-active-channel]`); await pa.waitForTimeout(600)
ok('with a link to their channel', new URL(pa.url()).pathname === `/channels/${g.id}/${vc.id}`)
await pb.click('[data-voice-leave]'); await pb.waitForTimeout(500)

console.log('-- ignore')
await call(c.token, 'POST', `/channels/${general.id}/messages`, { content: `carol here ${S}` })
await pa.goto(`${WEB}/channels/${g.id}/${general.id}`); await pa.waitForTimeout(1000)
await pa.locator('[data-msg-author]', { hasText: c.user.display_name }).last().click({ button: 'right' }); await pa.waitForSelector('[data-context-menu]')
await pa.click('[data-context-menu] [data-menu-item="Ignore"]'); await pa.waitForTimeout(600)
ok('their messages collapse once ignored', await pa.locator('[data-hidden-msg="ignored"]').count() >= 1 && !(await pa.locator('main').innerText()).includes(`carol here ${S}`))
ok('nothing changes for them (no block)', (await call(c.token, 'GET', '/users/@me/relationships')).find((r) => r.user.id === a.user.id)?.kind === 'friend')
await pa.locator('[data-hidden-msg="ignored"] button').first().click(); await pa.waitForTimeout(200)
ok('and can still be shown', (await pa.locator('main').innerText()).includes(`carol here ${S}`))

console.log('-- group calls')
await pa.goto(`${WEB}/channels/@me/${trio.id}`); await pa.waitForTimeout(900)
await pa.click('[data-start-call]'); await pa.waitForTimeout(300)
ok('starting a group call asks first', /ring all 2 other members/.test(await pa.locator('body').innerText()))
await pa.check('[data-dont-ask]'); await pa.click('button:has-text("Start Call")'); await pa.waitForSelector('[data-dm-call]')
ok('confirming starts the call', (await pa.evaluate(() => window.__parleyVoice().channel)) === trio.id)
await pa.click('[aria-label="Leave Call"], button[title="Leave Call"]'); await pa.waitForTimeout(600)
await pa.click('[data-start-call]'); await pa.waitForTimeout(800)
ok('"Don\'t ask again" skips the question next time', (await pa.evaluate(() => window.__parleyVoice().channel)) === trio.id && !/ring all/.test(await pa.locator('body').innerText()))
await pa.click('[aria-label="Leave Call"], button[title="Leave Call"]'); await pa.waitForTimeout(400)

console.log('-- leave groups')
await pa.click('[data-leave-groups-open]'); await pa.waitForSelector('[data-leave-groups]')
ok('every group is listed, none ticked when all are active', await pa.locator('[data-leave-group]').count() >= 2 && await pa.locator('[data-leave-group] input:checked').count() === 0)
await pa.click(`[data-leave-group="${duo.id}"]`); await pa.click('[data-leave-groups-confirm]'); await pa.waitForTimeout(800)
const mine = await call(a.token, 'GET', '/users/@me/channels')
ok('the picked group is left, the other kept', !mine.some((d) => d.id === duo.id) && mine.some((d) => d.id === trio.id))
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
