import { Camera } from 'lucide-react'
import { useRef } from 'react'
import { colorFor, initials, readFileAsDataUrl } from '../../lib/format'
import { useStore } from '../../store'

interface Props { value: string | null; onChange: (v: string | null) => void; label: string; id: string; round?: boolean }

export default function ImagePicker({ value, onChange, label, id, round = true }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const pushToast = useStore((s) => s.pushToast)
  const pick = async (f: File | undefined) => {
    if (!f) return
    try { onChange(await readFileAsDataUrl(f)) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" onClick={() => ref.current?.click()} className={`group relative h-20 w-20 overflow-hidden ${round ? 'rounded-full' : 'rounded-2xl'} border-2 border-dashed border-line hover:border-accent flex items-center justify-center text-white text-2xl font-bold`}
        style={{ background: value ? undefined : colorFor(id) }}>
        {value ? <img src={value} className="h-full w-full object-cover" alt="" /> : initials(label || '?')}
        <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center"><Camera size={22} /></span>
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {value && <button type="button" onClick={() => onChange(null)} className="text-xs text-text-2 hover:text-danger">Remove image</button>}
    </div>
  )
}
