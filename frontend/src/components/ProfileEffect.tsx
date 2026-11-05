import { useCallback, useEffect, useState } from 'react'
import { PROFILE_EFFECTS, isCustom, useCustomCosmetic } from '../lib/cosmetics'
import { assetFile, isAssetValue, loadBlob, useAssetItem, type EffectItem, type EffectLayer } from '../lib/assetCatalog'

const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A profile effect over the card: a built-in one (a few glyphs drifting, falling or rising by kind, paused for reduced
 * motion), or one from the assets folder (`asset:<id>`), played from its layers' timing.
 */
export default function ProfileEffect({ id }: { id?: string | null }) {
  if (id && isAssetValue(id)) return <AssetEffect value={id} />
  if (isCustom(id)) return <CustomEffect value={id} />
  const fx = PROFILE_EFFECTS.find((e) => e.id === (id as string | null | undefined))
  if (!fx) return null
  return <Bits value={fx.id} fall={fx.fall} bit={fx.glyph} />
}

/** An admin's own effect: their emoji, drifting like the built-in ones. */
function CustomEffect({ value }: { value: string }) {
  const fx = useCustomCosmetic('effect', value)
  if (!fx) return null
  return <Bits value={value} fall={fx.data.fall !== false} bit={fx.data.glyph} />
}

/** A few glyphs drifting down (`fall`) or floating up over the card. */
export function Bits({ value, fall, bit }: { value: string; fall: boolean; bit: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden rounded-[inherit]" aria-hidden data-profile-effect={value} data-effect-motion={fall ? 'fall' : 'rise'}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={`pe-bit absolute text-sm ${fall ? 'pe-fall' : ''}`} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i * 0.7) % 5}s`, animationDuration: `${4 + (i % 4)}s`, fontSize: `${10 + (i % 3) * 4}px` }}>{bit}</span>
      ))}
    </div>
  )
}

/**
 * Discord's layered effects: each layer is an animated PNG the width of the card, anchored to its top. A layer starts
 * `start_ms` after the card opens and plays for `duration_ms`; looping layers then wait `loop_delay_ms` and play
 * again (a random variant each time when it has some), one-shot layers go away. Reduced motion shows the still.
 */
function AssetEffect({ value }: { value: string }) {
  const item = useAssetItem<EffectItem>('profile-effects', value)
  const id = item?.id
  // Stable, so a layer only restarts when it changes.
  const fileUrl = useCallback((f: string) => assetFile('profile-effects', id ?? '', f), [id])
  if (!item) return null
  return <EffectLayers value={value} item={item} fileUrl={fileUrl} />
}

/** An effect's layers played over the card; also an unsaved one in the admin console (its files as `fileUrl`). */
export function EffectLayers({ value, item, fileUrl }: { value: string; item: EffectItem; fileUrl: (file: string) => string }) {
  const [reduced] = useState(reducedMotion)
  const still = item.reduced_motion ?? item.still
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden rounded-[inherit] isolate" aria-hidden data-profile-effect={value} data-effect-layers={item.layers.length}>
      {reduced
        ? still && <img src={fileUrl(still)} alt="" className="absolute inset-x-0 top-0 w-full" data-effect-still />
        : item.layers.map((l, i) => <Layer key={`${item.id}-${i}`} layer={l} fileUrl={fileUrl} />)}
    </div>
  )
}

function Layer({ layer, fileUrl }: { layer: EffectLayer; fileUrl: (file: string) => string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true, url: string | null = null
    const timers: number[] = []
    const files = [layer.file, ...(layer.random_variants ?? [])]
    // Start downloading now so the layer is ready by its start time.
    files.forEach((f) => { loadBlob(fileUrl(f)).catch(() => {}) })
    const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)) }
    const play = async () => {
      const file = files[Math.floor(Math.random() * files.length)]
      let blob: Blob
      try { blob = await loadBlob(fileUrl(file)) } catch { return }
      if (!alive) return
      const next = URL.createObjectURL(blob)
      if (url) URL.revokeObjectURL(url)
      url = next
      setSrc(next)
      later(() => {
        if (!layer.loop) { setSrc(null); return }
        if (layer.loop_delay_ms > 0) { setSrc(null); later(() => void play(), layer.loop_delay_ms) } else void play()
      }, Math.max(100, layer.duration_ms))
    }
    later(() => void play(), layer.start_ms)
    return () => { alive = false; timers.forEach(clearTimeout); if (url) URL.revokeObjectURL(url) }
  }, [layer, fileUrl])
  if (!src) return null
  return <img src={src} alt="" className="absolute inset-x-0 top-0 w-full max-w-none" style={{ zIndex: layer.z_index }} data-effect-layer={layer.file} />
}
