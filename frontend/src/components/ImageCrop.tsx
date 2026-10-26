import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'

const BOX = 240

/**
 * Square crop: drag the picture to frame it, zoom with the slider (or the wheel). `onCrop` gets a PNG of `size` px.
 * Still images only; animated GIFs would lose their frames.
 */
export default function ImageCrop({ file, size = 128, onCrop, onCancel, children }: { file: File; size?: number; onCrop: (out: File) => void; onCancel: () => void; children?: React.ReactNode }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const i = new Image(); i.onload = () => setImg(i); i.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])
  // At zoom 1 the shorter side fills the box.
  const base = img ? BOX / Math.min(img.naturalWidth, img.naturalHeight) : 1
  const w = (img?.naturalWidth ?? 0) * base * zoom, h = (img?.naturalHeight ?? 0) * base * zoom
  const clamp = (p: { x: number; y: number }) => ({ x: Math.min(0, Math.max(BOX - w, p.x)), y: Math.min(0, Math.max(BOX - h, p.y)) })
  useEffect(() => { if (img) setPos(clamp({ x: (BOX - w) / 2, y: (BOX - h) / 2 })) }, [img]) // eslint-disable-line react-hooks/exhaustive-deps
  const setZoomAround = (z: number) => {
    const nz = Math.min(4, Math.max(1, z))
    const cx = BOX / 2, cy = BOX / 2, k = nz / zoom
    setZoom(nz); setPos((p) => { const nw = w * k, nh = h * k; return { x: Math.min(0, Math.max(BOX - nw, cx - (cx - p.x) * k)), y: Math.min(0, Math.max(BOX - nh, cy - (cy - p.y) * k)) } })
  }
  const down = (e: RPointerEvent) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y } }
  const move = (e: RPointerEvent) => { const d = drag.current; if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y })) }
  const done = () => {
    if (!img) return
    const c = document.createElement('canvas'); c.width = size; c.height = size
    const ctx = c.getContext('2d'); if (!ctx) return
    const scale = base * zoom
    ctx.drawImage(img, -pos.x / scale, -pos.y / scale, BOX / scale, BOX / scale, 0, 0, size, size)
    c.toBlob((b) => { if (b) onCrop(new File([b], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' })) }, 'image/png')
  }
  return (
    <div className="space-y-3" data-image-crop>
      <div className="relative mx-auto touch-none select-none overflow-hidden rounded-xl bg-[repeating-conic-gradient(#3f4147_0_25%,#2b2d31_0_50%)] bg-[length:16px_16px]" style={{ width: BOX, height: BOX }}
        onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null }} onWheel={(e) => setZoomAround(zoom - e.deltaY / 500)} data-crop-area>
        {img && <img src={img.src} alt="" draggable={false} className="absolute max-w-none cursor-grab active:cursor-grabbing" style={{ left: pos.x, top: pos.y, width: w, height: h }} />}
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset ring-white/70" />
      </div>
      <label className="flex items-center gap-2 text-xs text-text-2">Zoom<input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoomAround(Number(e.target.value))} className="flex-1 accent-accent" data-crop-zoom /></label>
      {children}
      <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button><button type="button" className="btn-primary" disabled={!img} onClick={done} data-crop-apply>Apply</button></div>
    </div>
  )
}
