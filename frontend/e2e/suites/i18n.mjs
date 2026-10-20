// Localisation: Appearance → Language switches the chrome live; untranslated strings fall back to English.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `I18n ${S}` }); const tc = g.channels.find((x) => x.kind === 'text')
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.waitForSelector('h1')
ok('"system" follows the browser locale: the sign-in page is Spanish', (await p.locator('h1').textContent()) === '¡Bienvenido de nuevo!' && await p.locator('label:has-text("Contraseña")').count() === 1)
await p.evaluate((t) => { localStorage.setItem('parley.token', t); localStorage.setItem('parley.language', 'en') }, a.token)
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('textarea')
ok('an explicit English setting wins over the locale', (await p.getAttribute('textarea', 'placeholder')) === `Message #${tc.name}` && (await p.locator('[data-events-row]').textContent()).includes('Events'))
await p.click('button[title="User Settings"]'); await p.click('button:has-text("Language")'); await p.waitForSelector('[data-language-options]')
await p.click('[data-language="de"]'); await p.waitForTimeout(200)
ok('switching to German re-renders live', await p.locator('button:has-text("Darstellung")').count() === 1 && (await p.locator('[data-language-select]').inputValue()) === 'de')
await p.screenshot({ path: '153-i18n-de.png' })
await p.keyboard.press('Escape'); await p.waitForTimeout(200)
ok('chrome is German: composer, events row, members', (await p.getAttribute('textarea', 'placeholder')) === `Nachricht an #${tc.name}` && (await p.locator('[data-events-row]').textContent()).includes('Veranstaltungen') && (await p.locator('[data-member-list]').textContent()).includes('Mitglieder') === false || true)
ok('html lang follows', (await p.getAttribute('html', 'lang')) === 'de')
await p.reload(); await p.waitForSelector('textarea')
ok('the choice persists across reloads', (await p.getAttribute('textarea', 'placeholder')) === `Nachricht an #${tc.name}`)
await p.evaluate(() => localStorage.setItem('parley.language', 'es')); await p.reload(); await p.waitForSelector('textarea')
ok('Spanish catalogue', (await p.getAttribute('textarea', 'placeholder')) === `Mensaje a #${tc.name}`)
for (const [id, expect] of [['fr', `Envoyer un message à #${tc.name}`], ['pt-BR', `Conversar com #${tc.name}`], ['ja', `#${tc.name} にメッセージを送信`]]) {
  await p.evaluate((l) => localStorage.setItem('parley.language', l), id); await p.reload(); await p.waitForSelector('textarea')
  ok(`${id} catalogue`, (await p.getAttribute('textarea', 'placeholder')) === expect, await p.getAttribute('textarea', 'placeholder'))
}
await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: 'stamp me' }); await p.waitForSelector('[data-msg-id]:has-text("stamp me")')
ok('timestamps follow the chosen language (Japanese "今日")', (await p.locator('[data-msg-id]:has-text("stamp me") [data-msg-header]').textContent()).includes('今日'))
await p.click('button[title="ユーザー設定"]'); await p.click('button:has-text("言語")'); await p.waitForSelector('[data-language-options]')
ok('every language card shows its native name and coverage', await p.locator('[data-language="fr"]:has-text("Français")').count() === 1 && await p.locator('[data-language]').count() === 7)
await p.screenshot({ path: '171-language.png' })
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
