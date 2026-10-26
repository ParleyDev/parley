import { ExternalLink, X } from 'lucide-react'
import { useEffect } from 'react'
import ContextMenu, { useContextMenu } from '../ContextMenu'
import { imageMenu } from '../../lib/imageMenu'

export default function ImageLightbox({ onClose, url, name }: { onClose: () => void; url: string; name: string }) {
  const menu = useContextMenu()
  useEffect(() => {
    // Escape closes an open right-click menu first, then the viewer.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[data-context-menu]')) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center safe-pad pop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} role="dialog" aria-modal>
      <img src={url} alt={name} className="max-h-[85vh] max-w-[95vw] object-contain rounded-lg shadow-2xl" onContextMenu={(e) => menu.open(e, imageMenu(url, name))} data-lightbox-img />
      {menu.menu && <ContextMenu {...menu.menu} onClose={menu.close} label="Image" />}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-lg bg-bg-0/80 px-3 py-1.5 text-sm">
        <span className="truncate max-w-[50vw]">{name}</span>
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sky-400 hover:underline"><ExternalLink size={14} /> Open original</a>
      </div>
      <button onClick={onClose} className="absolute right-4 top-4 h-10 w-10 rounded-full bg-bg-0/70 flex items-center justify-center text-text-1 hover:text-text-0" title="Close"><X size={22} /></button>
    </div>
  )
}
