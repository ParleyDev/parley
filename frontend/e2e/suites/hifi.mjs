// High-fidelity / ultra-low-latency audio: per-channel profile (API + settings UI), Opus parameters negotiated in a
// real two-browser mesh call (stereo, bitrate, 10 ms frames; Always Transmit so the gate never closes), capture with voice processing off, live stats, and a
// mid-call profile change that renegotiates without rejoining.
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, ok, finish } from '../lib.mjs'
const a = await reg('alice'); const b = await reg('bob')
const g = await call(a.token, 'POST', '/guilds', { name: `HiFi ${S}` }); const vc = g.channels.find((x) => x.kind === 'voice')
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`)

console.log('-- API')
ok('voice channels default to the voice profile', vc.audio_mode === 'voice' && vc.audio_bitrate === 0 && vc.audio_low_latency === false, JSON.stringify(vc))
ok('an unknown mode is rejected', (await callS(a.token, 'PATCH', `/channels/${vc.id}`, { audio_mode: 'loud' })).status === 400)
ok('bitrates outside 8-510 kbps are rejected', (await callS(a.token, 'PATCH', `/channels/${vc.id}`, { audio_bitrate: 600 })).status === 400 && (await callS(a.token, 'PATCH', `/channels/${vc.id}`, { audio_bitrate: 4 })).status === 400)
ok('members without Manage Channels cannot change it', (await callS(b.token, 'PATCH', `/channels/${vc.id}`, { audio_mode: 'music' })).status === 403)
const studio = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'Studio', kind: 'studio' })
ok('new studio channels default to high fidelity, low latency', studio.audio_mode === 'music' && studio.audio_low_latency === true, JSON.stringify(studio))

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); const errors = []
const mk = async (tok) => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await p.evaluate((t) => { localStorage.setItem('parley.token', t); localStorage.setItem('parley.voiceSettings', JSON.stringify({ inputMode: 'open' })) }, tok); await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); return p }

console.log('-- settings UI')
const pa = await mk(a.token)
await pa.click('aside [data-channel-row="General"]', { button: 'right' }); await pa.click('[data-context-menu] [data-menu-item="Edit Channel"]'); await pa.waitForSelector('[data-audio-settings]')
ok('voice channel settings show the Audio section with Voice selected', (await pa.getAttribute('[data-audio-mode="voice"]', 'aria-pressed')) === 'true' && (await pa.textContent('[data-audio-bitrate-value]')).includes('64 kbps (default)'))
await pa.click('[data-audio-mode="music"]')
ok('switching to High fidelity moves the default to 256 kbps', (await pa.textContent('[data-audio-bitrate-value]')).includes('256 kbps (default)'))
await pa.locator('[data-audio-bitrate]').fill('320')
await pa.click('[data-audio-low-latency] input')
await pa.click('button:has-text("Save Changes")'); await pa.waitForSelector('text=Channel updated')
const saved = (await call(a.token, 'GET', `/guilds/${g.id}/channels`)).find((c) => c.id === vc.id)
ok('Save stores music, 320 kbps and low latency', saved.audio_mode === 'music' && saved.audio_bitrate === 320 && saved.audio_low_latency === true, JSON.stringify(saved))
await pa.keyboard.press('Escape'); await pa.waitForFunction(() => !document.querySelector('[data-audio-settings]'))

console.log('-- high-fidelity call')
const pb = await mk(b.token)
for (const p of [pa, pb]) { await p.waitForSelector('text=Join Voice'); await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]') }
const dbg = (p) => p.evaluate(() => window.__parleyAudio())
// Poll from Node: stats need two samples a second apart, and waitForFunction does not await async predicates.
const until = async (p, pred, ms = 20000) => { const end = Date.now() + ms; let d; while (Date.now() < end) { d = await dbg(p); if (pred(d)) return d; await p.waitForTimeout(1000) } return d }
await until(pa, (d) => d.peers.length === 1 && !!d.peers[0].remote && (d.stats[0]?.inKbps ?? 0) > 0 && d.stats[0]?.frameMs != null)
let da = await until(pa, (d) => d.stats[0]?.frameMs != null && /stereo/.test(d.stats[0]?.codec ?? '')); const db = await dbg(pb)
const fm = (d) => Object.fromEntries((d.peers[0].remote?.fmtp ?? '').split(';').map((kv) => kv.split('=')))
ok('both sides run the channel profile', da.profile.mode === 'music' && da.profile.bitrate === 320 && da.profile.lowLatency && db.profile.mode === 'music')
ok('the far side asks for stereo, 320 kbps, no DTX and 10 ms frames', fm(da).stereo === '1' && fm(da).maxaveragebitrate === '320000' && fm(da).usedtx === '0' && da.peers[0].remote.ptime === '10', JSON.stringify(da.peers[0].remote))
ok('capture runs with echo cancellation, noise suppression and auto gain off', da.constraints && da.constraints.echoCancellation === false && da.constraints.noiseSuppression === false && da.constraints.autoGainControl === false, JSON.stringify(da.constraints))
const st = da.stats[0]
ok('audio flows as Opus 48 kHz stereo', /^opus 48 kHz stereo$/.test(st.codec), st.codec)
ok('outgoing audio uses 10 ms frames', st.frameMs === 10, JSON.stringify(st))
ok('incoming bitrate is well above speech rates', st.inKbps > 96, JSON.stringify(st))
console.log(`  stats: ${JSON.stringify(st)}`)

console.log('-- stats UI')
await pa.click('[data-audio-stats-toggle]'); await pa.click('[data-voice-debug]'); await pa.waitForSelector(`[data-audio-stat="${b.user.id}"]`)
ok('the voice card shows HI-FI and LL badges', await pa.locator('[data-hifi-badge]').count() === 1 && await pa.locator('[data-lowlat-badge]').count() === 1)
await pa.waitForFunction((id) => /stereo/.test(document.querySelector(`[data-audio-stat="${id}"] [data-audio-stat-codec]`)?.textContent ?? ''), b.user.id)
await pa.waitForFunction((id) => /\d+ ms/.test(document.querySelector(`[data-audio-stat="${id}"] [data-audio-stat-frame]`)?.textContent ?? ''), b.user.id, { timeout: 10000 }).catch(() => {})
ok('the stats popover lists the participant with codec, frame size and buffer', (await pa.textContent(`[data-audio-stat="${b.user.id}"] [data-audio-stat-frame]`)).includes('10 ms') && /buffer \d+ ms/.test(await pa.textContent(`[data-audio-stat="${b.user.id}"] [data-audio-stat-jitter]`)))
await pa.screenshot({ path: '190-hifi-stats.png' })
await pa.click('[data-audio-stats-toggle]', { force: true }).catch(() => {}); await pa.mouse.click(5, 5)

console.log('-- live profile change')
await call(a.token, 'PATCH', `/channels/${vc.id}`, { audio_mode: 'voice', audio_bitrate: 0, audio_low_latency: false })
da = await until(pa, (d) => d.profile.mode === 'voice' && /stereo=0/.test(d.peers[0]?.remote?.fmtp ?? '') && d.peers[0]?.remote?.ptime === '20', 15000)
ok('switching to Voice renegotiates in place: mono, 64 kbps, 20 ms frames', fm(da).stereo === '0' && fm(da).maxaveragebitrate === '64000' && da.peers[0].remote.ptime === '20', JSON.stringify(da.peers[0]?.remote))
ok('capture returns to the user\'s voice processing', da.constraints?.echoCancellation === true, JSON.stringify(da.constraints))
ok('the call stayed up (no rejoin)', await pa.locator('[data-voice-leave]').count() === 1 && da.peers.length === 1)
const back = await until(pa, (d) => d.stats[0]?.frameMs === 20, 10000)
ok('outgoing frames return to 20 ms', back.stats[0]?.frameMs === 20, JSON.stringify(back.stats[0]))

ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
