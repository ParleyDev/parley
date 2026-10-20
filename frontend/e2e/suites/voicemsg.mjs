// Voice messages: recorded in the composer, uploaded with waveform + duration, played back from a waveform card.
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, multi, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Voice msgs ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const tc = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((x) => x.kind === 'text')

/** A 0.2 s mono 8 kHz WAV so the server sniffs real audio. */
const wav = () => { const n = 1600; const buf = Buffer.alloc(44 + n); buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40); for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(100 * Math.sin(i / 4)); return { buffer: buf, mimeType: 'audio/wav', name: 'voice-message.wav' } }
const wave = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37) % 256)).toString('base64')

console.log('-- API')
let r = await multi(a.token, `/channels/${tc.id}/attachments`, wav(), { duration_ms: '1234', waveform: wave }); let j = await r.json()
ok('audio upload keeps duration and waveform', r.status === 201 && j.duration_ms === 1234 && j.waveform === wave && /^audio\//.test(j.content_type), JSON.stringify(j))
r = await multi(a.token, `/channels/${tc.id}/attachments`, wav(), { duration_ms: '0', waveform: wave }); j = await r.json()
ok('zero duration is ignored (plain audio file)', r.status === 201 && j.duration_ms === undefined && j.waveform === undefined)
r = await multi(a.token, `/channels/${tc.id}/attachments`, wav(), { duration_ms: '1000', waveform: 'not base64!!' }); j = await r.json()
ok('bad waveform dropped, duration kept', r.status === 201 && j.duration_ms === 1000 && j.waveform === undefined)
const png = { buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'), mimeType: 'image/png', name: 'a.png' }
r = await multi(a.token, `/channels/${tc.id}/attachments`, png, { duration_ms: '1000', waveform: wave }); j = await r.json()
ok('non-audio never becomes a voice message', r.status === 201 && j.duration_ms === undefined)
r = await multi(a.token, `/channels/${tc.id}/attachments`, wav(), { duration_ms: '2500', waveform: wave }); const att = await r.json()
const msg = (await callS(a.token, 'POST', `/channels/${tc.id}/messages`, { content: '', attachment_ids: [att.id] })).body
ok('message carries the voice fields', msg?.attachments?.[0]?.duration_ms === 2500 && msg.attachments[0].waveform === wave)
ok('listing keeps them too', (await call(b.token, 'GET', `/channels/${tc.id}/messages?limit=5`)).find((m) => m.id === msg.id)?.attachments[0].waveform === wave)

console.log('-- UI')
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const mk = async (tok) => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(`${WEB}/channels/${g.id}/${tc.id}`); await p.waitForSelector('textarea'); return p }
const pa = await mk(a.token); const pb = await mk(b.token)
const card = pb.locator(`[data-voice-message="${att.id}"]`); await card.waitFor()
ok('API-made voice message renders as the waveform card', await card.locator('[data-voice-wave] span').count() === 64 && (await card.locator('[data-voice-time]').textContent()) === '0:03' && (await card.getAttribute('data-duration')) === '2500')
ok('waveform stays inside the card', await card.evaluate((c) => { const w = c.querySelector('[data-voice-wave]').getBoundingClientRect(); const r = c.getBoundingClientRect(); const bars = [...c.querySelectorAll('[data-voice-wave] span')].map((b) => b.getBoundingClientRect()); return w.right <= r.right && bars.every((b) => b.right <= w.right + 0.5 && b.left >= w.left - 0.5) && bars.every((b) => b.width > 0) }))
ok('theirs is the neutral style, mine is accent', (await card.getAttribute('class')).includes('bg-bg-3') && (await pa.locator(`[data-voice-message="${att.id}"]`).getAttribute('class')).includes('bg-accent'))
ok('mic button shows in the composer', await pa.locator('[data-voice-record]').count() === 1)
await pa.click('[data-voice-record]'); await pa.waitForSelector('[data-voice-recording]')
ok('recording bar replaces the text box', await pa.locator('textarea').count() === 0 && await pa.locator('[data-voice-timer]').count() === 1)
await pa.waitForTimeout(1600)
ok('timer runs and live bars animate', (await pa.locator('[data-voice-timer]').textContent()) !== '0:00' && await pa.locator('[data-voice-levels] span').count() === 40)
await pa.screenshot({ path: '130-voice-recording.png' })
await pa.click('[data-voice-cancel]'); await pa.waitForSelector('textarea')
ok('discard returns the text box without sending', await pa.locator('[data-voice-recording]').count() === 0 && await pa.locator('[data-voice-message]').count() === 1)
await pa.click('[data-voice-record]'); await pa.waitForSelector('[data-voice-recording]'); await pa.waitForTimeout(1500); await pa.click('[data-voice-send]')
await pa.waitForFunction(() => document.querySelectorAll('[data-voice-message]').length === 2, null, { timeout: 15000 })
const mine = pa.locator('[data-voice-message]').nth(1)
const dur = Number(await mine.getAttribute('data-duration'))
ok('recorded message lands with a real duration', dur >= 1000 && dur < 6000, String(dur))
ok('its waveform decoded from the recording', await mine.locator('[data-voice-wave] span').count() === 64)
await pb.waitForFunction(() => document.querySelectorAll('[data-voice-message]').length === 2)
const theirs = pb.locator('[data-voice-message]').nth(1)
await theirs.locator('[data-voice-play]').click()
await pb.waitForFunction(() => document.querySelectorAll('[data-voice-message]')[1].getAttribute('data-playing') === '1')
ok('bob plays it; card shows playing state', true)
await theirs.locator('[data-voice-speed]').click()
ok('speed toggles to 1.5×', (await theirs.locator('[data-voice-speed]').textContent()) === '1.5×')
await pb.waitForFunction(() => document.querySelectorAll('[data-voice-message]')[1].getAttribute('data-playing') === '0', null, { timeout: 15000 })
ok('playback finishes and resets', (await theirs.locator('[data-voice-time]').textContent()) !== '0:00')
await pb.screenshot({ path: '131-voice-message.png' })
const api = (await call(b.token, 'GET', `/channels/${tc.id}/messages?limit=5`)).find((m) => m.attachments?.[0]?.duration_ms === dur)
ok('recorded attachment is audio/webm with waveform', !!api && /^audio\//.test(api.attachments[0].content_type) && typeof api.attachments[0].waveform === 'string' && api.attachments[0].waveform.length > 40, JSON.stringify(api?.attachments?.[0]))
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
