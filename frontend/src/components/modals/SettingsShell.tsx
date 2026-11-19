import { t } from '../../lib/i18n'
import { X, Check } from 'lucide-react'
import type { ReactNode } from 'react'
import SettingsWindow, { type WindowGroup } from './SettingsWindow'

/** `keywords`: words that find a section from the search box besides its label. */
export interface NavSection<T extends string> { title?: string; items: { id: T; label: string; icon?: ReactNode; keywords?: string }[] }

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
  /** The user guide's page about the open section ('page' or 'page#heading'), for its Help button. */
  help?: string
}

/**
 * Server and channel settings: the same window as user settings (SettingsWindow), fed this simpler list of sections.
 */
export default function SettingsShell<T extends string>({ sections, footer, ...rest }: Props<T>) {
  const groups: WindowGroup<T>[] = sections.map((sec) => ({ title: sec.title, items: sec.items }))
  return <SettingsWindow<T> groups={groups} footer={footer} {...rest} />
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
