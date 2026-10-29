import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '../../lib/i18n'

export interface WindowItem<T extends string> {
  id: T
  label: string
  icon?: ReactNode
  /** Words that find this page from the search box besides its label. */
  keywords?: string
  /** Sections on the page, listed under the item while it is open; picking one scrolls to it. */
  subs?: { id: string; label: string }[]
}
export interface WindowGroup<T extends string> { title?: string; items: WindowItem<T>[] }

interface Props<T extends string> {
  groups: WindowGroup<T>[]
  tab: T
  onTab: (t: T) => void
  onClose: () => void
  /** Top of the sidebar (who you are, a way to your profile). */
  header?: ReactNode
  footer?: ReactNode
  children: ReactNode
  title?: string
  /** Phones: open on the section list (true) or straight into `tab` (false, when a link asked for a section). */
  startOnMenu?: boolean
  /** Scroll to this section of the page once it renders. */
  scrollTo?: string | null
}

/** A page section the sidebar can list and jump to: a big heading over its rows, divided from the next one. */
export function WindowSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="py-8 first:pt-0 border-b border-line/70 last:border-b-0" data-settings-section-id={id}>
      <h2 className="text-[22px] font-semibold text-text-0 mb-5">{title}</h2>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

/** One setting on a line: its name (and a hint) on the left, its value and action on the right. */
export function WindowRow({ label, hint, value, action, ...data }: { label: ReactNode; hint?: ReactNode; value?: ReactNode; action?: ReactNode } & Record<`data-${string}`, string | undefined>) {
  return (
    <div className="flex items-center gap-4 min-h-10" {...data}>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-text-0">{label}</div>
        {hint && <div className="text-xs text-text-2 mt-0.5">{hint}</div>}
      </div>
      {value !== undefined && <div className="min-w-0 truncate text-[15px] text-text-1 text-right">{value}</div>}
      {action}
    </div>
  )
}

export const windowButton = 'h-10 shrink-0 rounded-lg bg-bg-3 hover:bg-bg-4 px-5 text-sm font-semibold text-text-0'

/**
 * User settings as Discord's settings window: a sidebar (you, a search box, pages with icons in groups, the open
 * page's sections underneath it) beside the page with a title bar. Phones get the list first, then the page with a
 * back button, clear of the system bars.
 */
