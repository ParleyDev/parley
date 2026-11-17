// Server templates as files and links, like Discord: Server Settings › Server Template downloads the server as a
// template file (no link needed); Create Server › Use a Template makes a server from that file (chosen or dropped), from
// a template link on this Parley server or on another one (read by the app, so this server never fetches addresses
// people type), or from a code; a file from a newer Parley or a broken one says so; the template page downloads it too.
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'

const API2 = process.env.PARLEY_API_ORIGIN2 ?? 'http://localhost:18091'
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Files ${S}` })
const cat = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'Staff', kind: 'category' })
const staff = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'staff-chat', kind: 'text', parent_id: cat.id })
await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'Lounge', kind: 'voice' })
const role = await call(a.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Helper', color: '#3498db' })
await call(a.token, 'PUT', `/channels/${staff.id}/permissions/${g.id}`, { kind: 'role', allow: 0, deny: 1 << 10 })
await call(a.token, 'PUT', `/channels/${staff.id}/permissions/${role.id}`, { kind: 'role', allow: 1 << 10, deny: 0 })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)

console.log('-- api')
ok('members without Manage Server can\'t export', (await raw(b.token, 'GET', `/guilds/${g.id}/template/export`)).status === 403)
const r = await raw(a.token, 'GET', `/guilds/${g.id}/template/export`)
const file = await r.json()
ok('the export is a download named after the server', /attachment; filename="Files \d+\.parley-template\.json"/.test(r.headers.get('content-disposition') ?? ''), r.headers.get('content-disposition'))
ok('it is a versioned Parley template file', file.parley_template === 1 && file.name === `Files ${S}` && typeof file.exported_at === 'string')
ok('with the channels, roles and overwrites', file.snapshot.roles.some((x) => x.name === 'Helper') && file.snapshot.channels.some((c) => c.name === 'staff-chat' && c.overwrites.length === 2))
const pv = await call(b.token, 'POST', '/templates/import/preview', { source: JSON.stringify(file) })
ok('anyone can preview a file', pv.kind === 'parley' && pv.name === `Files ${S}` && pv.snapshot.channels.length === file.snapshot.channels.length, JSON.stringify(pv).slice(0, 200))
const newer = await raw(b.token, 'POST', '/templates/import/preview', { source: JSON.stringify({ ...file, parley_template: 99 }) })
ok('a file from a newer Parley says so', newer.status === 400 && /newer version/.test((await newer.json()).error))
ok('a broken file says so', (await raw(b.token, 'POST', '/templates/import/preview', { source: '{"parley_template":1,"snapshot":{"roles":"nope"}}' })).status === 400)
ok('an unknown code says so', (await raw(b.token, 'POST', '/templates/import/preview', { source: 'http://localhost:5199/template/zzzzzzzzzzzz' })).status === 404)

const tpl = await call(a.token, 'POST', `/guilds/${g.id}/template`, { name: `Shared ${S}`, description: 'For files' })
const pub = await fetch(`${API2}/api/templates/${tpl.code}/export`, { headers: { Origin: 'http://elsewhere.example' } })
ok('a shared template\'s file is public, readable from another site', pub.ok && (await pub.json()).name === `Shared ${S}` && !!pub.headers.get('access-control-allow-origin'), pub.headers.get('access-control-allow-origin'))
ok('a code works too, and counts as a use', (await call(b.token, 'POST', '/templates/import', { source: tpl.code, name: `By code ${S}` }))?.name === `By code ${S}` && (await call(a.token, 'GET', `/guilds/${g.id}/template`)).usage_count === 1)

const browser = await chromium.launch(); const errors = []
const ctx = async (t) => { const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }); const p = await c.newPage(); p.on('pageerror', (x) => errors.push(x.message)); await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), t); return p }

console.log('-- download from Server Settings')
const pa = await ctx(a.token)
await pa.goto(`${WEB}/channels/${g.id}`); await pa.waitForTimeout(800)
await pa.locator(`button:has-text("Files ${S}")`).first().click(); await pa.click('text=Server Settings'); await pa.click('[data-settings-tab="template"]')
await pa.waitForSelector('[data-template-file]')
const [dl] = await Promise.all([pa.waitForEvent('download'), pa.click('[data-template-download]')])
const saved = JSON.parse(readFileSync(await dl.path(), 'utf8'))
ok('Download template file saves the server as a file', dl.suggestedFilename() === `Files ${S}.parley-template.json` && saved.parley_template === 1 && saved.snapshot.channels.length === file.snapshot.channels.length, dl.suggestedFilename())
await pa.keyboard.press('Escape')

console.log('-- Use a Template')
const pb = await ctx(b.token)
await pb.goto(`${WEB}/channels/@me`); await pb.waitForSelector('[data-add-server]')
const start = async () => { await pb.click('[data-add-server]'); await pb.click('[data-template="import"]'); await pb.waitForSelector('[data-template-import]') }
await start()
await pb.locator('[data-import-file]').setInputFiles({ name: 'files.parley-template.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) })
await pb.waitForSelector('[data-import-preview-channels]')
ok('choosing the file previews it as a Parley template', await pb.locator('[data-import-kind="parley"]').count() === 1 && (await pb.locator('[data-template-import]').innerText()).includes('staff-chat'))
await pb.fill('[data-create-name]', `From file ${S}`)
await pb.click('[data-import-create]'); await pb.waitForURL(/\/channels\/[0-9a-f-]{36}/, { timeout: 10000 })
const newId = /\/channels\/([0-9a-f-]{36})/.exec(pb.url())[1]
const mine = await call(b.token, 'GET', `/guilds/${newId}`)
const chans = mine ? await call(b.token, 'GET', `/guilds/${mine.id}/channels`) : []
const roles = mine ? await call(b.token, 'GET', `/guilds/${mine.id}/roles`) : []
const made = chans.find((c) => c.name === 'staff-chat')
ok('it is named as typed', mine?.name === `From file ${S}`)
ok('the new server has the channels, category, roles and permissions', !!made && chans.some((c) => c.name === 'Lounge' && c.kind === 'voice') && chans.find((c) => c.id === made.parent_id)?.name === 'Staff' && roles.some((x) => x.name === 'Helper') && made.overwrites?.length === 2, JSON.stringify(made?.overwrites))

await start()
await pb.dispatchEvent('[data-import-drop]', 'drop', { dataTransfer: await pb.evaluateHandle((txt) => { const d = new DataTransfer(); d.items.add(new File([txt], 'dropped.json', { type: 'application/json' })); return d }, JSON.stringify(saved)) })
await pb.waitForSelector('[data-import-preview-channels]', { timeout: 5000 }).catch(() => {})
ok('a file can be dropped on the dialog', await pb.locator('[data-import-kind="parley"]').count() === 1)
await pb.keyboard.press('Escape')

await start()
await pb.fill('[data-import-source]', `${WEB}/template/${tpl.code}`); await pb.click('[data-import-preview]')
await pb.waitForSelector('[data-import-preview-channels]')
ok('a link to a template on this server works', await pb.inputValue('[data-create-name]') === `Shared ${S}`)
await pb.keyboard.press('Escape')

await start()
await pb.fill('[data-import-source]', `${API2}/template/${tpl.code}`); await pb.click('[data-import-preview]')
await pb.waitForSelector('[data-import-preview-channels]', { timeout: 8000 }).catch(() => {})
ok('a link to another Parley server is read by the app', await pb.locator('[data-import-kind="parley"]').count() === 1, await pb.locator('[data-import-error]').innerText().catch(() => ''))
await pb.keyboard.press('Escape')

await start()
await pb.fill('[data-import-source]', 'http://localhost:1/template/AbCdEfGh1234'); await pb.click('[data-import-preview]')
await pb.waitForSelector('[data-import-error]')
ok('an unreachable server says to bring the file instead', /download the template file/i.test(await pb.locator('[data-import-error]').innerText()))
await pb.keyboard.press('Escape')

console.log('-- the template page')
await pb.goto(`${WEB}/template/${tpl.code}`); await pb.waitForSelector('[data-template-file-download]')
const [dl2] = await Promise.all([pb.waitForEvent('download'), pb.click('[data-template-file-download]')])
ok('the template page downloads the file', dl2.suggestedFilename() === `Shared ${S}.parley-template.json`, dl2.suggestedFilename())

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
await finish()
