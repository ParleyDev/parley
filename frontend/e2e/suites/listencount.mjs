// Listen counts on audio files: a play counts after 30 s heard from the start (half of a shorter track), every time
// someone listens from the start again; seeking ahead doesn't add listening time, the uploader's own plays don't
// count, and the card shows plays and listeners (who, in a menu) live for everyone in the channel.
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
// 6 s: a play is 3 s of listening.
const song = await post(wav(6, 'Loop.wav'))
const voice = await post(wav(1, 'voice-message.wav'), { duration_ms: '1000', waveform: Buffer.alloc(64, 90).toString('base64') })
const att = async () => (await call(a.token, 'GET', `/channels/${ch.id}/messages?limit=10`)).flatMap((m) => m.attachments ?? []).find((k) => k.id === song.id)
const played = (u, id = song.id) => raw(u.token, 'POST', `/attachments/${id}/played`)
// Let the server make the visualiser data (it knows the length from it).
for (let i = 0; i < 20; i++) { if ((await raw(a.token, 'GET', `/attachments/${song.id}/viz?peaks=1`)).status === 200) break; await new Promise((r) => setTimeout(r, 250)) }

console.log('-- server')
let r = await played(b)
let s = await att()
ok('a play counts and its listener is recorded', r.status === 204 && s.plays === 1 && s.listened_by?.includes(b.user.id), `${r.status} ${JSON.stringify(s)}`)
await played(b)
ok('the same listener can\'t count again sooner than a play takes', (await att()).plays === 1)
await played(a)
ok('the uploader\'s own plays don\'t count', (await att()).plays === 1 && !(await att()).listened_by?.includes(a.user.id))
ok('voice messages aren\'t counted this way', (await played(b, voice.id)).status === 400)
ok('someone outside the channel can\'t count plays', [403, 404].includes((await played(x)).status))
await new Promise((res) => setTimeout(res, 3000))
await played(b)
s = await att()
ok('a repeat listen counts again: 2 plays, still 1 listener', s.plays === 2 && s.listened_by?.length === 1, JSON.stringify(s))

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errors = []
const open = async (tok) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector(`[data-audio-player="${song.id}"]`)
  return p
}
const card = (p) => p.locator(`[data-audio-player="${song.id}"]`)
const count = async (p) => ({ plays: Number(await card(p).locator('[data-audio-plays]').getAttribute('data-audio-plays').catch(() => 0)), listeners: Number(await card(p).locator('[data-audio-listeners]').getAttribute('data-audio-listeners').catch(() => 0)) })
const waitPlays = (p, n, timeout = 8000) => p.waitForFunction(([id, n]) => Number(document.querySelector(`[data-audio-player="${id}"] [data-audio-plays]`)?.getAttribute('data-audio-plays')) === n, [song.id, n], { timeout }).then(() => true, () => false)

console.log('-- the card')
const pb = await open(b.token)
ok('the card shows plays and listeners', JSON.stringify(await count(pb)) === JSON.stringify({ plays: 2, listeners: 1 }), JSON.stringify(await count(pb)))

console.log('-- listening from the start counts, live for everyone')
const pc = await open(c.token)
await card(pc).locator('[data-audio-play]').click()
await pc.waitForTimeout(1500)
ok('not yet: under half the track heard', (await att()).plays === 2)
ok('then it counts, and the other listener\'s card moves live', await waitPlays(pb, 3) && (await count(pb)).listeners === 2, JSON.stringify(await count(pb)))
ok('the listener\'s own card too', await waitPlays(pc, 3))
await pc.waitForFunction((id) => document.querySelector(`[data-audio-player="${id}"]`)?.getAttribute('data-playing') === '0', song.id, { timeout: 8000 }).catch(() => {})
await card(pc).locator('[data-audio-play]').click()
ok('playing it again from the start counts again', await waitPlays(pb, 4), JSON.stringify(await count(pb)))
ok('still the same listeners', (await count(pb)).listeners === 2)

console.log('-- skipping ahead isn\'t listening')
const pd = await open(d.token)
await card(pd).locator('[data-audio-play]').click()
await pd.waitForTimeout(300)
await pd.evaluate(() => { document.querySelector('audio[data-player]').currentTime = 4.2 })
await pd.waitForFunction(() => document.querySelector('audio[data-player]')?.ended, null, { timeout: 8000 }).catch(() => {})
await pd.waitForTimeout(800)
ok('a play that jumped to the end doesn\'t count', (await att()).plays === 4, String((await att()).plays))
await card(pd).locator('[data-audio-play]').click()
ok('listening from the start afterwards does', await waitPlays(pb, 5))

console.log('-- the uploader\'s own listening')
const pa = await open(a.token)
await card(pa).locator('[data-audio-play]').click()
await pa.waitForTimeout(4500)
ok('doesn\'t count', (await att()).plays === 5)

console.log('-- who listened')
await card(pa).locator('[data-audio-listeners]').click()
const menu = pa.locator('[data-context-menu]')
await menu.waitFor()
const names = await menu.innerText()
ok('the listeners menu names everyone who listened', /3 listeners/i.test(names) && [b, c, d].every((u) => names.includes(u.user.display_name)), names)
await pa.screenshot({ path: 'listencount-menu.png' })
await menu.locator('[data-menu-item]').first().click()
ok('picking one opens their profile', await pa.locator('[data-profile-card], [role="dialog"]').first().waitFor({ timeout: 4000 }).then(() => true, () => false))

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
