import { Camera } from 'lucide-react'
import { useRef, useState } from 'react'
import { colorFor, initials } from '../../lib/format'
import { prepareImage, uploadImage } from '../../lib/upload'
import { useStore } from '../../store'

interface Props { value: string | null; onChange: (v: string | null) => void; label: string; id: string; round?: boolean; kind?: 'avatar' | 'icon' | 'banner' }

/**
 * Avatar / server icon picker. Static images are shrunk to 512px client-side; GIF, APNG and
 * animated WebP are uploaded untouched so they keep animating. The picked value is the served URL.
 */
export default function ImagePicker({ value, onChange, label, id, round = true, kind = 'avatar' }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const pushToast = useStore((s) => s.pushToast)
  const [busy, setBusy] = useState(false)
  const pick = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try { onChange((await uploadImage(kind, await prepareImage(f, 512, 512))).url) } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className={`group relative h-20 w-20 overflow-hidden ${round ? 'rounded-full' : 'rounded-2xl'} border-2 border-dashed border-line hover:border-accent flex items-center justify-center text-white text-2xl font-bold`}
        style={{ background: value ? undefined : colorFor(id) }} data-image-picker>
        {value ? <img src={value} className="h-full w-full object-cover" alt="" /> : initials(label || '?')}
        <span className={`absolute inset-0 bg-black/50 ${busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} flex items-center justify-center`}><Camera size={22} className={busy ? 'animate-pulse' : ''} /></span>
      </button>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/apng" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
      {value && <button type="button" onClick={() => onChange(null)} className="text-xs text-text-2 hover:text-danger">Remove image</button>}
    </div>
  )
}
