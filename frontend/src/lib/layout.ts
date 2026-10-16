import type { LayoutItem } from './types'

export const newFolderId = () => `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Drop servers that are gone, dedupe, and append any server the layout doesn't know yet (newly joined). */
export function reconcile(layout: LayoutItem[], guildIds: string[]): LayoutItem[] {
  const have = new Set(guildIds)
  const seen = new Set<string>()
  const out: LayoutItem[] = []
  for (const it of layout) {
    if (it.kind === 'guild') { if (have.has(it.id) && !seen.has(it.id)) { seen.add(it.id); out.push(it) } }
    else {
      const guilds = it.guilds.filter((g) => have.has(g) && !seen.has(g))
      guilds.forEach((g) => seen.add(g))
      if (guilds.length) out.push({ ...it, guilds })
    }
  }
  for (const g of guildIds) if (!seen.has(g)) out.push({ kind: 'guild', id: g })
  return out
}

/** Flattened guild order (folders expanded in place). */
export const flatGuilds = (layout: LayoutItem[]): string[] => layout.flatMap((it) => (it.kind === 'guild' ? [it.id] : it.guilds))

const without = (layout: LayoutItem[], guildId: string): LayoutItem[] =>
  layout.map((it) => (it.kind === 'folder' ? { ...it, guilds: it.guilds.filter((g) => g !== guildId) } : it)).filter((it) => it.kind === 'guild' ? it.id !== guildId : it.guilds.length > 0)

export type DropTarget =
  | { type: 'before'; id: string }           // top-level item id (guild or folder)
  | { type: 'after'; id: string }
  | { type: 'combine'; guildId: string }      // onto a top-level server → new folder with both
  | { type: 'into'; folderId: string; index?: number } // onto a folder, or between items inside it

/** Move a folder (top level only: before/after another item). */
export function moveFolder(layout: LayoutItem[], folderId: string, target: DropTarget): LayoutItem[] {
  const me = layout.find((it) => it.kind === 'folder' && it.id === folderId)
  if (!me || (target.type !== 'before' && target.type !== 'after') || target.id === folderId) return layout
  const base = layout.filter((it) => it.id !== folderId)
  const i = base.findIndex((it) => it.id === target.id)
  if (i < 0) return layout
  const out = [...base]; out.splice(target.type === 'before' ? i : i + 1, 0, me); return out
}

/** Move whatever was dragged: a folder keeps its contents, a server goes wherever the target says. */
export function moveItem(layout: LayoutItem[], id: string, target: DropTarget): LayoutItem[] {
  return layout.some((it) => it.kind === 'folder' && it.id === id) ? moveFolder(layout, id, target) : moveGuild(layout, id, target)
}

/** Move a server somewhere else in the layout. */
export function moveGuild(layout: LayoutItem[], guildId: string, target: DropTarget): LayoutItem[] {
  const base = without(layout, guildId)
  const me: LayoutItem = { kind: 'guild', id: guildId }
  switch (target.type) {
    case 'before':
    case 'after': {
      const i = base.findIndex((it) => it.id === target.id)
      if (i < 0) return [...base, me]
      const out = [...base]; out.splice(target.type === 'before' ? i : i + 1, 0, me); return out
    }
    case 'combine': {
      if (target.guildId === guildId) return layout
      return base.map((it) => (it.kind === 'guild' && it.id === target.guildId ? { kind: 'folder', id: newFolderId(), name: '', color: null, guilds: [it.id, guildId] } : it))
    }
    case 'into': {
      return base.map((it) => {
        if (it.kind !== 'folder' || it.id !== target.folderId) return it
        const guilds = [...it.guilds]; guilds.splice(target.index ?? guilds.length, 0, guildId); return { ...it, guilds }
      })
    }
  }
}

export function removeFromFolder(layout: LayoutItem[], guildId: string): LayoutItem[] {
  const i = layout.findIndex((it) => it.kind === 'folder' && it.guilds.includes(guildId))
  if (i < 0) return layout
  const out = without(layout, guildId)
  // Place it right after the folder it came from (or where the folder was if it dissolved).
  const after = out.findIndex((it) => it.id === layout[i].id)
  out.splice(after >= 0 ? after + 1 : Math.min(i, out.length), 0, { kind: 'guild', id: guildId })
  return out
}

export function dissolveFolder(layout: LayoutItem[], folderId: string): LayoutItem[] {
  return layout.flatMap((it) => (it.kind === 'folder' && it.id === folderId ? it.guilds.map((g): LayoutItem => ({ kind: 'guild', id: g })) : [it]))
}

export function updateFolder(layout: LayoutItem[], folderId: string, patch: { name?: string; color?: string | null }): LayoutItem[] {
  return layout.map((it) => (it.kind === 'folder' && it.id === folderId ? { ...it, ...patch } : it))
}

/** Step a top-level item (server or folder, or a server inside its folder) up or down by one. */
export function nudge(layout: LayoutItem[], guildId: string, dir: -1 | 1): LayoutItem[] {
  const fi = layout.findIndex((it) => it.kind === 'folder' && it.guilds.includes(guildId))
  if (fi >= 0) {
    const f = layout[fi] as Extract<LayoutItem, { kind: 'folder' }>
    const i = f.guilds.indexOf(guildId), j = i + dir
    if (j < 0 || j >= f.guilds.length) return layout
    const guilds = [...f.guilds]; [guilds[i], guilds[j]] = [guilds[j], guilds[i]]
    return layout.map((it, k) => (k === fi ? { ...f, guilds } : it))
  }
  const i = layout.findIndex((it) => it.id === guildId), j = i + dir
  if (i < 0 || j < 0 || j >= layout.length) return layout
  const out = [...layout]; [out[i], out[j]] = [out[j], out[i]]; return out
}
