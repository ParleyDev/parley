// Importing cosmetics from a folder laid out like the assets folder (a subfolder per kind, each with metadata.json),
// picked in the admin console: the server says which items it already has (by file or folder name), which clash with
// an item of the same id, and which are new; only the new ones are added, files and metadata entry as they were
// (shop fields and all). At the API: only staff, nothing already there is overwritten, a layered item needs every
// file its layers name, and a read-only folder refuses. The folder is put back afterwards.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { B, WEB, FIX, call, ok, finish, adminToken, reg, launchBrowser, testContainer } from '../lib.mjs'

const admin = await adminToken()
const a = await reg('alice')
const B2 = process.env.PARLEY_API_ORIGIN2 ? `${process.env.PARLEY_API_ORIGIN2}/api` : null
const DIRS = { decoration: 'avatar-decorations', nameplate: 'nameplates', effect: 'profile-effects', frame: 'profile-frames' }
const C = testContainer('backend')
const inAssets = (cmd, input) => execFileSync('docker', ['exec', ...(input === undefined ? [] : ['-i']), C, 'sh', '-c', `cd "\${ASSETS_DIR:-./assets}" && ${cmd}`], { input, encoding: 'utf8' })
const metaFile = (kind) => `${DIRS[kind]}/metadata.json`
const has = (p) => inAssets(`test -e '${p}' && echo y || true`).trim() === 'y'
// A folder without metadata.json yet (the scan names items after their files) counts as an empty list.
const metaOf = (kind) => has(metaFile(kind)) ? JSON.parse(inAssets(`cat '${metaFile(kind)}'`)) : { items: [] }
const before = Object.fromEntries(Object.keys(DIRS).map((k) => [k, has(metaFile(k)) ? inAssets(`cat '${metaFile(k)}'`) : null]))
const made = []
let restored = false
const restoreFolder = () => {
  if (restored) return
  restored = true
  for (const p of made) inAssets(`rm -rf '${p}'`)
  for (const [k, text] of Object.entries(before)) { if (text === null) inAssets(`rm -f '${metaFile(k)}'`); else inAssets(`cat > '${metaFile(k)}'`, text) }
}
process.on('exit', restoreFolder)

// The folder to import from: one item of each standing, and a new effect with its layers.
const n = Date.now() % 1_000_000
const png = join(FIX, 'assets', 'avatar-decorations', 'e2e_ring.png')
const src = mkdtempSync(join(tmpdir(), 'parley-import-')), root = join(src, 'export')
const DEC = join(root, 'avatar-decorations'), FX = join(root, 'profile-effects')
mkdirSync(join(FX, `imp_fx_${n}`), { recursive: true }); mkdirSync(DEC, { recursive: true })
const newDec = { file: `imp_ring_${n}.png`, name: `Imp Ring ${n}`, description: 'from elsewhere', in_shop: true, shop_item_id: '42', price: { amount: 5.99, currency: 'CAD' } }
writeFileSync(join(DEC, 'metadata.json'), JSON.stringify({ source: 'elsewhere', items: [
  { file: 'e2e_ring.png', name: 'Already here, renamed', description: 'must not overwrite' },
  newDec,
  { file: 'E2E_Ring.png', name: 'Same id as e2e_ring' },
  { file: `Imp Bad ${n}.png`, name: 'Bad name' },
  { file: `imp_missing_${n}.png`, name: 'No file' },
], item_count: 5 }))
for (const f of ['e2e_ring.png', newDec.file, 'E2E_Ring.png', `Imp Bad ${n}.png`]) copyFileSync(png, join(DEC, f))
const newFx = { folder: `imp_fx_${n}`, name: `Imp FX ${n}`, description: 'layers', dynamic: true, layers: [{ start_ms: 0, duration_ms: 1000, loop: false, loop_delay_ms: 0, z_index: 100, file: 'layer_01.png' }] }
writeFileSync(join(FX, 'metadata.json'), JSON.stringify({ items: [newFx] }))
copyFileSync(png, join(FX, newFx.folder, 'layer_01.png')); copyFileSync(png, join(FX, newFx.folder, 'static.png'))
writeFileSync(join(root, 'notes.txt'), 'not a cosmetic')
made.push(`${DIRS.decoration}/${newDec.file}`, `${DIRS.effect}/${newFx.folder}`)

