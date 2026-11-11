// Audio and video in chat: audio files get a player card with a live visualiser (bars / wave / orb / off), a seek
// bar and Download (a Save / Share sheet on phones); audio and voice messages play through one app-wide player that
// keeps going when you leave the chat, with a now-playing bar that links back; videos play where they are in the chat
// with their own controls (seek, time, volume, speed, full screen with the same controls), like Discord's.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WEB, B, S, FIX, reg, call, callS, multi, ok, finish } from '../lib.mjs'

const a = await reg('alice'), b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `Media ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)
const ch = g.channels.find((x) => x.kind === 'text')
const other = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'elsewhere', kind: 'text' })

/** A mono 8 kHz WAV tone of `sec` seconds (a sweep, so the visualiser has something to show). */
const wav = (sec, name) => {
  const n = 8000 * sec; const buf = Buffer.alloc(44 + n)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40)
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(90 * (0.25 + 0.75 * Math.abs(Math.sin((i / n) * Math.PI * 5))) * Math.sin((i * (0.2 + (i / n) * 0.6)) / 2))
  return { buffer: buf, mimeType: 'audio/wav', name }
}
const post = async (tok, file, fields) => { const att = await (await multi(tok, `/channels/${ch.id}/attachments`, file, fields)).json(); const m = (await callS(tok, 'POST', `/channels/${ch.id}/messages`, { content: '', attachment_ids: [att.id] })).body; return { att, m } }
const song = await post(a.token, wav(6, 'Night_Drive.wav'))
const clip = await post(a.token, { buffer: readFileSync(join(FIX, 'clip.webm')), mimeType: 'video/webm', name: 'clip.webm' })
const wave = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37) % 256)).toString('base64')
const voiceMsg = await post(a.token, wav(1, 'voice-message.wav'), { duration_ms: '1000', waveform: wave })

console.log('-- server')
const head = async (q) => (await fetch(`${B.replace(/\/api$/, '')}${song.att.url}${q}`)).headers.get('content-disposition') ?? ''
ok('audio is served inline for playing', /^inline/.test(await head('')))
ok('?download=1 asks for a download (the Android app saves those)', /^attachment; filename="Night_Drive.wav"/.test(await head('?download=1')), await head('?download=1'))

console.log('-- visualiser data')
const vz = await fetch(`${B}/attachments/${song.att.id}/viz`)
const vb = Buffer.from(await vz.arrayBuffer())
const frames = vb.length >= 16 ? vb.readUInt32LE(8) : 0
ok('the server analyses the file: PVZ1, 15 fps, 32 bands, a frame per 1/15 s', vz.status === 200 && vb.subarray(0, 4).toString() === 'PVZ1' && vb[4] === 15 && vb[5] === 32 && frames >= 80 && frames <= 92 && vb.length === 16 + 256 + frames * 32, `${vz.status} ${vb.length} ${frames}`)
ok('a few KB a second, not the file again', vb.length < song.att.size / 4, `${vb.length} vs ${song.att.size}`)
const band = (f) => { const row = vb.subarray(16 + 256 + f * 32, 16 + 256 + (f + 1) * 32); return row.indexOf(Math.max(...row)) }
ok('it follows the music (the sweep climbs through the bands)', band(frames - 8) > band(8), `${band(8)} → ${band(frames - 8)}`)
const pk = await fetch(`${B}/attachments/${song.att.id}/viz?peaks=1`)
ok('?peaks=1 is just the waveform for the seek bar', (await pk.arrayBuffer()).byteLength === 16 + 256)
ok('immutable, so clients cache it', /immutable/.test(vz.headers.get('cache-control') ?? ''))
ok('videos have none', (await fetch(`${B}/attachments/${clip.att.id}/viz`)).status === 404)

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errors = []
const open = async (tok, opts) => {
  const ctx = await browser.newContext(opts); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}/channels/${g.id}/${ch.id}`); await p.waitForSelector('[data-msg-id]')
  return p
}
const player = (p) => p.evaluate(() => { const el = document.querySelector('audio[data-player]'); return el ? { paused: el.paused, t: el.currentTime, src: el.src } : null })
/** Lit pixels in a canvas: is the visualiser drawing? */
const lit = (loc) => loc.evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n })

