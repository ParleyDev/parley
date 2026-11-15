import type { Channel, CommunitySlim } from './types'

/**
 * Split a server's categories into ordinary ones and the followed communities' (a community is backed by one
 * category). Followed blocks come in follow order; unfollowed communities' categories are not shown at all.
 */
export function splitCategories(categories: Channel[], communities: CommunitySlim[], followed: string[]): { own: Channel[]; followed: { community: CommunitySlim; category: Channel }[] } {
  const backing = new Set(communities.map((c) => c.category_id))
  const byId = new Map(communities.map((c) => [c.id, c]))
  const cats = new Map(categories.map((c) => [c.id, c]))
  const out: { community: CommunitySlim; category: Channel }[] = []
  for (const id of followed) {
    const community = byId.get(id)
    const category = community && cats.get(community.category_id)
    if (community && category) out.push({ community, category })
  }
  return { own: categories.filter((c) => !backing.has(c.id)), followed: out }
}

/** Categories of communities the member does not follow. */
export function unfollowedCategoryIds(communities: CommunitySlim[], followed: string[]): Set<string> {
  const f = new Set(followed)
  return new Set(communities.filter((c) => !f.has(c.id)).map((c) => c.category_id))
}

/** The community a channel belongs to (threads resolve through their parent channel), if any. */
export function communityOfChannel(channel: Channel, channels: Record<string, Channel>, communities: CommunitySlim[]): CommunitySlim | null {
  let ch: Channel | undefined = channel
  if (ch.kind === 'thread' && ch.parent_id) ch = channels[ch.parent_id]
  const cat = ch?.parent_id
  return (cat && communities.find((c) => c.category_id === cat)) || null
}

/** An unfollowed community stays quiet unless the message is about me. */
export function communitySuppresses(unfollowed: boolean, mentioned: boolean, repliesToMe: boolean): boolean {
  return unfollowed && !mentioned && !repliesToMe
}
