// Custom typing indicators: up to three emoji, an animation and the text after your name, picked in the profile
// editor (Surprise Me, Reset) and sent with TYPING_START so others see them in the composer's typing row.
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Typing ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const ch = g.channels.find((x) => x.kind === 'text')

console.log('-- API')
const bad = await Promise.all([
  callS(a.token, 'PATCH', '/users/@me', { typing_indicator: { emojis: ['🔥', '🔥', '🔥', '🔥'] } }),
  callS(a.token, 'PATCH', '/users/@me', { typing_indicator: { emojis: ['abc'] } }),
  callS(a.token, 'PATCH', '/users/@me', { typing_indicator: { animation: 'explode' } }),
  callS(a.token, 'PATCH', '/users/@me', { typing_indicator: { text: 'x'.repeat(33) } }),
])
ok('too many emoji, words, unknown animations and long text are refused', bad.every((r) => r.status === 400), bad.map((r) => r.status).join())
const set = await call(a.token, 'PATCH', '/users/@me', { typing_indicator: { emojis: ['🤍', '', '🌱'], animation: 'jiggle', text: '  is   babbling…  ' } })
const ti = set.typing_indicator ?? {}
ok('a valid indicator is saved and cleaned up', ti.emojis?.join() === '🤍,,🌱' && ti.animation === 'jiggle' && ti.text === 'is babbling…', JSON.stringify(ti))
const empty = await call(a.token, 'PATCH', '/users/@me', { typing_indicator: { emojis: ['', '', ''], animation: 'spin', text: '' } })
ok('an empty one resets to the default', JSON.stringify(empty.typing_indicator) === '{}')

await call(a.token, 'PATCH', '/users/@me', { name_style: { font: 'default', effect: 'neon', colors: ['#57f287'] } })
const named = await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: 'styled name' })
const browser = await chromium.launch(); const errors = []
const open = async (u) => {
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector('[data-composer-box] textarea'); await p.waitForTimeout(1200)
  return p
}
const pa = await open(a), pb = await open(b)

console.log('-- default')
await pa.locator('[data-composer-box] textarea').type('hi')
await pb.waitForSelector('[data-typing-row] [data-typing-glyphs]')
ok('without an indicator others see the dots and "is typing…"', await pb.locator('[data-typing-glyphs="dots"]').count() === 1 && /is typing/.test(await pb.locator('[data-typing-row]').innerText()))
await pa.locator('[data-composer-box] textarea').fill('')

console.log('-- editor')
await pa.click('[data-panel-self]'); await pa.click('[data-user-menu-edit]'); await pa.waitForSelector('[data-profile-editor]')
await pa.click('[data-editor-section="typing"]'); await pa.waitForSelector('[data-typing-editor]')
ok('the Typing Indicator panel opens with a preview', /is typing/.test(await pa.locator('[data-typing-preview]').innerText()))
await pa.click('[data-typing-slot="0"]'); await pa.waitForSelector('[data-expression-picker]')
await pa.locator('[data-expression-picker] [data-emoji-btn]').first().click(); await pa.waitForTimeout(200)
const picked = await pa.locator('[data-typing-preview] [data-typing-emoji]').first().getAttribute('data-typing-emoji')
ok('a slot takes an emoji from the picker', !!picked && await pa.locator('[data-expression-picker]').count() === 0, String(picked))
await pa.click('[data-typing-animation="bounce"]')
ok('the animation shows in the preview', await pa.locator('[data-typing-preview] [data-typing-glyphs="bounce"]').count() === 1)
await pa.fill('[data-typing-text]', 'is cooking…')
ok('and so does the text', /is cooking…/.test(await pa.locator('[data-typing-preview]').innerText()))
await pa.click('[data-typing-surprise]')
ok('Surprise Me fills all three slots', await pa.locator('[data-typing-preview] [data-typing-emoji]').count() === 3 && (await pa.inputValue('[data-typing-text]')).length > 0)
await pa.click('[data-typing-reset]')
ok('Reset goes back to the default', await pa.locator('[data-typing-preview] [data-typing-glyphs="dots"]').count() === 1 && await pa.inputValue('[data-typing-text]') === '')
await pa.click('[data-typing-slot="1"]'); await pa.waitForSelector('[data-expression-picker]'); await pa.locator('[data-expression-picker] [data-emoji-btn]').nth(3).click()
await pa.click('[data-typing-animation="pulse"]'); await pa.fill('[data-typing-text]', 'is babbling…')
await pa.click('[data-editor-panel-close]')
ok('the tile previews it', /is babbling/.test(await pa.locator('[data-editor-section="typing"]').innerText()))
await pa.click('[data-editor-savebar] .btn-primary'); await pa.waitForTimeout(800)
const me = await call(a.token, 'GET', '/users/@me')
ok('Save stores it', me.typing_indicator?.animation === 'pulse' && me.typing_indicator?.text === 'is babbling…' && me.typing_indicator.emojis.filter(Boolean).length === 1, JSON.stringify(me.typing_indicator))
await pa.screenshot({ path: 'e2e/out/typing-editor.png' })

