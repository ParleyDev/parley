import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { assetFile, isAssetValue, useAssetItem, type FrameItem, type FrameLayer } from '../lib/assetCatalog'

/**
 * A Discord profile frame from the assets folder (`asset:<id>`), drawn around the card it sits in (the parent must be
 * positioned and must not clip). Frames are authored for a card `inner_width` wide (1200, Discord's 4x), so every
 * layer is scaled by card width / inner_width:
 *  - staples hang off the top or bottom edge, reaching `overflow_top` / `overflow_bottom` past it;
 *  - rails and borders run along the sides, cropped to the card's height from their top or centre, or on a card
 *    taller than they were drawn for, kept at size at both ends with the middle stretched between;
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
  // Every offset and size lands on a whole device pixel, so a back piece and its matching front piece (drawn in
  // separate layers) always come out on the same pixels.
  const dpr = window.devicePixelRatio || 1
  const snap = (v: number) => Math.round(v * dpr) / dpr
  const ot = snap(item.layout.overflow_top * s), ob = snap(item.layout.overflow_bottom * s), oh = snap(item.layout.overflow_horizontal * s)
  const pad = 40
  // Where back layers may show: everything around the card, never on it. The back layer covers the card's box like the
  // front one (so both place their pieces with the same numbers) and is clipped to the framed area with the card's
  // rounded shape cut out (even-odd), so the card's corners are filled too.
  const hole = (() => {
    const [tl, tr, br, bl] = (box?.r ?? [0, 0, 0, 0]).map((v) => Math.min(v, W / 2, H / 2))
    const x0 = -oh - pad, y0 = -ot - pad, x1 = W + oh + pad, y1 = H + ob + pad
    const card = `M${tl} 0H${W - tr}A${tr} ${tr} 0 0 1 ${W} ${tr}V${H - br}A${br} ${br} 0 0 1 ${W - br} ${H}H${bl}A${bl} ${bl} 0 0 1 0 ${H - bl}V${tl}A${tl} ${tl} 0 0 1 ${tl} 0Z`
    return `path(evenodd, "M${x0} ${y0}H${x1}V${y1}H${x0}Z${card}")`
  })()
  type At = { left: number; width: number; top?: number; bottom?: number; along: boolean }
  // Staples hang from the card's top edge (top only) or sit on its bottom edge (bottom only), so a card changing
  // height never leaves them where the old height put them.
  const place = (l: FrameLayer): At => {
    const w = snap((l.width ?? 1312) * s), h = (l.height ?? 0) * s
    const left = snap((W - w) / 2)
    if (l.type === 'staple') return l.anchor === 'bottom' ? { left, width: w, bottom: -ob, along: false } : { left, width: w, top: -ot, along: false }
    return { left, width: w, top: l.anchor === 'top' ? 0 : snap((H - h) / 2), along: true }
  }
  /** `dx`: where the layer's container starts left of the card (rails sit in a wider clip box). */
  const img = (l: FrameLayer, at: At, dx = 0): ReactElement =>
    <img src={assetFile('profile-frames', item.id, l.file)} alt="" draggable={false} className="absolute max-w-none select-none"
      style={{ left: at.left - dx, width: at.width, ...(at.bottom !== undefined ? { bottom: at.bottom } : { top: at.top }) }} data-frame-layer={l.file} data-frame-order={l.order} />
  // Rails and borders on a card taller than they were drawn for (the DM panel's full-height card): the top and bottom
  // 45% keep their size at the card's top and bottom corners and the middle stretches between them.
  const along = (l: FrameLayer, at: At, dx: number): ReactElement => {
    const nat = l.height ?? 0
    if (!nat || nat * s >= H) return img(l, at, dx)
    const cut = Math.floor(nat * 0.45), cutPx = snap(cut * s)
    return <div className="absolute inset-y-0 select-none" style={{ left: at.left - dx, width: at.width, boxSizing: 'border-box', borderStyle: 'solid', borderWidth: `${cutPx}px 0`, borderImageSource: `url("${assetFile('profile-frames', item.id, l.file)}")`, borderImageSlice: `${cut} 0 ${cut} 0 fill`, borderImageWidth: `${cutPx}px 0`, borderImageRepeat: 'stretch' }} data-frame-layer={l.file} data-frame-order={l.order} data-frame-stretched />
  }
  const piece = (l: FrameLayer, i: number) => {
    const at = place(l)
    // Rails and borders stop at the card's top and bottom edges; staples hang free.
    return at.along
      ? <div key={i} className="absolute overflow-hidden" style={{ left: -oh - pad, width: W + 2 * (oh + pad), top: 0, bottom: 0 }}>{along(l, at, -oh - pad)}</div>
      : <span key={i}>{img(l, at)}</span>
  }

  // Two layers over the card's box, placing their pieces the same way: back pieces under the card (z 0, clipped to
  // around it) and front pieces over everything in it (z 20). The card sits between as its own stacking context.
  return (
    <>
      {box && W > 0 && item.layers.some((l) => l.order === 'back') && (
        <div className="pointer-events-none absolute inset-0 z-0" style={{ ...box.inset, clipPath: hole }} aria-hidden data-frame-back-layer data-frame-back>
          {item.layers.map((l, i) => (l.order === 'back' ? piece(l, i) : null))}
        </div>
      )}
      <div ref={ref} className="pointer-events-none absolute inset-0 z-20" style={box?.inset} aria-hidden data-profile-frame-layers={item.id}>
        {box && W > 0 && item.layers.map((l, i) => (l.order === 'back' ? null : piece(l, i)))}
      </div>
    </>
  )
}

