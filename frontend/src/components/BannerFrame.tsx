import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { Minus, Plus, RotateCcw, X } from 'lucide-react'
import { BANNER_PREVIEWS, DEFAULT_BANNER, finishBanner, useBannerFrame, type BannerFit, type BannerFormat } from '../lib/bannerFormat'
import { useT } from '../lib/i18n'
import { BannerPicture } from './CommunityBanner'

const DESKTOP = BANNER_PREVIEWS[1]
const SIDE = BANNER_PREVIEWS.filter((p) => p !== DESKTOP)
const ALIGN = [0, 50, 100]

/** The dialog `frameBanner()` opens: above everything, like the picture cropper. */
export default function BannerFrameHost() {
  const t = useT()
  const req = useBannerFrame((s) => s.req)
  useEffect(() => {
    if (!req) return
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.stopPropagation(); finishBanner(null) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [req])
  if (!req) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm safe-pad" onMouseDown={(e) => { if (e.target === e.currentTarget) finishBanner(null) }}>
      <div className="pop relative flex max-h-full w-full max-w-3xl flex-col overflow-y-auto rounded-2xl border border-line bg-bg-1 p-6 shadow-2xl phone:p-4" role="dialog" aria-modal aria-label={t('Header image')} data-banner-dialog>
        <h2 className="mb-4 text-xl font-bold">{t('Header image')}</h2>
        <button type="button" onClick={() => finishBanner(null)} className="absolute right-4 top-4 rounded-md p-1 text-text-2 hover:bg-bg-3 hover:text-text-0" aria-label={t('Close')}><X size={18} /></button>
        <BannerFrame key={req.src} src={req.src} initial={req.initial} onDone={finishBanner} onCancel={() => finishBanner(null)} />
      </div>
    </div>
  )
}

/**
 * Lay out a header image for a header that is as wide as the window: Fill (cover it, choose the zoom and which part
 * stays in view) or Fit (the whole picture over a blurred copy, placed left, centre or right). The large frame is the
 * header on a desktop window; the small ones show the same layout on a phone and on a wide screen. All of them are
 * drawn by the same component the page uses, so they show exactly what members get.
 */
