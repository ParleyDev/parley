// Listen counts on audio files, as streaming services count them: a listening session counts as a play after 30 s
// heard (half of a shorter track), wherever it started; replays and going back to the start count again; seeking
// doesn't add listening time; speed doesn't matter; the uploader's plays count; there's no cap. Plays heard with no
// signal, or just before the app closed, arrive later and count once. The card shows plays and listeners (who, in a
// menu) live for everyone, and knows the track's length without fetching the file.
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, multi, ok, finish } from '../lib.mjs'

const a = await reg('alice'), b = await reg('bob'), c = await reg('carol'), d = await reg('dave'), x = await reg('xeno')
const g = await call(a.token, 'POST', '/guilds', { name: `Plays ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const u of [b, c, d]) await call(u.token, 'POST', `/invites/${inv.code}`)
const ch = g.channels.find((k) => k.kind === 'text')

const wav = (sec, name) => {
  const n = 8000 * sec; const buf = Buffer.alloc(44 + n)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40)
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(80 * Math.sin(i / 3))
  return { buffer: buf, mimeType: 'audio/wav', name }
}
const post = async (file, fields) => { const att = await (await multi(a.token, `/channels/${ch.id}/attachments`, file, fields)).json(); await call(a.token, 'POST', `/channels/${ch.id}/messages`, { content: '', attachment_ids: [att.id] }); return att }
// 6 s: a play is 3 s of listening; one listener's plays are at least 1.35 s apart (a play at double speed).
const song = await post(wav(6, 'Loop.wav'))
const voice = await post(wav(1, 'voice-message.wav'), { duration_ms: '1000', waveform: Buffer.alloc(64, 90).toString('base64') })
const att = async () => (await call(a.token, 'GET', `/channels/${ch.id}/messages?limit=10`)).flatMap((m) => m.attachments ?? []).find((k) => k.id === song.id)
const played = (u, body, id = song.id) => raw(u.token, 'POST', `/attachments/${id}/played`, body)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 40 && !(await att()).media_ms; i++) await sleep(250)

console.log('-- server')
const s1 = crypto.randomUUID()
let r = await played(b, { session: s1, at: Date.now() })
let s = await att()
ok('a play counts and its listener is recorded', r.status === 204 && s.plays === 1 && s.listened_by?.includes(b.user.id), `${r.status} ${JSON.stringify(s)}`)
await played(b, { session: s1, at: Date.now() })
ok('the same session sent again (a retry) counts once', (await att()).plays === 1)
await played(b, { session: crypto.randomUUID(), at: Date.now() })
ok('a second play sooner than one could take doesn\'t count', (await att()).plays === 1)
await sleep(1600)
await played(b, { session: crypto.randomUUID(), at: Date.now() })
ok('a replay counts: 2 plays, still 1 listener', (await att()).plays === 2 && (await att()).listened_by.length === 1)
await played(a, { session: crypto.randomUUID(), at: Date.now() })
s = await att()
ok('the uploader\'s plays count too', s.plays === 3 && s.listened_by.includes(a.user.id), JSON.stringify(s))
await played(b, { session: crypto.randomUUID(), at: Date.now() - 3600_000 })
ok('a play sent late (offline at the time) counts at its own time', (await att()).plays === 4)
await sleep(1600)
ok('older clients without a session still count', (await played(b)).status === 204 && (await att()).plays === 5)
ok('voice messages aren\'t counted this way', (await played(b, {}, voice.id)).status === 400)
ok('someone outside the channel can\'t count plays', [403, 404].includes((await played(x, {})).status))
ok('the server knows the length (6 s)', Math.abs(((await att()).media_ms ?? 0) - 6000) < 150, String((await att()).media_ms))

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errors = []
const fetchedFile = new Set()
const open = async (tok, ctx) => {
  ctx ??= await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  p.on('request', (q) => { if (q.url().includes(`/attachments/${song.id}/Loop.wav`)) fetchedFile.add(tok) })
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector(`[data-audio-player="${song.id}"]`)
  return p
}
const card = (p) => p.locator(`[data-audio-player="${song.id}"]`)
const count = async (p) => ({ plays: Number(await card(p).locator('[data-audio-plays]').getAttribute('data-audio-plays', { timeout: 1000 }).catch(() => 0)), listeners: Number(await card(p).locator('[data-audio-listeners]').getAttribute('data-audio-listeners', { timeout: 1000 }).catch(() => 0)) })
const waitPlays = (p, n, timeout = 9000) => p.waitForFunction(([id, n]) => Number(document.querySelector(`[data-audio-player="${id}"] [data-audio-plays]`)?.getAttribute('data-audio-plays')) === n, [song.id, n], { timeout }).then(() => true, () => false)
const ended = (p) => p.waitForFunction(() => { const el = document.querySelector('audio[data-player]'); return !el || !el.src || el.ended }, null, { timeout: 12000 }).catch(() => {})
const scrubTo = async (p, frac) => { const bb = await card(p).locator('[data-scrubber][data-wave="1"]').boundingBox(); await p.mouse.click(bb.x + bb.width * frac, bb.y + bb.height / 2) }
const outbox = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('parley.playsOutbox') ?? '[]').length)

console.log('-- the card')
const pb = await open(b.token)
ok('the card shows plays and listeners', JSON.stringify(await count(pb)) === JSON.stringify({ plays: 5, listeners: 2 }), JSON.stringify(await count(pb)))
await card(pb).locator('[data-audio-duration]').waitFor()
ok('it shows the length without fetching the file', (await card(pb).locator('[data-audio-duration]').innerText()) === '0:06' && !fetchedFile.has(b.token), `${await card(pb).locator('[data-audio-duration]').innerText()} ${fetchedFile.has(b.token)}`)

console.log('-- listening, from wherever it starts')
const pc = await open(c.token)
await scrubTo(pc, 0.25)
await pc.waitForTimeout(1200)
ok('starting partway: not yet', (await att()).plays === 5)
ok('then it counts, live on everyone\'s card', await waitPlays(pb, 6) && (await count(pb)).listeners === 3, JSON.stringify(await count(pb)))
await pc.waitForTimeout(300)
await scrubTo(pc, 0.02)
ok('going back to the start after a counted play counts again', await waitPlays(pb, 7), JSON.stringify(await count(pb)))
await ended(pc)
await card(pc).locator('[data-audio-speed]').click(); await card(pc).locator('[data-audio-speed]').click(); await card(pc).locator('[data-audio-speed]').click()
ok('(at double speed)', (await card(pc).locator('[data-audio-speed]').innerText()) === '2×')
await card(pc).locator('[data-audio-play]').click()
ok('playing it again at double speed counts again', await waitPlays(pb, 8), JSON.stringify(await count(pb)))
await ended(pc)
await card(pc).locator('[data-audio-play]').click()
await pc.waitForTimeout(400)
await pc.evaluate(() => { document.querySelector('audio[data-player]').currentTime = 5 })
await ended(pc); await pc.waitForTimeout(600)
ok('skipping ahead isn\'t listening', (await att()).plays === 8, String((await att()).plays))

console.log('-- phones: no signal, then back')
const dctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
let pd = await open(d.token, dctx)
// The signal drops once the track has loaded (as a phone has buffered it).
await card(pd).locator('[data-audio-play]').click()
await pd.waitForTimeout(300); await dctx.setOffline(true)
await pd.waitForTimeout(3900)
ok('a play heard with no signal waits in the outbox', (await att()).plays === 8 && await outbox(pd) === 1, `${(await att()).plays} ${await outbox(pd)}`)
await dctx.setOffline(false)
ok('and counts when the signal comes back', await waitPlays(pb, 9))
ok('the outbox empties', await pd.waitForFunction(() => !localStorage.getItem('parley.playsOutbox'), null, { timeout: 4000 }).then(() => true, () => false))

console.log('-- phones: the app closed before it could send')
await ended(pd)
await card(pd).locator('[data-audio-play]').click()
await pd.waitForTimeout(300); await dctx.setOffline(true)
await pd.waitForTimeout(3900)
ok('heard offline, then the app closes', await outbox(pd) === 1)
await pd.close()
await dctx.setOffline(false)
pd = await open(d.token, dctx)
ok('it counts on the next launch', await waitPlays(pb, 10, 12000), JSON.stringify(await count(pb)))
await pd.waitForFunction(() => !localStorage.getItem('parley.playsOutbox'), null, { timeout: 4000 }).catch(() => {})
ok('once', (await att()).plays === 10 && await outbox(pd) === 0, `${(await att()).plays} ${await outbox(pd)}`)

console.log('-- the uploader')
const pa = await open(a.token)
await card(pa).locator('[data-audio-play]').click()
ok('the uploader\'s own listening counts', await waitPlays(pb, 11))

console.log('-- who listened')
await call(a.token, 'PATCH', `/guilds/${g.id}/members/${c.user.id}`, { nickname: `Carol Server ${S}` }); await pa.waitForTimeout(500)
await ended(pa)
await card(pa).locator('[data-audio-listeners]').click()
const menu = pa.locator('[data-context-menu]')
await menu.waitFor()
const names = await menu.innerText()
ok('the listeners menu names everyone who listened', /4 listeners/i.test(names) && [a, b, d].every((u) => names.includes(u.user.display_name)), names)
ok('under their name in this server', names.split('\n').includes(`Carol Server ${S}`) && !names.split('\n').includes(c.user.display_name), names)
await pa.waitForTimeout(400)
await pa.screenshot({ path: 'listencount-menu.png' })
await menu.locator('[data-menu-item]').first().click()
ok('picking one opens their profile', await pa.locator('[data-profile-card], [role="dialog"]').first().waitFor({ timeout: 4000 }).then(() => true, () => false))

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
