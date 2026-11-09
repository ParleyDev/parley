import { Minus, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { useT } from '../lib/i18n'

/**
 * Crop a still image: drag (or use the arrow keys) to position it, zoom with the slider, the -/+ buttons, the wheel or
 * a pinch, and Reset to start over. `aspect` is width / height of the result (1 for avatars and icons, wider for
 * banners); `round` shows a circle guide for avatars. `onCrop` gets an `outW` × `outH` image (JPEG for photos,
 * otherwise PNG). Animated images would lose their frames, so callers skip this for them.
 */
export default function ImageCrop({ file, size = 128, aspect = 1, round = false, outW, outH, onCrop, onCancel, children }: {
  file: File; size?: number; aspect?: number; round?: boolean; outW?: number; outH?: number
  onCrop: (out: File) => void; onCancel: () => void; children?: React.ReactNode
}) {
  const t = useT()
  // The frame: 240 px square, or up to 400 px wide for banners (narrower on small screens).
  const [BW, BH] = useMemo(() => {
    const w = aspect === 1 ? 240 : Math.min(400, Math.max(200, (typeof window !== 'undefined' ? window.innerWidth : 400) - 96))
    return [w, Math.round(w / aspect)]
  }, [aspect])
  const W = outW ?? size, H = outH ?? Math.round((outW ?? size) / aspect)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; z: number } | null>(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const i = new Image(); i.onload = () => setImg(i); i.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])
  // At zoom 1 the picture just covers the frame.
  const base = img ? Math.max(BW / img.naturalWidth, BH / img.naturalHeight) : 1
  const w = (img?.naturalWidth ?? 0) * base * zoom, h = (img?.naturalHeight ?? 0) * base * zoom
  const clampFor = (p: { x: number; y: number }, ww: number, hh: number) => ({ x: Math.min(0, Math.max(BW - ww, p.x)), y: Math.min(0, Math.max(BH - hh, p.y)) })
  const clamp = (p: { x: number; y: number }) => clampFor(p, w, h)
  const center = () => { if (!img) return; const ww = img.naturalWidth * base, hh = img.naturalHeight * base; setZoom(1); setPos({ x: (BW - ww) / 2, y: (BH - hh) / 2 }) }
  useEffect(center, [img, base]) // eslint-disable-line react-hooks/exhaustive-deps
  const setZoomAround = (z: number, cx = BW / 2, cy = BH / 2) => {
    const nz = Math.min(5, Math.max(1, z))
    const k = nz / zoom
    setZoom(nz); setPos((p) => clampFor({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }, w * k, h * k))
  }
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus()
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }; drag.current = null }
    else drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
  }
  const move = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; setZoomAround(pinch.current.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d); return }
    const d = drag.current; if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }))
  }
  const up = (e: RPointerEvent) => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null; if (!pointers.current.size) drag.current = null }
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 8
    const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (d) { e.preventDefault(); setPos((p) => clamp({ x: p.x + d[0], y: p.y + d[1] })) }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoomAround(zoom + 0.2) }
    else if (e.key === '-') { e.preventDefault(); setZoomAround(zoom - 0.2) }
  }
  const done = () => {
    if (!img) return
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d'); if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    const scale = base * zoom
    ctx.drawImage(img, -pos.x / scale, -pos.y / scale, BW / scale, BH / scale, 0, 0, W, H)
    const jpeg = file.type === 'image/jpeg'
    c.toBlob((b) => { if (b) onCrop(new File([b], file.name.replace(/\.[^.]+$/, '') + (jpeg ? '.jpg' : '.png'), { type: jpeg ? 'image/jpeg' : 'image/png' })) }, jpeg ? 'image/jpeg' : 'image/png', 0.92)
  }
  return (
    <div className="space-y-3" data-image-crop>
      <div className="relative mx-auto touch-none select-none overflow-hidden rounded-xl bg-[repeating-conic-gradient(#3f4147_0_25%,#2b2d31_0_50%)] bg-[length:16px_16px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ width: BW, height: BH }} tabIndex={0} role="application" aria-label={t('Drag to position, arrow keys to nudge, + and - to zoom')}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
        onWheel={(e) => { const r = e.currentTarget.getBoundingClientRect(); setZoomAround(zoom - e.deltaY / 500, e.clientX - r.left, e.clientY - r.top) }} data-crop-area data-crop-aspect={aspect}>
        {img && <img src={img.src} alt="" draggable={false} className="absolute max-w-none cursor-grab active:cursor-grabbing" style={{ left: pos.x, top: pos.y, width: w, height: h }} data-crop-img />}
        {round
          ? <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ring-2 ring-inset ring-white/80" data-crop-round />
          : <div className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset ring-white/70" />}
        {/* Rule-of-thirds guides help line things up. */}
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,transparent_33.2%,white_33.3%,white_33.5%,transparent_33.6%,transparent_66.5%,white_66.6%,white_66.8%,transparent_66.9%),linear-gradient(to_bottom,transparent_33.2%,white_33.3%,white_33.5%,transparent_33.6%,transparent_66.5%,white_66.6%,white_66.8%,transparent_66.9%)]" />
      </div>
      <div className="flex items-center gap-2 text-xs text-text-2">
        <span className="shrink-0">{t('Zoom')}</span>
        <button type="button" className="rounded p-1 hover:bg-bg-3 hover:text-text-0 disabled:opacity-40" onClick={() => setZoomAround(zoom - 0.2)} disabled={zoom <= 1} aria-label={t('Zoom out')} data-crop-zoom-out><Minus size={14} /></button>
        <input type="range" min={1} max={5} step={0.01} value={zoom} onChange={(e) => setZoomAround(Number(e.target.value))} className="min-w-0 flex-1 accent-accent" aria-label={t('Zoom')} data-crop-zoom />
        <button type="button" className="rounded p-1 hover:bg-bg-3 hover:text-text-0 disabled:opacity-40" onClick={() => setZoomAround(zoom + 0.2)} disabled={zoom >= 5} aria-label={t('Zoom in')} data-crop-zoom-in><Plus size={14} /></button>
        <button type="button" className="ml-1 flex shrink-0 items-center gap-1 rounded px-1.5 py-1 hover:bg-bg-3 hover:text-text-0" onClick={center} data-crop-reset><RotateCcw size={13} />{t('Reset')}</button>
      </div>
      <p className="text-center text-xs text-text-2">{t('Drag to position. Scroll, pinch or use the slider to zoom.')}</p>
      {children}
      <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onCancel} data-crop-cancel>{t('Cancel')}</button><button type="button" className="btn-primary" disabled={!img} onClick={done} data-crop-apply>{t('Apply')}</button></div>
    </div>
  )
}
