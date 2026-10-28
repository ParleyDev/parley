import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { assetFile, isAssetValue, useAssetItem, type FrameItem, type FrameLayer } from '../lib/assetCatalog'

/**
 * A Discord profile frame from the assets folder (`asset:<id>`), drawn around the card it sits in (the parent must be
 * positioned and must not clip). Frames are authored for a card `inner_width` wide (1200, Discord's 4x), so every
 * layer is scaled by card width / inner_width:
 *  - staples hang off the top or bottom edge, reaching `overflow_top` / `overflow_bottom` past it;
 *  - rails and borders run along the sides, cropped to the card's height from their top or centre;
 *  - front layers draw over the card, back layers behind it: they show everywhere but on the card itself, which is
 *    masked out with its own rounded corners (a rectangular hole would leave the corners empty). Back layers are
 *    always painted first: metadata often lists the front one first, and a back layer drawn later would cover it.
 */
export default function ProfileFrame({ value }: { value?: string | null }) {
  const item = useAssetItem<FrameItem>('profile-frames', value)
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ w: number; h: number; r: number[]; inset: CSSProperties } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // Frames hug the card's outer (border) edge, while an absolute child is placed inside the border.
    const measure = () => {
      const p = el.parentElement
      const cs = p ? getComputedStyle(p) : null
      const bw = (k: 'Top' | 'Right' | 'Bottom' | 'Left') => (cs ? parseFloat(cs[`border${k}Width`]) || 0 : 0)
      const w = (p?.offsetWidth ?? el.offsetWidth), h = (p?.offsetHeight ?? el.offsetHeight)
      // The card's corner radii (top-left, top-right, bottom-right, bottom-left): it's the wrapper's first child.
      const card = p?.firstElementChild instanceof HTMLElement && p.firstElementChild !== el ? getComputedStyle(p.firstElementChild) : cs
      const r = (['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'] as const).map((k) => (card ? parseFloat(card[`border${k}Radius`]) || 0 : 0))
      setBox((b) => (b && b.w === w && b.h === h && b.r.join() === r.join() ? b : { w, h, r, inset: { top: -bw('Top'), right: -bw('Right'), bottom: -bw('Bottom'), left: -bw('Left') } }))
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
  // Where back layers may show: everything around the card, never on it. One box over the whole framed area with the
  // card's rounded shape cut out of it (an SVG mask, even-odd), so the corners of the card are filled too.
  const back = { left: -oh - pad, top: -ot - pad, width: W + 2 * (oh + pad), height: H + ot + ob + 2 * pad }
  const hole = (() => {
    const [tl, tr, br, bl] = (box?.r ?? [0, 0, 0, 0]).map((v) => Math.min(v, W / 2, H / 2))
    const x = oh + pad, y = ot + pad
    const card = `M${x + tl} ${y}H${x + W - tr}A${tr} ${tr} 0 0 1 ${x + W} ${y + tr}V${y + H - br}A${br} ${br} 0 0 1 ${x + W - br} ${y + H}H${x + bl}A${bl} ${bl} 0 0 1 ${x} ${y + H - bl}V${y + tl}A${tl} ${tl} 0 0 1 ${x + tl} ${y}Z`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${back.width}" height="${back.height}"><path fill-rule="evenodd" d="M0 0H${back.width}V${back.height}H0Z${card}"/></svg>`
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
    return { maskImage: url, WebkitMaskImage: url, maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' } as CSSProperties
  })()
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
      {box && W > 0 && item.layers.some((l) => l.order === 'back') && (
        <div className="absolute overflow-hidden" style={{ ...back, ...hole }} data-frame-back>
          {item.layers.map((l, i) => {
            if (l.order !== 'back') return null
            const at = place(l)
            // Back rails and borders only run alongside the card, from its top edge to its bottom edge.
            return at.along
              ? clip({ left: 0, top: -back.top, width: back.width, height: H }, img(l, at, back.left, 0), `${i}`)
              : <span key={i}>{img(l, at, back.left, back.top)}</span>
          })}
        </div>
      )}
      {box && W > 0 && item.layers.map((l, i) => {
        if (l.order === 'back') return null
        const at = place(l)
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
export function FrameRoom({ value, className = '', innerClassName = '', style, bleed, children, ...rest }: { value?: string | null; className?: string; innerClassName?: string; style?: CSSProperties; children: ReactNode; /** Reserve no room: the frame reaches over whatever is around the card (the full profile's window). */ bleed?: boolean } & Record<`data-${string}`, string | boolean | undefined>) {
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
  const pad: CSSProperties = !L || !s || bleed ? {} : { paddingTop: L.overflow_top * s, paddingBottom: L.overflow_bottom * s, paddingLeft: L.overflow_horizontal * s, paddingRight: L.overflow_horizontal * s }
  return (
    <div className={className} style={{ ...style, ...pad }} data-frame-wrap data-frame-room={item ? item.id : undefined} {...rest}>
      <div ref={ref} className={`relative ${innerClassName}`}>
        {children}
        <ProfileFrame value={value} />
      </div>
    </div>
  )
}
