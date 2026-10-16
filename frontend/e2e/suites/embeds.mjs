import { chromium } from 'playwright'
import http from 'node:http'
import { WEB, S, reg, call, callS, raw, ok, finish } from '../lib.mjs'

// Pages the backend fetches; served from the host on the pinned compose gateway address.
const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
const big = '<html><head><title>Big page</title>' + '<!-- ' + 'x'.repeat(600 * 1024) + ' -->' + '<meta property="og:title" content="too late"></head></html>'
const pages = {
  '/og': { type: 'text/html', body: `<html><head><title>Fallback</title><meta property="og:title" content="Parley &amp; friends ${S}"><meta property="og:description" content="A description with &quot;quotes&quot;"><meta property="og:image" content="/pic.png"><meta property="og:site_name" content="Example Site"></head><body>hi</body></html>` },
  '/title': { type: 'text/html; charset=utf-8', body: `<html><head><title>Only a title ${S}</title></head><body></body></html>` },
  '/redirect': { status: 302, headers: { Location: '/og' }, body: '' },
  '/loop': { status: 302, headers: { Location: '/loop' }, body: '' },
  '/to-private': { status: 302, headers: { Location: 'http://127.0.0.1:8080/health' }, body: '' },
  '/pic.png': { type: 'image/png', body: 'notreallyapng' },
  '/json': { type: 'application/json', body: '{"og:title":"nope"}' },
  '/big': { type: 'text/html', body: big },
  '/empty': { type: 'text/html', body: '<html><body>nothing</body></html>' },
  '/500': { status: 500, type: 'text/html', body: '<title>err</title>' },
}
let hits = 0
const server = http.createServer((req, res) => {
  hits++
  const p = pages[req.url.split('?')[0]]
  if (!p) { res.writeHead(404); res.end(); return }
  res.writeHead(p.status ?? 200, { 'Content-Type': p.type ?? 'text/plain', ...(p.headers ?? {}) }); res.end(p.body)
})
await new Promise((r) => server.listen(0, '0.0.0.0', r)); const PORT = server.address().port
const U = (path) => `http://${HOST}:${PORT}${path}`
const a = await reg('alice')
const get = (url) => callS(a.token, 'GET', `/embeds?url=${encodeURIComponent(url)}`)

console.log('-- API')
let r = await get(U('/og'))
ok('OpenGraph tags become a preview (entities decoded, image resolved)', r.status === 200 && r.body?.title === `Parley & friends ${S}` && r.body.description === 'A description with "quotes"' && r.body.image === U('/pic.png') && r.body.site_name === 'Example Site', JSON.stringify(r.body))
const before = hits; r = await get(U('/og')); ok('second request is served from the cache', r.status === 200 && hits === before)
r = await get(U('/title')); ok('a bare <title> is enough; site name falls back to the host', r.body?.title === `Only a title ${S}` && r.body.site_name === HOST)
r = await get(U('/redirect')); ok('redirects are followed', r.body?.title === `Parley & friends ${S}`)
r = await get(U('/loop')); ok('redirect loops give up (null)', r.status === 200 && r.body === null)
r = await get(U('/to-private')); ok('a redirect to a private address is refused (null)', r.status === 200 && r.body === null)
r = await get(U('/pic.png')); ok('non-HTML content yields no preview', r.body === null)
r = await get(U('/json')); ok('JSON yields no preview', r.body === null)
r = await get(U('/big')); ok('bodies are capped at 512 KB (meta after the cap is ignored, title before it is used)', r.body?.title === 'Big page')
r = await get(U('/empty')); ok('pages without metadata yield null', r.body === null)
r = await get(U('/500')); ok('error responses yield null', r.body === null)
for (const bad of ['http://localhost/', 'http://127.0.0.1:8080/health', 'http://10.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'ftp://example.com/', 'http://user:pw@example.com/', 'javascript:alert(1)', 'http://metadata.google.internal/']) {
  r = await get(bad); ok(`refused: ${bad}`, r.status === 400, String(r.status))
}
r = await raw(null, 'GET', `/embeds?url=${encodeURIComponent(U('/og'))}`); ok('needs a login', r.status === 401)

console.log('-- UI')
const g = await call(a.token, 'POST', '/guilds', { name: `Embeds ${S}` })
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')
const m1 = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `look at this ${U('/og')} wow` })
const m2 = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `\`${U('/title')}\` is in code so no card` })
const m3 = await call(a.token, 'POST', `/channels/${tc.id}/messages`, { content: `${U('/empty')}` })
const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector(`[data-msg-id="${m1.id}"] [data-link-embed]`)
const card = p.locator(`[data-msg-id="${m1.id}"] [data-link-embed]`)
ok('a message with a link shows the card with site, title and description', (await card.locator('[data-embed-site]').textContent()) === 'Example Site' && (await card.locator('[data-embed-title]').textContent()) === `Parley & friends ${S}` && (await card.locator('[data-embed-desc]').textContent()).includes('quotes') && await card.locator('[data-embed-image]').count() === 1)
await p.screenshot({ path: '110-link-embed.png' })
await p.waitForTimeout(500)
ok('links inside code and pages without metadata get no card', await p.locator(`[data-msg-id="${m2.id}"] [data-link-embed]`).count() === 0 && await p.locator(`[data-msg-id="${m3.id}"] [data-link-embed]`).count() === 0)
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); server.close(); await finish()
