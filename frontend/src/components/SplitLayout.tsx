import { isPhone } from '../lib/swipe'
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import GuildBar from './GuildBar'
import Modals from './modals'
import UserPanel from './UserPanel'
import { useStore } from '../store'
import { useResizableSidebar } from '../lib/resize'
import { useT } from '../lib/i18n'

/**
 * The app's two-column frame (server bar + sidebar on the left, content on the right) for pages
 * outside the chat shell. On phones only one pane shows at a time, driven by the shared
 * `mobilePane` state: sidebars call `useShowContent()` when an item is picked and content headers
 * render `<MobileBack />` to return. `defaultPane` picks which pane a phone lands on.
 */
export default function SplitLayout({ sidebar, children, defaultPane = 'nav', testid }: { sidebar: ReactNode; children: ReactNode; defaultPane?: 'nav' | 'content'; testid?: Record<string, string> }) {
  const pane = useStore((s) => s.mobilePane)
  const setMobilePane = useStore((s) => s.setMobilePane)
  useEffect(() => { if (isPhone()) setMobilePane(defaultPane) }, [defaultPane, setMobilePane])
  return (
    <div className="h-full flex overflow-hidden relative safe-area" {...testid}>
      <NavColumn hidden={pane === 'content'}>
        <div className="flex flex-1 min-h-0">
          <GuildBar />
          {sidebar}
        </div>
        <UserPanel />
      </NavColumn>
      <main className={`flex-1 min-w-0 flex flex-col bg-bg-2 ${pane === 'nav' ? 'phone:hidden' : ''}`}>{children}</main>
      <Modals />
    </div>
  )
}

/** For sidebar items: on phones, reveal the content pane after a pick. */
export function useShowContent() {
  const setMobilePane = useStore((s) => s.setMobilePane)
  return () => setMobilePane('content')
}

/**
 * The left column: server bar, the page's sidebar and the self card. On desktop the sidebar width is draggable
 * (224–450 px) and reaches the sidebars through `--sidebar-w`; tablets and phones keep their fixed layouts.
 */
export function NavColumn({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const t = useT()
  const { width, handleProps } = useResizableSidebar('sidebar', 272, 224, 450)
  return (
    <div style={{ '--sidebar-w': `${width}px` } as CSSProperties} className={`relative flex flex-col h-full shrink-0 w-[calc(72px_+_var(--sidebar-w))] tab:w-[296px] phone:w-auto phone:absolute phone:inset-0 phone:z-20 ${hidden ? 'phone:hidden' : ''}`} data-layer="md">
      {children}
      <div {...handleProps} aria-label={t('Resize sidebar')} data-sidebar-resizer />
    </div>
  )
}