console.log('-- desktop: the audio card')
const p = await open(b.token, { viewport: { width: 1440, height: 900 } })
const card = p.locator(`[data-audio-player="${song.att.id}"]`); await card.waitFor()
ok('a player card, titled without the extension or underscores', (await card.locator('[data-audio-title]').innerText()) === 'Night Drive')
await p.waitForFunction((id) => document.querySelector(`[data-audio-player="${id}"] [data-audio-duration]`)?.textContent === '0:06', song.att.id, { timeout: 5000 }).catch(() => {})
ok('it knows the length before playing (format, size, 0:06)', (await card.locator('[data-audio-duration]').innerText()) === '0:06' && /WAV/.test(await card.innerText()))
const box = await card.boundingBox()
ok('a roomy card, not a bare <audio> bar', box && box.width >= 400 && box.height >= 120 && await p.locator('[data-msg-id] audio').count() === 0, JSON.stringify(box))
await card.locator('[data-audio-play]').click(); await p.waitForTimeout(1200)
ok('Play plays it through the app-wide player', (await card.getAttribute('data-playing')) === '1' && !(await player(p)).paused && (await player(p)).src.includes(song.att.id))
const viz = card.locator('[data-audio-viz]')
ok('the card\'s seek bar is the file\'s waveform', await card.locator('[data-scrubber][data-wave="1"]').count() === 1)
ok('the visualiser follows the server\'s timeline for the track', (await viz.getAttribute('data-source')) === 'timeline', await viz.getAttribute('data-source'))
ok('the visualiser is live and drawing', (await viz.getAttribute('data-viz-live')) === '1' && await lit(viz) > 200, String(await lit(viz)))
ok('the seek bar moves', parseFloat(await card.locator('[data-scrubber]').getAttribute('data-progress')) > 0.05)
const bars = card.locator('[data-wave-bars] span')
ok('the waveform is a fixed 64 bars', await bars.count() === 64)
const played1 = await card.locator('[data-wave-bars] [data-played]').count()
await p.waitForTimeout(1500)
const played2 = await card.locator('[data-wave-bars] [data-played]').count()
ok('played bars light up as it goes', played1 > 0 && played2 > played1, `${played1} → ${played2}`)
const tone = await card.evaluate((c) => { const b = [...c.querySelectorAll('[data-wave-bars] [data-played]')]; return { first: +getComputedStyle(b[0]).opacity, last: +getComputedStyle(b.at(-1)).opacity, rest: +getComputedStyle(c.querySelector('[data-wave-bars] span:not([data-played])')).opacity } })
ok('from a soft tint at the start to full at the playhead; the rest stay subtle', tone.first < tone.last && tone.last > 0.9 && tone.rest < 0.4, JSON.stringify(tone))
const sb = await card.locator('[data-scrubber]').boundingBox(), th = await card.locator('[data-scrubber-thumb]').boundingBox()
ok('the seek line and its dot run across the middle of the waveform', th && Math.abs((th.y + th.height / 2) - (sb.y + sb.height / 2)) < 2, JSON.stringify({ sb, th }))
await card.screenshot({ path: 'audio-bars.png' })
const modes = []
for (let i = 0; i < 4; i++) { modes.push(await card.locator('[data-audio-viz-mode]').getAttribute('data-audio-viz-mode')); await card.locator('[data-audio-viz-mode]').click(); await p.waitForTimeout(400); if (i < 2) await card.screenshot({ path: `audio-${['wave', 'orb'][i]}.png` }) }
ok('the visualiser button cycles bars → wave → orb → off', modes.join() === 'bars,wave,orb,off', modes.join())
ok('back on bars after off', (await card.locator('[data-audio-viz-mode]').getAttribute('data-audio-viz-mode')) === 'bars' && await card.locator('[data-audio-viz]').count() === 1)
for (let i = 0; i < 3; i++) await card.locator('[data-audio-viz-mode]').click()
await p.waitForTimeout(200)
ok('off hides the visualiser', await card.locator('[data-audio-viz]').count() === 0)
await p.reload(); await p.waitForSelector(`[data-audio-player="${song.att.id}"]`)
ok('the choice is remembered', (await p.locator(`[data-audio-player="${song.att.id}"] [data-audio-viz-mode]`).getAttribute('data-audio-viz-mode')) === 'off')
await p.locator(`[data-audio-player="${song.att.id}"] [data-audio-viz-mode]`).click()

