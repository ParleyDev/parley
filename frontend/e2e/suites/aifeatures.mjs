// Message translation (LibreTranslate-compatible) and AI channel summaries (OpenAI-compatible chat), both through
// stub services: off until an admin configures them, translations cached per message and redone after an edit,
// summaries as topics that jump to their messages, cached until new messages, servers can turn summaries off.
import http from 'node:http'
import { chromium } from 'playwright'
import { API_ORIGIN, WEB, S, reg, call, callS, raw, adminToken, ok, openDms, finish } from '../lib.mjs'
const HOST = process.env.PARLEY_EMBED_HOST ?? '172.30.0.1'
const hits = { translate: [], chat: [] }
let topicIds = []
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const j = JSON.parse(body || '{}')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (req.url === '/translate') { hits.translate.push(j); return res.end(JSON.stringify({ translatedText: `[${j.target}] ${j.q.toUpperCase()}`, detectedLanguage: { language: 'fr', confidence: 90 } })) }
    if (req.url === '/v1/chat/completions') {
      hits.chat.push({ auth: req.headers.authorization, model: j.model, user: j.messages?.[1]?.content ?? '' })
      const topics = [{ title: 'Picnic planning', summary: 'They picked Saturday at the lake.', message_ids: [...topicIds.slice(0, 3), '00000000-0000-0000-0000-000000000000'] }, { title: 'Made up', summary: 'x', message_ids: ['not-a-real-id'] }]
      return res.end(JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify(topics) + '\n```' } }] }))
    }
    res.end('{}')
  })
})
await new Promise((r) => server.listen(0, '0.0.0.0', r)); const BASE = `http://${HOST}:${server.address().port}`
const admin = await adminToken(); const original = await call(admin.token, 'GET', '/admin/settings')
const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `AI ${S}` }); const ch = g.channels.find((x) => x.kind === 'text')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const m1 = await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: 'bonjour tout le monde' })

console.log('-- off by default')
ok('translation is refused until set up', (await raw(a.token, 'POST', `/channels/${ch.id}/messages/${m1.id}/translate`, { target: 'en' })).status === 400)
ok('so are summaries', (await raw(a.token, 'GET', `/channels/${ch.id}/summaries`)).status === 400)
let r = await callS(admin.token, 'PUT', '/admin/settings', { ...original, translate_url: 'ftp://x' }); ok('service URLs must be http(s)', r.status === 400)
r = await callS(admin.token, 'PUT', '/admin/settings', { ...original, translate_url: BASE + '/', llm_url: BASE, llm_api_key: `sk-${S}`, llm_model: 'stub-model' })
ok('admin sets both up; the public instance says so without the URLs or keys', r.status === 200 && r.body.translation === true && r.body.summaries === true
  && await fetch(`${API_ORIGIN}/api/instance`).then((x) => x.json()).then((i) => i.translation && i.summaries && !i.translate_url && !i.llm_api_key && !i.llm_url))

console.log('-- translation')
const browser = await chromium.launch(); const errors = []
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addInitScript(() => { try { localStorage.setItem('parley.language', 'de') } catch { /* ignore */ } })
const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector(`[data-msg-id="${m1.id}"]`)
await p.click(`[data-msg-id="${m1.id}"] .msg-content`, { button: 'right' })
await p.click('[data-context-menu] [data-menu-item="Translate"]'); await p.waitForSelector(`[data-msg-id="${m1.id}"] [data-translation] [data-translation-original]`, { timeout: 8000 }).catch(() => {})
const tr = await p.locator(`[data-msg-id="${m1.id}"] [data-translation]`).innerText().catch(() => '')
ok('Translate shows the message in your language under the original', tr.includes('[de] BONJOUR TOUT LE MONDE') && /Französisch|French/.test(tr), tr)
ok('auto-detecting the source, as plain text', hits.translate[0]?.source === 'auto' && hits.translate[0]?.target === 'de' && hits.translate[0]?.format === 'text')
await p.click(`[data-msg-id="${m1.id}"] [data-translation-original]`)
ok('Show original hides it', await p.locator(`[data-msg-id="${m1.id}"] [data-translation]`).count() === 0)
const again = await call(a.token, 'POST', `/channels/${ch.id}/messages/${m1.id}/translate`, { target: 'de' })
ok('the translation is cached', again.cached === true && hits.translate.length === 1)
await call(b.token, 'PATCH', `/channels/${ch.id}/messages/${m1.id}`, { content: 'salut' })
const edited = await call(a.token, 'POST', `/channels/${ch.id}/messages/${m1.id}/translate`, { target: 'de' })
ok('an edit is translated afresh', edited.cached === false && edited.text === '[de] SALUT')
ok('language codes are checked', (await raw(a.token, 'POST', `/channels/${ch.id}/messages/${m1.id}/translate`, { target: '../etc' })).status === 400)

console.log('-- summaries')
for (const t of ['shall we do a picnic on saturday', 'yes! at the lake?', 'lake works, I bring sandwiches', 'I will bring drinks', 'see you at noon']) topicIds.push((await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: t })).id)
await p.reload(); await p.waitForSelector('[data-summaries-toggle]')
await p.click('[data-summaries-toggle]'); await p.waitForSelector('[data-summary-topic="0"]', { timeout: 10000 }).catch(() => {})
const topics = await p.locator('[data-summary-topic]').count()
ok('the channel comes back as topics', topics === 1 && (await p.locator('[data-summary-topic="0"]').innerText()).includes('Picnic planning'), String(topics) + ' ' + await p.locator('[data-summaries]').innerText().catch(() => 'no panel'))
ok('ids the model invented are dropped, and empty topics with them', (await p.locator('[data-summary-topic="0"]').innerText()).includes('3 Nachrichten') || (await p.locator('[data-summary-topic="0"]').innerText()).includes('3 messages'))
ok('the chat service got the transcript, the model and the key', hits.chat.length === 1 && hits.chat[0].model === 'stub-model' && hits.chat[0].auth === `Bearer sk-${S}` && hits.chat[0].user.includes(`[${topicIds[0]}] Bob: shall we do a picnic`))
await p.click('[data-summary-topic="0"]'); await p.waitForTimeout(800)
ok('a topic jumps to its first message', await p.locator(`[data-msg-id="${topicIds[0]}"]`).isVisible())
await call(a.token, 'GET', `/channels/${ch.id}/summaries`)
ok('cached until something new is said', hits.chat.length === 1)
await call(b.token, 'POST', `/channels/${ch.id}/messages`, { content: 'oh and bring a frisbee' })
await call(a.token, 'GET', `/channels/${ch.id}/summaries`)
ok('then summarized again', hits.chat.length === 2)
await call(a.token, 'PATCH', `/guilds/${g.id}`, { summaries_enabled: false })
ok('a server can turn summaries off', (await raw(a.token, 'GET', `/channels/${ch.id}/summaries`)).status === 400)
await p.waitForTimeout(800)
ok('and the button goes away', await p.locator('[data-summaries-toggle]').count() === 0)
await openDms(a, b); const dm = await call(a.token, 'POST', '/users/@me/channels', { recipient_id: b.user.id })
ok('DMs are never summarized', (await raw(a.token, 'GET', `/channels/${dm.id}/summaries`)).status === 400)
ok('no page errors', errors.length === 0, errors.join(' | '))
await callS(admin.token, 'PUT', '/admin/settings', original)
await call(a.token, 'DELETE', `/guilds/${g.id}`, { password: 'password1', name: g.name })
await browser.close(); server.close(); await finish()
