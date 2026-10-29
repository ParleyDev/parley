// The chat's layout and scrolling, against the dev chat simulator (/dev/chat-sim: two fake DMs of 500 messages, only in
// builds made with VITE_DEV_TOOLS=1) and a real DM: the message box in the layout under the list (not over it), 16/22
// text, a 44px box growing to half the window, compact system rows, and the list holding still or following the bottom
// as it should, with only the rows near the viewport in the DOM.
import { chromium } from 'playwright'
import { WEB, reg, call, ok, openDms, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob')
await openDms(a, b)
const browser = await chromium.launch(); const errors = []
const shots = process.env.SHOTS
const mk = async (phone) => {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
  return p
}
const geo = (p) => p.evaluate(() => {
  const el = document.querySelector('[data-message-list]'), box = document.querySelector('[data-composer-box]')
  const rows = [...el.querySelectorAll('[data-row-id]')]
  const last = rows[rows.length - 1]?.getBoundingClientRect()
  return { fromBottom: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight), listBottom: Math.round(el.getBoundingClientRect().bottom), boxTop: Math.round(box.getBoundingClientRect().top), boxH: Math.round(box.getBoundingClientRect().height), lastBottom: last ? Math.round(last.bottom) : null, dom: rows.length }
})
/** The row nearest the middle of the list and where it is: stays put when nothing should move. */
const pick = (p) => p.evaluate(() => {
  const el = document.querySelector('[data-message-list]'); const r = el.getBoundingClientRect(); const mid = r.top + r.height / 2
  const row = [...el.querySelectorAll('[data-row-id]')].find((x) => { const b = x.getBoundingClientRect(); return b.top <= mid && b.bottom >= mid })
  return row ? { id: row.dataset.rowId, top: row.getBoundingClientRect().top } : null
})
const topOf = (p, id) => p.evaluate((id) => document.querySelector(`[data-row-id="${id}"]`)?.getBoundingClientRect().top ?? null, id)
/** Largest distance the row moved from `top` in any frame while `act` runs. */
// What gets painted: a frame's position as of its animation-frame callback, unless a resize observer (the app's run
// first, then this one) moved things again before the paint.
const watch = async (p, at, act, ms) => {
  await p.evaluate(({ id, top }) => {
    window.__drift = 0; window.__frames = []
    const el = document.querySelector('[data-message-list]')
    const off = () => { const n = document.querySelector(`[data-row-id="${id}"]`); return n ? Math.abs(n.getBoundingClientRect().top - top) : 0 }
    let pending = 0
    const commit = () => { if (pending > 1) window.__frames.push([Math.round(pending), Math.round(el.scrollTop), el.scrollHeight]); window.__drift = Math.max(window.__drift, pending) }
    window.__ro = new ResizeObserver(() => { pending = off() }); window.__ro.observe(el.firstElementChild); window.__ro.observe(el)
    const f = () => { commit(); pending = off(); window.__driftF = requestAnimationFrame(f) }; f()
  }, at)
  await act(); await p.waitForTimeout(ms)
  const r = await p.evaluate(() => { cancelAnimationFrame(window.__driftF); window.__ro.disconnect(); return [Math.round(window.__drift * 10) / 10, window.__frames.slice(0, 6)] })
  if (r[0] > 1) console.log('     painted frames off by >1px [drift, scrollTop, scrollHeight]:', JSON.stringify(r[1]))
  return r[0]
}

