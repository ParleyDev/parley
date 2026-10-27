import { useEffect, useState } from 'react'
import { PROFILE_EFFECTS } from '../lib/cosmetics'
import { assetFile, isAssetValue, loadBlob, useAssetItem, type EffectItem, type EffectLayer } from '../lib/assetCatalog'

const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A profile effect over the card: a built-in one (a few glyphs drifting, falling or rising by kind, paused for reduced
 * motion), or one from the assets folder (`asset:<id>`), played from its layers' timing.
 */
export default function ProfileEffect({ id }: { id?: string | null }) {
  if (id && isAssetValue(id)) return <AssetEffect value={id} />
  const fx = PROFILE_EFFECTS.find((e) => e.id === (id as string | null | undefined))
  if (!fx) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden rounded-[inherit]" aria-hidden data-profile-effect={fx.id} data-effect-motion={fx.fall ? 'fall' : 'rise'}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={`pe-bit absolute text-sm ${fx.fall ? 'pe-fall' : ''}`} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i * 0.7) % 5}s`, animationDuration: `${4 + (i % 4)}s`, fontSize: `${10 + (i % 3) * 4}px` }}>{fx.glyph}</span>
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
  const [reduced] = useState(reducedMotion)
  if (!item) return null
  const still = item.reduced_motion ?? item.still
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden rounded-[inherit] isolate" aria-hidden data-profile-effect={value} data-effect-layers={item.layers.length}>
      {reduced
        ? still && <img src={assetFile('profile-effects', item.id, still)} alt="" className="absolute inset-x-0 top-0 w-full" data-effect-still />
        : item.layers.map((l, i) => <Layer key={`${item.id}-${i}`} id={item.id} layer={l} />)}
    </div>
  )
}

function Layer({ id, layer }: { id: string; layer: EffectLayer }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true, url: string | null = null
    const timers: number[] = []
    const files = [layer.file, ...(layer.random_variants ?? [])]
    // Start downloading now so the layer is ready by its start time.
    files.forEach((f) => { loadBlob(assetFile('profile-effects', id, f)).catch(() => {}) })
    const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)) }
    const play = async () => {
      const file = files[Math.floor(Math.random() * files.length)]
      let blob: Blob
      try { blob = await loadBlob(assetFile('profile-effects', id, file)) } catch { return }
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
  }, [id, layer])
  if (!src) return null
  return <img src={src} alt="" className="absolute inset-x-0 top-0 w-full max-w-none" style={{ zIndex: layer.z_index }} data-effect-layer={layer.file} />
}
