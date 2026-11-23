import { useEffect, useState } from 'react'
import { api } from './api'
import { useFolderVersion } from './assetCatalog'
import type { CosmeticKind } from './cosmetics'

/** Discover → Profile Style: the assets folder's cosmetics with what a shop sync adds to them (see backend explore.rs). */
export interface ExploreItem {
  kind: CosmeticKind; value: string; name: string; description?: string; tags?: string[]
  colors?: string[]; themes?: string[]; collection_id?: string; base_name?: string; variant_label?: string
  bundles?: string[]; thumb?: string; rank?: number; added: number
}
export interface ExploreBundle { id: string; name: string; collection_id?: string; items: { kind: CosmeticKind; value: string }[] }
export interface ExploreCollection { id: string; name: string; count: number }
export interface ExploreCatalog { items: ExploreItem[]; labels: Record<string, string>; collections: ExploreCollection[]; bundles: ExploreBundle[] }

export const KINDS: CosmeticKind[] = ['decoration', 'nameplate', 'effect', 'frame']
/** The profile field each kind is worn in. */
export const FIELD = { decoration: 'avatar_decoration', nameplate: 'nameplate', effect: 'profile_effect', frame: 'profile_frame' } as const

/** The colours a shop sync tags items with, and how each swatch is drawn. */
export const COLORS: { code: string; label: string; hex: string }[] = [
  { code: 'purple', label: 'Purple', hex: '#a855f7' }, { code: 'blue', label: 'Blue', hex: '#3b82f6' }, { code: 'green', label: 'Green', hex: '#22c55e' },
  { code: 'brown', label: 'Brown', hex: '#92400e' }, { code: 'yellow', label: 'Yellow', hex: '#facc15' }, { code: 'orange', label: 'Orange', hex: '#f97316' },
  { code: 'red', label: 'Red', hex: '#ef4444' }, { code: 'pink', label: 'Pink', hex: '#ec4899' }, { code: 'white', label: 'White', hex: '#f8fafc' },
  { code: 'black', label: 'Black', hex: '#111827' },
]
export const THEMES: { code: string; label: string }[] = [
  { code: 'anime', label: 'Anime' }, { code: 'gaming', label: 'Gaming' }, { code: 'cute_cozy', label: 'Cute & Cozy' }, { code: 'sci_fi', label: 'Sci-Fi' },
  { code: 'food_drinks', label: 'Food & Drinks' }, { code: 'fantasy', label: 'Fantasy' }, { code: 'animals_pets', label: 'Animals & Pets' },
  { code: 'nature', label: 'Nature' }, { code: 'movies_tv', label: 'Movies & TV' }, { code: 'dark_moody', label: 'Dark & Moody' },
]
/** `color:<x>` and `theme:<x>` tags: the server already counts them as the item's colours and themes (explore.rs
 *  Facets::of), so Discover shows them as those, not as tags. */
export const isFacetTag = (tag: string) => tag.startsWith('color:') || tag.startsWith('theme:')
export const plainTags = (tags?: string[]) => (tags ?? []).filter((t) => !isFacetTag(t))
/** A theme or colour's label: the folder's own (`tag_labels`), else the usual one, else the code made readable. */
export function labelOf(labels: Record<string, string>, code: string): string {
  return labels[code] ?? THEMES.find((x) => x.code === code)?.label ?? COLORS.find((x) => x.code === code)?.label ?? code.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

let cached: { v: number; p: Promise<ExploreCatalog> } | null = null
export function loadExplore(v: number): Promise<ExploreCatalog> {
  if (!cached || cached.v !== v) {
    const p = api.get<ExploreCatalog>('/cosmetics/explore')
    p.catch(() => { if (cached?.p === p) cached = null })
    cached = { v, p }
  }
  return cached.p
}

/** The catalogue (null while it loads), fetched again whenever an admin changes the folder. */
export function useExplore(): { catalog: ExploreCatalog | null; error: string | null } {
  const v = useFolderVersion()
  const [catalog, setCatalog] = useState<ExploreCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    loadExplore(v).then((c) => { if (live) { setCatalog(c); setError(null) } }).catch((e: Error) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [v])
  return { catalog, error }
}

export interface Filters {
  /** Empty: every kind. */
  kinds: CosmeticKind[]
  colors: string[]
  themes: string[]
  inCollection: boolean
  inBundle: boolean
  collection: string | null
  /** Words in a name, description or tag; `#tag` looks only at tags. */
  q: string
}
export const NO_FILTERS: Filters = { kinds: [], colors: [], themes: [], inCollection: false, inBundle: false, collection: null, q: '' }

export function matches(it: ExploreItem, f: Filters): boolean {
  if (f.kinds.length && !f.kinds.includes(it.kind)) return false
  if (f.colors.length && !f.colors.some((c) => it.colors?.includes(c))) return false
  if (f.themes.length && !f.themes.some((c) => it.themes?.includes(c))) return false
  if (f.inCollection && !it.collection_id) return false
  if (f.inBundle && !it.bundles?.length) return false
  if (f.collection && it.collection_id !== f.collection) return false
  const q = f.q.trim().toLowerCase()
  if (!q) return true
  if (q.startsWith('#')) { const tag = q.slice(1); return !tag || !!it.tags?.some((x) => x === tag || x.startsWith(tag)) }
  return [it.name, it.description, it.base_name, it.variant_label].some((s) => s?.toLowerCase().includes(q)) || !!it.tags?.some((x) => x.includes(q))
}

/** One design: its variants (same kind and `base_name`), or a lone item. */
export interface Group { key: string; kind: CosmeticKind; name: string; items: ExploreItem[] }

/** Items grouped into designs, in the order their first item comes. */
export function groupVariants(items: ExploreItem[]): Group[] {
  const out: Group[] = []
  const at = new Map<string, Group>()
  for (const it of items) {
    const key = it.base_name ? `${it.kind}|${it.base_name.toLowerCase()}` : `${it.kind}|${it.value}`
    let g = at.get(key)
    if (!g) { g = { key, kind: it.kind, name: it.base_name ?? it.name, items: [] }; at.set(key, g); out.push(g) }
    g.items.push(it)
  }
  return out
}

export type Sort = 'popular' | 'newest' | 'az'
const byName = (a: ExploreItem, b: ExploreItem) => a.name.localeCompare(b.name)
export function sortItems(items: ExploreItem[], sort: Sort): ExploreItem[] {
  const list = [...items]
  if (sort === 'az') return list.sort(byName)
  if (sort === 'newest') return list.sort((a, b) => b.added - a.added || byName(a, b))
  return list.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || byName(a, b))
}

/** The profile change that wears these: one per kind, the first of each. */
export function wearPatch(items: { kind: CosmeticKind; value: string }[]): Partial<Record<(typeof FIELD)[CosmeticKind], string>> {
  const out: Partial<Record<(typeof FIELD)[CosmeticKind], string>> = {}
  for (const it of items) if (out[FIELD[it.kind]] === undefined) out[FIELD[it.kind]] = it.value
  return out
}