const sim = await mk(false)
await sim.goto(`${WEB}/dev/chat-sim`)
const hasSim = await sim.waitForSelector('[data-chat-sim]', { timeout: 8000 }).then(() => true, () => false)
if (!hasSim) console.log('  (no /dev/chat-sim in this build: build with VITE_DEV_TOOLS=1 for the simulator checks)')
for (const [label, p] of hasSim ? [['desktop', sim], ['phone', await mk(true)]] : []) {
  console.log(`-- simulator, ${label}`)
  if (p !== sim) await p.goto(`${WEB}/dev/chat-sim`)
  await p.waitForSelector('[data-row-id]')
  let g = await geo(p)
  ok(`${label}: opens at the bottom at once`, g.fromBottom <= 1, JSON.stringify(g))
  ok(`${label}: the list ends above the message box, not under it`, g.listBottom <= g.boxTop + 1 && g.lastBottom <= g.boxTop, JSON.stringify(g))
  ok(`${label}: one-line message box is about 44px`, g.boxH >= 42 && g.boxH <= 48, String(g.boxH))
  const font = await p.evaluate(() => { const c = getComputedStyle(document.querySelector('.msg-content')), t = getComputedStyle(document.querySelector('textarea.composer-input')); return [c.fontSize, c.lineHeight, t.fontSize, t.lineHeight] })
  ok(`${label}: message and box text 16px / 22px`, font.join() === '16px,22px,16px,22px', font.join())
  if (shots) await p.screenshot({ path: `${shots}/after-sim-${label}.png` })

  await p.fill('textarea', Array.from({ length: 8 }, (_, i) => `draft line ${i + 1}`).join('\n')); await p.waitForTimeout(300)
  g = await geo(p)
  ok(`${label}: an 8-line draft keeps the last message in view above the box`, g.fromBottom <= 1 && g.lastBottom <= g.boxTop, JSON.stringify(g))
  await p.fill('textarea', Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n')); await p.waitForTimeout(300)
  const vh = await p.evaluate(() => innerHeight); g = await geo(p)
  ok(`${label}: the box stops growing at half the window`, g.boxH <= vh * 0.5 + 4 && g.boxH > vh * 0.4, `${g.boxH} of ${vh}`)
  await p.fill('textarea', ''); await p.waitForTimeout(300)
  ok(`${label}: and shrinks back, still pinned`, (await geo(p)).fromBottom <= 1)
  // Many lines in one input event (a paste): pinned straight away, before any resize observer could run, and after.
  const instant = await p.evaluate(() => {
    const t = document.querySelector('textarea'), el = document.querySelector('[data-message-list]')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'pasted 1\npasted 2\npasted 3\npasted 4\npasted 5\npasted 6\npasted 7')
    t.dispatchEvent(new Event('input', { bubbles: true }))
    return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)
  })
  await p.waitForTimeout(400); g = await geo(p)
  ok(`${label}: a 7-line paste in one go keeps the list pinned (at once and after)`, instant <= 1 && g.fromBottom <= 1 && g.boxH > 150 && g.lastBottom <= g.boxTop, JSON.stringify({ instant, g }))
  // The same draft restored on coming back to the conversation.
  await p.click('[data-sim-dm="sim-dm-b"]'); await p.waitForSelector('[data-row-id]'); await p.waitForTimeout(400)
  await p.click('[data-sim-dm="sim-dm-a"]'); await p.waitForTimeout(600); g = await geo(p)
  ok(`${label}: a multi-line draft restored on return keeps the list pinned`, g.fromBottom <= 1 && g.boxH > 150 && g.lastBottom <= g.boxTop, JSON.stringify(g))
  await p.fill('textarea', ''); await p.waitForTimeout(300)

  // Older pages: three of them, each prepended above what's on screen.
  await p.evaluate(() => { const el = document.querySelector('[data-message-list]'); el.scrollTop = el.scrollHeight - el.clientHeight - 700 }); await p.waitForTimeout(300)
  let at = await pick(p)
  const drift = await watch(p, at, async () => { for (let i = 0; i < 3; i++) { await p.click('[data-sim-older]'); await p.waitForTimeout(500) } }, 400)
  const loaded = await p.evaluate(() => document.querySelector('[data-sim-stats]').textContent)
  ok(`${label}: three older pages arrive without the view moving`, drift <= 1 && /^200 loaded/.test(loaded), `${drift}px, ${loaded}`)
  g = await geo(p)
  ok(`${label}: only rows near the viewport are in the DOM`, g.dom < 120 && await p.locator('[data-virtual-pad]').count() >= 1, `${g.dom} of 200`)
  // Scroll to the top of what's loaded: the next pages come in by themselves, still without a jump.
  await p.evaluate(() => { document.querySelector('[data-message-list]').scrollTop = 0 }); await p.waitForTimeout(1200)
  const stats = await p.evaluate(() => document.querySelector('[data-sim-stats]').textContent)
  const topRow = await p.evaluate(() => { const el = document.querySelector('[data-message-list]'); return Math.round(el.scrollTop) })
  ok(`${label}: scrolling to the top loads the next page and keeps the reader off the very top`, /^(2[5-9]\d|[3-4]\d\d) loaded/.test(stats) && topRow > 500, `${stats}, scrollTop ${topRow}`)

  // Scrolled up, five messages arrive: nothing moves, the bar counts them.
  await p.evaluate(() => { const el = document.querySelector('[data-message-list]'); el.scrollTop = el.scrollHeight - el.clientHeight - 2500 }); await p.waitForTimeout(400)
  at = await pick(p)
  const d3 = await watch(p, at, () => p.click('[data-sim-incoming="5"]'), 500)
  ok(`${label}: scrolled up, 5 incoming messages don't move the view`, d3 <= 1, `${d3}px`)
  ok(`${label}: and the bar shows 5 new messages`, await p.locator('[data-new-count="5"]').count() === 1)
  if (shots) await p.screenshot({ path: `${shots}/after-sim-${label}-new.png` })

  // Switch DM and back: the same row at the same place.
  at = await pick(p)
  await p.click('[data-sim-dm="sim-dm-b"]'); await p.waitForSelector('[data-row-id]'); await p.waitForTimeout(500)
  ok(`${label}: the other DM opens at its bottom`, (await geo(p)).fromBottom <= 1)
  await p.click('[data-sim-dm="sim-dm-a"]'); await p.waitForTimeout(600)
  const back = await topOf(p, at.id)
  ok(`${label}: coming back restores the position`, back !== null && Math.abs(back - at.top) <= 1, `${at.top} → ${back}`)

  // Jump to Present, then an image that loads two seconds after its message: stays pinned.
  await p.click('[data-jump-present]'); await p.waitForTimeout(800)
  ok(`${label}: Jump to Present lands at the bottom and the bar goes`, (await geo(p)).fromBottom <= 1 && await p.locator('[data-older-bar]').count() === 0)
  await p.click('[data-sim-image]'); await p.waitForTimeout(300)
  ok(`${label}: (the message arrives pinned)`, (await geo(p)).fromBottom <= 1)
  await p.waitForTimeout(2300)
  g = await geo(p)
  const img = await p.locator('[data-message-list] img[alt="screenshot.png"], [data-message-list] img[src^="data:image/png"]').last().boundingBox()
  ok(`${label}: the image loads 2s later and the list stays pinned to it`, g.fromBottom <= 1 && img && img.y + img.height <= g.boxTop, JSON.stringify({ g, img }))
  if (shots) await p.screenshot({ path: `${shots}/after-sim-${label}-image.png` })
  // Sending keeps it pinned too.
  await p.fill('textarea', 'my reply'); await p.press('textarea', 'Enter'); await p.waitForTimeout(700)
  ok(`${label}: my own message lands pinned at the bottom`, (await geo(p)).fromBottom <= 1 && (await p.locator('[data-row-id]').last().textContent()).includes('my reply'))
}

