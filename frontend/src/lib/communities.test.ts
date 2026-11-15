import { expect, test } from 'vitest'
import { communityOfChannel, communitySuppresses, splitCategories, unfollowedCategoryIds } from './communities'
import { guildUnread } from '../store'
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
