import { useEffect, useRef, useState } from 'react'
import { useFolderVersion } from '../lib/assetCatalog'

/** A nameplate from the instance's assets folder (`asset:<id>`): a short video loop. Built-in ones are CSS classes. */
export const isAssetNameplate = (v?: string | null): v is string => !!v && v.startsWith('asset:')
export const nameplateSrc = (v: string) => `/api/assets/nameplates/${encodeURIComponent(v.slice('asset:'.length))}`
const reduced = () => document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches
/** Phones and tablets (the apps, or any screen without hover): video nameplates don't suit them. iOS can't play WebM
 *  with transparency at all, and Android shows an empty player until each video starts. They get the server's animated
 *  WebP of it instead (`…/anim`), which images draw everywhere; until the server has made one, the video stays. */
const touchOnly = () => typeof matchMedia !== 'undefined' && (matchMedia('(hover: none)').matches || !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.())

/**
 * The video behind a list row for an asset nameplate (nothing for built-in ones). It sits behind the row's content
 * (the row needs `relative isolate overflow-hidden`), shows its first frame, and plays while the row (or the
 * `hoverRoot` ancestor) is hovered.
 */
export function NameplateVideo({ value, hoverRoot, always = false }: { value?: string | null; hoverRoot?: string; /** Keep it playing, not just on hover: your own panel, the open conversation. */ always?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [asImage, setAsImage] = useState(touchOnly)
  useEffect(() => { setAsImage(touchOnly()) }, [value])
  useEffect(() => {
    const v = ref.current, row = hoverRoot ? v?.closest<HTMLElement>(hoverRoot) : v?.parentElement
    if (!v || !row) return
    const on = () => { if (!reduced()) void v.play().catch(() => {}) }
    const off = () => { if (!always) v.pause() }
    if (always) on()
    row.addEventListener('mouseenter', on); row.addEventListener('mouseleave', off)
    return () => { row.removeEventListener('mouseenter', on); row.removeEventListener('mouseleave', off) }
  }, [value, hoverRoot, always])
  if (!isAssetNameplate(value)) return null
  if (asImage) return <img key={value} src={`${nameplateSrc(value)}/anim`} alt="" draggable={false} onError={() => setAsImage(false)} className="np-video np-fit pointer-events-none absolute inset-y-0 right-0 -z-10 h-full w-auto max-w-none" aria-hidden data-nameplate-video={value.slice(6)} data-nameplate-image />
  return <video key={value} ref={ref} className="np-video np-fit pointer-events-none absolute inset-y-0 right-0 -z-10 h-full w-auto max-w-none" src={nameplateSrc(value)} muted loop playsInline preload="metadata" aria-hidden data-nameplate-video={value.slice(6)} />
}

export interface AssetNameplate { id: string; name: string; description?: string; tags?: string[] }

let plates: { at: number; p: Promise<AssetNameplate[]> } | null = null
/** The instance's nameplates (assets folder), fetched once per page load and again after a change. */
export function useAssetNameplates(): AssetNameplate[] | null {
  const [list, setList] = useState<AssetNameplate[] | null>(null)
  const v = useFolderVersion()
  useEffect(() => {
    if (!plates || plates.at !== v) plates = { at: v, p: fetch(`/api/assets/nameplates${v ? `?v=${v}` : ''}`).then((r) => (r.ok ? r.json() : [])).catch(() => []) }
    let live = true
    void plates.p.then((l) => { if (live) setList(l) })
    return () => { live = false }
  }, [v])
  return list
}

/** A preview video that only loads once it scrolls into view, and plays while hovered. */
export function LazyVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } })
    io.observe(v)
    const row = v.parentElement
    const on = () => { if (!reduced()) void v.play().catch(() => {}) }
    const off = () => v.pause()
    row?.addEventListener('mouseenter', on); row?.addEventListener('mouseleave', off)
    return () => { io.disconnect(); row?.removeEventListener('mouseenter', on); row?.removeEventListener('mouseleave', off) }
  }, [])
  return <video ref={ref} className="np-fit pointer-events-none absolute inset-y-0 right-0 -z-10 h-full w-auto max-w-none" src={seen ? src : undefined} muted loop playsInline preload="metadata" aria-hidden />
}
