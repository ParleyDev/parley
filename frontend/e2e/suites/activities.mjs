// Activities in calls: the launcher lists the built-ins and apps with an activity URL; starting one opens it for
// you and shows a Join chip to the others; Tic-Tac-Toe plays through shared state; Watch Together hands a joiner
// the current video; an app activity gets its context from the SDK, relays messages and gets an OAuth code its
// server can swap; leaving the call leaves the activity, and the last one out ends it.
import http from 'node:http'
import { chromium } from 'playwright'
import { WEB, B, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol')
const g = await call(a.token, 'POST', '/guilds', { name: `Play ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const u of [b, c]) await call(u.token, 'POST', `/invites/${inv.code}`)
const vc = g.channels.find((x) => x.kind === 'voice')

// The app's activity page, served from its own origin, reporting what the SDK gives it.
const seen = []
const page = `<!doctype html><meta charset=utf-8><title>App activity</title><body><button id=auth>Sign in</button><button id=say>Say hi</button><div id=log></div>
<script src="${WEB}/activities/sdk.js"></script><script>
const report = (kind, data) => fetch('/report', { method: 'POST', body: JSON.stringify({ kind, data }) })
ParleyActivity.ready().then((ctx) => report('ready', ctx))
ParleyActivity.on('message', (m) => report('message', m))
ParleyActivity.on('participants', (p) => report('participants', p))
document.getElementById('auth').onclick = () => ParleyActivity.authorize('identify').then((r) => report('code', r), (e) => report('denied', e.message))
document.getElementById('say').onclick = () => ParleyActivity.sendMessage({ hello: 'there' })
</script>`
const server = http.createServer((req, res) => {
  if (req.method === 'POST') { let body = ''; req.on('data', (x) => (body += x)); req.on('end', () => { seen.push(JSON.parse(body)); res.end() }); return }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page)
})
await new Promise((r) => server.listen(0, '0.0.0.0', r))
const ACT = `http://localhost:${server.address().port}/act.html`
const app = await call(a.token, 'POST', '/applications', { name: `Quiz ${S}` })
ok('an app can set an activity URL', (await call(a.token, 'PATCH', `/applications/${app.id}`, { activity_url: ACT })).activity_url === ACT)
ok('only http(s) ones', (await raw(a.token, 'PATCH', `/applications/${app.id}`, { activity_url: 'javascript:alert(1)' })).status === 400)

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const mk = async (u) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, permissions: ['microphone'] })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}/channels/${g.id}/${vc.id}`); await p.waitForSelector('text=Join Voice')
  await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]')
  return p
}
const until = async (f, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await Promise.resolve().then(f).catch(() => false)) return true; await new Promise((r) => setTimeout(r, 200)) } return false }

console.log('-- launcher')
ok('starting needs you in the call', (await raw(c.token, 'POST', `/channels/${vc.id}/activities`, { key: 'tictactoe' })).status === 400)
const pa = await mk(a), pb = await mk(b)
await pa.click('[data-activities-toggle]'); await pa.waitForSelector('[data-activity-launcher] [data-activity-key]')
const keys = await pa.locator('[data-activity-key]').evaluateAll((els) => els.map((e) => e.getAttribute('data-activity-key')))
ok('the launcher lists Watch Together, Tic-Tac-Toe and your app', keys.includes('watch') && keys.includes('tictactoe') && keys.includes(`app:${app.id}`), keys.join())
ok('others don\'t get your app unless it\'s in the server or installed', !(await call(b.token, 'GET', `/channels/${vc.id}/activities/catalog`)).some((x) => x.key === `app:${app.id}`))
ok('unknown activities are refused', (await raw(a.token, 'POST', `/channels/${vc.id}/activities`, { key: 'doom' })).status === 400)

console.log('-- tic-tac-toe')
await pa.click('[data-activity-key="tictactoe"]')
await pa.waitForSelector('[data-activity-frame="tictactoe"]')
const fa = pa.frameLocator('[data-activity-iframe]')
await fa.locator('[data-seat="X"]').waitFor()
ok('starting opens it for you', true)
ok('the others see who is playing, with Join', await until(async () => (await pb.locator('[data-activity-chip="tictactoe"]').count()) === 1))
await pb.click('[data-activity-join="tictactoe"]'); await pb.waitForSelector('[data-activity-frame="tictactoe"]')
const fb = pb.frameLocator('[data-activity-iframe]')
ok('both are in it', await until(async () => (await pa.locator('[data-activity-people="2"]').count()) === 1 && (await fb.locator('#who').innerText()).startsWith('2 here')))
await fa.locator('[data-seat="X"]').click()
await until(async () => (await fb.locator('[data-seat="X"]').innerText()).includes('Alice'))
await fb.locator('[data-seat="O"]').click()
ok('seats sync', await until(async () => (await fa.locator('[data-seat="O"]').innerText()).includes('Bob')))
const move = async (f, i) => { await f.locator(`[data-cell="${i}"]:not([disabled])`).click(); await new Promise((r) => setTimeout(r, 250)) }
await move(fa, 0)
ok('a move shows on the other side', await until(async () => (await fb.locator('[data-cell="0"]').innerText()) === 'X'))
ok('and it is their turn', await until(async () => (await fb.locator('#status').getAttribute('data-status')) === 'turn-O'))
await move(fb, 4); await until(async () => (await fa.locator('[data-cell="4"]').innerText()) === 'O')
await move(fa, 1); await until(async () => (await fb.locator('[data-cell="1"]').innerText()) === 'X')
await move(fb, 5); await until(async () => (await fa.locator('[data-cell="5"]').innerText()) === 'O')
await move(fa, 2)
ok('three in a row wins, for everyone', await until(async () => (await fb.locator('#status').getAttribute('data-status')) === 'win-X' && (await fa.locator('#status').getAttribute('data-status')) === 'win-X'))
const sid = (await call(a.token, 'GET', `/channels/${vc.id}/activities`))[0]?.id
ok('only people in it can read it', (await raw(c.token, 'GET', `/activities/${sid}`)).status === 404)
ok('state is capped', (await raw(a.token, 'PUT', `/activities/${sid}/state`, { state: { x: 'y'.repeat(40000) } })).status === 400)
await pb.click('[data-activity-leave]')
ok('leaving closes it and brings back Join', await until(async () => (await pb.locator('[data-activity-join="tictactoe"]').count()) === 1))
ok('the others see one fewer', await until(async () => (await pa.locator('[data-activity-people="1"]').count()) === 1))

console.log('-- watch together')
await pa.click('[data-activities-toggle]'); await pa.click('[data-activity-key="watch"]')
await pa.waitForSelector('[data-activity-frame="watch"]')
ok('starting another leaves the first (one at a time), and the last one out ends it', await until(async () => (await pb.locator('[data-activity-chip="tictactoe"]').count()) === 0 && (await pb.locator('[data-activity-chip="watch"]').count()) === 1))
const fw = pa.frameLocator('[data-activity-iframe]')
await fw.locator('#url').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'); await fw.locator('button[type="submit"]').click()
ok('a YouTube link starts the video', await until(async () => (await fw.locator('#now').getAttribute('data-video')) === 'dQw4w9WgXcQ'))
await pb.click('[data-activity-join="watch"]'); await pb.waitForSelector('[data-activity-frame="watch"]')
ok('someone joining gets the same video', await until(async () => (await pb.frameLocator('[data-activity-iframe]').locator('#now').getAttribute('data-video')) === 'dQw4w9WgXcQ'))
await pb.click('[data-activity-leave]'); await pa.click('[data-activity-leave]')

console.log('-- app activity')
await pa.click('[data-activities-toggle]'); await pa.click(`[data-activity-key="app:${app.id}"]`)
await pa.waitForSelector(`[data-activity-frame="app:${app.id}"]`)
ok('the SDK hands the page who, where and who else', await until(() => seen.some((x) => x.kind === 'ready')) && (() => { const r = seen.find((x) => x.kind === 'ready').data; return r.user.id === a.user.id && r.channel_id === vc.id && r.guild_id === g.id && r.participants.length === 1 && r.instance_id })(), JSON.stringify(seen[0]))
await pb.click(`[data-activity-join="app:${app.id}"]`); await pb.waitForSelector(`[data-activity-frame="app:${app.id}"]`)
ok('joining someone\'s app activity works without the app', await until(() => seen.filter((x) => x.kind === 'ready').length === 2))
ok('the page hears who joined', await until(() => seen.some((x) => x.kind === 'participants' && x.data.length === 2)))
await pa.frameLocator('[data-activity-iframe]').locator('#say').click()
ok('messages reach the others', await until(() => seen.some((x) => x.kind === 'message' && x.data.data.hello === 'there' && x.data.user_id === a.user.id)))
await pa.frameLocator('[data-activity-iframe]').locator('#auth').click()
await pa.waitForSelector('[data-activity-authorize]')
ok('authorize asks the user first', true)
await pa.click('[data-activity-authorize-ok]')
ok('then hands the page a code', await until(() => seen.some((x) => x.kind === 'code')))
const code = seen.find((x) => x.kind === 'code').data.code
const secret = (await call(a.token, 'POST', `/applications/${app.id}/reset-secret`, {})).client_secret
const tok = await fetch(`${B}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: app.client_id, client_secret: secret, redirect_uri: ACT }) }).then((r) => r.json())
const meOAuth = await fetch(`${B}/oauth2/@me`, { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json())
ok('which the app\'s server swaps for a token naming the player', meOAuth.user?.id === a.user.id, JSON.stringify(tok))

console.log('-- leaving the call')
await pb.click('[data-voice-leave]')
ok('leaving the call leaves the activity', await until(async () => (await call(a.token, 'GET', `/channels/${vc.id}/activities`))[0]?.participants.length === 1))
await pa.click('[data-voice-leave]')
ok('and the last one out ends it', await until(async () => (await call(a.token, 'GET', `/channels/${vc.id}/activities`)).length === 0))
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/applications/${app.id}`)
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); server.close(); await finish()