console.log('-- desktop: playback survives leaving the chat')
await p.locator(`[data-audio-player="${song.att.id}"] [data-audio-play]`).click(); await p.waitForTimeout(800)
const bar = p.locator('[data-now-playing]')
ok('a now-playing bar appears above the user panel', await bar.isVisible() && /Night_Drive|Night Drive/.test(await bar.innerText()) && /alice/i.test(await bar.innerText()), await bar.innerText().catch(() => ''))
const t0 = (await player(p)).t
await p.click(`[data-channel-item="${other.id}"] a`); await p.waitForTimeout(1200)
ok('switching channels keeps it playing', new URL(p.url()).pathname.endsWith(other.id) && !(await player(p)).paused && (await player(p)).t > t0, JSON.stringify(await player(p)))
ok('the now-playing bar is still there', (await bar.getAttribute('data-playing')) === '1')
await p.screenshot({ path: 'now-playing.png' })
await p.click('[data-now-playing-toggle]'); await p.waitForTimeout(200)
ok('pause from the bar', (await player(p)).paused && (await bar.getAttribute('data-playing')) === '0')
await p.click('[data-now-playing-title]'); await p.waitForTimeout(1200)
ok('the title goes back to the message', new URL(p.url()).pathname.endsWith(ch.id) && await p.locator(`[data-audio-player="${song.att.id}"]`).isVisible())
ok('and the card shows where it was', parseFloat(await p.locator(`[data-audio-player="${song.att.id}"] [data-scrubber]`).getAttribute('data-progress')) > 0.05)
await p.locator(`[data-voice-message="${voiceMsg.att.id}"] [data-voice-play]`).click(); await p.waitForTimeout(400)
ok('a voice message plays through the same player, replacing the song', (await player(p)).src.includes(voiceMsg.att.id) && (await p.locator(`[data-audio-player="${song.att.id}"]`).getAttribute('data-playing')) === '0' && (await p.locator(`[data-voice-message="${voiceMsg.att.id}"]`).getAttribute('data-playing')) === '1')
await p.waitForTimeout(2000)
const heard = (await call(a.token, 'GET', `/channels/${ch.id}/messages?limit=10`)).find((m) => m.id === voiceMsg.m.id)?.attachments[0].listened_by ?? []
ok('listening to the end still tells the sender it was heard', heard.includes(b.user.id), JSON.stringify(heard))
ok('the bar clears once it has finished', await bar.count() === 0)
await p.locator(`[data-audio-player="${song.att.id}"] [data-audio-play]`).click(); await p.waitForTimeout(300)
await p.click('[data-now-playing-stop]'); await p.waitForTimeout(200)
ok('✕ stops it and hides the bar', await bar.count() === 0 && (await player(p)).paused)
const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.locator(`[data-audio-player="${song.att.id}"] [data-audio-download]`).click()])
ok('Download saves the file under its name', dl?.suggestedFilename() === 'Night_Drive.wav', dl?.suggestedFilename())

