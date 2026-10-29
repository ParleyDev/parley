import { Menu, Users } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../lib/i18n'

/** Phone-only button that slides the navigation pane (guild bar + sidebar) back in. */
export function MobileBack() {
  const t = useT()
  const setMobilePane = useStore((s) => s.setMobilePane)
  return (
    <button onClick={() => setMobilePane('nav')} title={t('Channels')} className="wide:hidden -ml-1 mr-1 h-9 w-9 shrink-0 rounded-md flex items-center justify-center text-text-1 hover:bg-bg-3 hover:text-text-0">
      <Menu size={22} />
    </button>
  )
}

/** Toggles the member list: a sidebar on wide screens, a full-screen sheet on phones. */
export function MembersToggle() {
  const t = useT()
  const open = useStore((s) => s.membersOpen)
  const setOpen = useStore((s) => s.setMembersOpen)
  return (
    <button onClick={() => setOpen(!open)} title={t('Member List')} className={`h-9 w-9 shrink-0 rounded-md flex items-center justify-center hover:bg-bg-3 ${open ? 'text-text-0' : 'text-text-2 hover:text-text-0'}`}>
      <Users size={20} />
    </button>
  )
}
