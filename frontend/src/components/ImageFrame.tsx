import { Minus, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { cropStyle, type Crop } from '../lib/crop'
import { useT } from '../lib/i18n'

const DEFAULT: Crop = { z: 1, x: 50, y: 50 }

/**
 * Frame a picture without changing it: drag (or arrow keys) to position, zoom with the slider, -/+ buttons, the wheel
 * or a pinch, Reset to start over. The preview is drawn exactly the way the app draws the framed picture (`cropStyle`),
 * so what you see is what everyone gets. Works for animated images too, since nothing is re-encoded.
 */
export default function ImageFrame({ src, aspect, round, initial, onDone, onCancel }: {
  src: string; aspect: number; round: boolean; initial: Crop | null; onDone: (c: Crop) => void; onCancel: () => void
}) {
  const t = useT()
  const [BW, BH] = useMemo(() => {
    const w = aspect === 1 ? 240 : Math.min(400, Math.max(200, (typeof window !== 'undefined' ? window.innerWidth : 400) - 96))
    return [w, Math.round(w / aspect)]
  }, [aspect])
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [crop, setCrop] = useState<Crop>(initial ?? DEFAULT)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; z: number } | null>(null)
  useEffect(() => { setNat(null); const i = new Image(); i.onload = () => setNat({ w: i.naturalWidth, h: i.naturalHeight }); i.src = src }, [src])
  // The picture's drawn size at this zoom, and how far it overflows the frame each way.
  const cover = nat ? Math.max(BW / nat.w, BH / nat.h) : 1
  const over = (z: number) => ({ x: (nat?.w ?? 0) * cover * z - BW, y: (nat?.h ?? 0) * cover * z - BH })
  const setZoom = (z: number) => setCrop((c) => ({ ...c, z: Math.min(5, Math.max(1, z)) }))
  // Moving the picture by (dx, dy) pixels: its left edge sits at x% of (frame - picture), so solve for the new x%.
  const shift = (base: { left: number; top: number }, dx: number, dy: number) => setCrop((c) => {
    const o = over(c.z)
    return {
      ...c,
      x: o.x > 0.5 ? Math.min(100, Math.max(0, (-(base.left + dx) / o.x) * 100)) : c.x,
      y: o.y > 0.5 ? Math.min(100, Math.max(0, (-(base.top + dy) / o.y) * 100)) : c.y,
    }
  })
  const edges = () => { const o = over(crop.z); return { left: -(crop.x / 100) * o.x, top: -(crop.y / 100) * o.y } }
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus()
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: crop.z }; drag.current = null }
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
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(crop.z + 0.2) }
    else if (e.key === '-') { e.preventDefault(); setZoom(crop.z - 0.2) }
  }
  return (
    <div className="space-y-3" data-image-crop>
      <div className="relative mx-auto touch-none select-none overflow-hidden rounded-xl bg-[repeating-conic-gradient(#3f4147_0_25%,#2b2d31_0_50%)] bg-[length:16px_16px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ width: BW, height: BH }} tabIndex={0} role="application" aria-label={t('Drag to position, arrow keys to nudge, + and - to zoom')}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
        onWheel={(e) => setZoom(crop.z - e.deltaY / 500)} data-crop-area data-crop-aspect={aspect}>
        <img src={src} alt="" draggable={false} className="absolute inset-0 h-full w-full max-w-none cursor-grab active:cursor-grabbing" style={cropStyle(crop)} data-crop-img />
        {round
          ? <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ring-2 ring-inset ring-white/80" data-crop-round />
          : <div className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset ring-white/70" />}
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,transparent_33.2%,white_33.3%,white_33.5%,transparent_33.6%,transparent_66.5%,white_66.6%,white_66.8%,transparent_66.9%),linear-gradient(to_bottom,transparent_33.2%,white_33.3%,white_33.5%,transparent_33.6%,transparent_66.5%,white_66.6%,white_66.8%,transparent_66.9%)]" />
      </div>
      <div className="flex items-center gap-2 text-xs text-text-2">
        <span className="shrink-0">{t('Zoom')}</span>
        <button type="button" className="rounded p-1 hover:bg-bg-3 hover:text-text-0 disabled:opacity-40" onClick={() => setZoom(crop.z - 0.2)} disabled={crop.z <= 1} aria-label={t('Zoom out')} data-crop-zoom-out><Minus size={14} /></button>
        <input type="range" min={1} max={5} step={0.01} value={crop.z} onChange={(e) => setZoom(Number(e.target.value))} className="min-w-0 flex-1 accent-accent" aria-label={t('Zoom')} data-crop-zoom />
        <button type="button" className="rounded p-1 hover:bg-bg-3 hover:text-text-0 disabled:opacity-40" onClick={() => setZoom(crop.z + 0.2)} disabled={crop.z >= 5} aria-label={t('Zoom in')} data-crop-zoom-in><Plus size={14} /></button>
        <button type="button" className="ml-1 flex shrink-0 items-center gap-1 rounded px-1.5 py-1 hover:bg-bg-3 hover:text-text-0" onClick={() => setCrop(DEFAULT)} data-crop-reset><RotateCcw size={13} />{t('Reset')}</button>
      </div>
      <p className="text-center text-xs text-text-2">{t('Drag to position. Scroll, pinch or use the slider to zoom.')}</p>
      <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onCancel} data-crop-cancel>{t('Cancel')}</button><button type="button" className="btn-primary" disabled={!nat} onClick={() => onDone(crop)} data-crop-apply>{t('Apply')}</button></div>
    </div>
  )
}
