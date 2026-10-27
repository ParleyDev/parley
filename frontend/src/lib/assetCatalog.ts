import { useEffect, useState } from 'react'

/** Layered cosmetics from the instance's assets folder (see backend routes/asset_layers.rs). */
export type LayeredKind = 'profile-effects' | 'profile-frames'
export interface EffectLayer { file: string; start_ms: number; duration_ms: number; loop: boolean; loop_delay_ms: number; z_index: number; random_variants?: string[]; width?: number; height?: number }
export interface FrameLayer { file: string; order: 'front' | 'back'; type: 'staple' | 'rail' | 'border'; anchor: 'top' | 'bottom' | 'center'; responsive?: boolean; width?: number; height?: number }
export interface FrameLayout { inner_width: number; overflow_top: number; overflow_bottom: number; overflow_horizontal: number }
export interface LayeredItem<L = EffectLayer | FrameLayer> { id: string; name: string; description: string; layers: L[]; layout?: FrameLayout; still?: string; reduced_motion?: string }
export type EffectItem = LayeredItem<EffectLayer>
export type FrameItem = LayeredItem<FrameLayer>

export const isAssetValue = (v?: string | null): v is string => !!v && v.startsWith('asset:')
export const assetFile = (kind: LayeredKind, id: string, file: string) => `/api/assets/${kind}/${encodeURIComponent(id)}/${encodeURIComponent(file)}`

const lists = new Map<LayeredKind, Promise<LayeredItem[]>>()
const loaded = new Map<LayeredKind, LayeredItem[]>()
/** The catalogue of a kind, fetched once per page load. */
export function loadCatalog(kind: LayeredKind): Promise<LayeredItem[]> {
  let p = lists.get(kind)
  if (!p) {
    p = fetch(`/api/assets/${kind}`).then((r) => (r.ok ? r.json() : [])).catch(() => []).then((l: LayeredItem[]) => { loaded.set(kind, l); return l })
    lists.set(kind, p)
  }
  return p
}

export function useCatalog<T extends LayeredItem>(kind: LayeredKind): T[] | null {
  const [list, setList] = useState<T[] | null>(() => (loaded.get(kind) as T[] | undefined) ?? null)
  useEffect(() => { if (!kind) return; let live = true; void loadCatalog(kind).then((l) => { if (live) setList(l as T[]) }); return () => { live = false } }, [kind])
  return list
}

/** The catalogue entry a stored `asset:<id>` value points at (null while loading or when unknown). */
export function useAssetItem<T extends LayeredItem>(kind: LayeredKind, value?: string | null): T | null {
  const list = useCatalog<T>(isAssetValue(value) ? kind : ('' as LayeredKind))
  if (!isAssetValue(value) || !list) return null
  return list.find((x) => x.id === value.slice('asset:'.length)) ?? null
}

const blobs = new Map<string, Promise<Blob>>()
/** An image as a Blob, fetched once: each play gets a fresh object URL so an animated PNG starts from frame one. */
export function loadBlob(url: string): Promise<Blob> {
  let p = blobs.get(url)
  if (!p) { p = fetch(url).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob() }); p.catch(() => blobs.delete(url)); blobs.set(url, p) }
  return p
}
