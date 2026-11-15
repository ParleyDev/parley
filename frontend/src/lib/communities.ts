import type { Channel, CommunitySlim } from './types'

/** Stable empties for a server with none, so the identity-keyed caches below still hit. */
export const NO_COMMUNITIES: CommunitySlim[] = []
export const NO_FOLLOWS: string[] = []

/**
 * Split a server's categories into ordinary ones and the followed communities' (a community is backed by one
 * category). Followed blocks come in follow order; unfollowed communities' categories are not shown at all.
 */
export function splitCategories(categories: Channel[], communities: CommunitySlim[], followed: string[]): { own: Channel[]; followed: { community: CommunitySlim; category: Channel }[] } {
  const backing = byCategory(communities)
  const byId = byIdIndex(communities)
  const cats = new Map(categories.map((c) => [c.id, c]))
  const out: { community: CommunitySlim; category: Channel }[] = []
  for (const id of followed) {
    const community = byId.get(id)
    const category = community && cats.get(community.category_id)
    if (community && category) out.push({ community, category })
  }
  return { own: categories.filter((c) => !backing.has(c.id)), followed: out }
}

// Servers can hold a thousand communities, and these run per incoming message and per server icon per render, so the
// derived lookups are cached on the identity of the (immutable, store-owned) arrays they came from.
const byCategoryCache = new WeakMap<CommunitySlim[], Map<string, CommunitySlim>>()
const unfollowedCache = new WeakMap<CommunitySlim[], WeakMap<string[], ReadonlySet<string>>>()

const byIdCache = new WeakMap<CommunitySlim[], Map<string, CommunitySlim>>()

function byIdIndex(communities: CommunitySlim[]): Map<string, CommunitySlim> {
  let m = byIdCache.get(communities)
  if (!m) { m = new Map(communities.map((c) => [c.id, c])); byIdCache.set(communities, m) }
  return m
}

function byCategory(communities: CommunitySlim[]): Map<string, CommunitySlim> {
  let m = byCategoryCache.get(communities)
  if (!m) { m = new Map(communities.map((c) => [c.category_id, c])); byCategoryCache.set(communities, m) }
  return m
}

/** Categories of communities the member does not follow (cached per pair of arrays: do not mutate the result). */
export function unfollowedCategoryIds(communities: CommunitySlim[], followed: string[]): ReadonlySet<string> {
  let per = unfollowedCache.get(communities)
  if (!per) { per = new WeakMap(); unfollowedCache.set(communities, per) }
  let set = per.get(followed)
  if (!set) {
    const f = new Set(followed)
    set = new Set(communities.filter((c) => !f.has(c.id)).map((c) => c.category_id))
    per.set(followed, set)
  }
  return set
}

/** The community a channel belongs to (threads resolve through their parent channel), if any. */
export function communityOfChannel(channel: Channel, channels: Record<string, Channel>, communities: CommunitySlim[]): CommunitySlim | null {
  let ch: Channel | undefined = channel
  if (ch.kind === 'thread' && ch.parent_id) ch = channels[ch.parent_id]
  const cat = ch?.parent_id
  return (cat && byCategory(communities).get(cat)) || null
}

/** An unfollowed community stays quiet unless the message is about me. */
export function communitySuppresses(unfollowed: boolean, mentioned: boolean, repliesToMe: boolean): boolean {
  return unfollowed && !mentioned && !repliesToMe
}
