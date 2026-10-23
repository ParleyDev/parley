// Channel drag and drop: dropping on the top half of a channel puts the dragged one before it, the bottom half after
// it; channels move within, into and out of categories; categories reorder the same way. Each drop saves exactly one
// order (no second "append to the group" save from the container underneath), and the order survives a reload.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish } from '../lib.mjs'
const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Drag ${S}` })
const mk = (name, extra = {}) => call(a.token, 'POST', `/guilds/${g.id}/channels`, { name, kind: 'text', ...extra })
for (const c of g.channels) await call(a.token, 'DELETE', `/channels/${c.id}`).catch(() => {})
const A = await mk('alpha'), Bc = await mk('bravo'), C = await mk('charlie')
const cat = await mk('Zone', { kind: 'category' })
const X = await mk('xray', { parent_id: cat.id }), Y = await mk('yankee', { parent_id: cat.id })
const cat2 = await mk('Other', { kind: 'category' })
const names = { [A.id]: 'alpha', [Bc.id]: 'bravo', [C.id]: 'charlie', [X.id]: 'xray', [Y.id]: 'yankee' }

const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
let saves = 0; p.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/channels/positions')) saves++ })
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${A.id}`); await p.waitForSelector(`[data-channel-item="${A.id}"]`)

const group = (catId) => p.evaluate((cid) => {
  const box = cid ? document.querySelector(`[data-category="${cid}"]`) : document.querySelector('[data-channel-group=""]')
  return [...box.querySelectorAll('[data-channel-item]')].map((e) => e.getAttribute('data-channel-item'))
}, catId)
// The server keeps a guild's last default channel, so only the channels made here are compared.
const show = async (catId) => (await group(catId)).filter((id) => names[id]).map((id) => names[id]).join(',')
const cats = () => p.evaluate(() => [...document.querySelectorAll('[data-category]')].map((e) => e.getAttribute('data-category')))
/** Drag `id` onto the top or bottom part of `target`'s row. */
const drop = async (sel, targetSel, half) => {
  const box = await p.locator(targetSel).first().boundingBox()
  saves = 0
  await p.locator(sel).dragTo(p.locator(targetSel).first(), { targetPosition: { x: 40, y: half === 'top' ? 4 : box.height - 4 } })
  await p.waitForTimeout(600)
}
const row = (id) => `[data-channel-item="${id}"]`

console.log('-- within a group')
ok('start: alpha, bravo, charlie', await show(null) === 'alpha,bravo,charlie', await show(null))
await drop(row(A.id), row(Bc.id), 'bottom')
ok('dropping alpha on the bottom half of bravo moves it down one', await show(null) === 'bravo,alpha,charlie', await show(null))
ok('one drop saves once', saves === 1, String(saves))
await drop(row(C.id), row(Bc.id), 'top')
ok('dropping charlie on the top half of bravo puts it first', await show(null) === 'charlie,bravo,alpha', await show(null))
ok('still one save', saves === 1, String(saves))
await drop(row(C.id), row(A.id), 'bottom')
ok('dropping on the last channel\'s bottom half puts it last', await show(null) === 'bravo,alpha,charlie', await show(null))

console.log('-- across groups')
await drop(row(A.id), row(X.id), 'bottom')
ok('a channel dropped between two category channels lands exactly there', await show(cat.id) === 'xray,alpha,yankee' && await show(null) === 'bravo,charlie', `${await show(null)} | ${await show(cat.id)}`)
await drop(row(Y.id), row(Bc.id), 'top')
ok('and it can be dragged back out of a category to a precise spot', await show(null) === 'yankee,bravo,charlie' && await show(cat.id) === 'xray,alpha', `${await show(null)} | ${await show(cat.id)}`)
await drop(row(C.id), `[data-category="${cat2.id}"] [data-category-header]`, 'bottom')
ok('dropping on a category header moves the channel into it', await show(cat2.id) === 'charlie', await show(cat2.id))

console.log('-- categories')
await drop(`[data-category="${cat2.id}"] [data-category-header]`, `[data-category="${cat.id}"] [data-category-header]`, 'top')
ok('a category dropped on the top half of another goes before it', (await cats()).join() === [cat2.id, cat.id].join())
await drop(`[data-category="${cat2.id}"] [data-category-header]`, `[data-category="${cat.id}"] [data-category-header]`, 'bottom')
ok('and on the bottom half, after it', (await cats()).join() === [cat.id, cat2.id].join())

console.log('-- persistence')
const before = [await show(null), await show(cat.id), await show(cat2.id), (await cats()).join()]
await p.reload(); await p.waitForSelector(`[data-channel-item="${A.id}"]`)
const after = [await show(null), await show(cat.id), await show(cat2.id), (await cats()).join()]
ok('the order is the same after a reload', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`)

ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