export function BannerFrame({ src, initial, onDone, onCancel }: { src: string; initial: BannerFormat | null; onDone: (f: BannerFormat) => void; onCancel: () => void }) {
  const t = useT()
  const LABEL: Record<(typeof BANNER_PREVIEWS)[number]['key'], string> = { phone: t('Phone'), desktop: t('Desktop'), wide: t('Wide screen') }
  const [f, setF] = useState<BannerFormat>(initial ?? DEFAULT_BANNER)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [cw, setCw] = useState(640)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setCw(el.clientWidth))
    ro.observe(el); setCw(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  useEffect(() => { setNat(null); const i = new Image(); i.onload = () => setNat({ w: i.naturalWidth, h: i.naturalHeight }); i.src = src }, [src])
  const BW = cw, BH = Math.round(cw * DESKTOP.h / DESKTOP.w)
  // How far the drawn picture is wider/taller than the frame: positive when it overflows (fill), negative when there
  // is room left over (fit). Its left edge sits at -(x% of that), so dragging solves for the new x%.
  const span = (g: BannerFormat) => {
    if (!nat) return { x: 0, y: 0 }
    const s = g.fit === 'fill' ? Math.max(BW / nat.w, BH / nat.h) * g.z : Math.min(BW / nat.w, BH / nat.h)
    return { x: nat.w * s - BW, y: nat.h * s - BH }
  }
  const edges = () => { const o = span(f); return { left: -(f.x / 100) * o.x, top: -(f.y / 100) * o.y } }
  const shift = (base: { left: number; top: number }, dx: number, dy: number) => setF((g) => {
    const o = span(g)
    const pct = (edge: number, d: number, s: number) => Math.min(100, Math.max(0, (-(edge + d) / s) * 100))
    return { ...g, x: Math.abs(o.x) > 0.5 ? pct(base.left, dx, o.x) : g.x, y: Math.abs(o.y) > 0.5 ? pct(base.top, dy, o.y) : g.y }
  })
  const setZoom = (z: number) => setF((g) => ({ ...g, z: Math.min(5, Math.max(1, z)) }))
  const setFit = (fit: BannerFit) => setF((g) => ({ ...g, fit, z: fit === 'fit' ? 1 : g.z }))
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; z: number } | null>(null)
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus()
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && f.fit === 'fill') { const [a, b] = [...pointers.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: f.z }; drag.current = null }
    else drag.current = { x: e.clientX, y: e.clientY, ...edges() }
  }
  const move = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; setZoom(pinch.current.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d); return }
    const d = drag.current; if (d) shift(d, e.clientX - d.x, e.clientY - d.y)
  }
  const up = (e: RPointerEvent) => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null; if (!pointers.current.size) drag.current = null }
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 8
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (d) { e.preventDefault(); shift(edges(), d[0], d[1]) }
    else if (f.fit === 'fill' && (e.key === '+' || e.key === '=')) { e.preventDefault(); setZoom(f.z + 0.2) }
    else if (f.fit === 'fill' && e.key === '-') { e.preventDefault(); setZoom(f.z - 0.2) }
  }
  // The side previews share one height and split the width between them by their shapes.
  const gap = 12
  // Too short to read on a narrow screen: then they go one under the other, each as wide as it can be.
  const rowH = (BW - gap * (SIDE.length - 1)) / SIDE.reduce((n, p) => n + p.w / p.h, 0)
  const stacked = rowH < 48
  const sizeOf = (p: (typeof SIDE)[number]) => {
    if (!stacked) return { height: rowH, width: rowH * p.w / p.h }
    const w = Math.min(BW, 64 * p.w / p.h)
    return { width: w, height: w * p.h / p.w }
  }
  const soft = nat && f.fit === 'fill' && nat.w / f.z < 1600
  const modeBtn = (m: BannerFit, label: string, hint: string) => (
    <button type="button" onClick={() => setFit(m)} aria-pressed={f.fit === m} className={`flex-1 rounded-lg border px-3 py-2 text-left ${f.fit === m ? 'border-accent bg-accent/15' : 'border-line hover:bg-bg-3'}`} data-banner-mode={m}>
      <span className="block text-sm font-semibold">{label}</span>
      <span className="block text-xs text-text-2">{hint}</span>
    </button>
  )
  return (
    <div className="space-y-4" data-banner-frame>
      <div className="flex gap-2 phone:flex-col">
        {modeBtn('fill', t('Fill'), t('Covers the header. Wide screens show less of the top and bottom.'))}
        {modeBtn('fit', t('Fit'), t('Shows the whole picture over a blurred copy of it.'))}
      </div>
      <div ref={box} className="w-full">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">{LABEL.desktop}</p>
        <div className="relative isolate touch-none select-none overflow-hidden rounded-lg bg-bg-3 outline-none ring-1 ring-line focus-visible:ring-2 focus-visible:ring-accent"
          style={{ width: BW, height: BH }} tabIndex={0} role="application" aria-label={t('Drag to position, arrow keys to nudge, + and - to zoom')}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
          onWheel={(e) => { if (f.fit === 'fill') setZoom(f.z - e.deltaY / 500) }} data-banner-area>
          <BannerPicture url={src} format={f} />
          <div className="absolute inset-0 cursor-grab active:cursor-grabbing" />
        </div>
      </div>
      <div className={`flex ${stacked ? 'flex-col' : ''}`} style={{ gap }}>
        {SIDE.map((p) => (
          <div key={p.key} className="min-w-0">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">{LABEL[p.key]}</p>
            <div className="relative isolate overflow-hidden rounded-md bg-bg-3 ring-1 ring-line" style={sizeOf(p)} data-banner-preview={p.key}>
              <BannerPicture url={src} format={f} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div>
          <p className="mb-1 text-xs text-text-2" id="banner-align-label">{t('Alignment')}</p>
          <div className="grid w-fit grid-cols-3 gap-1 rounded-lg border border-line p-1" role="group" aria-labelledby="banner-align-label">
            {ALIGN.flatMap((y) => ALIGN.map((x) => {
              const on = Math.round(f.x) === x && Math.round(f.y) === y
              const name = `${[t('Top'), t('Middle'), t('Bottom')][y / 50]} ${[t('left'), t('centre'), t('right')][x / 50]}`
              return <button key={`${x},${y}`} type="button" onClick={() => setF((g) => ({ ...g, x, y }))} aria-label={name} title={name} aria-pressed={on}
                className={`flex h-7 w-7 items-center justify-center rounded ${on ? 'bg-accent' : 'hover:bg-bg-3'}`} data-banner-align={`${x},${y}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-white' : 'bg-text-2'}`} />
              </button>
            }))}
          </div>
        </div>
        <div className="min-w-[12rem] flex-1">
          <p className="mb-1 text-xs text-text-2">{t('Zoom')}</p>
          <div className="flex items-center gap-2 text-text-2">
            <button type="button" className="rounded p-1 hover:bg-bg-3 hover:text-text-0 disabled:opacity-40" onClick={() => setZoom(f.z - 0.2)} disabled={f.fit === 'fit' || f.z <= 1} aria-label={t('Zoom out')}><Minus size={14} /></button>
            <input type="range" min={1} max={5} step={0.01} value={f.z} disabled={f.fit === 'fit'} onChange={(e) => setZoom(Number(e.target.value))} className="min-w-0 flex-1 accent-accent disabled:opacity-40" aria-label={t('Zoom')} data-banner-zoom />
            <button type="button" className="rounded p-1 hover:bg-bg-3 hover:text-text-0 disabled:opacity-40" onClick={() => setZoom(f.z + 0.2)} disabled={f.fit === 'fit' || f.z >= 5} aria-label={t('Zoom in')}><Plus size={14} /></button>
          </div>
          {f.fit === 'fit' && <p className="mt-1 text-xs text-text-2">{t('Fit always shows the whole picture.')}</p>}
        </div>
      </div>
      <p className="text-xs text-text-2">{t('Drag the picture to choose what stays in view.')}{soft && ` ${t('This picture is {w} pixels wide at this zoom, so it may look soft on large screens. 1600 or more works best.', { w: Math.round(nat!.w / f.z) })}`}</p>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-ghost flex items-center gap-1" onClick={() => setF(DEFAULT_BANNER)} data-banner-reset><RotateCcw size={14} />{t('Reset')}</button>
        <span className="flex-1" />
        <button type="button" className="btn-ghost" onClick={onCancel} data-banner-cancel>{t('Cancel')}</button>
        <button type="button" className="btn-primary" disabled={!nat} onClick={() => onDone(f)} data-banner-apply>{t('Apply')}</button>
      </div>
    </div>
  )
}
