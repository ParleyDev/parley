import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { assetFile, isAssetValue, useAssetItem, type FrameItem, type FrameLayer } from '../lib/assetCatalog'

/**
 * A Discord profile frame from the assets folder (`asset:<id>`), drawn around the card it sits in (the parent must be
 * positioned and must not clip). Frames are authored for a card `inner_width` wide (1200, Discord's 4x), so every
 * layer is scaled by card width / inner_width:
 *  - staples hang off the top or bottom edge, reaching `overflow_top` / `overflow_bottom` past it;
 *  - rails and borders run along the sides, cropped to the card's height from their top or centre;
 *  - front layers draw over the card, back layers behind it (only the parts outside the card show).
 */
export default function ProfileFrame({ value }: { value?: string | null }) {
  const item = useAssetItem<FrameItem>('profile-frames', value)
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ w: number; h: number; inset: CSSProperties } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // Frames hug the card's outer (border) edge, while an absolute child is placed inside the border.
    const measure = () => {
      const p = el.parentElement
      const cs = p ? getComputedStyle(p) : null
      const bw = (k: 'Top' | 'Right' | 'Bottom' | 'Left') => (cs ? parseFloat(cs[`border${k}Width`]) || 0 : 0)
      const w = (p?.offsetWidth ?? el.offsetWidth), h = (p?.offsetHeight ?? el.offsetHeight)
      setBox((b) => (b && b.w === w && b.h === h ? b : { w, h, inset: { top: -bw('Top'), right: -bw('Right'), bottom: -bw('Bottom'), left: -bw('Left') } }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [item])
  if (!isAssetValue(value) || !item?.layout) return null
  const { w: W, h: H } = box ?? { w: 0, h: 0 }
  const s = W / (item.layout.inner_width || 1200)
  const ot = item.layout.overflow_top * s, ob = item.layout.overflow_bottom * s, oh = item.layout.overflow_horizontal * s
  const pad = 40
  // Where back layers may show: around the card, never on it.
  const bands = [
    { left: -oh - pad, top: -ot - pad, width: W + 2 * (oh + pad), height: ot + pad },
    { left: -oh - pad, top: H, width: W + 2 * (oh + pad), height: ob + pad },
    { left: -oh - pad, top: 0, width: oh + pad, height: H },
    { left: W, top: 0, width: oh + pad, height: H },
  ]
  const place = (l: FrameLayer) => {
    const w = (l.width ?? 1312) * s, h = (l.height ?? 0) * s
    const left = (W - w) / 2
    if (l.type === 'staple') return { left, top: l.anchor === 'bottom' ? H + ob - h : -ot, width: w, along: false }
    return { left, top: l.anchor === 'top' ? 0 : (H - h) / 2, width: w, along: true }
  }
  const img = (l: FrameLayer, at: { left: number; top: number; width: number }, dx = 0, dy = 0): ReactElement =>
    <img src={assetFile('profile-frames', item.id, l.file)} alt="" draggable={false} className="absolute max-w-none select-none" style={{ left: at.left - dx, top: at.top - dy, width: at.width }} data-frame-layer={l.file} />
  const clip = (style: CSSProperties, child: ReactElement, key: string) => <div key={key} className="absolute overflow-hidden" style={style}>{child}</div>

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-[6]" style={box?.inset} aria-hidden data-profile-frame-layers={item.id}>
      {box && W > 0 && item.layers.map((l, i) => {
        const at = place(l)
        if (l.order === 'back') {
          return (bands.filter((_, b) => !at.along || b >= 2)).map((b, j) => clip(b, img(l, at, b.left, b.top), `${i}-${j}`))
        }
        // Rails and borders stop at the card's top and bottom edges; staples hang free.
        return at.along ? clip({ left: -oh - pad, top: 0, width: W + 2 * (oh + pad), height: H }, img(l, at, -oh - pad, 0), `${i}`) : <span key={i}>{img(l, at)}</span>
      })}
    </div>
  )
}

/**
 * Room for a card's frame: padding as large as the frame reaches past the card (scaled to the card's width), with the
 * card and its frame inside. Whatever positions, nudges, scrolls or clips the card then sees the whole framed area,
 * so a frame is never cut off by a scroll box or pushed off screen. Without an asset frame it adds nothing.
 */
export function FrameRoom({ value, className = '', innerClassName = '', style, children, ...rest }: { value?: string | null; className?: string; innerClassName?: string; style?: CSSProperties; children: ReactNode } & Record<`data-${string}`, string | boolean | undefined>) {
  const item = useAssetItem<FrameItem>('profile-frames', value)
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !item || typeof ResizeObserver === 'undefined') return
    const measure = () => setW(el.offsetWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [item])
  const L = item?.layout
  const s = L && w ? w / (L.inner_width || 1200) : 0
  const pad: CSSProperties = L && s ? { paddingTop: L.overflow_top * s, paddingBottom: L.overflow_bottom * s, paddingLeft: L.overflow_horizontal * s, paddingRight: L.overflow_horizontal * s } : {}
  return (
    <div className={className} style={{ ...style, ...pad }} data-frame-room={item ? item.id : undefined} {...rest}>
      <div ref={ref} className={`relative ${innerClassName}`}>
        {children}
        <ProfileFrame value={value} />
      </div>
    </div>
  )
}
