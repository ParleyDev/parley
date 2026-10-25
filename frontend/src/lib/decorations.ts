import { useEffect, useState } from 'react'

/**
 * Image avatar decorations from the server's assets folder (`ASSETS_DIR/avatar-decorations/`). A user's
 * `avatar_decoration` is either a CSS preset ("gold", see DECORATIONS) or `asset:<id>` for one of these.
 * Animated files are large, so lists draw the still first frame and only animate on hover or in profile cards.
 */
export type AssetDecoration = { id: string; name: string; animated: boolean }

export const ASSET_PREFIX = 'asset:'
export const assetDecorationId = (v: string | undefined | null) => (v?.startsWith(ASSET_PREFIX) ? v.slice(ASSET_PREFIX.length) : null)
export const decorationUrl = (id: string, still = false) => `/api/assets/avatar-decorations/${encodeURIComponent(id)}${still ? '/static' : ''}`

let cached: Promise<AssetDecoration[]> | null = null
export function loadDecorations(): Promise<AssetDecoration[]> {
  cached ??= fetch('/api/assets/avatar-decorations').then((r) => (r.ok ? r.json() : [])).catch(() => { cached = null; return [] })
  return cached
}

/** The server's decoration catalog (fetched once per page load); null while loading. */
export function useAssetDecorations(): AssetDecoration[] | null {
  const [list, setList] = useState<AssetDecoration[] | null>(null)
  useEffect(() => { let live = true; void loadDecorations().then((l) => { if (live) setList(l) }); return () => { live = false } }, [])
  return list
}

/** Reduced motion (Accessibility setting) keeps decorations still everywhere. */
export const decorationsMayAnimate = () => typeof document === 'undefined' || document.documentElement.dataset.motion !== 'reduced'
