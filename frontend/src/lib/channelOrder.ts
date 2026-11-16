import type { Channel } from './types'

/** A channel's stored place: its position among the channels sharing its parent (a category, or null for none). */
export interface Place { position: number; parent_id?: string | null }
export interface PositionItem { id: string; position: number; parent_id?: string | null }

/**
 * The positions to save after a drag. `groups` is the new order of every group the drag touched (the group the
 * channel left and the one it joined, or the categories); each channel's new position is its index in its group.
 * Only channels whose stored position or parent differs are returned, so a drag in a server with a thousand
 * communities never sends the channels of unrelated categories. `withParent: false` leaves parent_id out (categories).
 */
export function changedPositions(stored: Record<string, Place | undefined>, groups: { parent_id: string | null; ids: string[] }[], withParent = true): PositionItem[] {
  const items: PositionItem[] = []
  for (const g of groups) {
    g.ids.forEach((id, position) => {
      const cur = stored[id]
      if (cur && cur.position === position && (cur.parent_id ?? null) === g.parent_id) return
      items.push(withParent ? { id, position, parent_id: g.parent_id } : { id, position })
    })
  }
  return items
}

const byPlace = (a: Channel, b: Channel) => a.position - b.position || a.created_at.localeCompare(b.created_at)

/**
 * The first text channel in sidebar order: uncategorised channels first, then each category in its own order, each
 * one's channels by position. Positions are per group, so a flat sort by position does not match what the sidebar shows.
 * Categories in `excludeCategoryIds` are skipped.
 */
export function firstTextChannel(channels: Channel[], opts: { excludeCategoryIds?: ReadonlySet<string> } = {}): Channel | undefined {
  const skip = opts.excludeCategoryIds
  const texts = channels.filter((c) => c.kind === 'text')
  const loose = texts.filter((c) => !c.parent_id).sort(byPlace)[0]
  if (loose) return loose
  for (const cat of channels.filter((c) => c.kind === 'category').sort(byPlace)) {
    if (skip?.has(cat.id)) continue
    const first = texts.filter((c) => c.parent_id === cat.id).sort(byPlace)[0]
    if (first) return first
  }
  return undefined
}

/** The default landing channel: the first text channel outside `excludeCategoryIds`, else the first text channel at all. */
export function defaultChannel(channels: Channel[], excludeCategoryIds?: ReadonlySet<string>): Channel | undefined {
  return firstTextChannel(channels, { excludeCategoryIds }) ?? firstTextChannel(channels)
}
