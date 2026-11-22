// Tags on assets-folder cosmetics: `"tags": [...]` in a kind's metadata.json groups items. The lists serve them cleaned
// (lower case, no '#', no repeats); the profile editor's pickers and the admin console's Cosmetics list search them and
// filter by them; the admin's folder editor writes them back to metadata.json (and drops the key when emptied).
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { WEB, B, FIX, reg, call, ok, finish, adminToken, testContainer, openProfileEditor } from '../lib.mjs'

const admin = await adminToken()
const a = await reg('tagger')
const C = testContainer('backend')
const inAssets = (cmd, input) => execFileSync('docker', ['exec', ...(input === undefined ? [] : ['-i']), C, 'sh', '-c', `cd "\${ASSETS_DIR:-./assets}" && ${cmd}`], { input, encoding: 'utf8' })
const META = 'avatar-decorations/metadata.json'
const hadMeta = inAssets(`test -e '${META}' && echo y || true`).trim() === 'y'
const before = hadMeta ? inAssets(`cat '${META}'`) : null
const n = Date.now() % 1_000_000
const XMAS = `xmas${n}`, WINTER = `winter${n}`, FESTIVE = `festive${n}`
const made = []
let restored = false
const restore = () => {
  if (restored) return
  restored = true
  for (const f of made) inAssets(`rm -f 'avatar-decorations/${f}'`)
  if (before === null) inAssets(`rm -f '${META}'`); else inAssets(`cat > '${META}'`, before)
}
process.on('exit', restore)

// Three decorations, their entries as an instance's metadata.json might have them (mixed case, '#', a repeat).
const png = readFileSync(join(FIX, 'assets', 'avatar-decorations', 'e2e_ring.png'))
const items = [
  { file: `holly_${n}.png`, name: `Holly ${n}`, description: 'A ring of holly and berries.', tags: [` ${XMAS.toUpperCase()} `, `#${WINTER}`, XMAS] },
  { file: `snow_${n}.png`, name: `Snow ${n}`, tags: [WINTER] },
  { file: `plain_${n}.png`, name: `Plain ${n}` },
]
for (const entry of items) {
  const form = new FormData()
  form.append('entry', JSON.stringify(entry))
  form.append('file', new Blob([png], { type: 'image/png' }), entry.file)
  const r = await fetch(`${B}/admin/cosmetics/decoration/import`, { method: 'POST', headers: { Authorization: `Bearer ${admin.token}` }, body: form })
  if (r.ok) made.push(entry.file)
}
ok('the tagged items are in place', made.length === 3, String(made.length))
const holly = `asset:holly_${n}`, snow = `asset:snow_${n}`

console.log('-- the lists')
const list = await (await fetch(`${B}/assets/avatar-decorations`)).json()
const byId = Object.fromEntries(list.map((d) => [d.id, d]))
ok('tags are served cleaned: lower case, no #, no repeats', JSON.stringify(byId[`holly_${n}`]?.tags) === JSON.stringify([XMAS, WINTER]), JSON.stringify(byId[`holly_${n}`]?.tags))
ok('an untagged item has none', byId[`plain_${n}`] && byId[`plain_${n}`].tags === undefined)
const adminList = await call(admin.token, 'GET', '/admin/cosmetics/decoration')
ok('the admin list has them too', JSON.stringify(adminList.find((i) => i.value === snow)?.tags) === JSON.stringify([WINTER]))

const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token); await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('[data-panel-self]')
const shown = () => p.locator('[data-cosmetic-grid] [data-cosmetic-option]').evaluateAll((es) => es.map((e) => e.getAttribute('data-cosmetic-option')))