console.log('-- desktop: video')
const iv = p.locator(`[data-inline-video="${clip.att.id}"]`); await iv.waitFor()
await p.waitForSelector(`[data-inline-video="${clip.att.id}"] [data-inline-video-duration]`, { timeout: 5000 }).catch(() => {})
const ib = await iv.boundingBox()
ok('the inline video is a big poster with a play button and its length', ib && ib.width >= 480 && (await iv.locator('[data-inline-video-duration]').innerText().catch(() => '')) === '0:03', JSON.stringify(ib))
const vstate = () => iv.locator('video').evaluate((v) => ({ t: v.currentTime, paused: v.paused, muted: v.muted, rate: v.playbackRate }))
await iv.locator('[data-video-play]').click(); await p.waitForTimeout(1000)
let vs = await vstate()
ok('play starts it right there in the chat, no viewer opens', vs.t > 0.2 && !vs.paused && await p.locator('[role="dialog"] video').count() === 0 && (await iv.getAttribute('data-video-player')) === 'playing', JSON.stringify(vs))
ok('with its own controls instead of the browser\'s', await iv.locator('video').getAttribute('controls') === null && await iv.locator('[data-video-controls]').isVisible() && /^0:0\d \/ 0:03$/.test(await iv.locator('[data-video-time]').innerText()), await iv.locator('[data-video-time]').innerText())
await p.screenshot({ path: 'video-inline.png', clip: { ...(await iv.boundingBox()), x: (await iv.boundingBox()).x - 8, width: (await iv.boundingBox()).width + 16 } })
await iv.locator('[data-video-surface]').click(); await p.waitForTimeout(150)
ok('clicking the video pauses it', (await vstate()).paused && (await iv.getAttribute('data-video-player')) === 'paused')
{ const sb = await iv.locator('[data-video-seek]').boundingBox(); await p.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2); await p.waitForTimeout(200) }
vs = await vstate(); ok('clicking the middle of the seek bar goes to the middle', Math.abs(vs.t - 1.5) < 0.35, JSON.stringify(vs))
await iv.locator('[data-video-mute]').click(); await p.waitForTimeout(100)
ok('mute mutes it, and is remembered for other videos', (await vstate()).muted && /"muted":true/.test(await p.evaluate(() => Object.entries(localStorage).find(([k]) => k.endsWith('videoVolume'))?.[1] ?? '')))
await iv.locator('[data-video-mute]').click()
await iv.locator('[data-video-speed]').click(); await iv.locator('[data-video-speeds] button', { hasText: '1.5x' }).click()
ok('speed: 1.5x from the speed menu', (await vstate()).rate === 1.5 && (await iv.locator('[data-video-speed]').innerText()) === '1.5x')
await iv.focus(); await p.keyboard.press('k'); await p.waitForTimeout(300)
ok('K (or Space) plays and pauses while it has focus', !(await vstate()).paused)
await p.mouse.move(5, 5); await p.waitForTimeout(400)
ok('the controls fade away when the pointer leaves while it plays', await iv.locator('[data-video-controls]').evaluate((e) => getComputedStyle(e).opacity === '0'))
await iv.hover(); await p.waitForTimeout(250)
ok('and come back on hover', await iv.locator('[data-video-controls]').evaluate((e) => getComputedStyle(e).opacity === '1'))
await iv.locator('[data-video-fullscreen]').click(); await p.waitForTimeout(500)
ok('full screen puts the player itself full screen, controls and all', await p.evaluate(() => !!document.fullscreenElement?.matches('[data-inline-video]') && !!document.fullscreenElement.querySelector('[data-video-controls]') && document.fullscreenElement.getAttribute('data-fullscreen') === '1'))
await p.screenshot({ path: 'video-fullscreen.png' })
await p.mouse.move(700, 450); await p.locator('[data-fullscreen] [data-video-fullscreen]').click(); await p.waitForTimeout(400)
ok('and the same button leaves it, back in the chat', await p.evaluate(() => !document.fullscreenElement) && (await iv.boundingBox()).width < 1000)
if ((await vstate()).paused) { await iv.hover(); await iv.locator('[data-video-toggle]').click() }
await p.locator(`[data-audio-player="${song.att.id}"] [data-audio-play]`).click(); await p.waitForTimeout(300)
ok('playing audio pauses the video', (await vstate()).paused)
await p.click('[data-now-playing-stop]').catch(() => {})
await p.context().close()

