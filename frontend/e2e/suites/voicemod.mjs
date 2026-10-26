// Voice moderation and channel options: server mute / deafen (kept on the member, shown in red, silencing them),
// Move To and Disconnect from the user menu, the new permissions, voice user limits (full channels turn people away
// except movers and someone being moved in) and voice channel status (set by people inside, cleared when empty).
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice'), b = await reg('bob'), c = await reg('carol'), d = await reg('dave')
const g = await call(a.token, 'POST', '/guilds', { name: `VMod ${S}` })
const inv = await call(a.token, 'POST', `/guilds/${g.id}/invites`, {})
for (const u of [b, c, d]) await call(u.token, 'POST', `/invites/${inv.code}`)
const vc1 = g.channels.find((x) => x.kind === 'voice')
const vc2 = await call(a.token, 'POST', `/guilds/${g.id}/channels`, { name: 'Overflow', kind: 'voice' })
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }); const errors = []
const mk = async (tok, ch, join = true) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] })
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), tok)
  await p.goto(`${WEB}/channels/${g.id}/${ch}`); await p.waitForSelector('text=Join Voice')
  if (join) { await p.click('text=Join Voice'); await p.waitForSelector('[data-voice-leave]') }
  return p
}
const pb = await mk(b.token, vc1.id); const pc = await mk(c.token, vc1.id); const pa = await mk(a.token, vc1.id, false)
await pc.waitForFunction((id) => document.querySelector(`audio[data-peer="${id}"]`), b.user.id, { timeout: 15000 })
const member = async (u) => (await call(a.token, 'GET', `/guilds/${g.id}/members`)).find((m) => m.user_id === u.user.id)

console.log('-- permissions')
ok('members without Mute Members cannot server mute', (await raw(c.token, 'PATCH', `/guilds/${g.id}/members/${b.user.id}`, { mute: true })).status === 403)
ok('or move people', (await raw(c.token, 'PATCH', `/guilds/${g.id}/members/${b.user.id}`, { channel_id: vc2.id })).status === 403)
ok('moving someone who isn\'t in voice is refused', (await raw(a.token, 'PATCH', `/guilds/${g.id}/members/${d.user.id}`, { channel_id: vc2.id })).status === 400)

console.log('-- server mute and deafen')
const bobRow = `[data-channel-item="${vc1.id}"] button:has-text("Bob")`
await pa.click(bobRow, { button: 'right' }); await pa.waitForSelector('[data-context-menu]')
const items = await pa.locator('[data-context-menu] [data-menu-item]').evaluateAll((els) => els.map((e) => e.dataset.menuItem))
ok('a moderator\'s menu has Server Mute, Server Deafen, Move To and Disconnect', ['Server Mute', 'Server Deafen', 'Move To', 'Disconnect'].every((x) => items.includes(x)), JSON.stringify(items))
await pa.click('[data-context-menu] [data-menu-item="Server Mute"]'); await pa.waitForTimeout(700)
ok('server mute is stored on the member', (await member(b)).mute === true)
ok('everyone sees it in red', await pc.locator(`[data-channel-item="${vc1.id}"] [data-server-mute]`).count() === 1)
ok('and they are told', await pb.locator('[data-server-muted]').count() === 1)
await pa.click(bobRow, { button: 'right' }); await pa.click('[data-context-menu] [data-menu-item="Server Deafen"]'); await pa.waitForTimeout(700)
ok('server deafen silences everyone for them', await pb.evaluate((id) => document.querySelector(`audio[data-peer="${id}"]`)?.muted, c.user.id) === true)
await pb.click('[data-voice-leave]'); await pb.waitForTimeout(500); await pb.click('text=Join Voice'); await pb.waitForSelector('[data-voice-leave]'); await pb.waitForTimeout(1500)
ok('it follows them when they rejoin', await pb.locator('[data-server-deafened]').count() === 1)
await call(a.token, 'PATCH', `/guilds/${g.id}/members/${b.user.id}`, { mute: false, deaf: false }); await pb.waitForTimeout(1500)
ok('lifting it lets them hear again', await pb.waitForFunction((id) => document.querySelector(`audio[data-peer="${id}"]`)?.muted === false, c.user.id, { timeout: 8000 }).then(() => true).catch(() => false))
ok('and the banners go', await pb.locator('[data-server-deafened], [data-server-muted]').count() === 0)

