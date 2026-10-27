import { t } from '../../lib/i18n'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

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
  /** Heading of the phone section list. */
  title?: string
  /** Phones: open on the section list (true) or straight into `tab` (false, when a link asked for a section). */
  startOnMenu?: boolean
}

/**
 * Full-screen settings shared by user, server and channel settings, ESC to close. Desktop: a sidebar of sections
 * beside the content. Phones: a list of sections first; picking one opens it full screen with a back button.
 * Kept clear of the phone's system bars.
 */
export default function SettingsShell<T extends string>({ sections, tab, onTab, onClose, footer, children, wide, title = 'Settings', startOnMenu = true }: Props<T>) {
  const [menu, setMenu] = useState(startOnMenu)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const pick = (id: T) => { onTab(id); setMenu(false) }
  const current = sections.flatMap((sec) => sec.items).find((it) => it.id === tab)
  const closeBtn = <button onClick={onClose} title={t('Close')} className="md:hidden ml-auto h-9 w-9 shrink-0 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" data-settings-close><X size={22} /></button>

  return (
    <div className="fixed inset-0 z-50 bg-bg-1 flex max-md:flex-col pop safe-area" role="dialog" aria-modal data-settings-view={menu ? 'menu' : 'section'}>
      <nav className={`w-[232px] shrink-0 bg-bg-0/60 flex justify-end max-md:w-full max-md:flex-1 max-md:min-h-0 max-md:flex-col max-md:justify-start max-md:bg-bg-1 ${menu ? '' : 'max-md:hidden'}`} data-settings-nav>
        <div className="md:hidden h-12 shrink-0 flex items-center gap-2 px-4 border-b border-line"><span className="font-bold text-lg truncate">{t(title)}</span>{closeBtn}</div>
        <div className="w-[200px] py-14 pr-2 space-y-0.5 max-md:w-full max-md:flex-1 max-md:overflow-y-auto max-md:px-3 max-md:py-3 max-md:space-y-0">
          {sections.map((sec, i) => (
            <div key={i} className="max-md:mb-4">
              {sec.title && <h3 className={`px-2.5 mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2 truncate ${i > 0 ? 'mt-5 max-md:mt-0' : ''}`}>{t(sec.title)}</h3>}
              <div className="max-md:rounded-xl max-md:bg-bg-0/60 max-md:overflow-hidden">
                {sec.items.map((it) => (
                  <button key={it.id} onClick={() => pick(it.id)} data-settings-tab={it.id} className={`w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-left max-md:rounded-none max-md:gap-3 max-md:px-3 max-md:py-3 max-md:border-b max-md:border-line/60 max-md:last:border-b-0 ${tab === it.id ? 'bg-bg-4 text-text-0 max-md:bg-transparent' : 'text-text-1 hover:bg-bg-3 hover:text-text-0'}`}>
                    {it.icon}<span className="flex-1 truncate">{t(it.label)}</span><ChevronRight size={16} className="md:hidden text-text-2" />
                  </button>
                ))}
              </div>
            </div>
          ))}
          {footer && <div className="max-md:rounded-xl max-md:bg-bg-0/60 max-md:overflow-hidden max-md:p-1"><div className="h-px bg-line my-3 mx-2 max-md:hidden" />{footer}</div>}
        </div>
      </nav>
      <div className={`flex-1 min-w-0 min-h-0 flex flex-col ${menu ? 'max-md:hidden' : ''}`}>
        <div className="md:hidden h-12 shrink-0 flex items-center gap-1 pl-1 pr-3 border-b border-line">
          <button onClick={() => setMenu(true)} className="h-9 flex items-center gap-0.5 rounded-md pl-1 pr-2 text-text-1 hover:bg-bg-3 hover:text-text-0" data-settings-back><ChevronLeft size={22} /><span className="text-[15px]">{t(title)}</span></button>
          <span className="min-w-0 flex-1 truncate text-center font-semibold" data-settings-title>{current?.label ? t(current.label) : ''}</span>
          {closeBtn}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className={`${wide ? 'max-w-[960px]' : 'max-w-[740px]'} px-10 py-14 max-md:px-4 max-md:py-5 relative`}>{children}</div>
        </div>
      </div>
      <div className="w-[60px] shrink-0 pt-14 pr-6 hidden md:block">
        <button onClick={onClose} className="flex flex-col items-center gap-1 text-text-2 hover:text-text-0">
          <span className="h-9 w-9 rounded-full border-2 border-text-2 flex items-center justify-center hover:border-text-0"><X size={18} /></span>
          <span className="text-[11px] font-bold">ESC</span>
        </button>
      </div>
    </div>
  )
}

export function Toggle({ label, checked, onChange, disabled }: { label?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-4 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      {label && <span className="text-[15px]">{t(label)}</span>}
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative h-6 w-10 shrink-0 rounded-full transition ${checked ? 'bg-success' : 'bg-bg-4'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </label>
  )
}
