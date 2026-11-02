// Video previews in chat: the server grabs a poster frame from every video upload (turned the way the video
// displays), so the inline preview shows a still on every platform, including the phone apps' web views, which don't
// paint a frame until the video plays. iPhone .mov videos preview inline too.
import { chromium, webkit } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WEB, B, S, FIX, reg, call, raw, multi, ok, finish } from '../lib.mjs'

const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Posters ${S}` })
const ch = g.channels.find((x) => x.kind === 'text')
const post = async (file) => { const att = await (await multi(a.token, `/channels/${ch.id}/attachments`, file)).json(); await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: '', attachment_ids: [att.id] }); return att }
const webm = await post({ buffer: readFileSync(join(FIX, 'clip.webm')), mimeType: 'video/webm', name: 'clip.webm' })
const mov = await post({ buffer: readFileSync(join(FIX, 'clip.mov')), mimeType: 'video/quicktime', name: 'IMG_0420.MOV' })

console.log('-- server')
ok('a video upload gets a poster frame and its size', !!webm.thumb_url && webm.width === 320 && webm.height === 180, JSON.stringify(webm))
const th = await raw(a.token, 'GET', webm.thumb_url.replace(/^\/api/, ''))
const jpg = Buffer.from(await th.arrayBuffer())
ok('the poster is a JPEG', th.status === 200 && th.headers.get('content-type') === 'image/jpeg' && jpg[0] === 0xff && jpg[1] === 0xd8, `${th.status} ${th.headers.get('content-type')}`)
ok('an iPhone .mov keeps its type and gets a poster', mov.content_type === 'video/quicktime' && !!mov.thumb_url, JSON.stringify(mov))
ok('turned the way it displays (a sideways phone video is portrait)', mov.width === 180 && mov.height === 320, `${mov.width}x${mov.height}`)
const head = await fetch(`${B.replace(/\/api$/, '')}${mov.url}`)
ok('.mov plays inline rather than downloading', /^inline/.test(head.headers.get('content-disposition') ?? ''), head.headers.get('content-disposition'))
const msgs = await call(a.token, 'GET', `/channels/${ch.id}/messages?limit=5`)
ok('messages carry the poster', msgs.flatMap((m) => m.attachments ?? []).filter((x) => x.thumb_url).length === 2)

const errors = []
for (const [name, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  console.log(`-- ${name}`)
  const br = await bt.launch(); const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
  await p.goto(`${WEB}/channels/${g.id}/${ch.id}`)
  const iv = p.locator(`[data-inline-video="${webm.id}"]`), im = p.locator(`[data-inline-video="${mov.id}"]`)
  await iv.waitFor(); await im.waitFor()
  ok('the preview uses the server\'s poster', (await iv.locator('video').getAttribute('poster'))?.includes(`/attachments/${webm.id}/thumb`) && (await iv.locator('[data-inline-video-poster]').getAttribute('data-inline-video-poster')) === 'server')
  const mb = await im.boundingBox()
  ok('the .mov previews inline, portrait from the start', mb && mb.height > mb.width * 1.4, JSON.stringify(mb))
  await p.waitForTimeout(1200)
  await im.scrollIntoViewIfNeeded(); await im.screenshot({ path: `videoposter-${name}.png` })
  await br.close()
}
ok('no page errors', errors.length === 0, errors.join(' | '))
await finish()
