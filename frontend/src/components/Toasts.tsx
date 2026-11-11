import { X } from 'lucide-react'
import { useStore } from '../store'

export default function Toasts() {
  const toast = useStore((s) => s.toast)
  const dismiss = useStore((s) => s.dismissToast)
  if (!toast.length) return null
  return (
    <div className="fixed safe-corner z-[100] flex flex-col gap-2">
      {toast.map((t) => (
        <div key={t.id} data-toast className={`pop flex items-center gap-3 rounded-lg px-4 py-3 text-sm shadow-xl border ${t.kind === 'error' ? 'bg-danger/15 border-danger/40 text-text-0' : 'bg-bg-3 border-line text-text-0'}`}>
          <span className="min-w-0 break-words">{t.text}</span>
          {t.action && <button onClick={() => { t.action!.run(); dismiss(t.id) }} className="shrink-0 font-semibold text-accent hover:underline" data-toast-action>{t.action.label}</button>}
          <button onClick={() => dismiss(t.id)} className="text-text-2 hover:text-text-0"><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}
