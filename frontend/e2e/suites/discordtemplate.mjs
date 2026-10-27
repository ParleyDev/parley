// Importing a Discord server template to migrate a server: link/code/JSON in, preview of roles and channels, then a
// new server with the same categories, channels, roles, colours and permission overwrites (Discord's permission bits
// mapped to Parley's).
import { chromium } from 'playwright'
import { WEB, S, reg, call, raw, ok, finish } from '../lib.mjs'
const a = await reg('alice')
// Shaped like GET https://discord.com/api/v10/guilds/templates/:code
const tpl = {
  code: 'hgM48av5Q69A', name: `Gaming Hub ${S}`, description: 'Squad up', usage_count: 3,
  serialized_source_guild: {
    name: 'Gaming', description: null, verification_level: 1, default_message_notifications: 1, explicit_content_filter: 0, afk_timeout: 900,
    system_channel_id: 11, afk_channel_id: 21,
    roles: [
      { id: 0, name: '@everyone', permissions: '1071698660929', color: 0, hoist: false, mentionable: false },
      { id: 1, name: 'Member', permissions: '0', color: 3447003, hoist: true, mentionable: false, unicode_emoji: '🎮' },
      // Manage Threads (1<<34), Manage Events (1<<33), Moderate Members (1<<40), Kick (1<<1), View Insights (1<<19)
      { id: 2, name: 'Moderator', permissions: String((1n << 34n) | (1n << 33n) | (1n << 40n) | 2n | (1n << 19n)), color: 15158332, hoist: true, mentionable: true },
    ],
    channels: [
      { id: 10, type: 4, name: 'Text Channels', position: 0, parent_id: null, permission_overwrites: [] },
      { id: 20, type: 4, name: 'Voice Channels', position: 1, parent_id: null, permission_overwrites: [] },
      { id: 30, type: 4, name: 'Staff', position: 2, parent_id: null, permission_overwrites: [{ id: 0, type: 0, allow: '0', deny: '1024' }, { id: 2, type: 0, allow: '1024', deny: '0' }] },
      { id: 11, type: 0, name: 'general', position: 0, topic: 'Say hi', parent_id: 10, nsfw: false, rate_limit_per_user: 5, permission_overwrites: [] },
      { id: 12, type: 5, name: 'announcements', position: 1, parent_id: 10, permission_overwrites: [{ id: 0, type: 0, allow: '0', deny: '2048' }] },
      { id: 13, type: 15, name: 'clips', position: 2, parent_id: 10, default_forum_layout: 1, permission_overwrites: [] },
      { id: 21, type: 2, name: 'Lobby', position: 0, parent_id: 20, user_limit: 10, permission_overwrites: [] },
      { id: 22, type: 13, name: 'Stage', position: 1, parent_id: 20, permission_overwrites: [] },
      { id: 31, type: 0, name: 'mod-chat', position: 0, parent_id: 30, permission_overwrites: [] },
      { id: 40, type: 14, name: 'directory-thing', position: 9, parent_id: null, permission_overwrites: [] },
    ],
  },
}

console.log('-- API')
let r = await raw(a.token, 'POST', '/templates/discord/preview', { source: 'not a template !!' })
ok('nonsense is refused with a hint', r.status === 400 && /discord\\.new|template/i.test((await r.json()).error))
r = await raw(a.token, 'POST', '/templates/discord/preview', { source: JSON.stringify({ hello: 1 }) })
ok('JSON that is not a template is refused', r.status === 400)
const pv = await call(a.token, 'POST', '/templates/discord/preview', { source: JSON.stringify(tpl) })
ok('a pasted template previews its roles and channels', pv.name === `Gaming Hub ${S}` && pv.snapshot.roles.length === 2 && pv.snapshot.channels.length === 9, JSON.stringify(pv).slice(0, 300))
ok('and says what stays behind', pv.notes.some((n) => /left out/.test(n)))
ok('categories come first so channels can sit in them', pv.snapshot.channels.slice(0, 3).every((c) => c.kind === 'category'))
const just = await call(a.token, 'POST', '/templates/discord/preview', { source: JSON.stringify(tpl.serialized_source_guild) })
ok('the bare serialized guild works too', just.snapshot?.channels.length === 9)

console.log('-- the browser')
const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), a.token)
await p.goto(`${WEB}/channels/@me`); await p.waitForTimeout(1000)
await p.click('[data-add-server]'); await p.click('[data-template="discord"]')
await p.locator('[data-discord-file]').setInputFiles({ name: 'template.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tpl)) })
await p.waitForSelector('[data-discord-preview-channels]')
ok('uploading the .json previews it', await p.locator('[data-discord-preview-roles]').getAttribute('data-discord-preview-roles') === '2' && (await p.locator('[data-discord-template]').innerText()).includes('mod-chat'))
await p.fill('[data-create-name]', `Imported ${S}`)
await p.click('[data-discord-import]'); await p.waitForURL(/\/channels\/\d|\/channels\/[0-9a-f-]{36}/, { timeout: 10000 })
const gid = p.url().split('/channels/')[1].split('/')[0]
const g = await call(a.token, 'GET', `/guilds/${gid}`)
ok('creates the server with your name for it', g.name === `Imported ${S}`)
const chans = await call(a.token, 'GET', `/guilds/${gid}/channels`)
const by = (n) => chans.find((c) => c.name === n)
ok('channels land in their categories', by('general')?.parent_id === by('Text Channels')?.id && by('Lobby')?.parent_id === by('Voice Channels')?.id && by('mod-chat')?.parent_id === by('Staff')?.id)
ok('announcement channels, forums and stages come across', by('announcements')?.news === true && by('clips')?.kind === 'forum' && by('clips')?.forum_layout === 'list' && by('Stage')?.kind === 'stage')
ok('topic, slowmode and user limit come across', by('general')?.topic === 'Say hi' && by('general')?.rate_limit_per_user === 5 && by('Lobby')?.user_limit === 10)
ok('unsupported channel kinds are skipped', !by('directory-thing'))
const roles = await call(a.token, 'GET', `/guilds/${gid}/roles`)
const mod = roles.find((x) => x.name === 'Moderator'), member = roles.find((x) => x.name === 'Member')
ok('roles keep colour, hoist and emoji', member?.color === '#3498db' && member?.hoist && member?.icon === '🎮' && mod?.color === '#e74c3c')
ok('roles keep their order (Moderator above Member)', mod.position > member.position)
const P = { KICK: 1 << 1, MANAGE_THREADS: 1 << 19, MANAGE_EVENTS: 1 << 25, MODERATE: 1 << 29 }
ok('Discord permission bits map to Parley\'s', (mod.permissions & P.KICK) && (mod.permissions & P.MANAGE_THREADS) && (mod.permissions & P.MANAGE_EVENTS) && (mod.permissions & P.MODERATE), String(mod.permissions))
ok('private categories stay private', by('Staff')?.overwrites.some((o) => o.id === gid && (o.deny & 1024)) && by('Staff')?.overwrites.some((o) => o.id === mod.id && (o.allow & 1024)))
ok('read-only announcements stay read-only', by('announcements')?.overwrites.some((o) => o.id === gid && (o.deny & 2048)))
ok('system and AFK channels and notification default', g.system_channel_id === by('general')?.id && g.afk_channel_id === by('Lobby')?.id && g.default_notifications === 'mentions' && g.afk_timeout === 900)
ok('no page errors', errors.length === 0, errors.join(' | '))
await call(a.token, 'DELETE', `/guilds/${gid}`)
await browser.close(); await finish()
