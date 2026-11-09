import { useEffect } from 'react'
import { X } from 'lucide-react'
import ImageFrame from './ImageFrame'
import { SHAPES, finishCrop, useCrop } from '../lib/crop'
import { useT } from '../lib/i18n'

/** The dialog `frameImage()` opens: above everything, including the settings or modal it was opened from. */
export default function CropHost() {
  const t = useT()
  const req = useCrop((s) => s.req)
  useEffect(() => {
    if (!req) return
    // Escape closes only this, not the settings window or modal underneath.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.stopPropagation(); finishCrop(null) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [req])
  if (!req) return null
  const s = SHAPES[req.shape]
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm safe-pad" onMouseDown={(e) => { if (e.target === e.currentTarget) finishCrop(null) }}>
      <div className="pop relative w-full max-w-[480px] rounded-2xl border border-line bg-bg-1 p-6 shadow-2xl" role="dialog" aria-modal aria-label={t(s.title)} data-crop-dialog={req.shape}>
        <h2 className="mb-4 text-xl font-bold">{t(s.title)}</h2>
        <button type="button" onClick={() => finishCrop(null)} className="absolute right-4 top-4 rounded-md p-1 text-text-2 hover:bg-bg-3 hover:text-text-0" aria-label={t('Close')}><X size={18} /></button>
        <ImageFrame key={req.src} src={req.src} aspect={s.aspect} round={s.round} initial={req.initial} onDone={finishCrop} onCancel={() => finishCrop(null)} />
      </div>
    </div>
  )
}