console.log('-- others see it')
await pa.keyboard.press('Escape'); await pa.waitForTimeout(300)
await pa.goto(`${WEB}/channels/${g.id}/${ch.id}`); await pa.waitForSelector('[data-composer-box] textarea')
await pb.waitForFunction(() => !document.querySelector('[data-typing-row] [data-typing-glyphs]'), null, { timeout: 15000 }).catch(() => {})
await pa.locator('[data-composer-box] textarea').type('hello')
await pb.waitForSelector('[data-typing-row] [data-typing-glyphs="pulse"]', { timeout: 5000 }).catch(() => {})
const row = await pb.locator('[data-typing-row]').innerText()
ok('their emoji and animation', await pb.locator('[data-typing-row] [data-typing-glyphs="pulse"] [data-typing-emoji]').count() === 1)
const playing = () => pb.evaluate(() => [...document.querySelectorAll('[data-typing-row] .typing-dot')].map((el) => { const cs = getComputedStyle(el); return cs.animationName !== 'none' && cs.animationPlayState === 'running' }))
await pb.mouse.move(5, 5)
ok('it animates without hovering anything (name animation "on hover" leaves it alone)', (await playing()).length === 1 && (await playing()).every(Boolean), JSON.stringify(await playing()))
const neon = () => pb.evaluate((id) => getComputedStyle(document.querySelector(`[data-msg-id="${id}"] .ne-neon`)).animationPlayState, named.id)
const still = await neon(); await pb.hover(`[data-msg-id="${named.id}"]`); const moving = await neon(); await pb.mouse.move(5, 5)
ok('while animated names still wait for a hover', still === 'paused' && moving === 'running', `${still} ${moving}`)
ok('and their text after the name', row.includes(a.user.display_name) && row.includes('is babbling…') && !/is typing/.test(row), row)
await pb.screenshot({ path: 'e2e/out/typing-row.png', clip: { x: 300, y: 780, width: 900, height: 120 } })

console.log('-- several typists')
await pb.locator('[data-composer-box] textarea').type('yo')
const pc = await (async () => { const c = await reg('carol'); await call(c.token, 'POST', `/invites/${inv.code}`); return c })()
await call(pc.token, 'POST', `/channels/${ch.id}/typing`); await pa.locator('[data-composer-box] textarea').type('!')
await pb.waitForTimeout(600)
ok('share the default indicator', /are typing/.test(await pb.locator('[data-typing-row]').innerText()) && await pb.locator('[data-typing-row] [data-typing-glyphs="dots"]').count() === 1)

console.log('-- DMs')
const dm = await call(b.token, 'POST', '/users/@me/channels', { recipient_id: a.user.id })
await pb.goto(`${WEB}/channels/@me/${dm.id}`); await pb.waitForSelector(`[data-dm-row="${a.user.id}"]`); await pb.waitForTimeout(1000)
if (!(await pb.locator('[data-dm-profile]').count())) await pb.click('[data-profile-toggle]').catch(() => {})
ok('the DM row shows the status dot while they are quiet', await pb.locator(`[data-dm-row="${a.user.id}"] [data-presence="typing"]`).count() === 0)
await call(a.token, 'POST', `/channels/${dm.id}/typing`)
await pb.waitForSelector(`[data-dm-row="${a.user.id}"] [data-presence="typing"]`, { timeout: 5000 }).catch(() => {})
ok('typing in the DM turns their avatar badge in the DM list into the typing pill', await pb.locator(`[data-dm-row="${a.user.id}"] [data-presence="typing"]`).count() === 1)
ok('the pill animates without hovering', await pb.evaluate(() => [...document.querySelectorAll('[data-presence="typing"] .typing-dot')].every((el) => getComputedStyle(el).animationPlayState === 'running' && getComputedStyle(el).animationName !== 'none')))
ok('and on their profile beside the DM', await pb.locator('[data-dm-profile] [data-presence="typing"]').count() === 1)
await pb.screenshot({ path: 'e2e/out/typing-dm.png' })
await call(a.token, 'POST', `/channels/${dm.id}/messages`, { content: 'there' }); await pb.waitForTimeout(800)
ok('sending the message brings the status dot back', await pb.locator(`[data-dm-row="${a.user.id}"] [data-presence="typing"]`).count() === 0 && await pb.locator(`[data-dm-row="${a.user.id}"] [data-presence]`).count() === 1)

console.log('-- privacy')
await call(a.token, 'PATCH', '/users/@me/privacy', { show_typing: false })
await pb.waitForFunction(() => !document.querySelector('[data-typing-row] [data-typing-glyphs]'), null, { timeout: 15000 }).catch(() => {})
await callS(a.token, 'POST', `/channels/${ch.id}/typing`); await pb.waitForTimeout(800)
ok('the typing endpoint honours "Show when I am typing" too', await pb.locator('[data-typing-row] [data-typing-glyphs]').count() === 0)
await call(a.token, 'PATCH', '/users/@me/privacy', { show_typing: true })

ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
