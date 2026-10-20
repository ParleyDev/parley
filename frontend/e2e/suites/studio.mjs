// Recording Studio: engineer / band / audience roles, multitrack client-side recording, tracks, and the mixer.
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Studio ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`); await call(c.token, 'POST', `/invites/${inv.code}`)

console.log('-- setup API')
let r = await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'studio-a', kind: 'studio' }); ok('studio channel created', r.status === 201 && r.body.kind === 'studio' && r.body.engineer_id === null)
const st = r.body
r = await raw(b.token, 'PUT', `/channels/${st.id}/studio/engineer/${b.user.id}`); ok('picking the engineer needs Manage Channels', r.status === 403)
r = await raw(a.token, 'POST', `/channels/${st.id}/studio/sessions`, { name: 'x' }); ok('only the engineer records (none yet)', r.status === 403)
r = await callS(a.token, 'PUT', `/channels/${st.id}/studio/engineer/${a.user.id}`); ok('owner makes herself engineer', r.status === 200 && r.body.engineer_id === a.user.id)
r = await raw(a.token, 'POST', `/studio/sessions/${st.id}/tracks`, {}); ok('unknown session -> 404', r.status === 404)

console.log('-- in the studio')
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const mk = async (tok) => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(`${WEB}/channels/${g.id}/${st.id}`); await p.waitForSelector('text=Join Voice'); await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]'); return p }
const pa = await mk(a.token); const pb = await mk(b.token); const pc = await mk(c.token)
await pa.waitForSelector(`[data-audience="${b.user.id}"]`); await pa.waitForSelector(`[data-audience="${c.user.id}"]`)
ok('engineer is on a tile with the badge; others join as audience', await pa.locator(`[data-voice-tile="${a.user.id}"] [data-engineer-badge]`).count() === 1 && await pa.locator('[data-stage-audience] [data-audience]').count() === 2)
await pa.locator(`[data-audience="${b.user.id}"] [data-invite-speak]`).click()
await pb.waitForSelector(`[data-voice-tile="${b.user.id}"]`)
ok('"Add to band" makes bob an artist', await pa.locator(`[data-voice-tile="${b.user.id}"] [data-artist-badge]`).count() === 1)
r = await raw(c.token, 'POST', `/channels/${st.id}/studio/sessions`, { name: 'nope' }); ok('audience cannot record', r.status === 403)
await pa.click('[data-studio-record]')
await pa.waitForSelector('[data-studio-rec]'); await pb.waitForSelector('[data-studio-rec]')
await pb.waitForFunction(() => window.__parleyStudio?.recording === true, null, { timeout: 10000 })
ok('the engineer and the artist are recording their own tracks; the audience is not', await pa.evaluate(() => window.__parleyStudio?.recording === true) && await pc.evaluate(() => !window.__parleyStudio?.recording))
const live = (await call(c.token, 'GET', `/channels/${st.id}/studio/sessions`))[0]
ok('session is open with two tracks registered', live && live.ended_at === null && live.tracks.length === 2 && live.tracks.every((t) => !t.done))
r = await raw(c.token, 'POST', `/studio/sessions/${live.id}/tracks`, {}); ok('audience cannot add a track', r.status === 403)
r = await raw(c.token, 'POST', `/studio/sessions/${live.id}/tracks/${live.tracks[0].id}/chunks`); ok('nobody can write to someone else\'s track', r.status === 403)
await pa.waitForTimeout(6500)   // > one 5-second chunk
await pa.screenshot({ path: '154-studio-recording.png' })
await pa.click('[data-studio-record]')
await pa.waitForFunction(() => !document.querySelector('[data-studio-rec]'))
await pa.waitForFunction(() => window.__parleyStudio?.recording === false)
let done
for (let i = 0; i < 30; i++) { done = (await call(a.token, 'GET', `/channels/${st.id}/studio/sessions`))[0]; if (done.ended_at && done.tracks.every((t) => t.done)) break; await pa.waitForTimeout(500) }
ok('stop ends the session; both tracks finished with audio and durations', !!done.ended_at && done.tracks.length === 2 && done.tracks.every((t) => t.done && t.size > 1000 && (t.duration_ms ?? 0) > 5000), JSON.stringify(done.tracks.map((t) => [t.display_name, t.size, t.duration_ms, t.offset_ms])))
r = await raw(c.token, 'GET', `/studio/tracks/${done.tracks[0].id}`); ok('tracks are served as audio to channel members', r.status === 200 && r.headers.get('content-type')?.startsWith('audio/'))
r = await raw((await reg('dave')).token, 'GET', `/studio/tracks/${done.tracks[0].id}`); ok('not to outsiders', r.status === 404 || r.status === 403)

console.log('-- sessions panel + mixer')
await pc.click('[data-studio-toggle]'); await pc.waitForSelector(`[data-studio-session="${done.id}"]`)
await pc.click(`[data-studio-session="${done.id}"] button`); await pc.waitForSelector('[data-studio-track]')
ok('the panel lists both tracks with downloads', await pc.locator('[data-studio-track][data-track-done="1"]').count() === 2 && await pc.locator('[data-track-download]').count() === 2)
await pc.click('[data-mix-load]'); await pc.waitForSelector('[data-mixer]', { timeout: 20000 })
ok('the mixer decodes both tracks', await pc.evaluate(() => window.__parleyMix?.tracks === 2 && window.__parleyMix.seconds > 4), JSON.stringify(await pc.evaluate(() => window.__parleyMix)))
await pc.click('[data-mix-play]'); await pc.waitForTimeout(800)
ok('play all runs', await pc.locator('[data-mix-play][title="Stop"]').count() === 1)
await pc.locator('[data-mix-mute]').first().click(); ok('mute toggles', (await pc.locator('[data-mix-mute]').first().getAttribute('aria-pressed')) === 'true')
await pc.click('[data-mix-play]')
await pc.click('[data-mix-export]')
await pc.waitForFunction(() => (window.__parleyMix?.exportedBytes ?? 0) > 44, null, { timeout: 30000 })
ok('Export mix renders a WAV', await pc.evaluate(() => window.__parleyMix.exportedBytes > 48000 * 2 * 2 * 4))
await pc.screenshot({ path: '155-studio-mixer.png' })
r = await raw(b.token, 'DELETE', `/channels/${st.id}/studio/sessions/${done.id}`); ok('artists cannot delete sessions', r.status === 403)
r = await raw(a.token, 'DELETE', `/channels/${st.id}/studio/sessions/${done.id}`); ok('the engineer can', r.status === 204)
ok('and the files are gone', (await raw(c.token, 'GET', `/studio/tracks/${done.tracks[0].id}`)).status === 404)
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
