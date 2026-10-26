import { ChevronLeft, ChevronRight, Download, ExternalLink, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import ContextMenu, { useContextMenu } from '../ContextMenu'
import { absoluteUrl, imageMenu } from '../../lib/imageMenu'
import type { GalleryItem } from '../../store'

/** Full-screen image viewer: a gallery of the message's pictures (arrows or ←/→), click to zoom, download, alt text. */
export default function ImageLightbox({ onClose, url, name, items, index = 0 }: { onClose: () => void; url: string; name: string; items?: GalleryItem[]; index?: number }) {
  const list: GalleryItem[] = items?.length ? items : [{ url, name }]
  const [i, setI] = useState(Math.min(Math.max(0, index), list.length - 1))
  const [zoom, setZoom] = useState(false)
  const menu = useContextMenu()
  const cur = list[i]
  const go = (d: number) => { setZoom(false); setI((n) => (n + d + list.length) % list.length) }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape closes an open right-click menu first, then the viewer.
      if (e.key === 'Escape' && !document.querySelector('[data-context-menu]')) onClose()
      if (list.length > 1 && e.key === 'ArrowRight') go(1)
      if (list.length > 1 && e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, list.length])
  const download = async () => {
    const blob = await (await fetch(cur.url)).blob()
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = href; a.download = cur.name || 'image'
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 10_000)
  }
  const btn = 'h-10 w-10 rounded-full bg-bg-0/70 flex items-center justify-center text-text-1 hover:text-text-0'
  return (
    <div className={`fixed inset-0 z-50 bg-black/85 flex items-center justify-center safe-pad pop ${zoom ? 'overflow-auto' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} role="dialog" aria-modal aria-label={cur.name} data-lightbox>
      <img src={cur.url} alt={cur.alt || cur.name} onClick={() => setZoom((z) => !z)} onContextMenu={(e) => menu.open(e, imageMenu(cur.url, cur.name))}
        className={zoom ? 'max-w-none cursor-zoom-out' : 'max-h-[85vh] max-w-[95vw] object-contain rounded-lg shadow-2xl cursor-zoom-in'} data-lightbox-img data-zoomed={zoom ? '1' : '0'} />
      {menu.menu && <ContextMenu {...menu.menu} onClose={menu.close} label="Image" />}
      {list.length > 1 && (
        <>
          <button type="button" onClick={() => go(-1)} className={`${btn} absolute left-4 top-1/2 -translate-y-1/2`} title="Previous (←)" aria-label="Previous image" data-lightbox-prev><ChevronLeft size={24} /></button>
          <button type="button" onClick={() => go(1)} className={`${btn} absolute right-4 top-1/2 -translate-y-1/2`} title="Next (→)" aria-label="Next image" data-lightbox-next><ChevronRight size={24} /></button>
        </>
      )}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex max-w-[92vw] flex-col items-center gap-1">
        {cur.alt && <p className="max-w-[80vw] rounded-lg bg-bg-0/80 px-3 py-1.5 text-sm text-text-1" data-lightbox-alt><b className="mr-1 text-[10px]">ALT</b>{cur.alt}</p>}
        <div className="flex items-center gap-3 rounded-lg bg-bg-0/80 px-3 py-1.5 text-sm">
          {list.length > 1 && <span className="tabular-nums text-text-2" data-lightbox-count>{i + 1} / {list.length}</span>}
          <span className="truncate max-w-[40vw]">{cur.name}</span>
          <button type="button" onClick={() => setZoom((z) => !z)} className="flex items-center gap-1 text-sky-400 hover:underline" data-lightbox-zoom>{zoom ? <><ZoomOut size={14} /> Fit</> : <><ZoomIn size={14} /> Zoom</>}</button>
          <button type="button" onClick={download} className="flex items-center gap-1 text-sky-400 hover:underline" data-lightbox-download><Download size={14} /> Download</button>
          <a href={absoluteUrl(cur.url)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sky-400 hover:underline"><ExternalLink size={14} /> Open original</a>
        </div>
      </div>
      <button onClick={onClose} className={`${btn} absolute right-4 top-4`} title="Close"><X size={22} /></button>
    </div>
  )
}
