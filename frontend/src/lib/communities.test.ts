import { expect, test, vi } from 'vitest'
import { communityOfChannel, communitySuppresses, communityUnread, loadCollapsed, saveCollapsed, showCommunitiesSection, slugFromName, splitCategories, unfollowedCategoryIds } from './communities'
import { guildUnread, showsUnread, useStore } from '../store'
import { api } from './api'
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: { put: vi.fn(), delete: vi.fn() } }))

import type { Channel, CommunitySlim } from './types'

const cat = (id: string) => ({ id, kind: 'category', guild_id: 'g' }) as Channel
const com = (id: string, category_id: string) => ({ id, guild_id: 'g', slug: id, name: id, icon_url: null, description: '', category_id }) as CommunitySlim

test('splitCategories keeps plain categories and orders followed ones by follow order', () => {
  const r = splitCategories([cat('c1'), cat('c2'), cat('c3'), cat('c4')], [com('m', 'c2'), com('p', 'c3'), com('s', 'c4')], ['p', 'm', 'gone'])
  expect(r.own.map((c) => c.id)).toEqual(['c1'])
  expect(r.followed.map((f) => f.community.id)).toEqual(['p', 'm'])
})
test('unfollowedCategoryIds', () => {
  expect([...unfollowedCategoryIds([com('m', 'c2'), com('p', 'c3')], ['p'])]).toEqual(['c2'])
})
test('communityOfChannel resolves channels and threads', () => {
  const channels = { c2: cat('c2'), t: { id: 't', kind: 'text', parent_id: 'c2' }, th: { id: 'th', kind: 'thread', parent_id: 't' }, x: { id: 'x', kind: 'text', parent_id: null } } as unknown as Record<string, Channel>
  const cs = [com('m', 'c2')]
  expect(communityOfChannel(channels.t, channels, cs)?.id).toBe('m')
  expect(communityOfChannel(channels.th, channels, cs)?.id).toBe('m')
  expect(communityOfChannel(channels.x, channels, cs)).toBeNull()
})
test('communitySuppresses is true only when unfollowed and not about me', () => {
  for (const unfollowed of [true, false]) for (const mentioned of [true, false]) for (const repliesToMe of [true, false]) {
    expect(communitySuppresses(unfollowed, mentioned, repliesToMe), `${unfollowed} ${mentioned} ${repliesToMe}`).toBe(unfollowed && !mentioned && !repliesToMe)
  }
})
test('guildUnread ignores unfollowed communities until followed', () => {
  const channels = { c2: cat('c2'), t: { id: 't', kind: 'text', guild_id: 'g', parent_id: 'c2' } } as unknown as Record<string, Channel>
  const base = { channels, dms: {}, notifSettings: {}, readStates: { t: null }, lastMessageId: { t: 'm1' }, communities: { g: [com('m', 'c2')] } }
  expect(guildUnread({ ...base, communityFollows: {} }, 'g')).toBe(false)
  expect(guildUnread({ ...base, communityFollows: { g: ['m'] } }, 'g')).toBe(true)
})
test('unread marks follow mute, not the notification level', () => {
  const channels = { t: { id: 't', kind: 'text', guild_id: 'g', parent_id: null } } as unknown as Record<string, Channel>
  const base = { channels, dms: {}, notifSettings: {}, readStates: { t: null }, lastMessageId: { t: 'm1' } }
  const guilds = (level: string) => ({ g: { id: 'g', default_notifications: level } }) as unknown as Parameters<typeof guildUnread>[0]['guilds']
  // A server defaulting to "Only @mentions" (or a member choosing "Nothing") still shows where the new messages are.
  for (const level of ['all', 'mentions', 'nothing']) {
    expect(guildUnread({ ...base, guilds: guilds(level) }, 'g'), level).toBe(true)
    expect(showsUnread({ ...base, guilds: guilds(level) }, 't'), level).toBe(true)
  }
  expect(showsUnread({ ...base, notifSettings: { t: { target_id: 't', level: 'nothing' } } as never }, 't')).toBe(true)
  // Muting hides them.
  const muted = { g: { target_id: 'g', level: 'default', muted_until: '9999-01-01T00:00:00Z' } } as never
  expect(guildUnread({ ...base, notifSettings: muted }, 'g')).toBe(false)
  expect(showsUnread({ ...base, notifSettings: muted }, 't')).toBe(false)
})

