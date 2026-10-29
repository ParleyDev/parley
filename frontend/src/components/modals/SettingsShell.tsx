import { t } from '../../lib/i18n'
import { ChevronLeft, ChevronRight, X, Check } from 'lucide-react'
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
  const closeBtn = <button onClick={onClose} title={t('Close')} className="wide:hidden ml-auto h-9 w-9 shrink-0 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" data-settings-close><X size={22} /></button>

  return (
    <div className="fixed inset-0 z-50 bg-bg-1 flex phone:flex-col pop safe-area" role="dialog" aria-modal data-settings-view={menu ? 'menu' : 'section'}>
      <nav className={`wide:flex-[1_0_232px] shrink-0 bg-bg-0/60 flex justify-end phone:w-full phone:flex-1 phone:min-h-0 phone:flex-col phone:justify-start phone:bg-bg-1 ${menu ? '' : 'phone:hidden'}`} data-settings-nav>
        <div className="wide:hidden h-12 shrink-0 flex items-center gap-2 px-4 border-b border-line"><span className="font-bold text-lg truncate">{t(title)}</span>{closeBtn}</div>
        <div className="w-[218px] py-14 pr-2 pl-5 space-y-0.5 overflow-y-auto phone:w-full phone:pl-3 phone:flex-1 phone:overflow-y-auto phone:px-3 phone:py-3 phone:space-y-0">
          {sections.map((sec, i) => (
            <div key={i} className="phone:mb-4">
              {i > 0 && <div className="h-px bg-line/70 mx-2.5 my-2.5 phone:hidden" />}
              {sec.title && <h3 className="px-2.5 mb-1 pt-0.5 text-[12px] font-semibold text-text-2 truncate phone:uppercase phone:text-[11px] phone:font-bold phone:tracking-wider" data-settings-section>{t(sec.title)}</h3>}
              <div className="phone:rounded-xl phone:bg-bg-0/60 phone:overflow-hidden">
                {sec.items.map((it) => (
                  <button key={it.id} onClick={() => pick(it.id)} data-settings-tab={it.id} className={`w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[15px] font-medium text-left phone:rounded-none phone:gap-3 phone:px-3 phone:py-3 phone:border-b phone:border-line/60 phone:last:border-b-0 ${tab === it.id ? 'bg-bg-4 text-text-0 phone:bg-transparent' : 'text-text-1 hover:bg-bg-3 hover:text-text-0'}`}>
                    <span className="wide:hidden flex">{it.icon}</span><span className="flex-1 truncate">{t(it.label)}</span><ChevronRight size={16} className="wide:hidden text-text-2" />
                  </button>
                ))}
              </div>
            </div>
          ))}
          {footer && <div className="phone:rounded-xl phone:bg-bg-0/60 phone:overflow-hidden phone:p-1"><div className="h-px bg-line my-3 mx-2 phone:hidden" />{footer}</div>}
        </div>
      </nav>
      <div className={`wide:flex-[1_1_800px] phone:flex-1 min-w-0 min-h-0 flex flex-col ${menu ? 'phone:hidden' : ''}`}>
        <div className="wide:hidden h-12 shrink-0 flex items-center gap-1 pl-1 pr-3 border-b border-line">
          <button onClick={() => setMenu(true)} className="h-9 flex items-center gap-0.5 rounded-md pl-1 pr-2 text-text-1 hover:bg-bg-3 hover:text-text-0" data-settings-back><ChevronLeft size={22} /><span className="text-[15px]">{t(title)}</span></button>
          <span className="min-w-0 flex-1 truncate text-center font-semibold" data-settings-title>{current?.label ? t(current.label) : ''}</span>
          {closeBtn}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className={`${wide ? 'max-w-[960px]' : 'max-w-[740px]'} px-10 py-14 phone:px-4 phone:py-5 relative`}>{children}</div>
        </div>
      </div>
      <div className="w-[60px] shrink-0 pt-14 pr-6 hidden wide:block">
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
        {/* With "Show on/off indicators" (Accessibility) the knob carries a check or a cross. */}
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition flex items-center justify-center ${checked ? 'left-[18px] text-success' : 'left-0.5 text-text-2'}`}>
          <span className="toggle-icon hidden" aria-hidden>{checked ? <Check size={13} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}</span>
        </span>
      </button>
    </label>
  )
}
