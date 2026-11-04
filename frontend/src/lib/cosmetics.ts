import { useSyncExternalStore } from 'react'

/** Profile cosmetics drawn in CSS (index.css): ids must match the server's lists in routes/users.rs. */
export const PROFILE_FRAMES = [
  { id: 'gold', label: 'Gilded' }, { id: 'neon', label: 'Neon' }, { id: 'vines', label: 'Vines' },
  { id: 'pixel', label: 'Pixel' }, { id: 'frost', label: 'Frost' }, { id: 'ember', label: 'Ember' },
] as const
export const NAMEPLATES = [
  { id: 'dusk', label: 'Dusk' }, { id: 'ocean', label: 'Ocean' }, { id: 'forest', label: 'Forest' },
  { id: 'candy', label: 'Candy' }, { id: 'aurora', label: 'Aurora' }, { id: 'mono', label: 'Mono' },
] as const
export const PROFILE_EFFECTS = [
  // `fall`: drifts down from the top (snow, confetti); otherwise floats up from the bottom (hearts, bubbles).
  { id: 'sparkles', label: 'Sparkles', glyph: '✨', fall: true }, { id: 'snow', label: 'Snowfall', glyph: '❄️', fall: true }, { id: 'hearts', label: 'Hearts', glyph: '💖', fall: false },
  { id: 'confetti', label: 'Confetti', glyph: '🎊', fall: true }, { id: 'bubbles', label: 'Bubbles', glyph: '🫧', fall: false },
] as const

/** Class for a nameplate background behind a list row ('' = none); custom ones get theirs from cosmeticsCss. */
export const nameplateClass = (id?: string | null) => (id && NAMEPLATES.some((n) => n.id === id) ? `np np-${id}` : isCustom(id) ? `np np-c-${customId(id)}` : '')
/** Class for a profile card frame ('' = none); custom ones get theirs from cosmeticsCss. */
export const frameClass = (id?: string | null) => (id && PROFILE_FRAMES.some((n) => n.id === id) ? `pf pf-${id}` : isCustom(id) ? `pf pf-c-${customId(id)}` : '')

// --- what admins changed (Admin console → Cosmetics) ---------------------------------------------------------------

export type CosmeticKind = 'decoration' | 'nameplate' | 'effect' | 'frame'
/** An admin's row: an off switch (or a delete) for a built-in (`gold`) or assets-folder (`asset:x`) one, a built-in's
 *  name, or a custom one (`custom:<uuid>`) with its look: nameplate `{colors}`, frame `{colors: [ring, glow]}`, effect
 *  `{glyph, fall}`. Pictures are assets-folder items. */
export interface CosmeticRow { kind: CosmeticKind; value: string; custom: boolean; name: string | null; description: string | null; enabled: boolean; deleted: boolean; data: { colors?: string[]; glyph?: string; fall?: boolean } }
export const CUSTOM_PREFIX = 'custom:'
export const isCustom = (v?: string | null): v is string => !!v && v.startsWith(CUSTOM_PREFIX)
const customId = (v: string) => v.slice(CUSTOM_PREFIX.length).replace(/[^a-z0-9-]/gi, '')

let rows: CosmeticRow[] = []
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const getRows = () => rows
export function setCosmetics(list: CosmeticRow[]) { rows = list; listeners.forEach((l) => l()) }
export async function loadCosmetics() { try { const r = await fetch('/api/cosmetics'); if (r.ok) setCosmetics(await r.json()) } catch { /* keep what we have */ } }
export function useCosmetics(): CosmeticRow[] { return useSyncExternalStore(subscribe, getRows, getRows) }

const rowOf = (list: CosmeticRow[], kind: CosmeticKind, value?: string | null) => (value ? list.find((r) => r.kind === kind && r.value === value) : undefined)
/** A custom one's row (null for anything else). One that is off is still drawn, and hidden by cosmeticsCss outside
 *  the admin previews. */
export function useCustomCosmetic(kind: CosmeticKind, value?: string | null): CosmeticRow | null {
  const list = useCosmetics()
  return (isCustom(value) ? rowOf(list, kind, value) : undefined) ?? null
}

/** A picker's built-in options: without the ones turned off, under the admins' names, then the custom ones. */
export function useOptions<T extends { id: string; label: string }>(kind: CosmeticKind, builtins: readonly T[]): (T | (CosmeticRow & { id: string; label: string }))[] {
  const list = useCosmetics()
  const shown = builtins.filter((b) => { const r = rowOf(list, kind, b.id); return !b.id || (r?.enabled !== false && !r?.deleted) }).map((b) => { const name = rowOf(list, kind, b.id)?.name; return name ? { ...b, label: name } : b })
  const custom = list.filter((r) => r.kind === kind && r.custom && r.enabled && !r.deleted).map((r) => ({ ...r, id: r.value, label: r.name ?? '' }))
  return [...shown, ...custom]
}

/** The stylesheet for custom frames and nameplates, and hiding anything an admin turned off, on every profile at once. */
export function cosmeticsCss(list: CosmeticRow[]): string {
  const css: string[] = []
  const q = (s: string) => JSON.stringify(s)
  // Turned off everywhere except the admin console's previews, so admins still see what they'd turn back on.
  const live = ':not([data-cosmetic-preview], [data-cosmetic-preview] *)'
  for (const r of list) {
    const bare = r.value.startsWith('asset:') ? r.value.slice(6) : r.value
    if (!r.enabled || r.deleted) {
      if (r.kind === 'frame') css.push(r.value.startsWith('asset:') ? `[data-profile-frame-layers=${q(bare)}]${live}{display:none!important}` : `.pf-${r.value.replace(/[^a-z0-9-]/gi, '')}${live}{box-shadow:none!important}`)
      if (r.kind === 'nameplate') css.push(r.value.startsWith('asset:') ? `[data-nameplate-video=${q(bare)}]${live}{display:none!important}` : `.np-${r.value.replace(/[^a-z0-9-]/gi, '')}${live}{background-image:none!important;animation:none!important}`)
      if (r.kind === 'effect') css.push(`[data-profile-effect=${q(r.value)}]${live}{display:none!important}`)
      if (r.kind === 'decoration') css.push(`[data-decoration=${q(r.value)}]${live}{display:none!important}`)
    }
    if (!r.custom) continue
    // A custom frame or nameplate that is off keeps its look only in the admin previews.
    const at = r.enabled && !r.deleted ? '' : ':is([data-cosmetic-preview], [data-cosmetic-preview] *)'
    const [a, b] = (r.data.colors ?? []).map((c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#888888'))
    if (r.kind === 'frame' && a) css.push(`.pf-c-${customId(r.value)}${at}{box-shadow:0 0 0 3px ${a},0 0 18px ${b}99!important}`)
    if (r.kind === 'nameplate' && a) css.push(`.np-c-${customId(r.value)}${at}{background-image:linear-gradient(90deg,${a}66,${b}2e 70%,transparent)}`)
  }
  return css.join('\n')
}
