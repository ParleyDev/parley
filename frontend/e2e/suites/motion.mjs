// When animated avatars, decorations and name effects play (Discord's rules): always on profile cards and popouts;
// in messages while the message is hovered, focused or flashed after a jump; in list rows while the row is hovered;
// still everywhere else, and always still with reduced motion. Needs at least one animated decoration mounted
// (CI mounts e2e/fixtures/assets).
import { chromium } from 'playwright'
import { B, WEB, reg, call, callS, multi, ok, finish, gifFile, pngFile } from '../lib.mjs'

const a = await reg('mover'), b = await reg('viewer')
const moving = (await (await fetch(`${B}/assets/avatar-decorations`)).json()).find((d) => d.animated)
ok('an animated decoration is mounted', !!moving)
const gif = await (await multi(a.token, '/images?kind=avatar', gifFile)).json()
ok('animated GIF avatar uploaded and flagged animated', !!gif.url && gif.animated === true, JSON.stringify(gif))
await callS(a.token, 'PATCH', '/users/@me', { avatar_url: gif.url, avatar_decoration: `asset:${moving.id}`, name_style: { font: 'default', effect: 'neon', colors: ['#6d5dfc'] } })

console.log('-- still frames')
let r = await fetch(`${B}${gif.url.slice(4)}/static`)
const still = Buffer.from(await r.arrayBuffer())
ok('animated avatar has a still PNG at /static', r.status === 200 && r.headers.get('content-type') === 'image/png' && still.subarray(1, 4).toString() === 'PNG')
const png = await (await multi(a.token, '/images?kind=banner', pngFile)).json()
r = await fetch(`${B}${png.url.slice(4)}/static`)
ok('a still image is served as it is', r.status === 200 && r.headers.get('content-type') === 'image/png' && !png.animated)

const g = await call(a.token, 'POST', '/guilds', { name: 'Motion' }); const tc = g.channels.find((c) => c.kind === 'text').id
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const m1 = await call(a.token, 'POST', `/channels/${tc}/messages`, { content: 'look at my avatar' })

console.log('-- UI')
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), b.token)
await p.goto(`${WEB}/channels/${g.id}/${tc}`); await p.waitForSelector(`[data-msg-id="${m1.id}"] [data-avatar-img]`)
await p.mouse.move(1430, 10)
const msgAv = p.locator(`[data-msg-id="${m1.id}"] [data-msg-avatar] [data-avatar-motion]`).first()
const msgImg = msgAv.locator('[data-avatar-img]'), msgDec = msgAv.locator('img[data-decoration]')
const state = async (loc) => ({ motion: await loc.getAttribute('data-avatar-motion'), img: await loc.locator('[data-avatar-img]').getAttribute('src'), dec: await loc.locator('img[data-decoration]').getAttribute('src') })
let s = await state(msgAv)
ok('message avatar and decoration are still at rest', s.motion === 'off' && s.img.endsWith('/static') && s.dec.endsWith('/static'), JSON.stringify(s))
await p.locator(`[data-msg-id="${m1.id}"] .msg-content`).hover(); await p.waitForTimeout(150)
s = await state(msgAv)
ok('hovering the message (not the avatar) plays both', s.motion === 'on' && !s.img.endsWith('/static') && !s.dec.endsWith('/static'), JSON.stringify(s))
await p.mouse.move(1430, 10); await p.waitForTimeout(150)
ok('leaving the message stops them', (await msgAv.getAttribute('data-avatar-motion')) === 'off')
await p.evaluate((id) => document.querySelector(`[data-msg-id="${id}"]`).dispatchEvent(new Event('msgflash')), m1.id); await p.waitForTimeout(150)
ok('a jump highlight plays them', (await msgAv.getAttribute('data-avatar-motion')) === 'on')
await p.waitForTimeout(2000)
ok('and stops when the highlight fades', (await msgAv.getAttribute('data-avatar-motion')) === 'off')

const row = p.locator(`[data-member-list] [data-motion-row]:has-text("Mover")`).first()
const rowAv = row.locator('[data-avatar-motion]').first()
ok('member list avatar is still at rest', (await rowAv.getAttribute('data-avatar-motion')) === 'off')
await row.locator('text=Mover').first().hover(); await p.waitForTimeout(150)
ok('hovering the member row plays it', (await rowAv.getAttribute('data-avatar-motion')) === 'on')
await p.mouse.move(1430, 10); await p.waitForTimeout(150)
ok('leaving the row stops it', (await rowAv.getAttribute('data-avatar-motion')) === 'off')

await p.click(`[data-msg-id="${m1.id}"] [data-msg-author]`); await p.waitForSelector('[role=dialog] [data-profile-card]')
await p.mouse.move(1430, 890); await p.waitForTimeout(200)
const popAv = p.locator('[role=dialog] [data-profile-card] [data-avatar-motion]').first()
ok('profile popout plays the avatar and decoration without hovering', (await popAv.getAttribute('data-avatar-motion')) === 'on' && !(await popAv.locator('[data-avatar-img]').getAttribute('src')).endsWith('/static'))
const ne = p.locator('[role=dialog] [data-profile-card] [class*="ne-"]').first()
ok('the message behind the popout is still (a click is not keyboard focus)', (await msgAv.getAttribute('data-avatar-motion')) === 'off')
ok('and its name effect runs without hovering', await ne.count() === 1 && (await ne.evaluate((n) => getComputedStyle(n).animationPlayState)) === 'running')
await p.screenshot({ path: 'motion-popout.png' })
await p.keyboard.press('Escape'); await p.waitForTimeout(200)
await p.mouse.move(1430, 10); await p.locator('textarea').focus(); await p.keyboard.press('Shift+Tab'); await p.waitForTimeout(100)
for (let i = 0; i < 40 && !(await p.evaluate((id) => !!document.querySelector(`[data-msg-id="${id}"]`)?.matches(':focus-within'), m1.id)); i++) await p.keyboard.press('Shift+Tab')
ok('keyboard focus inside the message plays it', (await msgAv.getAttribute('data-avatar-motion')) === 'on')
await p.locator('textarea').focus(); await p.waitForTimeout(100)

await p.evaluate(() => { document.documentElement.dataset.motion = 'reduced' })
await p.locator(`[data-msg-id="${m1.id}"] .msg-content`).hover(); await p.waitForTimeout(150)
ok('reduced motion keeps message avatars still on hover', (await msgAv.getAttribute('data-avatar-motion')) === 'off' && (await msgImg.getAttribute('src')).endsWith('/static') && (await msgDec.getAttribute('src')).endsWith('/static'))
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
