// Recording Studio: a project's band (engineers and artists, kept), its audience, multitrack client-side recording
// into the project, and its takes.
import { chromium } from 'playwright'
import { WEB, S, reg, call, callS, raw, ok, finish } from '../lib.mjs'

const a = await reg('alice'); const b = await reg('bob'); const c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Studio ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {}); await call(b.token, 'POST', `/invites/${inv.code}`); await call(c.token, 'POST', `/invites/${inv.code}`)

console.log('-- setup API')
let r = await callS(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'studio-a', kind: 'studio' }); ok('studio channel created', r.status === 201 && r.body.kind === 'studio')
const studio = r.body
r = await callS(a.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Take One' }); ok('a project is its own channel under the studio', r.status === 201 && !!r.body.channel_id)
const P = r.body
const st = await call(a.token, 'GET', `/channels/${P.channel_id}`)
ok('…of kind project, its creator its engineer', st.kind === 'project' && st.parent_id === studio.id && st.engineer_ids.includes(a.user.id) && st.studio.project_id === P.id)
r = await raw(b.token, 'PUT', `/channels/${st.id}/studio/role/${b.user.id}`, { role: 'engineer' }); ok('making yourself engineer needs Manage Projects or an engineer', r.status === 403)
r = await raw(b.token, 'POST', `/channels/${st.id}/studio/sessions`, { name: 'x' }); ok('only an engineer records the band', r.status === 403)
r = await callS(a.token, 'PUT', `/channels/${st.id}/studio/role/${c.user.id}`, { role: 'engineer' }); ok('a second engineer is allowed', r.status === 200 && r.body.engineer_ids.length === 2)
r = await callS(c.token, 'PUT', `/channels/${st.id}/studio/role/${c.user.id}`, { role: 'artist' }); ok('an engineer may step down to artist, staying in the band', r.status === 200 && r.body.engineer_ids.length === 1 && r.body.artist_ids.includes(c.user.id))
r = await callS(c.token, 'PUT', `/channels/${st.id}/studio/role/${c.user.id}`, { role: 'audience' }); ok('and leave the band', r.status === 200 && !r.body.artist_ids.includes(c.user.id))
r = await callS(a.token, 'PUT', `/channels/${st.id}/studio/role/${c.user.id}`, { role: 'dj' }); ok('unknown role refused', r.status === 400)
r = await raw(a.token, 'POST', `/studio/sessions/${st.id}/tracks`, {}); ok('unknown session -> 404', r.status === 404)
r = await raw(a.token, 'POST', `/channels/${studio.id}/messages`, { content: 'hi' }); ok('the studio itself holds no messages', r.status === 400)

console.log('-- in the studio')
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
// The band sees the console before joining and joins from the header; everyone else joins from the pre-join screen.
const mk = async (tok, band) => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok); await p.goto(`${WEB}/channels/${g.id}/${st.id}`); if (band) { await p.waitForSelector('[data-daw]'); await p.click('[data-project-join]') } else { await p.waitForSelector('text=Join Voice'); await p.click('text=Join Voice') } await p.waitForSelector('[data-voice-leave]'); return p }
const pa = await mk(a.token, true)
ok('the engineer had the DAW before joining voice', true)
const pb = await mk(b.token); const pc = await mk(c.token)
await pa.waitForSelector(`[data-audience="${b.user.id}"]`); await pa.waitForSelector(`[data-audience="${c.user.id}"]`)
ok('engineer is on a tile with the badge; others join as audience', await pa.locator(`[data-voice-tile="${a.user.id}"] [data-engineer-badge]`).count() === 1 && await pa.locator('[data-stage-audience] [data-audience]').count() === 2)
const tileBox = await pa.locator(`[data-voice-tile="${a.user.id}"]`).boundingBox(); const audBox = await pa.locator('[data-studio-audience]').boundingBox()
ok('the audience sits below the band as a grid of avatars with names', audBox.y >= tileBox.y + tileBox.height && (await pa.locator(`[data-audience="${b.user.id}"] [data-audience-name]`).textContent()) === 'Bob' && (await pa.locator(`[data-audience="${c.user.id}"] [data-audience-name]`).textContent()) === 'Carol', JSON.stringify({ tileBox, audBox }))
await pa.screenshot({ path: '162-studio-audience.png' })
await pa.locator(`[data-audience="${b.user.id}"]`).hover(); await pa.locator(`[data-audience="${b.user.id}"] [data-role-button]`).click(); await pa.locator(`[data-audience="${b.user.id}"] [data-role-option="artist"]`).click()
await pb.waitForSelector(`[data-voice-tile="${b.user.id}"]`)
ok('the role menu makes bob an artist', await pa.locator(`[data-voice-tile="${b.user.id}"] [data-artist-badge]`).count() === 1)
await pa.locator(`[data-voice-tile="${b.user.id}"] [data-role-button]`).click(); await pa.locator(`[data-voice-tile="${b.user.id}"] [data-role-option="engineer"]`).click()
await pa.waitForSelector(`[data-voice-tile="${b.user.id}"] [data-engineer-badge]`)
ok('and can promote him to a second engineer', (await call(c.token, 'GET', `/channels/${st.id}`)).engineer_ids.length === 2)
await pb.waitForSelector('[data-studio-record]'); ok('both engineers get the Record control', await pb.locator('[data-studio-record]').count() === 1)
await pa.locator(`[data-voice-tile="${b.user.id}"] [data-role-button]`).click(); await pa.locator(`[data-voice-tile="${b.user.id}"] [data-role-option="artist"]`).click()
await pb.waitForFunction(() => !document.querySelector('[data-studio-record]'))
await pa.waitForSelector(`[data-voice-tile="${b.user.id}"] [data-artist-badge]`, { timeout: 10000 }).catch(() => {})
ok('demoting back to artist removes it', await pa.locator(`[data-voice-tile="${b.user.id}"] [data-artist-badge]`).count() === 1)
await pb.locator(`[data-voice-tile="${b.user.id}"] [data-role-button]`).click(); await pb.locator(`[data-voice-tile="${b.user.id}"] [data-role-option="audience"]`).click()
await pb.waitForSelector(`[data-stage-audience] [data-audience="${b.user.id}"]`)
ok('an artist can step down to the audience himself', !(await call(a.token, 'GET', `/channels/${st.id}`)).artist_ids.includes(b.user.id))
await pa.locator(`[data-audience="${b.user.id}"] [data-role-button]`).click(); await pa.locator(`[data-audience="${b.user.id}"] [data-role-option="artist"]`).click(); await pb.waitForSelector(`[data-voice-tile="${b.user.id}"]`)
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

console.log('-- takes land in the project')
const proj = await call(c.token, 'GET', `/studio/projects/${P.id}`)
ok('each member\'s take is a clip on their own lane', proj.clips.filter((x) => done.tracks.some((t) => t.id === x.audio_id)).length === 2 && new Set(proj.lanes.map((l) => l.user_id)).size === 2, JSON.stringify(proj.lanes.map((l) => [l.name, l.user_id])))
await pa.click('[data-daw-takes-open]'); await pa.waitForSelector('[data-daw-take-row]')
ok('the Takes panel lists them', await pa.locator('[data-daw-take-row]').count() >= 2)
r = await raw(b.token, 'DELETE', `/channels/${st.id}/studio/sessions/${done.id}`); ok('artists cannot delete sessions', r.status === 403)
r = await raw(a.token, 'DELETE', `/channels/${st.id}/studio/sessions/${done.id}`); ok('the engineer can', r.status === 204)
ok('takes the project uses stay', (await raw(c.token, 'GET', `/studio/tracks/${done.tracks[0].id}`)).status === 200)
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