console.log('-- a real DM: system rows')
const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
await call(b.token, 'POST', `/channels/${dm.id}/messages`, { content: 'hi' })
await call(a.token, 'PATCH', `/channels/${dm.id}`, { e2ee: false }); await call(b.token, 'PATCH', `/channels/${dm.id}`, { e2ee: true }); await call(a.token, 'PATCH', `/channels/${dm.id}`, { e2ee: false })
await call(b.token, 'POST', `/channels/${dm.id}/messages`, { content: 'back to messages' })
for (const [label, p] of [['desktop', await mk(false)], ['phone', await mk(true)]]) {
  await p.goto(`${WEB}/channels/@me/${dm.id}`); await p.waitForSelector('[data-system="call_e2ee_change"]'); await p.waitForTimeout(800)
  const sys = await p.evaluate(() => [...document.querySelectorAll('[data-system="call_e2ee_change"]')].map((r) => { const b = r.getBoundingClientRect(), tm = r.querySelector('[data-sys-time]').getBoundingClientRect(), icon = r.firstElementChild.getBoundingClientRect(); return { top: Math.round(b.top), h: Math.round(b.height), timeRight: Math.round(tm.right), rowRight: Math.round(b.right), iconL: Math.round(icon.left), iconW: Math.round(icon.width), timeFont: getComputedStyle(r.querySelector('[data-sys-time]')).fontSize } }))
  const avatar = await p.evaluate(() => { const r = document.querySelector('[data-msg-avatar]').getBoundingClientRect(); return { l: Math.round(r.left), w: Math.round(r.width) } })
  // 22px lines and 2px padding: one line at desktop width; on a phone the text may wrap to a second.
  ok(`${label}: system rows are 22px lines with 2px padding`, sys.length === 3 && sys.every((s) => (s.h - 4) % 22 === 0 && (label === 'phone' || s.h === 26)), JSON.stringify(sys))
  ok(`${label}: consecutive ones form a tight list`, sys[1].top - sys[0].top === sys[0].h && sys[2].top - sys[1].top === sys[1].h)
  ok(`${label}: the icon sits in the avatar column`, sys.every((s) => s.iconL === avatar.l && s.iconW === avatar.w), JSON.stringify({ sys: sys[0], avatar }))
  ok(`${label}: the time follows the text in 12px, not at the far edge`, sys.every((s) => s.timeFont === '12px' && s.timeRight < s.rowRight - 40), JSON.stringify(sys[0]))
  const pasted = await p.evaluate(() => {
    const t = document.querySelector('textarea'), el = document.querySelector('[data-message-list]')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'a\nb\nc\nd\ne\nf')
    t.dispatchEvent(new Event('input', { bubbles: true }))
    const r = Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true }))
    return r
  })
  ok(`${label}: a multi-line paste in the real DM stays pinned`, pasted <= 1, String(pasted))
  await p.waitForTimeout(300)
  const g = await geo(p)
  ok(`${label}: the list ends above the message box`, g.listBottom <= g.boxTop + 1 && g.fromBottom <= 1, JSON.stringify(g))
  if (shots) await p.screenshot({ path: `${shots}/after-dm-${label}.png` })
}
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
