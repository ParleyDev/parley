// Emoji look the same everywhere: unicode emoji are drawn with Twemoji's pictures (not the device's font, which on
// Windows has no flags and on older systems no new emoji) in messages, jumbo messages, reactions and the picker, flags
// included; text symbols like © stay text; an emoji newer than the pictures falls back to the device's glyph; copying a
// message keeps the emoji; the picker offers only emoji it has pictures for, and tones both people in a couple.
import { chromium } from 'playwright'
import { WEB, reg, call, ok, finish } from '../lib.mjs'

const a = await reg('twemo')
const g = await call(a.token, 'POST', '/guilds', { name: 'Emoji Land' })
const ch = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((c) => c.kind === 'text')
const m1 = await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: 'flags 🇺🇸 🇯🇵 🏴󠁧󠁢󠁳󠁣󠁴󠁿 and 🫠 👍🏽 © 2026' })
await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: '🎉🔥' })
await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: 'too new 🫫' })
await call(a.token, 'PUT', `/channels/${ch.id}/messages/${m1.id}/reactions/${encodeURIComponent('🇨🇦')}`)

const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector(`[data-msg-id="${m1.id}"]`)
await p.waitForTimeout(800)
const loaded = (sel) => p.$$eval(sel, (els) => els.map((e) => ({ src: e.getAttribute('src'), ok: e.complete && e.naturalWidth > 0, alt: e.getAttribute('alt') })))

console.log('-- messages')
const row = `[data-msg-id="${m1.id}"] .msg-content`
const imgs = await loaded(`${row} img.uemoji`)
ok('emoji in a message are Twemoji pictures', imgs.length === 5 && imgs.every((i) => i.src.startsWith('/assets/twemoji/') && i.ok), JSON.stringify(imgs))
ok('flags are pictures, not letters', imgs.some((i) => i.src.endsWith('/1f1fa-1f1f8.svg')) && imgs.some((i) => i.src.includes('1f3f4-e0067')))
ok('skin tones keep their own picture', imgs.some((i) => i.src.endsWith('/1f44d-1f3fd.svg')))
ok('© stays text', (await p.locator(`${row} span.uemoji[data-emoji="©"]`).count()) === 1)
ok('the alt text is the emoji itself', imgs.every((i) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(i.alt)))
const jumbo = await p.locator('.msg-content.jumbo img.emoji').first().boundingBox()
ok('an emoji-only message shows them big', jumbo && jumbo.width >= 40, JSON.stringify(jumbo))
const tooNew = p.locator('.msg-content:has-text("too new") .uemoji')
await p.waitForTimeout(500)
const tn = await tooNew.evaluate((e) => ({ tag: e.tagName, text: e.textContent, src: e.getAttribute('src'), complete: e.complete, w: e.naturalWidth }))
ok('an emoji newer than the pictures falls back to text', tn.tag === 'SPAN' && tn.text === '🫫', JSON.stringify(tn))
const reaction = await loaded(`[data-msg-id="${m1.id}"] [data-reaction] img`)
ok('reactions are pictures', reaction.length === 1 && reaction[0].ok && reaction[0].src.endsWith('/1f1e8-1f1e6.svg'), JSON.stringify(reaction))
await p.locator(row).selectText(); await p.keyboard.press('Control+c')
const copied = await p.evaluate(() => navigator.clipboard.readText())
ok('copying a message keeps its emoji', copied.includes('🇺🇸') && copied.includes('🫠'), copied)

console.log('-- the picker')
await p.click('[data-composer] [aria-label="Emoji"], button[title="Emoji"]').catch(() => {})
await p.waitForSelector('[data-emoji-preview], input[placeholder="Find the perfect emoji"]', { timeout: 5000 }).catch(() => {})
const search = p.locator('input[placeholder="Find the perfect emoji"]')
ok('the emoji picker opens', await search.count() === 1)
await search.fill('flag united states'); await p.waitForTimeout(400)
const pick = await loaded('[data-emoji-grid] img.emoji, [role=dialog] img.emoji, .pop img.emoji')
ok('the picker shows flags as pictures', pick.some((i) => i.src?.endsWith('/1f1fa-1f1f8.svg') && i.ok), JSON.stringify(pick.slice(0, 3)))
await search.fill('cracking'); await p.waitForTimeout(400)
ok('emoji without a picture are not offered', !(await loaded('.pop img.emoji, [role=dialog] img.emoji')).some((i) => i.src?.includes('1faeb')))
await search.fill('people holding hands'); await p.waitForTimeout(400)
const hands = p.locator('img.emoji[alt="🧑‍🤝‍🧑"]').first()
if (await hands.count()) {
  await hands.click({ button: 'right' }).catch(() => {})
  await p.waitForTimeout(300)
  const toned = await loaded('[data-tone-variant] img')
  ok('a couple in a skin tone tones both people', toned.length === 6 && toned.every((i) => i.ok), JSON.stringify(toned.map((i) => i.src)))
}

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