console.log('-- phone')
const ph = await open(b.token, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const pc = ph.locator(`[data-audio-player="${song.att.id}"]`); await pc.waitFor()
const pcb = await pc.boundingBox()
ok('phone: the card fits the screen', pcb && pcb.x >= 0 && pcb.x + pcb.width <= 390, JSON.stringify(pcb))
await pc.locator('[data-audio-download]').tap(); await ph.waitForSelector('[data-menu-sheet]', { timeout: 3000 }).catch(() => {})
await ph.waitForTimeout(400); const sheet = await ph.locator('[data-menu-sheet]').innerText().catch(() => '')
ok('phone: Download opens a sheet: Save to Device, Copy Link, Open in Browser', /Save to Device/.test(sheet) && /Copy Link/.test(sheet) && /Open in Browser/.test(sheet), sheet)
await ph.screenshot({ path: 'audio-phone-sheet.png' })
const [pdl] = await Promise.all([ph.waitForEvent('download', { timeout: 5000 }).catch(() => null), ph.locator('[data-menu-sheet] [data-menu-item="Save to Device"]').tap()])
ok('phone: Save to Device downloads it', pdl?.suggestedFilename() === 'Night_Drive.wav', pdl?.suggestedFilename())
const pvid = ph.locator(`[data-inline-video="${clip.att.id}"]`); await pvid.scrollIntoViewIfNeeded()
const pvb = await pvid.boundingBox()
ok('phone: the video fits the chat', pvb && pvb.x >= 0 && pvb.x + pvb.width <= 390, JSON.stringify(pvb))
await pvid.locator('[data-video-play]').tap(); await ph.waitForTimeout(900)
ok('phone: a tap plays it in the chat', await pvid.locator('video').evaluate((v) => !v.paused && v.currentTime > 0.2))
await pvid.locator('video').evaluate((v) => { v.currentTime = 0 })
await pvid.locator('[data-video-surface]').tap({ position: { x: 30, y: 30 } }); await ph.waitForTimeout(250)
const hid = await pvid.locator('[data-video-controls]').evaluate((e) => getComputedStyle(e).opacity === '0')
await pvid.locator('[data-video-surface]').tap({ position: { x: 30, y: 30 } }); await ph.waitForTimeout(250)
ok('phone: a tap on the video hides the controls, the next shows them with a big pause button', hid && await pvid.locator('[data-video-center]').isVisible() && await pvid.locator('[data-video-fullscreen]').isVisible())
await ph.screenshot({ path: 'video-phone.png' })
await pvid.locator('[data-video-center]').tap(); await ph.waitForTimeout(150)
ok('phone: which pauses it', await pvid.locator('video').evaluate((v) => v.paused))

console.log('-- iPhone')
const ip = await open(b.token, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' })
const ic = ip.locator(`[data-audio-player="${song.att.id}"]`); await ic.waitFor()
await ic.locator('[data-audio-play]').tap(); await ip.waitForTimeout(1000)
const ipl = await player(ip)
ok('iPhone: it plays', ipl && !ipl.paused && ipl.t > 0.3, JSON.stringify(ipl))
ok('iPhone: the audio stays out of Web Audio, so it keeps playing in the background', await ip.evaluate(() => !('analysed' in document.querySelector('audio[data-player]').dataset)))
ok('iPhone: the visualiser still reacts to the music (the server\'s timeline)', (await ic.locator('[data-audio-viz]').getAttribute('data-source')) === 'timeline' && await lit(ic.locator('[data-audio-viz]')) > 100, await ic.locator('[data-audio-viz]').getAttribute('data-source'))
await ip.context().close()

ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
