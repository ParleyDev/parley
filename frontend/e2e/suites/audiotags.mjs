// Music files' tags and cover art: the server reads an MP3's ID3 tags (title, artist, album, year, track) and its
// embedded cover at upload; the card opens with the cover, the album line, the title and the artist, the now-playing
// bar shows the cover, and the lock screen (Media Session) gets all of it. Files without tags look as before.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WEB, B, S, FIX, reg, call, callS, multi, ok, finish } from '../lib.mjs'

/** An ID3v2.3 tag: text frames (Latin-1) and an APIC front cover. */
const id3 = (text, cover) => {
  const frame = (id, data) => { const h = Buffer.alloc(10); h.write(id, 0); h.writeUInt32BE(data.length, 4); return Buffer.concat([h, data]) }
  const frames = [
    ...Object.entries(text).map(([id, v]) => frame(id, Buffer.concat([Buffer.from([0]), Buffer.from(v, 'latin1')]))),
    frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0', 'latin1'), Buffer.from([3]), Buffer.from('\0'), cover])),
  ]
  const body = Buffer.concat(frames)
  const size = body.length
  const head = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f])
  return Buffer.concat([head, body])
}
/** Silent MPEG-1 Layer III frames (128 kb/s, 44.1 kHz: 417 bytes each), about `sec` seconds. */
const silence = (sec) => {
  const n = Math.round((sec * 44100) / 1152), f = Buffer.alloc(417); f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x64
  return Buffer.concat(Array.from({ length: n }, () => f))
}
const tagged = { buffer: Buffer.concat([id3({ TIT2: 'Tidewater', TPE1: 'Low Lantern', TALB: 'Harbour Lights', TYER: '2024', TRCK: '4/11', TCON: 'Ambient' }, readFileSync(join(FIX, 'pic.png'))), silence(3)]), mimeType: 'audio/mpeg', name: '04_tidewater_master_v3.mp3' }
const plain = { buffer: silence(3), mimeType: 'audio/mpeg', name: 'Night_Drive.mp3' }

const a = await reg('alice')
const g = await call(a.token, 'POST', '/guilds', { name: `Tags ${S}` })
const ch = g.channels.find((x) => x.kind === 'text')
const post = async (file) => { const att = await (await multi(a.token, `/channels/${ch.id}/attachments`, file)).json(); await callS(a.token, 'POST', `/channels/${ch.id}/messages`, { content: '', attachment_ids: [att.id] }); return att }
const song = await post(tagged)
const bare = await post(plain)

console.log('-- server')
const sorted = (o) => JSON.stringify(Object.fromEntries(Object.entries(o ?? {}).sort())); ok('the tags are read at upload', sorted(song.audio_tags) === sorted({ title: 'Tidewater', artist: 'Low Lantern', album: 'Harbour Lights', year: 2024, track: 4, genre: 'Ambient' }), JSON.stringify(song.audio_tags))
const th = song.thumb_url ? await fetch(`${B.replace(/\/api$/, '')}${song.thumb_url}`) : null
const img = th ? Buffer.from(await th.arrayBuffer()) : Buffer.alloc(0)
ok('the cover becomes the thumbnail, as a JPEG', th?.status === 200 && th.headers.get('content-type') === 'image/jpeg' && img[0] === 0xff && img[1] === 0xd8, `${th?.status} ${th?.headers.get('content-type')}`)
ok('a file without tags has none and no cover', bare.audio_tags === undefined && !bare.thumb_url, JSON.stringify(bare))
const msgs = await call(a.token, 'GET', `/channels/${ch.id}/messages`)
ok('messages carry the tags', msgs.some((m) => m.attachments?.some((x) => x.id === song.id && x.audio_tags?.title === 'Tidewater' && x.thumb_url)))
const songMsg = msgs.find((m) => m.attachments?.some((x) => x.id === song.id))
const other = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'elsewhere', kind: 'text' })
const fw = await call(a.token, 'POST', `/channels/${ch.id}/messages/${songMsg.id}/forward`, { channel_id: other.id })
const fa = fw.attachments?.[0]
const fth = fa?.thumb_url ? await fetch(`${B.replace(/\/api$/, '')}${fa.thumb_url}`) : null
ok('a forwarded song keeps its tags and its own copy of the cover', fa && fa.id !== song.id && sorted(fa.audio_tags) === sorted(song.audio_tags) && fth?.status === 200 && fth.headers.get('content-type') === 'image/jpeg', JSON.stringify(fa))

console.log('-- card')
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
await page.addInitScript((t) => localStorage.setItem('parley.token', t), a.token)
await page.goto(`${WEB}/channels/${g.id}/${ch.id}`)
const card = page.locator(`[data-audio-player="${song.id}"]`)
await card.waitFor()
await page.waitForFunction((id) => { const i = document.querySelector(`[data-audio-player="${id}"] [data-audio-cover]`); return i && i.complete && i.naturalWidth > 0 }, song.id)
ok('a tagged file opens with its cover', await card.locator('[data-audio-header="cover"]').count() === 1)
ok('the title comes from the tags, the file name stays as its tooltip', (await card.locator('[data-audio-title]').textContent()) === 'Tidewater' && (await card.locator('[data-audio-title]').getAttribute('title')) === '04_tidewater_master_v3.mp3')
ok('with the artist under it', (await card.locator('[data-audio-artist]').textContent()) === 'Low Lantern')
ok('and the album and year above it', (await card.locator('[data-audio-album]').textContent()) === 'Harbour Lights · 2024')
ok('a soft blur of the cover sits behind the card', await card.locator('[data-audio-wash]').count() === 1)
const plainCard = page.locator(`[data-audio-player="${bare.id}"]`)
ok('a file without tags looks as before', await plainCard.locator('[data-audio-header="plain"]').count() === 1 && (await plainCard.locator('[data-audio-title]').textContent()) === 'Night Drive' && await plainCard.locator('[data-audio-cover], [data-audio-artist]').count() === 0)
await card.screenshot({ path: 'audiotags-card.png' })

console.log('-- playing')
await card.locator('[data-audio-play]').click()
await page.waitForSelector('[data-now-playing] [data-now-playing-cover]')
ok('the now-playing bar shows the cover, the song and its artist', (await page.locator('[data-now-playing-title] .font-semibold').textContent()) === 'Tidewater' && (await page.locator('[data-now-playing-title]').textContent()).includes('Low Lantern'))
const meta = await page.evaluate(() => { const m = navigator.mediaSession?.metadata; return m ? { title: m.title, artist: m.artist, album: m.album, art: m.artwork?.[0]?.src ?? '' } : null })
ok('the lock screen gets the title, artist, album and cover', meta?.title === 'Tidewater' && meta.artist === 'Low Lantern' && meta.album === 'Harbour Lights' && /\/thumb/.test(meta.art), JSON.stringify(meta))
await page.locator('[data-now-playing-stop]').click()

console.log('-- phone')
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await phone.addInitScript((t) => localStorage.setItem('parley.token', t), a.token)
await phone.goto(`${WEB}/channels/${g.id}/${ch.id}`)
const pc = phone.locator(`[data-audio-player="${song.id}"]`)
await pc.waitFor()
const box = await pc.boundingBox()
ok('the card fits a phone', box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box))
await pc.screenshot({ path: 'audiotags-phone.png' })
await browser.close()
await finish()