console.log('-- the picker')
await openProfileEditor(p, { section: 'decoration' })
await p.waitForSelector(`[data-cosmetic-tag="${WINTER}"]`)
ok('the tags are listed under the search, with how many have each', (await p.textContent(`[data-cosmetic-tag="${WINTER}"]`)).replace(/\s+/g, ' ').includes(`#${WINTER} 2`))
await p.click(`[data-cosmetic-tag="${WINTER}"]`)
let now = await shown()
ok('clicking one shows only the items with it', now.length === 2 && now.includes(holly) && now.includes(snow), now.join(','))
ok('without None or the built-in ones', !now.includes('none') && !now.includes('gold'))
await p.waitForTimeout(300); await p.screenshot({ path: 'cosmetictags-picker.png' })
await p.click(`[data-cosmetic-tag="${WINTER}"]`)
now = await shown()
ok('clicking it again shows everything', now.includes('none') && now.length > 3, String(now.length))
await p.fill('[data-cosmetic-search]', XMAS)
now = await shown()
ok('searching a tag finds its items', now.length === 1 && now[0] === holly, now.join(','))
await p.fill('[data-cosmetic-search]', `#${WINTER}`)
ok('with or without the #', (await shown()).length === 2)
await p.fill('[data-cosmetic-search]', `Holly ${n}`)
await p.click(`[data-cosmetic-grid] [data-cosmetic-option="${holly}"]`)
ok('the picked item\'s tags show with its description', (await p.textContent('[data-cosmetic-info-tags]')).includes(`#${XMAS}`))
await p.click(`[data-cosmetic-info-tags] button:has-text("#${XMAS}")`)
now = await shown()
ok('and clicking one there filters by it', now.length === 1 && now[0] === holly && await p.getAttribute(`[data-cosmetic-tag="${XMAS}"]`, 'aria-pressed') === 'true', now.join(','))
await p.fill('[data-cosmetic-search]', 'no such thing')
ok('a filter with nothing in it says so', await p.locator('[data-cosmetic-nothing]').count() === 1)
await p.click('[data-cosmetic-cancel]')

console.log('-- admin console')
const pa = await browser.newPage({ viewport: { width: 1440, height: 900 } }); pa.on('pageerror', (e) => errors.push(e.message))
await pa.goto(`${WEB}/login`); await pa.evaluate((t) => localStorage.setItem('parley.token', t), admin.token); await pa.goto(`${WEB}/admin/cosmetics`)
await pa.waitForSelector('[data-cosmetic-list="decoration"]')
// Only this run's items (the list is drawn a page at a time).
await pa.fill('[data-cosmetic-search]', String(n))
await pa.waitForSelector(`[data-cosmetic-row="${holly}"]`)
const rows = () => pa.locator('[data-cosmetic-list="decoration"] [data-cosmetic-row]').evaluateAll((es) => es.map((e) => e.getAttribute('data-cosmetic-row')))
ok('each row shows its tags', (await pa.textContent(`[data-cosmetic-row="${holly}"] [data-cosmetic-row-tags]`)).includes(`#${WINTER}`))
await pa.click(`[data-cosmetic-tags] [data-cosmetic-tag="${WINTER}"]`)
let r = await rows()
ok('the tag row filters the list', r.length === 2 && r.includes(holly) && r.includes(snow), r.join(','))
await pa.click(`[data-cosmetic-tags] [data-cosmetic-tag="${WINTER}"]`)
ok('clicking it again shows them all', (await rows()).length === 3)
await pa.fill('[data-cosmetic-search]', XMAS)
r = await rows()
ok('and search finds by tag', r.length === 1 && r[0] === holly, r.join(','))
await pa.click(`[data-cosmetic-edit="${holly}"]`); await pa.waitForSelector('[data-cosmetic-tags-input]')
ok('the editor has its tags', (await pa.inputValue('[data-cosmetic-tags-input]')) === `${XMAS}, ${WINTER}`)
await pa.fill('[data-cosmetic-tags-input]', `${XMAS}, #${FESTIVE.toUpperCase()},, ${XMAS}`)
await pa.waitForTimeout(200); await pa.screenshot({ path: 'cosmetictags-editor.png' })
await pa.click('[data-cosmetic-save]'); await pa.waitForSelector('[data-cosmetic-folder-draft]', { state: 'detached' })
const entry = () => JSON.parse(inAssets(`cat '${META}'`)).items.find((i) => i.file === `holly_${n}.png`)
ok('saving writes the cleaned tags to metadata.json', JSON.stringify(entry()?.tags) === JSON.stringify([XMAS, FESTIVE]), JSON.stringify(entry()?.tags))
ok('keeping the entry\'s other fields', entry()?.description === 'A ring of holly and berries.')
ok('and the list has them at once', JSON.stringify((await call(admin.token, 'GET', '/admin/cosmetics/decoration')).find((i) => i.value === holly)?.tags) === JSON.stringify([XMAS, FESTIVE]))
await pa.fill('[data-cosmetic-search]', String(n))
await pa.click(`[data-cosmetic-edit="${holly}"]`); await pa.waitForSelector('[data-cosmetic-tags-input]')
await pa.fill('[data-cosmetic-tags-input]', '')
await pa.click('[data-cosmetic-save]'); await pa.waitForSelector('[data-cosmetic-folder-draft]', { state: 'detached' })
ok('emptying them removes the key', entry() && !('tags' in entry()), JSON.stringify(entry()))
const bad = await fetch(`${B}/admin/cosmetics/decoration/folder/snow_${n}`, { method: 'PATCH', headers: { Authorization: `Bearer ${admin.token}` }, body: (() => { const f = new FormData(); f.append('meta', JSON.stringify({ tags: 'winter' })); return f })() })
ok('tags that aren\'t a list are refused', bad.status === 400, String(bad.status))
await pa.close()

