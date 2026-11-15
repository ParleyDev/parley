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
