// Thread extras: private threads (members and moderators only; members add people), joining/leaving (joined
// threads show under their channel), posting joins you, locked threads (moderators only) and auto-archive settings.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Threads ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const ch = g.channels.find((x) => x.kind === 'text')
const browser = await chromium.launch(); const errors = []
const mk = async (tok, path) => {
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}${path}`); await p.waitForTimeout(1000)
  return p
}

console.log('-- private threads')
const pb = await mk(b.token, `/channels/${g.id}/${ch.id}`)
await pb.click('[data-threads-toggle]'); await pb.click('[data-threads-create]'); await pb.waitForSelector('[data-thread-name]')
await pb.fill('[data-thread-name]', `secret plans ${S}`); await pb.check('[data-thread-private]'); await pb.click('[data-thread-submit]'); await pb.waitForSelector('[data-thread-panel]')
const tid = await pb.getAttribute('[data-thread-panel]', 'data-thread-panel')
ok('a private thread is marked private', await pb.locator('[data-thread-private-badge]').count() === 1)
ok('members who weren\'t added can\'t see it', (await raw(c.token, 'GET', `/channels/${ch.id}/threads/${tid}`)).status === 404)
ok('moderators (the owner) can', (await raw(a.token, 'GET', `/channels/${ch.id}/threads/${tid}`)).status === 200)
const pc = await mk(c.token, `/channels/${g.id}/${ch.id}`)
await pb.click('[data-thread-members-toggle]'); await pb.waitForSelector('[data-thread-members]')
await pb.fill('[data-thread-add-search]', c.user.display_name.slice(0, 4)); await pb.click(`[data-thread-add="${c.user.id}"]`); await pb.waitForTimeout(1000)
ok('a member can add someone', (await raw(c.token, 'GET', `/channels/${ch.id}/threads/${tid}`)).status === 200)
ok('who then finds it under the channel', await pc.waitForSelector(`[data-sidebar-thread="${tid}"]`, { timeout: 5000 }).then(() => true).catch(() => false))

console.log('-- joining')
const pub = await call(a.token, 'POST', `/channels/${ch.id}/threads`, { name: `open talk ${S}` })
await pc.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pc.waitForTimeout(800)
ok('other people\'s threads aren\'t in your list', await pc.locator(`[data-sidebar-thread="${pub.id}"]`).count() === 0)
await pc.click('[data-threads-toggle]'); await pc.click(`[data-thread-row="${pub.id}"]`); await pc.waitForSelector('[data-thread-panel]')
await pc.click('[data-thread-join="join"]'); await pc.waitForTimeout(500)
ok('Join puts it in your channel list', await pc.locator(`[data-sidebar-thread="${pub.id}"]`).count() === 1)
await pc.click('[data-thread-join="leave"]'); await pc.waitForTimeout(500)
ok('Leave takes it out', await pc.locator(`[data-sidebar-thread="${pub.id}"]`).count() === 0)
await call(b.token, 'POST', `/channels/${pub.id}/messages`, { content: 'hi' })
ok('posting in a thread joins it', (await call(b.token, 'GET', '/users/@me/threads')).includes(pub.id))

console.log('-- locking')
const pa = await mk(a.token, `/channels/${g.id}/${ch.id}`)
await pa.click('[data-threads-toggle]'); await pa.click(`[data-thread-row="${pub.id}"]`); await pa.waitForSelector('[data-thread-lock]')
await pa.click('[data-thread-lock]'); await pa.waitForTimeout(600)
ok('locked threads refuse posts from members', (await raw(b.token, 'POST', `/channels/${pub.id}/messages`, { content: 'nope' })).status === 403)
ok('but moderators can still post', (await raw(a.token, 'POST', `/channels/${pub.id}/messages`, { content: 'mod note' })).status === 201)
ok('members see why they can\'t', await pc.locator('[data-readonly-note]').count() === 1)
ok('only moderators lock', (await raw(b.token, 'PATCH', `/threads/${pub.id}`, { locked: false })).status === 403)
ok('auto-archive takes 1 hour to 1 week', (await raw(a.token, 'PATCH', `/threads/${pub.id}`, { auto_archive_minutes: 5 })).status === 400 && (await call(a.token, 'PATCH', `/threads/${pub.id}`, { auto_archive_minutes: 60 })).auto_archive_minutes === 60)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
