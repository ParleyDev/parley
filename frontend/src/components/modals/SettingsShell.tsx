import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

export interface NavSection<T extends string> { title?: string; items: { id: T; label: string; icon?: ReactNode }[] }

interface Props<T extends string> {
  sections: NavSection<T>[]
  tab: T
  onTab: (t: T) => void
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
  /** Wider content column for tables (roles, members, permissions). */
  wide?: boolean
}

/** Full-screen settings layout shared by user, server and channel settings: left nav, scrolling content, ESC. */
export default function SettingsShell<T extends string>({ sections, tab, onTab, onClose, footer, children, wide }: Props<T>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-bg-1 flex max-md:flex-col pop" role="dialog" aria-modal>
      <nav className="w-[232px] shrink-0 bg-bg-0/60 flex justify-end max-md:w-full max-md:justify-start max-md:pr-12 max-md:border-b max-md:border-line">
        <div className="w-[200px] py-14 pr-2 space-y-0.5 max-md:w-full max-md:py-2 max-md:pr-2 max-md:pl-2 max-md:flex max-md:items-center max-md:gap-1 max-md:space-y-0 max-md:overflow-x-auto">
          {sections.map((sec, i) => (
            <div key={i} className="max-md:flex max-md:items-center max-md:gap-1">
              {sec.title && <h3 className={`px-2.5 mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2 truncate max-md:hidden ${i > 0 ? 'mt-5' : ''}`}>{sec.title}</h3>}
              {sec.items.map((it) => (
                <button key={it.id} onClick={() => onTab(it.id)} className={`w-full max-md:w-auto whitespace-nowrap flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-left ${tab === it.id ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3 hover:text-text-0'}`}>{it.icon}{it.label}</button>
              ))}
            </div>
          ))}
          {footer && <div className="max-md:flex max-md:items-center"><div className="h-px bg-line my-3 mx-2 max-md:hidden" />{footer}</div>}
        </div>
      </nav>
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className={`${wide ? 'max-w-[960px]' : 'max-w-[740px]'} px-10 py-14 max-md:px-4 max-md:py-5 relative`}>{children}</div>
      </div>
      <div className="w-[60px] shrink-0 pt-14 pr-6 hidden md:block">
        <button onClick={onClose} className="flex flex-col items-center gap-1 text-text-2 hover:text-text-0">
          <span className="h-9 w-9 rounded-full border-2 border-text-2 flex items-center justify-center hover:border-text-0"><X size={18} /></span>
          <span className="text-[11px] font-bold">ESC</span>
        </button>
      </div>
      <button onClick={onClose} className="md:hidden absolute right-3 top-3 h-9 w-9 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0"><X size={22} /></button>
    </div>
  )
}

export function Toggle({ label, checked, onChange, disabled }: { label?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-4 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      {label && <span className="text-[15px]">{label}</span>}
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative h-6 w-10 shrink-0 rounded-full transition ${checked ? 'bg-success' : 'bg-bg-4'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </label>
  )
}
