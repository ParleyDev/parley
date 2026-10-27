// Floating UI stays inside the window: tooltips, menus and popovers that would open past an edge are nudged back in
// (the desktop app cuts off anything outside its window), including ones that grow after opening.
import { chromium } from 'playwright'
import { WEB, reg, ok, finish } from '../lib.mjs'
const a = await reg('alice')
const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/@me`); await p.waitForTimeout(1500)
const inside = (sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.left >= 7 && r.top >= 7 && r.right <= innerWidth - 7 && r.bottom <= innerHeight - 7 }, sel)
await p.evaluate(() => { const t = document.createElement('span'); t.setAttribute('role', 'tooltip'); t.id = 'tip'; t.textContent = 'A rather long tooltip near the right edge'; Object.assign(t.style, { position: 'fixed', left: `${innerWidth - 60}px`, top: '40px', whiteSpace: 'nowrap', padding: '6px' }); document.body.appendChild(t) })
await p.waitForTimeout(400)
ok('a tooltip past the right edge is moved inside', await inside('#tip'))
await p.evaluate(() => { const m = document.createElement('div'); m.className = 'pop'; m.id = 'menu'; Object.assign(m.style, { position: 'fixed', left: '20px', top: `${innerHeight - 80}px`, width: '200px', height: '60px' }); document.body.appendChild(m) })
await p.waitForTimeout(400)
ok('a popover near the bottom is moved inside', await inside('#menu'))
await p.evaluate(() => { document.getElementById('menu').style.height = '260px' })
await p.waitForTimeout(400)
ok('and kept inside when it grows', await inside('#menu'))
await p.evaluate(() => { const m = document.createElement('div'); m.className = 'pop'; m.id = 'fine'; Object.assign(m.style, { position: 'fixed', left: '100px', top: '100px', width: '100px', height: '50px' }); document.body.appendChild(m) })
await p.waitForTimeout(400)
ok('ones already inside are left alone', await p.evaluate(() => document.getElementById('fine').style.translate === ''))
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
