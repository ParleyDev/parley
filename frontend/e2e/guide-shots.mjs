// Screenshots for the user guide (docs/guide → website/guide/shots). Builds a small made-up world on the test stack
// (a hiking club with a few friends, their messages, a poll, roles, a voice channel and a song in the studio; every
// picture is drawn here), then shoots each screen the guide shows. Run it after a change to a screen the guide
// pictures, then node scripts/guide-build.mjs:
//
//   cd frontend && PARLEY_API_ORIGIN=http://localhost:18090 PARLEY_WEB=http://localhost:5199 node e2e/guide-shots.mjs [name …]
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { WEB, B, H, PASSWORD, call, callS, track, cleanup, testContainer, openProfileEditor } from './lib.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../website/guide/shots')
mkdirSync(OUT, { recursive: true })
const wanted = process.argv.slice(2)
const n = String(Date.now() % 100000).padStart(5, '0')
const VIEW = { width: 1440, height: 900 }

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })

// ---- made-up pictures ----
const drawer = await browser.newPage()
async function draw(svg, w, h) {
  await drawer.setViewportSize({ width: w, height: h })
  await drawer.setContent(`<body style="margin:0">${svg}</body>`)
  return drawer.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } })
}
const avatarSvg = (initial, a, b) => `<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="256" height="256" fill="url(#g)"/><text x="128" y="160" font-family="Arial, sans-serif" font-weight="700" font-size="120" fill="#fff" text-anchor="middle" opacity=".92">${initial}</text></svg>`
const mountains = (w, h) => `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a62"/><stop offset=".6" stop-color="#7b5cff"/><stop offset="1" stop-color="#2b2163"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#s)"/><circle cx="${w * 0.7}" cy="${h * 0.42}" r="${h * 0.12}" fill="#ffd27a" opacity=".9"/><path d="M0 ${h} L${w * 0.22} ${h * 0.45} L${w * 0.38} ${h * 0.7} L${w * 0.55} ${h * 0.35} L${w * 0.8} ${h * 0.75} L${w} ${h * 0.5} L${w} ${h} Z" fill="#1d1846"/><path d="M0 ${h} L${w * 0.15} ${h * 0.75} L${w * 0.35} ${h * 0.9} L${w * 0.6} ${h * 0.68} L${w} ${h * 0.92} L${w} ${h} Z" fill="#120f2e"/></svg>`
async function upload(token, kind, png) {
  const f = new FormData(); f.append('file', new Blob([png], { type: 'image/png' }), `${kind}.png`)
  const r = await fetch(`${B}/images?kind=${kind}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': H['X-Forwarded-For'] }, body: f })
  return (await r.json()).url
}

/** `sec` seconds of 16-bit mono audio: a plucked chord every half second, a kick on the beat and hats between. */
function riffWav(sec) {
  const rate = 22050, n = rate * sec, buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 329.6]]
  let seed = 1
  for (let i = 0; i < n; i++) {
    const t = i / rate, beat = t % 0.5, chord = chords[Math.floor(t / 2) % 4]
    let v = chord.reduce((a, f) => a + Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t), 0) * 0.16 * Math.exp(-beat * 5)
    v += 0.5 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-beat * 30)) * beat) * Math.exp(-beat * 12)
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const hat = (t + 0.25) % 0.5
    v += ((seed / 0x7fffffff) * 2 - 1) * 0.12 * Math.exp(-hat * 60)
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 26000))), 44 + i * 2)
  }
  return buf
}

// ---- people ----
const PEOPLE = [
  ['maya', 'Maya Chen', 'M', '#7b6cff', '#e66cff', 'she/her', 'Weekend hiker, weekday designer. Ask me about trail snacks.'],
  ['theo', 'Theo Park', 'T', '#2fb27c', '#1d7ac9', 'he/him', 'Bass player. Mountains on Sundays.'],
  ['priya', 'Priya Shah', 'P', '#ff8a4c', '#ff4c7a', 'she/her', 'Photographer. I carry the big lens so you don\'t have to.'],
  ['sam', 'Sam Rivera', 'S', '#f5b94a', '#e0612f', 'they/them', 'Trail lead. Maps, mostly.'],
  ['jo', 'Jo Okafor', 'J', '#3aa7ff', '#6b5bff', 'he/him', 'New here, bringing the coffee.'],
]
const U = {}
// Whatever happens, the made-up people go again (their servers with them).
let cleaned = false
const tidy = async () => { if (!cleaned) { cleaned = true; await cleanup() } }
process.on('uncaughtException', async (e) => { console.error(e); await tidy(); process.exit(1) })
process.on('unhandledRejection', async (e) => { console.error(e); await tidy(); process.exit(1) })
for (const [key, display, initial, a, b, pronouns, bio] of PEOPLE) {
  const username = `${key}_${n}`
  const r = await fetch(`${B}/auth/register`, { method: 'POST', headers: H, body: JSON.stringify({ username, email: `${username}@guide.example`, password: PASSWORD, display_name: display }) })
  const j = await r.json()
  if (!j.token) throw new Error(`could not register ${username}: ${JSON.stringify(j)}`)
  const avatar = await upload(j.token, 'avatar', await draw(avatarSvg(initial, a, b), 256, 256))
  await call(j.token, 'PATCH', '/users/@me', { avatar_url: avatar, pronouns, bio })
  await call(j.token, 'PATCH', '/users/@me/privacy', { dm_privacy: 'everyone' }).catch(() => {})
  track(j.user)
  U[key] = { ...j, display }
}
const me = U.maya
// Made-up addresses can't be verified by email; mark them on the test database so no banner asks.
execFileSync('docker', ['exec', testContainer('db'), 'psql', '-U', 'parley', '-tAc', `UPDATE users SET email_verified_at = now() WHERE username LIKE '%\\_${n}'`])
for (const k of ['theo', 'priya', 'sam', 'jo']) {
  await call(me.token, 'POST', '/users/@me/relationships', { username: U[k].user.username })
  await call(U[k].token, 'PUT', `/users/@me/relationships/${me.user.id}`, {})
}
await call(me.token, 'PATCH', '/users/@me', { custom_status: 'Packing for Saturday ⛰️', banner_url: await upload(me.token, 'banner', await draw(mountains(1200, 480), 1200, 480)) })

// ---- the server ----
const icon = await upload(me.token, 'icon', await draw(mountains(256, 256), 256, 256))
const g = await call(me.token, 'POST', '/guilds', { name: 'Weekend Hikers', icon_url: icon })
const banner = await upload(me.token, 'banner', await draw(mountains(1280, 720), 1280, 720)).catch(() => null)
await call(me.token, 'PATCH', `/guilds/${g.id}`, { banner_url: banner, description: 'Trails, photos and the occasional summit.' }).catch(() => {})
const inv = await call(me.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const k of ['theo', 'priya', 'sam', 'jo']) await call(U[k].token, 'POST', `/invites/${inv.code}`)
const chans = await call(me.token, 'GET', `/guilds/${g.id}/channels`)
const general = chans.find((c) => c.name === 'general' && c.kind !== 'voice') ?? (await call(me.token, 'POST', `/guilds/${g.id}/channels`, { name: 'general' }))
const mk = async (name, kind = 'text', extra = {}) => (await callS(me.token, 'POST', `/guilds/${g.id}/channels`, { name, kind, ...extra })).body
const trip = await mk('trip-planning', 'text', { topic: 'Saturday: Eagle Ridge loop, 14 km' })
await mk('photos')
await mk('gear-talk', 'forum')
const campfire = chans.find((c) => c.kind === 'voice') ?? await mk('Campfire', 'voice')
const studio = await mk('jam-room', 'studio')

const lead = await call(me.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Trail Leads', color: '#2fb27c', hoist: true })
const shooter = await call(me.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Photographers', color: '#ff8a4c', hoist: true })
await call(me.token, 'POST', `/guilds/${g.id}/roles`, { name: 'Coffee Crew', color: '#3aa7ff' })
for (const [who, role] of [['sam', lead], ['maya', lead], ['priya', shooter]]) await call(me.token, 'PATCH', `/guilds/${g.id}/members/${U[who].user.id}`, { roles: [role.id] })

const say = (who, ch, content, extra = {}) => call(U[who].token, 'POST', `/channels/${ch.id}/messages`, { content, ...extra })
const react = (who, ch, m, e) => call(U[who].token, 'PUT', `/channels/${ch.id}/messages/${m.id}/reactions/${encodeURIComponent(e)}`)
await say('sam', general, 'Morning all! Who\'s in for **Eagle Ridge** on Saturday? ⛰️')
const m2 = await say('priya', general, 'Me! The light up there at 8am is unreal 📸')
await say('jo', general, 'First hike with you lot, what should I bring?')
const m4 = await say('theo', general, 'Water, snacks, layers. And whatever Maya says about snacks, double it.')
await say('maya', general, 'Trail mix with *extra* chocolate. Non-negotiable.', { reply_to: m4.id })
for (const [w, e] of [['sam', '😂'], ['jo', '😂'], ['priya', '🍫']]) await react(w, general, m4, e)
await react('maya', general, m2, '🔥'); await react('theo', general, m2, '🔥')
await say('sam', trip, 'Plan for Saturday:\n- Meet at the north car park, **7:30**\n- Loop is 14 km, about 5 hours\n- Lunch at the lake')
const poll = await say('sam', trip, '', { poll: { question: 'Where do we eat after?', options: ['Pizza place by the station', 'The lake café', 'Somebody\'s garden 🌭'], multi: false, duration_hours: 72 } })
const opts = poll.poll?.options ?? []
for (const [who, i] of [['sam', 1], ['priya', 1], ['theo', 0], ['jo', 2]]) if (opts[i]) await call(U[who].token, 'PUT', `/channels/${trip.id}/messages/${poll.id}/poll/${opts[i].id}`)
const p2 = await say('priya', trip, 'I\'ll bring the spare poles for anyone who wants them')
await react('jo', trip, p2, '🙏'); await react('maya', trip, p2, '❤️')
await say('jo', trip, `<@${U.sam.user.id}> is it okay for beginners?`)
await say('sam', trip, 'Totally. One steep bit near the top, we\'ll go slow.')

// The studio: a song with a few tracks.
let project = null
if (studio?.id) {
  project = (await callS(me.token, 'POST', `/channels/${studio.id}/studio/projects`, { name: 'Summit Song' })).body
  const st = project?.channel_id
  if (st) {
    // A made-up riff (plucked chords over a kick and hats) on the guitar, with effects on it and the bass, for the
    // effect windows.
    const riff = (await (await fetch(`${B}/channels/${st}/studio/audio?name=Riff.wav&duration_ms=8000`, { method: 'POST', headers: { Authorization: `Bearer ${me.token}`, 'Content-Type': 'audio/wav', 'X-Forwarded-For': H['X-Forwarded-For'] }, body: riffWav(8) })).json())
    const fx = { Guitar: [{ type: 'eq', params: { lowcut: 90, low: -2, midFreq: 2400, mid: 4, high: 3 } }, { type: 'compressor', params: { threshold: -24, ratio: 4, makeup: 4 } }, { type: 'reverb', params: { size: 2.6, mix: 0.3 } }], Bass: [{ type: 'filter', params: { freq: 900, q: 4 } }] }
    const lanes = ['Vocals', 'Guitar', 'Bass', 'Drums'].map((name, i) => ({ id: crypto.randomUUID(), name, position: i, user_id: me.user.id, effects: (fx[name] ?? []).map((e) => ({ id: crypto.randomUUID(), on: true, ...e })) }))
    const made = await callS(me.token, 'POST', `/studio/projects/${project.id}/ops`, { ops: [
      ...lanes.map((lane) => ({ op: 'lane.put', lane })),
      ...(riff?.id ? [lanes[1], lanes[2]].map((l) => ({ op: 'clip.put', clip: { id: crypto.randomUUID(), lane_id: l.id, audio_id: riff.id, start_ms: 0, length_ms: 8000 } })) : []),
      { op: 'project', loop_start_ms: 0, loop_end_ms: 8000, loop_on: true },
    ] })
    if (made.status >= 300) console.log('studio ops:', made.status, JSON.stringify(made.body), JSON.stringify(riff))
  }
}

// ---- shooting ----
async function open(token, path, viewport = VIEW) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, permissions: ['microphone', 'camera'] })
  const p = await ctx.newPage()
  await p.goto(`${WEB}/login`)
  await p.evaluate((t) => { localStorage.setItem('parley.token', t); }, token)
  await p.evaluate((id) => localStorage.setItem(`parley.gettingStarted.${id}`, 'done'), me.user.id)
  await p.goto(`${WEB}${path}`)
  await p.waitForSelector('[data-panel-self]')
  await p.waitForTimeout(1200)
  return p
}
// A few friends are online the whole time.
const online = {}
for (const k of ['theo', 'priya', 'sam']) online[k] = await open(U[k].token, `/channels/${g.id}/${general.id}`)
const shots = {
  async layout() { const p = await open(me.token, `/channels/${g.id}/${general.id}`); return p },
  async messages() { const p = await open(me.token, `/channels/${g.id}/${trip.id}`); await p.waitForSelector('[data-poll]', { timeout: 5000 }).catch(() => {}); return p },
  async voice() {
    const others = Object.values(online)
    for (const o of others) {
      await o.goto(`${WEB}/channels/${g.id}/${campfire.id}`); await o.click('text=Join Voice'); await o.waitForSelector('[data-voice-leave]')
    }
    const p = await open(me.token, `/channels/${g.id}/${campfire.id}`)
    await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]'); await p.waitForTimeout(2500)
    p.cleanup = () => Promise.all([...others, p].map((x) => x.click('[data-voice-leave]').catch(() => {})))
    return p
  },
  async 'profile-editor'() { const p = await open(me.token, `/channels/${g.id}/${general.id}`); await openProfileEditor(p); await p.waitForTimeout(600); return p },
  async 'cosmetic-picker'() {
    const p = await open(me.token, `/channels/${g.id}/${general.id}`)
    await openProfileEditor(p, { section: 'decoration' })
    const opt = p.locator('[data-cosmetic-grid] [data-cosmetic-option]').nth(2)
    await opt.hover(); await opt.click(); await p.waitForTimeout(800)
    return p
  },
  async settings() { const p = await open(me.token, `/channels/${g.id}/${general.id}`); await p.click('[data-user-panel] [data-control="User Settings"]'); await p.click('[data-settings-tab="appearance"]'); await p.waitForTimeout(600); return p },
  async 'server-settings'() { const p = await open(me.token, `/channels/${g.id}/${general.id}`); await p.click('aside button:has-text("Weekend Hikers")'); await p.click('text=Server Settings'); await p.click('[data-settings-tab="overview"]'); await p.waitForTimeout(800); return p },
  async roles() { const p = await open(me.token, `/channels/${g.id}/${general.id}`); await p.click('aside button:has-text("Weekend Hikers")'); await p.click('text=Server Settings'); await p.click('[data-settings-tab="roles"]'); await p.waitForTimeout(600); await p.locator('text=Trail Leads').first().click().catch(() => {}); await p.waitForTimeout(600); return p },
  async studio() {
    if (!project?.channel_id) throw new Error('no studio project')
    const p = await open(me.token, `/channels/${g.id}/${project.channel_id}`); await p.waitForSelector('[data-daw]', { timeout: 10000 }); await p.waitForTimeout(800); return p
  },
  async 'studio-effects'() {
    if (!project?.channel_id) throw new Error('no studio project')
    const p = await open(me.token, `/channels/${g.id}/${project.channel_id}`); await p.waitForSelector('[data-daw]', { timeout: 10000 })
    await p.click('[data-daw-view-mixer]'); await p.waitForSelector('[data-daw-mixer]')
    // The guitar's EQ and compressor and the bass's filter, side by side over the mixer, while the song plays.
    const spots = { eq: [24, 70], compressor: [560, 70], filter: [300, 430] }
    for (const [t, [x, y]] of Object.entries(spots)) {
      await p.locator(`[data-daw-fx-slot="${t}"] [data-daw-fx-open]`).first().dispatchEvent('click')
      const w = p.locator(`[data-daw-fx-editor="${t}"]`); await w.waitFor()
      const h = await w.locator('[data-float-window-handle]').boundingBox()
      await p.mouse.move(h.x + 40, h.y + 10); await p.mouse.down(); await p.mouse.move(x + 40, y + 10, { steps: 6 }); await p.mouse.up()
    }
    await p.locator('[data-daw-play]').dispatchEvent('click')
    await p.waitForFunction(() => document.querySelectorAll('[data-daw-fx-live="yes"]').length === 3, null, { timeout: 10000 }).catch(() => {})
    await p.waitForTimeout(2600)
    p.cleanup = () => p.locator('[data-daw-play]').dispatchEvent('click').catch(() => {})
    return p
  },
}

let failed = 0
for (const [name, take] of Object.entries(shots)) {
  if (wanted.length && !wanted.includes(name)) continue
  try {
    const p = await take()
    await p.screenshot({ path: join(OUT, `${name}.png`) })
    await p.cleanup?.()
    console.log(`  shot  ${name}`)
    await p.context().close()
  } catch (e) { failed++; console.log(`  FAIL  ${name}: ${e.message.split('\n')[0]}`) }
}

// Tidy up: the server, then the people.
await call(me.token, 'DELETE', `/guilds/${g.id}`).catch(() => {})
await tidy()
await browser.close()
process.exit(failed ? 1 : 0)
