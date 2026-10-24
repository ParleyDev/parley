import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

interface Props {
  title?: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  width?: string
  footer?: ReactNode
}

export default function Modal({ title, subtitle, onClose, children, width = 'max-w-md', footer }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm safe-pad" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`pop w-full ${width} rounded-2xl bg-bg-1 border border-line shadow-2xl overflow-hidden`} role="dialog" aria-modal>
        {(title || subtitle) && (
          <div className="px-6 pt-6 pb-2 relative">
            {title && <h2 className="text-xl font-bold">{title}</h2>}
            {subtitle && <p className="text-sm text-text-2 mt-1">{subtitle}</p>}
            <button onClick={onClose} className="absolute right-4 top-4 text-text-2 hover:text-text-0 rounded-md p-1 hover:bg-bg-3"><X size={18} /></button>
          </div>
        )}
        <div className="px-6 py-4">{children}</div>
        {footer && <div className="px-6 py-4 bg-bg-0/40 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}
