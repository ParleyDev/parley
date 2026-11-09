import { Camera } from 'lucide-react'
import { useRef, useState } from 'react'
import { colorFor, initials } from '../../lib/format'
import { prepareImage, uploadImage } from '../../lib/upload'
import { frameImage, splitCrop, withCrop } from '../../lib/crop'
import CropImg from '../CropImg'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'

interface Props { value: string | null; onChange: (v: string | null) => void; label: string; id: string; round?: boolean; kind?: 'avatar' | 'icon' | 'banner' }

/**
 * Avatar / server icon / banner picker. The picture is framed first (zoom and position, kept in the URL as #crop=,
 * applied when it is drawn) and uploaded as is: static images shrunk to fit 2048px, GIF, APNG and
 * animated WebP are uploaded untouched so they keep animating. The picked value is the served URL.
 */
export default function ImagePicker({ value, onChange, label, id, round = true, kind = 'avatar' }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const pushToast = useStore((s) => s.pushToast)
  const [busy, setBusy] = useState(false)
  const t = useT()
  const shape = kind === 'banner' ? 'serverBanner' : kind === 'icon' ? 'icon' : 'avatar'
  const pick = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try {
      // Frame it first (nothing is uploaded if they cancel), then upload the picture as it is, with room to zoom.
      const crop = await frameImage(f, shape)
      if (!crop) return
      onChange(withCrop((await uploadImage(kind, await prepareImage(f, 2048, 2048))).url, crop))
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const adjust = async () => {
    if (!value) return
    const crop = await frameImage(value, shape, splitCrop(value).crop)
    if (crop) onChange(withCrop(value, crop))
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className={`group relative h-20 w-20 overflow-hidden ${round ? 'rounded-full' : 'rounded-2xl'} border-2 border-dashed border-line hover:border-accent flex items-center justify-center text-white text-2xl font-bold`}
        style={{ background: value ? undefined : colorFor(id) }} data-image-picker>
        {value ? <CropImg src={value} className="h-full w-full object-cover" alt="" /> : initials(label || '?')}
        <span className={`absolute inset-0 bg-black/50 ${busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} flex items-center justify-center`}><Camera size={22} className={busy ? 'animate-pulse' : ''} /></span>
      </button>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/apng" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
      {value && <div className="flex gap-3 text-xs"><button type="button" onClick={adjust} className="text-text-2 hover:text-text-0" data-image-adjust>{t('Adjust')}</button><button type="button" onClick={() => onChange(null)} className="text-text-2 hover:text-danger">{t('Remove image')}</button></div>}
    </div>
  )
}