console.log('-- Profile Studio (a cosmetics.manage token) and the API reference')
const asm = await (await fetch(`${WEB}/.well-known/oauth-authorization-server`)).json()
const local = (u) => u.replace(/^https?:\/\/[^/]+/, WEB)
const redirect = 'http://localhost:7777/callback'
const client = await (await fetch(local(asm.registration_endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: `Studio ${n}`, redirect_uris: [redirect], token_endpoint_auth_method: 'none' }) })).json()
const v = crypto.randomBytes(32).toString('base64url'), ch = crypto.createHash('sha256').update(v).digest('base64url')
const prm = await (await fetch(`${WEB}/.well-known/oauth-protected-resource/mcp`)).json()
const granted = await call(admin.token, 'POST', '/mcp/consent', { response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: ch, code_challenge_method: 'S256', resource: prm.resource, scope: 'cosmetics.manage', approve: true, scopes: ['cosmetics.manage'] })
const tok = await (await fetch(local(asm.token_endpoint), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: new URL(granted.redirect).searchParams.get('code'), redirect_uri: redirect, client_id: client.client_id, code_verifier: v, resource: prm.resource }) })).json()
ok('a tool gets a cosmetics.manage token', tok.scope === 'cosmetics.manage', JSON.stringify(tok))
const studio = { Authorization: `Bearer ${tok.access_token}` }
const sl = await (await fetch(`${B}/admin/cosmetics/decoration`, { headers: studio })).json()
ok('it reads the tags', JSON.stringify(sl.find?.((i) => i.value === snow)?.tags) === JSON.stringify([WINTER]), JSON.stringify(sl).slice(0, 200))
const sf = new FormData(); sf.append('meta', JSON.stringify({ tags: [`#${FESTIVE}`, WINTER] }))
const sr = await fetch(`${B}/admin/cosmetics/decoration/folder/snow_${n}`, { method: 'PATCH', headers: studio, body: sf })
const snowEntry = JSON.parse(inAssets(`cat '${META}'`)).items.find((i) => i.file === `snow_${n}.png`)
ok('and writes them', sr.ok && JSON.stringify(snowEntry?.tags) === JSON.stringify([FESTIVE, WINTER]), `${sr.status} ${JSON.stringify(snowEntry)}`)
const spec = await (await fetch(`${B}/v1/openapi.json`)).json()
const op = spec.paths['/admin/cosmetics/{kind}/folder/{id}']?.patch
ok('the API reference documents tags and the tool scope', op?.summary.includes('tags') && JSON.stringify(op.security).includes('cosmetics.manage') && spec.paths['/assets/avatar-decorations']?.get?.summary.includes('tags'))

await browser.close()
restore()
ok('no page errors', errors.length === 0, errors.join(' | '))
await finish()