console.log('-- at the API')
const check = (tok, kind, keys, origin = B) => fetch(`${origin}/admin/cosmetics/${kind}/import/check`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ keys }) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
const send = async (kind, entry, files, origin = B) => {
  const form = new FormData()
  form.append('entry', JSON.stringify(entry))
  for (const [name, path] of files) form.append('file', new Blob([readFileSync(path)], { type: 'image/png' }), name)
  const r = await fetch(`${origin}/admin/cosmetics/${kind}/import`, { method: 'POST', headers: { Authorization: `Bearer ${admin.token}` }, body: form })
  return { status: r.status, body: await r.json().catch(() => null) }
}
ok('only staff can import', (await check(a.token, 'decoration', ['x.png'])).status === 403)
const st = await check(admin.token, 'decoration', ['e2e_ring.png', newDec.file, 'E2E_Ring.png'])
ok('the server says what it has, what clashes and what is new', st.status === 200 && st.body.keys['e2e_ring.png'] === 'present' && st.body.keys['E2E_Ring.png'] === 'clash' && st.body.keys[newDec.file] === 'missing', JSON.stringify(st.body))
let r = await send('decoration', { file: 'e2e_ring.png', name: 'Overwrite?' }, [['e2e_ring.png', png]])
ok('an item already there is not overwritten (409)', r.status === 409 && metaOf('decoration').items.every((i) => i.name !== 'Overwrite?'), JSON.stringify(r.body))
r = await send('decoration', { file: 'E2E_Ring.png' }, [['E2E_Ring.png', png]])
ok('nor one with the same id (409)', r.status === 409 && !has(`${DIRS.decoration}/E2E_Ring.png`), JSON.stringify(r.body))
r = await send('decoration', { file: `imp_other_${n}.png` }, [[`imp_x_${n}.png`, png]])
ok('the file sent must be the one its entry names', r.status === 400 && !has(`${DIRS.decoration}/imp_x_${n}.png`), JSON.stringify(r.body))
r = await send('effect', { ...newFx, layers: [...newFx.layers, { ...newFx.layers[0], file: 'layer_02.png' }] }, [['layer_01.png', png]])
ok('a layered item needs every file its layers name, and leaves nothing behind without', r.status === 400 && /layer_02/.test(r.body?.error) && !has(`${DIRS.effect}/${newFx.folder}`), JSON.stringify(r.body))
r = await send('effect', { ...newFx, folder: '../up' }, [['layer_01.png', png]])
ok('a folder name must be safe', r.status === 400, JSON.stringify(r.body))
if (B2) {
  const ro = await send('decoration', newDec, [[newDec.file, png]], B2)
  ok('a read-only folder refuses', ro.status === 409 && /read-only|writable/i.test(ro.body?.error), JSON.stringify(ro.body))
}

console.log('-- in the admin console')
const browser = await launchBrowser(); const errors = []
const p = await browser.newPage({ viewport: { width: 1280, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), admin.token)
await p.goto(`${WEB}/admin/cosmetics`); await p.waitForSelector('[data-cosmetics-import-open]', { timeout: 15000 })
await p.click('[data-cosmetics-import-open]')
await p.setInputFiles('[data-cosmetics-import-input]', root)
await p.waitForSelector('[data-cosmetics-import-kind="decoration"] [data-cosmetics-import-counts]', { timeout: 15000 })
const counts = (k) => p.locator(`[data-cosmetics-import-kind="${k}"] [data-cosmetics-import-counts]`).getAttribute('data-cosmetics-import-counts')
ok('decorations: 5 in the folder, 1 already here, 1 new', await counts('decoration') === '5/1/1', await counts('decoration'))
ok('effects: 1 new', await counts('effect') === '1/0/1', await counts('effect'))
const dt = await p.locator('[data-cosmetics-import-kind="decoration"]').textContent()
ok('the clash, the bad name and the missing file are each said', /E2E_Ring\.png/.test(dt) && /Imp Bad/.test(dt) && new RegExp(`imp_missing_${n}`).test(dt), dt)
ok('the button adds the 2 new items', /Add 2 items/.test(await p.locator('[data-cosmetics-import-go]').textContent()))
await p.click('[data-cosmetics-import-go]')
await p.waitForFunction(() => /Done|Stopped/.test(document.querySelector('[data-cosmetics-import-progress]')?.textContent ?? ''), null, { timeout: 30000 })
const prog = await p.locator('[data-cosmetics-import-progress]').textContent()
ok('both are added, with no failures', /Done: 2 added/.test(prog) && await p.locator('[data-cosmetics-import-failed]').count() === 0, prog)
const decMeta = metaOf('decoration'), fxMeta = metaOf('effect')
const got = decMeta.items.find((i) => i.file === newDec.file)
ok('the decoration is in the folder with its entry as it was (shop fields too)', has(`${DIRS.decoration}/${newDec.file}`) && JSON.stringify(got) === JSON.stringify(newDec), JSON.stringify(got))
ok('the existing entry is untouched', decMeta.items.find((i) => i.file === 'e2e_ring.png')?.name !== 'Already here, renamed')
ok('the effect has its folder, every file, and its entry', has(`${DIRS.effect}/${newFx.folder}/layer_01.png`) && has(`${DIRS.effect}/${newFx.folder}/static.png`) && JSON.stringify(fxMeta.items.find((i) => i.folder === newFx.folder)) === JSON.stringify(newFx))
ok('item_count follows the list', decMeta.item_count === undefined || decMeta.item_count === decMeta.items.length)
const listed = await call(admin.token, 'GET', '/admin/cosmetics/decoration')
ok('and it is on the list straight away', listed.some((i) => i.value === `asset:imp_ring_${n}` && i.name === newDec.name), JSON.stringify(listed.map((i) => i.value)).slice(0, 300))
// The same folder again: nothing new.
await p.click('[data-cosmetics-import-close]')
await p.click('[data-cosmetics-import-open]')
await p.setInputFiles('[data-cosmetics-import-input]', root)
await p.waitForSelector('[data-cosmetics-import-nothing]', { timeout: 15000 })
ok('picked again, it has nothing new to add', await p.locator('[data-cosmetics-import-go]').isDisabled())
await browser.close()

rmSync(src, { recursive: true, force: true })
restoreFolder()
ok('no page errors', errors.length === 0, errors.join(' | '))
await finish()
