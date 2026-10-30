// Colour themes make the app's surfaces see-through. Anything floating over it (the self menu and its flyouts, the
// account switcher, profile cards, the phone sheet and its status and accounts panels) must stay solid and readable
// in light and dark themes alike: its text keeps WCAG AA contrast against the solid colour behind it.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish, openDms } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'); await openDms(a, b)
const g = await call(a.token, 'POST', '/guilds', { name: `Overlays ${S}` }); const ch = g.channels.find((c) => c.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: 'hello there' })
const themes = await (await fetch(process.env.PARLEY_API_ORIGIN + '/api/themes')).json()
const browser = await chromium.launch(); const errors = []

/** The lowest text contrast inside `scope`: each visible text's colour against the first solid background behind it. */
const worst = (p, scope) => p.evaluate((scope) => {
  const rgba = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1] }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const roots = [...document.querySelectorAll(scope)]
  if (!roots.length) return { n: 0 }
  let min = 99, at = '', n = 0
  for (const root of roots) for (const el of root.querySelectorAll('*')) {
    // Real text, not an avatar placeholder's initials.
    const own = [...el.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim().length > 2)
    if (!own || !el.offsetParent) continue
    const cs = getComputedStyle(el); if (parseFloat(cs.opacity) < 0.5) continue
    let bg = null
    for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); const c = rgba(s.backgroundColor); if (s.backgroundImage !== 'none' && c[3] < 0.5) { bg = null; break } if (c[3] >= 0.95) { bg = c; break } }
    if (!bg) continue
    const fg = rgba(cs.color), l1 = lum(fg), l2 = lum(bg), r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    n++
    if (r < min) { min = r; at = `${el.textContent.trim().slice(0, 24)} ${cs.color} on ${bg.join(',')}` }
  }
  return { n, min: Math.round(min * 100) / 100, at }
}, scope)

for (const slug of ['hanami', 'neon-nights']) {
  const th = themes.find((t) => t.slug === slug)
  console.log(`-- ${slug}`)
  const setup = async (vp) => {
    const p = await (await browser.newContext(vp)).newPage(); p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(`${WEB}/login`); await p.evaluate(([t, id]) => { localStorage.setItem('parley.token', t); localStorage.setItem('parley.appearance', JSON.stringify({ colorTheme: id })) }, [a.token, th.id])
    return p
  }
  const d = await setup({ viewport: { width: 1280, height: 800 } })
  await d.goto(`${WEB}/channels/${g.id}/${ch.id}`); await d.waitForSelector('[data-panel-self]'); await d.waitForTimeout(800)
  await d.click('[data-panel-self]'); await d.waitForSelector('[data-user-menu]'); await d.waitForTimeout(300)
  let w = await worst(d, '[data-user-menu]')
  ok(`${slug}: the self menu is readable`, w.n > 3 && w.min >= 4.5, JSON.stringify(w))
  await d.hover('[data-status-menu]'); await d.waitForSelector('[data-status-option="dnd"]'); await d.waitForTimeout(250)
  w = await worst(d, '[data-flyout-panel]')
  ok(`${slug}: the status flyout is readable`, w.n > 3 && w.min >= 4.5, JSON.stringify(w))
  await d.hover('[data-switch-accounts]'); await d.waitForSelector('[data-account-switcher]'); await d.waitForTimeout(250)
  w = await worst(d, '[data-flyout-panel]')
  ok(`${slug}: the account switcher is readable`, w.n >= 2 && w.min >= 4.5, JSON.stringify(w))
  await d.keyboard.press('Escape'); await d.mouse.click(700, 300); await d.waitForTimeout(200)
  await d.locator('[data-msg-author]').first().click(); await d.waitForSelector('[data-profile-popout] [data-profile-card]'); await d.waitForTimeout(300)
  w = await worst(d, '[data-profile-popout] [data-profile-card]')
  ok(`${slug}: a profile card is readable`, w.n > 3 && w.min >= 4.5, JSON.stringify(w))

  const m = await setup({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await m.goto(`${WEB}/channels/@me`); await m.waitForSelector('[data-panel-self]'); await m.waitForTimeout(800)
  await m.locator('[data-panel-self]').tap(); await m.waitForSelector('[data-profile-sheet]'); await m.waitForTimeout(500)
  w = await worst(m, '[data-profile-sheet] [data-profile-card]')
  ok(`${slug}: your phone sheet is readable`, w.n > 3 && w.min >= 4.5, JSON.stringify(w))
  w = await worst(m, '[data-self-dock]')
  ok(`${slug}: its floating bar is solid and readable`, w.n >= 3 && w.min >= 4.5, JSON.stringify(w))
  await m.locator('[data-self-dock-status]').tap(); await m.waitForSelector('[data-self-dock-panel="status"]'); await m.waitForTimeout(300)
  w = await worst(m, '[data-self-dock-panel]')
  ok(`${slug}: the status panel is solid and readable, the current status too`, w.n > 4 && w.min >= 4.5, JSON.stringify(w))
  await m.locator('[data-self-dock-backdrop]').tap({ position: { x: 20, y: 100 } }); await m.waitForTimeout(300)
  await m.locator('[data-self-dock-accounts]').tap(); await m.waitForSelector('[data-self-dock-panel="accounts"]'); await m.waitForTimeout(300)
  w = await worst(m, '[data-self-dock-panel]')
  ok(`${slug}: the accounts panel is solid and readable`, w.n >= 2 && w.min >= 4.5, JSON.stringify(w))
}
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); await finish()