/** The DM panel's card width (Discord's): the card keeps it with or without a frame, and the panel widens instead. */
export const PANEL_CARD_WIDTH = 304

/**
 * How far a frame reaches past a card `cardWidth` wide (every layer is scaled by cardWidth / inner_width): above,
 * below and on each side, the side being whichever is wider of the layout's overflow and the widest layer's overhang.
 */
export function frameReach(item: FrameItem, cardWidth: number, dpr = 1) {
  const L = item.layout!, s = cardWidth / (L.inner_width || 1200)
  // In device pixels like the layers themselves (ProfileFrame snaps each width and centres it on the card), rounded up:
  // the frame then never pokes past the room it is given, and the room is no wider than it needs to be.
  const snap = (v: number) => Math.round(v * dpr) / dpr, up = (v: number) => Math.ceil(v * dpr - 1e-6) / dpr
  const widest = Math.max(0, ...item.layers.map((l) => snap((l.width ?? 1312) * s)))
  return { top: up(L.overflow_top * s), bottom: up(L.overflow_bottom * s), side: up(Math.max(L.overflow_horizontal * s, (widest - cardWidth) / 2)) }
}

/** The DM panel's width for a card PANEL_CARD_WIDTH wide wearing `item`: 8px either side of the frame's room. */
export function panelWidth(item: FrameItem | null) {
  return PANEL_CARD_WIDTH + 2 * (item?.layout ? frameReach(item, PANEL_CARD_WIDTH, window.devicePixelRatio || 1).side : 0) + 16
}

/**
 * Room for a card's frame: padding as large as the frame reaches past the card (scaled to the card's width), with the
 * card and its frame inside. Whatever positions, nudges, scrolls or clips the card then sees the whole framed area,
 * so a frame is never cut off by a scroll box or pushed off screen. Without an asset frame it adds nothing.
 *
 * `cardWidth` (the DM panel): the card keeps that width and the room grows around it, rounded up to whole device
 * pixels so a clipping wrapper never cuts the frame; the panel sizes itself to match (frameReach). Otherwise the card
 * takes what's left of the wrapper after the room, which depends on its width: exact values there, since rounding
 * would let the two chase each other.
 */
export function FrameRoom({ value, className = '', innerClassName = '', style, bleed, cardWidth, children, ...rest }: { value?: string | null; className?: string; innerClassName?: string; style?: CSSProperties; children: ReactNode; /** Reserve no room: the frame reaches over whatever is around the card (the full profile's window). */ bleed?: boolean; cardWidth?: number } & Record<`data-${string}`, string | boolean | undefined>) {
  const item = useAssetItem<FrameItem>('profile-frames', value)
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !item || cardWidth || typeof ResizeObserver === 'undefined') return
    const measure = () => setW(el.offsetWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [item, cardWidth])
  const L = item?.layout
  const cw = cardWidth ?? w
  let pad: CSSProperties = {}
  if (item && L && cw && !bleed) {
    // Exact values when the card's width depends on the room; whole device pixels for a fixed card (see frameReach).
    const r = cardWidth ? frameReach(item, cw, window.devicePixelRatio || 1) : { top: L.overflow_top * cw / (L.inner_width || 1200), bottom: L.overflow_bottom * cw / (L.inner_width || 1200), side: L.overflow_horizontal * cw / (L.inner_width || 1200) }
    pad = { paddingTop: r.top, paddingBottom: r.bottom, paddingLeft: r.side, paddingRight: r.side }
  }
  return (
    <div className={className} style={{ ...style, ...pad }} data-frame-wrap data-frame-room={item ? item.id : undefined} {...rest}>
      {/* Its own stacking context: the frame's back layer (z 0), the card (z 1) and the front layer (z 20) stack
          inside it and never against what is around the card. */}
      <div ref={ref} className={`relative isolate ${innerClassName}`} style={cardWidth ? { width: cardWidth } : undefined}>
        {children}
        <ProfileFrame value={value} />
      </div>
    </div>
  )
}