test('the derived lookups are computed once per array and answer like the plain versions', () => {
  const cs = [com('m', 'c2'), com('p', 'c3')], fs = ['p']
  expect(unfollowedCategoryIds(cs, fs)).toBe(unfollowedCategoryIds(cs, fs))
  expect([...unfollowedCategoryIds(cs, [])]).toEqual(['c2', 'c3'])
  // a changed follow list is a new array and gets a fresh answer
  expect([...unfollowedCategoryIds(cs, ['p', 'm'])]).toEqual([])
  const channels = { c3: cat('c3'), t: { id: 't', kind: 'text', parent_id: 'c3' } } as unknown as Record<string, Channel>
  expect(communityOfChannel(channels.t, channels, cs)).toBe(cs[1])
  expect(communityOfChannel(channels.t, channels, [com('m', 'c2')])).toBeNull()
})
test('a failed follow request puts the follow list back exactly as it was', async () => {
  const c = com('b', 'c2')
  const before = ['a', 'b', 'd']
  useStore.setState({ communities: { g: [com('a', 'c1'), c, com('d', 'c3')] }, communityFollows: { g: before }, pushToast: vi.fn() })
  vi.mocked(api.delete).mockRejectedValueOnce(new Error('nope'))
  expect(await useStore.getState().followCommunity('g', 'b', false)).toBe(false)
  expect(useStore.getState().communityFollows.g).toEqual(['a', 'b', 'd'])
  expect(useStore.getState().pushToast).toHaveBeenCalledWith('nope', 'error')
  // the other direction: a follow that fails leaves the list as it was, and one that works applies
  useStore.setState({ communityFollows: { g: ['a', 'd'] } })
  vi.mocked(api.put).mockRejectedValueOnce(new Error('gone'))
  expect(await useStore.getState().followCommunity('g', 'b', true)).toBe(false)
  expect(useStore.getState().communityFollows.g).toEqual(['a', 'd'])
  vi.mocked(api.put).mockResolvedValueOnce(undefined)
  expect(await useStore.getState().followCommunity('g', 'b', true)).toBe(true)
  expect(useStore.getState().communityFollows.g).toEqual(['a', 'd', 'b'])
})

test('slugFromName lower-cases, hyphenates and trims to a valid address', () => {
  expect(slugFromName('Black Sabbath')).toBe('black-sabbath')
  expect(slugFromName('  --Rock & Roll!! ')).toBe('rock-roll')
  expect(slugFromName('a'.repeat(70) + ' b')).toBe('a'.repeat(63))
  expect(slugFromName('***')).toBe('')
})

test('communityUnread folds a community\'s channels into one dot and one count', () => {
  const unread = new Set(['b']); const mentions: Record<string, number> = { b: 2, c: 3 }
  const m = (id: string) => mentions[id] ?? 0
  expect(communityUnread([], (id) => unread.has(id), m)).toEqual({ unread: false, mentions: 0 })
  expect(communityUnread(['a', 'b'], (id) => unread.has(id), () => 0)).toEqual({ unread: true, mentions: 0 })
  expect(communityUnread(['a', 'b', 'c'], () => false, m)).toEqual({ unread: false, mentions: 5 })
  expect(communityUnread(['a'], (id) => unread.has(id), m)).toEqual({ unread: false, mentions: 0 })
})

test('showCommunitiesSection is on when anything is viewable, followed, or creatable', () => {
  for (const v of [0, 4]) for (const f of [0, 2]) for (const c of [false, true]) {
    expect(showCommunitiesSection(v, f, c)).toBe(v > 0 || f > 0 || c)
  }
})

test('the collapsed set round-trips per server and survives bad storage', () => {
  const data = new Map<string, string>()
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
  vi.stubGlobal('localStorage', store)
  expect(loadCollapsed('g1').size).toBe(0)
  saveCollapsed('g1', new Set(['x', 'y']))
  expect([...loadCollapsed('g1')].sort()).toEqual(['x', 'y'])
  expect(loadCollapsed('g2').size).toBe(0)
  data.set('parley.communities.collapsed.g3', '{not json')
  expect(loadCollapsed('g3').size).toBe(0)
  data.set('parley.communities.collapsed.g3', '{"a":1}')
  expect(loadCollapsed('g3').size).toBe(0)
  const boom = () => { throw new Error('denied') }
  vi.stubGlobal('localStorage', { getItem: boom, setItem: boom })
  expect(loadCollapsed('g1').size).toBe(0)
  expect(() => saveCollapsed('g1', new Set(['x']))).not.toThrow()
  vi.unstubAllGlobals()
})
