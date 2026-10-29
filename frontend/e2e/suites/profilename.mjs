// The display name on profile cards is real text, whatever the name font and effect: the DM profile panel, the popout
// and the full profile, including when a friend note exists with no nickname (stored as an empty string, which used
// to blank the name), and falling back to the username when there's no display name at all.
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, openDms, finish, testContainer } from '../lib.mjs'

const src = readFileSync(new URL('../../src/lib/nameStyle.ts', import.meta.url), 'utf8')
const ids = (name) => { const at = src.indexOf(`export const ${name}`); return [...src.slice(at, src.indexOf('\n]\n', at)).matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]) }
const FONTS = ids('FONTS'), EFFECTS = ids('EFFECTS')
const sql = (q) => execSync(`docker exec ${testContainer('db')} psql -U parley -tAc "${q.replace(/"/g, '\\"')}"`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()

const a = await reg('alice'), b = await reg('roro'), c = await reg('noname')
await openDms(a, b, c)
await call(a.token, 'POST', '/users/@me/relationships', { username: b.user.username }); await call(b.token, 'PUT', `/users/@me/relationships/${a.user.id}`)
// A note with no nickname: the row stores nickname = ''.
await call(a.token, 'PUT', `/users/@me/notes/${b.user.id}`, { note: 'met in the review' })
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
await call(b.token, 'POST', `/channels/${dm.id}/messages`, { content: 'hi' })
console.log(`  (${FONTS.length} fonts, ${EFFECTS.length} effects)`)

const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
const nameIn = (scope) => p.locator(`${scope} [data-profile-name]`).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent, w: Math.round(r.width), h: Math.round(r.height) } })
const shows = (n, want) => n.text === want && n.w > 0 && n.h > 0

const bad = []
for (const [font, effect] of [...FONTS.map((f) => [f, 'holographic']), ...EFFECTS.map((e) => ['script', e])]) {
  await call(b.token, 'PATCH', '/users/@me', { name_style: { font, effect, colors: ['#57f287', '#3b9bff', '#c94bff', '#f04172', '#ff5c3b'] } })
  await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector('[data-dm-profile] [data-profile-name]', { state: 'attached' })
  const n = await nameIn('[data-dm-profile]')
  if (!shows(n, 'Roro')) bad.push({ font, effect, ...n })
}
ok('the DM profile panel shows the name as text for every font and effect (with a nickname-less friend note)', bad.length === 0, JSON.stringify(bad))

await p.click('[data-msg-avatar]'); await p.waitForSelector('[data-profile-popout] [data-profile-name]'); await p.waitForTimeout(300)
ok('so does the popout', shows(await nameIn('[data-profile-popout]'), 'Roro'), JSON.stringify(await nameIn('[data-profile-popout]')))
await p.keyboard.press('Escape'); await p.waitForTimeout(200)
await p.click('[data-view-full-profile]'); await p.waitForSelector('[data-full-profile] [data-profile-name]')
ok('and the full profile', shows(await nameIn('[data-full-profile]'), 'Roro'), JSON.stringify(await nameIn('[data-full-profile]')))
await p.keyboard.press('Escape'); await p.waitForTimeout(200)

console.log('-- no display name')
sql(`UPDATE users SET display_name = '' WHERE id = '${c.user.id}'`)
const dm2 = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: c.user.id })
await p.goto(`${WEB}/channels/@me/${dm2.id}`); await p.waitForSelector('[data-dm-profile] [data-profile-name]', { state: 'attached' })
ok('an account with no display name shows its username', shows(await nameIn('[data-dm-profile]'), c.user.username), JSON.stringify(await nameIn('[data-dm-profile]')))

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