console.log('-- voice channel status')
await pb.click('[data-voice-status-set]'); await pb.fill('[data-voice-status-input]', 'Watching the finals'); await pb.keyboard.press('Enter'); await pb.waitForTimeout(600)
ok('people in the channel can set its status', /Watching the finals/.test(await pc.locator(`[data-voice-status="${vc1.id}"]`).innerText().catch(() => '')))
ok('people outside it cannot', (await raw(d.token, 'PUT', `/channels/${vc1.id}/voice-status`, { status: 'nope' })).status === 403)

console.log('-- move and disconnect')
await pa.click(bobRow, { button: 'right' }); await pa.hover('[data-context-menu] [data-menu-item="Move To"]'); await pa.click('[data-context-menu] button:has-text("Overflow")'); await pa.waitForTimeout(2000)
ok('Move To moves them to the other channel', await pa.locator(`[data-channel-item="${vc2.id}"] button:has-text("Bob")`).count() === 1 && await pa.locator(`[data-channel-item="${vc1.id}"] button:has-text("Bob")`).count() === 0)
const bobInVc2 = `[data-channel-item="${vc2.id}"] button:has-text("Bob")`
await pa.click(bobInVc2, { button: 'right' }); await pa.click('[data-context-menu] [data-menu-item="Disconnect"]'); await pa.waitForTimeout(1500)
ok('Disconnect drops them from voice', await pa.locator(bobInVc2).count() === 0 && await pb.locator('[data-voice-leave]').count() === 0)
const audit = await call(a.token, 'GET', `/guilds/${g.id}/audit`)
ok('moves and disconnects are in the audit log', audit.some((e) => e.details?.moved_to === vc2.id) && audit.some((e) => e.details?.disconnected))

console.log('-- user limit')
ok('limits stay within 0-99', (await raw(a.token, 'PATCH', `/channels/${vc2.id}`, { user_limit: 100 })).status === 400)
await call(a.token, 'PATCH', `/channels/${vc2.id}`, { user_limit: 1 }); await pa.waitForTimeout(400)
ok('the sidebar shows people / limit', (await pa.locator(`[data-channel-item="${vc2.id}"] [data-user-limit]`).innerText()).trim() === '0/1')
await pb.goto(`${WEB}/channels/${g.id}/${vc2.id}`); await pb.click('text=Join Voice'); await pb.waitForSelector('[data-voice-leave]'); await pb.waitForTimeout(800)
ok('and fills up', (await pa.locator(`[data-channel-item="${vc2.id}"] [data-user-limit]`).innerText()).trim() === '1/1')
await pc.click('[data-voice-leave]'); await pc.waitForTimeout(400)
ok('the last one out clears the status', await pa.locator(`[data-voice-status="${vc1.id}"]`).count() === 0)
await pc.goto(`${WEB}/channels/${g.id}/${vc2.id}`); await pc.click('text=Join Voice'); await pc.waitForTimeout(1500)
ok('a full channel turns people away', await pc.locator('[data-voice-leave]').count() === 0 && /full/.test(await pc.locator('body').innerText()))
await pc.goto(`${WEB}/channels/${g.id}/${vc1.id}`); await pc.click('text=Join Voice'); await pc.waitForSelector('[data-voice-leave]'); await pc.waitForTimeout(800)
await call(a.token, 'PATCH', `/guilds/${g.id}/members/${c.user.id}`, { channel_id: vc2.id }); await pa.waitForTimeout(2500)
ok('but a moderator can move someone into it', await pa.locator(`[data-channel-item="${vc2.id}"] button:has-text("Carol")`).count() === 1)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${g.id}`)
await browser.close(); await finish()