export default function SettingsWindow<T extends string>({ groups, tab, onTab, onClose, header, footer, children, title = 'Settings', startOnMenu = true, scrollTo }: Props<T>) {
  const [menu, setMenu] = useState(startOnMenu)
  const [q, setQ] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[data-context-menu], [data-account-dialog], [role=dialog] [role=dialog]')) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const items = groups.flatMap((g) => g.items)
  const current = items.find((it) => it.id === tab)
  const pick = (id: T, sub?: string) => {
    onTab(id); setMenu(false); setQ('')
    if (sub) requestAnimationFrame(() => jump(sub))
    else { body.current?.scrollTo({ top: 0 }); setActive(null) }
  }
  const jump = (sub: string) => {
    const el = body.current?.querySelector<HTMLElement>(`[data-settings-section-id="${sub}"]`)
    if (el && body.current) body.current.scrollTo({ top: el.offsetTop - 24, behavior: 'smooth' })
    setActive(sub)
  }
  useEffect(() => { if (scrollTo) { const id = scrollTo; const r = requestAnimationFrame(() => jump(id)); return () => cancelAnimationFrame(r) } }, [scrollTo, tab])
  // Which of the page's sections is in view, for the sidebar.
  useEffect(() => {
    const el = body.current
    if (!el || !current?.subs) return
    const onScroll = () => {
      const secs = [...el.querySelectorAll<HTMLElement>('[data-settings-section-id]')]
      let id: string | null = secs[0]?.dataset.settingsSectionId ?? null
      for (const s of secs) if (s.offsetTop - el.scrollTop <= 96) id = s.dataset.settingsSectionId ?? id
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) id = secs.at(-1)?.dataset.settingsSectionId ?? id
      setActive(id)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [tab, current?.subs])

  const needle = q.trim().toLowerCase()
  const found = useMemo(() => !needle ? [] : items.filter((it) => `${it.label} ${it.keywords ?? ''} ${(it.subs ?? []).map((s) => s.label).join(' ')}`.toLowerCase().includes(needle)), [needle, items])
  const navItem = (it: WindowItem<T>) => {
    const on = tab === it.id
    return (
      <div key={it.id}>
        <button type="button" onClick={() => pick(it.id)} data-settings-tab={it.id} aria-current={on ? 'page' : undefined}
          className={`w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-[15px] font-medium text-left phone:py-3 ${on ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3 hover:text-text-0'}`}>
          <span className="w-5 shrink-0 flex justify-center text-text-2">{it.icon}</span><span className="flex-1 truncate">{t(it.label)}</span><ChevronRight size={16} className="wide:hidden text-text-2" />
        </button>
        {on && it.subs && it.subs.length > 0 && (
          <div className="ml-5 mt-0.5 mb-1 border-l border-line pl-0 phone:hidden" data-settings-subs>
            {it.subs.map((s) => (
              <button key={s.id} type="button" onClick={() => jump(s.id)} data-settings-sub={s.id} aria-current={active === s.id ? 'true' : undefined}
                className={`relative w-full text-left pl-4 pr-2 py-1.5 text-sm ${active === s.id ? 'text-text-0 font-medium before:absolute before:-left-px before:inset-y-1 before:w-0.5 before:rounded before:bg-text-0' : 'text-text-2 hover:text-text-1'}`}>{t(s.label)}</button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex pop safe-area phone:bg-bg-1 phone:backdrop-blur-none" role="dialog" aria-modal data-settings-view={menu ? 'menu' : 'section'} data-settings-window>
      {/* The margin around the window lives here: the safe-area padding on the overlay would override it. */}
      <div className="flex-1 min-w-0 flex justify-center wide:p-4 lg:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-[1320px] flex rounded-xl border border-line bg-bg-1 shadow-2xl overflow-hidden phone:rounded-none phone:border-0 phone:flex-col">
        <nav className={`w-[272px] shrink-0 bg-bg-0/60 border-r border-line/60 flex flex-col min-h-0 phone:w-full phone:flex-1 phone:border-r-0 phone:bg-bg-1 ${menu ? '' : 'phone:hidden'}`} data-settings-nav>
          <div className="wide:hidden h-12 shrink-0 flex items-center gap-2 px-4 border-b border-line"><span className="font-bold text-lg truncate flex-1">{t(title)}</span>
            <button onClick={onClose} title={t('Close')} className="h-9 w-9 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" data-settings-close><X size={22} /></button></div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
            {header}
            <label className="flex items-center gap-2 h-10 rounded-lg bg-bg-1 border border-line px-3 my-2 focus-within:border-accent phone:bg-bg-0">
              <Search size={16} className="text-text-2 shrink-0" />
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) pick(found[0].id) }} placeholder={t('Search')} aria-label={t('Search settings')}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-2" data-settings-search />
              {q && <button type="button" onClick={() => setQ('')} aria-label={t('Clear')} className="text-text-2 hover:text-text-0"><X size={14} /></button>}
            </label>
            {needle ? (
              found.length ? found.map(navItem) : <p className="px-2.5 py-2 text-sm text-text-2" data-settings-no-results>{t('Nothing matches.')}</p>
            ) : groups.map((g, i) => (
              <div key={i}>
                {i > 0 && <div className="h-px bg-line/70 mx-2 my-2.5" />}
                {g.title && <h3 className="px-2.5 pt-0.5 pb-1 text-[12px] font-semibold text-text-2 truncate" data-settings-section>{t(g.title)}</h3>}
                {g.items.map(navItem)}
              </div>
            ))}
            {footer && !needle && <><div className="h-px bg-line/70 mx-2 my-2.5" />{footer}</>}
          </div>
        </nav>
        <div className={`flex-1 min-w-0 min-h-0 flex flex-col ${menu ? 'phone:hidden' : ''}`}>
          <div className="h-14 shrink-0 flex items-center gap-2 px-6 border-b border-line/60 phone:h-12 phone:px-2">
            <button onClick={() => setMenu(true)} className="wide:hidden h-9 flex items-center gap-0.5 rounded-md pl-1 pr-2 text-text-1 hover:bg-bg-3 hover:text-text-0" data-settings-back><ChevronLeft size={22} /><span className="text-[15px]">{t(title)}</span></button>
            <span className="min-w-0 flex-1 truncate font-semibold text-[15px] phone:text-center" data-settings-title>{current?.label ? t(current.label) : ''}</span>
            <button onClick={onClose} title={t('Close')} aria-label={t('Close')} className="h-9 w-9 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" data-settings-close><X size={20} /></button>
          </div>
          <div ref={body} className="relative flex-1 min-h-0 overflow-y-auto" data-settings-body>
            <div className="max-w-[740px] mx-auto px-10 py-10 phone:px-4 phone:py-5">{children}</div>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
